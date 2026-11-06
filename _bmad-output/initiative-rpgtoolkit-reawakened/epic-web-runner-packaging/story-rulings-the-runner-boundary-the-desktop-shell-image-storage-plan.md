---
title: "Rulings: the runner boundary, the desktop shell, image storage, load modes and mobile scope"
type: 'feature'
ticket: 1
created: '2026-10-31'
status: done
tracker_id: "#926"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/926"
baseline_revision: '674c8a03'
risk: 'high'
context:
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/discovery/inception-proposal.md, section 3'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/epic-web-runner-packaging.md'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-1, AD-3, AD-5, AD-6, AD-14, AD-17, AD-22, AD-27, AD-33, Stack, Operations, Deferred'
  - 'docs/guardrails.md, G2, G4, G5, G6'
  - 'docs/architecture-options.md, sections 4 and 8'
  - 'docs/editor-features.md, T-70 and T-82'
  - 'tools/deps/edges.json'
  - 'docs/spec/engine/audio-media.md#epic9-audio-handoff, #audio-prefetch, #audio-browser-test, #path-b-bank'
  - 'docs/spec/formats/packaging-and-paths.md, Distribution package'
  - 'docs/spec/formats/images.md'
  - 'docs/adr/0002-core-pixels-and-deterministic-maths.md'
---

# Rulings: the runner boundary, the desktop shell, image storage, load modes and mobile scope

## Intent

Give the owner one page of finished ruling text to approve or redirect, so entry 1 could land the normative
paragraphs instead of deciding them during a build. Each block below **is** the paragraph, written to be lifted into the
file it names unchanged. **The owner approved all eleven rulings on 2026-10-31**, including the recommended resolution
of the self-running EXE question, so every block is marked `Approved ruling (owner: Jensen, 2026-10-31)` and entry 1
lands them docs-first.

## Boundaries

The plan records what was approved; entry 1 lands it. Each approval is written into its destination in its own
docs-first commit, per G7 rule 4, and this file changes only its own markings. The mechanical half of entry 1 — merging the
envelope's two `## Notes` headings and recording the four `Source conflict:` lines — was done when the breakdown was
published; the rulings are already in place from the publication commit.

## Approved, 2026-10-31

The owner approved all eleven rulings verbatim. Seven were gating and unblock entry 2 to entry 14 (D-1, D-3, D-4, D-5, D-6,
D-8, D-9); four were advisory and now need no later amendment (D-2, D-7, D-10, D-11). No ruling's substance changed at
approval: the only edits were the marking, the "recommended resolution" label on D-1's EXE ruling, and the
`If the owner had said keep it (not taken)` label on its untaken branch.

| ID | Ruling in one line | Gating? | Lands in |
|---|---|---|---|
| D-1 | Two desktop applications from one codebase plus the PWA: a **player** (distribution artefact, resolving `--game`/deep link → `player.json` → baked default → library) and an **editor** (own package, own platform-services, own cadence), both on Electron 45.2.1 with `app://`; games are packages in a library, no per-game stub, second shell or file association and no self-running EXE produced (T-70 becomes "Make package"; the `CMP1` reader stays for legacy import) — one player build may carry one baked package | **yes** | `docs/adr/0013-desktop-shell-electron.md` (new, one G6 inventory for both binaries), `docs/spec/engine/runners.md#desktop-shell`, `#install`, `docs/spec/formats/packaging-and-paths.md` (Install descriptor), epic `desktop-shell`'s envelope |
| D-2 | Store images as they are; no BMP/GIF transcode; no WebP; PNG only for what we write | no | `docs/spec/formats/images.md` (new Storage policy section), epic Notes |
| D-3 | One normative runner page, one JSON Schema, one vector kit; the TypeScript packages are a binding | **yes** | `docs/spec/engine/runners.md` (new), `packages/runner-harness/schema/runner-protocol-v1.schema.json` (new), `tools/fixtures/runner-protocol/` (new) |
| D-4 | Two load modes with a measured threshold; the core computes the prefetch plan; manifest unchanged | **yes** | `docs/spec/engine/runners.md#load-modes`, `#prefetch`; AD-5 amendment |
| D-5 | The PWA ships a service worker that updates on next launch and never mid-session; neither desktop application registers one | **yes** | `docs/spec/engine/runners.md#offline` |
| D-6 | `runner-mobile` is Capacitor 8.5.3 around the web build; one platform proved; no store work | **yes** | `docs/spec/engine/runners.md#mobile` |
| D-7 | Exact for key, tint and blend choice; at most one unit per channel on blend arithmetic | no | `docs/spec/engine/runners.md#webgl2-agreement` |
| D-8 | esbuild 0.28.2; Vite not installed; single-file IIFE worker and AudioWorklet | **yes** | `docs/adr/0015-web-build-and-test-toolchain.md` (new), `docs/spec/engine/runners.md#build` |
| D-9 | Playwright 1.64.0, Apache-2.0, dev-only and named in ADR 0014 in the `ovsx` pattern | **yes** | `docs/adr/0015-web-build-and-test-toolchain.md` (new), `docs/spec/engine/runners.md#conformance-lane` |
| D-10 | SF2 on the default path and no WebAssembly, so no `wasm-unsafe-eval` there | no | `docs/spec/engine/runners.md#csp-and-banks` |
| D-11 | The player page is `runner-web`'s declared `./app` subpath, not a new package | no | AD-22 amendment in the spine, `packages/runner-web/package.json` |

