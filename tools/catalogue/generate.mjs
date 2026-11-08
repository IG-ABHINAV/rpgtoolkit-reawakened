// Generate the catalogue command stubs (ticket 3.21; AD-8; decision U1).
//
//   node tools/catalogue/generate.mjs [--check]
//
// Reads the discovery catalogue
// (`_bmad-output/…/epic-rpgcode-vm/discovery/command-effect-catalogue.json`,
// which entry 27 moved under `docs/spec`), keeps every name whose `effectKind`
// is safe to stub generically — `pure`, `state-write` or `draw-audio-cue` — and
// writes one `BuiltinSpec` per name to
// `packages/core/src/script/catalogue-stubs.ts`. A name with `waitKind`,
// `request`, `spawn-thread`, `flow-control` or `mixed` is owned by entries 9,
// 13 and 22 and is never stubbed here: a default answer to a wait or a
// control-flow call would desynchronise the VM.
//
// Each stub validates its arguments through the `ParamSpec`s parsed from the
// catalogue's `params` notation, returns the documented default (`0` for a
// `pure` getter, `null` otherwise), writes `0` back to every by-reference
// output the caller supplied, and reports one effect per section it writes
// (none for a `pure` getter). The two obsolete names raise `builtin.obsolete`
// and report nothing.
//
// `--check` re-runs the generator in memory and compares with the committed
// file, exiting non-zero when they differ, so `catalogue-stubs.ts` can never
// drift from the catalogue (the same guard as `tools/fixtures/author`).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const cataloguePath = join(
  repoRoot,
  "_bmad-output",
  "initiative-rpgtoolkit-reawakened",
  "epic-rpgcode-vm",
  "discovery",
  "command-effect-catalogue.json",
);
const outPath = join(repoRoot, "packages", "core", "src", "script", "catalogue-stubs.ts");

/** The effect kinds a generic stub can answer without touching control flow. */
const STUB_KINDS = new Set(["pure", "state-write", "draw-audio-cue"]);

/**
 * Catalogue notation spells three parameter names with non-identifier text;
 * the `ParamSpec` name is documentation only, so give each a readable name.
 */
const PARAM_NAMES = new Map([
  ["%", "percent"],
  ["0/1", "flag"],
  ["on/off", "state"],
]);

/**
 * Parse one catalogue `params` notation into a `ParamSpec` list (ticket 3.21).
 *
 * The notation is a comma-separated list where `[...]` marks optional groups
 * (and nests), a leading `&` marks a by-reference output, `...` is the whole
 * variadic list and `""` (or `—`) means no parameters. Tokens outside every
 * bracket are required; a token inside any bracket is optional. A comma inside
 * a bracket does not end the token, so `x,y,[layer,]tile` is four parameters
 * (`layer` optional, `tile` required).
 */
export function parseParams(notation) {
  const text = notation.trim();
  if (text === "" || text === "—") return [];
  if (text === "...") {
    return [{ name: "args", optional: true, byRef: false, variadic: true }];
  }

  const params = [];
  let depth = 0;
  let token = "";
  const flush = () => {
    const raw = token.trim();
    token = "";
    if (raw === "") return;
    if (raw === "...") throw new Error(`"..." must be the whole notation, in "${notation}"`);
    const byRef = raw.startsWith("&");
    const bare = byRef ? raw.slice(1) : raw;
    if (bare === "") throw new Error(`an empty parameter name in "${notation}"`);
    params.push({
      name: PARAM_NAMES.get(bare) ?? bare,
      optional: depth > 0,
      byRef,
      variadic: false,
    });
  };

  for (const ch of text) {
    if (ch === ",") {
      flush();
    } else if (ch === "[") {
      flush();
      depth += 1;
    } else if (ch === "]") {
      flush();
      depth -= 1;
      if (depth < 0) throw new Error(`unbalanced "]" in "${notation}"`);
    } else {
      token += ch;
    }
  }
  flush();
  if (depth !== 0) throw new Error(`unbalanced "[" in "${notation}"`);
  return params;
}

/**
 * The `ParamSpec` list for one catalogue row. The notation carries the explicit
 * `&` outputs; where the row is marked `byRefOut` but the notation omits the
 * `&` (the getters that take a trailing output), the last parameter is the
 * output. A variadic row (`...`) cannot name whose position is the output, so
 * the runtime determines it and no fixed by-reference parameter is declared.
 */
export function stubParams(row) {
  const params = parseParams(row.params);
  if (!row.byRefOut) return params;
  const variadic = params.some((param) => param.variadic);
  const last = params[params.length - 1];
  if (variadic || last === undefined || last.byRef) return params;
  params[params.length - 1] = { ...last, byRef: true };
  return params;
}

