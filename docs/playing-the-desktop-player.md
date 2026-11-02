# Play a game with the desktop player

This page tells you how to run a game in TK Reawakened's desktop player on your own machine. The instructions are for a built checkout and a packaged game.

## What the desktop player is

The desktop player is a small Electron window that opens a packaged game and runs it through the same persistent core engine as the browser and headless runner.

| What works | Limits |
|---|---|
| `pnpm desktop:run --package <your.tpk>` opens any packaged game that has its `.tpk.json` descriptor beside it. A macOS launch of a small authored package showed that package's own board on the canvas, with the status reporting a player position. | This is one observed package, not a claim that every game is playable. |
| Keyboard movement works in the Electron window: `pnpm desktop:input` sends a trusted right-arrow key event to the running player and the reported position moves one 32-pixel step (`208, 191` → `240, 191` on the authored probe package). | Pointer input (click to walk) is wired but not yet proven the same way. |
| The window shows the game at the resolution its own main file asks for — 640×480, 800×600, 1024×768 or a custom size. The whole frame fits and is centred on black. | The window starts at 960×720 and can be resized. The picture normally uses whole-number scaling; if 1× cannot fit, it shrinks fractionally to keep the whole frame visible. |
| A board larger than the frame scrolls: the camera follows the player and clamps to the board's edges. A smaller board is centred. | — |
| A save is written to the desktop host's own storage, under the package's canonical game key. | A save does **not** move between hosts yet: the browser and desktop keep separate stores, so a save made in one is not visible to the other. |
| A rebuilt desktop measurement compares against the current committed baseline: `golden/regression/closing.json` expects demo tick-120 state `32e892e98b3d2a85`, draw `9c0e4d56e59619da` and 122 commands. | Those values are from the closing configuration, not an interactive session. |

The mobile player is wrapped with Capacitor. The Android CI lane builds and launches the demo APK on an API 33 x86_64 emulator, clears app data in CI for a clean first launch, then drives title entry, a board tap, rotation and relaunch. The proof requires the initial host-blob probe to be absent and the first write to succeed, then confirms the blob is present after relaunch. It retains live page readings and four screenshots (title, tap, rotation and relaunch/save) as the `mobile-android-api33-proof` workflow artifact; the board-entry reading is retained in JSON. The tap reading records the trusted touch's canvas coordinate and the player's world position before and after input. This automated proof does not replace the human acceptance check for the mobile story.

## How the picture is sized

The game's main file names the resolution the engine draws. The player fits the whole frame into the available window space and centres it on black. It uses the largest whole-number scale that fits (`1×`, `2×`, `3×` …), keeping pixels crisp. If the frame is too large even at `1×`, it scales down fractionally instead, preserving the proportions and showing every edge. Resizing the window recomputes the fit. A board wider than the frame scrolls with the player; a smaller board sits centred on its own background.

## Where saves live

A save is durable on the host that wrote it, filed under the key every runner derives from the package: `derivePackageIdentity(sorted files)` folded with the main file's bytes. The desktop host stores it as files under Electron's user data directory (`<userData>/saves/<gameId>/…`); the browser page stores it in that origin's `localStorage` under `tkr:saves:<gameId>:…`.

The two stores are separate by construction. The shared key means two hosts agree *which game* a save belongs to; it does not let one read the other's files. Moving a save between the browser and desktop players needs an export/import path or a shared blob service, and neither exists yet.

## What you need

- **git** — to get the source.
- **Node.js** — use the project-pinned version.
- **pnpm** — use the version provided by Corepack and the lockfile.
- **Network access** — sample games are downloaded on demand, not shipped in the repository.

## Run it

Run these from the repository root, in order.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm fixtures:fetch
pnpm make-package fixtures/legacy/demo --closing-plan golden/closing/plan.json --game demo --out fixtures/packages/demo.tpk --title Demo
pnpm desktop:build
```

Then run the measurement or open a visible player window:

```sh
pnpm desktop:measure
pnpm desktop:input --package fixtures/packages/demo.tpk
pnpm desktop:run --package fixtures/packages/demo.tpk
```

`pnpm desktop:input` opens the player, sends real key events through Chromium's debugging protocol, and prints the player position before and after — it exits non-zero when the key did not move the player.

`pnpm desktop:measure` emits machine-readable closing-suite and renderer evidence and closes its window. It compares the `demo` tick-120 result against the committed closing baseline in `golden/regression/closing.json`, which currently expects state `32e892e98b3d2a85`, draw `9c0e4d56e59619da` and 122 commands — it does not check hard-coded literals in this page. The committed macOS report `tools/desktop/measurements/macos.json` is a historical artefact of the date its `measuredAt` field records (2026-11-01); it was taken before the closing-baseline re-record for issue #1048, so it does not describe what a measurement reports on `main` today — its recorded hashes (`91172695de52cfd6` / `9a40be8a0b5ca816`, 128 commands) are superseded — a current measurement is judged against `closing.json`. Rebuild after source changes: the measurement runs the existing desktop build.

## Measurement report

The measured closing-suite report for `demo` at tick 120 contains:

```json
"tick": 120,
"stateHash": "32e892e98b3d2a85",
"drawHash": "9c0e4d56e59619da",
```

These are the current expected values committed in `golden/regression/closing.json` (`demo`, `board` frame at tick 120). Those hashes describe the closing harness configuration, which has no interactive bindings or input/movement owners; they are not hashes for an interactive play session. The visible live session is separate and has its own state as input is received.

## Open the window yourself

A macOS launch showed the room on the attached canvas, with the title/menu text still overlaid. The status showed a player position. The browser interaction test, rather than that desktop observation, proves the right-arrow movement described above.

`pnpm desktop:run` builds the `demo` package for you when you leave `--package` off, and passes the player's other flags through unchanged (`--serve <dir>`, `--page <path>`, `--devtools`, `--quit-after`, `--report <file>`).

## Operating-system notes

- **macOS** — use a running desktop session to see the window.
- **Linux** — on a machine without a display, run the measurement headlessly with `xvfb-run -a pnpm desktop:measure`; a visible window needs a desktop session.
- **Windows** — package paths use backslashes (`fixtures\packages\demo.tpk`). `pnpm desktop:run` handles the Electron binary path for you.

## Two things that can trip you up

- **Electron's download.** On a fresh checkout, `pnpm install` can return before Electron's runtime has finished downloading. If the first `desktop:measure` fails with `ENOENT …/Electron`, allow the download to finish and rerun it.
- **The sample game.** Package creation and measurement need sample games, which `pnpm fixtures:fetch` downloads. If you skip that step, there is no package to open.

## What is out of scope here

- **Mobile / Android** — the mobile wrapper remains a follow-up and is not tested or claimed here.

## References

- The desktop player's own description and rules: `docs/spec/engine/runners.md` ("The desktop applications", "Install, the library and the descriptor").
- The decision that made Electron the shell: `docs/adr/0013-desktop-shell-electron.md`.
- The task that built the player's desktop package: entry 11 of `_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/tickets.toml`.
