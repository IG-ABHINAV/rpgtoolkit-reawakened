- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-provenance-scan-plan.md`
  summary: tools/licences/check.mjs (entry 1.5) does nothing and exits 0 when run through a symlinked path, because its isMain guard compares an unresolved argv[1] with a symlink-resolved import.meta.url.
  evidence: Reproduced in review: `node <symlink to tools/licences>/check.mjs` printed nothing and exited 0 while the real path ran. The fix is a realpathSync on argv[1] (as now done in tools/provenance/scan.mjs); it belongs in the refactor sweep (entry 1.11).
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-provenance-scan-plan.md`
  summary: Entry 1.7 (sample-game fixture fetch) must add the ignored root `fixtures/` folder to scope.skipRootPaths in tools/provenance/markers.json, or a local `pnpm provenance` after the fetch will scan the legacy sample files.
  evidence: scan.mjs walks the working tree, not git-tracked files, and `/fixtures/` is gitignored but not in skipRootPaths. CI is unaffected because the provenance job does not fetch fixtures.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-sample-game-fixture-fetch-plan.md`
  summary: Entry 1.9's golden job must also run `pnpm fixtures:check` (after `pnpm fixtures:fetch`), so the "nothing under fixtures/ is tracked" check is part of a required job.
  evidence: Human decision at the entry 1.7 plan checkpoint (Open Question 2, option a). Entry 1.10's required list has no `fixtures` job, so without this the check in `fixtures.yml` could be skipped at merge. Entry 1.7 does not edit the ticket text of entry 1.9.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-contract-types-canonical-form-and-hashes-plan.md`
  summary: `encodeLog` (entry 1.8) throws `TypeError` on a plain record shaped exactly `{ t: 'bytes', hex: string }`, because `decodeLog` would read it back as bytes, and it passes non-plain leaves (undefined, functions, NaN) through to `canon`. A valid `PortData` value of that shape therefore aborts recording.
  evidence: Review F8. Only free-form positions can carry such a record (`ExtensionResult.result`, `ExtensionCallRequest.args`), and the E-99 extension API is not defined yet. Revisit when it is: games are untrusted (AD-17), so recording must not abort on a script-controlled value. An escape scheme (wrap the records that would collide) makes `encodeLog` total.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-contract-types-canonical-form-and-hashes-plan.md`
  summary: `canon` (entry 1.8) recurses without a depth bound, so nesting beyond about 3,900 levels raises `RangeError` at a host-dependent depth instead of `TypeError`.
  evidence: Review F10, measured on Node 26.8.1 (`canon` fails at depth 3906 and `encodeLog` at 3515; `JSON.stringify` copes with 200,000). The VM epic must bound script-created nesting well below this (AD-17), or `canon` gets a fixed explicit limit so the failure is identical on every runner (G3).
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-contract-types-canonical-form-and-hashes-plan.md`
  summary: `canon` (entry 1.8) costs about 13 times `JSON.stringify` (3.9 ms against 0.3 ms on a 264 KB state; `hashState` 6.4 ms), and `Object.keys(items)` on every array allocates about 107 MB for a 1M-element array.
  evidence: Review F11, not a correctness issue. Decide when the engine epic wires `hashState` into `advance` (the Design Notes say it runs on every `advance`): replace the density check with a loop over `i in items`, skip the per-property descriptor read on the common path, or hash while serialising.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-runner-harness-driver-synth-scaffold-and-the-golden-job-plan.md`
  summary: The golden test double (entry 1.9) does not model the focus pause of AD-14/E-03 (it throws on focus, and the driver throws when advance reports 0 steps run). Pause replay lands with the engine epic.
  evidence: Review finding F2. Revisit when the engine epic implements E-03 pause state.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-runner-harness-driver-synth-scaffold-and-the-golden-job-plan.md`
  summary: `audio.ended` and `video.ended` emission by the headless runner is deferred because it requires parsed durations from audio readers that core currently lacks.
  evidence: Review finding F2 / Design Notes. Revisit in the audio-synth epic.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-runner-harness-driver-synth-scaffold-and-the-golden-job-plan.md`
  summary: An exported `./testing` entry point for runner-harness (AD-22) is deferred because dependency-cruiser rule r2 bans subpath imports.
  evidence: Review finding F17 / probe b2. Revisit when DAP needs runner-harness testing helpers.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-required-ci-checks-branch-protection-and-contributor-docs-plan.md`
  summary: If a merge queue is ever enabled for `main`, `merge_group:` must be added to `ci.yml`'s `on:`.
  evidence: GitHub reports required checks for a queue entry only from workflows triggered by `merge_group`; without it every required check stops reporting and the merge fails. No merge queue exists today (entry 1.10).
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-refactor-sweep-plan.md`
  summary: `uv run _bmad/method/scripts/tickets.py find <id>` aborts with ``frontmatter lists must be inline: `key: [a, b]` `` because ten of the epic's plan files use a block-style `context:` list, so the ticket CLI cannot be used to read tickets for this epic.
  evidence: Reproduced by the entry 1.11 planner and reviewer at `eddc75c`: the strict re-parse inside `tickets.py`'s `load_folder` (the raise is around line 167, called around line 360) rejects a block list, so `find`, `status`, `next` and `pull` all abort identically — `cmd_find` never parses frontmatter itself, and ten plans use a block list. Fixing it either way — the strict re-parse in `load_folder`, or inline lists across ten historical plans — edits method-owned tooling or plan history, so entry 1.11 logged it instead of changing it.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-refactor-sweep-plan.md`
  summary: `tools/deps/graph.mjs` and `tools/check-core-deps.mjs` have no entry guard at all, so importing either would execute the check as a side effect; and `packages/runner-headless/src/cli.ts` resolves only `argv[1]` with `realpathSync`, not `import.meta.url`.
  evidence: Entry 1.11 review finding F10. Neither tool exports anything and every call site spawns a child process (`tools/deps/test/graph.test.mjs`, `packages/core/test/lint-rules.test.ts`, the root `package.json` scripts), so there is no live defect; `cli.ts` still detects its entry because Node realpaths the main module by default (no `--preserve-symlinks` anywhere in the repo). A guard is needed only if a caller ever imports them.

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: format-spec §4.8 under-specifies three things the entry 2.8 pre-vector converter needs, so it records them rather than inventing geometry: (a) the "standard default vector bases" pre-vector items are said to receive — the vector sprite model has no base because a sprite's collision comes from its own `.itm`, so none is generated; (b) how the `sizeX × sizeY` pre-vector tile matrix maps onto §4.2's `(sizeX + sizeY)²` iso-rotated grid, and what a program region on a rotated board is — an iso-rotated board is refused by the converter with a located error; (c) how differing per-layer tile shades combine when flattened into layer 0 — they are summed additively per §4.5, with the cast layer at the highest shaded layer.
  evidence: Verified against the spec text at `docs/format-spec.md` §4.8 and §5; the corpus ships no minor 2–3 board (all three fixture `.brd` files are minor 4), so nothing pins the reading. A doc amendment to §4.8 stating the bases, the rotated mapping and the flattening rule is a human decision on the format-spec, per G7's "fix the doc first".

