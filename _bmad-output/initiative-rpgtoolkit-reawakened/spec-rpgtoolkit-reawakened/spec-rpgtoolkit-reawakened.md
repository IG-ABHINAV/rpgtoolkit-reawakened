---
id: SPEC-rpgtoolkit-reawakened
companions:
  - packages.md
  - ../architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md
  - ../../../docs/spec/formats/README.md
  - ../../../docs/spec/engine/parity-checklist.md
  - ../../../docs/editor-features.md
  - ../../../docs/architecture-options.md
  - ../../../docs/guardrails.md
  - ../../../docs/adr/0001-typescript-core.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# RPG Toolkit Reawakened

## Why

A vision to realize. RPG Toolkit 3 (final release 2007) is a Windows-only, GPL-2 engine and editor with a living community of legacy games and no maintained path forward. This project rebuilds the engine and the authoring tools from scratch, clean-room and MIT/Apache, so legacy worlds keep playing and can be edited on modern platforms (browser, desktop, mobile, VS Code). Legacy authors, modders and players are affected. Behavioural parity with legacy games is the bar. The detailed capability inventory lives in the adopted companions (E-xx in `docs/spec/engine/`, T-xx in editor-features, layouts in `docs/spec/formats/`).

## Capabilities

- **CAP-1**
  - **intent:** A runner or tool can load any legacy RPG Toolkit 3 project from a folder, a `.tpk`, or an appended-ZIP EXE, upgrading pre-vector boards to the vector model (E-01, E-10, E-130, E-131, `docs/spec/formats/README.md`).
  - **success:** A headless dump of every file in the legacy `demo` and `Basic` sample games parses, and re-serialising the formats we write round-trips byte-for-byte or semantically as `docs/spec/formats/` states.
- **CAP-2**
  - **intent:** The engine boots a game (discovery, startup sequence), runs a fixed-tick main loop with legacy-perceived timing, resets and shuts down, and models boards, layers, 2D and both isometric coordinate systems, tiles (incl. animated), runtime board edits, lighting and ambient shading, and board transitions (E-01…E-06, E-10…E-19).
  - **success:** Scripted startup, board loads, edits, `send` transitions and lighting on 2D and both iso boards produce the expected state and golden draw-list images; `reset()` reruns startup cleanly.
- **CAP-3**
  - **intent:** Players and items move, animate, collide, path-find and follow waypoints as in legacy (E-20…E-34).
  - **success:** Recorded-input play-throughs of the sample games reproduce legacy movement outcomes: solid, sliding, stairs, edges, sprite-blocking diversion, all 3 pathfinders.
- **CAP-4**
  - **intent:** Programs fire from the legacy trigger points with the exact observable rules (E-40…E-49 and the fixed hooks).
  - **success:** Unit tests cover once-per-entry, repeat distance, key-press vs step-on, items-before-regions precedence, layer matching and run-if/then-set; the demo's NPC and battle triggers fire end-to-end headlessly.
- **CAP-5**
  - **intent:** Authors can run RPGCode 3.1 programs: the full language, every built-in in the catalogue, cooperative threads, blocking calls, source/target context, error handlers, sandboxed file I/O, and an extension point replacing native plugins: one plugin contract and an editable manifest (E-33, E-90…E-99, `docs/spec/engine/rpgcode-language.md`).
  - **success:** `system.prg` and `start.prg` of the sample games run to completion headlessly; every built-in name in `docs/spec/engine/rpgcode-functions.md` resolves; a mid-script snapshot restored into a fresh VM finishes identically (G1).
- **CAP-6**
  - **intent:** The core emits ordered draw lists, and runners replay them, covering layer compositing, iso drawing, occlusion, translucency, shading, animations, message window, text and primitives, canvases, overlay, transitions, modal UI primitives, cursor and board preview (E-50…E-63).
  - **success:** Golden images at defined ticks match legacy-reference expectations for 2D and both iso modes within the golden tolerance, and the CPU rasteriser and WebGL2 replayer agree.
