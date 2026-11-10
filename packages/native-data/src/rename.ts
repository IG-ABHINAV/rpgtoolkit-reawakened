/**
 * The rename planner (docs/spec/formats/native-contracts.md#rename).
 *
 * A native document's ID is its path, extension included, so moving or renaming a document
 * changes its ID, and every reference to the old ID must change in the same step. Given the
 * documents already in memory and a map of old IDs to new IDs, this module returns the whole
 * set of file moves and text edits, or a refusal that names every reason. It reads and writes
 * no file (G2): the executor that applies a plan is `native-data-rename`.
 *
 * What it rewrites:
 *  - the document's own location (a move);
 *  - every reference to the old ID in any native document, in the link fields and in the
 *    optional extra reference fields the caller names;
 *  - both ends of each sidecar link: an owner's plugins-list entry that names the document, and
 *    a plugin document's owner field that names it. These are the two link fields, so they are
 *    references like any other.
 *
 * Every edit is a splice into the original text (see `splice.ts`): only the reference scalar
 * changes, so comments, spacing and unrelated lines stay byte for byte, and a reference changes
 * by exactly the line that holds it. A document is never regenerated from a parsed tree.
 *
 * What it refuses, with the reason (nothing is planned then): a new ID that is not a valid ID; an
 * extension that marks no native document; an extension whose registered contract is not the
 * document's; a new ID that is, or folds to, another document's ID; an old ID no document has; a
 * project that is not checker-clean before the rename; a reference field that cannot be read.
 */

import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type Scalar } from "yaml";
import { checkDocuments, documentId, isDocumentPath, validateConfig, type CheckConfig, type CheckReport } from "./check.ts";
import { readDocument, type DocumentInput } from "./document.ts";
import { compareText, foldId } from "./fold.ts";
import { extensionOf, lookupExtension, REGISTRY } from "./registry.ts";
import { code, formatReport, list } from "./report.ts";
import { applySplices, rangeOf, scalarText, type Splice } from "./splice.ts";

export type RenameConfig = CheckConfig & {
  /**
   * Further top-level fields, besides the two link fields, that hold the ID of a document or a
   * list of IDs (a scene naming its actors, for example). The spec leaves their names to the
   * contracts that define them, so they are configuration, as the link field names are.
   */
  readonly referenceFields?: readonly string[];
};

/** One rename: the old ID (a document the project holds) and the new ID. */
export type RenamePair = { readonly from: string; readonly to: string };

/** A file move, from the document's path to its new path (the new ID). */
export type RenameMove = { readonly from: string; readonly to: string };

/** A changed line of a document: its 1-based number and the whole line before and after. */
export type LineChange = { readonly line: number; readonly before: string; readonly after: string };

/** A document whose text changes. `path` is where the document is now, before any move. */
export type RenameEdit = {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly changes: readonly LineChange[];
};

export type RenamePlan = {
  /** Sorted by `from`. */
  readonly moves: readonly RenameMove[];
  /** Sorted by `path`. Only documents that hold a reference to a moved document. */
  readonly edits: readonly RenameEdit[];
};

export type RefusalCode =
  | "no-rename"
  | "invalid-id"
  | "unregistered-extension"
  | "old-not-found"
  | "same-document-twice"
  | "project-not-clean"
  | "same-id"
  | "extension-contract-mismatch"
  | "id-exists"
  | "id-folds-to-existing"
  | "new-ids-collide"
  | "unreadable-reference"
  | "cannot-edit-in-place"
  | "plan-not-clean";

export type RenameRefusal = { readonly code: RefusalCode; readonly message: string };

export type RenameResult =
  | { readonly ok: true; readonly plan: RenamePlan }
  | { readonly ok: false; readonly refusals: readonly RenameRefusal[] };

/** Throws a `RangeError` naming the problem when the configuration cannot be used. */
export function validateRenameConfig(config: RenameConfig): void {
  validateConfig(config);
  const seen = new Set<string>();
  for (const name of config.referenceFields ?? []) {
    if (name === "") throw new RangeError("a reference field name must not be empty");
    if (name === "contract" || name === "version") throw new RangeError(`\`${name}\` is a stamp key, not a reference field`);
    if (name === config.ownerField || name === config.pluginsField) {
      throw new RangeError(`\`${name}\` is a link field already; name only further reference fields`);
    }
    if (seen.has(name)) throw new RangeError(`the reference field \`${name}\` is named twice`);
    seen.add(name);
  }
}

// ------------------------------------------------------------------ the new ID

