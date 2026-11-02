---
type: epic
title: "Games play in the browser; desktop, mobile and packaging wrap the same core"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-12"]
assignee: ""
risk: medium
tracker_id: "#946"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/946"
---

# Games play in the browser; desktop, mobile and packaging wrap the same core

## Description

`render-webgl2` replays draw lists, `runner-web` outputs audio through Web Audio and loads assets by fetch and OPFS; `runner-desktop` and `runner-mobile` wrap it, and a game can be packaged into a single file and legacy packages imported.

## Outcome

Anyone can play a legacy game in a browser; the CAP-12 success check, sample games playing in the browser and a packaged file loading, is the signal.

## Done when

1. The sample games play in a browser from the same core build the headless runner uses.
2. The WebGL2 replayer and the CPU rasteriser agree within the golden tolerance on the golden draw lists (G4).
3. A recorded input log replays to identical state hashes under Node and in a headless browser (G3).
4. A packaged single-file game loads in the web and desktop runners.
5. The mobile wrapper runs a sample game on a device or emulator.

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; **resolved 2026-10-31**: the breakdown is `tickets.toml` and the parent issue is #946 (see the inception block below); `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Open question (epic 6 evidence gap, filed as issue #877): a headless-browser SoundFont playback test. `packages/synth/test/render.test.ts` proves the MIDI-through-bank path under Node; the browser limb of epic 6's Done-when 2 has no test, and this repository has no browser runner. The assertion belongs to this epic's browser job (its Done-when 3 already requires a browser replay), so it is carried here until this envelope gets a `tickets.toml`. Adding Playwright for one assertion now was rejected; the licence (Apache-2.0) is acceptable, the scope is not.

