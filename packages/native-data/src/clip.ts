/**
 * The native animation clip (docs/spec/formats/native-animation-clip.md): the
 * typed model, the reader, the writer and the in-place edit.
 *
 * Reference reader, writer and editor for contract `animation-clip`, version
 * `1.0.0-pre.1`. Everything works on text already in memory: no file, timer or
 * host API is touched (G2). The validator is hand-written; it is checked against
 * the published JSON Schema on every example (see the spec page's "Reference
 * reader, writer and importer" note), so the schema is not a runtime dependency.
 *
 * The layout of a written document and the YAML profile are not decided by the
 * owner (the contract's open item 1). The layout chosen here is the simplest
 * readable one and is provisional: block mappings, two-space indent, the stamp
 * first, `tags` and the colours in flow style, one frame per list entry.
 */

import {
  Document,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";
import { readDocument } from "./document.ts";
import { applySplices, rangeOf, scalarText, type Splice } from "./splice.ts";
import { parseVersion } from "./version.ts";

export const CLIP_CONTRACT = "animation-clip";
export const CLIP_VERSION = "1.0.0-pre.1";

/** A colour: red, green and blue, each a whole number from 0 to 255. There is no alpha. */
export type ClipColour = { readonly r: number; readonly g: number; readonly b: number };

export type ClipFrame = {
  /** The ID of an image asset, or a tile reference spelled with the tileset's ID. */
  readonly image: string;
  /** The ID of a sound asset. Absent means no sound. */
  readonly sound?: string;
  /** This frame's own colour key; it wins over the clip's. */
  readonly colourKey?: ClipColour;
};

/** Anything the free-form `metadata` may hold: JSON values. */
export type ClipJson = null | boolean | number | string | readonly ClipJson[] | { readonly [key: string]: ClipJson };

export type Clip = {
  readonly contract: typeof CLIP_CONTRACT;
  /** The stamp's version as written, with any `+build` suffix. */
  readonly version: string;
  readonly tags?: readonly string[];
  readonly metadata?: { readonly [key: string]: ClipJson };
  readonly canvas: { readonly width: number; readonly height: number };
  /** Seconds between one frame and the next, zero or more. */
  readonly delay: number;
  readonly colourKey?: ClipColour;
  readonly frames: readonly ClipFrame[];
};

/** Why a document, model or edit is refused. */
export type ClipProblem = {
  /** `stamp`: the document's stamp; `shape`: the rest of the contract; `edit`: an edit that cannot be made. */
  readonly kind: "stamp" | "shape" | "edit";
  /** Where, for example `frames[1].image`; `(document)` for the whole document. */
  readonly path: string;
  /** What is wrong, in words. */
  readonly message: string;
  /** 1-based line in the text, or `null` when there is none. */
  readonly line: number | null;
};

export type ClipReadResult =
  | { readonly ok: true; readonly clip: Clip }
  | { readonly ok: false; readonly problems: readonly ClipProblem[] };

export type ClipWriteResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly ClipProblem[] };

type PathSegment = string | number;
export type ClipPath = readonly PathSegment[];

export function formatClipPath(path: ClipPath): string {
  if (path.length === 0) return "(document)";
  return path.reduce<string>((text, segment) => (typeof segment === "number" ? `${text}[${segment}]` : text === "" ? segment : `${text}.${segment}`), "");
}

/** One line per problem, for an error message or a command's output. */
export function formatClipProblems(problems: readonly ClipProblem[]): string {
  return problems.map((problem) => `${problem.path}${problem.line === null ? "" : ` (line ${problem.line})`}: ${problem.message}`).join("\n");
}

// ---------------------------------------------------------------- validation

type Raw = { readonly path: ClipPath; readonly message: string };

/** The schema's reference pattern: one non-empty line with no space at either end. */
const REFERENCE = /^\S(?:[^\r\n]*\S)?$/;

const ROOT_KEYS = ["contract", "version", "tags", "metadata", "canvas", "delay", "colourKey", "frames"] as const;
const FRAME_KEYS = ["image", "sound", "colourKey"] as const;
const CANVAS_KEYS = ["width", "height"] as const;
const COLOUR_KEYS = ["r", "g", "b"] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  if (typeof value === "string") return "text";
  return typeof value === "number" ? `the number ${value}` : `a ${typeof value}`;
}

