/**
 * The checker's rules over an in-memory set of documents
 * (docs/spec/formats/native-contracts.md#checker). It reports and never repairs:
 * it takes text in and returns reports out, and has no way to write anything.
 *
 * What is configured, because the spec leaves it open (#not-decided-here):
 *  - the registry of native extensions, and optionally which extensions mark a document;
 *  - the name of the link field a plugin document uses for its owner;
 *  - the name of the link field an owner uses for its plugin documents.
 *
 * A file whose extension is not a document extension is not a native document. Legacy files
 * (`.anm`, `.brd`, ...) are such files: the checker neither reads nor reports them.
 */

import { readDocument, type DocumentInput, type FieldValue, type ReadDocument, type StampReport } from "./document.ts";
import { compareText, foldId } from "./fold.ts";
import { classifyExtension, extensionOf, lookupExtension, REGISTRY, validateRegistry, type Registry } from "./registry.ts";

export type CheckConfig = {
  /**
   * Extensions that mark a native document, such as `.tkranm`, matched after ASCII folding.
   * Absent: every extension of the registry. Present: exactly these, whether or not the
   * registry holds them (a document whose extension is not registered has no contract to
   * agree with).
   */
  readonly documentExtensions?: readonly string[];
  /** The extension to contract table. Absent: the shipped {@link REGISTRY}. */
  readonly registry?: Registry;
  /** Top-level field of a plugin document that holds its owner's ID (a text value). */
  readonly ownerField: string;
  /** Top-level field of an owner that holds its plugin documents' IDs (a list of text values). */
  readonly pluginsField: string;
};

/** Which side of a link the author should change, when the checker can tell. */
export type FixSide = "owner" | "plugin" | null;

export type DuplicateIdReport = {
  readonly class: "duplicate-id";
  readonly id: string;
  /** Every document that resolves to the ID, in path order. */
  readonly paths: readonly string[];
};

export type FoldCollisionReport = {
  readonly class: "fold-collision";
  readonly foldedId: string;
  /** Every path whose ID folds to `foldedId`, in path order. */
  readonly paths: readonly string[];
};

export type PluginNoOwnerReport = {
  readonly class: "plugin-no-owner";
  readonly path: string;
  readonly id: string;
  /** The owner ID the plugin document names, as written (or the text found when unreadable). */
  readonly owner: string;
  readonly reason: string;
  readonly fix: FixSide;
};

export type OwnerNoBackLinkReport = {
  readonly class: "owner-no-back-link";
  readonly owner: { readonly path: string; readonly id: string };
  /** The plugin document the owner names, as written. `path` is `null` when no document has that ID. */
  readonly plugin: { readonly named: string; readonly path: string | null };
  readonly reason: string;
  readonly fix: FixSide;
};

export type LinkEnd = {
  readonly role: "owner" | "plugin";
  readonly path: string;
  readonly id: string;
  /** The IDs this end names, as written; empty when it names nothing. */
  readonly names: readonly string[];
};

export type MismatchedLinkReport = {
  readonly class: "mismatched-link";
  readonly ends: readonly [LinkEnd, LinkEnd];
  readonly reason: string;
  readonly fix: FixSide;
};

export type ExtensionContractMismatchReport = {
  readonly class: "extension-contract-mismatch";
  readonly path: string;
  /** The extension as registered (lowercase), whatever its case in the path. */
  readonly extension: string;
  /** The contract the registry holds for the extension. */
  readonly registered: string;
  /** The contract the document's stamp names. */
  readonly stamp: string;
};

export type CheckReport =
  | StampReport
  | DuplicateIdReport
  | FoldCollisionReport
  | PluginNoOwnerReport
  | OwnerNoBackLinkReport
  | MismatchedLinkReport
  | ExtensionContractMismatchReport;

export type ReportClass = CheckReport["class"];

export const REPORT_CLASSES: readonly ReportClass[] = [
  "stamp",
  "duplicate-id",
  "fold-collision",
  "plugin-no-owner",
  "owner-no-back-link",
  "mismatched-link",
  "extension-contract-mismatch",
];

