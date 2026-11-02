/**
 * The command registry: pure assembly of an ordered resolved-plugin list, and
 * the environment table that resolves a call (AD-8; ADR 0004 decisions 2, 6
 * and 8).
 *
 * **Layer order.** Registration order is layer order. Where two plugins define
 * the same command name or alias, the later plugin's handler runs first and its
 * `next` reaches the earlier definition, so each name is a stack of layers
 * (command middleware) rather than one winner. The override is not an error: it
 * emits exactly one `command.overridden` warn record through the `Logger` port
 * (AD-24) naming the previous and replacement plugin. The one rejection is a
 * plugin repeating a name or alias *within itself*, which is assembly's own
 * error naming the plugin (AD-8's only surviving duplicate rule).
 *
 * **Name folding.** A name and an alias arrive already ASCII case-folded by the
 * frontend (docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands LEX-10), so this module keys on the string as
 * given and does no folding of its own.
 *
 * **The environment table.** A plain-name call resolves through one table with
 * one function, `resolveCall`, first match wins: (1) the running scope's own
 * symbol, a variable that currently holds a callable value, which the VM
 * supplies because only it can see frames; (2) a built-in command; (3) a
 * script function of the program, by name and parameter count; (4) a script
 * function a package exports, the last enabled package first (entry 19.21;
 * docs/spec/engine/rpgcode-modules-and-objects.md#pkg-script-function-lookup-proposal);
 * (5) a command a plugin claims (`docs/spec/engine/plugins-and-battle.md#plugin-roles`, "RPGCode
 * command plugins"; `docs/spec/engine/rpgcode-language.md#plugin-commands`,
 * "Plugin commands"). Entry 1 is what lets a script intercept a command by
 * assigning a callable to its name; nothing else changes, because a variable
 * that holds anything but a callable is not an entry. The table is not
 * materialised: its lower layers are this registry, the program's functions and
 * the package export index, read where they live, so no save gains a field
 * (docs/spec/engine/rpgcode-language.md#keywords-and-structure, FUN-8; ADR 0004
 * decision 8, entry 18.5). Redirects are not an entry: a redirect substitutes
 * the name while the program is parsed, before a call reaches the table.
 *
 * **Namespaces (PKG-4, entry 19.7).** A package entry also owns a namespace, and
 * `namespace.name(args)` runs that package's own script function of `name` and
 * parameter count (entry 19.21) or, when it has none, its own layer of `name` with
 * `next` reaching the layer below it. The namespace is a view over the same layer
 * stacks, built from the resolved list and holding no state, so it needs no
 * table of its own and nothing in a save: dropping a package from the list drops
 * its layers and its namespace together, and the binding below it is the one the
 * plain call reaches again.
 *
 * docs/spec/engine/rpgcode-language.md#plugin-commands.
 */

import type { Logger } from "../ports/logger.ts";
import type { CallableValue } from "../ports/value.ts";
import type { BuiltinSpec } from "./builtins.ts";
import type { FunctionInfo, ParamInfo } from "./lower.ts";
import type { CommandHandler, CommandResult, ResolvedPlugin } from "./plugin.ts";
import type { Program, ProgramRef } from "./program.ts";
import { INCLUDE_MISSING, ScriptError } from "./errors.ts";
import { foldNamespace } from "./manifest.ts";

/** One layer of one name: the plugin that contributed it and its spec. */
type CommandLayer = {
  readonly plugin: string;
  readonly spec: BuiltinSpec;
  readonly options?: ResolvedPlugin["options"];
};

/**
 * One resolved command: the winning layer and the handler of the layer below (a
 * `command.no-next` no-op when there is none).
 *
 * The winning layer's `spec.params` govern the call, because the top layer is
 * the one that decides what it accepts; a wrapper that wants to check the lower
 * layer's arity against changed arguments can read them from the spec it
 * captured.
 */
export type ResolvedCommand = {
  readonly spec: BuiltinSpec;
  readonly next: CommandHandler;
};

