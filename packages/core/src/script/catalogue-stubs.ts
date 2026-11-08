/**
 * Catalogue command stubs: one generic command per catalogue name that is safe
 * to stub (ticket 3.21; AD-8/AD-10; decision U1).
 *
 * GENERATED — do not edit by hand. `tools/catalogue/generate.mjs` reads
 * `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-vm/discovery/command-effect-catalogue.json`
 * and emits this file; run `pnpm catalogue:generate` and commit the result
 * (`pnpm catalogue:check` fails CI when the two drift).
 *
 * Each entry is a stub for a `pure`, `state-write` or `draw-audio-cue`
 * name: it validates its arguments through its `ParamSpec`, returns the
 * documented default (`0` for a `pure` getter, `null` otherwise), writes
 * `0` back to every by-reference output the caller supplied, and reports one
 * `CommandEffect` per section it writes (none for a `pure` getter). The VM
 * stamps each reported effect into the `vm` section's effect log. The two
 * obsolete names raise `builtin.obsolete` and report nothing. Names are the
 * ASCII case-folded catalogue names (docs/spec/engine/rpgcode-language.md#lexical-rules LEX-10), which is how the
 * lexer and the registry key them.
 *
 * Names whose kind is `wait`, `request`, `spawn-thread`, `flow-control`
 * or `mixed` are entries 9, 13 and 22 and are deliberately absent: a default
 * answer to a wait or a control-flow call would desynchronise the VM. An owner
 * epic replaces a stub by registering its own command of the same name above
 * this layer.
 *
 * docs/adr/0004 (decisions 2 and 6); discovery/command-effect-catalogue.md.
 */

import type { BuiltinSpec, ParamSpec } from "./builtins.ts";
import { PURE_SPECS } from "./builtins/pure.ts";
import { ScriptError } from "./errors.ts";
import type { CommandEffect, PluginDefinition } from "./plugin.ts";
import type { SectionKey } from "../save/state.ts";

/** A stub-safe catalogue kind. */
type StubKind = "pure" | "state-write" | "draw-audio-cue";

/** One generated catalogue stub row. */
type CatalogueStub = {
  readonly name: string;
  readonly kind: StubKind;
  readonly sections: readonly SectionKey[];
  readonly obsolete: boolean;
  readonly params: readonly ParamSpec[];
};

/** Build the AD-8 `BuiltinSpec` one catalogue row describes. */
function makeStub(stub: CatalogueStub): BuiltinSpec {
  return {
    name: stub.name,
    aliases: [],
    params: stub.params,
    call: (_view, args) => {
      if (stub.obsolete) {
        throw new ScriptError(
          "builtin.obsolete",
          `"${stub.name}" is obsolete: the statement is skipped`,
        );
      }
      const out: (readonly [number, number])[] = [];
      for (let index = 0; index < stub.params.length; index += 1) {
        if (stub.params[index]?.byRef === true && index < args.length) out.push([index, 0]);
      }
      const effects: CommandEffect[] =
        stub.sections.length === 0
          ? [{ kind: stub.kind }]
          : stub.sections.map((section) => ({ kind: stub.kind, section }));
      return { value: stub.kind === "pure" ? 0 : null, out, effects };
    },
  };
}

