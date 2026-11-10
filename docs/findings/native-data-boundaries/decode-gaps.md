# Decode gaps: classification of the refused data files (#1772)

Investigation output for [#1772](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1772).
**No reader, spec page or generated ledger was changed.** This report classifies every
diagnostic group the research ledger records, states the evidence for each class, and
lists what each class needs next.

Reproduce the classification from the committed ledger:

```sh
node tools/research/decode-gaps.mjs          # table + totals, exits 1 on an unclassified group
node tools/research/decode-gaps.mjs --json   # machine-readable
node --test packages/core/test/format-legacy-refusal-bounds.test.ts
```

## Result

The ledger (`data/assets.jsonl`) holds 15,897 inventory records: 5,379 decoded,
4,294 screened sources, 51 zero-byte placeholders and **1,200 refusals** in 29
normalised diagnostic groups (39 distinct `format + message` pairs). The refusal
count and per-family breakdown match the scope note in the issue thread
(60 collection labels, 5,379 decoded, 1,200 refusals).

| Class | Refusals | Groups |
|---|---:|---:|
| documented unsupported version | 10 | 1 |
| damaged or truncated capture | 15 | 9 |
| missing clean-room format evidence | 1,175 | 19 |
| **implementation defect** | **0** | **0** |

## Why no implementation defect

A reader that contradicted `docs/spec/` would refuse files the docs describe as
well-formed. The ledger shows the opposite, twice over:

1. **Line arithmetic matches the docs.** Every refusal lands on the exact line the
   documented layout predicts for the *next* field: text enemy `ai` at 349 and
   `FIGHT` at 360 (`3 + 8 + 2 + 133 + 202 + 7 + 4 + 4`), text special move at
   11/12/13 of 13, text fight background `tint[0].r` at 219 of 845, text item
   description at 1125/1126 and at 17493 for a 17,492-line minor-0 file, text
   main file `extKey[0]` at 1031 and `registrationCode` at 1133, text character
   `levelUpProgram` second-to-last. The readers consume exactly the documented
   fields and nothing else.
2. **The docs-verified samples decode in the same run.** Caoquest's 16 text items,
   8 text special moves, 5 text fight backgrounds, 5 text enemies, 4 text
   characters, 17 text boards and `caoquest.gam` — the files the legacy-text spec
   pages were written from — all appear as `decoded` in the ledger. The readers
   therefore accept the documented layouts; the 1,200 refused files are not
   documented layouts.

`packages/core/test/format-legacy-refusal-bounds.test.ts` pins both facts: the
committed docs examples decode, and cutting only the documented tail (or writing
one undocumented token) reproduces the census diagnostic byte for byte.

## Classification of every group

Counts are ledger records. `N` stands for any decimal run in the message.

| # | Family | Group (normalised) | Files | Class | Evidence |
|---:|---|---|---:|---|---|
| 1 | board | `invalid integer for registrationFlag ("UNREGD") at line N` | 323 | missing evidence | docs record the flag as *ignored* (`legacy/text-formats.md#board-toolkit-2-text`) but show only decimal values; `UNREGD` occurs in 323 files across many collections and nowhere in `docs/` |
| 2 | item | `unexpected end of file reading description at line N` | 267 | missing evidence | 241 files stop at the same line of the 17,492-line minor-0 layout; the tail (`description`, `animation`) is documented as always present |
| 3 | enemy | `unexpected end of file reading FIGHT animation at line N` | 104 | missing evidence | all 104 stop at line 359, immediately before the four documented animation lines |
| 4 | enemy | `empty line reading integer ai at line N` | 77 | missing evidence | an empty integer in a documented slot; docs show `ai, useCode, prg, …` with no empty form |
| 5 | enemy | `empty line reading integer useCode at line N` | 67 | missing evidence | as above, next slot |
| 6 | special-move | `unexpected end of file reading statusEffect at line N` | 63 | missing evidence | file has 10 of the documented 13 lines |
| 7 | special-move | `unexpected end of file reading description at line N` | 61 | missing evidence | file has 12 of 13 lines |
| 8 | character | `unexpected end of file reading levelUpProgram at line N` | 57 | missing evidence | stops inside the documented trailing 29-line block (45,091-line minor-2 layout) |
| 9 | battle-background | `unexpected end of file reading tint[N].r at line N` | 48 | missing evidence | all 48 stop at line 218, immediately before the documented 627-line tint block |
| 10 | tileset | `unknown tileset version N: expected N (.tst) or N (.iso)` | 28 | missing evidence | 20562 = `0x5052` (`RP` of an `RPGTLKIT` header) and 2573 = `0x0A0D` (CRLF): these are text tilesets, and no text `.tst` layout exists in `docs/` |
| 11 | special-move | `unexpected end of file reading animation at line N` | 21 | missing evidence | file has 11 of 13 lines |
| 12 | item | `unexpected end of file reading keyItem at line N` | 21 | missing evidence | stops three lines before the documented end |
| 13 | item | `unexpected end of file reading animation at line N` | 14 | missing evidence | stops one line before the documented end |
| 14 | gam | `unexpected end of file reading extKey[N] at line N` | 12 | missing evidence | stops inside rows 1-31, which the spec says are always present |
| 15 | single-tile | `single tile version N (Toolkit N.x) is out of scope…` | 10 | documented unsupported | owner rule R-24: Toolkit 1 has no reader by design — preserve this boundary |
| 16 | gam | `unexpected end of file reading registrationCode at line N` | 6 | missing evidence | stops one line before the documented row 31 |
| 17 | board | `unexpected end of data reading iN: need N byte(s), N remain` | 4 | damaged/truncated | the binary board is cut inside a primitive field: no record boundary explains a 0/1-byte remainder |
| 18 | tile-animation | `unterminated string: no NUL before end of data` | 3 | damaged/truncated | binary string with no terminator before EOF |
| 19 | animation | `invalid float for delay (" N,N ") at line N` | 2 | missing evidence | comma decimal separator; docs show point/exponent forms only |
| 20 | gam | `unexpected end of file reading projectPath at line N` | 2 | missing evidence | stops inside the always-present rows |
| 21 | single-tile | `not a single tile: header is "RPGTLKIT BOARD"…` | 2 | damaged/truncated | misfiled capture: board bytes under a `.gph` name |
| 22 | battle-background | `not a battle background: magic is "RPGTLKIT BOARD"…` | 1 | damaged/truncated | misfiled capture: board bytes under a `.bkg` name |
| 23 | board | `the tile matrix would hold N cells (N×N×N) but the limit is N` | 1 | missing evidence | the 4,194,304-cell guard is cited against a section that does not state a limit |
| 24 | board | `not a board: magic is "RPGTLKIT BKG"…` | 1 | damaged/truncated | misfiled capture: battle-background bytes under a `.brd` name |
| 25 | character | `invalid integer for smYN ("Wolf Assaults") at line N` | 1 | missing evidence | a name in an integer slot: an undocumented extra or shifted line |
| 26 | gam | `unexpected end of data reading uN: need N byte(s), N remain` | 1 | damaged/truncated | binary main file cut inside a primitive field |
| 27 | gam | `not a main file: magic is "RPGTLKIT BKG…"…` | 1 | damaged/truncated | misfiled capture: battle-background bytes under a `.gam` name |
| 28 | single-tile | `truncated single tile header: expected at least N lines, found N` | 1 | damaged/truncated | the five-line header is cut after the fourth line |
| 29 | single-tile | `empty single-tile file` | 1 | damaged/truncated | non-zero byte count but no non-blank line: no payload |

### Why the text EOF groups are not counted as damage

Byte-level truncation cuts anywhere, so its diagnostic line would be spread across
the whole file. These refusals cluster on single line numbers instead: 104 enemies
all stop at line 359, 48 fight backgrounds all at line 218, 241 items all at the
same line of the same 17,492-line layout, and the special moves stop only at
line 10, 11 or 12 of 13. A systematic writer that omits the documented trailing
group explains that; a damaged capture does not. The board day/night group is the
precedent: the spec records that variant and the reader accepts the early end.

The ledger stores hashes and diagnostics, not bytes, so this report cannot show
the bytes themselves. To settle any group either way, re-open one original file
and check the last line: a file that ends exactly after a CRLF is a short variant
(dates a docs PR), a file that ends inside a line is a damaged capture. The
`origins` locator for every record is in the ledger.

## Divergences found (flagged, not changed)

1. **Text readers cite the binary section anchor.** `readTextEnemy`,
   `readTextItem`, `readTextSpecialMove` and `readTextBattleBackground` report
   `docs/spec/formats/enemy.md#layout` (and `item.md#layout`,
   `battle-data.md#…`) although their own doc comments name
   `docs/spec/formats/legacy/text-formats.md#enemy`. The ledger inherits those
   anchors. Fixing the anchors is a diagnostics-only change and belongs in its own
   PR with the affected tests.
2. **The board cell-limit diagnostic cites a section that does not state the
   limit.** `BOARD_MAX_CELLS` (4,194,304) is code-only; the cited
   `older-binary-versions.md#board-minor-2-and-3-pre-vector` describes the
   pre-vector fields. Either the docs record the limit or the guard cites the
   vector layout page.
3. **Format dispatch is by extension.** The five misfiled-capture groups (rows
   21, 22, 24, 27 and the `.gph` boards) are refused because the census hands the
   bytes to the decoder for the file's extension; the magic shows another family.
   A sniff-before-decode policy would reclassify them rather than fix them.

## What each class needs next

- **Missing evidence (1,175 files).** Docs PRs first, per G7, each with sample
  counts and hashes from the ledger: the `UNREGD` registration token, the short
  tails per family (enemy animations, fight-background tints, item/special-move
  last lines, main-file rows), empty `ai`/`useCode`, the text `.tst` layout, the
  comma delay form, the `smYN` shift, and the board cell limit. Only after a docs
  page records a shape may a reader accept it — this PR deliberately does not
  broaden any reader.
- **Damaged or truncated (15 files).** No reader change: refuse and report, as
  today. The misfiled ones only need a sniff policy decision.
- **Documented unsupported (10 files).** Nothing: R-24 keeps Toolkit 1 single
  tiles out of the first release, and `School2Demo/SchoolFloor1.brd` stays the
  named placeholder exclusion.
- **Implementation defect (0).** None established. If a future byte-level check
  shows a reader refusing a layout `docs/spec/` documents, that is the group that
  moves here, with a before/after fixture as the issue requires.

## Verification

| Command | Result |
|---|---|
| `node tools/research/decode-gaps.mjs` | 15,897 records, 1,200 refusals, 29 groups, 0 unclassified, exit 0 (10 / 15 / 1,175 / 0 by class) |
| `node --test packages/core/test/format-legacy-refusal-bounds.test.ts` | all tests pass: 5 docs-conformant text examples decode; each cut reproduces its census diagnostic |
| `git log --oneline -20 main \| grep -F '#1772'` | no match: no earlier PR references this issue |

Environment for the checks above: Node v24.19.0 (the repository pins 24.21.0 in
`.node-version`; the readers under test are plain ESM and behave the same), no
game file executed, no bytes written outside this repository.