ADR numbers were the next two free in `docs/adr/` when this was drafted; the rule was renumber-on-first-landing, and
**epic 10's tooling rulings landed `docs/adr/0014-rpgcode-spec-package.md` first**, so the web build and test toolchain
ADR is **0015** and the shell ADR kept **0013**. **`0013` was also wanted by another epic, not claimed by it**: `epic-rpgcode-tooling`'s ruling draft proposes
`docs/adr/0013-rpgcode-spec-package.md` — *"working number; renumber if 0013 is taken"* — so neither epic has priority.
Whichever lands first keeps the number and this page's references to `0013-…` and `0014-…` are re-read at that moment
(if the tooling ADR lands first, this page's two become `0014` and `0015`).

## Corrections made at review (2026-10-31)

Seven contradictions were fixed in place above. Each is dated here with the wording it superseded, none changes a
ruling's substance, and every paragraph keeps its approved marking (then `Proposed ruling (pending owner review; entry
entry 1)`, now `Approved ruling (owner: Jensen, 2026-10-31)`).

1. **D-1, the table row — "no per-game executable, stub or file association"** (superseded). It contradicted the
   ruling's own resolution order for the player (Artefact 2, step 3: "an embedded default project baked in at export")
   and `epic-web-runner-packaging.md:39-40` ("a game is a package installed into the player's library, **with a default
   game baked at export or configured**"). Correct text: *no per-game stub, second shell or file association — one
   player build may carry one baked package*.
2. **D-1, "what the exporter emits" — "and never an engine"** (superseded). AD-6 says "web and desktop bundles embed
   [the distribution package] unchanged", and a pre-configured player build is exactly such a bundle: read literally,
   "never an engine" forbade the baked default the same section rules two paragraphs earlier, and the section's own
   "Rejected alternatives" withdraws *per-game bundled executables*, not a pre-configured build of the one player.
   Correct text: *and no second engine:
   the only executable a game can travel inside is the player build already shipped, with one package embedded
   unchanged (AD-6)*.
3. **D-1, the page this ruling lands in — `docs/spec/formats/packaging-and-paths.md:96`.** The "Distribution package"
   section that gains the new "Install descriptor" section opens with "The editor's 'Make EXE' (T-70) **appends a
   distribution package** to an engine copy", the form correction 2 rules out. The same commit must reword that
   sentence to the package-plus-descriptor form, or to the T-70/T-71 resolution this D-1 proposes.
4. **The ADR-number paragraph — "0013 is already claimed by another epic"** (superseded). The plan it quotes says the
   opposite of a claim: `epic-rpgcode-tooling`'s ruling draft lists `docs/adr/0013-rpgcode-spec-package.md` in its
   "Where the text lands" table as a "*working number; renumber if 0013 is taken*" (that plan, D-1's Files line).
   Correct text: *also wanted by another epic, not claimed by it*, with the `0014`/`0015` consequence stated.
5. **D-4 — "64 MiB standing in until the tracer measures the fetched corpus"** (superseded). The envelope's own
   `Source conflict: SC-3` says "entry 9 measures the fetched corpus instead" (`epic-web-runner-packaging.md:75`), and entry 9
   is the entry that owns the threshold table and its measurement date. Correct text: *until entry 9 measures the fetched
   corpus*.
6. **D-4, Lands in — "an AD-5 amendment in the spine adding the hint request kind"** (superseded as written). The
   enumerated request kinds live in AD-17 (`architecture-rpgtoolkit-reawakened.md:284`), not AD-5, and entry 8's own entry
   names "the AD-17/AD-5 doc-first amendment of the request list" (`tickets.toml`, entry 8). Correct text: *an AD-5
   and AD-17 amendment*.
7. **D-10, Lands in — `docs/spec/engine/runners.md#csp-and-banks` alone** (superseded as written). The ruling says the
   shipped CSP needs no `wasm-unsafe-eval`, while the spine's Operations sentence D-10 cites still ships it
   (`architecture-rpgtoolkit-reawakened.md:497`), so the new page and the spine would disagree the day D-10 lands.
   Correct text: the spine's Operations sentence is made conditional in the same commit.

---

## D-1 — Two desktop applications from one codebase, plus the PWA

**Ruled by the owner on 2026-10-31.** There are **three artefacts and one embedded harness**: a **player** and an
**editor**, each its own desktop application built from the same codebase and the same ruled shell, plus the **PWA**.
The player/editor split is the owner's ruling of 2026-10-31. Earlier drafts of this section spent one copy of the shell
per exported game, then a system-WebView stub per game, then one application that was both editor and player; the owner
withdrew all three on the same day, and the paragraphs below are this ruling's text. The owner approved the wording
word for word on 2026-10-31, so each paragraph carries the `Approved ruling (owner: Jensen, 2026-10-31)` marking.

**Artefact 1 — the harness, embedded by both applications and hosted by the PWA.** One `runner-web` build, unchanged in
all three, that **opens a game package** — by path, by drag-and-drop onto the window, or over `fetch`/OPFS. What the
exporter writes is data, in the shape the core already produces: `writeDistributionPackage`
(`packages/core/src/formats/package/write.ts:288`) takes `{ files, manifest }` and returns
`Result<Uint8Array>` — a `.tpk`-compatible ZIP with `manifest.json { schema, main, index }` at its root and **no
executable of any kind**. What it must also emit is the **install descriptor** below. Legacy appended-ZIP standalone
EXEs are an **import** concern that epic 2 already settles by refusing them
(`docs/spec/formats/packaging-and-paths.md:92`, rule L21), and are never something we emit.

**Artefact 2 — the player: a distribution artefact, not an editor.** The player is the harness built as a
**player-only flavour**, and it resolves the game it opens in this order:

1. an explicit `--game <path>` argument, or a deep link;
2. a configuration file by convention — `player.json` beside the executable, or, when installed, in the operating
   system's configuration directory for the application;
3. an embedded default project baked in at export;
4. if none of those name a project, the installed-game library.

Handing somebody "the player plus my game" is therefore a **pre-configured build or a configuration file**, never a
per-game stub, and the same binary serves a player with many games when nothing is configured. The earlier
**per-game-stub and file-association mechanisms stay withdrawn**: the single-project case is configuration, not
packaging. **The artefact that ships is the export, and the export is what is measured** — a check that passes only in
the development bundle is not evidence.

**Artefact 3 — the editor: its own package and its own application.** The editor is `host-desktop`, a separate package
with **its own application**, its own `platform-services` instantiation, the harness **embedded for preview** (the
editor already runs the game it edits), and **its own update cadence**. It is not a mode of the player, and the player
is not a stripped editor. Epic `desktop-shell` owns it and measures its editor-side behaviour; this epic neither builds
it nor ships it.

**Artefact 4 — the PWA: unchanged.** `runner-web`'s `./app` subpath behind the D-5 service worker stays exactly as D-5,
D-9 and D-11 rule it, and is the **only artefact this epic ships** with a service worker: a desktop application is
already offline, so a worker there would only add an update path D-5 owns for the web. The editor's PWA is `host-web`'s
and its worker is epic editor-foundation's — this ruling neither gives nor forbids one there.

**Both desktop applications use one ruled shell.** The shell is **Electron 45.2.1** (Chromium 156.0.8078.75), the same
for the player and the editor, and it serves every page over a **privileged `app://` scheme** — `standard`, `secure`,
`supportFetchAPI`, `corsEnabled` — registered before `app.ready`, never `loadFile`; neither application registers a
service worker (so neither claims `allowServiceWorkers`). One ADR records the shell for both. The cost this accepts is
stated rather than hidden: **two signing, notarisation and updater pipelines and two release cadences**, which is
justified because the player is distributed to people who never author and must not carry an editor's size or update
churn.

**Approved ruling (owner: Jensen, 2026-10-31) — install registers a package; the player holds a library and a
default game.** There is **no per-game stub and no file association to rely on**: a friend who is sent a game receives a
package plus "install this", and installing means **registering the package with the player**, not wrapping it. The
player keeps a **library**: a versioned host-side registry, outside the save store (AD-17's blob keys are untouched),
holding each installed package's identity (its SHA-256 and the manifest's `schema` and `main`), its path on the desktop
or its OPFS handle on the web, that game's settings, and the **default game**. On the desktop the registry is a small
versioned JSON file in the application-data directory beside copies of the installed packages; in the PWA it is OPFS
(a `library` directory and index), with Cache Storage left to the app shell under D-5. **Core stays I/O-free (G2):** the
application resolves a library entry and hands `core` the package's bytes through the existing asset source; `core`
never knows a registry exists. **Launch:** the resolution order above, so a cold start opens the configured or baked
game and, with none set or the configured one missing, shows the library and says why rather than a blank window. The
editor may read the same registry to open a project, and gains no second mechanism from it.

