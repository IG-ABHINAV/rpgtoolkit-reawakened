/**
 * The engine plugin manifest: plain-data selection and ordering for plugin
 * layers (ADR 0004 decision 6; docs/spec/engine/plugins-and-battle.md#e-99).
 *
 * One list serves native packs and RPGCode packages (PKG-1; ADR 0008): a
 * package is an entry that also carries `version`, and optionally `namespace`
 * and `requests` (PKG-2). A host resolves ids to code; core only validates and
 * patches the data, so it never loads a module or touches a host API.
 */

import type { RunnerRequest } from "../ports/requests.ts";
import type { PlainData } from "../ports/plain-data.ts";

/**
 * The host-request kinds a package may declare (AD-17, PKG-6). Declarations are
 * informational: nothing is refused for an undeclared request (ADR 0008).
 */
export const HOST_REQUEST_KINDS = [
  "asset",
  "loadBlob",
  "saveBlob",
  "listBlobs",
  "extension.call",
  "quit",
  "openUrl",
  "playVideo",
  "prefetch",
] as const satisfies readonly RunnerRequest["kind"][];

// Compile-time exhaustiveness: a new RunnerRequest kind must be listed above.
type _MissingKinds = Exclude<RunnerRequest["kind"], (typeof HOST_REQUEST_KINDS)[number]>;
const _kindsAreExhaustive: [_MissingKinds] extends [never] ? true : never = true;
void _kindsAreExhaustive;

export type HostRequestKind = (typeof HOST_REQUEST_KINDS)[number];

/**
 * One manifest entry. `core` is the first (bottom) pinned layer. The entry is a
 * package entry exactly when `version` is present (PKG-2): `id` is the package
 * name (a folded identifier), `version` is compared for equality only,
 * `namespace` defaults to the id, and `requests` lists declared host-request
 * kinds for a runner to show.
 */
export type PluginManifestEntry = {
  readonly id: string;
  readonly enabled?: boolean;
  readonly options?: PlainData;
  readonly version?: string;
  readonly namespace?: string;
  readonly requests?: readonly HostRequestKind[];
};

/** A package's declaration as plain data, for a runner to show. */
export type PackageDeclaration = {
  readonly name: string;
  readonly version: string;
  readonly namespace: string;
  readonly requests: readonly HostRequestKind[];
  readonly enabled: boolean;
};

/** The ordered, data-only plugin selection. */
export type PluginManifest = readonly PluginManifestEntry[];

/** A by-id edit to an effective manifest. */
export type PluginManifestOperation =
  | { readonly op: "remove"; readonly id: string }
  | { readonly op: "disable"; readonly id: string }
  | { readonly op: "reorder"; readonly ids: readonly string[] }
  | { readonly op: "replace"; readonly id: string; readonly entry: PluginManifestEntry }
  | { readonly op: "append"; readonly entry: PluginManifestEntry };

/** A patch is applied in array order, deterministically. */
export type PluginManifestPatch = readonly PluginManifestOperation[];

/** A located manifest error. `index` is an entry or operation index. */
export type PluginManifestDiagnostic = {
  readonly code: string;
  readonly path: string;
  readonly index: number;
  readonly message: string;
};

export type PluginManifestPatchResult = {
  readonly manifest: PluginManifest;
  readonly diagnostics: readonly PluginManifestDiagnostic[];
};

export type PluginManifestParseResult = {
  readonly manifest: PluginManifest | null;
  readonly diagnostics: readonly PluginManifestDiagnostic[];
};

/** The engine's current packs, in command-layer order. */
export const ENGINE_DEFAULT_MANIFEST: PluginManifest = [
  { id: "core" },
  { id: "media" },
  { id: "battle" },
  { id: "catalogue" },
  { id: "world" },
  { id: "render" },
  { id: "gsmisc" },
  { id: "triuken" },
  { id: "filereadwrite" },
  { id: "proplug" },
  { id: "xfmwin" },
  { id: "kaimu" },
  { id: "twbutton" },
];

/** Descriptive alias for callers that want the default explicitly. */
export const DEFAULT_PLUGIN_MANIFEST = ENGINE_DEFAULT_MANIFEST;

function diagnostic(
  code: string,
  path: string,
  index: number,
  message: string,
): PluginManifestDiagnostic {
  return { code, path, index, message };
}