## Deferred from: code review of story-tileset-reader-and-writer-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-tileset-reader-and-writer-plan.md`
  summary: The legacy sample corpus contains only version-20/detail-1 tilesets, so the tileset paths that change geometry (details 2/4/6), index the VGA palette (3/5) and unpacks the isometric diamond (150) have synthetic coverage only.
  evidence: All four corpus tilesets (`fixtures/legacy/{demo,Basic}/Tiles/{char,default}.tst`) read version 20, detail 1, tile counts 87/140, and their sizes equal `6 + count·32·32·3` exactly; `fixtures/legacy` contains no `.iso` and no 16×16 or palette tileset. `packages/core/test/format-tileset.test.ts:282-288` is the only place real bytes meet `writeTileset`, and it asserts only `tiles.length > 0` and `residue.length === 0`. Fixing this needs an acquired or synthesised `.iso`/detail-2 sample, which is outside this ticket; it is also what keeps the E2 doubling question and the E1 CI gap observable only on the plain path.

## Deferred from: code review of story-texture-decoders-png-and-jpeg-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-texture-decoders-png-and-jpeg-plan.md`
  summary: `docs/format-spec.md` §10 was not extended although every new image file cites it as its authority, and §10 still lists image kinds (BMP, GIF, ICO/WMF) that no decoder implements and no epic ticket tracks.
  evidence: `git show edf9d38 --stat` touches no `docs/` file, while `png.ts`/`jpeg.ts`/`index.ts` cite §10 for PNG chunk/CRC structure, the five filters, Adam7, palette/`tRNS` expansion, bit-depth scaling, the baseline-only JPEG boundary and the 100 Mpixel refusal — none of which §10 (`docs/format-spec.md:819-833`, a six-row table plus two sentences) documents; G7 rule 4 required the doc fix first and the decisions live only in the ticket plan. In the other direction §10's image row promises "BMP, PNG, JPEG, GIF (incl. animated), ICO/WMF (import)" while `index.ts:22-25` dispatches PNG/JPEG only: no BMP/GIF/ICO/WMF decoder exists under `packages/core/src` (grep), the epic's twelve tickets contain none, and the sample games ship no such asset (their only reference is a commented-out `// bitmap("title.gif");` in both `Prg/start.prg` files), so the coverage hole is real but untracked.

## Deferred from: code review of story-board-brd-minor-4-reader-and-writer-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-board-brd-minor-4-reader-and-writer-plan.md`
  summary: format-spec §4.2/§14 do not state rules the new reader implements (a run marker followed by a negative LUT index is refused; the overrun-warning policy; the residue policy is now §1.7) and contradict themselves on the empty LUT (§1.2 "-1 means none" vs §4.2 "index 0 is always the 'no tile' entry"), while §14's `.brd` note says isometric detection is `(coordType & 1) || (coordType & 2)` where `boardGrid` implements only bit 2.
  evidence: `docs/format-spec.md` was untouched by the diff; §4.2's tile-matrix bullet describes the marker but not a negative following index, §4.2's LUT bullet says "the table always has `lutUpperBound + 1` entries" while §1.2 says `-1` means none, and §14 lists `(coordType & 1) || (coordType & 2)`; a scratch board with `lutUpperBound -1` read ok with `lut = []` and no warning. Fixing any of these edits the spec, which G7 wants in its own commit ahead of the code.

## Deferred from: code review of story-actor-definitions-character-item-enemy-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: format-spec §6.1 and §6.2 do not state the accepted minor ranges that the character and item readers hard-code, which §1.4 requires each format to state.
  evidence: docs/format-spec.md:54 (§1.4) requires each format to state the minor values it accepts, and §6.3 does ("Only two versions exist: minor 0 … and minor 1"), but §6.1 and §6.2 state no range while CHARACTER_MIN_MINOR/MAX (0..8) and ITEM_MIN_MINOR/MAX (0..7) rest on inference and select the i16-vs-i32 rows; the fix is a spec edit under G7's doc-first rule, so it is out of scope for this code change.