/** The contract allows no `null`: an absent value is written by leaving the key out (rule 10). */
function wrongType(path: ClipPath, wanted: string, value: unknown, out: Raw[]): void {
  const extra = value === null || value === undefined ? `; it is ${describe(value)}, and no key accepts that: leave the key out` : `; it is ${describe(value)}`;
  out.push({ path, message: `must be ${wanted}${extra}` });
}

function checkKeys(value: Record<string, unknown>, known: readonly string[], path: ClipPath, owner: string, out: Raw[]): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) out.push({ path: [...path, key], message: `\`${key}\` is not a key of ${owner}; the contract is closed` });
  }
}

function required(value: Record<string, unknown>, key: string, path: ClipPath, out: Raw[]): boolean {
  if (Object.hasOwn(value, key)) return true;
  out.push({ path, message: `\`${key}\` is required` });
  return false;
}

function checkColour(value: unknown, path: ClipPath, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, "a colour: a mapping of r, g and b", value, out);
  checkKeys(value, COLOUR_KEYS, path, "a colour", out);
  for (const key of COLOUR_KEYS) {
    if (!required(value, key, path, out)) continue;
    const part = value[key];
    if (typeof part !== "number" || !Number.isInteger(part) || part < 0 || part > 255) {
      wrongType([...path, key], "a whole number from 0 to 255", part, out);
    }
  }
}

function checkReference(value: unknown, path: ClipPath, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, "text: an asset ID", value, out);
  if (value === "") out.push({ path, message: "is empty text, which is not accepted; leave the key out for no value" });
  else if (!REFERENCE.test(value)) out.push({ path, message: "must be one line with no space at either end" });
}

function checkFrame(value: unknown, path: ClipPath, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, "a frame: a mapping with an image", value, out);
  checkKeys(value, FRAME_KEYS, path, "a frame", out);
  if (required(value, "image", path, out)) checkReference(value.image, [...path, "image"], out);
  if (Object.hasOwn(value, "sound")) checkReference(value.sound, [...path, "sound"], out);
  if (Object.hasOwn(value, "colourKey")) checkColour(value.colourKey, [...path, "colourKey"], out);
}

/** Whether `value` is something the free-form `metadata` may hold. */
function isClipJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every(isClipJson);
  if (!isObject(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  return Object.values(value).every(isClipJson);
}

/** Every rule the contract page gives for the document's content, on the JSON form of a document. */
function validateValue(value: unknown): Raw[] {
  const out: Raw[] = [];
  if (!isObject(value)) {
    wrongType([], "a mapping of keys to values", value, out);
    return out;
  }
  checkKeys(value, ROOT_KEYS, [], "the animation clip contract", out);

  if (required(value, "contract", [], out) && value.contract !== CLIP_CONTRACT) {
    out.push({ path: ["contract"], message: `must be \`${CLIP_CONTRACT}\`` });
  }
  if (required(value, "version", [], out)) {
    const version = value.version;
    const parsed = typeof version === "string" ? parseVersion(version) : null;
    if (typeof version !== "string") wrongType(["version"], "text in the version form", version, out);
    else if (parsed === null || !parsed.ok) out.push({ path: ["version"], message: parsed !== null && !parsed.ok ? parsed.reason : "is not a version" });
    else if (parsed.major !== "1" || parsed.minor !== "0" || parsed.patch !== "0" || parsed.pre !== "1") {
      out.push({ path: ["version"], message: `\`${version}\` is not a version this reader knows; it reads ${CLIP_VERSION} (a \`+build\` suffix is allowed)` });
    }
  }

  if (Object.hasOwn(value, "tags")) {
    const tags = value.tags;
    if (!Array.isArray(tags)) wrongType(["tags"], "a list of non-empty text", tags, out);
    else {
      tags.forEach((tag: unknown, index) => {
        if (typeof tag !== "string" || tag === "") wrongType(["tags", index], "non-empty text", tag, out);
      });
    }
  }
  if (Object.hasOwn(value, "metadata")) {
    const metadata = value.metadata;
    if (!isObject(metadata)) wrongType(["metadata"], "a mapping", metadata, out);
    else if (!isClipJson(metadata)) out.push({ path: ["metadata"], message: "may hold only text, numbers, booleans, null, lists and mappings" });
  }

  if (required(value, "canvas", [], out)) {
    const canvas = value.canvas;
    if (!isObject(canvas)) wrongType(["canvas"], "a mapping of width and height", canvas, out);
    else {
      checkKeys(canvas, CANVAS_KEYS, ["canvas"], "the canvas", out);
      for (const key of CANVAS_KEYS) {
        if (!required(canvas, key, ["canvas"], out)) continue;
        const size = canvas[key];
        if (typeof size !== "number" || !Number.isInteger(size) || size < 1) wrongType(["canvas", key], "a whole number of pixels, at least 1", size, out);
      }
    }
  }
  if (required(value, "delay", [], out)) {
    const delay = value.delay;
    if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
      wrongType(["delay"], "a finite number of seconds, zero or more", delay, out);
    }
  }
  if (Object.hasOwn(value, "colourKey")) checkColour(value.colourKey, ["colourKey"], out);

  if (required(value, "frames", [], out)) {
    const frames = value.frames;
    if (!Array.isArray(frames)) wrongType(["frames"], "a list of frames", frames, out);
    else if (frames.length === 0) out.push({ path: ["frames"], message: "must list at least one frame" });
    else frames.forEach((frame: unknown, index) => checkFrame(frame, ["frames", index], out));
  }
  return out;
}