- Decision (2026-10-31): the shell is **ruled**, so entry 10 no longer spikes anything; the earlier open question ("which
  epic runs the spike") is closed and the ADR records the ruling for epic desktop-shell to cite. The owner also ruled
  that the harness is separate from the game bundle — a game is a package installed into the player's library, with a
  default game baked at export or configured — and that there are **two desktop applications from one codebase plus the
  PWA**: a **player** (entry 11's package under entry 10's application) and an **editor** (`host-desktop`, epic desktop-shell's
  own package and application), both on the ruled Electron shell with `app://`, while the PWA is the only artefact
  **this epic ships** with a service worker — the editor PWA's worker is `host-web`'s (epic editor-foundation). This epic builds the player and packaging; it does not build or measure the editor application. The
  ruling text is D-1 in `story-rulings-the-runner-boundary-the-desktop-shell-image-storage-plan.md`.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on board-rendering because: draw lists to replay.
- Waits on audio-synth because: audio cues and synth.
- Waits on battle because: battle.
- Waits on menu-party-save because: menu and save.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Open question: image storage and transfer for web play. Legacy art is BMP, GIF and JPG with no PNG (`docs/spec/formats/images.md` survey, PR 2.19). Decide the stored image format, whether BMP and GIF transcode to it on import, and whether lossless WebP is added beside PNG. Settle at inception.
- Assumption: PNG is the baseline stored format, indexed where the image has 256 colours or fewer. JPG stays JPG, never transcoded to a lossless format.
- Assumption: WebP is adopted only if lossless WebP beats PNG by enough on the sample games, after gzip or brotli, to justify a second pure-TS decoder in core (G2, G3). Any encoder dependency must meet G6; `sharp` is out because libvips is LGPL.
- Assumption: a per-board asset preload and a decoded-pixel cache live in the runner layer and can be discarded without changing behaviour (G4, guardrails.md section G4).
- Waits on tk2-support because: BMP and GIF decoders (entries 16.11 and 16.12) to transcode from.
- Decision: image-storage work is this epic's, 2026-10-12; it may move to another epic at inception.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Evidence: docs/spec/examples/files/example_game.tpk and standalone_layout.exe.bin are a committed `.tpk` and `CMP1` EXE, usable for Done-when 4. docs/spec notes the original wrote saves from PAK games into a temporary folder deleted on exit.
- Handoff (epic board-rendering inception, 2026-10-16): epic 4 entry 4.6 commits per-command rasteriser conformance vectors (key, tint, blends, scaling, scratch targets) and entries 4.8 and 4.9 add text vectors to the same directory; entry 4.26 commits the golden draw lists with a ledger of oracle classes (`golden/ledger.json`); the WebGL2 replayer's CPU-agreement check (CAP-6) replays exactly those. Entry 4.7 gives `engine.surfacePixels(id, rev)` for runner texture caches; a runner may flush every cache each frame (AD-27 check). Entry 4.5 adds the pinned Bun lane the cross-engine checks use.
- Owner concern (2026-10-18): first loads mid-game must not stall visibly. AD-5 already keeps stalls from changing results (blocking requests freeze time, music and video stream, hints cannot change state), so this is presentation and caching work. Full proposal: `epic-audio-synth/discovery/audio-exploration.md` §7. Settle at inception:
  - Assumption: two load modes. Below about 64 MB the whole package downloads once behind the title screen with progress and is kept offline; every corpus game fits (largest about 33 MB uncompressed). Larger games stream using prefetch hints.
  - Assumption: core computes a deterministic prefetch plan from data and sends AD-5 hints in tiers (now: current board; next: edge-linked and literal `send` boards, battle background and enemies; always: menu sounds and the active SoundFont). This needs a small core entry at the AD-5 seam. It refines the per-board preload assumption above so runners do not reparse boards.
  - Assumption: `manifest.json` `index` entries gain a content hash and size, giving immutable cache keys, delta updates and a safe service-worker offline mode.
  - Assumption: hints also trigger worker-side decode (images, WAV/ADPCM, MIDI, SoundFonts); storage is memory, then Cache Storage/OPFS, then network; `navigator.storage.persist()` with streaming fallback on quota errors; offer PWA install (Safari eviction rules unverified).
  - Assumption: a blocking stall keeps the last frame, shows a spinner only after about 300 ms, and keeps music playing.
- Handoff (from epic audio-synth exploration, 2026-10-18): runner audio settings include per-bus volume, mute and a SoundFont picker (bundled, CDN, or any user `.sf2`) as player preferences. The runner implements epic 6's rules for autoplay unlock, focus pause and late-SFX drops, and caches SoundFonts per runner, shared across games.
- Open question (from epic audio-synth exploration, 2026-10-18; owner direction that runners in any language share one shape): should the whole runner boundary (draw-list replay, audio, input events, AD-5 requests) get what epic 6 proposes for audio? That is a normative behaviour page, a language-neutral message schema, and conformance vectors a non-TypeScript runner can replay. Settle at this epic's inception; see `epic-audio-synth/discovery/audio-exploration.md` §12.
- Handoff (epic audio-synth entry 6.3, proposed, pending owner review, 2026-10-18): the audio contract this epic implements is in `docs/spec/engine/audio-media.md#epic9-audio-handoff`: autoplay unlock as a delayed late start (`#audio-autoplay`), focus pause by default (`#audio-focus`), the 15-tick late-sound drop measured from ready (`#audio-late-sounds`), audio prefetch tiers and a SHA-256 keyed SoundFont cache shared across games (`#audio-prefetch`, `#audio-soundfont-cache`), the user `.sf2` contract (`#soundfont-user-bank`), and the browser playback test and `wasm-unsafe-eval` note (`#audio-browser-test`; Done-when items 2 and 3 of epic audio-synth are delivered here against that contract). Video: the portable profile (WebM, VP9, Opus; browser support unverified, verify here) and the `playVideo` / `video.ended { reqId }` contract (`#video-policy`, `#video-request`). The core prefetch planner and hint wire shape remain this epic's inception to create.

- Inception, 2026-10-31 (owner approved publishing; the breakdown is `tickets.toml`). Fourteen entries in build order; the tracer bullet is entry 3 and the epic closes with entry 13 (sweep) and entry 14 (closing suite). The source is `discovery/inception-proposal.md`, which keeps its `status: draft — awaiting owner approval` line as the record of what was reviewed. The two `## Notes` sections above are merged into one here, which satisfies the merge half of entry 1's description; approving publication did **not** decide the rulings, so entry 1 still records D-1 to D-11.
- Decision: entry 1 is the only entry with no prerequisites and every other entry is transitively gated by it, so no build work starts until the owner dates those rulings. The gating set is D-1 (desktop shell ruling), D-3 (runner-boundary contract), D-4 (load modes and prefetch ownership), D-5 (offline), D-6 (mobile scope), D-8 (build tool) and D-9 (browser lane); D-2, D-7, D-10 and D-11 may be decided or recorded open.
- Assumption (marked): entry 4 covers CAP-6 as well as CAP-12, because `packages.md` assigns `render-webgl2` to CAP-6, 12 and 15 and epic board-rendering excludes the replayer by name. If this epic's `covers` stays at CAP-12 only, entry 4's `covers` drops CAP-6 (proposal ask A-02).
- Source conflict (SC-1): the handoff above says entry 4.26 "commits the golden draw lists"; it commits scene recipes (`golden/scenes/S-01.json:1`), reference PNGs and `golden/ledger.json`, and the draw list is regenerated by the engine at replay (`packages/runner-harness/src/scene-golden.ts`). entry 4 replays the scenes, not draw-list files.
- Source conflict (SC-2): the assumption that `manifest.json` `index` entries "gain a content hash and size" contradicts `docs/spec/formats/packaging-and-paths.md:98-106`, which fixes the manifest at exactly `schema`, `main` and `index` and requires a reader to refuse any other field (AD-6). entry 7 and entry 9 use one package-level content hash at v1.
- Source conflict (SC-3): the "about 64 MB" threshold and "largest about 33 MB uncompressed" have no recorded source; the only corpus measurement in the tree is 134 files and 6.3 MB for two games (`docs/spec/formats/packaging-and-paths.md:112`). entry 9 measures the fetched corpus instead.
- Source conflict (SC-4, resolved 2026-10-31): `docs/architecture-options.md:264` scoped the desktop-shell spike to "the board editor and the game runner", while `epic-desktop-shell`'s boundary claimed "the spike". The owner then ruled the shell, so entry 10 no longer spikes anything: it builds the ruled harness and records the ADR that epic desktop-shell cites (proposal ask A-01).
- Handoff: epic audio-synth is entry-complete without the cue player — `docs/spec/engine/audio-media.md#cue-player` puts it in `synth`, and 6.11's plan excludes it ("The cue player is not part of this ticket"). entry 5 builds it against the reference arithmetic in `tools/fixtures/audio/sim.mjs:663`. Recorded here because epic 6's own Notes do not say it.
- Pinned-provider map: entry 4 after 4.6 and 4.26, entry 5 after 6.15, entry 9 after 8.9, entry 14 after 16.8 — all merged, so the pins record provenance rather than wait.
- Decision (2026-10-31, at publication; proposal ask A-03): epic 7 is removed from this epic's `after` in the initiative index. Every battle entry it could pin is merged except 7.34 / #805, which rules on literal full-state hash equality across a save and load — a question no entry here reads, so a pin would be decoration. Restoring it needs a battle-exercising check in a runner lane first. Ask A-04 (epic 2 in `after`) stays open; entry 7 cites 2.12 as a reference meanwhile.
- Accepted risk: a browser lane adds wall-clock to CI and one more required `gate` dependency; entry 3 keeps each browser test under a second where it can and says why when it cannot.
- Accepted risk: the player's deploy address, signing and store accounts have no owner, so entry 9 and entry 12 stop at a local build; publishing the product is out of scope (epic 17's proposal D-13 says the same).
- Deferred scope: the editor's T-70 "Make package" button and packaging UI (epic editor-assets-p0); the editor PWA shell and service worker (`host-web`, epic editor-foundation); a native or wasm renderer or synth (AD-30's escape hatch); the desktop-shell epic's editor chrome; per-entry manifest hashes and delta updates.
- Stand-ins: none. Every verification uses a merged artifact or a check this epic creates; the browser probes in entry 3 are measurements, not stand-ins.


