// Every catalogue name that is safe to stub responds (ticket 3.21; AD-8;
// decision U1). The stub layer (`CATALOGUE_STUBS_PLUGIN`) sits above
// `CORE_PLUGIN` and below caller plugins, so a real game script calling any of
// the `pure`, `state-write` or `draw-audio-cue` names resolves, validates
// its arguments, returns the documented default, writes its by-reference
// outputs back and stamps an `EffectRecord` into the `vm` section's effect log.
//
// The catalogue (`discovery/command-effect-catalogue.json`) is the expectation:
// the kind and the written sections of each record are checked against it.
import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  advanceScriptTick,
  canon,
  CATALOGUE_STUBS_PLUGIN,
  createGameState,
  drainEffects,
  EFFECT_LOG_CAP,
  hashState,
  RENDER_PLUGIN,
  restoreGameState,
  snapshot,
  startProgram,
  type BuiltinSpec,
  type GameState,
  WORLD_PLUGIN,
  type ScriptError,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

type CatalogueRow = {
  readonly name: string;
  readonly params: string;
  readonly effectKind: string;
  readonly sectionsWrite: readonly string[];
  readonly obsolete: boolean;
  readonly byRefOut: boolean;
};

const catalogue = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "_bmad-output",
      "initiative-rpgtoolkit-reawakened",
      "epic-rpgcode-vm",
      "discovery",
      "command-effect-catalogue.json",
    ),
    "utf8",
  ),
) as { names: CatalogueRow[] };

const STUB_KINDS: Record<string, true> = {
  pure: true,
  "state-write": true,
  "draw-audio-cue": true,
};
const REAL_PACK_COMMANDS: Record<string, true> = {
  push: true, pushitem: true, playerstep: true, itemstep: true, playerpath: true, itempath: true,
  playerlocation: true, itemlocation: true, playergetpath: true, itemgetpath: true, activeplayer: true,
  playerdirection: true, itemdirection: true, playerspeed: true, itemspeed: true, playerstance: true,
  itemstance: true, wander: true, wait: true, get: true, clearbuffer: true, setbutton: true,
  checkbutton: true, clearbuttons: true, mousemove: true, mouseclick: true, pixelmovement: true,
  hp: true, givehp: true, gethp: true, maxhp: true, getmaxhp: true, smp: true, givesmp: true,
  getsmp: true, maxsmp: true, getmaxsmp: true, fp: true, givefp: true, getfp: true, dp: true,
  getdp: true, applystatus: true, removestatus: true, giveexp: true,
};
const catalogueRows = catalogue.names.filter((row) => STUB_KINDS[row.effectKind] === true && REAL_PACK_COMMANDS[row.name.toLowerCase()] !== true);
const rowByName = new Map(catalogueRows.map((row) => [row.name.toLowerCase(), row]));

const COMMANDS: readonly BuiltinSpec[] = CATALOGUE_STUBS_PLUGIN.commands;

// `local(x)` and `global(x)` are the declaration form (FUN-2), not a call, so a
// program cannot reach their stubs; the two obsolete names throw
// `builtin.obsolete` rather than returning a result. Every other name is driven
// through the VM.
const PROGRAM_DRIVEN = COMMANDS.filter(
  (spec) =>
    spec.name !== "local" &&
    spec.name !== "global" &&
    spec.name !== "underarrow" &&
    spec.name !== "itemwalkspeed",
);

function errorOf(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the call to throw");
}

/**
 * A one-call program for `spec`. A by-reference parameter is passed a variable
 * (pre-set to 5, so a write-back of `0` is visible); every other argument is
 * the literal `1`. Returns the by-reference parameter indices it passed.
 */
function callProgram(spec: BuiltinSpec, argc: number): { text: string; byRef: number[] } {
  const argumentTexts: string[] = [];
  const byRef: number[] = [];
  const prefixes: string[] = [];
  for (let index = 0; index < argc; index += 1) {
    if (spec.params[index]?.byRef === true) {
      argumentTexts.push(`v${index}`);
      prefixes.push(`v${index} = 5\n`);
      byRef.push(index);
    } else {
      argumentTexts.push("1");
    }
  }
  return { text: `${prefixes.join("")}${spec.name}(${argumentTexts.join(", ")})\n`, byRef };
}

