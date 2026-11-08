# ADR 0001 — TypeScript everywhere, with VS Code and standalone editor hosts

* **Status:** Accepted
* **Date:** 2026-10-10
* **Context documents:** [architecture-options.md](../architecture-options.md), [spec/README.md](../spec/README.md), [editor-features.md](../editor-features.md)
* **Later editor-component decision:** [ADR 0021](0021-monaco-code-editor.md) supersedes the CodeMirror example below for standalone/browser code editing; VS Code retains its native text editor.

## Context

The project rebuilds the RPG Toolkit 3 engine and authoring tools from scratch under MIT/Apache, and must read legacy worlds (`.gam`, `.brd`, `.prg` and related formats). The architecture comparison scored a Rust core (Option A) and TypeScript everywhere (Option B) equally at 79/85. A scored higher on fitness and an enforced core boundary; B scored higher on tooling friction, ecosystem and code sharing with the editor, language server and VS Code extension.

The hardest requirements are language-neutral:
* a script interpreter that can pause and resume without OS threads and whose state can be saved (R1, R2);
* a deterministic core (R3);
* MIDI everywhere under a permissive licence (R5);
* a host-agnostic editor (R7, R8).

## Decision

1. **Option B: TypeScript for the core, runners, editor, language server, debug adapter and VS Code extension.**
2. **The core is a pure TypeScript package** with no DOM or Node APIs. Assets arrive as bytes; the clock and RNG are injected. The core emits draw lists and audio cues (architecture-options §2).
3. **RPGCode runs on an explicit step-machine VM.** No generators or async/await for script threads.
4. **Editor hosts:** a **VS Code extension** (webview custom editors, LSP, DAP; Marketplace + Open VSX; a `vscode.dev` web-extension build) **and** a **standalone editor** (PWA first, then a desktop shell). Both are first-class and built from the same host-agnostic `editor-ui` components through a platform-services interface. VS Code is a primary path, **not** the only path.
5. **MIDI:** SpessaSynth (Apache-2.0) behind a synth interface. FluidR3_GM as the default SoundFont, lazy-loaded.
6. **Desktop shell is deferred** to a spike comparing Tauri, Electron and Electrobun (Linux WebKitGTK is the known risk). This is reversible through platform services.
7. **Mobile** runner via Capacitor.

## Consequences

**Positive**
* One language and toolchain. The fastest path to an MVP.
* The editor, LSP, DAP and VS Code extension all import the core directly: identical parsing, diagnostics and preview everywhere.
* The largest UI ecosystem (CodeMirror 6, the VS Code APIs).
* The browser is the native target. Desktop and mobile reuse the web runner.

**Negative / risks, with mitigations**
* *Softer core boundary* (nothing in the compiler stops DOM use). **Mitigation:** separate package, no DOM/Node types in its TS config, lint bans on `window`, `document`, `fetch`, timers and `Math.random`, and CI checks.
* *VM state accidentally tied to the host runtime.* **Mitigation:** explicit step VM with plain-data frames; a save/restore round-trip test of mid-script threads in CI.
* *Performance ceiling on hot paths* (pathfinding, CPU rasterising, synth). **Mitigation:** profile; move individual modules to Rust/wasm behind unchanged TS interfaces (Option A applied selectively).
* *"Native" runners are WebView-based*, so behaviour can vary by OS WebView. **Mitigation:** the desktop-shell spike; Electron fallback.
* *Two editor hosts to maintain.* **Mitigation:** all features land in `editor-ui`; host packages contain only platform services and chrome.
* *Supply-chain risk* from npm and the marketplaces. **Mitigation:** licence and vulnerability gates in CI, pinned dependencies, publisher verification on both marketplaces.

## Guard-rails (enforced from milestone 1)

The binding rules that offset this decision's risks are defined in **[docs/guardrails.md](../guardrails.md)**, which is the single source of truth:

* **G1** step-machine VM with saveable state
* **G2** hard package boundaries (pure core; host-agnostic editor UI)
* **G3** determinism
* **G4** renderers only replay draw lists
* **G5** headless golden tests on every change
* **G6** licence gate
* **G7** clean-room provenance

Changes to those rules require a new ADR.

## Alternatives considered

Rust core (Option A, retained as the per-module escape hatch), Godot as an additional runner, C++/SDL3, .NET, Defold, LÖVE and Bevy-as-engine. Rationale in architecture-options §3–§5 and §8.
