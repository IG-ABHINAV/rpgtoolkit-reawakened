---
type: discovery
title: "Inception proposal: epic 9 (web runner and packaging)"
date: 2026-10-31
baseline_revision: c1471b17
status: draft — awaiting owner approval
---

# Epic 9 inception proposal — draft

**This is a proposal, not a breakdown.** No `tickets.toml` has been published, no GitHub issue has been created, no
implementation has started, and no epic Note or spec file has been edited. The companion file
`tickets.draft.toml` is the draft breakdown and is deliberately named so that no tool reads it as the store's
`tickets.toml`. The stop point is the owner-approval checkpoint that `bmad-ticket` defines for an epic's inception.

Audited at `c1471b17` (the `origin/main` this worktree is cut from: *"chore(bmad): mark epic 4 done after its closure
audit (#922)"*), in the worktree `/tmp/incept-epic9`. Nothing here is claimed from the legacy source (G7); every
statement cites a file, a line or a merged commit in this repository.

---

## 1. What Epic 9 must deliver

### 1.1 The capability

CAP-12 (`spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md:58`) reads, in full:

> **intent:** The same core runs in a web runner, a headless runner, a desktop runner and a mobile runner, and games
> can be packaged for distribution (E-130…E-132).
> **success:** The sample games play in browser and under the headless runner from the same core build; a packaged
> single-file game loads.

The headless limb of that success line already exists (the closing suite boots all eight fetched games — see §2). Epic
9 delivers every other limb. The governing spine rules are AD-1, AD-3, AD-5, AD-6, AD-14 and AD-27, each cited on the
envelope's References line, plus AD-33's viewport rule for presentation scaling.

### 1.2 The five Done-when criteria, and what each one actually needs

| # | Criterion | What has to exist that does not exist today |
|---|---|---|
| 1 | The sample games play in a browser from the same core build the headless runner uses | A browser bundle of `core` + `runner-harness` from the same `tsc -b` output, a static page and asset server, an input path, and a presenter. **No** `runner-web` package exists. The comparison bar already exists: `golden/regression/closing.json` records `demo`'s tick-120 state hash as the value current at inception (previous value before the E-02 baseline re-record) and `drawHash` `9a40be8a0b5ca816` (and `Basic`'s), so a browser run can be diffed against committed values rather than a new baseline. |
| 2 | The WebGL2 replayer and the CPU rasteriser agree within the golden tolerance on the golden draw lists (G4) | The whole `render-webgl2` package: eight draw commands, the AD-3 pixel pipeline in GLSL, `pushTarget`/`popTarget` scratch targets, surfaces pull, tile/texture cache. **Nothing of it exists.** |
| 3 | A recorded input log replays to identical state hashes under Node and in a headless browser (G3) | A browser test lane (no browser runner exists in CI) plus the same `runLog` driver on both sides. `runner-harness` is already host-free, so the driver itself is reusable. |
| 4 | A packaged single-file game loads in the web and desktop runners | A packaging tool over the existing core writer (`writeDistributionPackage`, `packages/core/src/formats/package/write.ts:288` — written, tested, never called by any tool), a web loader for it, and a desktop shell. |
| 5 | The mobile wrapper runs a sample game on a device or emulator | Capacitor wiring around the web build (Capacitor 8.5.3 is pinned in the spine's Stack table) and a person with a device or emulator. |

**Baseline-history note:** The comparison values above and original tracer acceptance were written before E-02. The later E-02 demo baseline was `91172695de52cfd6` / `9a40be8a0b5ca816`; it too is historical. See `golden/regression/closing.json` for current values.


The gap is total rather than incremental. `packages/` contains only `core`, `synth`, `runner-harness`,
`runner-headless` and `plugin-tk2-compat`; `render-webgl2`, `runner-web`, `runner-desktop` and `runner-mobile` exist
only as *declared* packages in the single dependency edge list (`tools/deps/edges.json:2-18`) and in the spine's
Structural Seed, and `tools/deps/graph.mjs:140` explicitly tolerates a listed package whose directory is absent
(`if (!existsSync(directory)) continue;`). So the edge list and the diagram are already correct; the code is not.

That also means Done-when 2 does **not** wait on epic 4 — epic 4's Boundaries exclude the replayer in as many words
(`epic-board-rendering/epic-board-rendering.md:34`: *"not the WebGL2 replayer (epic web-runner-packaging)"*).

### 1.3 Inherited handoffs: satisfied versus live

The envelope's long Notes trail mixes finished handoffs with open questions. Sorting them, with evidence.

**Satisfied by merged work — no epic-9 entry needed to *produce* them (epic 9 only consumes them):**

| Handoff (quoted or paraphrased from the envelope) | Evidence in this tree |
|---|---|
| Epic 4 entry 4.6: per-command rasteriser conformance vectors (key, tint, blends, scaling, scratch targets) | `tools/fixtures/conformance/raster/vectors.json:1` — added by `570aa502` *"feat(core): complete reference rasteriser"* (2026-10-17), closed by merge `ac29907c` (PR #166). |
| Entries 4.8 and 4.9 add text vectors to the same directory | `tools/fixtures/conformance/raster/text-vectors.json` (`41f6795a`) and `truetype-vectors.json`. |
| Entry 4.26: the golden draw lists with a ledger of oracle classes (`golden/ledger.json`) | `golden/ledger.json:1` (19 rows: 12 `independent-reference`, 7 `regression-baseline`, producers 4.4/4.17/4.28/4.33/4.34), `golden/scenes/S-01.json:1`; merge `e57392c7` (PR #201). **Caveat, see §7 SC-1:** the committed artifact is a *scene recipe*, not a literal serialised draw list. |
| Entry 4.7: `engine.surfacePixels(id, rev)` for runner texture caches, and the AD-27 flush-every-frame check | `packages/core/src/ports/engine.ts:101` (`surfacePixels(id: SurfaceId, rev: number): SurfacePixels | null`); merge `ac5952db` (PR #168). `drawList(alpha?, include?)` is at `:95`. |
| Entry 4.30: breakpoints, the open-tick cursor and pause/resume | `packages/core/src/ports/engine.ts:113` (`setBreakpoints`); same merge `ac5952db`. Epic 9 does not depend on it; it is recorded because the envelope lists it. |
| Entry 4.5: the pinned Bun lane the cross-engine checks use | `package.json` scripts `golden:bun`; `.github/workflows/ci.yml:107` job `golden-bun`, required by `gate` at `:128-129`. |
| Entry 4.28: display page / bundled font-and-cursor bytes | `createEngine`'s `bundled?: ReadonlyMap<AssetKey, Uint8Array>` (`packages/core/src/engine/engine.ts`, EngineCommonInit) and `golden/closing/plan.json` `"bundled": ["media/fonts", "media/cursors"]`. |
| Epic 6's audio contract at `audio-media.md#epic9-audio-handoff` | `docs/spec/engine/audio-media.md:1718` (anchor), with `#audio-autoplay` (`:1724`), `#audio-focus` (`:1749`), `#audio-late-sounds` (`:1770`), `#audio-prefetch` (`:1789`), `#audio-soundfont-cache` (`:1817`), `#audio-browser-test` (`:1834`), `#audio-done-when` (`:1850`), `#video-policy` (`:1870`), `#video-request` (`:1894`), `#soundfont-user-bank` (`:1350`), `#cue-player` (`:1630`). Landed by `b70d6704`, merged `65c70e42` (PR #255). |
| Epic 6 entry 6.15: the language-neutral audio protocol schema and conformance vectors | `packages/synth/schema/audio-protocol-v1.schema.json:1` and `tools/fixtures/audio-protocol/vectors.json`, regenerated by `tools/fixtures/audio-protocol/generate.mjs` under `pnpm audio-protocol:check`; merge `04fc27d9` (PR #273). |
| Epic 16 entries 16.11 and 16.12: the BMP and GIF decoders, to transcode from | `packages/core/src/formats/image/bmp.ts`, `gif.ts`; one entry exports `decodeTexture` (`.../image/index.ts:73`) and `decodeGif` (`:110`) and nothing else (AD-28). Merges `e22beff4` (PR #72) and `8f2e5b62` (PR #80). |
| Epic 6's ruling that `playVideo` gains `presentation` and `video.ended` gains `reqId` | Already in code: `packages/core/src/ports/requests.ts:75` carries `presentation: "full" | "small"`. |

**Still live — these are epic 9's own work. Three of them (L-2, L-3 and L-8) exist in no epic's breakdown at all, only
in this envelope's Notes:**

| Live handoff | State in this tree |
|---|---|
| **L-1 No runner packages** | `packages/` lacks `render-webgl2`, `runner-web`, `runner-desktop`, `runner-mobile` (§1.2). |
| **L-2 The cue player does not exist** | `#cue-player` (`audio-media.md:1630`) rules that it "lives in `synth`". `packages/synth/src` has the voice state machine (`machine.ts:42` `VoiceMachine`) and the mixer (`mixer.ts:29` `TrackBusMixer`) and **no consumer of `AudioCue` at all**; 6.11's own plan says *"The cue player is not part of this ticket"* (`epic-audio-synth/story-synth-midisynth-null-backend-and-the-audiosource-seam-plan.md:25`). Its arithmetic has a reference implementation at `tools/fixtures/audio/sim.mjs:663` (`cuePlayer(cue, ready, info)`), so it can be tested without a browser. |
| **L-3 No prefetch hint on the wire** | `#audio-prefetch` names "the hint wire shape and the planner" as "a core entry at the AD-5 seam that epic 9's inception creates". `packages/core/src/ports/requests.ts:82` has eight request kinds and no hint; `grep prefetch packages/core/src` finds only a comment in `formats/audio/model.ts:33`. |
| **L-4 No browser harness at all** | Root `package.json` devDependencies are `typescript`, `@typescript/native`, `eslint`, `typescript-eslint`, `dependency-cruiser` — no Playwright, no bundler. `.github/workflows/ci.yml` jobs are `checks`, `unit`, `golden`, `golden-bun`, `gate`; `tools/no-skips/run.mjs:25-34` lists eight Node test groups. This is why epic 6's browser limb is open (issue #877). |
| **L-5 No user `.sf2` delivery** | The contract is ruled (`audio-media.md:1350` `#soundfont-user-bank`); no runner implements it. |
| **L-6 Video support unverified** | `#video-policy` says "That browsers decode VP9 in WebM and Opus on every target is **unverified** here; epic 9 verifies it". The `wasm-unsafe-eval` CSP note from 6.12 has no home that a test can assert. |
| **L-7 No packaging tool** | `writeDistributionPackage` is called only from tests (`packages/core/src/formats/package/write.ts:288`; callers `packages/core/test/format-manifest.test.ts:16`, `format-package-writer.test.ts:18`). No CLI, no editor command. T-70's *button* is an editor feature (`docs/editor-features.md:184`, P0 list at `:220`), so the pipeline/tool is epic 9's and the UI is the editor's. |
| **L-8 No offline, load mode or storage tier** | Nothing anywhere; `#audio-prefetch` and the envelope's two-load-mode assumption are unimplemented proposals. |

---

## 2. Dependency truth check

The initiative's breakdown gives epic 9 `after` epics 4, 6, 7, 8 and 16
(`initiative-rpgtoolkit-reawakened/tickets.toml:108-113`), with the stated needs "draw lists to replay", "audio cues
and synth", "battle", "menu and save", "TK2 data formats, so TK2 games load".

### 2.1 Provider state, measured

| Epic | Entries | Done | Open | Source |
|---|---|---|---|---|
| 4 `epic-board-rendering` | 37 | 37 | none | `tickets.py status` on the folder; epic marked done at `c1471b17` |
| 6 `epic-audio-synth` | 17 | 17 | none | `tickets.py status` |
| 16 `epic-tk2-support` | 13 | 13 | none | `tickets.py status` |
| 7 `epic-battle` | 35 | 34 | **7.34 / #805** (`state=planned`, `hitl=true`, type `spike`) | `tickets.py status`; `epic-battle/tickets.toml:588-600` |
| 8 `epic-menu-party-save` | 25 | 21 | **8.5 / #589** (`backlog`, blocked on an owner ruling), **8.8 / #585**, **8.13 / #594** (sweep), **8.14 / #595** (end-to-end) | `tickets.py status`; `epic-menu-party-save/discovery/epic-08-closure-audit.md:15,24` |

So the whole `after` list resolves to two open items, and one of them is a literal-hash ruling.

### 2.2 What genuinely needs 7.34 / #805

7.34 asks whether *unmodified full-state hash equality* holds between an uninterrupted battle and a real `Load`
(`epic-battle/tickets.toml:588-600`; `epic-battle/discovery/epic-07-closure-audit.md:20`). It is a question about the
**save/restore contract**, not about rendering, audio or asset delivery.

Epic 9 work that touches battle at all:

- replaying a battle frame's draw list through WebGL2 — reads `DrawList` data, needs no save hash;
- playing battle music and cues — reads `AudioCue` data;
- a packaged sample game booting to a board — the closing plan presses `ENTER` three times and stops at tick 600
  (`golden/closing/plan.json`), never mid-battle save/load.

**Nothing in epic 9 needs 7.34.** If an epic-9 test ever saved and reloaded inside a battle, it would be testing epic
8's save contract, not this epic's Done-when. The only real link is negative and worth recording: epic 9 must not
*weaken* 7.34 by asserting a normalised battle hash in a browser lane.

### 2.3 What genuinely needs 8.5 / 8.8

- 8.5 (item use, equip, remove) is blocked on an owner ruling about the menu item-use surface
  (`epic-menu-party-save/story-item-use-equip-and-remove-programs-plan.md:12-14`). Epic 9 never opens the inventory.
- 8.8 (default menu screens) is a player-facing UI slice. Epic 9's browser gate reaches the board and keeps drawing;
  it does not press Escape.
- 8.13/8.14 are epic 8's own sweep and acceptance.

**Nothing in epic 9 needs 8.5, 8.8, 8.13 or 8.14.** The one shared surface is the *save blob* the runner implements
(`saveBlob` / `loadBlob` / `listBlobs`, AD-17), and that contract is finished: 8.9, 8.10, 8.22 and 8.23 are `done`, and
the audit records criteria 3 and 4 as proven on the engine's own path
(`epic-08-closure-audit.md:18-19`).

### 2.4 The pulled-forward dependency the `after` list does not name

The real blocker on epic 9's audio limb is not in any epic's `after`: **the cue player was never built** (L-2). Epic 6
is entry-complete and still leaves it, because 6.11 excluded it by name and no other entry picked it up. Epic 9 builds
it, in `synth` where `#cue-player` puts it, against `tools/fixtures/audio/sim.mjs:663`. This is a finding worth an
owner's attention at approval: nothing is broken, but epic 6's Done-when 2 and 3 say "delivered by epic 9"
(`audio-media.md:1850`), so epic 9 carries them.

### 2.5 Consequence for the breakdown

The draft pins five cross-epic entries, each to the artifact its check actually consumes:

| Pin | On entry | What it delivers |
|---|---|---|
| `"4.6"` | 4 | the per-command raster conformance vectors the replayer is checked against |
| `"4.26"` | 4 | the 19 gating ledger rows (12 independent-reference scenes, 7 closing frames) |
| `"6.15"` | 5 | the runner audio protocol schema and the vectors the cue player is checked against |
| `"8.9"` | 9 | the canonical save path whose blobs the browser stores and restores |
| `"16.8"` | 14 | the TK2 decoder registration that lets the six TK2 corpus games load |

Two things are deliberately *not* pinned, with reasons:

- **2.12** (the distribution-package writer) on entry 7. Epic 9's `after` does not declare epic 2, so pinning it would
  be `undeclared_after`; the writer is merged, and the honest fix is for the owner to add epic 2 to the epic's `after`
  (ask A-04) rather than the draft inventing a declaration.
- **Epic 7** is not pinned anywhere. It stays in the epic's `after` as written, so `tickets.py` reports exactly one
  `unpinned_after` row for `epic-battle`. That row is the dependency-truth finding, not an omission: 34 of 35 entries
  are done, the open one is 7.34 / #805, and no entry here reads it. Ask A-03 puts the two honest remedies to the owner.

**Nothing in epic 9 is blocked by epic 7 or epic 8.** The first three entries can start as soon as the owner approves
the rulings.

---

## 3. The decision list

Six questions the envelope defers to inception, then five that the same Notes and spine text force to a decision and
that would otherwise be decided silently by whoever builds first. Each gives a recommendation, the evidence, the
rejected alternative and what changes if the owner rules the other way. **None of these is decided in the repository
by this document**; entry 1 of the draft records them.

### D-1 — The desktop shell spike: who runs it, and how the choice is made

**Recommendation.** Epic 9 owns a *runner* shell spike and records the result as an ADR; epic desktop-shell consumes
the same ruling for the editor and does not run a second spike. The spike covers all three candidates on all three
desktop OSes and is measured on the runner alone — bundle size, cold start to first frame, WebGL2 availability in the
WebView, audio output, and loading a distribution package from disk — with Linux WebKitGTK treated as the risk case.
No shell is chosen before that evidence exists.

**Evidence.** `docs/architecture-options.md:259-264` names exactly this spike and its axes ("Spike the board editor and
the game runner on all three desktop OSes (Linux WebKitGTK especially) before choosing"), so the runner half is
already scoped to this epic's boundary. ADR 0001 decision 6 defers the choice to a spike and calls it reversible
through platform services. `epic-desktop-shell/epic-desktop-shell.md` boundaries read "The spike and `host-desktop`
chrome. Not the runner wrapper, which epic web-runner-packaging owns" — the *wrapper* is epic 9's, and the wrapper is
what Done-when 4's desktop limb needs. Epic desktop-shell also waits on `editor-assets-p0`, which has no breakdown and
no code, so hanging Done-when 4 on that epic would make it unreachable for the wrong reason.

**Rejected alternative.** Epic desktop-shell runs the spike and epic 9 waits. It is the literal reading of that
epic's boundary, but it serialises Done-when 4 behind an epic that is itself waiting on an unbroken-down editor epic,
and the runner needs a shell regardless of what the editor picks.

**Consequences.** One entry (10, `hitl`) and one ADR. If the owner instead assigns the spike to desktop-shell, entry 10
becomes a consumer of a ruling and entry 11 (runner-desktop) moves behind it — and Done-when 4's desktop limb cannot be
verified until epic desktop-shell runs, which the owner may prefer to accept.

> **Note added 2026-10-31 (after approval; this section is the record of what was reviewed, not live guidance).** D-1 is
> **ruled**: the owner decided that the harness is separate from the game bundle — a game is a package installed into a
> player's library with a configured default game — and that there are **two desktop applications from one codebase**
> (a player and an editor) plus the PWA, both applications on the same ruled Electron shell with `app://`. No shell
> comparison is re-run and no candidate is chosen by measurement. Entry 10 builds and measures the **player**; entry 11
> is the player's desktop package; epic desktop-shell owns the **editor** application and cites the same ADR. The ruling
> text is D-1 in `../story-rulings-the-runner-boundary-the-desktop-shell-image-storage-plan.md`.

### D-2 — The stored image format: keep the original bytes, or transcode BMP/GIF

**Recommendation.** **No transcode at v1, and no WebP.** A game package stores each image exactly as the game holds it;
`core/formats/image` decodes PNG, JPEG, BMP and GIF in pure TypeScript (AD-28), so the browser never decodes these
bytes itself and browser-native format support is irrelevant to whether a game plays. Revisit transcode as a *size*
optimisation only after the tracer measures a real package. If a canonical format is wanted for assets the editor
*writes*, PNG (indexed where the picture has 256 colours or fewer) — the envelope's own assumption — is the choice, and
JPG is never transcoded.

**Evidence.** AD-28: "`core/formats/image` decodes game images … to straight RGBA", exported as `decodeTexture` and
`decodeGif` and nothing else (`packages/core/src/formats/image/index.ts:73,110`); every image therefore arrives in a
runner as *bytes* through the AD-5 `asset` request, not as an `<img>`. Both decoders are done (epic 16.11/16.12). The
corpus is small: the only measured figure in the tree is a 134-file, 6.3 MB corpus of two sample games with a largest
file of 430,086 bytes (`docs/spec/formats/packaging-and-paths.md:112`). WebP lossless would need a second pure-TS
decoder inside `core` (G2/G3) and a licence-checked encoder; `sharp` is out under G6 because libvips is LGPL, which the
envelope already records. A PNG *encoder* exists today only in the harness (`packages/runner-harness/src/png.ts`), so
"transcode on import" is not one line even once it is wanted.

**Rejected alternative.** Transcode every BMP and GIF to PNG at import and add lossless WebP beside PNG. It changes
`docs/spec/formats/` (a new import-policy section), needs an encoder inside the shipped tree, and buys bytes on a
corpus that is already smaller than a single modern web page.

**Consequences.** If ruled the other way, a new doc-first spec section plus an encoder entry are added, and entry 7
(packaging) gains the transcode step; epic 2's package import (`2.10` the loader, `2.12` the writer) is the natural seat and the owner may
prefer to move the work there, which the envelope explicitly allows ("it may move to another epic at inception",
Decision 2026-10-12).

### D-3 — The runner boundary: one language-neutral contract, or TypeScript only

**Recommendation.** **One contract, written as prose plus data, and proved by one vector kit.** Write
`docs/spec/engine/runners.md`: what a runner owes the core and what it may decide, for draw-list replay, audio, input
events and AD-5 requests; publish one JSON Schema beside the existing audio one; and make the vector kit the arbiter —
`render-webgl2` and `runner-web` prove themselves by replaying vectors, exactly as the audio binding already does. Do
**not** publish a second independent implementation to prove the schema.

**Evidence.** The owner direction is recorded in `epic-audio-synth/discovery/audio-exploration.md:§12` ("a runner may
not be written in TypeScript, but it must have the same shape … a normative behaviour page, a language-neutral message
schema and conformance vectors"). The pattern is already proven twice in this tree: raster vectors are plain JSON
(`tools/fixtures/conformance/raster/vectors.json:1`, plus text and TrueType vectors), and the audio protocol has both a
schema (`packages/synth/schema/audio-protocol-v1.schema.json:1`) and vectors with a generator that `--check`s them
(`tools/fixtures/audio-protocol/generate.mjs`, `pnpm audio-protocol:check`). AD-1 already guarantees every engine
argument and result is structured-cloneable plain data, which is the property a non-TS runner needs. AD-3's pixel
pipeline is normative in prose and is what the GLSL will implement.

**Rejected alternative.** TypeScript-only: ship `render-webgl2` and `runner-web` and let the TypeScript types be the
contract. Cheapest by a wide margin, and it is what most of this epic's entries actually build. It fails the owner's
stated direction and it makes the desktop and mobile wrappers — the two places where a native or WebView-specific
reimplementation is most likely — unverifiable.

**Consequences.** Decision D-3 is what makes entry 2 a real entry rather than a docs formality, and it costs one
schema, one page and one vector format. If the owner rules TypeScript-only, entry 2 shrinks to a page that documents
the runner's responsibilities for our own runners, the JSON Schema is dropped, and entries 4 and 5 verify against
TypeScript fixtures only — saving perhaps one entry of work across the epic.

### D-4 — Load modes, the threshold, and who computes the prefetch plan

**Recommendation.** Two load modes as the envelope proposes — whole-package below a threshold, streaming above it —
but **the threshold is measured, not assumed**, and **the core computes the prefetch plan** while the runner only
fetches and decodes. The manifest gains no per-entry hash at v1: the package is cached under one content hash of its
own bytes.

**Evidence.** The core already has the seam: `AssetIndex` plus blocking `asset` requests (AD-5), a synchronous
`ProgramLoader.read` (`packages/core/src/script/loader.ts:24-29`) which the whole-package mode satisfies naturally and
which streaming does not, and `#audio-prefetch`'s tier table for audio's share. The two volume figures in the envelope
("about 64 MB", "largest about 33 MB uncompressed") are **unsourced** — the only measurement in the tree is 6.3 MB for
two games (`docs/spec/formats/packaging-and-paths.md:112`) — so the tracer measures the fetched `fixtures/` corpus
instead. On the manifest: `docs/spec/formats/packaging-and-paths.md:98-106` says the manifest has **exactly three
fields** and a reader "refuses a manifest with any other field", and the write must stay byte-identical (G3); adding
`sha256`/`size` per `index` entry is therefore an AD-6 and spec amendment for delta updates, which v1 does not need
because one package-level hash gives an immutable Cache Storage key. The ZIP reader already parses each entry's CRC-32
and sizes (`packages/core/src/formats/package/zip.ts:83,178`), so per-entry keys remain a cheap later step if delta
updates are wanted.

**Rejected alternative.** Stream everything from the start, with a second board parser per runner guessing what to
prefetch. It duplicates the board reader in every host (explicitly rejected in `#audio-prefetch`) and makes the first
load of every game a stall.

**Consequences.** If the owner wants per-entry hashes now, entries 7 and 9 gain an AD-6 + `docs/spec/formats/`
amendment and the writer/reader round trip must be re-proved byte-identical; if the owner drops streaming entirely,
entry 9 loses its streaming half and Done-when 1-3 are unaffected.

### D-5 — The service worker and offline play

**Recommendation.** **Yes, at v1, but scoped to one artifact: the player.** A service worker caches the app shell and
the whole-package download, updates on next launch and never mid-session (the spine's own rule), and stores save blobs
through the existing `saveBlob` contract. No background sync, no push, no accounts.

**Evidence.** The spine fixes the operational envelope including the CSP (`worker-src blob:`, `script-src 'self'
'wasm-unsafe-eval' blob:`, no `unsafe-eval`) and the update policy (`architecture-rpgtoolkit-reawakened.md:497`); the
player is offline-first by design and a legacy game is a small download. The line that must be drawn: `host-web` is the
*editor* PWA (epic editor-foundation), so the player is a second, separate artifact with its own shell; epic 9 must not
build editor chrome and must not promise a hosting/deploy pipeline — the spine defers publishing to "release epics,
owners named at their inception", and epic 17's proposal D-13 says the same.

**Rejected alternative.** Defer offline to a release epic. It leaves `navigator.storage.persist()`, quota fallback and
the "kept offline" half of the envelope's load-mode assumption unowned, and the service worker is the only piece whose
*cache key policy* has to be decided alongside D-4.

**Consequences.** One entry (9) plus a deployment decision that stays out of scope. If deferred, entry 9 shrinks to
storage tiers and the stall presentation, and the envelope's "kept offline" claim is struck from Done-when 1's
narrative (it is not one of the five criteria).

### D-6 — The mobile wrapper's scope

**Recommendation.** **Runner only, Capacitor only, one platform proved at v1.** `runner-mobile` wraps the web build
with Capacitor 8.5.3 and must boot a sample game on a real device or emulator; store submission, signing, icons,
splash screens and per-platform chrome are explicitly out (ADR 0001/0005: release work has no owner yet).

**Evidence.** The spine pins Capacitor 8.5.3 and lists `runner-mobile` as "`runner-web` in Capacitor"
(`spec-rpgtoolkit-reawakened/packages.md:14`); the edge list already has `["runner-web", "runner-mobile"]`
(`tools/deps/edges.json`). Done-when 5 says "a device or emulator", which is a person's check, so the entry is `hitl`.

**Rejected alternative.** Tauri mobile (the spike might prefer it for desktop) or a native shell. Tauri 2's mobile
caveats are recorded as a risk in `docs/architecture-options.md` sources and it would double the shell work; a native
shell contradicts G2/G4's "one core, replaying draw lists".

**Consequences.** If the owner wants store-ready mobile at v1, this epic grows a signing/publishing limb it cannot
finish (no accounts, no owner), and that belongs in a release epic instead.

### D-7 (emergent) — What "within the golden tolerance" means for the WebGL2 comparison

**Recommendation.** Exact equality for **colour-key decisions and tint**, a bounded difference for **blend arithmetic**
— per the AD-3 check's own split — with the bound stated as at most 1 per channel and the worst case reported per
vector. Do not widen the golden policy for PNG comparisons, which is exact for `independent-reference` and
`regression-baseline` rows (`docs/spec/engine/parity-checklist.md:30`).

**Evidence.** AD-3's check says "per-command CPU-vs-WebGL2 conformance fixtures with **exact** match for key and tint"
(`architecture-rpgtoolkit-reawakened.md:111`), while G4's prose says key and tint exact and "images otherwise within the
golden tolerance" (`docs/guardrails.md`, G4 enforcement). The CPU pipeline uses integer division
(`(dst·(255−a) + c·a + 127) / 255`) that GL's float blend cannot reproduce bit-exactly on every driver. Epic 9's
Done-when 2 says "within the golden tolerance", so the tolerance has to be written down once.

**Rejected alternative.** Exact equality everywhere. It is honest but unachievable across drivers, and chasing it
produces driver-specific hacks — exactly the kind of thing G4 exists to prevent.

**Consequences.** One paragraph in `docs/spec/engine/runners.md`; if the owner wants exact-everywhere, entry 4 gains a
software-blend fallback path for the affected commands and its scope roughly doubles.

### D-8 (emergent) — The web build tool: esbuild, or Vite with an ADR

**Recommendation.** **esbuild**, already pinned at 0.28.2 in the spine's Stack table, with a tiny static server for the
player page and the browser test fixtures. Avoid Vite 8 for now.

**Evidence.** The spine's Deferred list says: "Vite 8 depends on `lightningcss` (MPL-2.0). Before the first Vite
install (epics web-runner-packaging and editor-foundation), an ADR names it as a dev-only tool, or the web builds use
esbuild instead" (`architecture-rpgtoolkit-reawakened.md:545`). The spine also requires the engine worker and
AudioWorklet to be "single-file IIFE bundles with no runtime `import()`" (`:497`), which is esbuild's native mode.
esbuild is already the declared bundler for `host-vscode` (AD-22). Root `package.json` has neither tool today.

**Rejected alternative.** Vite, for HMR and a dev server. It costs an ADR for a copyleft-ish (MPL-2.0) transitive
dependency that only ever runs on a developer's machine, and this epic does not need HMR to ship.

**Consequences.** If the owner prefers Vite, entry 1 must also land the `lightningcss` ADR before entry 3, and entry 3's
build script changes. If the owner wants neither, the epic cannot ship a browser bundle.

### D-9 (emergent) — The browser test lane's shape

**Recommendation.** **Playwright** (pinned 1.64.0 in the spine), one headless Chromium lane, its own required CI job
grouped into the existing `gate`; the test serves the fetched `fixtures/` folder over a local static server. Owner rule
applies: keep each browser test under a second where it can be, and prove cross-layer contracts with the smallest
scenario.

**Evidence.** The spine's Stack pins Playwright 1.64.0 for "headless-browser tests" and `#audio-browser-test` already
says "the browser tool pinned in the spine is Playwright". Playwright is Apache-2.0 (G6 fine) and dev-only. CI's `gate`
job takes `needs: [checks, unit, golden, golden-bun]` (`ci.yml:128-129`), and `tools/no-skips/run.mjs:25-34` enumerates
the eight Node groups a new package must be added to.

**Rejected alternative.** A second Node lane pretending to be a browser (Bun/Deno), or a WebDriver setup. Neither
proves WebGL2 or Web Audio, which are the two things Done-when 2 and 3 exist to prove.

**Consequences.** A browser lane in CI, plus a `fixtures:fetch` dependency in it. If the owner rejects Playwright, the
epic cannot verify Done-when 2, 3 or 5's audio limb, and the epic should stop rather than weaken them.

### D-10 (emergent) — SF3, `wasm-unsafe-eval`, and where the CSP note lives

**Recommendation.** Ship with **SF2 only** (no WebAssembly, so the default path needs no `wasm-unsafe-eval`), keep the
`'wasm-unsafe-eval'` allowance in the CSP only if an SF3 or user bank is loaded, and put the note in the runner page
with a test that asserts the default path starts with no WebAssembly instantiation.

**Evidence.** `#audio-browser-test` (`audio-media.md:1834`) says SF2 needs no WebAssembly and calls the SF3 requirement
"**unverified**", naming 6.12 as the entry to confirm it. 6.12 is done and the spine now records it under Operations
(`script-src 'self' 'wasm-unsafe-eval' blob:`), but no repository file states the *conditional* rule, and `#path-b-bank`
(`audio-media.md:1387-1457`) leaves the bundled bank unresolved: if the Path B candidate fails its provenance bar, the
default bank becomes TK-16 and a user `.sf2` may be SF3.

**Rejected alternative.** Always allow `wasm-unsafe-eval`. It widens the shipped CSP for a path most games never take.

**Consequences.** One paragraph and one assertion; if the owner rules for an SF3 default, the CSP note becomes
mandatory and entry 5's verification gains a WebAssembly assertion.

### D-11 (emergent) — Where the player's page and its "game library" live

**Recommendation.** Inside `runner-web`, as a **declared `./app` subpath** rather than a new package: the player is one
static page plus a bundle, and `host-web` (the editor PWA) stays epic editor-foundation's. AD-22 currently allows
`src/index.ts` "plus `./testing` where needed", so the subpath needs the same one-line amendment in the AD-22 list and
in `tools/deps/edges.json`'s package contract.

**Evidence.** `packages.md` gives `runner-web` both roles already ("Also the preview runner inside editor hosts"),
AD-22 requires one public entry per package plus a declared `./testing`-style subpath, and the edge list has no package
for a player page. Adding a package means editing `tools/deps/edges.json` and the spine diagram, which the owner has to
review for a page with one job.

**Rejected alternative.** A new `apps/player` package. Cleaner separation, but it changes the single edge list and the
structural seed for a template file.

**Consequences.** Entry 1 records the AD-22 amendment and entry 3 declares the subpath, so no builder invents a second
convention. If the owner prefers a separate app package, entry 3 also edits `tools/deps/edges.json`, the spine's
Structural Seed and its generated diagram — mechanical, but its own reviewed change.

---

## 4. Proposed breakdown

14 entries in build order, one lane each so two entries never edit the same files. The tracer bullet is entry 3; the
epic closes with a sweep and an end-to-end suite, as `bmad-ticket` requires for an epic of more than three entries.

| # | Title | Lane | After | hitl | Kind | Verification (one runnable check) |
|---|---|---|---|---|---|---|
| 1 | Rulings: the runner boundary, the desktop shell, image storage, load modes and mobile scope | A docs | — | **yes** | judgement | One merged Notes section carries dated owner lines for D-1, D-3, D-4, D-5, D-6, D-8, D-9 and the four `Source conflict:` lines; the rest are decided or open with a named owner; each amendment is its own docs commit |
| 2 | The runner contract page, its message schema and the vector kit | A docs | 1 | no | judgement | `docs/spec/engine/runners.md` exists with an anchor per record kind, the schema validates the check-in vectors, and a `--check` generator fails when either drifts |
| 3 | **Tracer bullet:** a sample game boots and presents a frame in a headless browser from the same core build | B browser | 2 | no | mechanical | One Playwright run boots `demo` from the served fixture folder in headless Chromium and reports tick 120's state and draw hashes from `golden/regression/closing.json`; the same run reports the video and no-WebAssembly capability probes; the job is a required `gate` dependency that fetches fixtures first |
| 4 | `render-webgl2`: the WebGL2 replayer, the presented frame and the runner's presenter | B replay | 3, 4.6, 4.26 | no | judgement | Every raster/text/truetype vector and every gating ledger scene replays through WebGL2 in headless Chromium, exact on key and tint and within the D-7 bound on blends, reported per vector; and the runner-web cache-flush-every-frame test is pixel-identical to the reference rasteriser |
| 5 | `synth`: the cue player, and `runner-web`'s Web Audio output | C audio | 2, 3, 6.15 | no | judgement | The cue player matches `tools/fixtures/audio/sim.mjs`'s `cuePlayer` arithmetic on every vector, and a browser test observes non-silent output of the expected `AudioInfo` length |
| 6 | `runner-web`: SoundFont resolution, the shared bank cache and a user `.sf2` | C audio | 5 | no | mechanical | A browser test plays a MIDI through a user-chosen `.sf2` and proves one cached bank reused across two games by SHA-256, with eviction leaving the in-use bank |
| 7 | Packaging: the `make-package` tool and loading a distribution package in the web runner | D package | 3 | no | mechanical | `pnpm make-package <game>` writes a package that reloads to identical file bytes and a three-field manifest, and the web runner boots it in headless Chromium to `demo`'s tick-120 hash with no folder access |
| 8 | Core: the prefetch planner and the AD-5 hint wire | E load | 2 | no | judgement | The engine emits the ruled tiered hints; the union, `HOST_REQUEST_KINDS` and `isRequest` all carry the new kind; and `pnpm golden`/`closing` hashes are identical against a hint-consuming host and a discarding one |
| 9 | Load modes, storage tiers and the offline service worker | E load | 3, 7, 8, 8.9 | no | judgement | A second launch serves the game from cache with the network blocked and boots to `demo`'s tick-120 hash, a save written before that reload restores under the same `GameId`, and every blocking stall in a streaming run is on an unhinted asset |
| 10 | Desktop shell spike: Tauri, Electron and Electrobun on the runner | F desktop | 3, 7 | **yes** | judgement | The spike reports bundle size, cold start, WebGL2, audio and loading entry 7's package on three OSes, and a person rules the shell in an ADR that entry 11 consumes |
| 11 | `runner-desktop`: a package from disk boots the same frame | F desktop | 7, 10 | no | mechanical | The desktop runner opens a distribution package from the filesystem and reports the same tick-120 hashes as the web runner and the closing baseline, and a save it writes loads in the web runner under the same `GameId` |
| 12 | `runner-mobile`: the Capacitor wrapper on a device or emulator | F mobile | 3, 5 | **yes** | mechanical | The Capacitor build runs `demo` to the board on a device or emulator, confirmed by a person |
| 13 | Refactor sweep | G close | 1–12 | no | judgement | The deferred cleanups recorded in the twelve plans land, and `checks`, `golden`, `golden:bun` and the browser lane pass with unchanged goldens |
| 14 | Closing suite: the sample games in browser and desktop, the packaged file, and the CAP-12 signal | G close | 13, 16.8 | no | judgement | One run plays all eight games of `golden/closing/plan.json` in the browser to their recorded outcomes and `demo`/`Basic` on desktop, loads the packaged file in both, and reports identical per-tick hashes between Node and headless Chromium |

### 4.1 Lanes, and why no two live entries collide

| Lane | Entries | Files it owns |
|---|---|---|
| A docs | 1, 2 | the epic's Notes (1), `docs/spec/engine/runners.md`, the schema, the vector generator (2) |
| B browser | 3, 4 | `packages/runner-web/{src,app}` (3 — the package, its `src/index.ts` and `./app`, its `tsconfig` reference and its `tools/no-skips` + CI `unit` rows), `packages/render-webgl2/**` (4 — with its own group and matrix row), `tools/browser/**` |
| C audio | 5, 6 | `packages/synth/src/cue-player.ts`, `packages/runner-web/src/audio/**` |
| D package | 7 | `tools/make-package/**`, `packages/runner-web/src/assets/**` |
| E load | 8, 9 | `packages/core/src/{engine,ports,script/manifest.ts}`, `packages/runner-harness/src/driver.ts` for the hint (8); `packages/runner-web/src/storage/**` and the service worker (9) |
| F desktop/mobile | 10, 11, 12 | `packages/runner-desktop/**`, `packages/runner-mobile/**` |
| G close | 13, 14 | whatever the plans deferred |

The only shared file is `packages/runner-web/src/index.ts`: entry 3 writes it, and entries 4 (the presenter), 5
(audio), 7 (the package source) and 9 (storage) each add one export line. `after` sequences them, so one owner holds it
at a time. Everything else is disjoint. Two new packages (`runner-web`, `render-webgl2`) also mean two new
`tools/no-skips` groups and two new CI `unit` matrix rows, which each entry creates for its own package because
`tools/no-skips/run.mjs:110-136` fails an ungrouped or empty group.

### 4.2 The two entries that can run in parallel

**Entry 4 (`render-webgl2`) and entry 8 (the core prefetch planner).** Both start once entry 3's browser harness
exists, they touch different packages (`packages/render-webgl2` and a `runner-web` presenter module vs `packages/core`
and one guard line in `runner-harness`), they share no config, schema or test group, and their checks are independent
(a browser replay vs `pnpm golden`). Entry 8 can in fact start beside entry 3, since nothing in it touches the browser.

A second pair — **entry 5 (audio) and entry 7 (packaging)** — is also disjoint in code (`synth`/`runner-web/src/audio`
vs `tools/make-package` and `runner-web/src/assets`), and I would run it as a pair with a single owner for
`runner-web/src/index.ts`'s export line.

### 4.3 Mechanical versus judgement

- **Mechanical** (the check is a command and the design is fixed by a ruling or an existing artifact): 3, 6, 7, 11, 12.
- **Judgement** (the builder must design against a normative page or a measured result): 1, 2, 4, 5, 8, 9, 10, 13, 14.
- **`hitl`**: 1 (the rulings themselves), 10 (three OSes and an owner's choice), 12 (a device in hand).

---

## 5. What starts now, and what gates on what

Nothing starts until the owner approves, and approval is this document plus `tickets.draft.toml` becoming the store's
`tickets.toml` with ids and a GitHub parent issue (`tools/create-epic-on-github.py` refuses without one, which is issue
#882's root cause).

If approved as written: entries 1 and 2 run first (documents), then entry 3 (the tracer) opens the browser lane, and
from there entries 4, 5 and 8 fan out; 6, 7, 9 follow; 10, 11 and 12 close the wrappers; 13 and 14 close the epic.

Cross-epic: **nothing is gated**. Epic 7's 7.34 and epic 8's four open items are not read by any entry in this draft.
Every pinned provider (`4.6`, `4.26`, `6.15`, `8.9`, `16.8`) is already merged, so each pin documents provenance rather
than waiting. The publication step itself needs the owner's four asks (§8.1) and then, in order: merge the envelope's
two Notes sections, refresh epic 9's `after` in the initiative breakdown (epics 2 and 7), write `tickets.toml`, run
`tickets.py status` once more, and only then create the GitHub parent issue and attach children.

---

## 6. Check report

### 6.1 Mechanical

`tickets.py` was run against a scratch copy of this initiative under `/tmp`, with `tickets.draft.toml` copied in as
`tickets.toml`, so that no `tickets.toml` was created in the repository:

```
cp -R _bmad-output/initiative-rpgtoolkit-reawakened /tmp/incept9-check/ \
  && cp .../epic-web-runner-packaging/tickets.draft.toml .../epic-web-runner-packaging/tickets.toml \
  && uv run ~/.agents/skills/bmad-ticket/scripts/tickets.py --project-root /tmp/incept9-check \
       status initiative-rpgtoolkit-reawakened/epic-web-runner-packaging
```

Final result: `problems: null`, `undeclared_after: []`, `order_conflict: []`, `counts: {total: 14, planned: 14}`, and
exactly one `unpinned_after` row — `epic-battle`, which is the finding of §2.5 and ask A-03, not an omission. An
earlier run also reported `undeclared_after` for the `2.12` pin; the draft no longer pins it (see §2.5).

The initiative-level `status` on the whole folder is also clean (`problems: null`), and epic 9's `blocks` and
`gated_by` are both empty, so no other epic waits on an entry of this one.

### 6.2 Independent review

An independent reviewer was given `references/validate-checks.md` (Ticket, Set, Dependencies), this proposal, the
draft, the epic envelope, the provider breakdowns, the spec pages the entries cite and the code they claim to reuse,
with G7 restated. It returned six blocking findings, five suggestions and two asks. Every one is dispositioned below;
none was dismissed without a reason.

### 6.3 Findings and dispositions

| # | Finding | Disposition |
|---|---|---|
| F-01 | Entry 7's `"2.12"` pin is `undeclared_after` — epic 9 never declares epic 2 | **Fixed:** the pin is gone and 2.12 is a `reference`; the declaration question is ask A-04 |
| F-02 | Three whole-epic `after` items are pinned by nobody (epics 7, 8, 16) | **Partly fixed:** `"8.9"` now pins entry 9 and `"16.8"` pins entry 14; epic 7 stays unpinned on purpose and is ask A-03 |
| F-03 | The draft's header denied the pins its own entries carry | **Fixed:** the header now lists every pin with its reason |
| F-04 | The shell spike measures package loading but does not wait for the packaging entry | **Fixed:** entry 10 is `after = [3, 7]` |
| F-05 | Nothing wires `render-webgl2` into `runner-web`; AD-27's cache-flush check has no owner | **Fixed:** entry 4 now makes it the runner's presenter and owns that check |
| F-06 | Two new packages break the `tools/no-skips` group partition and the CI `unit` matrix, unowned | **Fixed:** entries 3 and 4 each create their own group and matrix row, with the reason stated |
| F-07 | A new request kind also trips `HOST_REQUEST_KINDS`, AD-17's list and `runner-harness`'s `isRequest` | **Fixed:** entry 8 names all three consumers; its verify compiles the union and observes the hint |
| F-08 | The video-profile probe and the no-WebAssembly assertion have no owning entry | **Fixed:** both are now probes in entry 3's run, which is where the browser lane lives |
| F-09 | D-11's second entry point contradicts AD-22, unamended | **Fixed:** entry 1 records the AD-22 amendment for a declared `./app` subpath; entry 3 declares it and entry 4 relies on it |
| F-10 | The envelope has two `## Notes` headings | **Recorded, not fixed here:** merging them is entry 1's first act; editing the envelope now would pre-empt the approval checkpoint |
| F-11 | §6.3 of this proposal was a placeholder | **Fixed:** this table |
| F-12 | The envelope's `E-130 to E-132` link does not resolve; E-132 is in `display-input-audio.md` | **Recorded, not fixed here:** entry 1 repoints it, for the same reason as F-10 |
| F-13 | The four `Source conflict:` lines sit in this proposal, not in the container's Notes | **Fixed in the draft, recorded here:** entry 1 adds them to the epic's Notes as its first act (the proposal cannot edit the envelope before approval) |
| S-01 | Entry 3 never says it creates the `runner-web` package | **Fixed:** it names the package, `src/index.ts`, the `tsconfig` reference and its CI rows |
| S-02 | Entry 10's handoff to entry 11 is stated on one side only | **Fixed:** entry 10 names entry 11 as the ADR's consumer |
| S-03 | Entry 8's "hints on and off" needs a switch nobody builds | **Fixed:** the check is restated as two hosts, one consuming and one discarding hints, with no new knob |
| S-04 | Entry 1 could leave gating rulings open | **Fixed:** entry 1's verify requires dated lines for D-1, D-3, D-4, D-5, D-6, D-8 and D-9 |
| S-05 | The browser job boots a fetched game without saying it fetches fixtures | **Fixed:** entry 3's job runs `pnpm fixtures:fetch` first |
| A-01 | Who owns the desktop shell spike (D-1) | **Ask, recommendation unchanged:** epic 9 owns the runner half, epic desktop-shell consumes the ADR — see §8 |
| A-02 | Does entry 4's CAP-6 belong in the epic's cover? | **Ask:** the draft keeps CAP-6 with the note; the cleaner edit is to add CAP-6 to the envelope's `covers` with one sentence naming the replayer — see §8 |

The reviewer's verdict was that all five Done-when criteria have an entry whose verify proves them (1: 3 + 14; 2: 4;
3: 14; 4: 7 + 11 + 14; 5: 12) and that the draft should not go to the owner until F-01, F-02, F-04, F-05 and F-08 were
resolved. Those five are resolved above, with the epic-7 half of F-02 turned into a named ask rather than a fake pin.

---

## 7. Source conflicts, unverified assumptions and deferred scope

- **SC-1 — the golden draw lists are recipes, not files.** The envelope's handoff says entry 4.26 "commits the golden
  draw lists". It commits scene descriptors (`golden/scenes/S-01.json:1`), the reference PNGs and the ledger; the draw
  list itself is produced by the engine at replay time (`packages/runner-harness/src/scene-golden.ts`, `pnpm golden`).
  Epic 9 therefore *replays the scenes* rather than reading draw-list JSON; entry 4's verification says "ledger scene",
  not "draw-list file".
- **SC-2 — `manifest.json` "gains a content hash and size" contradicts the spec that says exactly three fields.**
  `docs/spec/formats/packaging-and-paths.md:98-106` fixes the manifest at `schema`, `main`, `index` and requires a
  reader to refuse any other field; AD-6 repeats it. D-4 resolves it by not adding fields at v1.
- **SC-3 — the 64 MB / 33 MB figures have no recorded source.** The only corpus measurement in the tree is 6.3 MB for
  two games (`docs/spec/formats/packaging-and-paths.md:112`). D-4 makes the threshold measured.
- **SC-4 — the desktop-shell spike is claimed by two epics.** `docs/architecture-options.md:264` scopes it to "the board
  editor and the game runner"; `epic-desktop-shell`'s boundary claims "the spike" and disclaims only the runner
  wrapper; epic 9's Notes ask "decide which epic runs the spike". D-1 recommends the runner half here.
- **SC-5 — epic 6 is entry-complete without the cue player.** 6.11's plan says it is out of scope; `#cue-player` puts
  it in `synth`; nothing built it. Epic 9 carries it (entry 5).
- **U-1** PWA install and Safari eviction behaviour are unverified (the envelope says so). Entry 9 measures rather than
  claims; `navigator.storage.persist()` returning false must be a reported state, not a silent fallback.
- **U-2** VP9/WebM/Opus browser support is unverified (`audio-media.md:1870`). Entry 3's browser lane is the first
  place it can be checked; if a target fails, D-6's contract amendment comes before the importer exists.
- **U-3** The bundled SoundFont is still unresolved (Path B candidate vs TK-16, `audio-media.md:1387-1457`). Entry 6
  must work with either and must not assume a bank ships.
- **U-4** A WebView's WebGL2 support floor is decided by D-1's spike; the spine says so.

Two defects in the envelope itself were found and are deliberately left for entry 1 rather than fixed here, because
editing the envelope now would pre-empt the approval checkpoint: its **two `## Notes` headings** (lines 28 and 49)
must become one, and its References line cites `main-loop-and-startup.md#e-130 to E-132` where E-132 is defined in
`display-input-audio.md`. SC-1 to SC-4 are conflicts of *this* envelope's own Notes, so entry 1 writes them into that
merged section as its first act, which is where `slice.md` puts them. SC-5 is not: it is a defect in epic 6's own trail
(its source says the cue player is in `synth`, its breakdown built everything but that), so it is recorded here for the
owner and belongs in `epic-audio-synth`'s Notes when that epic closes — not asserting it on epic 6's behalf is
deliberate.

**Deferred out of this epic, deliberately:** the editor's T-70 "Make package" button and any editor packaging UI (epic
editor-assets-p0); the editor PWA's shell and service worker (`host-web`, epic editor-foundation); hosting, domains,
signing, store accounts and the release pipeline (no owner; epic 17's D-13 says the same); a native or WASM renderer or
synth (AD-30's escape hatch); the desktop-shell epic's editor chrome.

---

## 8. Rulings that would change the breakdown

| Ruling | Effect on this draft |
|---|---|
| Desktop shell spike goes to `epic-desktop-shell` (D-1) | Entry 10 becomes a consumer and entry 11 moves behind that epic; Done-when 4's desktop limb is unverifiable until it lands |
| Transcode BMP/GIF at import (D-2) | New docs section + encoder entry, or the work moves to epic 2; entry 7 gains a step |
| TypeScript-only runner boundary (D-3) | Entry 2 shrinks to a responsibilities page; the schema is dropped |
| Per-entry content hashes in `manifest.json` now (D-4) | Entries 7 and 9 gain an AD-6 + spec amendment and a byte-identical round-trip re-proof |
| No offline mode (D-5) | Entry 9 loses its service-worker half |
| Vite rather than esbuild (D-8) | Entry 1 also lands a `lightningcss` ADR before entry 3 |
| No Playwright (D-9) | The epic cannot verify Done-when 2, 3 or 5 — stop, do not weaken them |
| A separate player app package (D-11) | Entry 3 also edits `tools/deps/edges.json` and the spine's Structural Diagram; the AD-22 `./app` amendment in entry 1 is dropped |

### 8.1 The asks, numbered

- **A-01 (D-1): who runs the desktop shell spike.** Recommend epic 9 runs the runner-only spike and epic desktop-shell
  consumes the ADR. The alternative is literal compliance with epic desktop-shell's boundary, at the cost of making
  Done-when 4's desktop limb unreachable until an epic with no breakdown runs.
- **A-02: entry 4's `CAP-6`.** Recommend adding CAP-6 to the epic's `covers` with one sentence naming the replayer and
  its agreement check, because `packages.md:9` assigns `render-webgl2` to CAP-6, 12 and 15 and epic 4's boundary
  excludes it. Otherwise drop CAP-6 from entry 4; either is honest, but not both.
- **A-03: epic 7 in the epic's `after`.** `tickets.py` reports `unpinned_after` for `epic-battle`. Recommend removing
  `{ epic = 7, needs = "battle" }` from epic 9's `after`, since 34 of 35 entries are done and 7.34 / #805 is an
  evidence ruling nothing here reads. The alternative is to keep it and name the battle entry to pin — but no entry in
  this draft exercises battle, so that pin would be decoration.
- **A-04: epic 2 in the epic's `after`.** Entry 7 builds on the merged `2.12` package writer, and D-2's fallback would
  move image transcoding into epic 2. Recommend adding `{ epic = 2, needs = "the distribution-package writer (2.12)" }`
  and, if D-2 rules for transcode, `{ epic = 2, needs = "the package importer (2.10)" }` too. Until then the draft
  keeps 2.12 as a reference so `tickets.py` stays clean.