/**
 * The ID of a document: its path, extension included, with `/` between parts. An empty part
 * (`clips//walk.tkranm`) and a `.` part (`./clips/walk.tkranm`) are dropped, so those spellings
 * are the one ID `clips/walk.tkranm`. Case is kept; comparison folds it (see {@link foldId}).
 */
export function documentId(path: string): string {
  return path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

type Doc = {
  readonly read: ReadDocument;
  readonly path: string;
  readonly id: string;
};

type Link =
  | { readonly state: "absent" }
  | { readonly state: "bad"; readonly found: string; readonly reason: string }
  | { readonly state: "ok"; readonly items: readonly string[] };

function readLink(values: readonly FieldValue[] | undefined, field: string, shape: "text" | "list"): Link {
  if (values === undefined || values.length === 0) return { state: "absent" };
  const describe = (value: FieldValue): string =>
    value.kind === "text" ? value.value : value.kind === "list" ? `[${value.items.join(", ")}]` : value.found;
  if (values.length > 1) {
    return { state: "bad", found: values.map(describe).join(" | "), reason: `\`${field}\` appears ${values.length} times; it must appear once` };
  }
  const value = values[0]!;
  if (shape === "text" && value.kind === "text") return { state: "ok", items: [value.value] };
  if (shape === "list" && value.kind === "list") return { state: "ok", items: value.items };
  return {
    state: "bad",
    found: describe(value),
    reason: shape === "text" ? `\`${field}\` must be one ID` : `\`${field}\` must be a list of IDs`,
  };
}

/** Throws a `RangeError` naming the problem when the configuration cannot be used. */
export function validateConfig(config: CheckConfig): void {
  if (config.ownerField === "" || config.pluginsField === "") {
    throw new RangeError("the owner and plugins link field names must not be empty");
  }
  if (config.ownerField === config.pluginsField) {
    throw new RangeError("the owner and plugins link fields must have different names");
  }
  for (const name of [config.ownerField, config.pluginsField]) {
    if (name === "contract" || name === "version") throw new RangeError(`\`${name}\` is a stamp key, not a link field`);
  }
  if (config.documentExtensions !== undefined) {
    if (config.documentExtensions.length === 0 || config.documentExtensions.some((extension) => extension === "")) {
      throw new RangeError("at least one non-empty document extension is required");
    }
  }
  if (config.registry !== undefined) validateRegistry(config.registry);
}

/**
 * Whether a path names a native document: without `documentExtensions`, its extension is in the
 * registry; with them, it ends in one of them (matched after ASCII folding, with a name before it).
 * Every other path, a legacy file among them, is not a native document.
 */
export function isDocumentPath(path: string, config: Pick<CheckConfig, "documentExtensions" | "registry">): boolean {
  if (config.documentExtensions === undefined) return classifyExtension(extensionOf(path), config.registry ?? REGISTRY) === "native-registered";
  const folded = foldId(path);
  return config.documentExtensions.some((extension) => {
    const suffix = foldId(extension);
    return folded.endsWith(suffix) && path.length > suffix.length;
  });
}

function group<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [item]);
    else list.push(item);
  }
  return groups;
}

/**
 * Check a folder's worth of documents. `inputs` are the documents with paths
 * relative to the folder, separated by `/`. The result is ordered by class (the
 * order of {@link REPORT_CLASSES}), then by path, so it is the same on every run.
 */
