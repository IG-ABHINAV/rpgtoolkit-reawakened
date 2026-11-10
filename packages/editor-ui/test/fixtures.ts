// The committed `.gam` examples and a by-hand oracle for "only the title changed", for the view tests. (The model's own
// tests keep a fuller copy; a package's tests cannot import another package's test files.)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const examples = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "main");

export function exampleMain(minor: number): Uint8Array {
  return new Uint8Array(readFileSync(join(examples, `main_minor${minor}.gam`)));
}

export function exampleTextMain(): Uint8Array {
  return new Uint8Array(readFileSync(join(examples, "main_tk2_text.gam")));
}

/** Two NUL-terminated strings (`registrationCode`, `projectPath`) follow the 20-byte header run; `gameTitle` is the third. */
function titleSpan(bytes: Uint8Array): { readonly start: number; readonly end: number } {
  const stringEnd = (from: number): number => {
    let at = from;
    while (bytes[at] !== 0) at += 1;
    return at;
  };
  const afterCode = stringEnd(14 + 6) + 1;
  const start = stringEnd(afterCode) + 1;
  return { start, end: stringEnd(start) };
}

export function withTitle(bytes: Uint8Array, title: string): Uint8Array {
  const { start, end } = titleSpan(bytes);
  return Uint8Array.from([...bytes.subarray(0, start), ...Uint8Array.from(title, (char) => char.charCodeAt(0)), ...bytes.subarray(end)]);
}

export function titleOf(bytes: Uint8Array): string {
  const { start, end } = titleSpan(bytes);
  return String.fromCharCode(...bytes.subarray(start, end));
}