function toProblems(raw: readonly Raw[], lineOf: (path: ClipPath) => number | null): ClipProblem[] {
  return raw.map((problem) => ({ kind: "shape", path: formatClipPath(problem.path), message: problem.message, line: lineOf(problem.path) }));
}

/** Check a clip model, for example one an importer made, against every rule of the contract; nothing is written. */
export function checkClip(clip: unknown): readonly ClipProblem[] {
  return toProblems(validateValue(clip), () => null);
}

// ---------------------------------------------------------------- reading

/** 1-based line of the place `path` names in a parsed document, or `null` when it cannot be found. */
function lineLocator(document: Document.Parsed, lines: LineCounter): (path: ClipPath) => number | null {
  return (path) => {
    let node: unknown = document.contents;
    let anchor: number | null = null;
    for (const segment of path) {
      if (isMap(node)) {
        const pair = node.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === segment);
        if (pair === undefined) break;
        const key = pair.key as Node;
        anchor = key.range === undefined || key.range === null ? anchor : key.range[0];
        node = pair.value;
      } else if (isSeq(node) && typeof segment === "number") {
        node = node.items[segment];
        const range = (node as Node | undefined)?.range;
        anchor = range === undefined || range === null ? anchor : range[0];
      } else break;
    }
    return anchor === null ? null : lines.linePos(anchor).line;
  };
}

/**
 * Read a clip document. A missing, repeated, malformed or not-first stamp is
 * refused first, by the stamp rules of `readDocument`, and nothing else in the
 * document is judged until the stamp is good; then every rule of the contract
 * page is checked and every problem found is reported.
 */
export function readClip(text: string): ClipReadResult {
  const stamp = readDocument({ path: "(clip)", text }, []);
  if (stamp.stampReports.length > 0) {
    return {
      ok: false,
      problems: stamp.stampReports.map((report) => ({
        kind: "stamp",
        path: report.key ?? "(document)",
        message: report.problem === "unreadable" ? `document unreadable: ${report.reason}` : `stamp ${report.problem}: ${report.reason}`,
        line: report.line,
      })),
    };
  }

  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  if (document.errors.length > 0) {
    return {
      ok: false,
      problems: document.errors.map((error) => ({
        kind: "shape",
        path: "(document)",
        message: `YAML error: ${error.message.split("\n")[0]!.replace(/:$/, "")}`,
        line: error.linePos?.[0]?.line ?? null,
      })),
    };
  }
  const value: unknown = document.toJS();
  const raw = validateValue(value);
  if (raw.length > 0) return { ok: false, problems: toProblems(raw, lineLocator(document, lines)) };
  return { ok: true, clip: value as Clip };
}

// ---------------------------------------------------------------- writing

function ordered(clip: Clip): Record<string, unknown> {
  const frame = (source: ClipFrame): Record<string, unknown> => ({
    image: source.image,
    ...(source.sound === undefined ? {} : { sound: source.sound }),
    ...(source.colourKey === undefined ? {} : { colourKey: colourOf(source.colourKey) }),
  });
  return {
    contract: clip.contract,
    version: clip.version,
    ...(clip.tags === undefined ? {} : { tags: [...clip.tags] }),
    ...(clip.metadata === undefined ? {} : { metadata: clip.metadata }),
    canvas: { width: clip.canvas.width, height: clip.canvas.height },
    delay: clip.delay,
    ...(clip.colourKey === undefined ? {} : { colourKey: colourOf(clip.colourKey) }),
    frames: clip.frames.map(frame),
  };
}

const colourOf = (colour: ClipColour): ClipColour => ({ r: colour.r, g: colour.g, b: colour.b });

