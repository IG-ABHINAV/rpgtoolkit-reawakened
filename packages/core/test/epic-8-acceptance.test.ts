// Epic 8 end-to-end acceptance (ticket 8.14, #595).
//
// Acceptance and integrated headless play-throughs covering every E-80–E-87 and E-123 behavior,
// full CAP-10/CAP-11 workflows, the stock_rpg dialogue bridge, and Epic 7 battle inventory consumption.
import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyItem,
  createEmptyMainFile,
  createEmptySpecialMove,
  hashDrawList,
  hashGameState,
  IR_VERSION,
  STOCK_RPG_PLUGIN,
  writeBoard,
  writeCharacter,
  writeItem,
  writeMainFile,
  writeSpecialMove,
  type PackageCatalogueEntry,
  type PluginDefinition,
} from "../src/index.ts";
import { readEvent, type EventView } from "../src/events/native.ts";
import { bootHost, drawn, press, repoRoot, type Files, type HostGame, type Session } from "./stock-menu-rig.ts";
import { encodePng } from "./battle-ui-rig.ts";

const goldenDir = join(repoRoot, "golden", "epic8");
const goldenPath = join(goldenDir, "acceptance.json");

type GoldenCheckpoint = {
  readonly id: string;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly events: readonly EventView[];
};

type AcceptanceGolden = {
  readonly schema: 1;
  readonly checkpoints: readonly GoldenCheckpoint[];
};

function readGolden(): AcceptanceGolden | null {
  if (!existsSync(goldenPath)) return null;
  return JSON.parse(readFileSync(goldenPath, "utf8")) as AcceptanceGolden;
}

// Recorded state hashes moved twice, both times in `stateHash` only (every `drawHash` and event list is
// byte-identical to the previous recording, so the recorded screens, actions and events are unchanged):
//   #1234 - the menu context and the menu's own item cache carry the E-83 shop data (item prices, shop actions);
//   #1231 - the party section gained `stepRemainder` and its version number (party schema 3).
function recordCheckpoint(checkpoints: GoldenCheckpoint[], id: string, session: Session, events: EventView[]): void {
  const state = session.state();
  const stateHash = hashGameState(state);
  const drawHash = hashDrawList(session.engine.drawList());
  checkpoints.push({ id, stateHash, drawHash, events: events.splice(0) });
}