export function checkDocuments(inputs: readonly DocumentInput[], config: CheckConfig): CheckReport[] {
  validateConfig(config);
  const { ownerField, pluginsField } = config;
  const registry = config.registry ?? REGISTRY;

  const docs: Doc[] = inputs
    .filter((input) => isDocumentPath(input.path, config))
    .sort((left, right) => compareText(left.path, right.path))
    .map((input) => ({
      read: readDocument(input, [ownerField, pluginsField, "contract"]),
      path: input.path,
      id: documentId(input.path),
    }));

  const reports: CheckReport[] = [];
  for (const doc of docs) reports.push(...doc.read.stampReports);

  // Identity. Same ID as written (a path listed twice, or two spellings of one path), then same ID once folded.
  const byId = group(docs, (doc) => doc.id);
  for (const [id, same] of byId) {
    if (same.length > 1) reports.push({ class: "duplicate-id", id, paths: same.map((doc) => doc.path) });
  }
  const byFold = group(docs, (doc) => foldId(doc.id));
  for (const [foldedId, same] of byFold) {
    if (new Set(same.map((doc) => doc.id)).size > 1) {
      reports.push({ class: "fold-collision", foldedId, paths: same.map((doc) => doc.path) });
    }
  }

  // Resolving an ID: the entry whose casing matches is chosen (identity rule 3); otherwise the
  // one entry that folds to it. When several documents answer to the ID the link is ambiguous,
  // and the identity reports above already name them, so no link report is added on top.
  type Resolution =
    | { readonly kind: "found"; readonly doc: Doc }
    | { readonly kind: "none" }
    | { readonly kind: "ambiguous"; readonly docs: readonly Doc[] };
  const resolve = (written: string): Resolution => {
    const exact = byId.get(written);
    if (exact !== undefined) return exact.length === 1 ? { kind: "found", doc: exact[0]! } : { kind: "ambiguous", docs: exact };
    const folded = byFold.get(foldId(written));
    if (folded === undefined) return { kind: "none" };
    return folded.length === 1 ? { kind: "found", doc: folded[0]! } : { kind: "ambiguous", docs: folded };
  };

  const ownerLinks = new Map<Doc, Link>();
  const pluginLinks = new Map<Doc, Link>();
  /**
   * The documents each owner names, resolved. Entries that resolve to nothing are left out; an
   * entry that several documents answer to counts all of them as named, so a duplicate ID or a
   * fold collision (reported above) does not also read as a broken link.
   */
  const named = new Map<Doc, Doc[]>();
  /** The owners that name each document. */
  const namedBy = new Map<Doc, Doc[]>();
  for (const doc of docs) {
    ownerLinks.set(doc, readLink(doc.read.fields.get(ownerField), ownerField, "text"));
    const link = readLink(doc.read.fields.get(pluginsField), pluginsField, "list");
    pluginLinks.set(doc, link);
    const found: Doc[] = [];
    if (link.state === "ok") {
      for (const item of link.items) {
        const target = resolve(item);
        if (target.kind === "found") found.push(target.doc);
        else if (target.kind === "ambiguous") found.push(...target.docs);
      }
    }
    named.set(doc, found);
    for (const plugin of found) namedBy.set(plugin, [...(namedBy.get(plugin) ?? []), doc]);
  }

  const namesPlugins = (owner: Doc): readonly string[] => {
    const link = pluginLinks.get(owner)!;
    return link.state === "ok" ? link.items : link.state === "bad" ? [link.found] : [];
  };

  const noOwner: PluginNoOwnerReport[] = [];
  const noBackLink: OwnerNoBackLinkReport[] = [];
  const mismatched: MismatchedLinkReport[] = [];

  for (const doc of docs) {
    // Plugin side: the owner this document names must exist, and name it back.
    const ownerLink = ownerLinks.get(doc)!;
    if (ownerLink.state === "bad") {
      noOwner.push({ class: "plugin-no-owner", path: doc.path, id: doc.id, owner: ownerLink.found, reason: ownerLink.reason, fix: "plugin" });
    } else if (ownerLink.state === "ok") {
      const written = ownerLink.items[0]!;
      const target = resolve(written);
      if (target.kind === "none") {
        noOwner.push({ class: "plugin-no-owner", path: doc.path, id: doc.id, owner: written, reason: "no document has this ID", fix: null });
      } else if (target.kind === "found") {
        const owner = target.doc;
        const ownerNames = named.get(owner)!;
        const elsewhere = (namedBy.get(doc) ?? []).some((other) => other !== owner);
        // When a different owner names this document, that owner's own pass reports the disagreement.
        if (!ownerNames.includes(doc) && !elsewhere) {
          mismatched.push({
            class: "mismatched-link",
            ends: [
              { role: "plugin", path: doc.path, id: doc.id, names: [written] },
              { role: "owner", path: owner.path, id: owner.id, names: namesPlugins(owner) },
            ],
            reason:
              ownerNames.length > 0
                ? `\`${doc.path}\` names the owner \`${written}\`, which names other plugin documents but not this one`
                : `\`${doc.path}\` names the owner \`${written}\`, which does not name it back`,
            fix: ownerNames.length > 0 ? "plugin" : null,
          });
        }
      }
    }

    // Owner side: every plugin document this one names must exist and name this one back.
    const pluginsLink = pluginLinks.get(doc)!;
    if (pluginsLink.state === "bad") {
      noBackLink.push({
        class: "owner-no-back-link",
        owner: { path: doc.path, id: doc.id },
        plugin: { named: pluginsLink.found, path: null },
        reason: pluginsLink.reason,
        fix: "owner",
      });
    } else if (pluginsLink.state === "ok") {
      for (const written of new Set(pluginsLink.items)) {
        const target = resolve(written);
        if (target.kind === "ambiguous") continue;
        if (target.kind === "none") {
          noBackLink.push({
            class: "owner-no-back-link",
            owner: { path: doc.path, id: doc.id },
            plugin: { named: written, path: null },
            reason: "no document has this ID, so it cannot name the owner back",
            fix: "owner",
          });
          continue;
        }
        const plugin = target.doc;
        const back = ownerLinks.get(plugin)!;
        if (back.state === "absent") {
          noBackLink.push({
            class: "owner-no-back-link",
            owner: { path: doc.path, id: doc.id },
            plugin: { named: written, path: plugin.path },
            reason: `\`${plugin.path}\` names no owner`,
            fix: "plugin",
          });
          continue;
        }
        if (back.state === "bad") continue; // the plugin document's own unreadable link is reported above
        const claimed = back.items[0]!;
        const other = resolve(claimed);
        if (other.kind !== "found" || other.doc === doc) continue; // missing owner: reported above
        const otherNamesPlugin = named.get(other.doc)!.includes(plugin);
        mismatched.push({
          class: "mismatched-link",
          ends: [
            { role: "owner", path: doc.path, id: doc.id, names: [written] },
            { role: "plugin", path: plugin.path, id: plugin.id, names: [claimed] },
          ],
          reason: `\`${doc.path}\` names \`${plugin.path}\`, which names \`${other.doc.path}\` as its owner instead`,
          fix: otherNamesPlugin ? "owner" : null,
        });
      }
    }
  }

  // The extension and the stamp must name one contract. Judged only when the registry holds the
  // extension and the stamp names its contract once, as text: any other stamp is already reported.
  const disagree: ExtensionContractMismatchReport[] = [];
  for (const doc of docs) {
    const entry = lookupExtension(extensionOf(doc.path) ?? "", registry);
    const stamped = doc.read.fields.get("contract");
    if (entry === undefined || stamped === undefined || stamped.length !== 1) continue;
    const value = stamped[0]!;
    if (value.kind === "text" && value.value !== entry.contract) {
      disagree.push({ class: "extension-contract-mismatch", path: doc.path, extension: entry.extension, registered: entry.contract, stamp: value.value });
    }
  }

  reports.push(...noOwner, ...noBackLink, ...mismatched, ...disagree);
  const rank = (report: CheckReport): number => REPORT_CLASSES.indexOf(report.class);
  const firstPath = (report: CheckReport): string => {
    switch (report.class) {
      case "stamp":
      case "plugin-no-owner":
      case "extension-contract-mismatch":
        return report.path;
      case "duplicate-id":
      case "fold-collision":
        return report.paths[0] ?? "";
      case "owner-no-back-link":
        return report.owner.path;
      case "mismatched-link":
        return report.ends[0].path;
    }
  };
  // Array.prototype.sort is stable, so reports that tie keep the order they were found in.
  return reports.sort((left, right) => rank(left) - rank(right) || compareText(firstPath(left), firstPath(right)));
}
