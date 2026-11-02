/**
 * The package script-function export index (PKG-4; entry 19.21;
 * docs/spec/engine/rpgcode-modules-and-objects.md#pkg-script-function-lookup-proposal).
 *
 * Each enabled, resolved package exports the hoisted functions its startup program and the
 * files that program included define. The index is **session data**: it lives in the layer
 * table beside the `registerPlugin` layers, is rebuilt by package start-up on every boot and
 * restore from the effective manifest in manifest order, and is never in a save or a state
 * hash (G1). A package's entry is the startup `ProgramRef` as it stood when its start-up
 * finished, so the includes the start-up performed at run time are part of what it exports;
 * an `include()` any package function performs later extends the running program as MOD-3
 * says but never changes the index, because a restore rebuilds the index from start-up alone.
 *
 * No unordered iteration selects a winner (G3): the index is an array in start-up order and
 * each package's functions are read from its compiled program in source order.
 */

import type { Logger } from "../ports/logger.ts";
import type { ProgramCache } from "./cache.ts";
import type { PackageExport, PluginLayers } from "./layers.ts";
import { programKey, type Program, type ProgramRef } from "./program.ts";
import type { CommandLookup, PackageFunctionHit, PackageFunctionSource } from "./registry.ts";

/** Start a package's entry; a second start of the same package replaces its earlier entry. */
export function beginPackageExport(
  table: PluginLayers,
  name: string,
  namespace: string | null,
  ref: ProgramRef,
): PackageExport {
  const at = table.exports.findIndex((entry) => entry.name === name);
  if (at >= 0) table.exports.splice(at, 1);
  const entry: PackageExport = { name, namespace, ref, sealed: false };
  table.exports.push(entry);
  return entry;
}

/** A package start-up `include()` grew `from` to `to`: follow it while that package's start-up runs. */
export function followPackageInclude(table: PluginLayers, from: ProgramRef, to: ProgramRef): void {
  const key = programKey(from);
  for (const entry of table.exports) {
    if (!entry.sealed && programKey(entry.ref) === key) entry.ref = to;
  }
}

/** The package function lookup over `table`; `compile` is the services' program cache. */
export function createPackageFunctionSource(
  table: PluginLayers,
  compile: (ref: ProgramRef) => Program,
): PackageFunctionSource {
  function hit(entry: PackageExport, name: string, argc: number | undefined): PackageFunctionHit | undefined {
    const program = compile(entry.ref);
    if (!Object.hasOwn(program.functions, name)) return undefined;
    const infos = program.functions[name]!;
    if (argc === undefined) {
      return infos.some((info) => info.entry >= 0) ? { package: entry.name, program, infos, info: undefined } : undefined;
    }
    const info = infos.find((candidate) => candidate.entry >= 0 && candidate.params.length === argc);
    return info === undefined ? undefined : { package: entry.name, program, infos, info };
  }
  return {
    find(name, argc) {
      for (let at = table.exports.length - 1; at >= 0; at -= 1) {
        const entry = table.exports[at]!;
        if (!entry.sealed) continue;
        const found = hit(entry, name, argc);
        if (found !== undefined) return found;
      }
      return undefined;
    },
    findIn(namespace, name, argc) {
      const entry = table.exports.find((candidate) => candidate.sealed && candidate.namespace === namespace);
      return entry === undefined ? undefined : hit(entry, name, argc);
    },
    findAny(name) {
      for (let at = table.exports.length - 1; at >= 0; at -= 1) {
        const entry = table.exports[at]!;
        if (!entry.sealed) continue;
        const found = hit(entry, name, undefined);
        if (found !== undefined) return found;
      }
      return undefined;
    },
    owners(name, argc) {
      const out: string[] = [];
      for (const entry of table.exports) {
        if (entry.sealed && hit(entry, name, argc) !== undefined) out.push(entry.name);
      }
      return out;
    },
  };
}

/** The data of one package-function `command.overridden` warning (PKG-4; entry 19.21). */
export type OverrideLabel = { readonly kind: "package" | "built-in" | "plugin" | "program"; readonly id: string };

function label(owner: OverrideLabel): string {
  return `${owner.kind} "${owner.id}"`;
}

/**
 * Report one conflict a newly introduced package-function binding has with an earlier binding:
 * once, naming both owners, the folded name, the parameter count and the winner (PKG-4).
 */
export function warnPackageOverride(
  logger: Logger,
  name: string,
  argc: number,
  previous: OverrideLabel,
  replacement: OverrideLabel,
  winner: OverrideLabel,
): void {
  logger.warn({
    level: "warn",
    code: "command.overridden",
    message: `"${name}" with ${argc} parameter(s) is bound by both ${label(previous)} and ${label(replacement)}; ${label(winner)} wins the unqualified call (PKG-4)`,
    data: {
      name,
      argc,
      kind: "package-function",
      previous: label(previous),
      replacement: label(replacement),
      winner: label(winner),
    },
  });
}

/**
 * Seal a package's entry at the end of its start-up and report every conflict the exports
 * introduce against bindings that already exist: a built-in or plugin command of the same
 * name (any parameter count) and an earlier package's function of the same signature.
 * Program and included functions are reported when the program that defines them compiles.
 */
export function sealPackageExport(
  table: PluginLayers,
  entry: PackageExport,
  services: { readonly programs: ProgramCache; readonly commands: CommandLookup; readonly logger: Logger },
): void {
  entry.sealed = true;
  const program = services.programs.get(entry.ref);
  const earlier = table.exports.slice(0, table.exports.indexOf(entry)).filter((other) => other.sealed);
  const self: OverrideLabel = { kind: "package", id: entry.name };
  for (const [name, infos] of Object.entries(program.functions)) {
    // A lambda is keyed by its definition (`file#lambda_n`), never by a name a call can spell.
    if (name.includes("#")) continue;
    for (const info of infos) {
      if (info.entry < 0) continue;
      const argc = info.params.length;
      const owner = services.commands.owner(name);
      if (services.commands.builtin(name) !== undefined) {
        const builtin: OverrideLabel = { kind: "built-in", id: services.commands.builtinOwner(name) ?? owner ?? name };
        warnPackageOverride(services.logger, name, argc, builtin, self, builtin);
      } else if (services.commands.extension(name) !== undefined) {
        warnPackageOverride(services.logger, name, argc, { kind: "plugin", id: owner ?? name }, self, self);
      }
      for (const other of earlier) {
        const otherProgram = services.programs.get(other.ref);
        if (!Object.hasOwn(otherProgram.functions, name)) continue;
        if (!otherProgram.functions[name]!.some((candidate) => candidate.entry >= 0 && candidate.params.length === argc)) continue;
        warnPackageOverride(services.logger, name, argc, { kind: "package", id: other.name }, self, self);
      }
    }
  }
}