## Deferred from: code review of story-battle-definitions-bkg-spc-ste-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-battle-definitions-bkg-spc-ste-plan.md`
  summary: docs/format-spec.md §1.4 promises each format states which `minor` values it accepts, but §8.1–§8.3 state none, so the `.spc`/`.ste`/`.bkg` readers validate no `minor` value at all.
  evidence: §1.4 sentence 1 read in full ("Each format states which `minor` values it accepts; an unlisted value is invalid and a reader reports it rather than guessing a neighbouring layout") against §8.1 (special move), §8.2 (status effect) and §8.3 (battle background), which list a header plus fields and no accepted-`minor` statement; the plan's Implementation Notes record the resulting "No minor validation" decision, and the one real sample is `minor 3` while every synthetic buffer is `minor 0`. Deferred because the fix is a doc-first spec edit (G7), not code.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-battle-definitions-bkg-spc-ste-plan.md`
  summary: the `.spc` and `.ste` field layouts have no external authority anchor — no sample file of either extension exists in the corpus, and the synthetic buffers are built with the same `BinaryWriter` primitives the writers use.
  evidence: `find fixtures -iname '*.spc' | wc -l` and `'*.ste'` both return 0, while `'*.bkg'` returns the single 45-byte `fixtures/legacy/demo/Bkrounds/bkg.bkg`; the test builders `buildSpc`/`buildSte` (packages/core/test/format-battle.test.ts:96-152) write §8.1/§8.2 field order by hand but through the production writer primitives, so a spec misreading made consistently in reader and builder passes every assertion. Deferred because the fix is an independently authored or sourced byte fixture, which no in-repo work can supply.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-battle-definitions-bkg-spc-ste-plan.md`
  summary: The `.ste` and `.bkg` readers still probe the detection byte before the header, so a file too short to probe reports a §1.3 "detection byte out of range" error instead of the short read the `.spc` reader now reports.
  evidence: Found while applying the 2.7 review patch to `special-move.ts`: `status-effect.ts` and `battle-background.ts` read the probe first, as `special-move.ts` did. The review named only `.spc`; the other two are the same defect and the same small change, left out so the patch stayed to its text.

## Deferred from: code review of story-pre-vector-board-converter-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: The board load path still refuses minors 2–3, so a legacy 3.0.x project cannot load until the dispatch is wired, which the ticket's two modules do not do.
  evidence: `packages/core/src/formats/board/reader.ts:195-203` still returns "…see ticket 2.8" for minors 2–3 at commit 06b250e, and no non-test caller of `readPreVectorBoard`/`convertPreVectorBoard` exists there; the first caller lands outside the diff in `2aa135e` (epic 2.11, `packages/runner-headless/src/dump/parse.ts`). Pre-existing, not caused by this change.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: §4.8's rule "pre-vector items receive standard default vector bases" is implemented nowhere, and the plan's deferred rationale for generating none is wrong for pre-vector-era items.
  evidence: §4.8's conversion rules state the rule and §6 gives the defaults ("2D collision is a small rectangle at the feet; activation is a larger rectangle roughly the frame's footprint. Isometric boards use diamonds instead"), while stored bases exist only for `.tem` minor ≥ 8 / `.itm` minor ≥ 7 (`actor/item.ts:273`, `actor/character.ts:294`, `readBases` in `actor/model.ts:488-525` synthesise nothing). §4.2's `BoardSprite` (model.ts:201-217) has no base field, so the rule cannot be materialised in the board model without a spec decision.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: A minor-3 iso-rotated pre-vector board (`coordType: 2`) converts to a located §4.8 error instead of a `Board`, and `tilePixel`'s §5 rotated branch is dead code as a result.
  evidence: Probe at HEAD: `convertPreVectorBoard` on a board with `coordType: 2` returns the §4.8 "iso-rotated pre-vector boards cannot be converted" error before any call to the private `tilePixel`, which makes its `(coordType & COORD_ISO_ROTATED)` branch (`pre-vector-convert.ts:64-66`) unreachable. The refusal is deliberate and recorded in `deferred-work.md`, because §4.8 gives no `sizeX×sizeY` → `(sizeX+sizeY)²` mapping and no rotated program region; closing it is a doc decision.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: Empty program and sprite slots are converted as if they sat on tile (0,0), giving converted boards invented off-board geometry that §4.8 and the plan's deferred entry do not record.
  evidence: Probe at HEAD on a 4×4 board: an empty program slot at (0,0) becomes the closed rect `(-32,-32)…(0,0)` on a 2D board and a diamond centred (-64,-16) on an iso-stacked one; an empty sprite slot becomes `x = -16, y = -1` (2D) / `x = -64, y = -16` (iso). §4.8 pins a fallback only for the start point, the model's `BoardProgram.points`/`BoardSprite.x,y` are required, and the plan's boundary says invented geometry is "recorded instead" — but this choice is not in `deferred-work.md`.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: The stored pre-vector `activationType` is passed through with `repeatDistance` forced to 0, so a legacy repeat bit becomes "repeat every 0 px".
  evidence: Probe at HEAD: input `activationType: 2` converts to `6` with `repeatDistance: 0` (`pre-vector-convert.ts:380-381`). §4.4 makes bit 2 "repeat every `repeatDistance` px while inside"; the pre-vector program record has no `repeatDistance` field and §4.8 says only to strip the `!`/`$` suffixes and OR in the stops-movement flag, so whether to mask the bit or default a distance is a §4.8 decision.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: Several §4.8 readings the converter takes are neither pinned by the spec nor recorded in the deferred-work log, so G7's doc-first step is still outstanding beyond the three gaps already logged.
  evidence: The single entry at `deferred-work.md:41-43` records the bases, the iso-rotated mapping and the shade flattening, but not the empty-slot geometry, the `activationType`/`repeatDistance` passthrough, the unclamped shade sums, the tile types 5–10/>18 that vanish without a warning, the dropped fields, or the numeric-constants/layer-title mappings; §4.8 also never states the cell polygon, `PRG_STOPS_MOVEMENT` on every old program, `backgroundDrawType = 1` or the `(64,64)`/layer-1 start fallback. A doc amendment to §4.8 is a human decision on the spec, per G7.

## Deferred from: code review of story-main-game-file-gam-reader-and-project-layout-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-main-game-file-gam-reader-and-project-layout-plan.md`
  summary: `resolveReference` (and `ASSET_FOLDERS`/`MainFileProject`) has no production consumer, and ticket 2.10's resolver duplicates the same path composition, so two conventions for §1.5 lookup coexist.
  evidence: `grep` at HEAD finds `resolveReference` only in its definition, the barrel and its own test; `packages/core/src/formats/resolver/resolver.ts:67-78` (commit `acf48f8`, ticket 2.10) recomposes `projectFolder("", root)` + `typeFolder` + `stripTypeFolder` + `foldPath` instead of calling it. Introduced by that later commit, not by `d7bd3a6`.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-main-game-file-gam-reader-and-project-layout-plan.md`
  summary: `model.ts` cites format-spec §2 rows using the spec's own collided numbering ("Row 29" for both the fight-style residue and the plugin list, "Row 37"…"Row 43" for rows the numbered table never numbers), so the citations cannot be checked against the primary table.
  evidence: §2's numbered table stops at 32 and its prose summary numbers the same conditional rows 33 and 37–43; `packages/core/src/formats/main-file/model.ts:75-92` follows both at once. Behaviour is unaffected (the test enumerates all twelve conditions and passes); the fix is a `docs/format-spec.md` §2 amendment (G7 doc-first), which is a spec edit.

## Deferred from: code review of story-asset-resolver-and-package-loader-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-asset-resolver-and-package-loader-plan.md`
  summary: The loose-folder package form and the L1–L26 rule ids the loader enforces are cited as `format-spec §13`, but §13 defines only `.tpk`, standalone EXE and Setup ZIP.
  evidence: `docs/format-spec.md:857-867` (§13) has three bullets, none a loose folder and none an L-id; the folder form and every number behind it come from `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/discovery/package-limits.md` (which does name "loose folders"). `packages/core/src/formats/package/limits.ts:1-16`, `package.ts:1-15` and `model.ts:1-15` all cite "format-spec §13 … (AD-6)" and every folder failure is stamped `section: "format-spec §13"`, so a reader following the citation finds nothing (G7 doc-first wants the doc fixed first, in its own commit).
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-asset-resolver-and-package-loader-plan.md`
  summary: The `.tpk` in-package layout is asserted by the change's own fixtures rather than pinned by §13 or a real package, and the two readings of §13's sentence are indistinguishable in code.
  evidence: §13 says only "a standard ZIP archive with the project folder plus `main.gam`"; `packages/core/src/formats/package/model.ts` and `resolver/model.ts` assert the project folder is the package root with `main.gam` at the root, and `packages/core/test/format-package.test.ts` pins that with a hand-written ZIP — so the tests exercise the change's model of a `.tpk`, not the container the legacy toolkit emits. No sample corpus ships a `.tpk`, EXE or Setup ZIP (`discovery/corpus-inventory.md`), so a spec sentence (or ADR) plus a fixture is what would settle it; this is a spec edit, hence deferred.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-asset-resolver-and-package-loader-plan.md`
  summary: Unicode case folding collides names that AD-5's cited "ASCII-only case fold" assumption would keep distinct.
  evidence: `packages/core/src/formats/main-file/layout.ts:71-76`'s `foldPath` uses `String.prototype.toLowerCase`, and `"\u212a".toLowerCase() === "k"` (probed), so `K.brd` and `k.brd` fold to one key while `U+0130` folds to two code points. The helper landed with ticket 2.9 (`git log -- packages/core/src/formats/main-file/layout.ts` → `d7bd3a6`), so it is pre-existing relative to this change, and the plan already flags the AD-5 mismatch as an open question for the human; the fix either restricts the helper or amends AD-5.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-asset-resolver-and-package-loader-plan.md`
  summary: The `filter` hook's L16 branch in `readZip` can never fire, so that check is dead code kept as defence in depth.
  evidence: Found while applying the 2.10 review patch that removed the directory exemption from L3: fflate's `filter` receives `originalSize` from the same central-header field that L3 now rejects above the limit for every entry, so no entry reaches the filter over the limit. The patch expected the change to make L16 live; it does not. Either delete the branch or keep it on purpose.

