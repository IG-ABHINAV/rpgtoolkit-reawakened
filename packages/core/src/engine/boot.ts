/**
 * Pure helpers for the start-up sequence (E-02, docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence).
 *
 * Nothing here touches state or the host: each function maps the loaded main
 * file and the asset index to plain data the engine then acts on.
 */

import type { MainFile } from "../formats/main-file/model.ts";
import { resolveReference, typeFolder, type AssetKind } from "../formats/main-file/layout.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import type { AssetIndex, AssetRoot } from "../formats/resolver/model.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { Diagnostic } from "../ports/engine.ts";
import type { SectionKey } from "../save/state.ts";
import {
  ENGINE_DEFAULT_MANIFEST,
  ENGINE_PLUGIN_TABLE,
  applyPluginManifestPatch,
  isPluginManifestEntryEnabled,
  type EffectKind,
  type PluginManifest,
  type PluginManifestOperation,
  type PluginManifestPatch,
  type ResolvedPlugin,
} from "../script/index.ts";
import { withOwner } from "../script/program.ts";
import type { PackageCatalogueEntry } from "../script/plugin.ts";
import { foldNamespace } from "../script/manifest.ts";
import type { PostEffect } from "./effects.ts";

/** The canonical key prefix of `kind`'s folder under `root` (docs/spec/formats/README.md#paths-inside-files). */
function folderPrefix(root: AssetRoot, kind: AssetKind): string {
  return root.kind === "package" ? assetKey(`${typeFolder(kind)}/`) : assetKey(resolveReference("", root, kind, ""));
}

/** Every indexed key under `kind`'s folder whose key passes `accept`, in index order and without repeats. */
function keysUnder(index: AssetIndex, root: AssetRoot, kind: AssetKind, accept: (key: string) => boolean): AssetKey[] {
  const prefix = folderPrefix(root, kind);
  const seen = new Set<string>();
  const found: AssetKey[] = [];
  for (const key of index.keys) {
    if (!key.startsWith(prefix) || !accept(key) || seen.has(key)) continue;
    seen.add(key);
    found.push(key);
  }
  return found;
}

/** E-02 step 2: the TrueType files of the project's `Font\` folder, in index order. */
export function privateFontKeys(index: AssetIndex, root: AssetRoot): AssetKey[] {
  return keysUnder(index, root, "fonts", (key) => key.endsWith(".ttf"));
}

/** Every program source under `Prg\`, in index order, fetched so the script runtime can resolve names synchronously. */
export function programKeys(index: AssetIndex, root: AssetRoot): AssetKey[] {
  return keysUnder(index, root, "programs", () => true);
}

/** The ordered TKR package names from the main file's native extension. */
export function mainFilePluginNames(main: MainFile): string[] {
  return [...(main.packagePlugins ?? [])];
}

/**
 * The stock packages the legacy plugin names refer to
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence step 3). Keys are folded file
 * names; the table has no prototype, so a row named like an `Object.prototype` member maps to nothing.
 */
const LEGACY_PACKAGE_BY_FILE: Record<string, string> = Object.create(null);
LEGACY_PACKAGE_BY_FILE["tk3menu.dll"] = "stock_menu";
LEGACY_PACKAGE_BY_FILE["tk3fight.dll"] = "stock_battle";

/** The legacy plugin file names that name a stock package. */
export const LEGACY_PLUGIN_PACKAGES: Readonly<Record<string, string>> = Object.freeze(LEGACY_PACKAGE_BY_FILE);

/** A legacy plugin reference's last path segment, ASCII-case-folded; `\` and `/` both separate segments. */
export function legacyPluginFileName(reference: string): string {
  const separator = Math.max(reference.lastIndexOf("\\"), reference.lastIndexOf("/"));
  return foldNamespace(reference.slice(separator + 1));
}

/** One non-empty legacy plugin row of the main file, with the stock package it maps to. */
export type LegacyPluginRow = {
  /** The main-file field the row came from. */
  readonly field: "menuPlugin" | "fightPlugin" | "plugins";
  /** Zero-based command-plugin slot index; `0` for the menu and battle rows. */
  readonly index: number;
  /** The stored reference, unchanged. */
  readonly file: string;
  /** The mapped stock package, or null when the name maps to none. */
  readonly package: string | null;
};

/**
 * Every non-empty legacy plugin row in mapping order — the menu row, the battle row, then the
 * command-plugin slots (docs/spec/formats/main-file.md#layout rows 23, 24 and 38b).
 */
export function mainFileLegacyPluginRows(main: MainFile): LegacyPluginRow[] {
  const row = (field: LegacyPluginRow["field"], index: number, file: string): LegacyPluginRow => ({
    field,
    index,
    file,
    package: LEGACY_PLUGIN_PACKAGES[legacyPluginFileName(file)] ?? null,
  });
  const rows: LegacyPluginRow[] = [];
  if (main.menuPlugin !== "") rows.push(row("menuPlugin", 0, main.menuPlugin));
  if (main.fightPlugin !== "") rows.push(row("fightPlugin", 0, main.fightPlugin));
  main.plugins.forEach((entry, index) => {
    if (entry.pluginFile !== "") rows.push(row("plugins", index, entry.pluginFile));
  });
  return rows;
}

/**
 * The main file's manifest patch: the package list in stored order, then one entry per mapped legacy
 * row. A package the list already names is not appended twice, so a legacy row and its explicit
 * equivalent are one entry (docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence step 3).
 */