- **CAP-7**
  - **intent:** Games play looping music (incl. General MIDI through a shared synth and a permissively licensed SoundFont), sound effects and volume control, with AVI video handled by an import-time conversion (E-100…E-104).
  - **success:** A legacy MIDI-driven game plays music identically on every web-based runner; sound cues are asserted in headless tests via null audio.
- **CAP-8**
  - **intent:** Players and scripts read keyboard, mouse and optional gamepad input, with pause on focus loss (E-110…E-113).
  - **success:** Scripted input logs drive movement, menu, activation and run-time keys; `wait()` returns the legacy key names.
- **CAP-9**
  - **intent:** Battles run on core rules (charge-bar turns, damage, status effects, enemy AI levels and custom AI, rewards, levelling), with a default battle UI and support for RPGCode-written battle systems (E-70…E-79).
  - **success:** Seeded battles reproduce the stated formulas and outcomes; an RPGCode custom fight program can drive every core battle operation.
- **CAP-10**
  - **intent:** The default menu, inventory, equipment, shop, inn, party, gold and play-time systems follow legacy rules, and RPGCode can replace them (E-80…E-87).
  - **success:** Scripted play-throughs exercise use, equip, drop, buy, sell, party swap and save-gating with the expected state.
- **CAP-11**
  - **intent:** Players can save and load the complete game state, including running threads, board live item list and RNG state, using the Reawakened canonical format (E-120, E-121, E-123).
  - **success:** A compatible save restored mid-script finishes with identical state hashes and subsequent behavior. On a compiler mismatch the whole save is refused and the live game is left unchanged; on a source mismatch the affected thread restarts from source; if restore validation finds an unresolved saved callable/owner reference, the save is rejected with a located restore error rather than silently repaired.
- **CAP-12**
  - **intent:** The same core runs in a web runner, a headless runner, a desktop runner and a mobile runner, and games can be packaged for distribution (E-130…E-132).
  - **success:** The sample games play in browser and under the headless runner from the same core build; a packaged single-file game loads.
- **CAP-13**
  - **intent:** Every change is verified by a required headless golden-test and gate suite that exists from milestone 1.
  - **success:** CI blocks merges on any failing or skipped job among typecheck, lint, unit, golden (format round-trips, play-throughs, golden images, G1 snapshot/restore, G3 replay hashes), licence and provenance.
- **CAP-14**
  - **intent:** Script authors get RPGCode language tooling in any LSP/DAP client: diagnostics from the core parser, hover and call tips, go-to-definition across includes, outline, formatting, legacy-syntax quick fixes, plus a debugger with breakpoints, stepping, watches, threads and call stack (T-40…T-44, T-46, E-98).
  - **success:** The LSP flags and fixes every legacy-syntax form of `docs/spec/engine/rpgcode-dialects.md` in the sample games; a DAP session steps a program across threads against a test fixture; both run in the `vscode.dev` web build.
- **CAP-15**
  - **intent:** Authors can build a complete game with the P0 editors: workspace and file tree, main file, board editor, program editor with test-run, character, item, animation and tile bitmap editors, and packaging (editor-features §11 P0).
  - **success:** A new game authored only with these tools, in each editor host, loads and plays in the web runner.
- **CAP-16**
  - **intent:** Authors get the P1 tools: tile editor, grabber, tileset editor, enemy, special move, status effect and background editors, lighting and shading, auto-tiler, undo and clipboard, export image, legacy upgrade wizards.
  - **success:** Each P1 tool opens, edits and saves its legacy format so the result loads in the runner and in a re-open; auto-tiler output matches the variant order of community sample sets.
- **CAP-17**
  - **intent:** Beginners get the P2 tools: visual event builder, skin editor, audio preview, setup builder and tutorials.
  - **success:** The visual event builder emits RPGCode that runs and lints clean.