## Deferred from: code review of story-distribution-package-writer-with-manifest-plan (2026-10-11)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-distribution-package-writer-with-manifest-plan.md`
  summary: The feature catalogue (docs/editor-features.md T-70…T-74, docs/engine-features.md E-131) and the 2.12 commit message do not mention the distribution manifest; format-spec §13 documents it as of 2026-10-11, so only the catalogue half of G7's doc-first rule is still open.
  evidence: `grep -n manifest docs/*.md` finds it only in format-spec §13; docs/editor-features.md:182-192 (T-70…T-74) and docs/engine-features.md:356 (E-131) say nothing about the manifest-carrying package, and the commit message cites no E-xx/T-xx. The fix edits specs, so it defers.

## Deferred from: code review of story-board-brd-minor-4-reader-and-writer-plan (2026-10-13)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-board-brd-minor-4-reader-and-writer-plan.md`
  summary: `writeBoard` does not check shade-layer coverage, so it returns `ok` for a model whose file its own reader refuses — the same class the 2.5 patch closed for the tile runs.
  evidence: Round-2 review (`review-r2-formats`): `writeBoard` with an under-covering shade layer returns `ok` (139 bytes) and a re-read fails `format-spec §1.1 @137: unexpected end of data reading i32`. Fix: sum `runCount > 1 ? runCount : 1` per layer and refuse when it is below `width × height`.

## Deferred from: code review of story-actor-definitions-character-item-enemy-plan (2026-10-13)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: every version-conditional threshold in §6.1/§6.2 can be moved with the actor suite still green — 5 of 8 survive mutation on `origin/main` (epic 2.18 pinned 3) — and no minor-3 item or minor 2/5/6/7 character is built anywhere.
  evidence: Round-2 review (`review-r2-formats`), re-baselined: `ITEM_I32_MINOR 3→4`, `ITEM_MOVEMENT_MINOR 4→3` and the reader `minor >= 6/7/8` thresholds each report `pass 20 / fail 0`. Fix: build `.tem` at 2/5/6/7 and `.itm` at 3, plus refusal tests at `.tem 9`, `.itm 8`, `.ene 2`, and negative versions.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: a *consistent* mis-ordering of two same-width fields is undetectable — swapping `criticalOn`/`criticalBy` in both `readEnemy` and `writeEnemy` passes — and stats/prices/rewards/crits have no value assertion.
  evidence: Round-2 review (`review-r2-formats`), re-baselined: the paired swap reports `pass 20 / fail 0`, while the reader-only swap fails. Fix: give every builder field a distinct value and `deepEqual` the parsed model.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: `writeBases` writes an i16 bound that wraps for a base with more than 32768 points, producing a corrupt file instead of an error.
  evidence: Round-2 review (`review-r2-formats`): `writeCharacter` with 40000-point bases returns `ok` (642,668 bytes) and the re-read fails `§1.2: invalid upper bound: -25537`. Fix: return a `writerError` when a base or its point list exceeds 32768.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: a model carrying `undefined` `idleTime`/`speed` at a minor that stores them writes a literal `0` instead of the §6.1 defaults (3.0 s / 0.05 s); every other missing fixed block fails loudly.
  evidence: Round-2 review (`review-r2-formats`): `writeCharacter` with `idleTime/speed` undefined returns `ok` and re-reads `idleTime=0 speed=0`. Fix: refuse, or write the documented default.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: i16 scalars wrap silently on write — the same class the 2.5 patch closed with `writeI16s`.
  evidence: Round-2 review (`review-r2-formats`): `writeCharacter({experienceIncrease: 40000})` re-reads `-25536`; the same unguarded `writer.i16(...)` pattern is in `item.ts`/`enemy.ts` by inspection.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: §6.2's 32 legacy walk-frame strings' order (interleaved top/bottom vs 16 tops then 16 bottoms) is not stated by the spec, and the code's alternating choice is unrecorded and untested (G7 doc-first).
  evidence: Round-2 review (`review-r2-formats`): §6.2 says only "`str × 16 × 2` … each frame = top & bottom tile".
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-actor-definitions-character-item-enemy-plan.md`
  summary: only 3 of the 5 named actor samples are required by `sample()`, so a corpus change dropping `Basic/Chrs/start.tem` or `demo/Item/oldman.itm` silently reduces coverage while the plan claims "Fails when a named sample is missing".
  evidence: Round-2 review (`review-r2-formats`): `format-actor.test.ts:790-843` requires only `demo/Chrs/start.tem`, `demo/Item/man.itm`, `demo/Enemy/pirate.ene`.

## Deferred from: code review of story-battle-definitions-bkg-spc-ste-plan (2026-10-13)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-battle-definitions-bkg-spc-ste-plan.md`
  summary: the three battle writers range-check nothing and do not check `model.magic`/`model.minor`, so a `minor: 7` model writes a file the spec-conformant reader now refuses, and an out-of-range i16 is written silently.
  evidence: Round-2 review (`review-r2-formats`), re-baselined (sharpened): `writeStatusEffect(rounds: 40000)` returns `ok` and re-reads `-25536`; `writeSpecialMove(minor: 7)` returns `ok` and the file is refused by `readSpecialMove`. Fix: range-check the writers and check magic/minor as `board/writer.ts:102-112` does.