export function isPlainData(value: unknown, seen: Set<object> = new Set()): value is PlainData {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value) || !isPlainData(value[index], seen)) return false;
    }
    seen.delete(value);
    return true;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!isPlainData((value as Record<string, unknown>)[key], seen)) return false;
  }
  seen.delete(value);
  return true;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The package-identity grammar (PKG-2): lower-case ASCII letters and digits with
 * `-` or `_` separators, used for a package id and its namespace. A host that
 * reads package folders validates with this one pattern rather than a copy.
 */
export const PACKAGE_IDENTIFIER = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseEntry(
  value: unknown,
  path: string,
  index: number,
): { entry: PluginManifestEntry | null; diagnostic?: PluginManifestDiagnostic } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { entry: null, diagnostic: diagnostic("manifest.entry", path, index, "entry must be an object") };
  }
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, ["id", "enabled", "options", "version", "namespace", "requests"])) {
    return {
      entry: null,
      diagnostic: diagnostic("manifest.unknown-field", path, index, "entry contains an unknown field"),
    };
  }
  if (typeof record.id !== "string" || record.id.length === 0) {
    return { entry: null, diagnostic: diagnostic("manifest.id", path, index, "entry id must be a non-empty string") };
  }
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
    return { entry: null, diagnostic: diagnostic("manifest.enabled", path, index, "entry enabled must be boolean") };
  }
  if (record.options !== undefined && !isPlainData(record.options)) {
    return { entry: null, diagnostic: diagnostic("manifest.options", path, index, "entry options must be plain JSON data") };
  }
  const entry: Mutable<PluginManifestEntry> = { id: record.id };
  if (record.enabled !== undefined) entry.enabled = record.enabled;
  if (record.options !== undefined) entry.options = record.options;
  const isPackage = record.version !== undefined;
  if (!isPackage && (record.namespace !== undefined || record.requests !== undefined)) {
    return {
      entry: null,
      diagnostic: diagnostic("manifest.package-version", path, index, "namespace and requests belong to a package entry, which needs a version"),
    };
  }
  if (isPackage) {
    if (typeof record.version !== "string" || record.version.length === 0) {
      return { entry: null, diagnostic: diagnostic("manifest.version", path, index, "package version must be a non-empty string") };
    }
    if (!PACKAGE_IDENTIFIER.test(record.id)) {
      return {
        entry: null,
        diagnostic: diagnostic("manifest.package-name", path, index, `package name "${record.id}" must be a lower-case ASCII identifier`),
      };
    }
    entry.version = record.version;
    if (record.namespace !== undefined) {
      if (typeof record.namespace !== "string" || !PACKAGE_IDENTIFIER.test(record.namespace)) {
        return { entry: null, diagnostic: diagnostic("manifest.namespace", path, index, "package namespace must be an ASCII identifier") };
      }
      entry.namespace = record.namespace;
    }
    if (record.requests !== undefined) {
      if (!Array.isArray(record.requests)) {
        return { entry: null, diagnostic: diagnostic("manifest.requests", path, index, "package requests must be an array of host-request kinds") };
      }
      const kinds: HostRequestKind[] = [];
      for (const kind of record.requests as unknown[]) {
        if (typeof kind !== "string" || !(HOST_REQUEST_KINDS as readonly string[]).includes(kind)) {
          return {
            entry: null,
            diagnostic: diagnostic("manifest.request-kind", path, index, `unknown host-request kind ${JSON.stringify(kind)}`),
          };
        }
        if (kinds.includes(kind as HostRequestKind)) {
          return { entry: null, diagnostic: diagnostic("manifest.request-kind", path, index, `host-request kind "${kind}" is declared twice`) };
        }
        kinds.push(kind as HostRequestKind);
      }
      entry.requests = kinds;
    }
  }
  return { entry };
}

/** True for a package entry (PKG-2): one that carries a version. */
export function isPackageManifestEntry(entry: PluginManifestEntry): boolean {
  return entry.version !== undefined;
}

/** A package's namespace: the declared one, else its name (the folded id). */
export function packageNamespace(entry: PluginManifestEntry): string {
  return entry.namespace ?? entry.id;
}

/** The comparison key of a namespace: ASCII-only case fold, never a locale fold (PKG-4). */
export function foldNamespace(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : text.charAt(index);
  }
  return out;
}

function namespaceKey(entry: PluginManifestEntry): string {
  return foldNamespace(packageNamespace(entry));
}