**Approved ruling (owner: Jensen, 2026-10-31) — the install descriptor.** The package's `manifest.json` keeps
**exactly** `schema`, `main` and `index` (AD-6 refuses any other field), so identity for the library travels in a
**sibling file** the exporter writes next to the package — `<package>.tpk.json` — with `{ schema, file, sha256, size,
gameId, title, version }`: the package's name, its SHA-256 (the same hash D-4 already uses as a cache key), its byte
size, and the identity a library row and a settings entry are keyed by. It is data about the package, not part of it, so
no reader or writer contract changes and two exports of one tree stay byte-identical. *Rejected:* deriving identity by
parsing every installed package at launch, which costs a ZIP read per game to draw a list, and *rejected:* adding fields
to the manifest, which amends AD-6 for a job the descriptor does.

**Approved ruling (owner: Jensen, 2026-10-31) — the measured artefact is the exported player.** There is no
separate "export engine" to test: the engine a player gets is either the PWA or the player application, and both are
measured. entry 10 takes four measurements on the **exported player** — WebGL2 present; the [D-7] blend bound; audio
of the expected length; and a game resolved through the ruled order, from the baked default and from the library at a
cold start — on **Chromium** (the PWA lane, and the engine inside Electron) and on the **Electron build of the player on
macOS, Windows and Linux** in CI. A WKWebView, WebView2 or WebKitGTK leg is added **only if a system-webview application
is ever shipped**; today none is, so no system webview is claimed and none is measured. One further check spans the
artefacts: the same draw list rendered by the PWA build and by the player agrees within the [D-7] bound. The **editor's**
own measurements are epic `desktop-shell`'s Done-when 1, not this epic's.

**Approved ruling (owner: Jensen, 2026-10-31) — a secure scheme is not optional.** Two findings make `file://` a
defect rather than a convenience, even though the applications open game *data* rather than pages from disk. Measured on
2026-10-31 (macOS 27.0.1, Apple M1 Pro): in **WKWebView** a `file://` page refuses `audioWorklet.addModule(blob:)` —
"Cross-origin script load denied by Cross-Origin Resource Sharing policy" — while the same page in Electron loads it;
and **WKWebView cannot register a service worker at all** without Apple's `com.apple.developer.web-browser` entitlement
(WebKit bug **206741**, "WKWebView support for Service Workers", open, filed 2020-01-24). The service-worker half does
not bind this ruling — neither desktop application ships a worker — but the `file://` half does: each application serves
its own pages over a scheme the engine treats as **secure and standard**, so that loading a game from an arbitrary path
can never be what breaks audio.

**Approved ruling (owner: Jensen, 2026-10-31) — G6 exception: one inventory, two binaries.** `electron` is MIT and
the npm package is a build-time dev dependency, but **that sentence does not cover the artefacts we ship**: the Electron
44.7.0 macOS bundle (the version measured) carries `LICENSES.chromium.html` (20,115,518 bytes) whose per-product blocks
place **ffmpeg under LGPL-2.1-or-later** and **`symphonia-core` under MPL-2.0**, and it ships `libffmpeg.dylib`
(2,317,968 bytes). G6 rule 2 blocks both licences and G6 rule 1 names "desktop and mobile builds" explicitly, so the
deviation is recorded, not described away. **ADR 0013 carries one `guardrail-exception: G6 ADR-0013` inventory that
lists both binaries — the player and the editor — from the same Electron version**, a CI check reads each built
artefact's `LICENSES.chromium.html` and `libffmpeg*` with their licences, and any Electron major that changes that
inventory re-opens the exception. One exception therefore covers two binaries, which is the point of building them from
one shell; the inventory is re-read for 45.2.1 when entry 10 builds it. The PWA needs no exception: it ships no browser
engine.

**Approved ruling (owner: Jensen, 2026-10-31) — the pin and its maintenance line.** The desktop shell is
**Electron 45.2.1** (Chromium 156.0.8078.75, published 2026-10-30), not the **44.7.0** the spine pins today: 44 is
Chromium 152 while Chrome stable is 156.0.8078.80, so today's pin is already a Chromium major behind. Both applications
take a bump **together** from the same ADR, so the two binaries never drift; Electron ships a major every **8 weeks** and
supports the **latest three**, so ADR 0013 is amended whenever the pin falls more than one major behind Chrome stable —
a standing maintenance line, not a one-off bump.

**Approved ruling (owner: Jensen, 2026-10-31) — the resolution: we stop *producing* self-running
executables.** We keep the `CMP1` **reader** and stop writing what it reads. An export produces **a distribution
package** — the `.tpk`-compatible ZIP with the three-field manifest — **plus its install descriptor**, and the player
opens it from the library, or a pre-configured build carries one baked in. No export path appends a package to an engine
copy — the only executable a game can travel inside is the player build already shipped, with one package embedded
unchanged (AD-6) — because an appended copy is one engine **per game**: the 293 MB arithmetic above paid per export
instead of once per installation, plus a second build path with its own signing, its own failure modes and its own size
story. In the editor
features, **T-70 becomes "Make package"** — package the game as one distribution package with its install descriptor —
and **T-71 loses its "superseded by EXE" parenthetical** while keeping its `.tpk`-only build step. In the spec, the
"Distribution package (this project's own)" paragraph stops describing the editor as appending to an engine copy, and
the **Standalone EXE** section stays as it is as **reader** behaviour — legacy import only — with one added line saying
this project reads that form and never writes it. The form and the numbers stay proposals in the page's own sense:
"no sample ships a package, so the package numbers have no corpus evidence at all"
(`docs/spec/formats/packaging-and-paths.md:110`). The trade to accept, stated plainly: a player who wants "one file to
hand over" gets one file — the package — plus the player they already installed, and a player who has no harness is
pointed at the PWA or the player download, which is where they got the player from.

**The three spec sentences this would change, quoted as they stand today.**
1. `docs/editor-features.md:184` (T-70): "**T-70 Make EXE.** Package the game into one self-running executable (the
   engine with the game appended), with a custom icon and output path." → "*T-70 Make package.* Package the game as one
   distribution package (§13) plus its install descriptor, with an output path."
2. `docs/editor-features.md:186` (T-71): "Package the game as a single `.tpk` archive for an installed engine (legacy,
   superseded by EXE). … so the build is one step for the `.tpk` and the self-running EXE." → drop "(legacy, superseded
   by EXE)" and end the sentence at "one step for the `.tpk`".
3. `docs/spec/formats/packaging-and-paths.md:96`: "The editor's "Make EXE" (T-70) **appends a distribution package** to
   an engine copy — a `.tpk`-compatible ZIP, …" → "The editor's "Make package" (T-70) **writes a distribution
   package** — a `.tpk`-compatible ZIP, …", with the rest of the sentence unchanged.

**What does not change either way.** Import compatibility is untouched: the reader still accepts a legacy `CMP1`
appended-ZIP game under the L20 trailer rules (`docs/spec/formats/packaging-and-paths.md:90,135`), including the legacy
**leniency** for bytes between the end of the ZIP and the trailer, and still refuses Toolkit 2 Professional EXEs and
self-extracting installers under L21 (`:92,136`). The Standalone EXE section's opening sentence at `:78` describes the
**legacy** editor's own tool, which stays true as format history; the added line is what keeps a reader from taking it
for our behaviour. This resolution is about what we *produce*, not what we *read*.

