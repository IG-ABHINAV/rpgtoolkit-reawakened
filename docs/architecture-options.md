# Architecture Options — RPG Toolkit Reawakened

> **Question.** What is a realistic technology stack for a from-scratch, **MIT/Apache-licensed** 2D tile RPG engine plus authoring toolset that must **read legacy RPG Toolkit 3 worlds** (`.brd` boards, `.prg` RPGCode, and the rest; see [spec/formats/](spec/formats/README.md))?
>
> **Approach.** Split the product into a **game core** and swappable **runners** (browser and native), plus an **editor** that reuses the core. Each option is judged on fitness, ecosystem maturity, licence, tooling friction, and how well the core-to-runner seam survives. Each option is tied back to the capability IDs in [spec/engine/](spec/engine/) (E-xx) and [editor-features.md](editor-features.md) (T-xx).
>
> Research current as of **October 2026**. Versions and statuses are cited at the end. Re-verify before committing.
>
> **Decision (October 2026): Option B, TypeScript everywhere**, with the VS Code extension as a first-class editor host alongside a standalone editor. See [ADR 0001](adr/0001-typescript-core.md). The comparison below is kept as the record of why. §8 states the chosen default.
> **Editor decision (November 2026):** Monaco is selected for standalone/browser code editing; VS Code retains its native text editor. Pin a version when integrating. See [ADR 0021](adr/0021-monaco-code-editor.md).

---

## 1. What the requirements actually force

Most stack debates about 2D engines are settled by a few hard requirements. For this project they are:

