#!/usr/bin/env node
// Classify every decoder refusal in the #1771 research ledger for #1772.
//
//   node tools/research/decode-gaps.mjs [--json]
//
// Reads docs/findings/native-data-boundaries/data/assets.jsonl, groups every
// record whose decode.status is `decode-failed` by (format, normalised
// diagnostic) — the same grouping the report in
// docs/findings/native-data-boundaries/decode-gaps.md uses — and assigns each
// group one of the four classes the issue requires:
//
//   documented-unsupported-version      the reader refuses by an owner-ruled scope
//   damaged-or-truncated-capture        the bytes themselves are cut or misfiled
//   missing-clean-room-format-evidence  the bytes are systematic but docs do not
//                                       record the shape yet (docs PR first, G7)
//   implementation-defect               the reader contradicts docs/spec
//
// Exits 1 if any group is left unclassified, so the rules have to be extended
// whenever a new diagnostic appears in the ledger.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const ledgerPath = join(repoRoot, "docs", "findings", "native-data-boundaries", "data", "assets.jsonl");

const CLASSES = [
  "documented-unsupported-version",
  "damaged-or-truncated-capture",
  "missing-clean-room-format-evidence",
  "implementation-defect",
];

/** (format, normalised message) -> class, with the evidence that decides it. */
const RULES = [
  // Owner-ruled scope: Toolkit 1 single tiles carry no reader (R-24).
  {
    format: "single-tile",
    pattern: /^single tile version .* is out of scope for the first release/,
    cls: "documented-unsupported-version",
    why: "docs/spec/formats/legacy/text-formats.md#single-tile-version-1-toolkit-1 (R-24) records v1 as evidence-backed with no reader",
  },
  // The bytes are cut inside a field or carry another format's magic.
  {
    format: "board",
    pattern: /^unexpected end of data reading /,
    cls: "damaged-or-truncated-capture",
    why: "binary board cut inside an i16/i32 field: no line or record boundary can explain a 0/1-byte remainder",
  },
  {
    format: "gam",
    pattern: /^unexpected end of data reading /,
    cls: "damaged-or-truncated-capture",
    why: "binary main file cut inside a primitive field",
  },
  {
    format: "tile-animation",
    pattern: /^unterminated string: no NUL before end of data/,
    cls: "damaged-or-truncated-capture",
    why: "binary string with no NUL before EOF: the payload is cut",
  },
  {
    format: "board",
    pattern: /^not a board: magic is/,
    cls: "damaged-or-truncated-capture",
    why: "misfiled capture: the bytes are a battle background (RPGTLKIT BKG) under a .brd name",
  },
  {
    format: "battle-background",
    pattern: /^not a battle background: magic is/,
    cls: "damaged-or-truncated-capture",
    why: "misfiled capture: the bytes are a board (RPGTLKIT BOARD) under a .bkg name",
  },
  {
    format: "gam",
    pattern: /^not a main file: magic is/,
    cls: "damaged-or-truncated-capture",
    why: "misfiled capture: the bytes are a battle background under a .gam name",
  },
  {
    format: "single-tile",
    pattern: /^not a single tile: header is "RPGTLKIT BOARD"/,
    cls: "damaged-or-truncated-capture",
    why: "misfiled capture: the bytes are a board under a .gph name",
  },
  {
    format: "single-tile",
    pattern: /^empty single-tile file$/,
    cls: "damaged-or-truncated-capture",
    why: "non-zero byte count but no non-blank line: the capture carries no payload",
  },
  {
    format: "single-tile",
    pattern: /^truncated single tile header/,
    cls: "damaged-or-truncated-capture",
    why: "the five-line header is cut after the fourth line",
  },
  // Undocumented value forms and undocumented shapes: docs have to record them
  // before any reader may accept them (G7).
  {
    format: "board",
    pattern: /^invalid integer for registrationFlag \("UNREGD"\) at line N$/,
    cls: "missing-clean-room-format-evidence",
    why: "docs record the flag as ignored but only show decimal values; UNREGD appears in 323 files and nowhere in docs/",
  },
  {
    format: "board",
    pattern: /^the tile matrix would hold /,
    cls: "missing-clean-room-format-evidence",
    why: "the 4,194,304-cell guard is cited against a docs section that does not state the limit",
  },
  {
    format: "enemy",
    pattern: /^empty line reading integer (ai|useCode) at line N$/,
    cls: "missing-clean-room-format-evidence",
    why: "an empty integer at the documented line is a value form the corpus writes but docs do not record",
  },
  {
    format: "character",
    pattern: /^invalid integer for smYN \(/,
    cls: "missing-clean-room-format-evidence",
    why: "a special-move name sits in the smYN slot: an undocumented extra/shifted line, not decidable without the bytes",
  },
  {
    format: "animation",
    pattern: /^invalid float for delay \(/,
    cls: "missing-clean-room-format-evidence",
    why: "a comma decimal separator where docs show point/exponent forms only",
  },
  {
    format: "tileset",
    pattern: /^unknown tileset version /,
    cls: "missing-clean-room-format-evidence",
    why: "version 20562 is 0x5052 ('RP' of an RPGTLKIT header) and 2573 is 0x0A0D (CRLF): these are text tilesets, and no text .tst layout exists in docs/",
  },
  // Every text-form EOF: the file stops on a documented field boundary. The
  // failures cluster on exact line numbers (all 104 enemies stop at line 359,
  // all 48 backgrounds at line 218), which random truncation does not produce,
  // so these are systematic short variants that docs do not record yet.
  {
    format: "item",
    pattern: /^unexpected end of file reading /,
    cls: "missing-clean-room-format-evidence",
    why: "stops on a documented line boundary (241 files at the same line); docs describe the tail as always present",
  },
  {
    format: "enemy",
    pattern: /^unexpected end of file reading /,
    cls: "missing-clean-room-format-evidence",
    why: "all 104 files stop at line 359, immediately before the four documented animation lines",
  },
  {
    format: "special-move",
    pattern: /^unexpected end of file reading /,
    cls: "missing-clean-room-format-evidence",
    why: "stops at line 10, 11 or 12 of the documented 13-line layout",
  },
  {
    format: "character",
    pattern: /^unexpected end of file reading /,
    cls: "missing-clean-room-format-evidence",
    why: "stops inside the documented trailing 29-line block",
  },
  {
    format: "battle-background",
    pattern: /^unexpected end of file reading /,
    cls: "missing-clean-room-format-evidence",
    why: "all 48 files stop at line 218, immediately before the documented 627-line tint block",
  },
  {
    format: "gam",
    pattern: /^unexpected end of file reading /,
    cls: "missing-clean-room-format-evidence",
    why: "stops inside rows 1-31, which docs say are always present",
  },
];

const normalise = (message) => message.replace(/\d+/g, "N");

function classify(format, message) {
  const norm = normalise(message);
  const hit = RULES.find((rule) => rule.format === format && rule.pattern.test(norm));
  return hit;
}

function main() {
  const asJson = process.argv.includes("--json");
  const records = readFileSync(ledgerPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

  const groups = new Map();
  let failed = 0;
  for (const record of records) {
    const decode = record.decode;
    if (decode === null || decode.status !== "decode-failed") continue;
    failed += 1;
    const key = `${decode.format}\u0000${normalise(decode.error.message)}`;
    const group = groups.get(key) ?? {
      format: decode.format,
      message: normalise(decode.error.message),
      section: decode.error.section,
      count: 0,
      example: record.id,
    };
    group.count += 1;
    groups.set(key, group);
  }

  const rows = [...groups.values()].sort((a, b) => b.count - a.count || a.format.localeCompare(b.format));
  const unclassified = [];
  const totals = Object.fromEntries(CLASSES.map((cls) => [cls, 0]));
  for (const row of rows) {
    const hit = classify(row.format, row.message);
    if (hit === undefined) {
      row.cls = "UNCLASSIFIED";
      unclassified.push(row);
      continue;
    }
    row.cls = hit.cls;
    row.why = hit.why;
    totals[hit.cls] += row.count;
  }

  const classified = rows.reduce((sum, row) => sum + (row.cls === "UNCLASSIFIED" ? 0 : row.count), 0);

  if (asJson) {
    console.log(JSON.stringify({ failed, groups: rows, totals, unclassified: unclassified.length }, null, 2));
  } else {
    console.log(`ledger records: ${records.length}`);
    console.log(`decode-failed:  ${failed}`);
    console.log(`groups:         ${rows.length}`);
    console.log("");
    for (const row of rows) {
      console.log(`${String(row.count).padStart(5)}  ${row.cls.padEnd(34)} ${row.format.padEnd(17)} ${row.message}`);
    }
    console.log("");
    for (const cls of CLASSES) console.log(`${String(totals[cls]).padStart(5)}  ${cls}`);
    if (unclassified.length > 0) {
      console.error("\nUNCLASSIFIED groups (extend RULES in tools/research/decode-gaps.mjs):");
      for (const row of unclassified) console.error(`  ${row.count} ${row.format}: ${row.message}`);
    }
  }

  if (classified !== failed || unclassified.length > 0) {
    console.error(`classified ${classified} of ${failed} refusals`);
    process.exit(1);
  }
}

main();
