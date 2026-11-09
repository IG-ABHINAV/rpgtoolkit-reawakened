# RPGCode package catalogue loader

This page specifies the runtime boundary between the host's package catalogue and the shared plugin manifest. It implements [PKG-1 to PKG-8](rpgcode-modules-and-objects.md#pkg-1) and [E-02](main-loop-and-startup.md#reawakened-boot-sequence); it does not define package distribution or editor behavior.

## Host catalogue

The runner supplies the core an ordered, already-resolved catalogue as plain input data alongside the ordinary project assets. Each entry contains a package `name`, `version`, optional `namespace`, declared `requests`, its actual `PluginDefinition`, and an optional startup `ProgramRef`. The definition is native host code already installed by the runner; core neither loads nor evaluates native code. Startup source is either an inline program reference or a file reference that the host's normal program loader can serve. The package name and version in the catalogue must agree with the definition and the package manifest identity. Catalogue metadata is descriptive input, not a second selection list: only names in the `.gam` TKR package-list extension select packages.

Names match manifest package IDs exactly after the format's ASCII-only name fold. Matching is independent of catalogue order; the `.gam` list determines package order. The catalogue must not contain duplicate names under that fold. A manifest-listed name without a matching catalogue entry is unresolved. The package catalogue is host-owned and core receives no filesystem, archive, network, or descriptor-reader capability (G2).

## Manifest resolution

Boot starts from `ENGINE_DEFAULT_MANIFEST`, then appends one package entry for each TKR name in stored order. For a matching catalogue entry, resolution retains the package's declared name, version, namespace, and host requests, and associates its actual plugin definition and startup reference with that same entry. Namespace defaults to the folded package name, or to the last segment of a qualified one ([PKG-2 amendment](rpgcode-modules-and-objects.md#pkg-2-qualified-ids)). The definition's id and version must match the catalogue identity; disagreement is unresolved rather than silently binding another plugin. Native/default entries continue to resolve through the engine plugin table and retain their existing behavior.

**Legacy rows.** After the package-list entries, boot maps the main file's legacy plugin rows ([main file](../formats/main-file.md#layout) rows 23, 24 and 38b) to stock packages in memory: `tk3menu.dll` is `stock_menu`, `tk3fight.dll` is `stock_battle`; matching compares the reference's last path segment under the same ASCII-only name fold. A mapped package the package list already names is not appended twice, so one legacy row plus one explicit name is one manifest entry. Every other legacy name is unmapped: it installs nothing, stays data in the main file, and reports one `plugin.legacy-unmapped` diagnostic at the main file and the row position (`0` for the menu and battle rows, the slot index for a command-plugin entry). Mapping never rewrites the file.

A resolved package and its startup source travel together in the existing ordered resolved-plugin list. There is one manifest, one command registry, and one `registerPlugin` dispatch path. A package layer's `ProgramRef.owner` is the package name. Package requests remain informational; there is no capability gate.

## Startup and diagnostics

After required main-file, font, and project-program assets are ready, the engine resolves the manifest and creates script services over the resolved plugins. It runs each package startup in manifest order, before the main file's startup program, using the existing deterministic `runPackageStartup` lifecycle. Startup may register package commands, listeners, or behaviors through the existing services. A package startup that waits or exceeds the existing bounded startup slices reports `package.startup-unfinished` as a located boot diagnostic and stops that boot; it is not treated as a successful registration.

Startup has a stricter lifecycle boundary than ordinary package code: it MUST NOT consume the seeded RNG (`random`), read the simulation clock (`gettickcount` or legacy `gettime`), or produce a host request (`request`, including file/blob, save, media, and other host I/O). Each violation reports `package.startup-forbidden` with the package name and operation as a located boot diagnostic and aborts that package-startup pass without retaining partial registrations. This does not change PKG-6's informational declared-request rule for code after startup; it is the deterministic startup contract.

A listed package that is absent from the catalogue installs neither its plugin definition nor its startup program. The engine reports one `plugin.unresolved` diagnostic at the main file and the listed package's zero-based list position, then continues compatibility boot with the remaining resolved plugins and main startup. A game with no TKR package names and no legacy plugin rows has no package diagnostics and retains native/default behavior; a game whose legacy rows map to stock packages still needs those packages in the catalogue, and an unmapped legacy name reports `plugin.legacy-unmapped`.

## Package audio-track declarations

A resolved package definition may declare an ordered `audioTracks` list. Each entry contains a track `name` and an optional positive integer `voiceCount`; omitting `voiceCount` means 1. This is track configuration only: declarations do not name files, provide media bytes, or add an asset root. RPGCode continues to select media through its existing commands.

After the main file's audio settings have been applied, the engine visits selected package definitions in `.gam` package-list order, then each declaration in its stored order. A new name appends after the configured game-file tracks. Names compare using ASCII case-folding; a duplicate keeps its existing position and uses the larger voice count. A declaration with an invalid name/count or whose individual contribution would exceed the effective voice cap or the 16-track limit is rejected without undoing the game-file settings or any earlier accepted declaration. The engine reports a located `media.package-track` diagnostic for each rejected declaration and continues with later declarations.

The effective cap is the authored game-file cap when its aggregate fits; otherwise boot applies the Epic 6 default tracks and cap 32, retaining the independent authored default SoundFont, and reports the single game-file overflow diagnostic at the first crossing track. Package declarations are then merged against that effective configuration.

This metadata is consumed at audio configuration time, not by the package manifest, startup program, or asset resolver.

## Reset and restore

Reset reuses the active resolved manifest and catalogue, reconstructing services and rerunning the same package startup sequence before main startup. Each fresh service/layer table therefore derives its registrations deterministically from the installed packages and their manifest order; package layer tables are not serialized.

The engine owns saved-state hydration (`applyLoadedGame`, `packages/core/src/engine/engine.ts:928`). Its load path builds a scratch state, reruns the installed packages' startup through `makeServices`, refuses the load with `restore.shape` when an installed start-up fails, hydrates the saved state, reruns the active packages' startup against the restored services, compiles the restored programs and verifies every restored VM handle against that session table; each step derives deterministically from the same active catalogue and `.gam` package order. A host therefore must not construct script services or rebuild package startups itself for a load: it supplies that catalogue and order and the engine repeats them. The engine's `SavedGamePort.restored()` remains only the signal to skip initial-board loading; it is not state hydration. (Implementation note, entry 19.19, issue #850: this records the merged engine's existing behaviour; it states no new owner ruling.)

## Host boundary

The host supplies package definitions, metadata and startup program references/sources. Core matches those values to TKR package IDs, preserves located diagnostics, assembles the shared plugin registry and runs the startup lifecycle. Core does not scan directories, parse package descriptors, load archives, fetch files, or import native TypeScript packages. Script package namespace lookup remains the separate deferred PKG-4 concern and is not added by this loader.

## References

- [RPGCode modules and objects](rpgcode-modules-and-objects.md), PKG-1 to PKG-8 and MOD-4
- [Start-up, main loop and timing](main-loop-and-startup.md), E-02 and E-06
- [Main game file](../formats/main-file.md), TKR package-list extension
- [RPGCode packages and trust baseline](../../adr/0008-rpgcode-packages-and-trust-baseline.md)
- [Guard-rails](../../guardrails.md), G1, G2, G3 and G7