function verifyOrSaveGolden(checkpoints: GoldenCheckpoint[]): void {
  if (process.env.EPIC8_ACCEPTANCE_RECORD === "1") {
    if (!existsSync(goldenDir)) mkdirSync(goldenDir, { recursive: true });
    const payload: AcceptanceGolden = { schema: 1, checkpoints };
    writeFileSync(goldenPath, `${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const committed = readGolden();
  if (committed === null) {
    throw new Error(`golden/epic8/acceptance.json is missing; run with EPIC8_ACCEPTANCE_RECORD=1 node --test packages/core/test/epic-8-acceptance.test.ts to record it`);
  }
  deepEqual(checkpoints, committed.checkpoints, "acceptance checkpoints match the committed golden");
}

function loadStockPackage(name: string): { readonly manifest: { readonly name: string; readonly version: string; readonly namespace: string; readonly requests: PackageCatalogueEntry["requests"]; readonly program: string }; readonly source: string } {
  const folder = join(repoRoot, "stock", name);
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
  return { manifest, source: readFileSync(join(folder, manifest.program), "utf8") };
}

function epic8Catalogue(extraPlugins: readonly PluginDefinition[] = []): readonly PackageCatalogueEntry[] {
  const menu = loadStockPackage("stock_menu");
  const rpg = loadStockPackage("stock_rpg");
  const battle = loadStockPackage("stock_battle");

  const packages: PackageCatalogueEntry[] = [
    {
      name: menu.manifest.name,
      version: menu.manifest.version,
      namespace: menu.manifest.namespace,
      requests: menu.manifest.requests,
      definition: { id: menu.manifest.name, version: menu.manifest.version, commands: [] },
      startup: { kind: "inline", text: menu.source, ir: IR_VERSION, dialect: "tk3" },
    },
    {
      name: rpg.manifest.name,
      version: rpg.manifest.version,
      namespace: rpg.manifest.namespace,
      requests: rpg.manifest.requests,
      definition: STOCK_RPG_PLUGIN,
      startup: { kind: "inline", text: rpg.source, ir: IR_VERSION, dialect: "tk3" },
    },
    {
      name: battle.manifest.name,
      version: battle.manifest.version,
      namespace: battle.manifest.namespace,
      requests: battle.manifest.requests,
      definition: { id: battle.manifest.name, version: battle.manifest.version, commands: [] },
      startup: { kind: "inline", text: battle.source, ir: IR_VERSION, dialect: "tk3" },
    },
    ...extraPlugins.map((def) => ({
      name: def.id,
      version: def.version,
      requests: [],
      definition: def,
    })),
  ];
  return packages;
}

function boardWithSaving(disableSaving: number): Uint8Array {
  const empty = createEmptyBoard();
  const res = writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 }, disableSaving },
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

function makeAcceptanceGame(options: { readonly disableSaving?: number; readonly startup?: string; readonly extraPlugins?: readonly string[] } = {}): HostGame {
  const files: Files = new Map();
  const paths = [
    "main.gam", "Boards/start.brd", "Chrs/hero.tem", "Chrs/ally1.tem", "Prg/start.prg",
    "Item/potion.itm", "Item/sword.itm", "Item/axe.itm", "Item/key.itm", "Item/amulet.itm", "Item/elixir.itm",
    "SpcMove/fire.spc", "Prg/fire.prg",
    "Bitmap/layout.png", "Bitmap/ghost.png",
    "Media/move.wav", "Media/confirm.wav", "Media/cancel.wav",
  ];

  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePlugins: ["stock_menu", "stock_rpg", "stock_battle", ...(options.extraPlugins ?? [])],
    cursorMoveSound: "move.wav",
    cursorSelectSound: "confirm.wav",
    cursorCancelSound: "cancel.wav",
  };
  const mainBytes = writeMainFile(main);
  if (!mainBytes.ok) throw new Error(mainBytes.error.message);
  files.set(assetKey("main.gam"), mainBytes.value);
  files.set(assetKey("boards/start.brd"), boardWithSaving(options.disableSaving ?? 0));

  const emptyChar = createEmptyCharacter();
  const heroAccSlots = [...emptyChar.accessorySlots];
  heroAccSlots[1] = "Amulet";
  const heroBytes = writeCharacter({
    ...emptyChar,
    minor: 5,
    name: "Hero",
    stats: { ...emptyChar.stats, hp: 10, maxHp: 20, level: 1, smp: 5, maxSmp: 10 },
    bodySlots: [0, 1, 1, 1, 1, 1, 1],
    accessorySlots: heroAccSlots,
    profilePicture: "layout.png",
    hasSpecialMoves: 0,
    specialMoves: emptyChar.specialMoves.map((slot, index) => index === 0 ? { ...slot, file: "fire.spc" } : slot),
    specialMoveCategory: "Magic",
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  });
  if (!heroBytes.ok) throw new Error(heroBytes.error.message);
  files.set(assetKey("chrs/hero.tem"), heroBytes.value);

  const allyBytes = writeCharacter({
    ...emptyChar,
    minor: 5,
    name: "Ally",
    stats: { ...emptyChar.stats, hp: 8, maxHp: 15, level: 1, smp: 4, maxSmp: 8 },
    bodySlots: [0, 1, 1, 1, 1, 1, 1],
    hasSpecialMoves: 0,
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  });
  if (!allyBytes.ok) throw new Error(allyBytes.error.message);
  files.set(assetKey("chrs/ally1.tem"), allyBytes.value);

  // Items
  const potionBytes = writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Potion",
    description: "Restores 10 HP",
    menuUsable: 1,
    equipable: 1,
    equipSlots: [0, 1, 0, 0, 0, 0, 0, 0],
    menuUseHp: 10,
    buyPrice: 10,
    sellPrice: 5,
  });
  if (!potionBytes.ok) throw new Error(potionBytes.error.message);
  files.set(assetKey("item/potion.itm"), potionBytes.value);

  const swordBytes = writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Iron sword",
    description: "Cuts things",
    equipable: 1,
    equipSlots: [0, 0, 0, 0, 1, 0, 0, 0],
    equipBonus: [0, 0, 5, 0],
    buyPrice: 50,
    sellPrice: 25,
  });
  if (!swordBytes.ok) throw new Error(swordBytes.error.message);
  files.set(assetKey("item/sword.itm"), swordBytes.value);

  const axeBytes = writeItem({
    ...createEmptyItem(), minor: 4, movementAnimations: Array(8).fill(""), name: "Iron axe",
    equipable: 1, equipSlots: [0, 0, 0, 0, 1, 0, 0, 0], equipBonus: [0, 0, 8, 0],
  });
  if (!axeBytes.ok) throw new Error(axeBytes.error.message);
  files.set(assetKey("item/axe.itm"), axeBytes.value);

  const keyBytes = writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Brass key",
    description: "Opens the cellar",
    menuUsable: 1,
    keyItem: 1,
    buyPrice: 0,
    sellPrice: 0,
  });
  if (!keyBytes.ok) throw new Error(keyBytes.error.message);
  files.set(assetKey("item/key.itm"), keyBytes.value);

  const amuletBytes = writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Amulet",
    description: "An accessory",
    equipable: 1,
    equipSlots: [0, 0, 0, 0, 0, 0, 0, 1],
    accessoryName: "Amulet",
    equipBonus: [0, 3, 0, 0],
    buyPrice: 100,
    sellPrice: 50,
  });
  if (!amuletBytes.ok) throw new Error(amuletBytes.error.message);
  files.set(assetKey("item/amulet.itm"), amuletBytes.value);

  const elixirBytes = writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Elixir",
    description: "Rare tonic",
    buyPrice: 200,
    sellPrice: 100,
  });
  if (!elixirBytes.ok) throw new Error(elixirBytes.error.message);
  files.set(assetKey("item/elixir.itm"), elixirBytes.value);

  const moveBytes = writeSpecialMove({
    ...createEmptySpecialMove(),
    minor: 3,
    name: "Fire",
    description: "A spark",
    program: "fire.prg",
    usableInBattle: 0,
  });
  if (!moveBytes.ok) throw new Error(moveBytes.error.message);
  files.set(assetKey("spcmove/fire.spc"), moveBytes.value);
  files.set(assetKey("prg/fire.prg"), new TextEncoder().encode("abilityused = 1\n"));
  files.set(assetKey("bitmap/layout.png"), encodePng(1, 1, new Uint8Array([200, 40, 40, 255])));
  files.set(assetKey("bitmap/ghost.png"), encodePng(1, 1, new Uint8Array([0, 0, 0, 0])));

  const wave = new Uint8Array(44 + 512);
  const view = new DataView(wave.buffer);
  const setStr = (offset: number, val: string) => { for (let i = 0; i < val.length; i++) wave[offset + i] = val.charCodeAt(i); };
  setStr(0, "RIFF");
  view.setUint32(4, 36 + 512, true);
  setStr(8, "WAVE");
  setStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  setStr(36, "data");
  view.setUint32(40, 512, true);
  for (const name of ["move", "confirm", "cancel"]) files.set(assetKey(`media/${name}.wav`), wave);

  files.set(assetKey("prg/start.prg"), new TextEncoder().encode("end()\n"));

  return { files, index: createAssetIndex(paths), main: "main.gam" };
}

// Full-engine acceptance suite, kept on purpose: it runs integrated play-throughs over real stock packages to
// prove all E-80–E-87 and E-123 behaviors against committed golden hashes.
//
// Duration: the play-through below takes about nine seconds at 320 x 240 (AGENTS.md: ordinary tests stay under one
// second individually). That is irreducible here: the scenario drives one booted game through the menu, items,
// equipment, abilities, saved graphics and sounds, and the saving-disabled board case, over thousands of engine
// ticks, and each checkpoint is a real state/draw/event hash of the whole engine. Splitting it would boot the same
// game several times and prove less; the per-layer behavior has its own fast unit suites, so the golden is only
// re-recorded when this integrated path changes (G5).

test("[E-80, E-81, E-82, E-87, CAP-10] integrated stock menu play-through covers items, equip, abilities, time, gold, and matches committed golden", () => {
  const startup = [
    'addplayer("ally1.tem")',
    'giveitem("potion")',
    'giveitem("potion")',
    'giveitem("sword")',
    'giveitem("key")',
    'giveitem("amulet")',
    'giveitem("axe")',
    'givegp(120)',
    'menugraphic("layout.png")',
    'mainmenu()',
    'end()',
  ].join("\n");
  const events: EventView[] = [];
  const probe: PluginDefinition = {
    id: "acceptance-events", version: "1.0.0",
    commands: [{
      name: "recordinventory", aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state !== undefined) {
          const event = readEvent(view.state, args[0]?.value);
          if (event !== undefined) events.push(event);
        }
        return { value: null };
      },
    }],
    listeners: ["itemAdded", "itemRemoved", "goldChanged"].map((type) => ({
      emitter: "inventory", type, command: "recordinventory",
    })),
  };
  const game = makeAcceptanceGame({ startup, extraPlugins: [probe.id] });
  const checkpoints: GoldenCheckpoint[] = [];
  const session = bootHost({
    game,
    catalogue: epic8Catalogue([probe]),
    width: 640,
    height: 480,
    startup,
  });

  // [E-80, E-87, E-86] Main screen opened: gold, time, party members with stats rendered
  session.pump((state) => state.menu.screens.length === 1);
  recordCheckpoint(checkpoints, "main-opened", session, events);
  equal(session.state().menu.screens[0]?.screen, "main");
  equal(session.state().inventory.gold, 120);
  equal(session.state().party.members.length, 2);
  const hero = () => {
    const actor = session.state().actors.actors.find((candidate) => candidate.name === "Hero");
    ok(actor);
    return actor;
  };
  const baseFp = hero().stats.fp;
  const baseDp = hero().stats.dp;
  equal(session.state().menu.graphic, "layout.png");
  const surfaceEntry = session.state().surfaces.entries[String(session.state().surfaces.renderNow)];
  ok(surfaceEntry);
  const pixels = session.engine.surfacePixels(surfaceEntry.id, surfaceEntry.rev);
  ok(pixels);
  deepEqual([...pixels.rgba.subarray((15 * 640 + 15) * 4, (15 * 640 + 15) * 4 + 4)], [200, 40, 40, 255]);
  // Advance exactly 120 engine ticks and redraw with a round-trip cursor move.
  const tickBefore = session.state().time.tick;
  session.advance(120);
  equal(session.state().time.tick, tickBefore + 120);
  press(session, "DOWN");
  press(session, "UP");
  const mainTexts = drawn(session).texts;
  ok(mainTexts.includes("Gold 120"), "main screen renders gold");
  ok(mainTexts.includes("Time 0:00:02"), "120 elapsed ticks display two whole seconds");
  ok(mainTexts.some((t) => t.includes("Hero") && t.includes("HP 10/20")), "main screen renders Hero HP");
  ok(mainTexts.some((t) => t.includes("Ally") && t.includes("HP 8/15")), "main screen renders Ally HP");

  // [E-80, E-81] Navigate to Items, use one potion on Hero (10 -> 20 HP)
  press(session, "ENTER"); // Open Items
  equal(session.state().menu.screens.at(-1)?.screen, "items");
  ok(session.cues.some((cue) => cue.kind === "media.play" && cue.track === "ui" && cue.asset === assetKey("media/confirm.wav")), "confirm cue plays on ui track");
  recordCheckpoint(checkpoints, "items-opened", session, events);
  press(session, "ENTER"); // Select Potion -> action menu (Use, Info, Drop)
  press(session, "ENTER"); // Select Use -> member list (Hero, Ally)
  press(session, "ENTER"); // Use on Hero
  equal(session.state().actors.actors.find((a) => a.name === "Hero")?.stats.hp, 20, "Potion restored Hero HP to max");
  equal(session.state().inventory.items.find((i) => i.handle === "Potion")?.quantity, 1, "Potion stack quantity decremented to 1");
  ok(events.some((event) => event.emitter === "inventory" && event.type === "itemRemoved"), "item use emits an inventory removal");
  recordCheckpoint(checkpoints, "item-used", session, events);

  press(session, "ENTER"); // Open the remaining Potion's actions
  press(session, "DOWN");
  press(session, "DOWN");
  press(session, "ENTER"); // Drop the remaining ordinary item
  equal(session.state().inventory.items.find((i) => i.handle === "Potion"), undefined, "ordinary items can be dropped");

  // [E-80, E-81] Info and Key Item drop refusal
  press(session, "DOWN"); // Move from Iron sword to Brass key
  ok(session.cues.some((cue) => cue.kind === "media.play" && cue.track === "ui" && cue.asset === assetKey("media/move.wav")), "move cue plays on ui track");
  press(session, "ENTER"); // Select Brass key
  press(session, "DOWN");  // Move to Info
  press(session, "ENTER"); // Open Info
  deepEqual(drawn(session).texts, ["Brass key", "Opens the cellar"], "Info displays stored item description");
  press(session, "ESC");   // Return to actions
  press(session, "DOWN");  // Move to Drop
  press(session, "ENTER"); // Attempt to drop key item
  equal(session.state().inventory.items.find((i) => i.handle === "Brass key")?.quantity, 1, "Key item cannot be dropped");
  press(session, "ESC");   // Exit item actions
  ok(session.cues.some((cue) => cue.kind === "media.play" && cue.track === "ui" && cue.asset === assetKey("media/cancel.wav")), "cancel cue plays on ui track");
  press(session, "ESC");   // Exit Items back to Main

  // [E-80, E-82] Equip screen: choose Hero, right-hand, equip Sword, verify equip bonuses, then unequip
  press(session, "DOWN");  // Move to Equip
  press(session, "ENTER"); // Open Equip -> member list
  equal(session.state().menu.screens.at(-1)?.screen, "equipment");
  recordCheckpoint(checkpoints, "equip-opened", session, events);
  press(session, "ENTER"); // Select Hero -> slot list
  // Move down to right-hand (index 2: head=0, neck=1, right-hand=2)
  press(session, "DOWN");
  press(session, "DOWN");
  press(session, "ENTER"); // Open item list for right-hand
  press(session, "ENTER"); // Equip Iron sword
  deepEqual(session.state().inventory.equipment.map((e) => [e.slot, e.itemId]), [["right-hand", 2]], "Sword equipped in right-hand");
  equal(hero().stats.fp, baseFp + 5, "sword adds five FP");
  recordCheckpoint(checkpoints, "sword-equipped", session, events);
  // Replace the occupied hand slot with the axe; its different bonus must replace, not stack with, the sword.
  press(session, "ENTER");
  press(session, "DOWN"); // Remove is first; axe is the first fitting available item.
  press(session, "ENTER");
  equal(hero().stats.fp, baseFp + 8, "replacement removes the sword bonus and applies the axe bonus");
  equal(session.state().inventory.items.find((item) => item.handle === "Iron sword")?.quantity, 1, "replaced sword returns to inventory");
  recordCheckpoint(checkpoints, "sword-replaced", session, events);
  press(session, "ENTER");
  press(session, "ENTER"); // Remove the axe.
  equal(hero().stats.fp, baseFp, "removing the axe restores FP");
  equal(session.state().inventory.equipment.length, 0, "hand slot is empty");
  for (let i = 0; i < 4; i++) press(session, "DOWN"); // right-hand -> accessory-7
  press(session, "ENTER");
  press(session, "ENTER");
  equal(session.state().inventory.equipment[0]?.slot, "accessory-7");
  equal(hero().stats.dp, baseDp + 3, "amulet adds three DP");
  recordCheckpoint(checkpoints, "accessory-equipped", session, events);
  press(session, "ENTER");
  press(session, "ENTER");
  equal(hero().stats.dp, baseDp, "removing the amulet restores DP");
  equal(session.state().inventory.equipment.length, 0, "accessory slot is empty");
  recordCheckpoint(checkpoints, "equipment-removed", session, events);
  press(session, "ESC");   // Exit slots
  press(session, "ESC");   // Exit Equip back to Main

  // [E-80] Abilities screen: open, select Hero, inspect Fire ability description, use board-usable move
  press(session, "DOWN");  // Move from Equip to Abilities
  press(session, "ENTER"); // Open Abilities
  equal(session.state().menu.screens.at(-1)?.screen, "abilities");
  recordCheckpoint(checkpoints, "abilities-opened", session, events);
  press(session, "ENTER"); // Select Hero -> moves list
  press(session, "ENTER"); // Select Fire -> actions (Use, Info)
  press(session, "DOWN");  // Select Info
  press(session, "ENTER");
  deepEqual(drawn(session).texts, ["Fire", "A spark"], "Ability Info displays move description");
  press(session, "ESC");   // Exit Info
  press(session, "UP");    // Select Use
  press(session, "ENTER"); // Use Fire
  equal(session.state().vm.globals.abilityused, 1, "Board-usable special move executed program");
  recordCheckpoint(checkpoints, "ability-used", session, events);
  press(session, "ESC");   // Exit moves
  press(session, "ESC");   // Exit Abilities back to Main

  // [E-80] Quit confirmation: No returns, cancel returns, menu key closes all
  press(session, "DOWN");
  press(session, "DOWN");
  press(session, "DOWN");  // Move to Quit
  press(session, "ENTER"); // Open Quit question
  deepEqual(drawn(session).texts, ["Quit the game?", "No", "Yes"], "Quit asks confirmation first");
  press(session, "ENTER"); // Choose No
  equal(session.state().menu.screens.length, 1, "No returns to Main menu");
  equal(session.requests.filter((r) => r === "quit").length, 0, "No quit request sent");

  // Verify against committed golden checkpoints
  verifyOrSaveGolden(checkpoints);
  deepEqual(session.diagnostics, [], "No diagnostics during complete play-through");
});

// The real board loader and stock provider must meet at the save gate; owner-only tests cannot prove that integration.
test("[E-123] a saving-disabled board refuses the stock save picker", () => {
  const startup = "mainmenu()\n";
  const session = bootHost({ game: makeAcceptanceGame({ disableSaving: 1 }), catalogue: epic8Catalogue(), width: 320, height: 240, startup });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["DOWN", "DOWN", "DOWN", "ENTER"]) press(session, key);
  equal(session.requests.includes("listBlobs"), false, "the picker must not list saves");
  equal(session.requests.includes("saveBlob"), false, "the disabled board must not save");
  equal(session.state().menu.screens.length, 1);
  ok(drawn(session).texts.includes("Saving is not allowed here"));
});