const STUBS: readonly CatalogueStub[] = [
  {
    name: "putplayer",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: false,
    params: [{ name: "h", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "eraseplayer",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: false,
    params: [{ name: "h", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "callplayerswap",
    kind: "state-write",
    sections: ["party"],
    obsolete: false,
    params: [],
  },
  {
    name: "destroyitem",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: false,
    params: [{ name: "mem", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "putitem",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: false,
    params: [{ name: "h", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "eraseitem",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: false,
    params: [{ name: "itemnum", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "itemcount",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "item", optional: false, byRef: false, variadic: false }, { name: "n", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "onboard",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "h", optional: true, byRef: false, variadic: false }, { name: "flag", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "spritetranslucency",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: false,
    params: [{ name: "percent", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "pathfind",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "x1", optional: false, byRef: false, variadic: false }, { name: "y1", optional: false, byRef: false, variadic: false }, { name: "x2", optional: false, byRef: false, variadic: false }, { name: "y2", optional: false, byRef: false, variadic: false }, { name: "dest", optional: false, byRef: true, variadic: false }, { name: "layer", optional: true, byRef: true, variadic: false }],
  },
  {
    name: "gamespeed",
    kind: "state-write",
    sections: ["world"],
    obsolete: false,
    params: [{ name: "n", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "move",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: false,
    params: [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: true, byRef: false, variadic: false }],
  },
  {
    name: "getlevel",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "h", optional: false, byRef: false, variadic: false }, { name: "dest", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "givegp",
    kind: "state-write",
    sections: ["inventory"],
    obsolete: false,
    params: [{ name: "amount", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "takegp",
    kind: "state-write",
    sections: ["inventory"],
    obsolete: false,
    params: [{ name: "amount", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "getgp",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "dest", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "giveitem",
    kind: "state-write",
    sections: ["inventory"],
    obsolete: false,
    params: [{ name: "file", optional: false, byRef: false, variadic: false }, { name: "qty", optional: true, byRef: false, variadic: false }],
  },
  {
    name: "takeitem",
    kind: "state-write",
    sections: ["inventory"],
    obsolete: false,
    params: [{ name: "file", optional: false, byRef: false, variadic: false }, { name: "qty", optional: true, byRef: false, variadic: false }],
  },
  {
    name: "attackall",
    kind: "state-write",
    sections: ["battle", "vm"],
    obsolete: false,
    params: [{ name: "fp", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "drainall",
    kind: "state-write",
    sections: ["battle", "vm"],
    obsolete: false,
    params: [{ name: "fp", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "ai",
    kind: "state-write",
    sections: ["battle"],
    obsolete: false,
    params: [{ name: "level", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "internalmenu",
    kind: "state-write",
    sections: ["menu"],
    obsolete: false,
    params: [{ name: "n", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "fightstyle",
    kind: "state-write",
    sections: ["battle"],
    obsolete: false,
    params: [{ name: "flag", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "battlespeed",
    kind: "state-write",
    sections: ["world"],
    obsolete: false,
    params: [{ name: "speed", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "sourcelocation",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "targetlocation",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "mediastop",
    kind: "state-write",
    sections: ["audio"],
    obsolete: false,
    params: [],
  },
  {
    name: "wavstop",
    kind: "state-write",
    sections: ["audio"],
    obsolete: false,
    params: [],
  },
  {
    name: "setvolume",
    kind: "state-write",
    sections: ["audio"],
    obsolete: false,
    params: [{ name: "percent", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "midirest",
    kind: "state-write",
    sections: ["audio"],
    obsolete: false,
    params: [],
  },
  {
    name: "mediarest",
    kind: "state-write",
    sections: ["audio"],
    obsolete: false,
    params: [],
  },
  {
    name: "random",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "max", optional: false, byRef: false, variadic: false }, { name: "dest", optional: true, byRef: true, variadic: false }],
  },
  {
    name: "sin",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "deg", optional: false, byRef: false, variadic: false }, { name: "dest", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "cos",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "deg", optional: false, byRef: false, variadic: false }, { name: "dest", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "tan",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "deg", optional: false, byRef: false, variadic: false }, { name: "dest", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "sqrt",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "n", optional: false, byRef: false, variadic: false }, { name: "dest", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "log",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "n", optional: false, byRef: false, variadic: false }, { name: "dest", optional: false, byRef: true, variadic: false }],
  },
  {
    name: "iif",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "c", optional: false, byRef: false, variadic: false }, { name: "a", optional: false, byRef: false, variadic: false }, { name: "b", optional: false, byRef: false, variadic: false }],
  },
  {
    name: "gettickcount",
    kind: "pure",
    sections: [],
    obsolete: false,
    params: [{ name: "ms", optional: true, byRef: true, variadic: false }],
  },
  {
    name: "empty",
    kind: "state-write",
    sections: ["vm"],
    obsolete: false,
    params: [],
  },
  {
    name: "itemwalkspeed",
    kind: "state-write",
    sections: ["sprites"],
    obsolete: true,
    params: [],
  },
  {
    name: "shopcolors",
    kind: "state-write",
    sections: ["ui"],
    obsolete: false,
    params: [{ name: "index", optional: false, byRef: false, variadic: false }, { name: "r", optional: false, byRef: false, variadic: false }, { name: "g", optional: false, byRef: false, variadic: false }, { name: "b", optional: false, byRef: false, variadic: false }],
  },
];

const IMPLEMENTED = new Map(PURE_SPECS.map((spec) => [spec.name, spec] as const));

/** The catalogue stub layer: registered between `CORE_PLUGIN` and caller plugins. */
export const CATALOGUE_STUBS_PLUGIN: PluginDefinition = {
  id: "catalogue",
  version: "1.0.0",
  commands: STUBS.filter((stub) => !IMPLEMENTED.has(stub.name)).map(makeStub),
};