/** The index of an earlier package entry that already owns this entry's namespace, or -1. */
function namespaceTakenAt(entries: readonly PluginManifestEntry[], entry: PluginManifestEntry, ignore = -1): number {
  if (!isPackageManifestEntry(entry)) return -1;
  const key = namespaceKey(entry);
  return entries.findIndex((other, at) => at !== ignore && isPackageManifestEntry(other) && namespaceKey(other) === key);
}

/** The declarations of every package entry, in manifest order, as plain data a runner can show. */
export function listPackageDeclarations(manifest: PluginManifest): readonly PackageDeclaration[] {
  const out: PackageDeclaration[] = [];
  for (const entry of manifest) {
    if (entry.version === undefined) continue;
    out.push({
      name: entry.id,
      version: entry.version,
      namespace: packageNamespace(entry),
      requests: entry.requests === undefined ? [] : [...entry.requests],
      enabled: isPluginManifestEntryEnabled(entry),
    });
  }
  return out;
}

/**
 * A repeated package identity is `manifest.duplicate-package` (PKG-2; entry 19.21); a repeated
 * native id stays `manifest.duplicate-id`. Either way the later entry is rejected, never run twice.
 */
function duplicateCode(entry: PluginManifestEntry): string {
  return isPackageManifestEntry(entry) ? "manifest.duplicate-package" : "manifest.duplicate-id";
}

function duplicateMessage(entry: PluginManifestEntry): string {
  return isPackageManifestEntry(entry) ? `duplicate package "${entry.id}"` : `duplicate plugin id "${entry.id}"`;
}

/** Validate untrusted manifest data and report every located error. */
export function parsePluginManifest(input: unknown, path = "manifest"): PluginManifestParseResult {
  if (!Array.isArray(input)) {
    return { manifest: null, diagnostics: [diagnostic("manifest.type", path, 0, "manifest must be an array")] };
  }
  const entries: PluginManifestEntry[] = [];
  const diagnostics: PluginManifestDiagnostic[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const parsed = parseEntry(input[index], path, index);
    if (parsed.diagnostic !== undefined) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }
    const entry = parsed.entry!;
    if (ids.has(entry.id)) {
      diagnostics.push(diagnostic(duplicateCode(entry), path, index, duplicateMessage(entry)));
      continue;
    }
    const takenAt = namespaceTakenAt(entries, entry);
    if (takenAt >= 0) {
      diagnostics.push(diagnostic("manifest.duplicate-namespace", path, index, `namespace "${packageNamespace(entry)}" is already used by package "${entries[takenAt]!.id}"`));
      continue;
    }
    ids.add(entry.id);
    entries.push(entry);
  }
  return { manifest: diagnostics.length === 0 ? entries : null, diagnostics };
}

function cloneEntry(entry: PluginManifestEntry): PluginManifestEntry {
  const copy: Mutable<PluginManifestEntry> = { id: entry.id };
  if (entry.enabled !== undefined) copy.enabled = entry.enabled;
  if (entry.options !== undefined) copy.options = entry.options;
  if (entry.version !== undefined) copy.version = entry.version;
  if (entry.namespace !== undefined) copy.namespace = entry.namespace;
  if (entry.requests !== undefined) copy.requests = [...entry.requests];
  return copy;
}

function locate(manifest: readonly PluginManifestEntry[], id: string): number {
  return manifest.findIndex((entry) => entry.id === id);
}