- **CAP-18**
  - **intent:** All editor features are available in the VS Code extension and in the standalone editor (PWA first, then desktop shell) from the same `editor-ui` components through a platform-services interface, including per-platform file association (T-82).
  - **success:** The same editor-ui build opens and saves a project in VS Code (incl. a `vscode.dev` web build) and in the PWA; neither host imports the other, and no feature exists in only one host.

- **CAP-19**
  - **intent:** People who have never seen the project can find out what it is, install or open it on every shipped host, and learn to play, make, import, debug, package and share a game from versioned user documentation and a public website that match the released product; contributors and extension authors get developer documentation. The normative spec (`docs/spec/`) stays the separate engine and format contract and is linked, never restated.
  - **success:** A reader who did not write the documentation completes each flagship task (install or open on each shipped host, build a first game, import a legacy game, debug a script, package and share a game) from the published site against the release build; every command name, menu label, file name, format name and code sample in the user documentation is checked against the built product or the normative spec by a gate or a recorded walkthrough; link, accessibility and build checks pass for every published version.
- **CAP-20**
  - **intent:** Game data can be stored natively as versioned, text-first documents that a person can read and edit in an ordinary text editor and that merge cleanly in Git. Each logical contract has its own semantic version; a document names its contract and version, is identified by its path, and keeps plugin data in separate documents linked both ways to their owner. A checker reports broken stamps, IDs and links by name. Legacy formats stay readable through the compatibility layer (ADR 0009); the native format is permitted, not required (ADR 0005).
  - **success:** Legacy animation clips from the corpus import into native clip documents that decode to the same ordered frames and delays; a one-property edit changes one line and keeps every comment; the checker reports each ruled error class on authored fixtures and nothing on a clean project; renaming a document leaves the checker clean.

## Constraints

- G1: the RPGCode VM is an explicit step machine; all VM state is plain JSON data; no generators, async/await, Promises, workers or timers for script threads; blocking built-ins yield a status.
- G2: `core` touches no DOM, Node, I/O or timers; assets enter as bytes; dependencies flow `core ← synth ← runner-*/lsp/dap/editor-ui ← host-*`; `editor-ui` reaches the host only through platform-services; core runtime npm dependencies are an allowlist, initially empty.
- G3: no `Math.random`, `Date`, `performance.now` or `Intl` in `core`; injected clock and seedable RNG (state saved); fixed time tick; same game data, seed and input log give identical state and draw lists on every runner. Legacy perceived speeds are kept; frame-rate-coupled quirks are dropped (E-04).
- G4: renderers only replay draw lists, never own the loop or state; Phaser/Pixi-class engines only under `runner-*/src/render/**`.
- G5: headless golden tests run on every PR; goldens change only deliberately with a stated reason; legacy sample games are fetched at CI time and never committed.
- G6: shipped dependencies are under licences rated Bronze or better on the Blue Oak Council list (pinned version; MIT, Apache-2.0, BSD, ISC, Zlib, 0BSD, BlueOak and the like; CC0 assets), minus an exception list that starts with MS-PL (ADR 0003); copyleft (GPL, LGPL, AGPL, MPL-2.0, EPL, SSPL) and source-available or restricted are blocked; Lead-rated and unlisted licences need an ADR; bundled assets are listed in `THIRD_PARTY_NOTICES`; own code is MIT and/or Apache-2.0.
- G7: clean-room. Implement from `docs/` only; never open, copy or translate the legacy GPL source; fix a wrong or missing doc first in its own commit; code and PRs cite the E-xx, T-xx and `docs/spec/` anchors they implement.
- Legacy observable behaviour is the compatibility bar (trigger rules, battle rules, collision and movement semantics). Pixel parity is not required for projecting 2D tiles on iso boards (`docs/spec/formats/tiles.md#isometric-tiles`) or for scroll-cache behaviour.
- Script-readable pixels, image decoding, text layout and glyph rasterisation are core-owned so output is identical on every runner (architecture spine AD-4, AD-15, AD-28). This amends `architecture-options.md` §2 and the seam text of `packages.md`, and needs ADR 0002 before guard-rail scaffolding.
- Cross-epic contracts (engine API, draw list and surfaces, requests and replies, VM state, `GameState` sections, tick pipeline, platform-services) are fixed by the architecture spine and cited by id.
- Every editor capability lands in `editor-ui` first; `host-*` packages hold only platform services and chrome.
- Legacy native plugins cannot load. The stock menu and battle plugins are reimplemented natively; third-party extension uses the same plugin contract as the engine's own packs, ungated for now.
- TypeScript is the language of the core, runners, editor, LSP, DAP and VS Code extension (ADR 0001); a hot path moves to Rust/wasm only behind an unchanged TS interface.
- Scope ordering follows docs/spec/engine/parity-checklist.md must-haves, then editor P0 before P1 before P2.