## Deferred from: code review of story-pre-vector-board-converter-plan (2026-10-13)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: G7 doc-first was not followed for §4.8 — the conversion rules were written into the spec hours after the code, so the epic's Done-when 4 is satisfied by a description of the code rather than a rule the code was written against.
  evidence: Round-2 review (`review-r2-formats`): code `06b250e` 2026-10-11 14:24, patches `d821292` 17:11, spec `06da7ed` 22:45 and `2cd310b` 22:47. A §4.8 doc decision is a human one.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: an over-long run is clamped to the grid, where §4.2's run policy keeps the extra cells and warns — a silent, unrecorded §4.8 choice.
  evidence: Round-2 review (`review-r2-formats`): a 10-cell run on a 2×2 grid warns "run covers 10 cells but only 4 remained" and yields exactly 4 cells; contrast `format-board.test.ts:798-809` for §4.2.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-pre-vector-board-converter-plan.md`
  summary: the pre-vector test file still does not cover a run that overruns the grid or the negative-LUT-index refusal (the cell-cap tests have since landed).
  evidence: Round-2 review (`review-r2-formats`); `f56e694` added the cell-cap tests, the rest remain.

## Deferred from: code review of story-main-game-file-gam-reader-and-project-layout-plan (2026-10-13)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-main-game-file-gam-reader-and-project-layout-plan.md`
  summary: the §2 row-number citations in `model.ts`/`reader.ts`/`writer.ts` use a second numbering scheme that contradicts §2's unique 1–43 rows.
  evidence: Round-2 review (`review-r3-package-ci`), re-baselined LIVE: `MainFilePlugin` is annotated "§2 row 29" while §2 numbers the plugin list differently; the files are unchanged at `origin/main`. The fix is a `docs/format-spec.md` §2 amendment (G7 doc-first).
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-main-game-file-gam-reader-and-project-layout-plan.md`
  summary: `format-main-file.test.ts:4-5` still asserts the corpus "ships no `.gam`", and the `:415` test restates the implementation's own conditions rather than testing the reader.
  evidence: Round-2 review (`review-r3-package-ci`), re-baselined LIVE: `tools/fixtures/sources.json` now fetches `build/main`/`demo.gam` and `dump:check` parses it; the only `origin/main` change to the file is the added fold test.

## Deferred from: code review of story-headless-project-dump-tool-plan (2026-10-13)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-legacy-formats/story-headless-project-dump-tool-plan.md`
  summary: the digest gate's reproducibility is proven on Node 26.8.1 only, while CI pins `node-version: 24.21.0`; cross-engine digest stability is a reasoned expectation, not a measurement.
  evidence: Round-2 review (`review-r3-package-ci`): `pnpm dump:check` passes locally on v26.8.1 and the gate could not be run under 24.21.0. If it matters, run `pnpm dump:check` once in a 24.21.0 container.

## Deferred from: code review of story-tracer-bullet-source-text-to-a-restored-snapshot-through-the-plan (2026-10-14)

- AD-8 in the architecture spine still lists `ParamSpec { optional?, byRef?, variadic? }`, `out?` and `resume?` while AD-14 and the code make every field required. Entry 3 rewrites AD-8 to the functional command contract (ADR 0004 decision 2) and must keep the `Arg = { value, ref: RefId | null }` clause; its doc-first commit should also fix these keys.

## Deferred from: closing suite of epic board-rendering (ticket 4.28, 2026-10-18)

- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/story-closing-suite-the-sample-games-boot-and-render-headlessly-plan.md`
  summary: Script text and the message window drawn by a game's start-up program stay on screen over the first board, because nothing clears `ui.draws` or the message window when the engine enters the board.
  evidence: `golden/regression/closing/demo-board.png` and `Basic-board.png` show "Test Game", "New Game", "Load Game", "Quit" and "Your story goes here..." over the board. docs/spec/engine/main-loop-and-startup.md#reawakened-board-entry lists no screen clearing; the legacy engine redraws the whole screen each frame. Needs an owner ruling (does board entry clear script text?) before any code.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/story-closing-suite-the-sample-games-boot-and-render-headlessly-plan.md`
  summary: A frame with no board is transparent (alpha 0) where the legacy screen is black, so title screens are white text on transparency.
  evidence: `currentDrawList` uses an empty draw list when `state.world.board` is null (`packages/core/src/engine/engine.ts`); `golden/regression/closing/demo-title.png` is white text and the hand on alpha 0. Adding a black fill changes the draw hash of every no-board state, so it needs a ruling and a re-record.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/story-closing-suite-the-sample-games-boot-and-render-headlessly-plan.md`
  summary: `font("Arial")`, `font("Times New Roman")` and `font("Courier New")` resolve to the keys `media/fonts/liberation-sans.ttf`, `liberation-serif.ttf` and `liberation-mono.ttf` (`canonicalFont` in `script/packs/ui.ts`), but the bundled files are `LiberationSans-Regular.ttf` and so on, and `resolveFont` (`render/text.ts`) is not called by the `font` built-in. A family-substituted font therefore never reaches a Liberation file; with entry 4.28's fallback it draws in the default bitmap font.
  evidence: `assetKey("media/fonts/LiberationSans-Regular.ttf")` is `media/fonts/liberationsans-regular.ttf`, not the key the `font` effect stores; the bundled-assets rule in `docs/spec/engine/display-input-audio.md#reawakened-bundled-assets` records the fallback. Fix in a follow-up: make the `font` built-in resolve through `resolveFont` against the project fonts and the bundled Liberation files.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/story-closing-suite-the-sample-games-boot-and-render-headlessly-plan.md`
  summary: `state.surfaces` holds the full-screen surface 0 bitmap from the moment the engine is created, so every `advance` hashes a 640×480 RGBA bitmap (1.2 MB): about 60 ms per `advance` at 640×480 against 0.3 ms at 32×32. One-tick batching over 600 ticks therefore takes about 40 s per game.
  evidence: measured in entry 4.28 on an empty scene-mode engine (63.6 ms per `advance` at 640×480 before any frame is read, 0.33 ms at 32×32) and on the `demo` game (batch sizes 600, 7 and 1 took 1.3 s, 6.6 s and 38.4 s). The closing suite therefore checks batch sizes 600, 30 and 7. A hash that skips the derived screen bitmap (its `rev` already identifies it) would remove the cost; that is a state-contract change for the owner.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/story-closing-suite-the-sample-games-boot-and-render-headlessly-plan.md`
  summary: A start-up program that fails to compile (every Toolkit 2 sample) does not stop boot: Caoquest, ChimeranEmpire and FinalDestiny report `syntax.error` and the engine still enters `initBoard` without running the program. Epic tk2-support decides whether that is wanted; the closing suite records it as their expected failure.
  evidence: `golden/regression/closing.json`, the three games' `diagnostics` and `board` fields.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/story-closing-suite-the-sample-games-boot-and-render-headlessly-plan.md`
  summary: [INFERENCE, not run] docs/spec/formats/board.md says a board thread entry is a program file or inline code, but `arrive` in `engine.ts` starts every non-empty entry as a file program, so an inline-code entry would report `program.missing`. No sample game has one. Needs a test and a decision when a game does.
  evidence: `docs/spec/formats/board.md` thread row (58) and `startFileProgram` in `packages/core/src/engine/engine.ts`.
