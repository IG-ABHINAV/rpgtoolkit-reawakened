/**
 * The built-in command seam: `ParamSpec`, `Arg`, `BuiltinSpec` and the `core`
 * pack (AD-8; ADR 0004 decisions 2 and 6; docs/spec/engine/rpgcode-errors-and-threads.md#threads THR-1).
 *
 * `BuiltinSpec` is AD-8's registry unit — a name, its aliases, its declared
 * parameters and the handler — and `call` is ADR 0004 decision 2's functional
 * contract `(view, args, next) -> CommandResult` (see `script/plugin.ts` for
 * the result). `script/registry.ts` layers specs and supplies `next`;
 * `script/vm.ts` resolves, checks arity and dispatches.
 *
 * `CORE_PLUGIN` is the built-in `core` pack: layer 0 of the ordered plugin list
 * every caller assembles (ADR 0004 decision 6). Entry 3 holds only the tracer's
 * two commands. `end` returns normally (`{ value: null }`): that proves
 * registry resolution and the dispatch path, while `end`/`done`/`stop`'s real
 * unwinding (FUN-7) is entry 13's, and entry 21 registers the catalogue here.
 * `sleep` takes whole ticks directly and is a blocking command (R-32: its wait
 * is `global`), so it applies neither THR-1's seconds→ticks formula nor the
 * `0`-means-indefinite rule: a `0`, fractional or negative count is a
 * `builtin.bad-arg` `ScriptError`. The cooperative, per-thread sleep is
 * `threadSleep` (`script/builtins/threads.ts`).
 *
 * docs/adr/0004 (decision 2); docs/spec/engine/rpgcode-errors-and-threads.md#threads (THR-1) (SEM-6).
 */

import type { Value } from "../ports/value.ts";
import type { RefId } from "../ports/value.ts";
import { ScriptError } from "./errors.ts";
import type { CommandHandler, PluginDefinition } from "./plugin.ts";
import { CONVERSION_SPECS } from "./builtins/conversions.ts";
import { ERROR_SPECS } from "./builtins/errors.ts";
import { EVENT_SPECS } from "./builtins/events.ts";
import { FILE_SPECS } from "./builtins/files.ts";
import { PURE_SPECS } from "./builtins/pure.ts";
import { HOST_SPECS } from "./builtins/host.ts";
import { SCOPE_SPECS } from "./builtins/scope.ts";
import { STRING_SPECS } from "./builtins/strings.ts";
import { THREAD_SPECS } from "./builtins/threads.ts";
export type DocTag = "legacy" | "alias" | "deprecated" | "obsolete" | "experimental";

export type RunnerSupport = {
  readonly [runnerId: string]: {
    readonly level: "full" | "partial" | "none";
    readonly note?: string;
  };
};

export type DocExample = string | {
  readonly code: string;
  readonly caption?: string;
  readonly result?: string;
};

export type DocReturns = {
  readonly summary: string;
  readonly unit?: string;
};

export type DocThrow = {
  readonly code: string;
  readonly when: string;
};

export type DocWait = {
  readonly kind: "never" | "ticks" | "until-input" | "until-event" | "host-request" | "other";
  readonly summary: string;
};

export type ParamDocValue = {
  readonly value: string;
  readonly summary: string;
};

export type ParamDoc = {
  readonly summary: string;
  readonly unit?: string;
  readonly tags?: readonly DocTag[];
  readonly support?: RunnerSupport;
  /** Prose description of the value used when the argument is omitted. */
  readonly default?: string;
  /** Prose description of what omission means for an optional/output argument. */
  readonly ifOmitted?: string;
  readonly range?: { readonly min?: number; readonly max?: number; readonly note?: string };
  readonly values?: readonly ParamDocValue[];
  readonly type?: string;
  readonly since?: string;
};

export type BuiltinDoc = {
  readonly summary: string;
  readonly behaviour: string;
  readonly examples?: readonly DocExample[];
  readonly groups?: readonly string[];
  readonly returns?: DocReturns;
  readonly throws?: readonly DocThrow[];
  readonly see?: readonly string[];
  readonly since?: string;
  readonly replacedBy?: { readonly kind: "command"; readonly name: string } | { readonly kind: "syntax"; readonly text: string };
  readonly reason?: string;
  readonly access?: "public" | "internal";
  readonly waits?: DocWait;
  readonly effects?: readonly string[];
  readonly todo?: readonly string[];
  readonly author?: string;
  readonly license?: string;
  readonly tags?: readonly DocTag[];
  readonly support?: RunnerSupport;
};