/**
 * Write a clip as YAML text, the same text for the same clip. The model is
 * checked first with the reader's own rules, so a clip that comes back `ok` is
 * one `readClip` accepts; a model the contract refuses is returned as problems
 * and no text is made.
 */
export function writeClip(clip: Clip): ClipWriteResult {
  const problems = checkClip(clip);
  if (problems.length > 0) return { ok: false, problems };

  const document = new Document(ordered(clip), { version: "1.2", schema: "core" });
  const root = document.contents as YAMLMap;
  const flow = (node: unknown): void => {
    if ((isMap(node) || isSeq(node)) && node.flow !== true) node.flow = true;
  };
  flow(root.get("tags", true));
  flow(root.get("colourKey", true));
  const frames = root.get("frames", true);
  if (isSeq(frames)) {
    for (const frame of frames.items) if (isMap(frame)) flow(frame.get("colourKey", true));
  }
  return { ok: true, text: document.toString({ lineWidth: 0, flowCollectionPadding: false }) };
}

// ---------------------------------------------------------------- editing

export type ClipEditValue = string | number | ClipColour;

export type ClipEditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly ClipProblem[] };

/** What `plan*` return instead of splices when an edit cannot be made. */
type EditError = { readonly error: string };

const KEY_ORDER: Readonly<Record<string, readonly string[]>> = { "": ROOT_KEYS, frame: FRAME_KEYS, canvas: CANVAS_KEYS, colour: COLOUR_KEYS };

function containerKind(path: ClipPath): string {
  if (path.length === 0) return "";
  if (path.length === 2 && path[0] === "frames") return "frame";
  if (path.length === 1 && path[0] === "canvas") return "canvas";
  if (path.at(-1) === "colourKey") return "colour";
  return "other";
}

type Context = { readonly text: string; readonly document: Document.Parsed; readonly lines: LineCounter };

/** The offset just past the last character of a pair's value, before any comment. */
function pairEnd(pair: Pair): number {
  const value = pair.value as Node | null;
  if (value === null || value === undefined) return rangeOf(pair.key as Node)[1];
  return nodeEnd(value);
}

function nodeEnd(node: Node): number {
  if ((isMap(node) || isSeq(node)) && node.flow !== true) {
    const last = node.items.at(-1);
    if (last === undefined) return rangeOf(node)[1];
    return isMap(node) ? pairEnd(last as Pair) : nodeEnd(last as Node);
  }
  return rangeOf(node)[1];
}

const colourText = (colour: ClipColour): string => `{r: ${colour.r}, g: ${colour.g}, b: ${colour.b}}`;

const valueText = (value: ClipEditValue): string => (typeof value === "object" ? colourText(value) : scalarText(value, null));

function planReplace(context: Context, node: unknown, value: string | number): Splice[] | EditError {
  if (!isScalar(node) || node.type === "BLOCK_FOLDED" || node.type === "BLOCK_LITERAL") return { error: "the value is not a one-line scalar, so it cannot be replaced in place" };
  const [start, end] = rangeOf(node);
  if (context.text.slice(start, end).includes("\n")) return { error: "the value runs over more than one line, so it cannot be replaced in place" };
  return [{ start, end, text: scalarText(value, node) }];
}

function planInsert(context: Context, parent: YAMLMap, parentPath: ClipPath, key: string, value: ClipEditValue): Splice[] | EditError {
  const { text, lines } = context;
  const last = parent.items.at(-1);
  if (last === undefined) return { error: "the mapping is empty, and where its first entry goes is not decided" };
  const order = KEY_ORDER[containerKind(parentPath)] ?? [];
  const rank = order.indexOf(key);
  const names = parent.items.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : ""));
  // The new entry follows the last entry that precedes it in the contract's key order,
  // or the last entry when the key has no place in that order.
  let after = last;
  if (rank >= 0) {
    const before = parent.items.filter((_, index) => {
      const at = order.indexOf(names[index]!);
      return at >= 0 && at < rank;
    });
    if (before.length === 0) return { error: `there is no entry for \`${key}\` to follow` };
    after = before.at(-1)!;
  }
  const end = pairEnd(after);
  const entry = `${scalarText(key, null)}: ${valueText(value)}`;
  if (parent.flow === true) return [{ start: end, end, text: `, ${entry}` }];

  const first = parent.items[0]!.key as Node;
  const indent = " ".repeat(lines.linePos(rangeOf(first)[0]).col - 1);
  const newline = text.indexOf("\n", end);
  const crlf = newline > 0 && text[newline - 1] === "\r";
  const at = newline < 0 ? text.length : crlf ? newline - 1 : newline;
  return [{ start: at, end: at, text: `${crlf ? "\r\n" : "\n"}${indent}${entry}` }];
}