/**
 * The reason a text is not a valid new ID, or `null` when it is one: a path of `/` separated
 * parts, written the way the checker names a document (no empty part, no `.` part), with a file
 * name that has an extension. Case is kept as written (identity compares it folded).
 */
function invalidIdReason(id: string): string | null {
  if (id === "") return "it is empty";
  if (/[\u0000-\u001f\u007f]/.test(id)) return "it contains a control character, and an ID is one line";
  if (id.includes("\\")) return "`\\` is not a separator: the parts of an ID are separated by `/`";
  if (id.split("/").includes("..")) return "a `..` part is not resolved, so an ID cannot contain one";
  if (id.trim() !== id) return "it has a space at one end";
  const canonical = documentId(id);
  if (canonical !== id) return `an empty or \`.\` part is dropped from an ID, so it is written ${code(canonical)}`;
  if (extensionOf(id) === null) return "it has no extension, and an ID is a file name with its extension, such as `clips/walk.tkranm`";
  return null;
}

// ------------------------------------------------------------ reading references

type Shape = "text" | "list" | "either";

type Field = { readonly name: string; readonly shape: Shape };

type Occurrence = { readonly field: string; readonly written: string; readonly node: Scalar };

type Unreadable = { readonly field: string; readonly reason: string; readonly found: string };

const SHAPE_REASON: Readonly<Record<Shape, string>> = {
  text: "it must be one ID",
  list: "it must be a list of IDs",
  either: "it must be an ID or a list of IDs",
};