**Rejected alternatives.** *Keeping the EXE export as an option*: it reintroduces one engine copy per game — 293 MB per
export instead of once per installation — a second build path, a second signing step and its own failure modes, for a
convenience the library plus a baked build already covers; the owner has also said the project over-emphasises exactly
this form. *Dropping the `CMP1` reader*: it would break importing the very games this project exists to play, and that
reader is already written and tested under L20 and L21.

**If the owner had said keep it (not taken).** The export would then need a **player-copy step** — locate or copy the ruled Electron player,
append the package, and patch the icon the way T-70's "custom icon" asks — so T-70 and T-71 stay as written, and entry 7
gains that path with its size consequence recorded beside it (a player copy per export, against the 293 MB measured
installation). Nothing in the player, the library or the resolution order in this D-1 changes either way.

- **Amendment files (this resolution only):** `docs/editor-features.md` §8, the T-70 and T-71 lines
  (`:184` and `:186`); `docs/spec/formats/packaging-and-paths.md`, the opening sentence of "Distribution package (this
  project's own)" (`:96`) and one added line in "Standalone EXE" (`:76`); this plan, when the owner approves; and the
  epic's Notes as the dated decision line. No code changes: `writeDistributionPackage` already writes the ZIP and
  nothing else, and no tool appends a package to an engine today.

- **Lands in:** `docs/adr/0013-desktop-shell-electron.md` (new; renumbered if another ADR takes 0013 first) — one ADR for
  one shell, one G6 inventory naming both binaries — plus `docs/spec/engine/runners.md#desktop-shell` (what a desktop
  application must provide: a secure scheme, the player's resolution order, a library and default-game setting, a
  path/drag-and-drop asset source, `platform-services`, no worker), `#offline` (artefact 4, under D-5) and `#install`
  (what "install a package" means in a host, and that it is not a save). The package bytes themselves stay D-4's
  `#load-modes`; the descriptor's shape lands in `docs/spec/formats/packaging-and-paths.md` as a new "Install descriptor"
  section, because AD-6's three-field manifest must not change to carry it — and that same commit rewords the section's
  T-70 opening sentence ("appends a distribution package to an engine copy", `packaging-and-paths.md:96`), which states
  the form the T-70/T-71 resolution below replaces (correction 3 above). Epic `desktop-shell`'s envelope gains the
  editor-application half.
- **Evidence.** Measured on macOS 27.0.1 / Apple M1 Pro, 2026-10-31: Electron 44.7.0 and a WKWebView host both present
  WebGL2 (16,384 max texture; the only extension difference is `EXT_disjoint_timer_query_webgl2`, Chromium-only), both
  reproduce the [D-7] CPU blend `(dst·(255−a) + c·a + 127)/255` **exactly — worst delta 0 across 1,536 channel
  comparisons** — and both load and instantiate the real `spessasynth_processor.min.js` (4.4.2, 580 KB) with no
  SoundFont present. **Electron has no measured rendering advantage on macOS**, so the recommendation rests on engine
  parity with the claimed browser, not on observed superiority. Measured sizes: Electron 44.7.0 `darwin-arm64`
  130,394,296 B, `win32-x64` 158,293,649 B, extracted 312 MB with `Electron.app` at 293 MB, summed RSS 429,168 KB on a
  page holding a WebGL2 context and an AudioWorklet; spawn to first WebGL2 frame 1,066.9 ms in Electron against
  439–464 ms for a WKWebView host. **That 293 MB is paid once per application installation**, not once per game and not
  once per export — but it is paid **twice** for a user who installs both the player and the editor, which is the
  accepted cost of the split and the reason the player carries neither the editor's code nor its update cadence. Version,
  licence and Chromium-pairing facts read on 2026-10-31 from `registry.npmjs.org/electron`,
  `releases.electronjs.org/releases.json` and `googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json`;
  the G6 inventory read from the downloaded bundle itself; the exporter's output read from `writeDistributionPackage`
  (`packages/core/src/formats/package/write.ts:288`) and `docs/spec/formats/packaging-and-paths.md`. Repo grounds:
  `docs/architecture-options.md` §4–§8, ADR 0001 decision 6, the spine's Stack and Operations sections, G2 rule 4, G4
  and G6, AD-20, T-70/T-82 in `docs/editor-features.md`, and `tools/deps/edges.json` (`["render-webgl2", "editor-ui"]` —
  the editor replays draw lists too, which is why both applications embed the same harness).
- **Rejected alternatives.** *One application that is both editor and player*: withdrawn by the owner on 2026-10-31. It
  is the cheaper build and one update pipeline, but it puts an editor's size and release churn on people who will never
  author, and it makes the editor's update cadence and the player's the same decision. *Tauri as the single desktop
  shell*: the smaller download and no G6 exception, but it turns the desktop leg into three engines (WKWebView, WebView2,
  WebKitGTK) against the one Chromium the PWA already claims, so the same draw list would have to be proven on four
  engines instead of two; it stays the named fallback. *Electrobun*: its default is the same system webview as Tauri (no
  gain), its CEF option is 147,695,098 B for `darwin-arm64` (worse than Electron), its official Linux tier is Ubuntu
  24.04+ only, and its packaged Bun statically links JavaScriptCore under **LGPL-2**, an obligation its MIT licence file
  does not mention. *Wails v3 and NW.js*: a third language, and a licence-free 0.x line that hands page JavaScript full
  Node privilege with no updater. *Per-game bundled executables*: withdrawn by the owner on 2026-10-31 — the player is
  installed once and the game is data; a pre-configured build of the one player, with a package baked in, is
  configuration of that build, not a per-game executable. *A per-game system-webview stub*, and *file association as
  the distribution mechanism*: both withdrawn by the owner on the same day, because the single-project case is
  configuration, not packaging: a stub per game means a second shell, a second signing pipeline and a second engine per
  export for a game that is otherwise a file, and an association is a promise the OS lets a user break and that does not
  exist in the PWA.
- **Flip conditions.** The shell moves to Tauri if **any** of these holds: the G6 exception is refused for either
  binary; the player fails one of the four measurements on any of the three operating systems; the owner rules a
  ~124 MiB macOS / ~151 MiB Windows download unacceptable for the audience; or the eight-week major cadence cannot be
  staffed, in which case a shell with no engine to patch wins by default. Tauri then carries both applications under the
  same `app://` scheme and `platform-services` surface, and entry 10 gains the three system-webview legs it currently does
  not need.
- **If it goes the other way (Tauri ruled):** entry 10 measures the exported player on WKWebView, WebView2 and WebKitGTK as
  well as Chromium, and its WebGL2 leg must name a WebKitGTK floor per distribution; entry 11's main process, capabilities
  file and IPC surface change and Electron's main process is not written at all; entry 14's desktop limb runs the Tauri
  player; epic `desktop-shell` repeats the same substitution for the editor; and D-5 stays web-only either way, because
  neither desktop application registers a worker.

## D-2 — Stored image format (advisory)

