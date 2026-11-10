import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  assetKey,
  BinaryReader,
  IR_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  newProjectMainFile,
  PACKAGE_ROOT,
  readMainFile,
  writeBoard,
  writeCharacter,
  writeMainFile,
  STOCK_RPG_PLUGIN,
} from "../src/index.ts";
import { pluginManifestFor, resolveManifestPlugins } from "../src/engine/boot.ts";
import type { BuiltinSpec } from "../src/script/builtins.ts";
import type { AssetIndex, Engine, EngineInit, GameState, InputRecord, PackageCatalogueEntry } from "../src/index.ts";

type Files = Map<string, Uint8Array>;
type StockManifest = {
  readonly name: string;
  readonly version: string;
  readonly namespace: string;
  readonly requests: PackageCatalogueEntry["requests"];
  readonly program: string;
};

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function stockPackage(name: string): { readonly manifest: StockManifest; readonly source: string } {
  const folder = join(repoRoot, "stock", name);
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as StockManifest;
  return { manifest, source: readFileSync(join(folder, manifest.program), "utf8") };
}

const STOCK_BATTLE_FIGHTENEMY: BuiltinSpec = {
  name: "fightenemy",
  aliases: [],
  params: [{ name: "args", optional: true, byRef: false, variadic: true }],
  call: () => ({ value: null }),
};

function packageCatalogue(): readonly PackageCatalogueEntry[] {
  return [stockPackage("stock_battle"), stockPackage("stock_menu"), stockPackage("stock_rpg")].map(({ manifest, source }) => ({
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: manifest.name === "stock_rpg"
      ? STOCK_RPG_PLUGIN
      : {
        id: manifest.name,
        version: manifest.version,
        commands: manifest.name === "stock_battle" ? [STOCK_BATTLE_FIGHTENEMY] : [],
      },
    startup: { kind: "inline", text: source, ir: IR_VERSION, dialect: "tk3" },
  }));
}

function boardBytes(): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 } },
  }));
}

function authoredGame(packagePlugins: readonly string[] = ["stock_battle", "stock_menu"]): { readonly files: Files; readonly index: AssetIndex; readonly main: string } {
  const files: Files = new Map();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg"];
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePlugins,
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/start.brd"), boardBytes());
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), new TextEncoder().encode('fight(1, "")\nfightenemy("slime", "")\nfightenemy("slime", "bat", "")\ninternalmenu(1)\nended = 1\nend()\n'));
  return { files, index: createAssetIndex(paths), main: "main.gam" };
}

type Started = { readonly options: Pick<EngineInit, "phaseRegistrations">; state(): GameState };
function startDoubles(): Started {
  let latest: GameState | null = null;
  return {
    options: { phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }] },
    state: () => {
      if (latest === null) throw new Error("the engine has not advanced");
      return latest;
    },
  };
}

function run(engine: Engine, files: Files, doubles: Started, closeMenu = false): { readonly diagnostics: readonly { readonly code: string; readonly message: string }[]; readonly openedMenu: boolean } {
  let replies: InputRecord[] = [];
  const diagnostics: { readonly code: string; readonly message: string }[] = [];
  let openedMenu = false;
  for (let guard = 0; guard < 100; guard += 1) {
    const report = engine.advance(20, replies);
    replies = [];
    diagnostics.push(...report.diagnostics);
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
      continue;
    }
    if (closeMenu && !openedMenu && doubles.state().menu.screens.length > 0 &&
        doubles.state().vm.threads.some((thread) => thread.wait?.kind === "input.key")) {
      openedMenu = true;
      replies.push({ tick: report.tickAfter, event: { kind: "key", name: "ESC", code: "Escape", char: null, down: true } });
    }
    if (doubles.state().vm.globals.ended === 1) return { diagnostics, openedMenu };
  }
  throw new Error("the headless host did not settle");
}

test("stock packages load together and the real menu opens and closes", () => {
  const catalogue = packageCatalogue();
  const resolved = resolveManifestPlugins(
    catalogue.map((entry) => ({
      id: entry.name,
      version: entry.version,
      ...(entry.namespace === undefined ? {} : { namespace: entry.namespace }),
      requests: entry.requests,
    })),
    "main.gam",
    catalogue,
  );
  equal(resolved.diagnostics.length, 0);
  deepEqual(resolved.plugins.map((plugin) => plugin.package), [
    { name: "stock_battle", version: "1.0.0", namespace: "stock_battle", requests: ["asset"] },
    { name: "stock_menu", version: "1.0.0", namespace: "stock_menu", requests: ["asset", "listBlobs", "loadBlob", "saveBlob", "quit"] },
    { name: "stock_rpg", version: "1.0.0", namespace: "stock_rpg", requests: [] },
  ]);
  const game = authoredGame();
  const doubles = startDoubles();
  const engine = createEngine({
    seed: 11,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: game.main,
    gameIdentity: "stock-packages-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 600,
    packageCatalogue: catalogue,
    ...doubles.options,
  });
  const result = run(engine, game.files, doubles, true);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "plugin.unresolved"), false);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("package.startup-")), false);
  equal(result.openedMenu, true, "the stock menu provider entered and waited for input");
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "callable.arity"), false);
  equal(doubles.state().vm.globals.ended, 1);
});

test("stock_rpg startup is available only through explicit host catalogue selection", () => {
  const catalogue = packageCatalogue();
  const resolved = resolveManifestPlugins(
    [{ id: "stock_rpg", version: "1.0.0", namespace: "stock_rpg", requests: [] }],
    "main.gam",
    catalogue,
  );
  equal(resolved.diagnostics.length, 0);
  equal(resolved.plugins.length, 1);
  equal(resolved.plugins[0]?.package?.name, "stock_rpg");
  equal(resolved.plugins[0]?.definition, STOCK_RPG_PLUGIN);
  equal(resolved.plugins[0]?.startup?.kind, "inline");
});