/** Run one program in a fresh state for one tick. */
function run(program: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  advanceOrFail(state, createScriptServices(state));
  return state;
}

/** The argument count a stub expects when called with its whole parameter list. */
function callArity(spec: BuiltinSpec): number {
  return spec.params.some((param) => param.variadic) ? 2 : spec.params.length;
}

test("every catalogue stub name resolves to its own spec, folded to lower case", () => {
  const services = createScriptServices(createGameState({ seed: 0 }));

  equal(COMMANDS.length, 34);
  equal(new Set(COMMANDS.map((spec) => spec.name)).size, 34);
  for (const spec of COMMANDS) {
    equal(spec.name, spec.name.toLowerCase());
    const resolved = services.commands.get(spec.name);
    equal(resolved !== undefined, true, `"${spec.name}" did not resolve`);
    equal(resolved?.spec, spec, `"${spec.name}" resolved to another spec`);
    deepEqual(spec.aliases, []);
    equal(rowByName.has(spec.name), true, `"${spec.name}" is not a stub-safe catalogue name`);
  }
  // No stub shadows a first-party pack: the world, render, UI and graphics packs own their names (ticket 4.27).
  for (const plugin of [WORLD_PLUGIN, RENDER_PLUGIN]) {
    for (const pack of plugin.commands) {
      for (const name of [pack.name.toLowerCase(), ...pack.aliases.map((alias) => alias.toLowerCase())]) {
        equal(COMMANDS.some((spec) => spec.name === name), false, `a stub shadows the ${plugin.id} pack command "${name}"`);
      }
    }
  }
  // No stub shadows the core pack.
  equal(services.commands.get("end")?.spec.name, "end");
  equal(services.commands.get("sleep")?.spec.name, "sleep");
});

test("the stub layer declares the catalogue's by-reference outputs", () => {
  equal(COMMANDS.filter((spec) => spec.params.some((param) => param.byRef)).length, 7);
  // Variadic rows cannot fix an output position in their generated spec.
  equal(COMMANDS.filter((spec) => spec.params.some((param) => param.variadic)).length, 0);
  for (const spec of COMMANDS) {
    const row = rowByName.get(spec.name)!;
    const variadic = spec.params.some((param) => param.variadic);
    equal(
      spec.params.some((param) => param.byRef),
      row.byRefOut && !variadic,
      `by-reference declaration for "${spec.name}"`,
    );
  }
});

test("a stub rejects a call that breaks its declared arity", () => {
  for (const spec of PROGRAM_DRIVEN) {
    const required = spec.params.filter((param) => !param.optional && !param.variadic).length;
    const variadic = spec.params.some((param) => param.variadic);

    if (required > 0) {
      const { text } = callProgram(spec, required - 1);
      equal(errorOf(() => run(text)).code, "arity.mismatch", `too few for "${spec.name}"`);
    }
    if (!variadic) {
      const { text } = callProgram(spec, spec.params.length + 1);
      equal(errorOf(() => run(text)).code, "arity.mismatch", `too many for "${spec.name}"`);
    }
  }
});

test("each stub stamps the catalogue's effect record", () => {
  for (const spec of PROGRAM_DRIVEN) {
    const row = rowByName.get(spec.name)!;
    const argc = callArity(spec);
    const { text, byRef } = callProgram(spec, argc);
    const state = run(text);

    const sections = row.sectionsWrite;
    const expected = sections.length === 0 ? 1 : sections.length;
    equal(state.vm.effects.length, expected, `record count for "${spec.name}"`);
    equal(state.vm.effectSeq, expected);

    for (let index = 0; index < expected; index += 1) {
      const record = state.vm.effects[index]!;
      equal(record.seq, index + 1, `seq for "${spec.name}"`);
      equal(record.tick, 0, `tick for "${spec.name}"`);
      equal(record.thread, 1, `thread for "${spec.name}"`);
      equal(record.name, spec.name, `name for "${spec.name}"`);
      equal(record.kind, row.effectKind, `kind for "${spec.name}"`);
      equal(record.result, row.effectKind === "pure" ? 0 : null, `result for "${spec.name}"`);
      equal(record.wait, null);
      equal(record.request, null);
      if (sections.length === 0) {
        equal(record.patch, null, `patch for pure "${spec.name}"`);
      } else {
        deepEqual(record.patch, {
          section: sections[index],
          path: [],
          op: "merge",
          value: null,
        });
      }
    }

    const expectedOut: { [index: string]: number } = {};
    for (const index of byRef) expectedOut[String(index)] = 0;
    deepEqual(state.vm.effects[0]!.out, expectedOut, `out for "${spec.name}"`);
  }
});