**Approved ruling (owner: Jensen, 2026-10-31).** The project stores every game image exactly as the game holds
it — PNG, JPEG, Windows bitmap or GIF — and decodes it only through `core/formats/image`: `decodeTexture` for a still
picture and `decodeGif` for an animation. No import step transcodes a bitmap or a GIF, because a runner hands the core
bytes through the AD-5 `asset` request and never asks the browser to decode a game picture, so native browser support
for these formats cannot affect whether a game plays. Lossless WebP **MUST NOT** be adopted: it would add a second
pure-TypeScript decoder inside `core`, which G2 and G3 make a correctness burden, against no measured benefit. For
pictures this project *writes*, PNG is the format, indexed when the picture holds 256 colours or fewer, and a JPEG is
never re-encoded to a lossless format.

- **Lands in:** `docs/spec/formats/images.md`, a new "Storage policy" section after the shared decode contract; and a
  line in the epic's Notes pointing at it.
- **Evidence:** AD-28 makes `core/formats/image` the one place bytes become pixels, and
  `packages/core/src/formats/image/index.ts:73,110` exports exactly `decodeTexture` and `decodeGif`; the BMP and GIF
  readers are merged (16.11 `e22beff4`, 16.12 `8f2e5b62`); the only measured corpus is 134 files and 6.3 MB for two
  games with a largest file of 430,086 bytes (`docs/spec/formats/packaging-and-paths.md:112`); `sharp` is excluded
  under G6 because libvips is LGPL, and the only PNG *encoder* in the tree is the harness's
  (`packages/runner-harness/src/png.ts`), so transcoding is not a one-line act even once it is wanted.
- **Rejected alternative.** Transcode every bitmap and GIF to PNG at import and add lossless WebP beside PNG. It needs
  an encoder inside the shipped tree, a new import-policy spec section, and a second decoder in `core` for WebP, to
  save bytes on a corpus smaller than a single modern web page.
- **If it goes the other way:** entry 7 gains a transcode step and an encoder decision; entry 9's threshold measurement gains
  a before/after size comparison; if WebP is ruled in, entry 4's texture upload path gains a second decode format, G2's
  allowlist and G6's scan gain a dependency and its licence record.

## D-3 — The runner boundary contract

**Approved ruling (owner: Jensen, 2026-10-31).** `docs/spec/engine/runners.md` is the normative contract between
the core and any runner, and the TypeScript packages are one binding of it, never the contract. It defines four
record families — the draw list (AD-3), the audio cue and its runner message protocol (AD-16 and
`audio-media.md#runner-audio-protocol`), the input event and its reply (AD-14), and the host request (AD-5, AD-17) —
and for each states what a runner **MUST** do, what it **MAY** decide and what it **MUST NOT** feed back. One JSON
Schema is published beside it (`packages/runner-harness/schema/runner-protocol-v1.schema.json`) with a vector kit
(`tools/fixtures/runner-protocol/`, whose generator has a `--check` mode on the `audio-protocol:check` pattern). A
runner proves itself by replaying the vectors; it never depends on a TypeScript type to know what is legal.

- **Lands in:** `docs/spec/engine/runners.md` (new page), `packages/runner-harness/schema/runner-protocol-v1.schema.json`
  (new), `tools/fixtures/runner-protocol/{generate.mjs,vectors.json}` (new), a `runner-protocol:check` script in the
  root `package.json`, and the CI `checks` job.
