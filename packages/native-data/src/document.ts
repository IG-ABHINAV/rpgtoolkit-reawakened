/**
 * Reading one native document's top level: the stamp keys and the named link
 * fields. This is all the checker needs from YAML; the YAML profile rules are
 * not decided (docs/spec/formats/native-contracts.md#not-decided-here), so nothing
 * here validates anything else in the document.
 *
 * The `yaml` package is pure JavaScript text parsing: it touches no file, no
 * timer and no host API, so this module does no I/O (G2).
 */

import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments, type Node, type Pair } from "yaml";
import { parseVersion } from "./version.ts";

export type DocumentInput =
  | { readonly path: string; readonly text: string }
  /** A file whose bytes could not be turned into text (for example, not UTF-8). */
  | { readonly path: string; readonly unreadable: string };

export type StampKey = "contract" | "version";

export type StampProblemKind = "missing" | "repeated" | "malformed" | "not-first" | "unreadable";

/** The "Missing or malformed stamp" report (docs/spec/formats/native-contracts.md#checker). */
export type StampReport = {
  readonly class: "stamp";
  /** The document path. */
  readonly path: string;
  /** The stamp key at fault, or `null` when the whole document cannot be read. */
  readonly key: StampKey | null;
  readonly problem: StampProblemKind;
  /** The text found: nothing when a key is missing, each occurrence when repeated. */
  readonly found: readonly string[];
  /** Why, in words; for a bad version this is the version grammar rule that failed. */
  readonly reason: string;
  /** 1-based line of the first offending occurrence, or `null`. */
  readonly line: number | null;
};

/** One occurrence of a top-level field, read without guessing. */
export type FieldValue =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "other"; readonly found: string };

export type ReadDocument = {
  readonly path: string;
  /** False when the document could not be read as one YAML mapping. */
  readonly readable: boolean;
  readonly stampReports: readonly StampReport[];
  /** Every occurrence, in order, of each requested top-level field name. */
  readonly fields: ReadonlyMap<string, readonly FieldValue[]>;
};

const STAMP_KEYS: readonly StampKey[] = ["contract", "version"];
const SNIPPET_LIMIT = 80;

/** Source text of a node on one line, shortened so a report stays readable. */
function snippet(source: string): string {
  const flat = source.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_LIMIT ? `${flat.slice(0, SNIPPET_LIMIT)}…` : flat;
}

function sourceOf(text: string, node: Node | null): string {
  if (node === null || node.range === undefined || node.range === null) return "";
  return text.slice(node.range[0], node.range[1]);
}

function keyName(text: string, pair: Pair): string {
  const key = pair.key as Node | null;
  if (isScalar(key) && typeof key.value === "string") return key.value;
  return snippet(sourceOf(text, key));
}

function describeScalarType(value: unknown): string {
  if (value === null) return "empty";
  return typeof value === "number" ? "a number" : typeof value === "boolean" ? "a boolean" : typeof value;
}

function readValue(text: string, node: Node | null): FieldValue {
  if (isScalar(node) && typeof node.value === "string" && node.value !== "") {
    return { kind: "text", value: node.value };
  }
  if (isSeq(node)) {
    const items: string[] = [];
    for (const item of node.items) {
      if (isScalar(item) && typeof item.value === "string" && item.value !== "") items.push(item.value);
      else return { kind: "other", found: snippet(sourceOf(text, node)) };
    }
    return { kind: "list", items };
  }
  if (isScalar(node) && typeof node.value === "string") return { kind: "other", found: "" };
  return { kind: "other", found: isScalar(node) ? sourceOf(text, node).trim() : snippet(sourceOf(text, node)) };
}

function unreadable(path: string, reason: string, line: number | null, found: string): ReadDocument {
  return {
    path,
    readable: false,
    stampReports: [{ class: "stamp", path, key: null, problem: "unreadable", found: found === "" ? [] : [found], reason, line }],
    fields: new Map(),
  };
}

/**
 * Read the stamp and the requested top-level fields of one document. A stamp
 * problem is reported, never repaired and never guessed around.
 */
