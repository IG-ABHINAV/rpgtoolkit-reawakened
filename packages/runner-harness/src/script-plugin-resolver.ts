import {
  isPackageManifestEntry,
  isPluginManifestEntryEnabled,
  packageNamespace,
  type PluginDefinition,
  type PluginManifest,
  type PluginManifestDiagnostic,
  type ResolvedPlugin,
} from "@tk-reawakened/core";

/** Host-owned id table. Core receives only the resolved definitions. */
export type PluginDefinitionTable = Readonly<Record<string, PluginDefinition>>;

export type PluginManifestResolution = {
  readonly plugins: readonly ResolvedPlugin[];
  readonly diagnostics: readonly PluginManifestDiagnostic[];
};

/** Resolve an effective manifest without putting a loader in core. */
export function resolvePluginManifest(
  manifest: PluginManifest,
  table: PluginDefinitionTable,
  path = "manifest",
): PluginManifestResolution {
  const plugins: ResolvedPlugin[] = [];
  const diagnostics: PluginManifestDiagnostic[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index]!;
    if (seen.has(entry.id)) {
      diagnostics.push({
        code: isPackageManifestEntry(entry) ? "manifest.duplicate-package" : "manifest.duplicate-id",
        path,
        index,
        message: isPackageManifestEntry(entry) ? `duplicate package "${entry.id}"` : `duplicate plugin id "${entry.id}"`,
      });
      continue;
    }
    seen.add(entry.id);
    if (!isPluginManifestEntryEnabled(entry)) continue;
    // Own-property-safe (#537): an id such as `toString` must be unknown, not inherited.
    const definition = Object.hasOwn(table, entry.id) ? table[entry.id] : undefined;
    if (definition === undefined) {
      diagnostics.push({
        code: "plugin.unresolved",
        path,
        index,
        message: `plugin id "${entry.id}" could not be resolved`,
      });
      continue;
    }
    if (entry.version !== undefined && definition.version !== entry.version) {
      diagnostics.push({
        code: "plugin.version-mismatch",
        path,
        index,
        message: `package "${entry.id}" is declared at version "${entry.version}" but the installed definition is "${definition.version}"`,
      });
      continue;
    }
    const resolved: ResolvedPlugin = {
      definition,
      ...(entry.options === undefined ? {} : { options: entry.options }),
      ...(isPackageManifestEntry(entry) ? { namespace: packageNamespace(entry) } : {}),
    };
    plugins.push(resolved);
  }
  return { plugins, diagnostics };
}