- **Evidence:** the owner direction recorded in `epic-audio-synth/discovery/audio-exploration.md` §12 ("a runner may
  not be written in TypeScript, but it must have the same shape … a normative behaviour page, a language-neutral
  message schema and conformance vectors"); two working precedents in this tree — raster vectors as plain JSON
  (`tools/fixtures/conformance/raster/vectors.json:1` plus text and TrueType vectors) and the audio protocol's schema
  with a generating `--check` (`packages/synth/schema/audio-protocol-v1.schema.json:1`,
  `tools/fixtures/audio-protocol/generate.mjs`); AD-1 already guarantees every engine argument and result is
  structured-cloneable plain data; the draw union to describe is the eight commands at
  `packages/core/src/ports/draw.ts:94-160`.
- **Rejected alternative.** TypeScript-only: let the package types be the contract. Cheapest, and what most entries
  build anyway, but it fails the recorded direction and leaves the desktop and mobile wrappers — the two places a
  reimplementation is most likely — with nothing to check against.
- **If it goes the other way:** entry 2 shrinks to a responsibilities page for our own runners; the JSON Schema and the
  vector kit are dropped; entry 4 and entry 5 verify against TypeScript fixtures only; entry 3's `tools/browser` harness loses the
  schema-validation step; entry 10 to entry 12 keep their checks but stop promising a portable proof.

## D-4 — Load modes, the threshold and who plans prefetching

**Approved ruling (owner: Jensen, 2026-10-31).** The web runner has two load modes. Below a threshold it
downloads the whole distribution package once, behind a progress screen, and keeps it; above it, it streams assets on
demand. The threshold is not a fixed constant: it is the measured uncompressed size of the largest corpus package,
rounded up to the next whole mebibyte and recorded in a table with its measurement date, 64 MiB standing in until **entry 9**
measures the fetched corpus (the envelope's `Source conflict: SC-3`). The **core** computes the deterministic prefetch
plan and sends it as tiered hints at the AD-5 seam — `now`: the current board, its music, the `.anm` frame sounds of
the animations it uses and the default bank when a MIDI is in this tier; `next`: boards reachable by edge links and
literal `send(...)` targets, the battle background and its sounds; `always`: main-file cursor sounds and the default
bank — and a runner only fetches and decodes ahead. A runner **MUST NOT** parse a board to guess what to prefetch. A
hint never blocks, never changes state or a hash, and never earns a reply. `manifest.json` keeps exactly `schema`,
`main` and `index`; a cached package is keyed by the SHA-256 of its bytes, and per-entry hashes and delta updates wait
until a second published package version exists.

- **Lands in:** `docs/spec/engine/runners.md#load-modes` and `#prefetch`; an **AD-5 and AD-17** amendment in the spine
  adding the hint request kind (AD-17 holds the enumerated request list at `:284`, where `asset`, `loadBlob`,
  `saveBlob`, `listBlobs`, `extension.call`, `quit`, `openUrl` and `playVideo` are named; AD-5 holds the
  blocking/stream/hint rule); and entry 8's code half in `packages/core/src/ports/requests.ts` with the matching
  `HOST_REQUEST_KINDS` entry in `packages/core/src/script/manifest.ts` and the `isRequest` guard in
  `packages/runner-harness/src/driver.ts`.
- **Evidence:** AD-5 (blocking versus stream requests; hints allowed and unable to change state); AD-6 and
  `docs/spec/formats/packaging-and-paths.md:98-106` fix the manifest at exactly three fields and require a reader to
  refuse any other; the synchronous `ProgramLoader.read` (`packages/core/src/script/loader.ts:24-29`) is satisfied by
  the whole-package mode and not by streaming; `audio-media.md#audio-prefetch` supplies audio's share of the tiers;
  the envelope's "about 64 MB" and "largest about 33 MB uncompressed" have no recorded source while the only corpus
  measurement is 6.3 MB for two games (`packaging-and-paths.md:112`); the ZIP reader already parses each entry's
  CRC-32 and sizes (`packages/core/src/formats/package/zip.ts:83,178`), so per-entry keys stay a cheap later step.
- **Rejected alternative.** Stream everything from the start, or let each runner parse boards to guess. The first
  makes every first load a visible stall; the second duplicates the board reader in every host, which
  `audio-media.md#audio-prefetch` rejects by name. Adding per-entry manifest hashes now is rejected because it amends
  AD-6 and the manifest contract for a delta-update benefit no v1 artefact can use.
- **If it goes the other way:** per-entry hashes now add an AD-6 and `docs/spec/formats/` amendment to entry 7 and entry 9 plus
  a re-proof that the write stays byte-identical; dropping streaming leaves entry 9 with storage tiers and stall
  presentation only, and the threshold table still lands; letting a runner parse boards removes entry 8 and gives entry 9 a
  second board parser.

## D-5 — The offline service worker

**Approved ruling (owner: Jensen, 2026-10-31).** The **PWA** — the web player, and the only artefact *this epic
ships* with a service worker (D-1) — ships a worker that caches the app shell, the bundled default bank and the
whole-package download, and that updates on the next launch and **never** mid-session.
Save blobs go through the existing `saveBlob` / `loadBlob` / `listBlobs` contract under `GameId`-keyed paths, and the
service worker never reads a save. The runner **SHOULD** call `navigator.storage.persist()` and **MUST** report an
unpersisted or quota-limited state rather than swallowing it, falling back to streaming for anything it cannot keep. No
background sync, push, accounts or telemetry are added. The PWA is its own static artefact: the editor PWA stays
`host-web`'s, neither desktop application registers a worker, and publishing or deploying the PWA is out of scope for
this epic.

- **Lands in:** `docs/spec/engine/runners.md#offline`, and entry 9's code half in
  `packages/runner-web/app/service-worker.ts`.
- **Evidence:** the spine's Operations section fixes the CSP, the offline-first stance and the update policy in one
  place (`architecture-rpgtoolkit-reawakened.md:497`, "the PWA updates on next launch, never mid-session"); AD-17 fixes
  the blob keys and `GameId`; `host-web` is the editor's PWA (epic editor-foundation), so a player artefact cannot be
  assumed; the release pipeline has no owner (epic 17's proposal D-13).
- **Rejected alternative.** Defer offline to a release epic. It leaves `persist()`, the quota fallback and the cache-key
  policy unowned, and the cache-key policy has to be decided alongside D-4.
- **If it goes the other way:** entry 9 keeps storage tiers and the stall presentation and drops the service worker and the
  `persist()` handling; Done-when 1 to 3 are unaffected; the envelope's "kept offline" narrative is struck.

## D-6 — Mobile wrapper scope

**Approved ruling (owner: Jensen, 2026-10-31).** `runner-mobile` is the `runner-web` build inside **Capacitor
8.5.3** and nothing else: v1 proves one sample game running on a real device or emulator, carrying the same asset
source and the same AD-17 blob keys as the web runner with the Capacitor filesystem behind them. Store submission,
signing, icons, splash screens, deep links and per-platform chrome are out of scope and belong to a release owner that
does not yet exist. The wrapper **MUST NOT** fork the player: a platform difference is a host service or a policy in
the runner page, never a second rendering or input path.

- **Lands in:** `docs/spec/engine/runners.md#mobile`, and entry 12's code half in `packages/runner-mobile/`.
- **Evidence:** `spec-rpgtoolkit-reawakened/packages.md:14` ("`runner-web` in Capacitor"); the edge list already has
  `["runner-web", "runner-mobile"]` (`tools/deps/edges.json`); the spine pins Capacitor 8.5.3
  (`architecture-rpgtoolkit-reawakened.md:453`); `@capacitor/core` is MIT (npm registry, 2026-10-31); ADR 0005 makes
  this its own product with its own packaging decisions.
- **Rejected alternative.** Tauri mobile, which the desktop spike might prefer, or a native shell. The first doubles the
  shell work and carries Tauri 2's documented mobile caveats; the second contradicts "one core, replaying draw lists"
  (G2, G4) for a platform no Done-when criterion asks for.
- **If it goes the other way:** if a native shell is ruled, entry 12 becomes a platform port with its own binding of the
  vector kit and Done-when 5's proof changes from a WebView run to a native run; if store-readiness is required at v1,
  the epic needs an owner and accounts it does not have, and entry 12 grows a limb it cannot finish.

## D-7 — What the WebGL2 agreement bound means (advisory)

**Approved ruling (owner: Jensen, 2026-10-31).** The WebGL2 replayer and the reference rasteriser are compared
**exactly** on every decision the CPU pipeline makes discretely — colour-key exclusion, tint saturation and the choice
of blend — and within **at most one** unit per channel on the arithmetic a GPU may round differently, the `translucent`
and `additive` blends, with the worst per-channel difference reported per vector. The comparison never widens a PNG
golden: `independent-reference` and `regression-baseline` rows stay exact, and a `legacy-screenshot` row stays
report-only.

- **Lands in:** `docs/spec/engine/runners.md#webgl2-agreement`. No guard-rail change is needed: G4's enforcement prose
  already separates "exactly the same result for colour keys and tint" from "images otherwise within the golden
  tolerance", and this ruling is the second half stated once.
- **Evidence:** AD-3's check reads "per-command CPU-vs-WebGL2 conformance fixtures with **exact** match for key and
  tint" (`architecture-rpgtoolkit-reawakened.md:111`); G4's enforcement adds "images otherwise within the golden
  tolerance" (`docs/guardrails.md`, G4); the CPU pipeline's blend is integer division,
  `(dst·(255−a) + c·a + 127) / 255`, which a float blend cannot reproduce bit-exactly on every driver; the ledger
  policy keeps PNG comparison exact for the two gating classes (`docs/spec/engine/parity-checklist.md:30`).
- **Rejected alternative.** Exact equality everywhere. Honest, but unachievable across drivers; chasing it produces
  driver-specific hacks, which is what G4 exists to prevent.
- **If it goes the other way:** requiring exact-everywhere gives entry 4 a software-blend path for the two blends and
  roughly doubles its scope; permitting more than one unit per channel would keep the GL blend but add a tolerance
  field to the ledger and weaken the agreement claim in entry 14.

## D-8 — The web build tool

**Approved ruling (owner: Jensen, 2026-10-31).** The browser artefacts are bundled with **esbuild 0.28.2**, the
bundler AD-22 already names for `host-vscode`. The engine worker and the AudioWorklet are single-file IIFE bundles with
no runtime `import()`, as the spine's Operations section requires. Vite **MUST NOT** be installed: it pulls
`lightningcss` (MPL-2.0) and would need its own ADR before a first install, and nothing here needs HMR. The player page
is a static HTML file plus one bundle, served in development and in the browser tests by a small static server, and no
framework or dev server enters the shipped artefact.

- **Lands in:** `docs/adr/0015-web-build-and-test-toolchain.md` (new, shared with D-9) and
  `docs/spec/engine/runners.md#build` for the artefact shape; entry 3's code half in `tools/browser/build.mjs` and the root
  `package.json` dev dependencies.
- **Evidence:** the spine's Deferred list (`architecture-rpgtoolkit-reawakened.md:545`): "Vite 8 depends on
  `lightningcss` (MPL-2.0). Before the first Vite install (epics web-runner-packaging and editor-foundation), an ADR
  names it as a dev-only tool, or the web builds use esbuild instead"; Operations requires the single-file IIFE bundles
  (`:497`); AD-22 names esbuild for `host-vscode` (`:321`); the spine pins esbuild 0.28.2 (`:439`); `esbuild` is MIT
  (npm registry, 2026-10-31).
- **Rejected alternative.** Vite 8 for HMR and a dev server. It costs an ADR for a copyleft-ish transitive dependency
  that only ever runs on a developer's machine, for a convenience this epic does not need.
- **If it goes the other way:** choosing Vite adds the `lightningcss` dev-only ADR to entry 1 before entry 3 and changes entry 3's
  build script and CI step; choosing neither leaves the epic with no way to ship a browser bundle, which is a stop
  condition rather than a variant.

## D-9 — The browser lane, and why Playwright passes G6

**Approved ruling (owner: Jensen, 2026-10-31).** The browser lane is **Playwright 1.64.0**, one headless Chromium
project, and it is a required `gate` dependency that runs `pnpm fixtures:fetch` first. Playwright is **Apache-2.0**,
rated Gold on the pinned Blue Oak list, so G6 rule 1 admits it outright. It is nevertheless declared a **dev-only**
tool in ADR 0014 in the exact pattern ADR 0002 uses for `ovsx`: the npm packages and the browser binaries Playwright
downloads at install time are never bundled, linked or shipped in any artefact, so the production-tree licence scan
never sees them, and the scan still fails if any Playwright code appears in a shipped tree. The lane serves the fetched
`fixtures/` folder over the local static server, and no test reaches the network.

- **Lands in:** `docs/adr/0015-web-build-and-test-toolchain.md` (new, shared with D-8) and
  `docs/spec/engine/runners.md#conformance-lane`; entry 3's code half in `.github/workflows/ci.yml` (job plus `gate`
  dependency) and the `GROUPS` list in `tools/no-skips/run.mjs`.
- **Evidence:** G6 rule 1 lists Apache-2.0 among the licences it admits, and its Enforcement paragraph is where the
  dev-only rule lives (`docs/guardrails.md:108,115`: "Dev-only tools that are never shipped, bundled or linked sit
  outside this production-tree scan … each one is named, with its licence, in ADR 0002 or a later ADR"); ADR 0002
  records the pattern three times (`docs/adr/0002-core-pixels-and-deterministic-maths.md:14,36,57`, the `ovsx`
  clause); the spine pins Playwright 1.64.0 for headless-browser tests (`:441`); `audio-media.md#audio-browser-test`
  already names Playwright as the tool this epic must use; `@playwright/test` and `playwright-core` declare
  Apache-2.0 on the npm registry (read 2026-10-31).
- **Rejected alternative.** A Node lane pretending to be a browser, or a WebDriver setup. Neither executes WebGL2 or
  Web Audio, which are the two things Done-when 2 and 3 exist to prove.
- **If it goes the other way:** refusing Playwright is a stop condition, not a preference — entry 3, entry 4, entry 5, entry 6 and entry 14
  lose their verification and Done-when 2, 3 and 5's audio limb become unprovable. If a different tool is chosen, it
  needs the same two facts in ADR 0014: its licence on the pinned Blue Oak list, and why it is dev-only.

## D-10 — SF2, WebAssembly and the CSP note (advisory)

**Approved ruling (owner: Jensen, 2026-10-31).** The default audio path ships **SF2** banks only, so it
instantiates **no WebAssembly** and the shipped CSP needs no `wasm-unsafe-eval` for it. `script-src 'wasm-unsafe-eval'`
is allowed only in a build that can load an SF3 bank or a user-supplied `.sf2` that is SF3, and the player page states
which build it is. The web runner **MUST** assert in the browser lane that the default path instantiates no
WebAssembly, so the allowance can never widen silently. SF3 support itself stays unverified and is not promised by
this epic.

- **Lands in:** `docs/spec/engine/runners.md#csp-and-banks`, plus a line in the epic's Notes so the caveat survives
  beside the audio handoff, **and** the Operations sentence in the spine that this ruling narrows
  (`architecture-rpgtoolkit-reawakened.md:497`, "`script-src 'self' 'wasm-unsafe-eval' blob:` … SF3 decoding needs
  `wasm-unsafe-eval`"), which becomes conditional on the build that can load SF3 — otherwise the shipped CSP says one
  thing and this page another.
- **Evidence:** `audio-media.md#audio-browser-test` states the bundled banks are SF2 so the default path needs no
  WebAssembly, and calls the SF3 requirement **unverified**; the spine's Operations section allows
  `'wasm-unsafe-eval'` in the shipped CSP (`:497`) and the review record explains that `spessasynth_core` reaches
  WebAssembly through `stb-vorbis` only for SF3; `audio-media.md#path-b-bank` leaves the bundled bank unresolved, so a
  bank may be TK-16 (SF2) or none.
- **Rejected alternative.** Always allow `wasm-unsafe-eval`. It widens the shipped CSP for a path most games never take,
  and nothing in the epic needs the permission.
- **If it goes the other way:** an SF3 default makes the CSP note mandatory and gives entry 5 a WebAssembly assertion in the
  opposite direction; allowing user banks to be SF3 forces entry 6 to detect the container before promising playback.

## D-11 — Where the player page lives (advisory)

**Approved ruling (owner: Jensen, 2026-10-31).** The player page lives in `packages/runner-web` as a declared
**`./app`** subpath beside the package's `src/index.ts`, and `host-web` remains the editor's PWA. AD-22 gains that
subpath in its own list — "every package exports one public entry `src/index.ts`, plus `./testing` and, for
`runner-web`, `./app`, where needed" — and no new workspace package is created, so `tools/deps/edges.json`, the spine's
Structural Seed and its generated diagram are unchanged.

- **Lands in:** the AD-22 amendment in
  `_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md`,
  and `packages/runner-web/package.json`'s `exports` map.
- **Evidence:** AD-22's rule is written with an explicit "plus `./testing` where needed"
  (`architecture-rpgtoolkit-reawakened.md:321`), so a second declared subpath is an amendment of one clause rather than
  a new convention; `spec-rpgtoolkit-reawakened/packages.md` gives `runner-web` both a player and a preview role
  already; the edge list contains no player package, and adding one means editing the single edge list plus the
  generated diagram for a page with one job.
- **Rejected alternative.** A new `apps/player` package. Cleaner separation, but it changes the single edge list, the
  structural seed and the generated diagram for one template file, and it invites a second runner entry point that
  drifts from `runner-web`'s.
- **If it goes the other way:** a separate package adds itself to `packages/`, `tools/deps/edges.json`, the spine's
  Structural Seed and the regenerated diagram in entry 3, and the AD-22 clause is not needed; entry 9's service worker then
  belongs to that package rather than to `runner-web`.

---

## Landed

**Merged 2026-10-31 in `ff7a65045a5ba0cc3768ac2f5f1793aa28c915fa`** (PR #968, squash), one docs-first commit per
destination:

| Ruling | Destination | Commit |
|---|---|---|
| D-3, D-4, D-5, D-6, D-7, D-10, D-11 | `docs/spec/engine/runners.md` (new; indexed from `docs/spec/README.md`) | `ee608050` |
| D-1 (shell, two applications, `app://`, G6 exception) | `docs/adr/0013-desktop-shell-electron.md` | `b1f1c3f5` |
| D-8, D-9 | `docs/adr/0015-web-build-and-test-toolchain.md` — numbered 0015 because epic 10 landed `0014-rpgcode-spec-package.md` first | `691ae578`, renumbered `993b6ac1` |
| D-1 (install descriptor), the EXE correction | `docs/spec/formats/packaging-and-paths.md#install-descriptor` | `e46283a4` |
| D-2 | `docs/spec/formats/images.md#storage-policy` | `00675112` |
| D-1, D-4, D-10, D-11 (spine side) | AD-5, AD-17, AD-22, the Stack pin 45.2.1, the closed shell open question, the conditional `wasm-unsafe-eval` sentence | `48c0eabf` |
| T-70/T-71 | `docs/editor-features.md` §8 | `6fe18ddf` |
| the approvals and the EXE sweep | epic 9's Notes and five documents | `75c6e5a1` |

`pnpm provenance` and `pnpm lint` were clean at the merge; `tickets.py status` reported `problems: null` with no
`order_conflict`, no `unpinned_after` and no `undeclared_after` for this epic.

## Acceptance

entry 1 is done when the epic's single `## Notes` section holds a dated owner line for all eleven rulings, and each
paragraph above has landed in the file it names, in a docs-first commit that no code commit precedes. The four advisory
rulings land the same way and no longer leave an open question. The `Source conflict:` lines and the Notes merge are in
place from the publication commit.

## Verification

`pnpm provenance`, `pnpm lint` and `tickets.py status` on the epic folder; an anchor check that every `#…` target named
here exists in `docs/spec/engine/runners.md` once written; and a person confirming that each landed paragraph is the
one they approved, word for word.

## Evidence and sources

Consolidated: `docs/architecture-options.md` §4 and §8; the spine's Stack, Operations, Deferred and AD-1, AD-3, AD-5,
AD-6, AD-14, AD-17, AD-22, AD-27, AD-33; `docs/guardrails.md` G2, G4, G5 and G6; `docs/editor-features.md` T-70 and
T-82; `tools/deps/edges.json`; `docs/spec/engine/audio-media.md` anchors `#epic9-audio-handoff`, `#audio-prefetch`,
`#audio-browser-test`, `#path-b-bank`; `docs/spec/formats/packaging-and-paths.md` and `docs/spec/formats/images.md`;
`docs/spec/engine/parity-checklist.md`; `docs/adr/0001`, `0002`, `0005`; the npm registry, crates.io, `electronjs` and
`chrome-for-testing` reads of 2026-10-31 (`@playwright/test` and `playwright-core` Apache-2.0, `electron` MIT,
`esbuild` MIT, `@capacitor/core` MIT, `@tauri-apps/cli` Apache-2.0 OR MIT, `electron` 45.2.1 on Chromium
156.0.8078.75 against Chrome stable 156.0.8078.80); and the D-1 measurement session of 2026-10-31, which ran on **one
machine (macOS 27.0.1, Apple M1 Pro)** and therefore measures the macOS legs only. **No Windows or Linux measurement
exists in this repository yet** — the Windows and Linux halves of D-1 are engine-identity arguments, and entry 10 is the
entry that replaces them with numbers.

## Changed artifacts when approved

- three new files: `docs/spec/engine/runners.md`, `docs/adr/0013-desktop-shell-electron.md`,
  `docs/adr/0015-web-build-and-test-toolchain.md`;
- one new section in `docs/spec/formats/images.md`, one new "Install descriptor" section in
  `docs/spec/formats/packaging-and-paths.md`, one amendment to AD-22 and one to AD-5 in the spine;
- the epic's Notes gain the dated decision lines, including the owner's 2026-10-31 ruling that the harness is separate
  from the game bundle and that there are two desktop applications from one codebase plus the PWA;
- no code, no guard-rail, no manifest and no dependency change in this entry.

## Plan impact on later entries

| Entry | Unchanged by these rulings | Changes if a ruling flips |
|---|---|---|
| entry 2 | writes `runners.md` and the schema under D-3 | D-3 flipped: page only, no schema, no vector kit |
| entry 3 | esbuild bundle, player page, Playwright lane, probes | D-8 flipped: Vite + `lightningcss` ADR first; D-9 flipped: stop; D-11 flipped: new package, edge list and diagram |
| entry 4 | the replayer and the agreement check | D-7 flipped: software-blend path; D-3 flipped: TypeScript fixtures only |
| entry 5 | cue player and Web Audio output | D-10 flipped: WebAssembly assertion in the other direction |
| entry 6 | banks, cache, user `.sf2` | D-10 flipped: container detection before promising playback |
| entry 7 | `make-package` writes the package **and its install descriptor** | D-2 flipped: transcode step and an encoder; D-4 flipped: manifest hashes; D-1 flipped: descriptor shape, and if the owner keeps the EXE export, entry 7 gains the player-copy step and records its size consequence |
| entry 8 | core planner and the hint wire | D-4 flipped: either dropped (runner parses boards) or joined by manifest hashing |
| entry 9 | load modes, storage tiers, service worker | D-5 flipped: no service worker; D-4 flipped: per-entry cache keys |
| entry 10 | builds the **player** application — the ruled shell, the resolution order, the library and the baked default — and gates the exported player on three-OS CI | D-1 flipped: three system-webview legs are added and the Electron leg is dropped |
| entry 11 | `runner-desktop`: the **player's** desktop package (main process, `app://`, asset source, save-blob host) that entry 10's application is built on; the editor is epic `desktop-shell`'s | D-1 flipped: Tauri config and IPC replace the Electron main process |
| entry 12 | Capacitor wrapper on a device | D-6 flipped: native port and vector binding |
| entry 13 | refactor sweep | nothing here changes it |
| entry 14 | closing suite and the CAP-12 signal | D-1 flipped: the desktop limb runs the Tauri app; D-7 flipped: agreement claim weakens |

## Close-out record

Owner-approved rulings were recorded as one `## Notes` envelope, merged in PR
#962 (merge commit `5a676ca0e`, 2026-10-31). The docs amendments — `docs/adr/`
(ADR 0013) and `docs/spec/engine/runners.md` — are a separate docs commit, PR
#968 (merge commit `ff7a65045`, 2026-10-31, "land the eleven approved D-1
rulings and drop the EXE export"), which landed before the first code PR of the
epic, so nothing precedes the docs commit in G7 terms: the docs-only ordering
claim stands and PR #962 itself touched only `_bmad-output/`. The eleven
rulings and the four `Source conflict:` lines carry their dated owner lines in
the `## Notes` envelope above. Ledger entry reconciled to closed issue #926 in
the 2026-11-03 ticket audit.
