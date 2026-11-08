/**
 * The full RPGCode docs/spec/engine/rpgcode-language.md#lexical-rules tokenizer.
 *
 * Scans identifiers with sigils stripped and case-folded (LEX-10), numbers
 * (LEX-2), strings (LEX-8), operators and punctuation, line endings and EOF,
 * with 1-based line accounting on every token.
 *
 * docs/spec/engine/rpgcode-language.md#lexical-rules
 */

import type { IncludeRequest } from "./ast.ts";
import { ScriptError } from "./errors.ts";
import type { SourcePos } from "./ops.ts";
import { foldAscii } from "./values.ts";

export { foldAscii };

/** Compile-time constants from docs/spec/engine/rpgcode-language.md#e-87. */
const CONSTANTS: Readonly<Record<string, number>> = {
  tkmv_pause_thread: 1, tkmv_clear_queue: 2, tkmv_pathfind: 4,
  tkmv_waypoint_path: 8, tkmv_waypoint_link: 16,
  tkvt_solid: 1, tkvt_under: 2, tkvt_stairs: 8, tkvt_waypoint: 16,
  tkvt_bkgimage: 1, tkvt_all_layers_below: 2, tkvt_frame_intersect: 4,
  tkprg_step: 0, tkprg_keypress: 1, tkprg_repeat: 2, tkprg_stops_movement: 4,
  tkdir_e: 1, tkdir_se: 2, tkdir_s: 3, tkdir_sw: 4,
  tkdir_w: 5, tkdir_nw: 6, tkdir_n: 7, tkdir_ne: 8,
};

/**
 * One lexical token. `end` terminates a statement; `eof` ends the source.
 *
 * `col` and `endCol` are UTF-16 code units of the decoded source, 1-based and
 * inclusive: `col` is the first character, `endCol` the last. A token never
 * spans a line, so a range is one line's [col, endCol]. The CR of a CRLF does
 * not count, because it precedes the line break. A zero-width token (`end` on a
 * newline, `eof`) has `endCol === col`.
 */