- source_plan: `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-tooling/story-rpgcode-spec-framework-the-describe-it-expect-pack-its-runne-plan.md`
  summary: PKG-4's join of package script functions into the ordinary lookup (`docs/spec/engine/rpgcode-modules-and-objects.md:116`, "a package's script functions and objects join the same lookup, by the same rule, when the package loader of PKG-7 supplies them") has no implementing entry. Entry 10.8's spec API therefore reaches its library by `#include` (TOOL-5's other branch, `docs/spec/engine/rpgcode-tooling.md:62`), and the switch from include to package load waits on a loader that owns this clause.
  evidence: Reproduced 2026-11-01 against the built harness: a manifest entry `{id:'demo', namespace:'demo'}` plus `packageStartups:[{owner:'demo', ref:<program defining pkgfn>}]` gives `unknown.command: no built-in or function named "pkgfn"` for an unqualified call (`packages/core/src/script/vm.ts:2148`) and `unknown.command: the package namespace "demo" supplies no command "pkgfn"` for `demo.pkgfn()` (`registry.ts:234`) — namespaces reach only `definition.commands`, never script functions (`plugin.ts:179-205`). PKG-7 is still `**Proposed ruling (pending owner review; entry 19.1)**` (`:119`). Neither owner entry asserts the clause: 19.16 (#540) and 19.17 (#562) cover catalogue identity, namespace, start-up, commands and roles; no `verify` mentions script functions joining the lookup. Belongs with whichever of 19.16/19.17 is reopened, or a new 19.x entry — that is a breakdown change, so the owner names it.
  tracker: #1051 (entry 19.21); this is the same PKG-7 script-function lookup gap, not a separate finding.
  status: The lookup half is delivered by #1051 through the approved rules (`#pkg-script-function-lookup-proposal`): a package's startup program and its includes export their functions bare and package-qualified, with the collision table, `command.overridden` records and `manifest.duplicate-package`. The loader half stays open: which package code a project's loader exposes, and whether the spec API keeps reaching its library by `#include`, waits on PKG-7 (entry 19.1), which is still a Proposed ruling.

## Resolved

- `deferred-work` §2 (the ignored `fixtures/` folder missing from the provenance scan's `scope.skipRootPaths`) — resolved by entry 1.7; `tools/provenance/markers.json` lists `"fixtures"`.
- `deferred-work` §3 (entry 1.9's golden job must also run `pnpm fixtures:check`) — resolved; the required `golden` job in `.github/workflows/ci.yml` runs `fixtures:fetch` then `fixtures:check`.
- `deferred-work` §1 (the licence tool's entry guard silently did nothing through a symlinked path, so the G6 gate exited 0 having checked nothing) — resolved by entry 1.11: `tools/licences/check.mjs` resolves both sides with `realpathSync` (the pattern `tools/provenance/scan.mjs` and `tools/fixtures/fetch.mjs` already use), and `tools/licences/test/licences.test.mjs` gained a regression row that fails against the old file and passes against the new one.
- `CLAUDE.md`'s stale G3 summary (recorded in the entry 1.1 plan, line 50) — resolved by entry 1 in commit `bb6c540`; the guard-rail text and the pull-request template row carry the `Math` allowlist and the `**` ban.
- `tickets.py` aborting on the epic's plans (the entry 1.11 finding) — resolved: the ten block-style `context:` lists in the epic's plan frontmatter are now inline lists, and the 1.10, 1.11 and 1.12 plans are typed `chore` instead of `story` (a `story` file is read as a ticket, so those three entries showed as planned or backlog while done). `tickets.py status`, `find` and `next` run again and report all twelve entries done.
- `deferred-work` (code review of 2.4, 2.5, 2.6 and 2.9: the animation, board, actor and main-file readers accept a stored list bound below -1 as "none") — resolved by the 2.1 review patch: `readUpperBound` reports a stored bound below -1 (format-spec §1.2) at the bound's offset. Checked on the sample `start.brd` with its LUT bound patched to -5: it is now refused at offset 27 instead of misparsing the rest of the file.
- `deferred-work` (code review of 2.4 and 2.7: the animation reader and the `.spc`, `.ste` and `.bkg` readers accept a negative `major` or `minor`) — resolved by the 2.1 review patch: `header()` reports a negative version field (format-spec §1.4) at its own offset, and the board, pre-vector board and actor readers dropped their now-unreachable copies of that guard. Checked on the sample `bkg.bkg` with its minor patched to -3: it is now refused at offset 15.
- `deferred-work` (code review of 2.3: the JPEG IDCT wrote padding blocks past a component plane's block grid, corrupting 27 of 65 corpus JPEGs) — resolved by branch `fix/epic2-jpeg-padding-blocks` (`6e98dfe`, doc `3f9ec9f`): the dummy blocks are decoded and dropped, a non-MCU-aligned regression test with hard-coded pixels was added, and `golden/legacy-corpus.json` was re-recorded for the changed pixels.
- `deferred-work` (code review of 2.7: the `.ste` and `.bkg` readers probe the detection byte before the header; §8.1–§8.3 state no accepted `minor`) — resolved by epic 2.18 (`e79d972`): the three battle readers read the header first and refuse a `minor` outside 2–3, so §1.4's accepted-minor requirement is now enforced.
- `deferred-work` (code review of 2.8: empty program and sprite slots were converted as if they sat on tile (0,0), inventing off-board geometry) — resolved by epic 2.16 (`1a42973`): empty slots now emit `points: [], closed: 0` and position `(0,0)`.
- `deferred-work` (code review of 2.8: the pre-vector reader had no cell-count cap, so a 360 KB crafted board aborted the process) — resolved by branch `fix/epic2-prevector-and-battle-validation` (`f56e694`, doc `9caaeaf`): the declared grid is bounded by `BOARD_MAX_CELLS` before any run is read.
- `deferred-work` (code review of 2.5/2.6: the accepted `.tem`/`.itm` minor ranges were not stated in the spec) and (code review of 2.9/2.10: the Unicode `toLowerCase` case fold contradicted AD-5's ASCII-only fold) — resolved by epic 2.17's spec amendment and epic 2.21 (`ac71468`), which switches the fold to `asciiLower()` and adds AD-5's fold test.
- `deferred-work` (code review of 2.10: the L17 proof returned a truncated prefix at `acf48f8`) and (code review of 2.11: `.bmp`/`.gif` failed the dump at `2aa135e`) — resolved by the round-1 review patches (`93efb03`).
- `deferred-work` (code review of 2.10/2.12: the declared-size proof's work was unbounded, and the manifest `index` kept the caller's order) — resolved by branch `fix/epic2-fold-and-zip-work-bound` (`6514031`, docs `c87c82e`, test `9759eb8`): the inflate streams and aborts past the declaration, and `index` is written in code-unit order.
- `deferred-work` (entry 1.9: the harness driver threw if a step report contained non-empty `requests` or `diagnostics`) — resolved by entry 3.7: `runLog` validates each request and diagnostic (a malformed one still throws, naming the call) and hands the non-empty ones to an optional `ReportObserver`, leaving the `{ tick, state, draw }` golden records and the golden shape unchanged; the VM-backed host now drains the located runtime diagnostics into `TickReport.diagnostics`.
- `deferred-work` (entry 1.8 F10/F11: `canon` recurses without a depth bound and array density checks allocate) — resolved by entry 3.11 (`packages/core/src/canon/canon.ts` bounds recursion to `CANON_MAX_DEPTH = 256` raising deterministic `TypeError`, with allocation-conscious dense array handling).
- `deferred-work` (code review of 3.2: AD-8 in the architecture spine lists `ParamSpec` with optional fields and `out?`/`resume?`) — resolved by entry 3.3: AD-8 is rewritten to the functional command contract (`call(view, args, next)`), `ParamSpec` specifies required `{ name, optional, byRef, variadic }`, and `Arg = { value, ref: RefId | null }`.
- `deferred-work` (code review of 2.8, 2026-10-13: an over-long pre-vector run was clamped to the grid, where §4.2's vector run policy keeps the extra cells and warns — a silent, unrecorded §4.8 choice) — resolved by entry 23.2, PR #729 (`4ff93c93`): `docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector` now rules that a pre-vector final run fills only the remaining cells, discards the excess and continues reading, with Reawakened reporting a warning the original programs did not, and `packages/core/test/format-board-pre-vector.test.ts:316` pins the cells, the `tile matrix run covers 17 cells but only 11 remained` warning and the following-field alignment from hand-authored bytes.
- `deferred-work` (code review of 2.8, 2026-10-13: the pre-vector test file still did not cover a run that overruns the grid or the negative-LUT-index refusal; the cell-cap tests landed in `f56e694`) — resolved by entry 23.2, PR #729: the overrun coverage is the test above, and the negative-LUT refusal stays covered once, in `packages/core/test/format-board.test.ts:722`, rather than duplicated into the pre-vector file.
- `deferred-work` (closing suite of epic board-rendering, 2026-10-18: `state.surfaces` keeps the full-screen 0 bitmap from engine creation, so every `advance` hashed a 640×480 RGBA bitmap, about 60 ms per `advance` at 640×480, and one-tick batching over 600 ticks took about 40 s per game) — addressed by entries 23.7 and 23.8, PR #714 (`1797f7d2`): `packages/core/src/raster/surfaces.ts` keeps decoded buffers outside `GameState` and re-encodes only the edited span, and `surface-hash.test.ts` proves the per-block transition cache returns exactly the legacy projection hash, so the state contract is unchanged rather than skipping the surface from the hash. The residual is recorded, not closed: with four high-entropy 640×480 surfaces edited while the state prefix changes a tick measured about 630 ms before and 61 ms after (Node 24.21.0), cold or highly varied surfaces still need sequential work, and the 50 ms budget for 60 direct 640×480 operations plus a hash is not reliably met.

## Promotion and disposition record (Epic 23 audit, 2026-10-31, pinned c8b7772f)

Every finding below was re-checked against code, tests and spec at `c8b7772f`. Tickets cut after that pin name the commit that delivered them, so a venue introduced later is cited at its own merge rather than at the audit revision. The entries above are untouched; this record says where each one went.

### Promoted to a ticket

- `deferred-work` ledger entry for actor/battle writer validation (code review of 2.6, 2026-10-13) → **23.1 / #640**, delivered in #829 (`8d809f41`): `packages/core/src/formats/validate.ts` refuses an over-bound list, an out-of-range `i8`/`i16`/`i32`, a wrong magic, an unlisted minor and a negative major, and the actor writers refuse a missing stored `idleTime`/`speed` (`packages/core/src/formats/actor/character.ts`, `item.ts`).
- Pre-vector board final-run overrun (2.8, 2026-10-13) → **23.2 / #641**, delivered in #729 (`4ff93c93`); the rule is `docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector` and the test is `packages/core/test/format-board-pre-vector.test.ts:316`.
- First-board and no-board display (closing suite, 4.28) → **23.3 / #642**, awaiting an owner ruling; the display rule is still absent from `docs/spec/engine/main-loop-and-startup.md`.
- Monorepo change tracking → **23.4 / #668**, delivered as `docs/findings/monorepo-change-detection.md` (#823).
- GitHub-centred ticket tooling → **23.5 / #680**, awaiting an owner-approved design; only the spike plan exists, so this stays a planning finding.
- Core-battle CI shard split → **23.6 / #710**, delivered; `tools/no-skips/run.mjs --verify-groups` pins the grouping.
- Surface pixel cache and incremental surface hashing (closing suite, 4.28) → **23.7 / #711** and **23.8 / #712**, delivered in #714 (`1797f7d2`); the residual cost is recorded in the `## Resolved` entry above rather than closed.
- Shade-layer coverage (2.5, 2026-10-13) → **23.9 / #847**, delivered in #857 (`0fa9097a`) and refined in #862 (`a6147ff1`): `board/writer.ts` now refuses both a short layer and a record after the one that completes it.
- Font substitution (closing suite, 4.28) → **23.10 / #848**, delivered in #857 (`0fa9097a`) and finished in #862 (`a6147ff1`): `resolveFontAsset` (`render/text.ts`) resolves exact path, then family, then the Liberation substitution against the assets the project ships, and the engine passes the resolver for the `font` command; the follow-up pinned family precedence by pixels and kept the documented fallback keys. The Basic sample's recorded state hashes moved with it and were re-recorded with that reason (G5); no PNG baseline changed.
- Main-file row citations (2.9, 2026-10-13) → **23.11 / #849**, opened in #857 (`0fa9097a`) and finished in #862 (`a6147ff1`): every citation now names its table row (fight style 33, language file 13, encounter pool 27, plugin list 37 with entries 38a/38b, day/night 40–41, cursor sounds 42–44, joystick/colour 45–46, the minor<3 menu-plugin fallback 23′).
- Ledger dispositions (this record) → **23.12 / #851**.
- Tileset corpus coverage, `.spc`/`.ste` byte authority, the main-file conditional-rows test and focus pause in the golden double → **23.13 / #852**, partially delivered in #865 (`15ac7ba8`) for the enemy critical values, two extra named samples and the still-boots clause; the rest stays open there.
- Board thread inline-code entry (closing suite, 4.28, INFERENCE) → **23.14 / #854**, awaiting an owner ruling.
- Start-up compile failure (closing suite, 4.28) → **23.15 / #855**, awaiting an owner ruling. Its recorded owner ("Epic tk2-support") is complete and its boundaries exclude boot semantics, so the finding now names #855 as its owner.

### Resolved in substance, disposition recorded

- §4.8 bases, iso-rotated boards and flattening (2.8, 2026-10-11) — ruled by owner notes in `docs/spec/formats/legacy/older-binary-versions.md`: no default vector bases (`:87`), iso-rotated pre-vector boards refused (`:88`), shading takes the highest tinted layer (`:82`), empty slots carry no region (`:81`).
- Several §4.8 readings the converter took (2.8, 2026-10-11) — the same page now states them with OWNER markers (`:80-88`), which was the doc-first step that entry recorded as outstanding.
- `docs/format-spec.md` §10 image kinds (2.3, 2026-10-11) — `docs/spec/formats/images.md` is the authority, `formats/image/{bmp,gif}.ts` implement BMP and GIF, and ICO/WMF are explicitly dropped in `docs/spec/formats/README.md:120-121`.
- §4.2/§14 contradictions (2.5, 2026-10-11) — `docs/spec/formats/board.md` now rules the LUT, run-marker and isometric-detection questions it listed.
- Board load path refusing minors 2–3 (2.8, 2026-10-11) — the registry dispatches a pre-vector board to the converter (`packages/core/src/formats/registry/core-decoders.ts`), so a 3.0.x project loads.
- `resolveReference` with no consumer (2.9, 2026-10-11) — `engine/boot.ts:34` consumes it for the game-folder root's folder key (`Game/<projectPath>/<TypeFolder>/`); a package root builds its key from `typeFolder` directly.
- Loose-folder package form and the L1–L26 rule ids cited as §13 (2.10, 2026-10-11) — ruled in `docs/spec/formats/packaging-and-paths.md` (the loose-folder form and its rules), which is the page the loader now cites.
- `.tpk` in-package layout asserted only by fixtures (2.10, 2026-10-11) — `docs/spec/formats/packaging-and-paths.md` now pins the archive root and layout.
- Manifest missing from the feature catalogues (2.12, 2026-10-11) — `docs/editor-features.md:184-192` (T-70, T-71, T-74) documents `manifest.json { schema, main, index }`.
- Actor version-conditional fixtures (2.6, 2026-10-13) — committed examples under `docs/spec/examples/versions/` are read and round-tripped in `packages/core/test/format-actor.test.ts`; the item minors 2–7 examples were added before #829 and their round-trip loop in `8d809f41`.
- Walk-frame order (2.6, 2026-10-13) — stated by the character page's "Minor < 5 layout" and `docs/spec/formats/item.md` layout rows.
- Coordinate and version validation (2.1/2.4/2.7 review findings) — already recorded under `## Resolved` above.

### Still open, no ticket

- None. Every finding re-checked above is promoted, resolved with a recorded venue, or awaiting one of the four owner rulings (#642, #680, #854, #855).