- Decision (2026-10-31): **the owner approved all eleven D-1 rulings**, and entry 1 landed them docs-first in one commit each. Where each landed: **D-3, D-4, D-5, D-6, D-7, D-8, D-10, D-11** in the new normative page `docs/spec/engine/runners.md`; **D-1** in `docs/adr/0013-desktop-shell-electron.md` (Electron 45.2.1, the player and the editor from one codebase, the `app://` scheme with no service worker, the player's launch resolution, the one `guardrail-exception: G6 ADR-0013` inventory covering both binaries); **D-8 and D-9** in `docs/adr/0015-web-build-and-test-toolchain.md` (esbuild; Playwright 1.64.0, Apache-2.0, dev-only in the ADR 0002 `ovsx` pattern); **D-1's install descriptor** and the EXE correction in `docs/spec/formats/packaging-and-paths.md#install-descriptor`; **D-2** in `docs/spec/formats/images.md#storage-policy`; **D-1, D-4, D-10 and D-11's spine side** in AD-5, AD-17, AD-22, the Stack pin (45.2.1), the closed desktop-shell open question and the conditional `wasm-unsafe-eval` sentence.
- Decision (2026-10-31): **we stop producing self-running executables.** An export writes a distribution package plus its install descriptor, and the player opens it from the library; T-70 is "Make package" and T-71 no longer says "superseded by EXE" (`docs/editor-features.md`). We **keep reading** the legacy form: the `CMP1` reader, the L20 trailer rules with the legacy leniency, and the L21 refusal of Toolkit 2 Professional EXEs and self-extracting installers are untouched, because importing an appended-ZIP legacy game is the only way some of those games load at all — import compatibility, not an output format.
- Audit evidence update (2026-11-01): #930's non-silent analyser and duration assertions were delivered by #1026, with the skipped-graph perturbation recorded in that PR. #1026 demonstrates runtime battle/menu hint emission for #933, with the disabled-request failure recorded there; #1023's planner-only test did not prove that runtime contribution. This does not establish the full nonblocking contract: suspected blocking on the prefetch-only battle-background request remains unverified until runtime reproduction (#1081). #929's independent reference-rasteriser closing oracle and three renders with a cache flush between passes landed in #1023; its body does not record a flush-specific perturbation. #927's `runner-protocol:check` exists, but its generator checks regenerated vector bytes, not independently that a TypeScript type or schema-only change fails; that stronger claim remains unproven. These PR evidence links do not assert the entire epic is closed.

## Boundaries

`render-webgl2`, `runner-web`, `runner-desktop` as the **player's** desktop package, `runner-mobile`, and game packaging through the core package writer — the **player application** is this epic's. Not the **editor application**: `host-desktop` is its own package and application, owned by epic desktop-shell (its own platform-services instantiation, the harness embedded for preview, its own update cadence), and not editor hosts.

- Touch point: Capacitor and the ruled Electron shell - consumed; owner: this epic for the player, epic desktop-shell for the editor application; both binaries come from the same shell and share one G6 exception in ADR 0013

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-1, AD-3, AD-4, AD-5, AD-6, AD-14, AD-27
- constraint - docs/guardrails.md, sections G3 and G4
- reference - docs/spec/engine/main-loop-and-startup.md#e-130 to E-132
- reference - docs/architecture-options.md, section 8