test("without stock packages, menu facade reports missing provider and leaves the stack unchanged", () => {
  const game = authoredGame([]);
  const doubles = startDoubles();
  const engine = createEngine({
    seed: 11,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: game.main,
    gameIdentity: "stock-packages-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 600,
    packageCatalogue: packageCatalogue(),
    ...doubles.options,
  });
  const result = run(engine, game.files, doubles);
  deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["battle.no-board", "battle.package-missing", "battle.package-missing", "menu.provider-missing"]);
  equal(doubles.state().vm.globals.ended, 1);
  equal(doubles.state().menu.screens.length, 0);
});

/** A legacy main file naming the stock DLLs in all three legacy rows (docs/spec/formats/main-file.md#layout rows 23, 24 and 38b). */
const LEGACY_PLUGIN_ROWS = {
  ...createEmptyMainFile(),
  major: 2,
  minor: 9,
  menuPlugin: "tk3menu.dll",
  fightPlugin: "Plugin\\TK3FIGHT.DLL",
  plugins: [
    { enabled: 0, pluginFile: "tk3menu.dll" },
    { enabled: 0, pluginFile: "" },
  ],
};

test("legacy .gam plugin rows map to the stock packages without changing the file's bytes", () => {
  const bytes = unwrap(writeMainFile(LEGACY_PLUGIN_ROWS));
  const parsed = unwrap(readMainFile(new BinaryReader(bytes, "main.gam")));
  deepEqual([...unwrap(writeMainFile(parsed))], [...bytes]);
  deepEqual(
    [parsed.menuPlugin, parsed.fightPlugin, parsed.plugins.map((entry) => entry.pluginFile)],
    ["tk3menu.dll", "Plugin\\TK3FIGHT.DLL", ["tk3menu.dll", ""]],
  );
  const result = pluginManifestFor(parsed, "main.gam", packageCatalogue());
  deepEqual(result.diagnostics, []);
  deepEqual(
    result.manifest.slice(-2).map((entry) => [entry.id, entry.version, entry.namespace]),
    [["stock_menu", "1.0.0", "stock_menu"], ["stock_battle", "1.0.0", "stock_battle"]],
  );
});

test("a legacy row and the same package named explicitly are one manifest entry", () => {
  const main = { ...LEGACY_PLUGIN_ROWS, packagePlugins: ["stock_battle", "stock_menu"], packagePluginsExtension: true };
  const parsed = unwrap(readMainFile(new BinaryReader(unwrap(writeMainFile(main)), "main.gam")));
  const result = pluginManifestFor(parsed, "main.gam", packageCatalogue());
  deepEqual(result.diagnostics, []);
  deepEqual(result.manifest.slice(-2).map((entry) => entry.id), ["stock_battle", "stock_menu"]);
});

test("an unmapped custom DLL keeps its row as data and reports one located diagnostic", () => {
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    plugins: [
      { enabled: 0, pluginFile: "myCustomFight.dll" },
      { enabled: 0, pluginFile: "tk3fight.dll" },
    ],
  };
  const parsed = unwrap(readMainFile(new BinaryReader(unwrap(writeMainFile(main)), "main.gam")));
  const result = pluginManifestFor(parsed, "main.gam", packageCatalogue());
  deepEqual(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.file, diagnostic.line]), [["plugin.legacy-unmapped", "main.gam", 0]]);
  equal(result.diagnostics[0]!.message.includes("myCustomFight.dll"), true);
  deepEqual(result.manifest.slice(-1).map((entry) => entry.id), ["stock_battle"]);
  deepEqual(parsed.plugins.map((entry) => entry.pluginFile), ["myCustomFight.dll", "tk3fight.dll"]);
});

test("a legacy row named like an Object.prototype member maps to nothing and reports one diagnostic", () => {
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    menuPlugin: "Constructor",
    plugins: [{ enabled: 0, pluginFile: "__proto__" }],
  };
  const parsed = unwrap(readMainFile(new BinaryReader(unwrap(writeMainFile(main)), "main.gam")));
  const result = pluginManifestFor(parsed, "main.gam", packageCatalogue());
  deepEqual(
    result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.line]),
    [["plugin.legacy-unmapped", 0], ["plugin.legacy-unmapped", 0]],
  );
  deepEqual(result.manifest.slice(-1).map((entry) => entry.id), ["twbutton"]);
});

test("a new-project template lists both stock packages and round-trips them explicitly", () => {
  const template = newProjectMainFile();
  deepEqual([...(template.packagePlugins ?? [])], ["stock_battle", "stock_menu"]);
  equal(template.packagePluginsExtension, true);
  equal(template.menuPlugin, "");
  equal(template.fightPlugin, "");
  const parsed = unwrap(readMainFile(new BinaryReader(unwrap(writeMainFile(template)), "main.gam")));
  equal(parsed.packagePluginsExtension, true);
  deepEqual([...(parsed.packagePlugins ?? [])], ["stock_battle", "stock_menu"]);
  const catalogue = packageCatalogue();
  const resolved = resolveManifestPlugins(pluginManifestFor(parsed, "main.gam", catalogue).manifest, "main.gam", catalogue);
  equal(resolved.diagnostics.length, 0);
  deepEqual(
    resolved.plugins.flatMap((plugin) => (plugin.package === undefined ? [] : [plugin.package.name])),
    ["stock_battle", "stock_menu"],
  );
});
