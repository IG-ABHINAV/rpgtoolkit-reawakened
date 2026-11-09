/**
 * The in-place text edit shared by the clip editor and the rename planner: a change to a document
 * is a list of splices into its original text, so every byte outside the spliced ranges, every
 * comment and the spacing before a trailing comment stay as written. Nothing regenerates a
 * document from a parsed tree: `Document.toString()` does not print an unedited document back
 * byte for byte (the spacing before a trailing comment collapses, flow padding changes).
 *
 * Pure text in, text out: no file is touched (G2).
 */

import { Document, Scalar, type Node } from "yaml";

/** Replace `text.slice(start, end)` with `text`. Offsets are into the original text. */
export type Splice = { readonly start: number; readonly end: number; readonly text: string };

/** The `[start, valueEnd, nodeEnd]` offsets the YAML parser gives every parsed node. */
export function rangeOf(node: Node): readonly [number, number, number] {
  return node.range as readonly [number, number, number];
}

/**
 * One scalar written as YAML on one line, quoted only when plain text would read back as
 * something else. A replaced quoted scalar (`like`) keeps its quote style.
 */
export function scalarText(value: string | number, like: Scalar | null): string {
  const scalar = new Scalar(value);
  if (like !== null && typeof value === "string" && (like.type === "QUOTE_DOUBLE" || like.type === "QUOTE_SINGLE")) scalar.type = like.type;
  return new Document(scalar).toString({ lineWidth: 0 }).replace(/\n$/, "");
}

/** Apply splices to the text they were planned against. They must not overlap. */
export function applySplices(text: string, splices: readonly Splice[]): string {
  let edited = text;
  for (const splice of [...splices].sort((left, right) => right.start - left.start)) {
    edited = edited.slice(0, splice.start) + splice.text + edited.slice(splice.end);
  }
  return edited;
}