/** Names implemented in CORE_PLUGIN (ticket 3.12 pure built-ins, ticket 3.9 thread reads and ticket 3.16 file I/O); excluded from stubs. */
const IMPLEMENTED_COMMANDS = new Set([
  "len",
  "length",
  "left",
  "right",
  "mid",
  "instr",
  "replace",
  "regexpreplace",
  "split",
  "trim",
  "lcase",
  "ucase",
  "asc",
  "chr",
  "charat",
  "splicevariables",
  "castlit",
  "castnum",
  "castint",
  "autolocal",
  "kill",
  "local",
  "global",
  "getthreadid",
  "threadsleepremaining",
  "sourcehandle",
  "targethandle",
  "debug",
  "debugger",
  "openfileinput",
  "openfileoutput",
  "openfileappend",
  "openfilebinary",
  "closefile",
  "fileinput",
  "fileprint",
  "fileget",
  "fileput",
  "fileeof",
  "apppath",
]);
/** Commands owned by first-party domain packs; catalogue stubs must not shadow them. */
const REAL_PACK_COMMANDS = new Set([
  // world pack
  "camerapanto", "camerafollow", "camerareset", "camerashake", "getcorner",
  "drawline", "drawrect", "fillrect", "text", "msgbox", "clear", "fade",
  "viewbrd", "put", "layerput", "getboardname", "getboardtile", "boardgettile",
  "getboardtiletype", "tiletype", "animatedtiles", "parallax", "setambientlevel", "forceredraw",
  "boardgetvector", "boardsetvector", "boardgetvectorpoint", "boardsetvectorpoint",
  "boardgetprogram", "boardsetprogram", "boardgetprogrampoint", "boardsetprogrampoint",
  "prg", "setconstants", "underarrow", "send", "reset", "mainfile", "gone", "over",
  "quitgame", "dos", "windows", "win", "start", "godos",
  // render and UI packs
  "animation", "sizedanimation", "endanimation", "bordercolor", "wipe", "zoom", "earthquake",
  "mwin", "mwincls", "mwinsize", "setmwintranslucency", "wincolor", "wincolorrgb",
  "wingraphic", "textspeed", "font", "fontsize", "bold", "italics", "underline",
  "color", "colorrgb", "getcolor", "getfontsize", "gettextwidth", "gettextheight",
  "print", "show", "statictext", "mbox", "prompt", "pixeltext",
  "createcursormap", "cursormapadd", "cursormaprun", "killcursormap", "cursormaphand", "mousecursor",
  // graphics pack
  "drawcircle", "fillcircle", "setpixel", "getpixel", "savescreen", "restorescreen",
  "restorearrayscreen", "restorescreenarray", "rendernow", "getres", "drawenemy", "createcanvas", "killcanvas",
  "drawcanvas", "drawcanvastransparent", "canvasdrawpart", "canvasgetscreen", "bitmap",
  "setimage", "setimagetransparent", "setimagetranslucent", "setimageadditive",
  // movement and input pack
  "push", "pushitem", "playerstep", "itemstep", "playerpath", "itempath", "playerlocation", "itemlocation",
  "playergetpath", "itemgetpath", "activeplayer", "removeplayer", "destroyplayer", "playerdirection", "itemdirection", "playerspeed",
  "itemspeed", "playerstance", "itemstance", "wander", "wait", "get", "clearbuffer", "setbutton", "checkbutton", "clearbuttons", "mousemove", "mouseclick", "pixelmovement",
  // battle pack
  "hp", "givehp", "gethp", "maxhp", "getmaxhp", "smp", "givesmp", "getsmp", "maxsmp", "getmaxsmp",
  "fp", "givefp", "getfp", "dp", "getdp", "applystatus", "removestatus", "giveexp",
]);
/** The stub-safe rows of the catalogue, in catalogue order. */
export function stubRows(catalogue) {
  return catalogue.names.filter(
    (row) => STUB_KINDS.has(row.effectKind)
      && !IMPLEMENTED_COMMANDS.has(row.name.toLowerCase())
      && !REAL_PACK_COMMANDS.has(row.name.toLowerCase()),
  );
}

const IDENT = /^[a-z][a-z0-9]*$/;

/** One JSON string literal for generated TypeScript. */
function quote(value) {
  return JSON.stringify(value);
}

/** One `ParamSpec` object literal, in the order the core type declares. */
function renderParam(param) {
  return `{ name: ${quote(param.name)}, optional: ${param.optional}, byRef: ${param.byRef}, variadic: ${param.variadic} }`;
}