## Non-goals

- Loading legacy native plugins (`Plugin/*.dll`).
- Pixel-exact parity for iso projection of 2D tiles, the legacy scroll cache, or frame-rate-dependent timing.
- The legacy built-in web browser (T-81), the legacy Pak file compiler as a distinct tool (T-71), and the legacy 2.x file-system upgrade as a priority (T-73).
- Alternate core stacks (Rust, C++, Godot, .NET) or moving game logic into a third-party engine.
- Shipping legacy sample games or their assets in this repository or releases.
- Optional items per docs/spec/engine/parity-checklist.md as must-haves: text-era formats, compiled `.prg`, legacy `.sav` import, tracker modules.

## Success signal

The headless runner plays the legacy `demo` and `Basic` sample games end to end from recorded input with stable golden images and replay hashes, the same games play in the web runner, and a game created from scratch in both the VS Code host and the PWA opens and plays identically.

## Assumptions

- The spec covers the whole rebuild at capability altitude. `bmad-ticket` orders and slices the work; detail stays in the adopted docs.
- `guardrails.md` G6 prevails over `architecture-options.md` §7.2, which lists MPL-2.0 as allowed.
- The architecture spine's `[ASSUMPTION]` tags (60 Hz tick, ASCII-only case fold, `fflate`, a pure-TypeScript TrueType rasteriser, editor-model in the VS Code extension host, restart-on-compiler-mismatch, FNV-1a, xoshiro128**, semver and PWA update policy) stand until corrected.
- `docs/spec/engine/parity-checklist.md` "nice-to-have" items are outside the must-have contract. Legacy-syntax conversion ships as LSP quick fixes (CAP-14).
- The non-goals T-71 (separate Pak compiler) and T-73 (2.x file-system upgrade) are my inference: editor-features calls T-71 superseded by the EXE route and T-73 serves only 2.x projects. T-72 setup builder stays in CAP-17. Overturn either if wrong.
- CAP-19 was added on 2026-10-17 as a draft for the documentation-and-website epic (epic 17). It is not part of the success signal below, which stays about the product. Its wording, and the choice of a new capability rather than extending CAP-12, are the owner's to confirm.
- CAP-20 was added on 2026-11-08 as a draft for the native-data-contracts epic (epic 27). It is not part of the success signal below, which stays about the product. Its wording, and the choice of a new capability rather than extending CAP-1, are the owner's to confirm.

## Open Questions

- Desktop shell: Tauri, Electron or Electrobun? ADR 0001 defers it to a spike on all three OSes (Linux WebKitGTK especially).
- Are 2.x text boards, other text-era formats and pre-compiled `.prg` rejected with a clear message or supported?
- AVI video (E-104): transcode on import via an editor tool, or drop?
- How does a game package ship third-party plugin code (E-99, CAP-5)? The contract and manifest are decided (ADR 0004 decision 6).
- Which sample tile sets are the source for rebuilding the auto-tiler variant order (T-25) under G7?
- ADR 0002 must be accepted before guard-rail scaffolding: core rasteriser and glyph rasterisation, the `Math` allowlist and `**` ban as extra G3 enforcement, and an `ovsx` exemption note. Who writes it?