/** The assembled, layered built-in registry of one ordered plugin list (AD-8). */
export type CommandRegistry = {
  /** Resolve a name or alias to its winning layer, or `undefined`. */
  get(name: string): ResolvedCommand | undefined;
  /** Every registered name and alias, in registration order (diagnostics/tests). */
  keys(): readonly string[];
  /** The ids of the plugins that define `name`, bottom layer first (empty when none). */
  layerPlugins(name: string): readonly string[];
  /** True when `namespace` (ASCII-folded) is the namespace of a package in the list (PKG-4). */
  hasNamespace(namespace: string): boolean;
  /**
   * `name` as the package of `namespace` supplies it: that package's own layer, with
   * `next` the layer below it (PKG-4), or `undefined` when the namespace or the name is unknown.
   */
  getIn(namespace: string, name: string): ResolvedCommand | undefined;
};

/** A resolver over one source of commands: a name in, a command out or `undefined` (AD-8). */
export type CommandSource = (name: string) => ResolvedCommand | undefined;

/** The package namespaces of one resolved list (PKG-4); a lookup built without packages has none. */
export type NamespaceSource = {
  readonly has: (namespace: string) => boolean;
  readonly get: (namespace: string, name: string) => ResolvedCommand | undefined;
};

/** One script function a package exports (PKG-4; entry 19.21): its package, compiled program and definitions. */
export type PackageFunctionHit = {
  readonly package: string;
  readonly program: Program;
  /** Every definition of the name in that program, one per parameter count (MOD-1). */
  readonly infos: readonly FunctionInfo[];
  /** The definition that matches the requested parameter count, when one was asked for. */
  readonly info: FunctionInfo | undefined;
};

/**
 * The script functions the enabled packages export, in manifest order (docs/spec/engine/rpgcode-modules-and-objects.md#pkg-script-function-lookup-proposal).
 * A package's export index is session data rebuilt by package start-up, never saved state.
 */
export type PackageFunctionSource = {
  /** The matching function of the last enabled package that has one, by name and parameter count. */
  readonly find: (name: string, argc: number) => PackageFunctionHit | undefined;
  /** The matching function of the package that owns `namespace` (ASCII-folded); no other package is asked. */
  readonly findIn: (namespace: string, name: string, argc: number) => PackageFunctionHit | undefined;
  /** The definitions of `name` of the last package that defines it with any parameter count. */
  readonly findAny: (name: string) => PackageFunctionHit | undefined;
  /** The packages exporting `name` with `argc` parameters, earliest first. */
  readonly owners: (name: string, argc: number) => readonly string[];
};

/**
 * The commands the engine itself binds, as two sources (AD-8; the VM and the
 * LSP share it): a built-in, which binds ahead of a script function (R-35), and
 * an extension, a plugin's command that no built-in or script function claims.
 */
export type CommandLookup = {
  /** The built-in engine command `name` names (R-35), if any. */
  builtin: CommandSource;
  /** The command any plugin claims for `name`, if any (reached after the script functions). */
  extension: CommandSource;
  /** The built-in if there is one, else the extension: every command `name` can name. */
  get: CommandSource;
  /** The package namespaces: `namespace.name` reaches that package's own layer (PKG-4). */
  namespace: NamespaceSource;
  /** The script functions packages export; they sit between program functions and plugin commands. */
  packageFunction: PackageFunctionSource;
  /** The id of the plugin whose layer is on top of `name`, if any (diagnostics only). */
  owner: (name: string) => string | undefined;
  /** The id of the engine pack that supplies the built-in `name`, if any (diagnostics only). */
  builtinOwner: (name: string) => string | undefined;
};

const NO_PACKAGE_FUNCTIONS: PackageFunctionSource = {
  find: () => undefined,
  findIn: () => undefined,
  findAny: () => undefined,
  owners: () => [],
};