/** One catalogue stub entry, indented two spaces and spread over lines. */
function renderStub(row) {
  // The lexer ASCII case-folds every name (docs/spec/engine/rpgcode-language.md#lexical-rules LEX-10) and the
  // registry keys on the string as given, so the stub's registry key is the
  // folded name even where the catalogue spells a name mixed-case.
  const name = row.name.toLowerCase();
  if (!IDENT.test(name)) throw new Error(`bad stub name ${JSON.stringify(row.name)}`);
  const params = stubParams(row);
  const paramsText = params.length === 0 ? "[]" : `[${params.map(renderParam).join(", ")}]`;
  const sections = row.sectionsWrite.map((section) => quote(section)).join(", ");
  return [
    "  {",
    `    name: ${quote(name)},`,
    `    kind: ${quote(row.effectKind)},`,
    `    sections: [${sections}],`,
    `    obsolete: ${row.obsolete === true},`,
    `    params: ${paramsText},`,
    "  },",
  ].join("\n");
}

const HEADER = `/**
 * Catalogue command stubs: one generic command per catalogue name that is safe
 * to stub (ticket 3.21; AD-8/AD-10; decision U1).
 *
 * GENERATED — do not edit by hand. \`tools/catalogue/generate.mjs\` reads
 * \`_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-vm/discovery/command-effect-catalogue.json\`
 * and emits this file; run \`pnpm catalogue:generate\` and commit the result
 * (\`pnpm catalogue:check\` fails CI when the two drift).
 *
 * Each entry is a stub for a \`pure\`, \`state-write\` or \`draw-audio-cue\`
 * name: it validates its arguments through its \`ParamSpec\`, returns the
 * documented default (\`0\` for a \`pure\` getter, \`null\` otherwise), writes
 * \`0\` back to every by-reference output the caller supplied, and reports one
 * \`CommandEffect\` per section it writes (none for a \`pure\` getter). The VM
 * stamps each reported effect into the \`vm\` section's effect log. The two
 * obsolete names raise \`builtin.obsolete\` and report nothing. Names are the
 * ASCII case-folded catalogue names (docs/spec/engine/rpgcode-language.md#lexical-rules LEX-10), which is how the
 * lexer and the registry key them.
 *
 * Names whose kind is \`wait\`, \`request\`, \`spawn-thread\`, \`flow-control\`
 * or \`mixed\` are entries 9, 13 and 22 and are deliberately absent: a default
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

/** Build the AD-8 \`BuiltinSpec\` one catalogue row describes. */
function makeStub(stub: CatalogueStub): BuiltinSpec {
  return {
    name: stub.name,
    aliases: [],
    params: stub.params,
    call: (_view, args) => {
      if (stub.obsolete) {
        throw new ScriptError(
          "builtin.obsolete",
          \`"\${stub.name}" is obsolete: the statement is skipped\`,
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
`;

const FOOTER = `];

const IMPLEMENTED = new Map(PURE_SPECS.map((spec) => [spec.name, spec] as const));

/** The catalogue stub layer: registered between \`CORE_PLUGIN\` and caller plugins. */
export const CATALOGUE_STUBS_PLUGIN: PluginDefinition = {
  id: "catalogue",
  version: "1.0.0",
  commands: STUBS.filter((stub) => !IMPLEMENTED.has(stub.name)).map(makeStub),
};
`;

/** The generated TypeScript source for one catalogue. */
export function generate(catalogue) {
  const rows = stubRows(catalogue);
  const body = rows.map(renderStub).join("\n");
  return `${HEADER}${body}\n${FOOTER}`;
}

/** Read and parse the discovery catalogue. */
export function readCatalogue(path = cataloguePath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Re-generate in memory and compare with the committed file; returns mismatches. */
export function check(out = outPath, catalogue = readCatalogue()) {
  const expected = generate(catalogue);
  let actual = "";
  try {
    actual = readFileSync(out, "utf8");
  } catch (error) {
    return [`cannot read ${out}: ${error.message}`];
  }
  if (actual === expected) return [];
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const at = expectedLines.findIndex((line, index) => line !== actualLines[index]);
  return [
    `${out} is out of date (first difference at line ${at + 1}); run \`pnpm catalogue:generate\` and commit it`,
  ];
}

/** Write the generated file, creating its folder. */
export function write(out = outPath, catalogue = readCatalogue()) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, generate(catalogue));
}

function main(argv) {
  if (argv.includes("--check")) {
    const mismatches = check();
    if (mismatches.length > 0) {
      for (const message of mismatches) console.error(`tools/catalogue/generate.mjs: ${message}`);
      return 1;
    }
    console.log("tools/catalogue/generate.mjs: catalogue-stubs.ts matches the catalogue.");
    return 0;
  }
  write();
  const count = stubRows(readCatalogue()).length;
  console.log(`tools/catalogue/generate.mjs: wrote ${count} catalogue stubs to ${outPath}.`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