/** Apply a data-only patch; invalid operations leave the current list unchanged. */
export function applyPluginManifestPatch(
  manifest: PluginManifest,
  patch: PluginManifestPatch,
  path = "manifest",
): PluginManifestPatchResult {
  const entries = manifest.map(cloneEntry);
  const diagnostics: PluginManifestDiagnostic[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (seen.has(entry.id)) {
      diagnostics.push(diagnostic(duplicateCode(entry), path, index, duplicateMessage(entry)));
    }
    const takenAt = namespaceTakenAt(entries, entry, index);
    if (takenAt >= 0 && takenAt < index) {
      diagnostics.push(diagnostic("manifest.duplicate-namespace", path, index, `namespace "${packageNamespace(entry)}" is already used by package "${entries[takenAt]!.id}"`));
    }
    seen.add(entry.id);
    if (entry.id === "core" && (index !== 0 || entry.enabled === false)) {
      diagnostics.push(diagnostic("manifest.core-pinned", path, index, 'plugin "core" must be enabled at the bottom layer'));
    }
  }
  const reject = (code: string, index: number, message: string): void => {
    diagnostics.push(diagnostic(code, path, index, message));
  };

  for (let index = 0; index < patch.length; index += 1) {
    const operation = patch[index]!;
    if (operation === null || typeof operation !== "object" || Array.isArray(operation)) {
      reject("manifest.operation", index, "manifest patch operation must be an object");
      continue;
    }
    if (operation.op === "append") {
      const parsed = parseEntry(operation.entry, path, index);
      if (parsed.diagnostic !== undefined) {
        diagnostics.push(parsed.diagnostic);
        continue;
      }
      const entry = parsed.entry!;
      if (entry.id === "core") {
        reject("manifest.core-pinned", index, 'plugin "core" must remain the bottom layer');
        continue;
      }
      if (locate(entries, entry.id) >= 0) {
        reject(duplicateCode(entry), index, duplicateMessage(entry));
        continue;
      }
      const takenAt = namespaceTakenAt(entries, entry);
      if (takenAt >= 0) {
        reject("manifest.duplicate-namespace", index, `namespace "${packageNamespace(entry)}" is already used by package "${entries[takenAt]!.id}"`);
        continue;
      }
      entries.push(cloneEntry(entry));
      continue;
    }
    if (operation.op === "remove" || operation.op === "disable") {
      const at = locate(entries, operation.id);
      if (at < 0) {
        reject("manifest.unknown-id", index, `unknown plugin id "${operation.id}"`);
        continue;
      }
      if (operation.id === "core") {
        reject("manifest.core-pinned", index, 'plugin "core" cannot be removed or disabled');
        continue;
      }
      if (operation.op === "remove") entries.splice(at, 1);
      else entries[at] = { ...entries[at]!, enabled: false };
      continue;
    }
    if (operation.op === "replace") {
      const parsed = parseEntry(operation.entry, path, index);
      if (parsed.diagnostic !== undefined) {
        diagnostics.push(parsed.diagnostic);
        continue;
      }
      const entry = parsed.entry!;
      const at = locate(entries, operation.id);
      if (at < 0) {
        reject("manifest.unknown-id", index, `unknown plugin id "${operation.id}"`);
        continue;
      }
      if (operation.id === "core" || entry.id === "core") {
        reject("manifest.core-pinned", index, 'plugin "core" cannot be replaced');
        continue;
      }
      const duplicateAt = locate(entries, entry.id);
      if (duplicateAt >= 0 && duplicateAt !== at) {
        reject(duplicateCode(entry), index, duplicateMessage(entry));
        continue;
      }
      const takenAt = namespaceTakenAt(entries, entry, at);
      if (takenAt >= 0) {
        reject("manifest.duplicate-namespace", index, `namespace "${packageNamespace(entry)}" is already used by package "${entries[takenAt]!.id}"`);
        continue;
      }
      entries[at] = cloneEntry(entry);
      continue;
    }
    if (operation.op === "reorder") {
      const ids = operation.ids;
      if (!Array.isArray(ids)) {
        reject("manifest.reorder", index, "reorder ids must be an array");
        continue;
      }
      const expected = new Set(entries.map((entry) => entry.id));
      const supplied = new Set<string>();
      let valid = ids.length === entries.length;
      for (const id of ids) {
        if (supplied.has(id)) {
          reject("manifest.duplicate-id", index, `duplicate plugin id "${id}" in reorder`);
          valid = false;
        }
        if (!expected.has(id)) {
          reject("manifest.unknown-id", index, `unknown plugin id "${id}" in reorder`);
          valid = false;
        }
        supplied.add(id);
      }
      if (ids.length !== entries.length) {
        reject("manifest.reorder", index, "reorder must name every effective plugin exactly once");
        valid = false;
      }
      if (supplied.size !== expected.size) {
        reject("manifest.reorder", index, "reorder must retain every effective plugin");
        valid = false;
      }
      if (valid && ids[0] !== "core") {
        reject("manifest.core-pinned", index, 'plugin "core" must remain the bottom layer');
        valid = false;
      }
      if (valid) {
        const byId = new Map(entries.map((entry) => [entry.id, entry]));
        entries.splice(0, entries.length, ...ids.map((id) => byId.get(id)!));
      }
      continue;
    }
    reject("manifest.operation", index, "unknown manifest patch operation");
  }

  return { manifest: entries, diagnostics };
}

/** True only for an enabled entry; disabled layers are never resolved. */
export function isPluginManifestEntryEnabled(entry: PluginManifestEntry): boolean {
  return entry.enabled !== false;
}