export type Token =
  | { readonly kind: "identifier"; readonly name: string; readonly line: number; readonly col: number; readonly endCol: number }
  | { readonly kind: "number"; readonly value: number; readonly line: number; readonly col: number; readonly endCol: number }
  | { readonly kind: "string"; readonly value: string; readonly line: number; readonly col: number; readonly endCol: number }
  | { readonly kind: "op"; readonly text: string; readonly line: number; readonly col: number; readonly endCol: number }
  | { readonly kind: "end"; readonly line: number; readonly col: number; readonly endCol: number }
  | { readonly kind: "eof"; readonly line: number; readonly col: number; readonly endCol: number };

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentifierStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentifierChar(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

/**
 * The source position of one offending construct. `col` and `endCol` are
 * UTF-16 code units, 1-based and inclusive
 * (docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention), so a
 * diagnostic's range slices exactly the text it names.
 */
function pos(line: number, col: number, endCol: number): SourcePos {
  return { file: "", line, col, endCol };
}

/** Reject a construct the rebuild excludes, naming the entry that adds it. */
function unsupported(construct: string, entry: string, at: SourcePos): never {
  throw new ScriptError(
    "syntax.unsupported",
    `${construct} is not in the tracer's RPGCode subset; ${entry} adds it`,
    at,
  );
}

/** Reject malformed input (an unknown character, an unterminated string). */
function lexical(message: string, at: SourcePos): never {
  throw new ScriptError("syntax.error", message, at);
}

/** Refuse an identifier the spec or scope excludes, by name and entry. */
function rejectKeyword(name: string, at: SourcePos, allowObjects: boolean): void {
  switch (name) {
    case "break":
    case "continue":
      throw new ScriptError(
        "syntax.unsupported",
        `the \`${name}\` statement is not in the RPGCode 3.1 specification (docs/spec/engine/rpgcode-language.md#keywords-and-structure)`,
        at,
      );
    case "class":
    case "struct":
    case "var":
    case "public":
    case "private":
    case "this":
    case "new":
      if (allowObjects) return;
      unsupported(`the \`${name}\` class construct`, "entry 6", at);
      break;
    case "protected":
      unsupported(`the \`${name}\` class construct`, "entry 6", at);
      break;
    default:
      break;
  }
}

/** Whether only spaces, tabs or a `//` comment lie from `index` to the newline. */
function restIsBlank(text: string, index: number, length: number): boolean {
  let cursor = index;
  while (
    cursor < length &&
    (text[cursor] === " " || text[cursor] === "\t" || text[cursor] === "\r")
  ) {
    cursor++;
  }
  if (cursor < length && text[cursor] === "/" && text[cursor + 1] === "/") return true;
  return cursor >= length || text[cursor] === "\n";
}

const THREE_CHAR_OPS = ["<<=", ">>="];
const TWO_CHAR_OPS = [
  "==",
  "~=",
  "!=",
  "<=",
  ">=",
  "<<",
  ">>",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "^=",
  "&=",
  "|=",
  "`=",
  "++",
  "--",
  "&&",
  "||",
  "->",
  "::",
  "=>",
];
const SINGLE_CHAR_OPS = [
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ":",
  "?",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "&",
  "|",
  "`",
  "~",
  "!",
  "<",
  ">",
];

let allowObjects = false;
let includes: IncludeRequest[] = [];

/** Tokenize in the object-enabled dialect used by class-bearing programs. */
export function tokenizeObjects(text: string): Token[] {
  return scan(text, true).tokens;
}

export function tokenize(text: string): Token[] {
  return scan(text, false).tokens;
}

/**
 * Tokenize `text` and collect its literal `#include` lines, wherever they
 * appear (docs/spec/engine/rpgcode-modules-and-objects.md#includes).
 */
export function scan(
  text: string,
  objects: boolean,
): { readonly tokens: Token[]; readonly includes: IncludeRequest[] } {
  allowObjects = objects;
  includes = [];
  try {
    return { tokens: run(text), includes };
  } finally {
    allowObjects = false;
    includes = [];
  }
}

function run(text: string): Token[] {
  const tokens: Token[] = [];
  const length = text.length;
  let index = 0;
  let line = 1;
  let lineStart = 0;
  let firstNonBlankOnLine = true;

  while (index < length) {
    const ch = text[index]!;

    if (ch === " " || ch === "\t" || ch === "\r") {
      index++;
      continue;
    }

    if (ch === "\n") {
      const column = index - lineStart + 1;
      tokens.push({ kind: "end", line, col: column, endCol: column });
      index++;
      line++;
      lineStart = index;
      firstNonBlankOnLine = true;
      continue;
    }

    if (ch === ";") {
      const column = index - lineStart + 1;
      tokens.push({ kind: "end", line, col: column, endCol: column });
      index++;
      firstNonBlankOnLine = false;
      continue;
    }

    // Line comment //
    if (ch === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < length && text[index] !== "\n") index++;
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < length && !(text[index] === "*" && text[index + 1] === "/")) {
        if (text[index] === "\n") {
          line++;
          lineStart = index + 1;
        }
        index++;
      }
      if (index >= length) {
        // Positioned at the end of the source, where the missing `*/` was looked for.
        const column = index - lineStart + 1;
        lexical(
          "unterminated block comment; a `/* */` comment must end with `*/`",
          pos(line, column, column),
        );
      }
      index += 2;
      continue;
    }

    // Legacy comment ** anywhere on line
    if (ch === "*" && text[index + 1] === "*") {
      index += 2;
      while (index < length && text[index] !== "\n") index++;
      continue;
    }

    // Legacy comment * at start of non-blank line
    if (ch === "*" && firstNonBlankOnLine) {
      index++;
      while (index < length && text[index] !== "\n") index++;
      continue;
    }

    // Legacy # line (LEX-6)
    if (ch === "#" && firstNonBlankOnLine) {
      let lineEnd = index;
      while (lineEnd < length && text[lineEnd] !== "\n") lineEnd++;
      const lineText = text.slice(index, lineEnd);
      // The CR of a CRLF precedes the break and is not a column (TOOL-3).
      const endCol = lineEnd - lineStart - (text[lineEnd - 1] === "\r" ? 1 : 0);
      if (/^#\s*include\b/i.test(lineText)) {
        const named = /^#\s*include\s+"([^"\r]*)"/i.exec(lineText);
        if (named === null) {
          lexical(
            '`#include` needs a quoted file name, as in `#include "file.prg"` (MOD-1)',
            pos(line, index - lineStart + 1, endCol),
          );
        }
        includes.push({
          path: named[1]!,
          line,
          implicit: false,
          col: index - lineStart + 1,
          endCol,
        });
      }
      index = lineEnd;
      continue;
    }

    // String literal "..."
    if (ch === '"') {
      let cursor = index + 1;
      let value = "";
      while (cursor < length && text[cursor] !== '"' && text[cursor] !== "\n") {
        value += text[cursor]!;
        cursor++;
      }
      if (cursor >= length || text[cursor] !== '"') {
        const last = (cursor < length ? cursor : length) - lineStart;
        lexical(
          "unterminated string; a string is single-line and ends with `\"` (docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands LEX-8)",
          pos(line, index - lineStart + 1, Math.max(last, index - lineStart + 1)),
        );
      }
      tokens.push({ kind: "string", value, line, col: index - lineStart + 1, endCol: cursor + 1 - lineStart });
      index = cursor + 1;
      firstNonBlankOnLine = false;
      continue;
    }

    // Numbers or Identifiers
    if (isDigit(ch) || isIdentifierStart(ch)) {
      const start = index;

      if (isDigit(ch)) {
        let cursor = start;
        while (cursor < length && isDigit(text[cursor]!)) cursor++;
        if (cursor < length && text[cursor] === ".") {
          let fraction = cursor + 1;
          if (fraction < length && isDigit(text[fraction]!)) {
            while (fraction < length && isDigit(text[fraction]!)) fraction++;
            cursor = fraction;
          }
        }
        if (cursor < length && (text[cursor] === "e" || text[cursor] === "E")) {
          let exponent = cursor + 1;
          if (exponent < length && (text[exponent] === "+" || text[exponent] === "-")) exponent++;
          let digits = 0;
          while (exponent < length && isDigit(text[exponent]!)) {
            exponent++;
            digits++;
          }
          if (digits > 0) cursor = exponent;
        }
        if (cursor >= length || !isIdentifierChar(text[cursor]!)) {
          const literal = text.slice(start, cursor);
          const value = Number(literal);
          if (!Number.isFinite(value)) {
            lexical(
              `the number literal \`${literal}\` is not finite (docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands)`,
              pos(line, start - lineStart + 1, cursor - lineStart),
            );
          }
          tokens.push({ kind: "number", value, line, col: start - lineStart + 1, endCol: cursor - lineStart });
          index = cursor;
          firstNonBlankOnLine = false;
          continue;
        }
      }

      let end = start;
      while (end < length && isIdentifierChar(text[end]!)) end++;
      const nameEnd = end;

      // LEX-3: only `!` directly followed by `=` is the not-equal operator; a
      // `$` (or a `!` not followed by `=`) is a sigil and is ignored.
      if (end < length && text[end] === "!") {
        if (text[end + 1] !== "=") {
          end++;
        }
      } else if (end < length && text[end] === "$") {
        end++;
      }
      const name = foldAscii(text.slice(start, nameEnd));

      if (name === "true" || name === "false") {
        tokens.push({ kind: "number", value: name === "true" ? 1 : 0, line, col: start - lineStart + 1, endCol: end - lineStart });
      } else if (name === "null") {
        tokens.push({ kind: "number", value: 0, line, col: start - lineStart + 1, endCol: end - lineStart });
      } else if (Object.hasOwn(CONSTANTS, name)) {
        tokens.push({ kind: "number", value: CONSTANTS[name]!, line, col: start - lineStart + 1, endCol: end - lineStart });
      } else if (name === "and" || name === "or") {
        tokens.push({ kind: "op", text: name, line, col: start - lineStart + 1, endCol: end - lineStart });
      } else if (name === "_" && restIsBlank(text, end, length)) {
        // Line continuation: consume to newline, increment line, do not emit end
        let scan = end;
        while (scan < length && text[scan] !== "\n") scan++;
        if (scan < length && text[scan] === "\n") {
          scan++;
          line++;
          lineStart = scan;
        }
        index = scan;
        firstNonBlankOnLine = false; // continued line is not start of line (so * is multiply)
        continue;
      } else {
        rejectKeyword(name, pos(line, start - lineStart + 1, end - lineStart), allowObjects);
        tokens.push({ kind: "identifier", name, line, col: start - lineStart + 1, endCol: end - lineStart });
      }

      index = end;
      firstNonBlankOnLine = false;
      continue;
    }

    // Check operators / punctuation
    const sub3 = text.slice(index, index + 3);
    if (THREE_CHAR_OPS.includes(sub3)) {
      tokens.push({ kind: "op", text: sub3, line, col: index - lineStart + 1, endCol: index + 3 - lineStart });
      index += 3;
      firstNonBlankOnLine = false;
      continue;
    }

    const sub2 = text.slice(index, index + 2);
    if (TWO_CHAR_OPS.includes(sub2)) {
      if (sub2 === "->" || sub2 === "::") {
        if (!allowObjects) {
          unsupported(
            sub2 === "->" ? "the `->` member access operator" : "the `::` class scope operator",
            "entry 6",
            pos(line, index - lineStart + 1, index + 2 - lineStart),
          );
        }
      }
      tokens.push({ kind: "op", text: sub2, line, col: index - lineStart + 1, endCol: index + 2 - lineStart });
      index += 2;
      firstNonBlankOnLine = false;
      continue;
    }

    if (SINGLE_CHAR_OPS.includes(ch)) {
      tokens.push({ kind: "op", text: ch, line, col: index - lineStart + 1, endCol: index + 1 - lineStart });
      index += 1;
      firstNonBlankOnLine = false;
      continue;
    }

    // `.` joins a file name to a function (MOD-2) or spells object access (OOP-3).
    if (ch === ".") {
      tokens.push({ kind: "op", text: ".", line, col: index - lineStart + 1, endCol: index + 1 - lineStart });
      index += 1;
      firstNonBlankOnLine = false;
      continue;
    }
    if (ch === "@") {
      unsupported("the Toolkit 2.x `@` line", "entry 15", pos(line, index - lineStart + 1, index - lineStart + 1));
    }

    lexical(
      `unknown character ${JSON.stringify(ch)}; docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands (LEX-11) makes this a lexical error`,
      pos(line, index - lineStart + 1, index - lineStart + 1),
    );
  }

  const eofColumn = index - lineStart + 1;
  tokens.push({ kind: "eof", line, col: eofColumn, endCol: eofColumn });
  return tokens;
}
