---
title: "runner-desktop: the player's desktop package — main process, app:// scheme, package asset source and save-blob host"
type: 'feature'
ticket: 11
created: '2026-11-01'
status: done
tracker_id: "#938"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/938"
baseline_revision: 'c6c2f620'
risk: 'medium'
ticket_note: 'the `desktop` CI job ships as a patch for the owner: this account cannot push a workflow change'
context:
  - 'docs/adr/0013-desktop-shell-electron.md, decisions 1 to 3 and the G6 exception'
  - 'docs/spec/engine/runners.md#desktop-shell and #mobile'
  - 'spine AD-17 (blob keys and GameId)'
  - 'packages/runner-web (the build this wraps) and entry 7''s packageFiles'
---

# runner-desktop: the player's desktop package

## Intent

A shell, not a second runner: the `runner-web` build inside Electron 45.2.1, its pages served over a privileged `app://`
scheme, a package read from disk as bytes and a save-blob host behind AD-17's keys. Nothing of the editor, and no window
chrome, launch resolution or library — those are the player application's (entry 10) and `host-desktop`'s (epic 15).

## Decisions taken here

1. **The scheme is registered at module load, which is before `app.ready`**, with `standard`, `secure`,
   `supportFetchAPI` and `corsEnabled`; no page is ever loaded with `loadFile`. No service worker is registered and
   `allowServiceWorkers` is never claimed — on this build the scheme does not even answer the API, which the measurement
   records as `serviceWorkers: 0`.
2. **One build, one asset source, one input path.** The page is the runner's own bundle (`apps/player-desktop.js` built
   from `packages/runner-desktop/app/player.ts` against `@tk-reawakened/runner-web`), a package reaches it through
   `packageFiles`, and bundled assets come from a build-written list because a desktop origin has no directory listing.
3. **The blob host is AD-17's keys and nothing else:** `userData/saves/<gameId>/<path>` and `userData/files/<gameId>/…`,
   with a path that escapes the area refused. The preload exposes four calls through `contextBridge`; there is no
   `nodeIntegration`.
4. **`guardrail-exception: G6 ADR-0013`** sits at the top of the main process, and `tools/licences/desktop-inventory.mjs`
   reads the two files the ADR names (`LICENSES.chromium.html`, `libffmpeg.*`) from the built Electron distribution. It
   reports "not built yet" rather than a silent pass, and the `desktop` CI job runs it on all three runners.
5. **The measurement is the artefact, not a claim.** `tools/desktop/measure.mjs` launches the built shell against a
   package, and the record is written by the main process (`--report`), so no number in it is hand-written.

## Verification

Measured on **macOS 27.0.0 arm64, Electron 45.2.1** (`tools/desktop/measurements/macos.json`):

| Measurement | Result |
|---|---|
| scheme / service workers | `app`, **0** registered |
| package from disk | `demo.tpk`, 623,286 bytes, opened through `packageFiles` |
| tick 120 | previous state hash (current demo closing baseline `91172695de52cfd6`), draw `9a40be8a0b5ca816`, 128 commands |
| WebGL2 | present, `WebGL 2.0 (OpenGL ES 3.0 Chromium)`, max texture 16,384 |
| D-7 blend bound | **exact** — worst channel delta 0 on the `translucent-127` vector |
| audio | 15 ticks (the fixture's hand-worked length), non-silent (energy 61.09) |
| same draw list, same frame | WebGL2 against the reference rasteriser: worst channel **0** over 640×480 |
| save | written through the blob host under `gameId` `desktop-probe-game` and read back, 42 bytes |

**Historical measurement note:** This macOS table records the pre-E-02 desktop run. Its previous state hash is preserved as observed, but is superseded by the current demo closing baseline `91172695de52cfd6`; the draw hash remains `9a40be8a0b5ca816`. No post-E-02 desktop measurement is recorded here.

**Windows and Linux were not measured in this session.** The `desktop` CI job in `.github/workflows/ci.yml` runs the same
`measure.mjs` on `ubuntu-24.04` (under `xvfb-run -a`), `macos-14` and `windows-2022` and uploads each record; that job is
the evidence for those two OSes, and it is wired but has not run yet. Nothing in this entry claims a number for them.

## What this entry does not include

The window chrome, launch resolution (`--game`, `player.json`, the baked default, the library) and the library UI are
entry 10's; the editor application is `host-desktop`'s. The cross-runner save proof — a save written by the desktop
runner loading in the web runner under the same `GameId` — is written and read back inside the desktop runner here; the
web side of that round trip lands with entry 10's save host, because the web runner has no blob host yet.

## Landing

Merged as **`95cca777`** — "feat(entry 11): runner-desktop, the player's Electron shell over the same web build" (PR
[#1004](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1004), squash; #938 closed as completed). #1003 was
the same work on a stale base and is closed.

**The CI job is now merged.** The `desktop` matrix job on ubuntu/macOS/windows and its `gate` dependency were
added to `.github/workflows/ci.yml` by PR #1014; the patch file `tools/desktop/desktop-ci.patch` was deleted once
it landed. This turns the Linux and Windows measurements on in CI.

## What the next entry inherits

- The shell and the four-call bridge; entry 10 adds launch resolution, the library and the window chrome on top of them.
- `packageFiles` from a path, and an `--package` argument the launch resolver can feed.
- The blob host's key layout (`userData/saves/<gameId>/…`); the web side of the cross-runner save round trip still needs
  a blob host in the browser, which is entry 10's.
- `tools/desktop/measure.mjs`, which measures any built shell and writes its record where the job uploads it — entry 10 and
  entry 12 can reuse it rather than inventing a second harness.

## Close-out record

Merged in PR #1004 (merge commit `95cca777f`, 2026-11-01). Measurement
caveat, current as of the 2026-11-03 audit: at that landing only macOS was
measured and the PR body said so; now all three desktop runners measure every
required run — macOS natively, Windows natively, Ubuntu under `xvfb-run` — and
the artifacts `desktop-measurement-macOS/Windows/Linux` of main's merged run
(41618490317) are that evidence. The committed
`tools/desktop/measurements/macos.json` is a historical record: its demo
tick-120 hashes predate the #1048 re-record (the measure lane asserts the
`demo` `board` tick-120 baseline from `golden/regression/closing.json` at run
time), which is why the record carries its retirement note. The G6 inventory
check reports `LICENSES.chromium.html` and `libffmpeg*` per built artefact.
The player application itself — launch resolution, library, baked-default
export, three-OS cold-start acceptance — is entry 9.10 / #936 and stays open.
Ledger entry reconciled to closed issue #938 in the 2026-11-03 ticket audit.