| # | Hard requirement | Comes from | Consequence for the stack |
|---|---|---|---|
| R1 | **Resumable script interpreter.** Blocking programs (`wait()`, blocking movement, modal menus) and cooperative threads must run on a runtime with **no OS threads**, i.e. the browser. | E-33, E-90…E-96, §1.2 of engine doc | The RPGCode VM must be an **explicit step machine** (instruction pointer + frame stack you can pause after N steps). Do not rely on host threads, blocking I/O, or language-level async that cannot be serialised. This is the single most important design constraint. |
| R2 | **Serialisable live state**, including running threads. | E-120/E-121 | VM state is plain data (frames, locals, IP), not closures or host coroutines. That rules out "just use JS generators / Rust async" as the thread model. |
| R3 | **Deterministic simulation** independent of frame rate. | E-04, E-22…E-34 | Fixed-tick core with an injected clock and RNG. The legacy fps-coupled speed maths is replaced by real-time equivalents. |
| R4 | **Layered 2D compositing** with colour-key transparency, per-pixel **additive RGB tint** (−255…+255), translucency, masked iso diamonds, off-screen canvases, read-back (`getPixel`, `canvasGetScreen`). | E-52…E-59, E-17 | Needs render-to-texture and a simple tint shader, *or* a CPU compositor. Any WebGL2-class renderer is enough. 3D engines are overkill. Read-back rules out "fire-and-forget" GPU-only APIs unless the runner supports copies back to the CPU (under [ADR 0002](adr/0002-core-pixels-and-deterministic-maths.md), read-back is served by `core/raster`, so runners need no CPU copy). |
| R5 | **General MIDI playback everywhere.** | E-100, E-103 | Browsers and mobile have no OS MIDI synth, so a **SoundFont synthesiser must ship with the runner**, together with a permissively licensed SoundFont. This is a licensing trap (FluidSynth is LGPL; some popular SoundFonts are GPL or have unclear provenance). |
| R6 | **Binary legacy formats + ZIP + appended-ZIP EXE import.** | [spec/formats/](spec/formats/README.md), E-01, E-131 | Byte-level readers in the core, kept I/O-free. The runner provides bytes. Needs a permissive ZIP reader. |
| R7 | **Editor with heavy forms, trees, a code editor with syntax colouring and call tips, a pixel editor, and a zoomable vector/tile canvas.** | T-01…T-64 | Favours a mature UI toolkit with a strong text-editor component. The web platform is the strongest here; Monaco is selected for standalone/browser editing ([ADR 0021](adr/0021-monaco-code-editor.md)). Immediate-mode GUIs are weak at rich text. |
| R8 | **Editor live preview and test-run** using the *same* core. | T-07, T-41, E-01 test mode | The core must embed in the editor (in-process, or as wasm in the editor's web view). |
| R9 | **Licence: MIT/Apache for everything we ship;** clean-room relative to the GPL-2 legacy code. | brief | No GPL/LGPL in shipped binaries (including the wasm bundle). Non-OSI "source-available" engines are excluded. GPL tools may be used *externally* only (e.g. as importers run by the user). |

R1, R2 and R5 do more than anything else to separate the options. Rendering (R4) is easy for every candidate.

---

## 2. The seam: core ↔ runner contract

Whatever language you pick, keep this interface **data-only and narrow**. That is what keeps runners swappable.

```
          ┌──────────────────────── Game Core (pure library) ─────────────────────────┐
 inputs → │ formats · world · movement/collision/pathfinding · triggers · RPGCode VM │ → outputs
          │ battle/menu rules · save model · render-list builder · audio-cue builder │
          └───────────────────────────────────────────────────────────────────────────┘
inputs:  advance(ticks, inputs), where inputs are key (name / scan code), pointer and gamepad events
         and the replies to requests (asset bytes for "need asset X", persisted blobs)
outputs: frame = ordered draw list   [blit(tex | surface, src, dst, key, tint, alpha, blend),
                                      fill/line/rect/ellipse/text,
                                      push/pop target (frame-scoped scratch targets only)]
         persistent surfaces: core-owned bitmaps; blits read them, runners pull their pixels
                              by id, outside the draw list
         audio cues [music play/stop/loop/volume, sfx play, midi-file play]
         requests   [load asset, save blob, quit, open URL, play video]
```

Rules that keep the seam honest:
* **No I/O in the core.** It *asks* for assets by logical path. Case-folding and package lookup ([paths inside files](spec/formats/README.md#paths-inside-files)) live in a shared "asset resolver" module that runners call with their own byte source (file system, fetch, OPFS, embedded archive).
* **Draw lists out, one reference rasteriser inside** (amended by [ADR 0002](adr/0002-core-pixels-and-deterministic-maths.md)). The core emits a **draw list** against abstract textures and surfaces. A runner replays it with WebGL2, WebGPU, Canvas2D or SDL3's renderer. The core also holds the single reference rasteriser (`core/raster`) and owns persistent surfaces, because scripts read pixels back (`getPixel`, `canvasGetScreen`, screen save and restore) and must get the same pixels on every runner. The headless harness uses that rasteriser for golden images.
* **Text layout, glyphs and image decoding are core-owned** (amended by [ADR 0002](adr/0002-core-pixels-and-deterministic-maths.md)). Line breaks, glyph advances and glyph rasterisation come from the core, and game images are decoded once in the core, so word wrap and script-read pixels do not depend on the platform. Game fonts arrive as assets (E-132); a bundled bitmap font is the fallback and the test font. Platform fonts are an opt-in runner mode, off in golden and conformance runs.
* **Audio is cues, not samples.** A runner may synthesise MIDI natively or in an AudioWorklet. Offer a shared synth module so behaviour matches across runners.
* **Blocking script calls never block the host.** A `wait()` makes the VM yield with a "waiting for key" status. The runner keeps calling `advance` until the core resumes it.

**Swappability test:** a headless runner (CPU rasteriser, null audio, scripted input) should be able to play `build/game/demo` from the legacy repo in CI. If that is hard, the seam has leaked.

---

## 3. Candidate stacks

Five realistic families. "Core" is the pure library. "Runners" are the platform hosts. "Editor" is the authoring app.

### Option A — Rust core → native + WebAssembly runners

* **Core:** Rust library with no platform dependencies. Readers, VM and simulation are plain Rust. Compiles to native and to `wasm32-unknown-unknown`.
* **Runners:**
  * *Web:* a thin TypeScript host. The wasm core produces the draw list, which TS replays with WebGL2 (or PixiJS v8, MIT, which can use WebGPU and falls back to WebGL). Audio uses Web Audio plus an AudioWorklet running the synth.
  * *Desktop:* `winit` + `wgpu` (MIT/Apache; Vulkan, Metal, D3D12, GL), **or** SDL3 (zlib) through bindings, or `macroquad`/`miniquad` (MIT/Apache) for a minimal 2D host.
  * *Mobile:* the web runner wrapped in Capacitor or Tauri mobile, or SDL3 native.
* **MIDI:** `rustysynth` (MIT, pure Rust, std-only, SoundFont 2 with reverb and chorus) runs inside the core-adjacent audio module on **every** runner, wasm included, so playback is identical everywhere.
* **Editor:** web UI, sharing the core through wasm for preview and test-run (R8). Desktop shell is chosen in §4.
* **Fitness:** Excellent for R1–R3 (explicit VM, serialisable structs, deterministic), R6 (byte parsing), R5 (an MIT synth in-language). R4 is handled by any runner.
* **Ecosystem:** Mature for this scope. Bevy (0.20, Oct 2026) shows Rust game tooling is healthy, but Bevy itself is *not* needed. A full ECS engine would fight the "core emits draw lists" seam.
* **Licence:** Rust std, wgpu, winit, kira, rustysynth, image and zip are MIT/Apache. SDL3 is zlib. All clean.
* **Friction:** The Rust learning curve. Wasm-bindgen glue. Two languages (Rust core + TS editor and web host). Compile times.
* **Seam:** **Best.** The compiler enforces the boundary (the core crate simply has no platform deps), and the same binary logic runs in every runner.

### Option B — TypeScript everywhere

* **Core:** TypeScript package (pure, no DOM), runs in browser, Node/Bun, and any WebView.
* **Runners:** *Web:* Canvas2D or WebGL2 directly, or PixiJS v8 (MIT), Phaser 4 (MIT; shipped April 2026, new WebGL renderer, tilemaps) or Excalibur (BSD-2). *Desktop:* the same web runner inside Tauri, Electron or Electrobun. *Mobile:* Capacitor 8 (adds a few MB around a full-screen WebView).
* **MIDI:** SpessaSynth (Apache-2.0; SoundFont 2 / DLS, Web Audio wrapper available).
* **Editor:** web UI in the same language. Simplest code sharing of all the options.
* **Fitness:** Good. R1/R2 are satisfied *if* you still write an explicit step VM; generators are tempting but not serialisable. R3 is fine. Performance is adequate for 2D tile RPGs (this is 2000s-era content). Native-feel and offline packaging depend on a WebView shell.
* **Ecosystem:** The largest of all options for UI and 2D web rendering.
* **Licence:** Clean if you avoid GPL npm packages. Audit transitive dependencies.
* **Friction:** Lowest. One language and one toolchain, with fast iteration.
* **Seam:** **Good but soft.** Nothing *stops* the core from touching the DOM or `fetch`. Enforce it with lint rules and a separate package with no DOM types. "Native" runners are really the same web runner in a different shell, so there is less true runner diversity.
* **Caveat:** Phaser and Excalibur want to own the game loop and scene graph. Use them only as *renderers* behind the draw-list seam, or skip them for a ~1–2 kLOC WebGL2 replayer.

### Option C — C++ (or C) core with SDL3 runners

* **Core:** portable C++ library. **Runners:** SDL3 (zlib; stable 3.x, 3.4.16 Sept 2026) for desktop and mobile, with Emscripten for web. Alternatively raylib 6.0 (zlib; April 2026; experimental Emscripten backend plus a new software renderer that is handy for headless tests).
* **MIDI:** TinySoundFont / TinyMidiLoader (MIT, single-header). Avoid FluidSynth (LGPL).
* **Editor:** Dear ImGui (MIT) native, or a web UI with the core compiled to wasm.
* **Fitness:** Good runtime performance and portability. R1/R2 need the same explicit VM.
* **Ecosystem:** Very mature (SDL is the industry baseline).
* **Licence:** Clean (zlib/MIT).
* **Friction:** Highest. Memory safety, build systems (CMake + Emscripten + mobile toolchains), and weaker editor UI if you go ImGui (R7: no rich code editor, forms are laborious).
* **Seam:** Good if disciplined. Nothing enforces it.

### Option D — Godot 4 (MIT) as the runner (and optionally editor host)

* **Core:** GDScript, or Rust/C++ via GDExtension (`godot-rust`), inside a Godot project. **Runner:** Godot export targets (desktop, mobile, web). **Editor:** extend the Godot editor with plugins, or build a standalone Godot "tool" app.
* **Fitness:** Rendering, input, audio mixing and exports are all solved. But:
  * R1/R2 still need a custom VM.
  * R5: no built-in MIDI synth, so you need an extension.
  * Godot wants to own the loop, scene tree, and resource system, which works against the draw-list seam.
  * **C# cannot export to web in Godot 4.6** (as of 2026), so a web-capable core must be GDScript or GDExtension.
  * Web exports are large, and threaded web builds need cross-origin-isolation headers.
* **Ecosystem:** Very mature and active (4.6 in 2026).
* **Licence:** MIT. Clean.
* **Friction:** Medium. Fast to get pixels, slower to get *legacy-exact* behaviour, because you end up working around engine conventions (layer ordering, colour-key transparency, additive tinting all need custom shaders/materials).
* **Seam:** **Weakest of the clean options.** The "core" tends to dissolve into nodes and signals unless you keep it a GDExtension library that Godot merely hosts. If you do keep it separate, Godot becomes just one runner among several, which is a reasonable *alternative runner* role.

### Option E — C# / .NET (MonoGame, FNA, or raylib-cs)

* **Core:** .NET library. **Runners:** MonoGame (MS-PL) or FNA (MS-PL) for desktop and consoles. Web via Blazor/WASM is possible but immature for games. Mobile via MonoGame.
* **Licence:** MS-PL is OSI-approved but **not** MIT/Apache, and it has copyleft-ish source-distribution terms for the runtime pieces. That is acceptable for a runner but complicates "MIT everything". raylib-cs is zlib.
* **Fitness/Seam:** Fine on desktop. The **browser story is the weak point**, which fails the "browser or native runners" goal.
* **Verdict:** Not recommended as the primary stack. Viable only if the team is C#-first and the web is secondary.

### Excluded or demoted

| Candidate | Why |
|---|---|
| **Defold** | Source-available Defold License (Apache-2.0 plus a non-commercialisation clause). **Not OSI open source**, so it fails R9. |
| **LÖVE (zlib)** | Pleasant, but 12.0 is still unreleased (Oct 2026) and web builds (love.js) target 11.5, are unofficial, and run slower without LuaJIT. Lua makes a serialisable VM-in-VM awkward. |
| **Bevy as the engine** | MIT/Apache and healthy (0.20), but ECS-first and frequent breaking releases. Use its building blocks (wgpu, winit), not the engine, behind the seam. |
| **Qt / Slint for the editor** | Qt is LGPL/GPL/commercial and Slint is GPL/royalty-free/commercial. Workable but adds licence friction against "MIT everything". |
| **FluidSynth (incl. wasm builds)** | LGPL-2.1. Linking into a wasm bundle makes LGPL compliance awkward. Use rustysynth, SpessaSynth or TinySoundFont instead. |

---

## 4. The editor shell (don't default to Tauri — compare)

The editor's **UI** should be web technology in every recommended path: R7 uses Monaco for the standalone/browser RPGCode editor with call tips (T-40), plus trees, tabbed documents, inspectors and a canvas board editor (T-20…T-35). VS Code uses its native text editor; see [ADR 0021](adr/0021-monaco-code-editor.md). The shell provides file-system access, menus, running a game from a package through the platform-services `run` call, and writing the distribution package that a harness opens (T-70).

| Shell | How it hosts the UI | Size / RAM | Fit for this editor | Licence | Risks |
|---|---|---|---|---|---|
| **Plain browser / PWA** | Any modern browser. Files through the File System Access API (Chromium) or OPFS plus ZIP import/export elsewhere. | none | Good for *trying* and *teaching* (zero install). Weak for big projects on Firefox/Safari (no direct folder access). | n/a | Folder workflows differ per browser. No spawning of native runners. |
| **Tauri 2** (2.12.5, Oct 2026) | OS WebView (WebView2 / WKWebView / WebKitGTK) + Rust backend | Smallest (a few MB; the engine is the user's) | **Strong with Option A**: the Rust backend can link the *native* core for packaging, asset conversion and native test-runs. Capability-gated IPC. Mobile targets exist but are still catching up to desktop. | MIT/Apache | Rendering differs per OS WebView. **WebKitGTK on Linux** is the usual weak spot for canvas/WebGL performance, so test the board editor there early. On macOS a `file://` page cannot load an AudioWorklet module and WKWebView cannot register a service worker without Apple's `com.apple.developer.web-browser` entitlement (WebKit bug 206741, open since 2020), so a Tauri host must serve over a **secure custom scheme**. |
| **Electron** (45.2.1, Oct 2026; Chromium 156) | Bundled Chromium + Node | Measured on macOS arm64: **124 MiB** download (`darwin-arm64` 130,394,296 B), **151 MiB** (`win32-x64` 158,293,649 B), **293 MB installed**, **~419 MiB** summed RSS for a window holding a WebGL2 context and an AudioWorklet — paid **once per installation**, because a game is a package installed into the harness's library, not a copy of the shell | Most consistent *feature set* (one Chromium, one JS engine) and the best devtools. **No measured rendering advantage over WebKit on macOS** — see the parity note below. | MIT; the shipped bundle also contains **ffmpeg (LGPL-2.1+)** and **symphonia-core (MPL-2.0)**, which G6 rule 2 blocks, so a desktop build needs a recorded exception | Size of one download. Security hardening is on you, and a major ships every 8 weeks with the latest three supported. |
| **Wails** (v3.0.0 stable, Oct 2026) | OS WebView + Go backend | Small | Only if the team wants Go. Adds a third language to Option A. | MIT | Smaller community. Same WebView variance as Tauri, plus an open GTK4 defect that leaks the web process on window close (wails#6505). |
| **Electrobun** (2.0.5, Oct 2026) | OS WebView + Bun, or **bundled CEF** with `bundleCEF: true` (pinned Chromium 147) | System-webview payload measured at **5,675,912 B** (`darwin-arm64`) / **10,726,733 B** (`win-x64`); the CEF payload is **147,695,098 B** / **185,783,528 B** | TS-only teams (Option B). | MIT for its own code; the packaged Bun statically links **LGPL-2 JavaScriptCore**, which its licence file does not mention | Young, and the toolchain was rewritten in 2026. Official Linux support is Ubuntu 24.04+; other distributions are "community". |
| **egui / eframe** (0.36) | Immediate-mode, native + wasm | Small | Good for inspectors and canvases. **Poor for the code editor and rich text** (R7). | MIT/Apache | Re-implementing a decent text editor is a project in itself. |
| **Godot editor plugin** | Godot editor | Large | Only with Option D. | MIT | Couples the editor to Godot's resource model. |
| **VS Code extension** (§4.1) | VS Code / VSCodium / other Code-OSS editors. Webview **custom editors** for binary files, plus native text editing | none extra (runs in the user's editor) | **Excellent for scripts** (T-40…T-46), the file tree (T-03) and test-run (T-07/T-41). **Good for asset editors** hosted as webviews (board, sprite, animation). Weak as the *only* tool for beginners. | Code-OSS is MIT; extension can be MIT | The Microsoft marketplace build of VS Code is proprietary (Open VSX covers the open forks). Webview UX is constrained (no free docking, message-passing only). Marketplace supply-chain risk. |

**Measured parity (2026-10-31, macOS 27.0.1, Apple M1 Pro).** A WebGL2 probe and the real `spessasynth_processor.min.js` (4.4.2, 580 KB) were run in Electron 44.7.0 (`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)`) and in a WKWebView host (`Apple GPU`). Both expose WebGL2 at a 16,384 maximum texture size and differ in exactly one extension (`EXT_disjoint_timer_query_webgl2`, Chromium-only); both reproduce the CPU blend `(dst·(255−a) + c·a + 127)/255` **exactly — worst delta 0 across 1,536 channel comparisons** — and both load, register and instantiate the synth's worklet. So Electron's advantage is *one feature set across three operating systems*, not measured superiority on any one of them: the Windows and Linux legs are still unmeasured, and they are what the desktop-spike entry (epic web-runner-packaging, 9.10) exists to produce. One asymmetry did show: a `file://` page cannot load an AudioWorklet module in WKWebView, and can in Electron.

**Design rule:** put the editor's host access behind a small **platform-services interface** (open/save/list folder, watch files, run game, export package). Implement it for each host: browser (FSA/OPFS + ZIP), Tauri, Electron, **and VS Code** (workspace FS + tasks/debug APIs). Then the shell decision is reversible, the same way the runner decision is.

### 4.1 VS Code extension: a host, not a rewrite

This is not just "another shell". Because the editor UI in the recommended path is web technology, the same components can be hosted inside VS Code. The extension then splits into three independent, reusable pieces:

| Piece | What it delivers | Capabilities | Reuse outside VS Code |
|---|---|---|---|
| **RPGCode language server (LSP)** | Syntax colouring (TextMate grammar), diagnostics from the *core's own parser*, call tips and hover from the built-in catalogue ([rpgcode-functions.md](spec/engine/rpgcode-functions.md)), go-to-definition across `#include` and implicit includes, outline of functions/classes/labels (replaces the legacy bookmark bar), formatting (replaces the indent wizard), quick fixes for legacy syntax (replaces the update and cleanup wizards). | T-40, T-42, T-43, T-44, T-46 | Any LSP client: Neovim, Zed, Helix, JetBrains, and the standalone editor's Monaco integration. |
| **RPGCode debug adapter (DAP)** | Launch the game or a single program against a test fixture. Breakpoints, step, watch variables, thread list, call stack. The step VM (R1) makes this cheap to build. | T-07, T-41, E-98 (exceeds legacy, which only had an error window) | Any DAP client. |
| **Custom editors (webviews)** | `.brd`, `.tem`, `.itm`, `.ene`, `.anm`, `.tbm`, `.tst`, `.gam` and the rest open in the same web components the standalone editor uses, with the core (wasm) for parsing, preview and saving. The Custom Editor API supports binary documents with undo/redo and dirty tracking. | T-10…T-64 | The components are shared with the browser, Tauri and Electron editors. |

**Fitness.** VS Code already provides the workspace, the file tree, tabs, search, git, a terminal, tasks and settings sync (much of T-01…T-09) for free. Text editing is far beyond anything the legacy program editor offered. Board and sprite editing work as webviews: the SheetJS viewer is a shipping example of a binary-format custom editor. Running wasm in a worker keeps heavy parsing off the extension host.

**Ecosystem.** Very mature APIs (custom editors, LSP, DAP, web extensions). Distribution through the Microsoft Marketplace **and Open VSX**, which by 2026 serves the open forks (VSCodium, Eclipse Theia, Gitpod, Cursor-style editors) and has AWS-backed hosting. A **web extension** build can even run in `vscode.dev`, giving a zero-install path similar to the PWA.

**Licence.** Code-OSS and the extension APIs are MIT. Our extension, LSP and DAP can be MIT. The proprietary bit is only Microsoft's branded VS Code build and its marketplace terms, which users choose themselves. Publish to Open VSX as well so nobody depends on it.

**Tooling friction.** Low to medium. TypeScript extension host, webview message passing, a TextMate grammar, and the LSP/DAP protocols. Constraints to plan for: webviews can't share a canvas with VS Code's own UI; the left/right docked layout of the legacy editor (tool palette, tileset browser, inspector) has to live *inside* each webview or in contributed side views; strict webview CSP; and supply-chain hygiene for marketplace publishing.

**Who it serves.** Experienced authors and scripters, contributors, and the community modding legacy games. It does **not** replace a friendly standalone editor for beginners: the legacy audience included many first-time creators who won't install VS Code.

**Seam impact.** It strengthens the architecture. It forces the editor UI to stay host-agnostic (platform-services interface), and it pushes language tooling into an LSP and DAP that every host reuses.

---

## 5. Scoring matrix

Scores 1–5 (5 = best). "Seam" means how swappable the core↔runner boundary stays over years of maintenance.

| Criterion (weight) | A: Rust core + web/native runners | B: TypeScript everywhere | C: C++/SDL3 | D: Godot runner | E: .NET |
|---|---|---|---|---|---|
| **Fitness** to R1–R6 (×3) | 5 | 4 | 4 | 3 | 3 |
| **Ecosystem maturity** (×2) | 4 | 5 | 5 | 5 | 4 |
| **Licence cleanliness** for MIT/Apache (×3) | 5 | 5 | 5 | 5 | 3 |
| **Tooling friction** (low = 5) (×2) | 3 | 5 | 2 | 4 | 3 |
| **Seam swappability** (×3) | 5 | 4 | 4 | 2 | 3 |
| **Editor reuse** of core, R8 (×2) | 5 (wasm in editor + native in shell) | 5 | 3 | 3 | 2 |
| **Browser runner quality** (×2) | 5 | 5 | 4 | 3 | 2 |
| **Weighted total** (max 85) | **79** | **79** | 67 | 60 | 49 |

A and B **tie on points**. The choice between them comes down to the team's appetite for Rust (B scores higher on friction) versus fitness and an enforced seam (A scores higher on both). The tie was broken in favour of B in [ADR 0001](adr/0001-typescript-core.md): B scores higher on tooling friction, ecosystem and code sharing with the editor, language server and VS Code extension, and the guard-rails in [guardrails.md](guardrails.md) offset its softer seam.

---

## 6. Capability traceability

How each hard capability lands in an Option A build, with notes on alternatives. (This table predates the decision. The chosen Option B mapping is in §8 and [ADR 0001](adr/0001-typescript-core.md). The module boundaries are identical; only the language and the MIDI synth change.)

| Capability | Where it lives | Notes / alternative impact |
|---|---|---|
| Format readers ([spec/formats/](spec/formats/README.md)), legacy upgrades (E-10, T-31) | core `formats` module | Same code serves runners, editor and a CLI converter. In B, TS DataView readers work equally well. |
| Coordinates & iso (E-11, E-53) | core | Pure maths. |
| Collision, sliding, stairs, edges, z-order, pathfinding (E-26…E-34) | core | Fixed-tick, deterministic. Golden tests from the legacy demo games. |
| Trigger rules (E-40…E-49) | core | Data-driven. Unit-testable without a renderer. |
| RPGCode VM, threads, blocking, error handlers, ~280 built-ins (E-90…E-96) | core `script` module | Explicit step VM (R1/R2). Built-ins call core services. Drawing built-ins emit draw-list ops. |
| Rendering: layers, colour-key, tint, translucency, canvases, transitions (E-52…E-63) | runner replays the draw list; the core builds it | WebGL2 replayer (web), wgpu or SDL3 renderer (native), CPU rasteriser (tests). |
| Message window, menus, battle UI (E-55, E-70…E-80) | core rules + **core-built UI draw lists** | No plugins, so the default menu and battle become native core features. RPGCode replacements still work (E-79). |
| Music and MIDI (E-100…E-103) | shared synth module (rustysynth) + runner output | Same MIDI sound on web and native. B uses SpessaSynth. C uses TinySoundFont. |
| Video (E-104) | runner | Transcode AVI on import (editor-side tool) to a web-playable format. |
| Save/load incl. threads (E-120…E-122) | core serialises plain state | Optional legacy `.sav` reader. |
| Packaging/import (E-131, T-70…T-72) | editor backend (native core in Tauri) or browser ZIP | Import legacy `.tpk`/appended-ZIP EXE ([packaging and paths](spec/formats/packaging-and-paths.md)). Export a web bundle and desktop runner bundle. |
| Board editor canvas (T-20…T-35) | editor UI (web canvas/WebGL) using core types for vectors, tiles and coordinates | Reuses the same renderer code as the web runner for WYSIWYG. |
| Program editor, call tips, test-run (T-40…T-41) | Monaco in standalone/browser hosts; native text editing in VS Code, with the core parser as a language service | Diagnostics match the engine exactly because it is the same parser. |
| Pixel/tile tools, grabber, tilesets (T-36…T-39) | editor UI | Pure web canvas work. Tileset writer in core `formats`. |
| Auto-tiler (T-25) | core (rule) + editor (UI) | Variant ordering reconstructed from sample sets. |

---

## 7. Licence implications (summary)

1. **Clean-room boundary.** The legacy engine and editor are GPL-2. Only the documentation in `docs/` crosses into the new repo. No source, no translated code, no copied tables beyond what is needed to describe file layouts. Keep a short *provenance note* in the repo stating this process. The VGA palette ([DOS palette](spec/formats/tiles.md#dos-palette)) and similar tables should come from public specifications.
2. **Dependencies:** allow licences rated Bronze or better on the Blue Oak Council list (MIT, Apache-2.0, BSD, ISC, Zlib, 0BSD, BlueOak and the like; CC0-1.0 for data and assets), as [guardrails.md](guardrails.md) G6 and [ADR 0003](adr/0003-permissive-licences-acceptable.md) state. MPL-2.0 and other copyleft needs an ADR exception. **Block GPL/LGPL/AGPL and source-available or restricted licences** (Defold) in anything shipped. Run a licence check in CI (`cargo-deny` for Rust, `license-checker`-style auditing for npm).
3. **MIDI SoundFont.** Ship **FluidR3_GM** (generally described as MIT; large, ~140 MB, so ship a compressed or trimmed build and lazy-load it on the web). Treat **GeneralUser GS** as optional: it has a custom permissive licence but its author disclaims sample provenance. Avoid GPL SoundFonts. Let users point the runner at their own `.sf2`.
4. **External GPL tools are fine as tools.** For example, letting users import maps from Tiled (GPL editor) is fine, because we only read its file format. LDtk is MIT.
5. **Legacy game content** (users' boards, the bundled MIDI music pack under its own EULA) is the users' business. The runner should not redistribute legacy sample assets unless their licences allow it.

---

## 8. Recommendation (decided: Option B)

### Chosen default: **Option B, TypeScript everywhere.** Pure TS core, swappable runners, and two first-class editor hosts: a standalone editor and a VS Code extension.

**Packages (one monorepo, one language):**

* `core/` (TypeScript, **no DOM, no Node APIs**): formats, asset resolver, world, movement, triggers, RPGCode **step VM**, battle and menu rules, draw-list and audio-cue builders, save model. Runs unchanged in browsers, Web Workers, Node/Bun, WebViews and the VS Code extension host.
* `synth/`: MIDI via SpessaSynth (Apache-2.0) behind a small interface, so a runner can swap in another synth.
* `runner-web/`: WebGL2 draw-list replayer (a Canvas2D fallback is optional), Web Audio/AudioWorklet output, fetch/OPFS asset source. This is also the renderer used inside every editor host for WYSIWYG.
* `runner-desktop/`: `runner-web` in a desktop shell with a file-system asset source and an embedded-archive loader for single-file game builds.
* `runner-mobile/`: `runner-web` in Capacitor.
* `runner-headless/` (Node/Bun): CPU rasteriser + null audio + scripted input for CI golden tests against `build/game/demo` and `build/game/Basic`.
* `lsp/` + `dap/`: the RPGCode language server and debug adapter, built directly on `core`'s parser and VM.
* `editor-ui/`: host-agnostic editor components (board, sprite, animation, tile/tileset, tile bitmap, data editors; Monaco for standalone/browser scripts) that talk only to the **platform-services** interface.
* **Editor hosts, all implementing platform-services:**
  * `host-vscode/`: **VS Code extension** (§4.1). Webview custom editors for every legacy format, bundled LSP and DAP, tasks for test-run and packaging, a web-extension build for `vscode.dev`. Published to the VS Code Marketplace **and** Open VSX.
  * `host-web/`: standalone editor as a PWA (File System Access API / OPFS + ZIP import/export). The zero-install path for beginners.
  * `host-desktop/`: the same standalone editor in a desktop shell.

**Editor strategy: VS Code is a primary path, not the only path.** Both the VS Code extension and the standalone editor are first-class and ship from the same `editor-ui` components. Neither is a reduced version of the other:
* VS Code serves scripters, experienced authors, contributors and modders of legacy games. It gets git, search, terminal and multi-root workspaces for free.
* The standalone editor serves first-time creators (much of the legacy audience) with the familiar all-in-one layout (tool palette, tileset browser, inspector) and no prerequisite install.
* The LSP and DAP also make the scripting experience available in any other LSP/DAP-capable editor (Neovim, Zed, JetBrains, Helix).
* Feature parity rule: any editor capability (T-xx) lands in `editor-ui` first. Host-specific code is limited to platform services and chrome.

**Desktop shell: ruled 2026-10-31 — two desktop applications plus the PWA.** The owner ruled that the harness is separate from the game bundle: a game is a **package installed into the player's library**, with the player resolving a configured or baked default game, not an executable with the engine appended. A shell is therefore installed once rather than copied into every export. There are **two desktop applications from one codebase** — a **player** (a distribution artefact, carrying no editor code) and an **editor** (`host-desktop`, its own package, its own platform-services instantiation, the harness embedded for preview, its own update cadence) — plus the **PWA** (the web player, the only artefact *this ruling* gives a service worker — the editor PWA's is `host-web`'s). Both desktop applications use **one ruled Electron shell** with a privileged `app://` scheme and no service worker, and one ADR (0013) records the shell and a single licence exception inventory naming both binaries; Tauri is the named fallback if that exception is refused or a measurement fails. The split costs two signing, notarisation and updater pipelines and two release cadences, accepted so that people who never author are not shipped an editor's size or update churn. The ruling's text and its measurements are in `epic-web-runner-packaging`, entry 9.1 (D-1); the shell's ADR is 0013. The platform-services interface keeps the choice reversible.

**Day-one guard-rails.** Option B's softer seam is offset by the binding rules **G1–G7** in [guardrails.md](guardrails.md): step-machine VM, hard package boundaries, determinism, draw-list-only renderers, headless golden CI, licence gate, and clean-room provenance. Each rule has an automated check, and changing one requires an ADR.

**Escape hatch.** If profiling ever shows a hot path (pathfinding, CPU rasterising, synth), move just that module to Rust/wasm behind the same TypeScript interface. That is Option A applied selectively, with no architectural change.

### Alternatives considered (not chosen)

* **Option A, Rust core:** tied on points. It has a stronger enforced seam and native speed, but adds a second language and more friction. It remains the escape hatch above.
* **Godot as an extra runner:** possible later as one more runner that replays the draw list. Never move logic into GDScript.
* **Option C, C++/SDL3:** only for console or very low-end targets.
* **Not recommended:** .NET as the primary stack (weak browser path, MS-PL), Defold (not OSI), LÖVE (12.0 unreleased, unofficial web builds), Bevy as the engine (fights the seam).

---

## 9. First milestones (stack-independent)

1. **Format readers + headless dump tool** for every format in [spec/formats/](spec/formats/README.md). Round-trip tests on `build/game/demo` and `build/game/Basic` from the legacy repo.
2. **RPGCode parser + step VM** with blocking and threads. Run `system.prg`/`start.prg` headlessly with scripted input.
3. **Board render** (draw list → headless PNG) matching legacy screenshots for 2D and both iso modes.
4. **Movement/collision/triggers.** Play the demo's NPC intercept and battle trigger end-to-end headlessly.
5. **Web runner + desktop runner** sharing the core. MIDI via the shared synth.
6. **RPGCode LSP** (diagnostics, hover, outline) on top of milestone 2. It can be released early as a VS Code / Open VSX extension, which delivers value to legacy-game modders before the full editor exists.
7. **Editor P0 tools** (editor-features §11) in `editor-ui`, shipped through the VS Code custom-editor host and the standalone PWA in parallel, then the desktop shell. Add the debug adapter once the VM is stable.

---

## Sources

* Tauri releases and changelog — [tauri.app/release](https://v2.tauri.app/release/), [Tauri 2.0 stable](https://v2.tauri.app/blog/tauri-20/), [Tauri 2.0 RC (mobile caveats)](https://v2.tauri.app/fr/blog/tauri-2-0-0-release-candidate/)
* Desktop shell comparisons — [Tauri/Wails/Electron/Electrobun implementation comparison](https://github.com/pierophp/ai-mission-manager/issues/135), [Desktop frameworks 2026 overview](https://www.youngju.dev/blog/culture/2026-05-14-desktop-app-frameworks-2026-tauri-electron-wails-compose-multiplatform-maui-flutter-comparison-deep-dive-2026.en), [Electron alternatives 2026](https://teamdev.com/mobrowser/blog/top-5-electron-alternatives-in-2026/)
* Bevy — [bevy.org news (0.20)](https://bevy.org/news/), [Bevy 0.20](https://bevy.org/news/bevy-0-20/)
* Godot — [Godot 4.6 release](https://godotengine.org/releases/4.6/), [Exporting for the Web (4.6, C# limitation)](https://docs.godotengine.org/en/4.6/tutorials/export/exporting_for_web.html), [web .NET prototype](https://godotengine.org/article/live-from-godotcon-boston-web-dotnet-prototype/)
* SDL3 — [SDL wiki](https://wiki.libsdl.org/SDL3), [SDL licensing FAQ](https://wiki.libsdl.org/SDL3/FAQLicensing/raw), [Wikipedia (3.4.16)](https://en.wikipedia.org/wiki/Simple_DirectMedia_Layer)
* raylib — [raylib 6.0 release](https://raysan5.itch.io/raylib/devlog/1497342/raylib-60-released), [raylib license](https://raylib.com/license.html)
* PixiJS — [PixiJS v8 launch](https://pixijs.com/blog/pixi-v8-launches), [v8.20 release](https://gamedev.net/news/5221-pixijs-v8200-released/)
* Phaser / Excalibur — [Phaser v4 download](https://phaser.io/download/phaser4), [Phaser 3 vs 4](https://phaser.io/news/2026/05/phaser-3-vs-phaser-4), [Excalibur](https://excaliburjs.com/)
* macroquad — [docs.rs/macroquad](https://docs.rs/macroquad)
* egui/eframe — [eframe on docs.rs](https://docs.rs/crate/eframe/latest), [egui project listing](https://awesome.ecosyste.ms/projects/github.com%2Femilk%2Fegui)
* LÖVE — [LÖVE 12.0 wiki (unreleased)](https://www.love2d.org/wiki/12.0), [2dengine love.js](https://github.com/2dengine/love.js)
* Defold licence — [The Defold License](https://www.defold.com/license), [Defold (Wikipedia)](https://en.wikipedia.org/wiki/Defold)
* Capacitor — [Capacitor for games](https://www.abratabia.com/native-wrappers/capacitor-games.php), [Capacitor releases](https://releasealert.dev/github/ionic-team/capacitor)
* MIDI synths — [rustysynth](https://github.com/sinshu/rustysynth), [spessasynth_core](https://github.com/spessasus/spessasynth_core), [spessasynth_lib](https://github.com/spessasus/spessasynth_lib), [xsynth (LGPL, avoided)](https://github.com/arduano/xsynth)
* SoundFonts — [GeneralUser GS 2.0 licence](https://scancode-licensedb.aboutcode.org/generaluser-gs-2.0.LICENSE), [FluidR3 MIT note (fluid-dev)](https://lists.nongnu.org/archive/html/fluid-dev/2009-03/msg00062.html)
* Audio — [kira (MIT/Apache; wasm limits)](https://docs.rs/crate/kira/latest)
* WebGPU status — [Khronos WebGL & WebGPU (SIGGRAPH 2026)](https://www.khronos.org/developers/linkto/webgl-and-webgpu-sigg26), [WebGPU vs WebGL for games (2026)](https://app.cinevva.com/guides/webgpu-vs-webgl-games)
* VS Code extensions — [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors), [Using WebAssembly for extension development](https://code.visualstudio.com/blogs/2024/05/08/wasm), [WebAssembly part 2 (workers)](https://code.visualstudio.com/blogs/2024/06/07/wasm-part2), [SheetJS VS Code custom editor demo](https://docs.sheetjs.com/docs/demos/extensions/vscode), [Open VSX (Wikipedia)](https://en.wikipedia.org/wiki/Open_VSX), [AWS backs Open VSX (The Register, 2026)](https://www.theregister.com/2026/03/03/open_vsx_aws/), [CVE-2026-13323 Open VSX advisory](https://bugzilla.redhat.com/show_bug.cgi?id=2495898)
* Map editors — [Tiled news (1.12.1)](https://www.mapeditor.org/news), [Tiled (Arch, GPL-2.0)](https://archlinux.org/packages/extra/x86_64/tiled), [LDtk (MIT)](https://community.chocolatey.org/packages/ldtk/1.3.1)

*Unverified in this pass (verify before adoption): TinySoundFont's current maintenance status and licence file; Capacitor core licence file; whether 2026 FluidR3_GM distributions keep the MIT notice; Linux WebKitGTK canvas performance on current distributions (flagged as a risk from general experience, not from a 2026 benchmark).*