/** Build the command lookup from its sources; a source left out resolves nothing. */
export function createCommandLookup(
  sources: {
    readonly builtin?: CommandSource;
    readonly extension?: CommandSource;
    readonly namespace?: NamespaceSource;
    readonly packageFunction?: PackageFunctionSource;
    readonly owner?: (name: string) => string | undefined;
    readonly builtinOwner?: (name: string) => string | undefined;
  },
): CommandLookup {
  const builtin = sources.builtin ?? (() => undefined);
  const extension = sources.extension ?? (() => undefined);
  const namespace = sources.namespace ?? { has: () => false, get: () => undefined };
  return {
    builtin,
    extension,
    get: (name) => builtin(name) ?? extension(name),
    namespace,
    packageFunction: sources.packageFunction ?? NO_PACKAGE_FUNCTIONS,
    owner: sources.owner ?? (() => undefined),
    builtinOwner: sources.builtinOwner ?? (() => undefined),
  };
}

/** Target metadata when a call resolves to a script function (FUN-1). */
export type FunctionTarget = {
  readonly program: ProgramRef;
  readonly entry: number;
  readonly params: readonly ParamInfo[];
};

/** The outcome of call resolution: a callable the scope holds, a script function target, or a command. */
export type CallResolution =
  | { readonly kind: "callable"; readonly value: CallableValue }
  | { readonly kind: "function"; readonly target: FunctionTarget }
  | { readonly kind: "command"; readonly command: ResolvedCommand };

/** The script-function target of the definition `fns` holds for `argc` parameters, if any (FUN-1). */
function functionTarget(
  fns: { readonly [name: string]: readonly FunctionInfo[] } | undefined,
  name: string,
  argc: number,
  program: Program,
): CallResolution | undefined {
  if (fns === undefined || !Object.hasOwn(fns, name)) return undefined;
  const match = fns[name]!.find((fn) => fn.params.length === argc && fn.entry >= 0);
  if (match === undefined) return undefined;
  return {
    kind: "function",
    target: { program: program.ref, entry: match.entry, params: match.params },
  };
}

/**
 * Resolve a call through the environment table (docs/spec/engine/rpgcode-modules-and-objects.md#modules MOD-1/MOD-2,
 * docs/spec/engine/rpgcode-functions.md R-35, docs/spec/engine/rpgcode-language.md
 * FUN-8). Redirects were applied where the call site was parsed, so the name here
 * is already substituted. Then:
 *
 * 1. a `file.`-qualified call reaches that file's own definition of the name and
 *    arity first, and raises `include.missing` when the file could not be loaded;
 * 2. `held`, the callable the running scope holds under `name`, when there is one
 *    (the VM reads it from the running frame's locals and the globals; a
 *    qualified call never has one, and neither does a call through a handle,
 *    which runs the binding it names);
 * 3. a built-in binds ahead of a script function of the same name (R-35);
 * 4. the flat list of script functions, where the last definition added won (R-41);
 * 5. a script function a package exports, the last enabled package first (PKG-4; entry 19.21);
 * 6. the extension: a plugin command that no built-in or script function claims.
 *
 * A script function resolves by name and parameter count (FUN-1); a wrong count
 * falls through to the next step.
 */
export function resolveCall(
  name: string,
  argc: number,
  program: Program,
  commands: CommandLookup,
  file?: string,
  held?: CallableValue,
): CallResolution | undefined {
  if (file !== undefined) {
    const path = `${file}.prg`;
    const key = Object.hasOwn(program.fileKeys, path) ? program.fileKeys[path]! : undefined;
    if (key === undefined) {
      throw new ScriptError(INCLUDE_MISSING, `the file "${path}" could not be loaded for \`${file}.${name}\``);
    }
    const own = functionTarget(program.files[key], name, argc, program);
    if (own !== undefined) return own;
  } else if (held !== undefined) {
    return { kind: "callable", value: held };
  }

  // R-35: a built-in binds ahead of a script function of the same name.
  const builtin = commands.builtin(name);
  if (builtin !== undefined) return { kind: "command", command: builtin };

  const script = functionTarget(program.functions, name, argc, program);
  if (script !== undefined) return script;

  // A package's exported function binds after the program's own and ahead of a plugin command.
  const exported = commands.packageFunction.find(name, argc);
  if (exported !== undefined) return packageTarget(exported);

  // A plugin's own command is reached only after the script functions (docs/spec OOP-6 call order).
  const extension = commands.extension(name);
  return extension === undefined ? undefined : { kind: "command", command: extension };
}

