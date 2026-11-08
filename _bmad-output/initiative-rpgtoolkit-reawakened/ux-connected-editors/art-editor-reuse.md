# Reuse before rebuilding: MIT art-editor candidates

**2026-11-08 · initial source-checked shortlist, not adoption approval.** Jensen asked whether existing MIT art editors could support tile editing. Yes: the projects below have MIT top-level licence texts. This does not certify their bundled code, fonts, palettes, assets, codecs or transitive dependencies under G6. No code was copied or dependency added. Upstream default-branch documents were inspected on this date; pin a revision before a formal evaluation.

| Candidate | Upstream documented capabilities | Fit hypothesis and limitation |
|---|---|---|
| [miniPaint](https://github.com/viliusle/miniPaint) | Browser image editor; layers, selection, pencil/fill, transparency, grid, undo, PNG and layered JSON; iframe embedding and open/edit/save examples | First integration candidate for web-based drawing. It is an application, not a proven embeddable document component. The example reaches same-origin iframe globals (`Layers`, `FileOpen`, `FileSave`); this is not evidence of a stable SDK or compatibility with our VS Code CSP/message bridge. |
| [Pixelorama](https://github.com/Orama-Interactive/Pixelorama) | Pixel tools, indexed mode, layers/frame timeline, onion skinning, audio synchronization, tilemap layers, palettes, grids, metadata and command-line exports | Rich external-editor candidate and interaction reference. Godot/GDScript, not a TypeScript component; its web build does not make it a drop-in shared editor. Embedding adds runtime, lifecycle and integration questions. |
| [PixelCraft](https://github.com/rgab1508/PixelCraft) | HTML Canvas pixel drawing, fill/shapes, transparency, animation frames and PNG/GIF export | Smaller implementation to examine for reuse. README recommends dimensions below 128×128, documents pixel-at-a-time undo and scaled export; these are warning signs for sheet-first editing, gesture undo and exact-size round trips. Verify actual revision before relying on or rejecting these documented limits. |

## Recommendation to investigate

Start by testing **miniPaint as a controlled drawing surface**, and **Pixelorama as an external source-art workflow**. PixelCraft is a secondary lightweight candidate, not the default merely because it is smaller. This is an evaluation order, not a library choice or a maintenance ranking; release cadence, responsiveness and integration effort were not audited.

Retain Reawakened ownership of tile identities/indices, tileset roles, board references, shared/local scope, collision/activation geometry, format conversion, commands, dirty state and persistence. A painting application does not supply these game-authoring contracts. Reuse drawing and image operations where they fit instead of letting an embedded application's file store become another source of truth.

Three possible reuse depths need comparison:

1. **External editor:** save supported source art, launch a chosen local editor through host services, watch/reimport explicitly, preserve both versions on conflict. Browser hosts may need export/reimport instead. No cross-tool undo promise.
2. **Embedded application:** isolate its UI but bridge explicit data and lifecycle operations. Prove save/cancel, focus, accessibility, offline operation and CSP in Electron and VS Code. Do not load the public hosted iframe in a shipped editor or copy its broad permission attributes blindly.
3. **Adapted components/operations:** reuse MIT code with notices and a pinned provenance trail, replacing its application persistence/undo with our model integration. Determine the ongoing fork/upstream maintenance cost before choosing this route.

## Acceptance experiment before adopting anything

Use F-04/F-05/F-06, not just a blank canvas demonstration:

- Open an authored 32×32 tile with transparent pixels, paint a multi-pixel stroke, undo it as one gesture and redo; save/reopen with exact dimensions and pixel values.
- Edit a 512×512 sheet while neighboring tile context is locked. Check grid alignment, seam preview, selection and shared-use disclosure. Measure rather than assume responsiveness.
- Preserve layered source separately from flattened runtime output; show what is lost on export. Animation timing, frames and palette/transparency need explicit round-trip checks.
- Promote/hide/reopen the view while dirty; verify one authoritative document, no second independent undo history or silent save.
- Change source externally while dirty, fail a save, cancel an import and remove a required provider; preserve recoverable content and explain the result.
- Repeat in Electron and a VS Code webview, including keyboard editing, scaling, CSP/offline assets and host shortcuts. External launch support is host-specific.
- Audit a pinned release's full dependency/bundled-asset licences and notices, maintenance evidence and security boundary before selection. MIT at repository root is only the first gate.

## What was actually checked

Read upstream README and licence texts for all three candidates, plus miniPaint's open/edit/save example. Smoke-opened the public miniPaint demo in desktop Chromium/Edge: its canvas, menus, colour controls and layer panels rendered. **No drawing/save/undo experiment, packaged-host integration, accessibility audit, performance test or dependency-licence audit was performed.** Pixelorama and PixelCraft were not run.

## Key source files

- [miniPaint licence](https://github.com/viliusle/miniPaint/blob/master/MIT-LICENSE.txt), [README](https://github.com/viliusle/miniPaint/blob/master/README.md), [data-exchange example](https://github.com/viliusle/miniPaint/blob/master/examples/open-edit-save.html)
- [Pixelorama licence](https://github.com/Orama-Interactive/Pixelorama/blob/master/LICENSE), [README](https://github.com/Orama-Interactive/Pixelorama/blob/master/README.md)
- [PixelCraft licence](https://github.com/rgab1508/PixelCraft/blob/master/LICENSE), [README](https://github.com/rgab1508/PixelCraft/blob/master/README.MD)
- [Shared editor architecture](architecture.md), [artwork wireframe](wireframes.html#artwork), [engagement flows](../research-editor-ux-for-beginners/engagement-user-flows.md)
