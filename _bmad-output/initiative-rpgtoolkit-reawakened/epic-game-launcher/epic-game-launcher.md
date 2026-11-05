---
type: epic
title: "The Universal Game Launcher: Marketplace, Library and Local Packages"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-12"]
assignee: ""
risk: medium
tracker_id: "#1347"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1347"
---

# The Universal Game Launcher: Marketplace, Library and Local Packages

## Description

Builds the **Player Application Launcher** across the desktop shell (`runner-desktop`), the web PWA (`runner-web`), and
the mobile wrapper (`runner-mobile`). It serves as the primary player-facing front door, providing:
1. An online **Marketplace** catalog browser for streaming or installing community games.
2. A local **Library** registry of installed and previously-played games, linking save slots directly to quick-resume actions.
3. A **Local File / Finder** ingestion bridge allowing players to drag and drop or select `.tpk` / `.zip` packages from
   disk, running them client-side in memory with **zero network upload**.
4. The ruled **Launch Resolution** sequence that cleanly routes command-line flags, deep links, config files, and baked
   defaults to either the target game or the Launcher UI.
5. **Standalone Export Wrapping:** A dedicated packaging pipeline for creators who want to distribute self-contained,
   standalone games for Desktop (Steam/itch.io/GOG native binaries), Web (itch.io HTML5 zip), and Mobile (App Store / Play Store)
   that bypass the Launcher UI completely and boot directly into gameplay.

## Outcome

Players can launch and manage games on desktop, browser, and mobile without requiring CLI arguments or manual URL query
hacking, and creators can package their games as standalone commercial or freeware releases. The normative specification
in `docs/spec/engine/launcher.md` is fully satisfied.

## Done when

1. A cold start of the player application with no game specified displays the Launcher UI on desktop, web, and mobile.
2. The Marketplace tab loads a remote catalog, presents game cards, and downloads/streams packages via `createLoadController`.
3. The Library tab persists installed packages across reboots in `library.json` (desktop) and OPFS (web/mobile), linking
   AD-17 save blobs to a "Resume" button.
4. Dragging and dropping a `.tpk` or choosing a file from the finder/picker opens the game immediately client-side, with
   network logs confirming zero bytes were uploaded.
5. Exiting a game session returns cleanly to the Launcher UI without reloading the application window.
6. A standalone export for desktop (embedded package in `resources/` + `player.json`), web (static HTML5 bundle with embedded package),
   and mobile (Capacitor project with embedded package) boots directly into the game canvas, bypassing the Launcher UI.

## Boundaries

The Launcher UI lives in `runner-web` and is consumed by `runner-desktop` and `runner-mobile`. It communicates with
`core` solely by resolving package bytes and passing them to the existing runner asset source. `core` never touches the
launcher DOM or library registry (G2).

## References

- spec - docs/spec/engine/launcher.md
- spec - docs/spec/engine/runners.md#install
- ruling - docs/adr/0013-desktop-shell-electron.md, decisions 4 and 5
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-6, AD-17
- constraint - docs/guardrails.md, G1, G2, G3, G6