/** The call target of a package-exported function (entry 19.21). */
function packageTarget(hit: PackageFunctionHit): CallResolution {
  const info = hit.info!;
  return { kind: "function", target: { program: hit.program.ref, entry: info.entry, params: info.params } };
}

/**
 * Resolve `namespace.name(args)` (PKG-4; entry 19.21): the package of `namespace` is asked for
 * its own script function of that name and parameter count first, then its own native
 * layer of `name`. `undefined` when `namespace` names no package, so the caller falls
 * through to a file. A package that supplies neither is the `unknown.command` failure
 * naming the qualified call; the call never falls back to a file, another package, a
 * built-in or the unqualified table, since that would let one spelling reach different
 * code. The qualifier is ASCII-folded here, as the manifest folds namespaces.
 */
export function resolveNamespaced(
  namespace: string,
  name: string,
  argc: number,
  commands: CommandLookup,
): CallResolution | undefined {
  const folded = foldNamespace(namespace);
  if (!commands.namespace.has(folded)) return undefined;
  const exported = commands.packageFunction.findIn(folded, name, argc);
  if (exported !== undefined) return packageTarget(exported);
  const command = commands.namespace.get(folded, name);
  if (command === undefined) {
    throw new ScriptError("unknown.command", `the package namespace "${folded}" supplies no command "${name}" taking ${argc} argument(s)`);
  }
  return { kind: "command", command };
}

/**
 * The callable value `bindingOf(name)` answers with (FUN-8; entry 18.5): what a
 * call of `name` would run from this scope right now. `held`, the callable the
 * scope holds under `name`, is answered as a copy. Otherwise the answer is a
 * handle named for the first engine binding there is — a built-in, a script
 * function (`defines` says whether any compiled program has one of that name,
 * whatever its parameter count) or a plugin command — and `undefined` when
 * nothing of that name exists. The handle's `def` is the name, so a call
 * through it resolves the built-in, script-function and extension steps of
 * `resolveCall` and never the scope's own symbol, which is why a later
 * reassignment of the name does not change what the handle runs.
 */
export function bindingOf(
  name: string,
  commands: CommandLookup,
  held: CallableValue | undefined,
  defines: (name: string) => boolean,
): CallableValue | undefined {
  if (held !== undefined) {
    return {
      type: "callable",
      def: held.def,
      captures: [...held.captures],
      receiver: held.receiver,
      ...(held.owner === undefined ? {} : { owner: held.owner }),
    };
  }
  const defined = commands.builtin(name) !== undefined || defines(name) || commands.extension(name) !== undefined;
  return defined ? { type: "callable", def: name, captures: [], receiver: null } : undefined;
}

/**
 * Assemble the host-resolved ordered plugin list into one layered registry
 * (ADR 0004 decisions 2 and 6). Manifest order is the whole chain; no built-in
 * layer is inserted here.
 *
 * Pure over the list: the same plugins and the same logger records produce the
 * same registry, and nothing here touches game state.
 */