function planSet(context: Context, path: ClipPath, value: ClipEditValue): Splice[] | EditError {
  const parentPath = path.slice(0, -1);
  const last = path.at(-1);
  if (last === undefined) return { error: "an edit names a place in the document" };
  const parent: unknown = context.document.getIn(parentPath, true);
  if (isSeq(parent)) {
    if (typeof last !== "number" || last < 0 || last >= parent.items.length) return { error: "there is no such list entry; adding or removing list entries is not an edit this reader makes" };
    if (typeof value === "object") return { error: "a colour is set on a key, not on a list entry" };
    return planReplace(context, parent.items[last], value);
  }
  if (!isMap(parent) || typeof last !== "string") return { error: "there is no such place in the document" };
  const pair = parent.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === last);
  if (pair === undefined) return planInsert(context, parent, parentPath, last, value);

  const existing = pair.value as Node | null;
  if (typeof value === "object") {
    if (!isMap(existing)) return { error: "the colour is not a mapping of r, g and b, so it cannot be set in place" };
    const parts: Splice[] = [];
    for (const channel of COLOUR_KEYS) {
      const plan = planSet(context, [...path, channel], value[channel]);
      if (!Array.isArray(plan)) return plan;
      parts.push(...plan);
    }
    return parts;
  }
  return planReplace(context, existing, value);
}

function planRemove(context: Context, path: ClipPath): Splice[] | EditError {
  const parentPath = path.slice(0, -1);
  const last = path.at(-1);
  const parent: unknown = context.document.getIn(parentPath, true);
  if (!isMap(parent) || typeof last !== "string") return { error: "only a key of a mapping can be removed" };
  const index = parent.items.findIndex((candidate) => isScalar(candidate.key) && candidate.key.value === last);
  if (index < 0) return { error: "there is no such key to remove" };
  const pair = parent.items[index]!;
  const { text } = context;
  const keyStart = rangeOf(pair.key as Node)[0];
  const end = pairEnd(pair);

  if (parent.flow === true) {
    const previous = parent.items[index - 1];
    const next = parent.items[index + 1];
    if (previous !== undefined) return [{ start: pairEnd(previous), end, text: "" }];
    if (next !== undefined) return [{ start: keyStart, end: rangeOf(next.key as Node)[0], text: "" }];
    return [{ start: keyStart, end, text: "" }];
  }
  const lineStart = text.lastIndexOf("\n", keyStart - 1) + 1;
  if (text.slice(lineStart, keyStart).trim() !== "") return { error: "the key shares its line with another entry, so removing its line is not supported" };
  const newline = text.indexOf("\n", end);
  return [{ start: lineStart, end: newline < 0 ? text.length : newline + 1, text: "" }];
}

function applyEdit(text: string, plan: (context: Context) => Splice[] | EditError, path: ClipPath): ClipEditResult {
  const before = readClip(text);
  if (!before.ok) return before;
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const splices = plan({ text, document, lines });
  if (!Array.isArray(splices)) return { ok: false, problems: [{ kind: "edit", path: formatClipPath(path), message: (splices as EditError).error, line: null }] };

  const edited = applySplices(text, splices);
  const after = readClip(edited);
  if (!after.ok) {
    return { ok: false, problems: after.problems.map((problem) => ({ ...problem, message: `the edit would leave a document the reader refuses: ${problem.message}` })) };
  }
  return { ok: true, text: edited };
}

/**
 * Set one property of an existing clip document in place. Only the text of the
 * value changes: a replaced value is a splice into the original text, so every
 * other byte, every comment and the spacing in front of a trailing comment stay
 * as written. Setting a key that is absent adds one line (or one `, key: value`
 * in a flow mapping) after the entry that precedes it in the contract's key
 * order. A colour is set through its three parts. A document the reader refuses
 * is not edited, and an edit that would leave one is not made.
 */
export function setClipProperty(text: string, path: ClipPath, value: ClipEditValue): ClipEditResult {
  return applyEdit(text, (context) => planSet(context, path, value), path);
}

/** Remove one optional key, with its line and any comment on that line. Required keys cannot be removed: the result would be refused. */
export function removeClipProperty(text: string, path: ClipPath): ClipEditResult {
  return applyEdit(text, (context) => planRemove(context, path), path);
}