export function readDocument(input: DocumentInput, fieldNames: readonly string[]): ReadDocument {
  const { path } = input;
  if ("unreadable" in input) return unreadable(path, input.unreadable, null, "");
  const { text } = input;

  const lines = new LineCounter();
  const parsed = parseAllDocuments(text, {
    version: "1.2",
    schema: "core",
    // Repeated keys are detected below, by name, so the stamp report can name them.
    uniqueKeys: false,
    lineCounter: lines,
  });
  if (parsed.length > 1) {
    return unreadable(path, `the file holds ${parsed.length} YAML documents; a native document is one`, null, "");
  }
  const document = parsed[0];
  if (document !== undefined && document.errors.length > 0) {
    const error = document.errors[0]!;
    const line = error.linePos?.[0]?.line ?? null;
    return unreadable(path, `YAML error: ${error.message.split("\n")[0]!.replace(/:$/, "")}`, line, "");
  }
  const contents = document?.contents ?? null;
  if (contents !== null && !isMap(contents)) {
    return unreadable(path, "the document is not a mapping of keys to values", 1, snippet(sourceOf(text, contents as Node)));
  }

  const pairs: readonly Pair[] = contents === null ? [] : contents.items;
  const lineOf = (pair: Pair): number | null => {
    const key = pair.key as Node | null;
    return key?.range ? lines.linePos(key.range[0]).line : null;
  };
  const names = pairs.map((pair) => keyName(text, pair));

  const stampReports: StampReport[] = [];
  const placed: { readonly key: StampKey; readonly index: number }[] = [];
  for (const key of STAMP_KEYS) {
    const indexes = names.flatMap((name, index) => (name === key ? [index] : []));
    if (indexes.length === 0) {
      stampReports.push({ class: "stamp", path, key, problem: "missing", found: [], reason: `the document has no \`${key}\` key`, line: null });
      continue;
    }
    const occurrences = indexes.map((index) => pairs[index]!);
    if (occurrences.length > 1) {
      stampReports.push({
        class: "stamp",
        path,
        key,
        problem: "repeated",
        found: occurrences.map((pair) => {
          const value = pair.value as Node | null;
          return isScalar(value) && typeof value.value === "string" ? value.value : snippet(sourceOf(text, value));
        }),
        reason: `\`${key}\` appears ${occurrences.length} times; it must appear once`,
        line: lineOf(occurrences[1]!),
      });
      continue;
    }
    placed.push({ key, index: indexes[0]! });
    const pair = occurrences[0]!;
    const value = pair.value as Node | null;
    const line = lineOf(pair);
    if (isScalar(value) && typeof value.value === "string") {
      if (key === "contract") {
        if (value.value.trim() === "") {
          stampReports.push({ class: "stamp", path, key, problem: "malformed", found: [value.value], reason: "the contract name is empty", line });
        }
      } else {
        const version = parseVersion(value.value);
        if (!version.ok) {
          stampReports.push({ class: "stamp", path, key, problem: "malformed", found: [value.value], reason: version.reason, line });
        }
      }
      continue;
    }
    const found = isScalar(value) ? sourceOf(text, value).trim() : snippet(sourceOf(text, value));
    let reason = `\`${key}\` must be a single text value`;
    if (isScalar(value)) {
      const typed = `YAML reads it as ${describeScalarType(value.value)}, not as text`;
      const version = key === "version" ? parseVersion(found) : null;
      reason = version !== null && !version.ok ? `${version.reason} (${typed})` : typed;
    }
    stampReports.push({ class: "stamp", path, key, problem: "malformed", found: [found], reason, line });
  }

  // Rule 1: `contract` and `version` are the first two keys. Judged only when both
  // appear exactly once; a missing or repeated key is already reported.
  if (placed.length === STAMP_KEYS.length) {
    const firstTwo = names.slice(0, 2);
    for (const { key, index } of placed) {
      if (index >= 2) {
        stampReports.push({
          class: "stamp",
          path,
          key,
          problem: "not-first",
          found: firstTwo,
          reason: `\`${key}\` is key ${index + 1}, but \`contract\` and \`version\` must be the first two keys`,
          line: lineOf(pairs[index]!),
        });
      }
    }
  }

  const fields = new Map<string, readonly FieldValue[]>();
  for (const name of fieldNames) {
    const values = pairs.flatMap((pair, index) => (names[index] === name ? [readValue(text, pair.value as Node | null)] : []));
    fields.set(name, values);
  }
  return { path, readable: true, stampReports, fields };
}