const flat = (text: string): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 80)}…` : one;
};

function nonEmptyText(node: unknown): node is Scalar<string> {
  return isScalar(node) && typeof node.value === "string" && node.value !== "";
}

/**
 * Every reference scalar of the named top-level fields of one document, with its range, and the
 * fields that cannot be read as an ID or a list of IDs. A repeated field is unreadable: a
 * reader never guesses which occurrence counts.
 */
function scanReferences(text: string, fields: readonly Field[]): { readonly occurrences: Occurrence[]; readonly problems: Unreadable[] } {
  const occurrences: Occurrence[] = [];
  const problems: Unreadable[] = [];
  const contents = parseDocument(text, { version: "1.2", schema: "core", uniqueKeys: false }).contents;
  if (!isMap(contents)) return { occurrences, problems };
  const pairs: readonly Pair[] = contents.items;
  for (const field of fields) {
    const found = pairs.filter((pair) => isScalar(pair.key) && pair.key.value === field.name);
    if (found.length === 0) continue;
    if (found.length > 1) {
      problems.push({ field: field.name, reason: `it appears ${found.length} times; it must appear once`, found: "" });
      continue;
    }
    const node = found[0]!.value as Node | null;
    const slice = node === null || node.range === undefined || node.range === null ? "" : text.slice(rangeOf(node)[0], rangeOf(node)[1]);
    if (nonEmptyText(node) && field.shape !== "list") {
      occurrences.push({ field: field.name, written: node.value, node });
    } else if (isSeq(node) && field.shape !== "text" && node.items.every(nonEmptyText)) {
      for (const item of node.items as Scalar<string>[]) occurrences.push({ field: field.name, written: item.value, node: item });
    } else {
      problems.push({ field: field.name, reason: SHAPE_REASON[field.shape], found: flat(slice) });
    }
  }
  return { occurrences, problems };
}

// ------------------------------------------------------------------- the planner

type Doc = {
  readonly input: DocumentInput;
  readonly path: string;
  readonly id: string;
};

const lineOf = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

const stripCarriageReturn = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

function lineChanges(before: string, splices: readonly Splice[]): LineChange[] {
  const after = applySplices(before, splices);
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const numbers = [...new Set(splices.map((splice) => lineOf(before, splice.start)))].sort((left, right) => left - right);
  return numbers.map((line) => ({ line, before: stripCarriageReturn(beforeLines[line - 1]!), after: stripCarriageReturn(afterLines[line - 1]!) }));
}

/** The documents as they would be after the plan: moved paths, edited texts. */
export function applyPlanToDocuments(inputs: readonly DocumentInput[], plan: RenamePlan): DocumentInput[] {
  const moved = new Map(plan.moves.map((move) => [move.from, move.to]));
  const edited = new Map(plan.edits.map((edit) => [edit.path, edit.after]));
  return inputs.map((input) => {
    const path = moved.get(input.path) ?? input.path;
    const text = edited.get(input.path);
    if (text !== undefined) return { path, text };
    return "text" in input ? { path, text: input.text } : { path, unreadable: input.unreadable };
  });
}

/** The checker's reports on the project as the plan would leave it; none when the plan is sound. */
export function verifyPlan(inputs: readonly DocumentInput[], plan: RenamePlan, config: RenameConfig): CheckReport[] {
  return checkDocuments(applyPlanToDocuments(inputs, plan), config);
}

function documentExtensions(config: RenameConfig): readonly string[] {
  return config.documentExtensions ?? (config.registry ?? REGISTRY).map((entry) => entry.extension);
}

/**
 * Plan a rename of one or more documents in one transaction. `documents` are the project's
 * native documents with paths relative to the project folder; `pairs` give the old ID and the new
 * ID of each rename. A project is all one transaction: several pairs are judged together, on the
 * project as it would be after all of them, so an owner and its plugin document can move
 * together, and two documents can swap names.
 *
 * Returns every reason for refusing, in a stable order: the problems of each new ID and old ID
 * in the order the pairs were given, then the project's own problems, then (only when those
 * pass) the problems that need a sound project to judge: a pair that changes nothing, a contract
 * that does not agree with the new extension, a new ID that collides, a reference that cannot be
 * read or edited in place.
 */
export function planRename(documents: readonly DocumentInput[], pairs: readonly RenamePair[], config: RenameConfig): RenameResult {
  validateRenameConfig(config);
  if (pairs.length === 0) {
    return { ok: false, refusals: [{ code: "no-rename", message: "nothing to rename: give at least one old ID and new ID" }] };
  }
  const { ownerField, pluginsField } = config;
  const referenceFields = config.referenceFields ?? [];
  const fields: readonly Field[] = [
    { name: ownerField, shape: "text" },
    { name: pluginsField, shape: "list" },
    ...referenceFields.map((name): Field => ({ name, shape: "either" })),
  ];

  const docs: Doc[] = documents
    .filter((input) => isDocumentPath(input.path, config))
    .sort((left, right) => compareText(left.path, right.path))
    .map((input) => ({ input, path: input.path, id: documentId(input.path) }));

  // Resolving an ID as the checker does: the entry whose casing matches, otherwise the entries that fold to it.
  const byId = new Map<string, Doc[]>();
  const byFold = new Map<string, Doc[]>();
  for (const doc of docs) {
    byId.set(doc.id, [...(byId.get(doc.id) ?? []), doc]);
    byFold.set(foldId(doc.id), [...(byFold.get(foldId(doc.id)) ?? []), doc]);
  }
  const resolve = (written: string): readonly Doc[] => byId.get(written) ?? byFold.get(foldId(written)) ?? [];

  const refusals: RenameRefusal[] = [];
  const refuse = (refusalCode: RefusalCode, message: string): void => {
    refusals.push({ code: refusalCode, message });
  };

  // 1. The pairs, one at a time: is the new ID one a document can have, and is there a document to rename?
  type Resolved = { readonly pair: RenamePair; readonly doc: Doc };
  const resolved: Resolved[] = [];
  for (const pair of pairs) {
    const reason = invalidIdReason(pair.to);
    if (reason !== null) refuse("invalid-id", `the new ID ${code(pair.to)} is not a valid ID: ${reason}`);
    else if (!isDocumentPath(pair.to, config)) {
      refuse(
        "unregistered-extension",
        `the extension ${code(extensionOf(pair.to) ?? "")} of the new ID ${code(pair.to)} marks no native document: the document extensions are ${list(documentExtensions(config))}`,
      );
    }
    const found = resolve(pair.from);
    if (found.length === 0) refuse("old-not-found", `no document has the ID ${code(pair.from)}, so there is nothing to rename`);
    else if (found.length === 1 && reason === null) resolved.push({ pair, doc: found[0]! });
  }
  for (let first = 0; first < resolved.length; first += 1) {
    for (let second = first + 1; second < resolved.length; second += 1) {
      if (resolved[first]!.doc === resolved[second]!.doc) {
        refuse(
          "same-document-twice",
          `${code(resolved[first]!.pair.from)} and ${code(resolved[second]!.pair.from)} are the same document (${code(resolved[first]!.doc.path)}): give each document one new ID`,
        );
      }
    }
  }

  // 2. The project: a rename is only judged on a project the checker finds clean.
  for (const report of checkDocuments(documents, config)) {
    refuse("project-not-clean", `the project is not clean before the rename: ${formatReport(report)}`);
  }
  if (refusals.length > 0) return { ok: false, refusals };

  // 3. What needs a sound project to judge.
  const renamed = new Map<Doc, string>(resolved.map(({ pair, doc }) => [doc, pair.to]));
  const finalId = (doc: Doc): string => renamed.get(doc) ?? doc.id;
  for (const { pair, doc } of resolved) {
    if (doc.id === pair.to) {
      refuse("same-id", `${code(pair.from)} already has the ID ${code(pair.to)}: nothing to rename`);
      continue;
    }
    const entry = lookupExtension(extensionOf(pair.to) ?? "", config.registry ?? REGISTRY);
    const stamped = readDocument(doc.input, ["contract"]).fields.get("contract")?.[0];
    if (entry !== undefined && stamped?.kind === "text" && stamped.value !== entry.contract) {
      refuse(
        "extension-contract-mismatch",
        `renaming ${code(doc.id)} to ${code(pair.to)} would give it the extension ${code(entry.extension)}, which is registered for the contract ${code(entry.contract)}, but its stamp names ${code(stamped.value)}: changing the kind of a document is not a rename`,
      );
    }
    for (const other of docs) {
      if (other === doc) continue;
      const otherId = finalId(other);
      if (foldId(otherId) !== foldId(pair.to)) continue;
      if (renamed.has(other)) continue; // two new IDs against each other, below
      if (otherId === pair.to) {
        refuse("id-exists", `the new ID ${code(pair.to)} is already the ID of the document ${code(other.path)}: a rename never replaces a document`);
      } else {
        refuse(
          "id-folds-to-existing",
          `the new ID ${code(pair.to)} folds to the same ID as the document ${code(other.path)} (${code(otherId)}): IDs are compared with only A to Z folded to a to z`,
        );
      }
    }
  }
  for (let first = 0; first < resolved.length; first += 1) {
    for (let second = first + 1; second < resolved.length; second += 1) {
      const left = resolved[first]!.pair.to;
      const right = resolved[second]!.pair.to;
      if (resolved[first]!.doc !== resolved[second]!.doc && foldId(left) === foldId(right)) {
        refuse("new-ids-collide", `the new IDs ${code(left)} and ${code(right)} are the same ID: IDs are compared with only A to Z folded to a to z`);
      }
    }
  }

  // 4. The references: every one that resolves to a renamed document is rewritten in place.
  const spliced = new Map<Doc, { readonly text: string; readonly splices: Splice[] }>();
  for (const doc of docs) {
    if (!("text" in doc.input)) continue;
    const { text } = doc.input;
    const { occurrences, problems } = scanReferences(text, fields);
    for (const problem of problems) {
      refuse(
        "unreadable-reference",
        `${doc.path}: the field ${code(problem.field)} is not an ID or a list of IDs (${problem.reason}${problem.found === "" ? "" : `; found ${problem.found}`}), so the rename cannot tell which documents it names`,
      );
    }
    for (const occurrence of occurrences) {
      const target = resolve(occurrence.written)[0];
      if (target === undefined || !renamed.has(target)) continue;
      const newId = renamed.get(target)!;
      if (occurrence.written === newId) continue;
      const [start, end] = rangeOf(occurrence.node);
      if (occurrence.node.type === "BLOCK_FOLDED" || occurrence.node.type === "BLOCK_LITERAL" || text.slice(start, end).includes("\n")) {
        refuse(
          "cannot-edit-in-place",
          `${doc.path}: line ${lineOf(text, start)}: the reference ${code(occurrence.written)} in ${code(occurrence.field)} is not written on one line, so it cannot be replaced in place`,
        );
        continue;
      }
      const splices = spliced.get(doc)?.splices ?? [];
      splices.push({ start, end, text: scalarText(newId, occurrence.node) });
      spliced.set(doc, { text, splices });
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  const plan: RenamePlan = {
    moves: resolved.map(({ pair, doc }) => ({ from: doc.path, to: pair.to })).sort((left, right) => compareText(left.from, right.from)),
    edits: [...spliced]
      .map(([doc, { text, splices }]): RenameEdit => ({ path: doc.path, before: text, after: applySplices(text, splices), changes: lineChanges(text, splices) }))
      .sort((left, right) => compareText(left.path, right.path)),
  };

  // The plan is checked by the checker itself before anything is offered for writing: a plan that
  // would leave the project with a problem is refused, whatever the reason.
  for (const report of verifyPlan(documents, plan, config)) {
    refuse("plan-not-clean", `the rename would leave the project with a problem, so nothing was planned: ${formatReport(report)}`);
  }
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, plan };
}