test("a by-reference argument is written back and recorded by index", () => {
  for (const spec of PROGRAM_DRIVEN) {
    if (!spec.params.some((param) => param.byRef)) continue;
    const argc = callArity(spec);
    const { text, byRef } = callProgram(spec, argc);
    const state = run(text);

    for (const index of byRef) {
      equal(state.vm.globals[`v${index}`], 0, `write-back of v${index} for "${spec.name}"`);
      equal(state.vm.effects[0]!.out[String(index)], 0, `out entry for "${spec.name}"`);
    }
  }
});


test("the obsolete names raise builtin.obsolete and record nothing", () => {
  for (const name of ["underarrow", "itemwalkspeed"]) {
    const state = createGameState({ seed: 0 });
    startProgram(state.vm, { kind: "inline", text: `${name}()\n`, ir: "1" });
    const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));
    equal(error.code, "builtin.obsolete", `code for "${name}"`);
    equal(state.vm.effects.length, 0, `record for "${name}"`);
    equal(state.vm.effectSeq, 0, `seq for "${name}"`);
  }
});

test("the effect log is a ring capped at EFFECT_LOG_CAP", () => {
  const state = run("mediastop()\n".repeat(300));
  equal(EFFECT_LOG_CAP, 256);
  equal(state.vm.effects.length, EFFECT_LOG_CAP);
  equal(state.vm.effectSeq, 300);
  equal(state.vm.effects[0]!.seq, 300 - EFFECT_LOG_CAP + 1);
  equal(state.vm.effects[EFFECT_LOG_CAP - 1]!.seq, 300);
});

test("drainEffects takes one section's records and leaves the rest", () => {
  const state = run("mediastop()\nmediastop()\nmediastop()\neraseplayer(1)\neraseplayer(1)\n");
  equal(state.vm.effectSeq, 5);
  equal(state.vm.effects.length, 5);

  const ui = drainEffects(state.vm, "audio");
  equal(ui.length, 3);
  equal(ui.every((record) => record.patch?.section === "audio"), true);
  equal(state.vm.effects.length, 2);
  equal(state.vm.effectSeq, 5, "draining never touches the sequence counter");
  deepEqual(state.vm.effects.map((record) => record.seq), [4, 5]);

  deepEqual(drainEffects(state.vm, "world"), [], "a section with no records drains nothing");
  equal(state.vm.effects.length, 2);

  const rest = drainEffects(state.vm);
  equal(rest.length, 2);
  equal(state.vm.effects.length, 0);
});

test("a snapshot with effects restores identically and keeps stamping monotonic seq", () => {
  const state = run("mediastop()\neraseplayer(1)\n");
  equal(state.vm.effectSeq, 2);

  const json = snapshot(state);
  const restored = restoreGameState(json);
  equal(canon(restored), json);
  equal(hashState(restored), hashState(state));
  deepEqual(restored.vm.effects, state.vm.effects);

  startProgram(restored.vm, { kind: "inline", text: "mediastop()\n", ir: "1" });
  advanceScriptTick(restored, createScriptServices(restored));
  equal(restored.vm.effectSeq, 3);
  equal(restored.vm.effects[2]?.seq, 3);
});

test("a caller plugin overrides a stub and warns once", () => {
  const replacement: BuiltinSpec = {
    name: "mediastop",
    aliases: [],
    params: [],
    call: () => ({ value: null, effects: [{ kind: "state-write", section: "audio" }] }),
  };
  const warnings: string[] = [];
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: "mediastop()\n", ir: "1" });
  const services = createScriptServices(state, [
    { id: "game", version: "1.0.0", commands: [replacement] },
  ], {
    debug: () => {},
    info: () => {},
    warn: (record) => warnings.push(record.code),
    error: () => {},
  });

  equal(services.commands.get("mediastop")?.spec, replacement);
  advanceScriptTick(state, services);
  deepEqual(warnings, ["command.overridden"]);
});