export function assembleCommands(
  plugins: readonly ResolvedPlugin[],
  logger: Logger,
): CommandRegistry {
  const layers = new Map<string, CommandLayer[]>();
  const pluginIds = new Set<string>();
  const namespaces = new Map<string, string>();

  for (const resolved of plugins) {
    const plugin = resolved.definition;
    if (pluginIds.has(plugin.id)) {
      throw new Error(`plugin "${plugin.id}" appears more than once in the resolved manifest`);
    }
    pluginIds.add(plugin.id);
    if (resolved.namespace !== undefined) {
      const key = foldNamespace(resolved.namespace);
      const owner = namespaces.get(key);
      if (owner !== undefined) {
        throw new Error(`plugin "${plugin.id}" uses the namespace "${key}", already used by "${owner}"`);
      }
      namespaces.set(key, plugin.id);
    }
    const claimed = new Set<string>();
    for (const spec of plugin.commands) {
      for (const key of [spec.name, ...spec.aliases]) {
        if (claimed.has(key)) {
          throw new Error(
            `plugin "${plugin.id}" lists the command name or alias "${key}" more than once`,
          );
        }
        claimed.add(key);
      }
    }
    for (const spec of plugin.commands) {
      for (const key of [spec.name, ...spec.aliases]) {
        const stack = layers.get(key) ?? [];
        const below = stack[stack.length - 1];
        if (below !== undefined) {
          logger.warn({
            level: "warn",
            code: "command.overridden",
            message: `"${key}" is defined by both "${below.plugin}" and "${plugin.id}"; "${plugin.id}" runs first`,
            data: { name: key, kind: "plugin", previous: below.plugin, replacement: plugin.id },
          });
        }
        const layer: CommandLayer =
          resolved.options === undefined
            ? { plugin: plugin.id, spec }
            : { plugin: plugin.id, spec, options: resolved.options };
        stack.push(layer);
        layers.set(key, stack);
      }
    }
  }

  // `next` with nothing below (decision U4): one no-op handler per name, for the bottom layer.
  const noNext = new Map<string, CommandHandler>();
  for (const [key] of layers) {
    noNext.set(key, (): CommandResult => {
      logger.warn({
        level: "warn",
        code: "command.no-next",
        message: `"${key}" called next with no layer below it`,
        data: { name: key },
      });
      return { value: null };
    });
  }

  // One handler per layer, built bottom-up once: each is bound to the layer below *it* and ignores
  // the `next` it is passed, so a wrapper's `next(view, args, next)` reaches the layer beneath the
  // wrapper, never itself (PKG-4, AD-8).
  const handlers = new Map<string, CommandHandler[]>();
  for (const [key, stack] of layers) {
    const chain: CommandHandler[] = [];
    stack.forEach((layer, index) => {
      const below = index === 0 ? noNext.get(key)! : chain[index - 1]!;
      const options = layer.options;
      chain.push((view, args) =>
        layer.spec.call(options === undefined ? view : { ...view, options }, args, below),
      );
    });
    handlers.set(key, chain);
  }

  /** The layer at `index` of `name`'s stack as a command, with `next` the layer below it. */
  function commandAt(name: string, stack: readonly CommandLayer[], index: number): ResolvedCommand | undefined {
    const layer = stack[index];
    const chain = handlers.get(name);
    if (layer === undefined || chain === undefined) return undefined;
    const next = index === 0 ? noNext.get(name) : chain[index - 1];
    if (next === undefined) return undefined;
    // A layer with no options is its own spec (its caller passes `next`); only an options layer is wrapped.
    return { spec: layer.options === undefined ? layer.spec : { ...layer.spec, call: chain[index]! }, next };
  }

  return {
    get(name) {
      const stack = layers.get(name);
      return stack === undefined ? undefined : commandAt(name, stack, stack.length - 1);
    },
    hasNamespace(namespace) {
      return namespaces.has(namespace);
    },
    getIn(namespace, name) {
      const owner = namespaces.get(namespace);
      const stack = layers.get(name);
      if (owner === undefined || stack === undefined) return undefined;
      const index = stack.findIndex((layer) => layer.plugin === owner);
      return index < 0 ? undefined : commandAt(name, stack, index);
    },
    keys() {
      return [...layers.keys()];
    },
    layerPlugins(name) {
      return (layers.get(name) ?? []).map((layer) => layer.plugin);
    },
  };
}