export function mainFilePluginPatch(main: MainFile, catalogue: readonly PackageCatalogueEntry[] = []): PluginManifestPatch {
  const patch: PluginManifestOperation[] = [];
  const named = new Set<string>();
  const append = (name: string): void => {
    const id = foldNamespace(name);
    if (id === "" || named.has(id)) return;
    named.add(id);
    const packageEntry = catalogue.find((item) => foldNamespace(item.name) === id);
    patch.push({
      op: "append",
      entry: packageEntry === undefined
        ? { id }
        : {
            id: foldNamespace(packageEntry.name),
            version: packageEntry.version,
            ...(packageEntry.namespace === undefined ? {} : { namespace: packageEntry.namespace }),
            requests: [...packageEntry.requests],
          },
    });
  };
  for (const name of mainFilePluginNames(main)) append(name);
  for (const row of mainFileLegacyPluginRows(main)) {
    if (row.package !== null) append(row.package);
  }
  return patch;
}

/**
 * E-02 step 3: the engine default manifest plus the package entries named by
 * the main file and by its legacy plugin rows. Legacy rows are data and are
 * never written back; an unmapped name is one located diagnostic.
 */
export function pluginManifestFor(
  main: MainFile,
  mainKeyForDiagnostics: string,
  catalogue: readonly PackageCatalogueEntry[] = [],
): { readonly manifest: PluginManifest; readonly diagnostics: Diagnostic[] } {
  const baseManifest: PluginManifest = ENGINE_DEFAULT_MANIFEST.map((entry) => ({ id: entry.id }));
  const patched = applyPluginManifestPatch(baseManifest, mainFilePluginPatch(main, catalogue), mainKeyForDiagnostics);
  const unmapped: Diagnostic[] = mainFileLegacyPluginRows(main)
    .filter((row) => row.package === null)
    .map((row) => ({
      code: "plugin.legacy-unmapped",
      file: mainKeyForDiagnostics,
      line: row.index,
      message: `${row.field === "plugins" ? `plugins[${row.index}]` : row.field} "${row.file}" has no stock package mapping and stays data (docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence)`,
    }));
  return {
    manifest: patched.manifest,
    diagnostics: [
      ...patched.diagnostics.map((item) => ({
        code: item.code,
        file: item.path,
        line: item.index,
        message: item.message,
      })),
      ...unmapped,
    ],
  };
}

/** Resolve manifest ids against engine defaults and the host's package catalogue. */
export function resolveManifestPlugins(
  manifest: PluginManifest,
  file = "",
  catalogue: readonly PackageCatalogueEntry[] = [],
): { readonly plugins: ResolvedPlugin[]; readonly diagnostics: Diagnostic[] } {
  const plugins: ResolvedPlugin[] = [];
  const diagnostics: Diagnostic[] = [];
  const byName = new Map<string, PackageCatalogueEntry>();
  const duplicates = new Set<string>();
  for (const item of catalogue) {
    const name = foldNamespace(item.name);
    if (byName.has(name)) duplicates.add(name);
    else byName.set(name, item);
  }
  const named = new Set<string>();
  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index]!;
    // A package identity appears once (entry 19.21): the later entry is rejected, so no package starts twice.
    if (!Object.hasOwn(ENGINE_PLUGIN_TABLE, entry.id)) {
      const identity = foldNamespace(entry.id);
      if (named.has(identity)) {
        const packageIndex = index - ENGINE_DEFAULT_MANIFEST.length;
        diagnostics.push({
          code: "manifest.duplicate-package",
          file,
          line: packageIndex >= 0 ? packageIndex : 0,
          message: `package "${entry.id}" is listed more than once in the manifest; the later entry is rejected`,
        });
        continue;
      }
      named.add(identity);
    }
    if (!isPluginManifestEntryEnabled(entry)) continue;
    // Own-property-safe (issue #537): `constructor`, `__proto__` and `toString` are inherited
    // members of a plain object, and selecting one would skip the located `plugin.unresolved`.
    const definition = Object.hasOwn(ENGINE_PLUGIN_TABLE, entry.id) ? ENGINE_PLUGIN_TABLE[entry.id] : undefined;
    if (definition !== undefined) {
      plugins.push(entry.options === undefined ? { definition } : { definition, options: entry.options });
      continue;
    }
    const packageName = foldNamespace(entry.id);
    const packageEntry = byName.get(packageName);
    if (
      packageEntry === undefined
      || duplicates.has(packageName)
      || packageEntry.version !== entry.version
      || foldNamespace(packageEntry.definition.id) !== packageName
      || packageEntry.definition.version !== entry.version
    ) {
      const packageIndex = index - ENGINE_DEFAULT_MANIFEST.length;
      diagnostics.push({
        code: "plugin.unresolved",
        file,
        line: packageIndex >= 0 ? packageIndex : 0,
        message: `manifest id "${entry.id}" has no matching host package definition`,
      });
      continue;
    }
    const namespace = entry.namespace ?? packageName;
    const startup = packageEntry.startup === undefined ? undefined : withOwner(packageEntry.startup, packageName);
    plugins.push({
      definition: packageEntry.definition,
      namespace,
      package: {
        name: packageName,
        version: packageEntry.version,
        namespace,
        requests: [...(entry.requests ?? [])],
      },
      ...(startup === undefined ? {} : { startup }),
    });
  }
  return { plugins, diagnostics };
}

/**
 * One engine-posted effect, shaped like a VM record without `seq` and `tick`
 * (A-13: boot and the animation phase post directly through `postEffect`).
 */
export function engineEffect(section: SectionKey, name: string, args: readonly PlainData[], kind: EffectKind = "state-write"): PostEffect {
  return {
    thread: 0,
    name,
    kind,
    args: [...args],
    out: {},
    result: null,
    patch: { section, path: [], op: "merge", value: null },
    wait: null,
    request: null,
  };
}
