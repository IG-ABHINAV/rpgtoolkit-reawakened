# Packages and milestone order

Monorepo, one language (TypeScript). Dependency direction is fixed (G2): `core ← synth ← runner-*/lsp/dap/editor-ui ← host-*`. The exact edges, including same-tier ones, live in the architecture spine (AD-22).

| Package | Responsibility | Capabilities |
|---|---|---|
| `core` | Formats incl. image decoding, asset resolver, world, movement, triggers, RPGCode step VM, battle and menu rules, tick pipeline, draw-list and audio-cue builders, text layout and glyph rasterisation, reference rasteriser, save model. No DOM, no Node. | CAP-1…6, 8…11 |
| `synth` | MIDI via SpessaSynth (Apache-2.0) behind a small interface; FluidR3_GM default SoundFont, lazy-loaded; user `.sf2` allowed. | CAP-7 |
| `render-webgl2` | WebGL2 draw-list replayer, imported by `runner-web` and `editor-ui`. | CAP-6, 12, 15 |
| `runner-web` | Web Audio/AudioWorklet output (spessasynth_lib), fetch/OPFS asset source, wraps `render-webgl2`. Also the preview runner inside editor hosts. | CAP-12 |
| `runner-harness` | Platform-neutral harness: CPU rasteriser from `core`, null audio, scripted input; used for CI goldens and by `dap`. | CAP-12, 13, 14 |
| `runner-headless` | Thin Node/Bun shell (files, CLI) over `runner-harness`. | CAP-12, 13 |
| `runner-desktop` | `runner-web` in a desktop shell, file-system asset source, embedded-archive loader. | CAP-12 |
| `runner-mobile` | `runner-web` in Capacitor. | CAP-12 |
| `lsp`, `dap` | RPGCode language server, linter, formatter, test framework, help generator and debug adapter built on core's parser and VM. | CAP-14 |
| `editor-model` | DOM-free document model: bytes and a stack of serialisable commands; runs in the VS Code extension host and in-page elsewhere. | CAP-15…18 |
| `editor-ui` | Host-agnostic editor components (board, sprite, animation, tile/tileset, tile bitmap, data editors; Monaco for standalone/browser scripts, with VS Code using native text editing per [ADR 0021](../../../docs/adr/0021-monaco-code-editor.md)) over the platform-services interface (fs, project, run, export, dialogs, clipboard, document events, language.connect, shell.openExternal, settings). | CAP-15…17 |
| `host-vscode` | VS Code extension: webview custom editors, bundled LSP and DAP, tasks, `vscode.dev` web build; VS Code Marketplace and Open VSX. | CAP-18 |
| `host-web` | Standalone PWA editor (File System Access API / OPFS + ZIP). | CAP-18 |
| `host-desktop` | Standalone editor in a desktop shell; shell chosen by spike. | CAP-18 |

## Core ↔ runner seam (data only)

Fixed by the architecture spine (AD-1, AD-3, AD-5, AD-14, AD-27); summary:

- In: `advance(ticks, inputs: { tick, event }[])`. Events are keys, pointer, gamepad, `focus`, `audio.ended`, `video.ended`, and the replies to requests (`asset`, `blob.loaded`, `blob.saved`, `blob.listed`, `extension.result`).
- Out: `TickReport` (ticks run, consumed inputs as the canonical log, audio cues, requests with `reqId`, diagnostics, `loading`, `paused`) and a pure `drawList(alpha?)`: an ordered, integer-pixel list of `blit`, `fill`, `line`, `rect`, `ellipse`, `text`, `pushTarget`, `popTarget`. Persistent surfaces are core-owned; runners pull pixels with `surfacePixels(id, rev)`.
- Requests are blocking (they freeze simulation time) or stream. The core asks for assets by canonical key through a shared resolver. Text layout, glyph rasterisation and image decoding are core-owned, so script-read pixels match the screen on every runner. Blocking script calls never block the host: the VM yields and the runner keeps calling `advance`.

## Milestone order (stack-independent)

1. Format readers and headless dump tool; round-trips on `demo` and `Basic`.
2. RPGCode parser and step VM with blocking and threads; run `system.prg`/`start.prg` headlessly.
3. Board render (draw list to headless PNG) for 2D and both iso modes.
4. Movement, collision, triggers; the demo's NPC intercept and battle trigger end-to-end headlessly.
5. Web and desktop runners sharing the core; MIDI through the shared synth.
6. RPGCode LSP on the milestone-2 parser, released early as a VS Code / Open VSX extension.
7. Editor P0 tools in `editor-ui`, shipped via the VS Code host and the PWA in parallel, then the desktop shell; DAP once the VM is stable.

Scaffolding with all G1–G7 checks lands with the first code commit, not later.
