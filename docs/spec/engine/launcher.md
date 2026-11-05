# Game Launcher and Library

The normative specification for the **Player Application Launcher**: how a player discovers, selects, imports, and
launches game packages across Desktop, Web, and Mobile.

It builds directly upon [ADR 0013](../../adr/0013-desktop-shell-electron.md) (the desktop shell and install descriptor)
and [runners.md](runners.md#install) (the library registry and launch resolution).

**Status.** Normative. This page defines the host-side orchestration and presentation contract for the player
application. The UI and storage services live in `runner-web` and are consumed identically by the desktop Electron shell
(`runner-desktop`), the web PWA, and the mobile Capacitor shell (`runner-mobile`).

**Guard-rail invariants:**
- **G1 & G3:** The launcher is a host application shell. It never runs inside the game VM tick loop and does not affect
  simulation state hashes.
- **G2:** `core` remains strictly I/O-free. The launcher resolves an installed, fetched, or local package, verifies its
  descriptor, and feeds raw bytes to the engine asset source. `core` never learns of the launcher or registry.
- **G6:** No copyleft or restricted dependencies. The launcher UI is built with standard web technologies (HTML, CSS,
  TypeScript) bundled via esbuild (ADR 0015).

<a id="launch-resolution"></a>
## Launch resolution order

When the player application executable or URL boots, it resolves the target game in this exact fixed order:

1. **Explicit argument or deep link:** An explicit CLI `--game <path>` argument (desktop) or a `?package=<url>` query
   parameter (web), or a platform deep-link invocation (`tkr://play?game=<id>`).
2. **Configuration file:** A `player.json` file placed beside the executable (desktop portable mode) or in the OS
   application configuration directory.
3. **Baked default project:** An embedded package bundled into the application distribution at export time.
4. **Interactive Launcher UI:** If none of the above name a valid project, the application displays the **Launcher UI**
   and states why, never rendering a blank window or crashing with an unhandled exit.

Quitting an active game session or encountering a fatal load error returns the user cleanly to the Launcher UI.

<a id="standalone-distribution"></a>
## Standalone distribution: wrapping for each harness

While the Universal Launcher is the ecosystem's golden path for library management and discovery, **standalone game
distribution** is a fully supported export target for creators who want to ship their game as an independent,
self-contained commercial or freeware release (e.g. for Steam, itch.io, GOG, the App Store, or Google Play).

In standalone mode, **the Launcher UI is completely bypassed**. Launch resolution hits **Step 2 (`player.json`)** or
**Step 3 (Baked default project)** immediately upon startup:

```
[Standalone App Boot] ---> Resolves Embedded Project ---> [Direct Gameplay Canvas]
                                                              (Zero Launcher UI)
```

### 1. Desktop Standalone (`runner-desktop`)
* **Use case:** Steam, itch.io desktop download, GOG, or direct distribution installers.
* **Mechanism:** The editor exporter bundles the game's `.tpk` package and descriptor into the Electron application's
  `resources/` directory and writes a companion `player.json { "defaultGame": "resources/game.tpk" }`.
* **Packaging:** Standard Electron builders package the runner into native standalone binaries:
  * macOS: Signed and notarized `.app` / `.dmg` bundle with custom game icon.
  * Windows: Signed NSIS installer or portable `.exe` with custom game executable icon.
  * Linux: Standalone `.AppImage` or `.tar.gz`.
* **Behavior:** Double-clicking the application launches straight into the game canvas. On exit, the application
  terminates cleanly rather than falling back to a launcher view.

### 2. Web Standalone (`runner-web`)
* **Use case:** itch.io playable in-browser HTML5 game, game jam submission, or self-hosted portfolio website.
* **Mechanism:** The export produces a static zip archive containing the `runner-web` client assets plus the game's
  `.tpk` and descriptor pre-placed in `public/game.tpk`.
* **Behavior:** When loaded in a browser or iframe, the page immediately boots the embedded package behind a styled
  progress/title screen via `createLoadController`. No library, marketplace, or file-picker chrome is shown.

### 3. Mobile Standalone (`runner-mobile`)
* **Use case:** Apple App Store and Google Play Store standalone native apps.
* **Mechanism:** The Capacitor project embeds the game package in `public/game.tpk` and configures native application
  metadata (App ID, Display Name, Version, App Icon, and Splash Screen).
* **Behavior:** Tapping the game app icon on the home screen immediately launches the game in fullscreen landscape mode,
  respecting hardware safe areas and utilizing the game's custom touch controls (or margin fallback pad).

---

<a id="three-pillars"></a>
## The three ingestion pillars

The Launcher provides three distinct avenues for playing a game:

```
+--------------------------------------------------------------------------+
|                        UNIVERSAL LAUNCHER UI                             |
+--------------------------------------------------------------------------+
|  [Tab: Library (Played Before)]  [Tab: Marketplace]  [Tab: Open Local]   |
+--------------------------------------------------------------------------+
|                                                                          |
|  +-------------------+  +-------------------+  +-------------------+     |
|  | Game A            |  | Game B            |  | Game C            |     |
|  | [Resume: Ch. 4]   |  | [Play]            |  | [Play]            |     |
|  +-------------------+  +-------------------+  +-------------------+     |
|                                                                          |
|  [ Drop .tpk package anywhere or click "Browse Local File..." ]          |
+--------------------------------------------------------------------------+
```

### 1. Marketplace and Community Catalog

The Marketplace tab allows browsing remote packages hosted on public CDNs, game portals, or project repositories:

* **Catalog Manifest:** The launcher fetches a static JSON catalog (`catalog.json`) from a configured endpoint:
  ```typescript
  type CatalogManifest = {
    readonly schema: number;
    readonly games: readonly CatalogEntry[];
  };

  type CatalogEntry = {
    readonly id: string;
    readonly title: string;
    readonly version: string;
    readonly author: string;
    readonly description: string;
    readonly thumbnail: string;
    readonly packageUrl: string;
    readonly descriptorUrl: string;
    readonly sha256: string;
    readonly size: number;
  };
  ```
* **Streaming and Offline Installation:**
  * When a player clicks **"Play"**, the launcher uses `createLoadController` to stream or download the `.tpk` package
    based on the size threshold ([runners.md#load-modes](runners.md#load-modes)).
  * When a player clicks **"Install"**, the package and descriptor are downloaded into the host's durable package store
    (OPFS on web/mobile, local filesystem on desktop) and registered in the Library.

### 2. Played Before (The Local Library)

The Library tab displays games already installed or previously played on this device:

* **Presentation:** Displayed as a responsive card grid or carousel showing each game's thumbnail, title, version,
  author, and last played timestamp.
* **Save State Integration:** Because game saves are partitioned by `GameId` under AD-17, the library queries the blob
  store for the game's existing save blobs:
  * If valid saves exist, the card displays a primary **"Resume"** button (resuming the most recent save slot) alongside
    a secondary **"New Game"** action.
  * If no saves exist, the primary action is **"Play"**.
* **Management:** Players may remove a game package from their local storage or export their save blobs.

### 3. Local Files (No-Upload Ingestion)

The launcher supports opening arbitrary `.tpk` or `.zip` packages stored locally on the player's computer or device:

* **Desktop:** Native file selection dialog (`dialog.showOpenDialog`) or file drag-and-drop onto the window.
* **Mobile:** System file picker via Capacitor FilePicker / iOS Files app / Android Storage Access Framework, or
  handling incoming "Open In..." document share sheets.
* **Web (Browser PWA):** HTML5 drag-and-drop zone and `<input type="file" accept=".tpk,.zip">` or the File System
  Access API (`window.showOpenFilePicker()`).
* **Zero-Upload Invariant (MANDATORY):**
  * All file inspection, validation, and reading must execute **100% client-side in memory**.
  * Under no circumstances may package bytes, manifests, or descriptors be uploaded to a remote server.
  * The web runner reads the local file directly into an `ArrayBuffer` via `file.arrayBuffer()` or slices ranges via
    `file.slice()`.
  * The user is offered an optional toggle: *"Keep in offline library"* (which copies the bytes directly into local
    sandboxed OPFS storage without any network transfer).

<a id="storage-and-registry"></a>
## Library storage and schema

The library registry is a versioned JSON document maintained outside the core simulation state and outside the AD-17
save blob store.

* **Physical Location:**
  * **Desktop:** `library.json` inside the application-data directory (e.g. `~/.config/tkr/library.json` or
    `%APPDATA%/tkr/library.json`).
  * **Web & Mobile:** Stored as `library/registry.json` inside the Origin Private File System (OPFS), with IndexedDB
    metadata fallback.
* **Registry Schema (`library.schema = 1`):**
  ```typescript
  type LibraryRegistry = {
    readonly schema: 1;
    readonly defaultGameId: string | null;
    readonly entries: readonly LibraryEntry[];
  };

  type LibraryEntry = {
    readonly gameId: string;
    readonly title: string;
    readonly version: string;
    readonly sha256: string;
    readonly size: number;
    readonly packageLocation: string; // Absolute path on desktop, OPFS relative path on web
    readonly installedAt: string;     // ISO 8601 timestamp
    readonly lastPlayedAt: string | null;
    readonly customSettings?: {
      readonly volumeMaster?: number;
      readonly soundFont?: string;
    };
  };
  ```

Validation must confirm that `sha256` and `size` match the package bytes before any entry is launched or registered.
A package failing integrity checks is refused with an explicit diagnostic explaining the mismatch.

<a id="runner-handoff"></a>
## Session handoff lifecycle

The player application manages the transition between the launcher and active gameplay:

1. **Selection:** A package source is confirmed (Marketplace download, Library entry, or picked local file).
2. **Audio Unlock:** The user gesture that clicks "Play" or selects the game satisfies the browser/mobile audio
   autoplay policy, initializing the `AudioContext` and unlocking the worklet before canvas mount.
3. **Mounting:** The launcher DOM unmounts (or hides), the WebGL2 presentation canvas mounts, and `createLiveSession()`
   initializes with the package's asset source and the durable blob host.
4. **Session Loop:** Gameplay advances at the fixed 60 Hz tick.
5. **Exit / Teardown:** When the game script triggers an exit or the user presses the host exit key (`Escape` / Quit
   button):
   * Active audio cues and voices are stopped.
   * WebGL2 textures and surface buffers are released.
   * The canvas unmounts, and the Launcher UI restores its previous view, updating the game's `lastPlayedAt` timestamp in
     the library registry.
