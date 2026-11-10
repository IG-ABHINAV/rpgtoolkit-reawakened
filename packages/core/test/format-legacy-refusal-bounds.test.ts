// Decode-gap bounds for #1772 (docs/findings/native-data-boundaries/decode-gaps.md).
//
// Two claims are pinned here against the real readers:
//   1. A docs-conformant legacy text file decodes, so the 1,200 census refusals
//      are not reader drift against docs/spec/formats/legacy/text-formats.md.
//   2. Removing only the documented trailing lines (or writing one undocumented
//      value form) reproduces the exact diagnostic the census recorded for that
//      group, which is what the classification in the findings report rests on.
import { test } from "node:test";
import { equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BinaryReader,
  readBattleBackground,
  readBoard,
  readEnemy,
  readItem,
  readSpecialMove,
} from "../src/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const example = (...parts: string[]): string =>
  join(repoRoot, "docs", "spec", "examples", "versions", ...parts);

type Decode = { ok: boolean; message: string };

/** Lines of a committed text example, without a trailing empty entry. */
function linesOf(file: string): string[] {
  const bytes = new Uint8Array(readFileSync(file));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function bytesOf(lines: string[]): Uint8Array {
  const text = lines.join("\r\n") + "\r\n";
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function outcome(result: { ok: boolean; error?: { message: string } }): Decode {
  if (result.ok) return { ok: true, message: "" };
  return { ok: false, message: result.error?.message ?? "unknown error" };
}

function decodeItem(lines: string[]): Decode {
  return outcome(readItem(new BinaryReader(bytesOf(lines), "fixture.itm")));
}

function decodeEnemy(lines: string[]): Decode {
  return outcome(readEnemy(new BinaryReader(bytesOf(lines), "fixture.ene")));
}

function decodeSpecial(lines: string[]): Decode {
  return outcome(readSpecialMove(new BinaryReader(bytesOf(lines), "fixture.spc")));
}

function decodeBackground(lines: string[]): Decode {
  return outcome(readBattleBackground(new BinaryReader(bytesOf(lines), "fixture.bkg")));
}

function decodeBoard(lines: string[]): Decode {
  return outcome(readBoard(new BinaryReader(bytesOf(lines), "fixture.brd")));
}

test("docs-conformant legacy text examples decode (reader/layout parity)", () => {
  const cases: [string, string][] = [
    ["item", "item_text_minor0.itm"],
    ["item", "item_text_minor1.itm"],
    ["enemy", "enemy_text.ene"],
    ["special-move", "special_text.spc"],
    ["fight-background", "background_text.bkg"],
  ];
  for (const [dir, name] of cases) {
    const lines = linesOf(example(dir, name));
    const decoded =
      dir === "item"
        ? decodeItem(lines)
        : dir === "enemy"
          ? decodeEnemy(lines)
          : dir === "special-move"
            ? decodeSpecial(lines)
            : decodeBackground(lines);
    equal(decoded.ok, true, `${name} should decode, got: ${decoded.message}`);
  }
});

test("item: dropping only the documented tail reproduces the census diagnostics", () => {
  const full = linesOf(example("item", "item_text_minor0.itm"));
  // item_text_minor0.itm ends description (line 1125), animation (line 1126).
  const missingAnimation = full.slice(0, full.length - 1);
  equal(decodeItem(missingAnimation).message, "unexpected end of file reading animation at line 1126");

  const missingTail = full.slice(0, full.length - 2);
  equal(decodeItem(missingTail).message, "unexpected end of file reading description at line 1125");
});

test("enemy: dropping the four documented animation lines reproduces the census diagnostic", () => {
  const full = linesOf(example("enemy", "enemy_text.ene"));
  equal(full.length, 363, "the documented text enemy is exactly 363 lines");

  const missingAnimations = full.slice(0, full.length - 4);
  equal(
    decodeEnemy(missingAnimations).message,
    "unexpected end of file reading FIGHT animation at line 360",
  );

  // An empty integer at the documented ai line is the second census group.
  const emptyAi = [...full];
  emptyAi[348] = "";
  equal(decodeEnemy(emptyAi).message, "empty line reading integer ai at line 349");

  const emptyUseCode = [...full];
  emptyUseCode[349] = "";
  equal(decodeEnemy(emptyUseCode).message, "empty line reading integer useCode at line 350");

  // The same file with a value in that slot decodes, so the refusal is caused
  // by the empty line alone and not by any later field.
  const aiZero = [...full];
  aiZero[348] = "0";
  equal(decodeEnemy(aiZero).ok, true);
});

test("special move: dropping the documented tail reproduces all three census groups", () => {
  const full = linesOf(example("special-move", "special_text.spc"));
  equal(full.length, 13, "the documented text special move is exactly 13 lines");

  equal(
    decodeSpecial(full.slice(0, 12)).message,
    "unexpected end of file reading description at line 13",
  );
  equal(
    decodeSpecial(full.slice(0, 11)).message,
    "unexpected end of file reading animation at line 12",
  );
  equal(
    decodeSpecial(full.slice(0, 10)).message,
    "unexpected end of file reading statusEffect at line 11",
  );
});

test("fight background: dropping the whole tint block reproduces the census diagnostic", () => {
  const full = linesOf(example("fight-background", "background_text.bkg"));
  equal(full.length, 845, "the documented text fight background is exactly 845 lines");

  const withoutTints = full.slice(0, 218);
  equal(
    decodeBackground(withoutTints).message,
    "unexpected end of file reading tint[0].r at line 219",
  );
});

test("board: the UNREGD registration token alone causes the refusal", () => {
  const unregd = decodeBoard(["RPGTLKIT BOARD", "2", "0", "UNREGD", "NOCODE"]);
  equal(unregd.message, 'invalid integer for registrationFlag ("UNREGD") at line 4');

  // The same file with the documented numeric flag gets past line 4 and stops
  // only because the fixture ends there (minor 0 stores no size lines, so the
  // first tile cell at line 6 is the next field).
  const numeric = decodeBoard(["RPGTLKIT BOARD", "2", "0", "0", "NOCODE"]);
  equal(numeric.message, "unexpected end of file reading tileName at line 6");
});

test("item: a full-picture text item without the documented tail stops at line 17493", () => {
  // 30 header lines (minor != 1 stores no sizeType line), 17 full pictures
  // (1024 lines each), usedBy, 50 allowed characters, buyPrice, sellPrice,
  // keyItem = 17492 lines; docs/spec/formats/legacy/text-formats.md#item then
  // requires description (line 17493) and animation (line 17494).
  const lines: string[] = ["RPGTLKIT ITEM", "2", "0", "Boat"];
  for (let i = 0; i < 4; i += 1) lines.push("0");
  for (let i = 0; i < 7; i += 1) lines.push("0");
  lines.push("");
  for (let i = 0; i < 4; i += 1) lines.push("0");
  lines.push("", "");
  lines.push("0", "0", "");
  lines.push("0", "0", "");
  lines.push("", "");
  equal(lines.length, 30, "the minor != 1 header is 30 lines");
  for (let picture = 0; picture < 17; picture += 1) {
    lines.push("1");
    for (let pixel = 1; pixel < 1024; pixel += 1) lines.push("0");
  }
  lines.push("0");
  for (let i = 0; i < 50; i += 1) lines.push("");
  lines.push("10", "5", "0");
  equal(lines.length, 17492);

  equal(decodeItem(lines).message, "unexpected end of file reading description at line 17493");

  // With the two documented trailing lines the same file decodes.
  lines.push("A boat", "boat.ani");
  equal(decodeItem(lines).ok, true);
});
