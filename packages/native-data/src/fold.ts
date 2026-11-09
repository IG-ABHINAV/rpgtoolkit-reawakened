/**
 * ID folding (docs/spec/formats/native-contracts.md#identity, rules 1 and 2).
 *
 * Folding is ASCII only: the letters A to Z become a to z and every other
 * character compares as written. The locale and the Unicode case tables never
 * take part, so `É` and `é` stay different and the answer is the same on every
 * engine (G3). `String.prototype.toLowerCase` is deliberately not used.
 */
export function foldId(id: string): string {
  return id.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** Code-unit order, so every report list is the same on every machine. */
export function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