export type ParamSpec = {
  readonly name: string;
  readonly optional: boolean;
  readonly byRef: boolean;
  readonly variadic: boolean;
  readonly doc?: ParamDoc;
};

/**
 * One bound argument at dispatch: its value, plus the variable reference to
 * write back when the parameter is by-reference (AD-8; docs/spec/engine/rpgcode-runtime.md#sem-3--comparison-and-conversion
 * SEM-6). `ref` is `null` for a literal or any non-variable argument.
 */
export type Arg = { readonly value: Value; readonly ref: RefId | null };

/** One registered command of a plugin (AD-8). `call` is the AD-8 contract. */
export type BuiltinSpec = {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly params: readonly ParamSpec[];
  readonly call: CommandHandler;
  /** Author-facing registration metadata; never passed to the handler or VM state. */
  readonly doc?: BuiltinDoc;
};


/**
 * The built-in `core` pack (ADR 0004 decision 6). Names are already ASCII
 * case-folded by the frontend, so lookup keys are folded too.
 */
export const CORE_PLUGIN: PluginDefinition = {
  id: "core",
  version: "1.0.0",
  doc: {
    summary: "The deterministic core commands that every runner can execute.",
    groups: [
      { id: "core-runtime", name: "Core runtime", summary: "Deterministic timing, values and control available in every runner." },
      { id: "internal", name: "Internal", summary: "Continuation commands used by the core file service." },
    ],
  },
  commands: [
    {
      name: "actor_damage",
      aliases: [],
      params: [
        { name: "target", optional: false, byRef: false, variadic: false },
        { name: "amount", optional: false, byRef: false, variadic: false },
        { name: "source", optional: true, byRef: false, variadic: false },
        { name: "pool", optional: true, byRef: false, variadic: false },
      ],
      call: (view, args) => {
        if (view.state === undefined || view.actors === undefined) return { value: 0 };
        const target = args[0]?.value;
        if (
          typeof target !== "object" ||
          target === null ||
          !("kind" in target) ||
          target.kind !== "object" ||
          typeof target.handle !== "number"
        ) {
          throw new ScriptError("builtin.bad-arg", "actor_damage: target must be a live actor object");
        }
        const emitter = Object.entries(view.state.events.emitters ?? {}).find(([, handle]) => handle === target.handle)?.[0];
        if (emitter === undefined || !emitter.startsWith("actor:")) {
          throw new ScriptError("builtin.bad-arg", "actor_damage: target must be an actor object");
        }
        const id = Number(emitter.slice("actor:".length));
        const amount = args[1]?.value;
        if (typeof amount !== "number" || !Number.isFinite(amount)) return { value: 0 };
        const sourceValue = args[2]?.value;
        const source = typeof sourceValue === "number" && sourceValue > 0 ? sourceValue : null;
        const pool = args[3]?.value === "smp" ? "smp" : "hp";
        return { value: view.actors.damage(id, amount, source, pool) ?? 0 };
      },
      doc: {
        summary: "Apply damage to a live actor's HP or SMP pool.",
        behaviour: "Subtract the requested amount through the actor rules, preserving damage cause and source attribution, and return the actual amount removed after clamping.",
        groups: ["internal"],
      },
    },
    ...HOST_SPECS,
    ...PURE_SPECS,
    {
      name: "sleep",
      aliases: [],
      params: [{ name: "ticks", optional: false, byRef: false, variadic: false }],
      doc: {
        summary: "Pause the running game for a number of simulation ticks.",
        behaviour: "Require a positive whole-number tick count, then block the whole game until the absolute end tick is reached; the calling program resumes on the next tick.",
        groups: ["core-runtime"],
        waits: { kind: "ticks", summary: "Blocks for the requested number of simulation ticks." },
      },
      call: (view, args) => {
        if (view.packageStartup === true) {
          throw new ScriptError("package.startup-unfinished", "a package start-up program waits; start-up programs must not wait");
        }
        const ticks = args[0]?.value;
        if (typeof ticks !== "number" || !Number.isInteger(ticks) || ticks <= 0) {
          throw new ScriptError(
            "builtin.bad-arg",
            "sleep: the tick count must be a positive whole number",
          );
        }
        return {
          value: null,
          wait: {
            kind: "sleep",
            global: true,
            until: view.clock.tick() + ticks,
            resumesCall: true,
          },
        };
      },
    },
    ...STRING_SPECS,
    ...CONVERSION_SPECS,
    ...SCOPE_SPECS,
    ...THREAD_SPECS,
    ...ERROR_SPECS,
    ...EVENT_SPECS,
    ...FILE_SPECS,
  ],
};
