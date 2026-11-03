// Epic 8.6 integrated shop, gold, party, and Inn coverage (#595).
// Contracts: docs/spec/engine/rpgcode-functions.md#e-83 and #e-84;
// docs/spec/engine/plugins-and-battle.md#e-80-stock-menu (item 15) and #e-85.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assetKey,
  type GameState,
  createAssetIndex,
  createEmptyItem,
  IR_VERSION,
  restoreGameState,
  startThread,
  snapshot,
  STOCK_RPG_PLUGIN,
  writeItem,
  type PackageCatalogueEntry,
} from "../src/index.ts";
import { shopStockFromThreads } from "../src/menu/shop.ts";
import { authoredGame, bootHost, catalogue as menuCatalogue, drawnTexts, pad, pointer, press, repoRoot, type HostGame, type Session } from "./stock-menu-rig.ts";

const shopPackage = (() => {
  const path = join(repoRoot, "stock", "stock_rpg");
  const manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) as {
    name: string; version: string; namespace: string; requests: PackageCatalogueEntry["requests"]; program: string;
  };
  return { manifest, source: readFileSync(join(path, manifest.program), "utf8") };
})();
const stock = ["item/stock-potion.itm", "item/stock-tonic.itm"] as const;
const catalogue: readonly PackageCatalogueEntry[] = [
  ...menuCatalogue(),
  { name: shopPackage.manifest.name, version: shopPackage.manifest.version, namespace: shopPackage.manifest.namespace,
    requests: shopPackage.manifest.requests, definition: STOCK_RPG_PLUGIN,
    startup: { kind: "inline", text: shopPackage.source, ir: IR_VERSION, dialect: "tk3" } },
];

function gameWithShopItems(): HostGame {
  const base = authoredGame({ allies: 1, startup: "end()\n" });
  const files = new Map(base.files);
  const itemDefinitions = [
    ["stock-potion.itm", "Stock Potion", 10, 5],
    ["stock-tonic.itm", "Stock Tonic", 20, 8],
  ] as const;
  const itemPaths = itemDefinitions.map(([filename]) => assetKey(`Item/${filename}`));
  for (const [filename, name, buyPrice, sellPrice] of itemDefinitions) {
    const bytes = writeItem({ ...createEmptyItem(), minor: 4, movementAnimations: Array(8).fill(""), name,
      description: name, buyPrice, sellPrice, menuUsable: 1 });
    if (!bytes.ok) throw new Error(bytes.error.message);
    files.set(assetKey(`item/${filename}`), bytes.value);
  }
  return { ...base, files, index: createAssetIndex([...base.index.paths, ...itemPaths]) };
}

type Visible = Pick<GameState, "menu">;

/**
 * A game-shipped prompt read: one menu provider that copies the script-visible party view into a global, so the
 * test asserts the E-87 step count through the script interface rather than the state field
 * (docs/spec/engine/plugins-and-battle.md#e-80; docs/spec/engine/rpgcode-language.md#e-87).
 */
const STEP_PROBE = 'registerplugin({ name: "steps-probe", commands: {}, menuProviders: { main: (context) => {\n  stepsseen = context.party.steps\n} } })\n';

/** The shop frame the screen opened, or `undefined` while it is closed. */
function shopFrame(state: Visible): { screen: string; selection: number } | undefined {
  return state.menu.screens.find((frame) => frame.screen === "shop");
}

function showing(state: GameState, text: string): void {
  const texts = drawnTexts(state).texts;
  ok(texts.includes(text), `the shop screen drew "${text}": ${JSON.stringify(texts)}`);
}

function openShop(): Session {
  // Full-engine duration is intentional: a focused owner test cannot prove RPGCode filename resolution, host-served
  // item bytes, a live `shop` menu provider frame and owner transactions driven by real input while it runs. The
  // scenario stays minimal (two listed items, one buy, one sale, two refusals) to avoid unrelated engine behaviour.
  const session = bootHost({ game: gameWithShopItems(), catalogue, width: 320, height: 240, startup: "end()\n" });
  // A real held ArrowRight walks the board player one 32-pixel tile before the script runs, so the step count is
  // earned by completed travel (a script that owns input would hold the direction rule off).
  const start = session.state().time.tick;
  session.advance(4, [{ tick: start, event: { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true } }]);
  for (let step = 0; step < 10 && session.state().party.steps < 1; step += 1) session.advance(4);
  const walked = session.state();
  session.advance(1, [{ tick: walked.time.tick, event: { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false } }]);
  startThread(session.state().vm, {
    ref: { kind: "inline", text: STEP_PROBE + 'givegp(15)\naddplayer("ally1.tem")\nmainmenu()\ncallshop("stock-potion", "stock-tonic")\nafter = 1\n', ir: IR_VERSION },
    kind: "blocking", owner: "script",
  });
  session.pump((current) => current.menu.screens.some((frame) => frame.screen === "shop"));
  return session;
}

test("full-engine CallShop opens the stock menu's shop screen and scripted input buys, sells, refuses and closes", () => {
  const session = openShop();
  const opened = session.state();
  equal(shopFrame(opened)?.screen, "shop", "the CallShop command entered the registered shop provider");
  ok(session.requests.includes("asset"), "the headless host served the shop's item definitions");
  showing(opened, "Shop");
  showing(opened, "Stock Potion");
  showing(opened, "Buy 10 / Sell 5");
  showing(opened, "Stock Tonic");
  showing(opened, "Buy 20 / Sell 8");
  showing(opened, "Gold 15");
  // The session is plain data (G1): its stock rides on the provider frame's saved continuation, so a canonical
  // snapshot taken inside the shop restores with the session intact and nothing added to `GameState`.
  const restored = restoreGameState(snapshot(opened));
  deepEqual(shopStockFromThreads(restored.vm.threads), [...stock], "the saved shop frame carries its stock");
  // E-87 steps: the walk above moved the selected player with real held input, and the game-shipped provider read
  // the count back through the script-visible party view before the shop opened.
  const stepsSeen = (opened.vm.globals as Record<string, unknown>).stepsseen;
  ok(typeof stepsSeen === "number" && stepsSeen >= 1, `the script-visible party view reports the walk (${String(stepsSeen)})`);
  equal(stepsSeen, opened.party.steps, "the script sees exactly the counted steps");
  deepEqual(restored.party, opened.party, "the step count and its sub-tile remainder survive a canonical save/restore");

  // Buy one potion: stock row -> Buy -> amount 1.
  const actions = press(session, "ENTER");
  showing(actions, "Buy");
  showing(actions, "Sell");
  const amounts = press(session, "ENTER");
  showing(amounts, "1 x 10 = 10 GP");
  const bought = press(session, "ENTER");
  equal(bought.inventory.gold, 5, "the inventory owner debited the item's buy price once");
  equal(bought.inventory.items.find((item) => item.source === stock[0])?.quantity, 1, "the bought unit is one available stack");
  showing(bought, "Bought Stock Potion x 1");
  showing(bought, "Gold 5");
  ok(bought.vm.effects.some((effect) => effect.kind === "state-write" && effect.patch?.section === "inventory" &&
    JSON.stringify(effect.args).includes('"buyItem"')), "the purchase reached the owner through the normal effect bus");

  // Sell refusal: the party holds one potion, so amount 2 cannot be sold.
  press(session, "ENTER");
  press(session, "DOWN");
  press(session, "ENTER");
  const refusedSale = press(session, "DOWN");
  showing(refusedSale, "2 x 5 = 10 GP");
  const saleRefusal = press(session, "ENTER");
  showing(saleRefusal, "Not enough to sell");
  equal(saleRefusal.inventory.gold, 5, "a refused sale changes no gold");
  equal(saleRefusal.inventory.items.find((item) => item.source === stock[0])?.quantity, 1, "a refused sale keeps the stack");

  // Sell it for real: amount 1.
  press(session, "UP");
  const sold = press(session, "ENTER");
  equal(sold.inventory.gold, 10, "the inventory owner credited the item's sell price once");
  equal(sold.inventory.items.find((item) => item.source === stock[0]), undefined, "the emptied stack is retired");
  showing(sold, "Sold Stock Potion x 1");
  showing(sold, "Gold 10");

  // Buy refusal: 10 GP cannot cover two potions.
  press(session, "ENTER");
  press(session, "ENTER");
  press(session, "DOWN");
  const buyRefusal = press(session, "ENTER");
  showing(buyRefusal, "Not enough gold");
  equal(buyRefusal.inventory.gold, 10, "a refused purchase changes no gold");
  equal(buyRefusal.inventory.items.find((item) => item.source === stock[0]), undefined, "a refused purchase adds nothing");
  press(session, "ESC");
  showing(press(session, "ESC"), "Buy 20 / Sell 8");

  // The pointer and the pad reach the same rows as the keyboard (menu navigation ruling).
  const pressed = pointer(session, 100, 84, 1);
  equal(shopFrame(pressed)?.selection, 1, "a press over the second row moves the cursor to it");
  showing(pressed, "Buy 20 / Sell 8");
  const released = pointer(session, 100, 84, 0);
  equal(shopFrame(released)?.selection, 0, "the release activates the pressed row's own screen");
  showing(released, "Stock Tonic");
  showing(released, "20 GP each");
  const padded = pad(session, 2);
  equal(shopFrame(padded)?.selection, 1, "the pad's down action moves the same cursor");
  showing(padded, "8 GP each");
  press(session, "ESC");
  equal(shopFrame(session.state())?.selection, 1, "cancel returns to the stock list with its cursor");
  showing(session.state(), "Stock Tonic");

  // Close: cancel on the stock list clears the session and the CallShop caller resumes at its next instruction.
  const closed = press(session, "ESC");
  equal(shopFrame(closed), undefined, "closing the shop leaves no menu frame");
  equal((closed.vm.globals as Record<string, unknown>).after, 1, "the parked CallShop script resumed and ran its next line");
  equal(closed.inventory.gold, 10, "closing changes no gold");
  deepEqual(session.diagnostics, [], "the whole session ran without diagnostics");
});

test("RPGCode Inn restores active party members including fallen members without charging gold", () => {
  const session = bootHost({ game: authoredGame({ allies: 1, startup: "end()\n" }), catalogue, width: 320, height: 240,
    startup: 'givegp(37)\naddplayer("ally1.tem")\nhp("Hero", 0)\ninn()\n' });
  const state = session.pump((current) => current.vm.threads.every((thread) => thread.status === "finished" || thread.kind !== "blocking"));
  equal(state.inventory.gold, 37);
  equal(state.party.members.length, 2);
  for (const id of state.party.members) {
    const actor = state.actors.actors.find((candidate) => candidate.id === id);
    ok(actor, `party actor ${id} exists`);
    equal(actor.stats.hp, actor.stats.maxHp);
    equal(actor.stats.smp, actor.stats.maxSmp);
  }
  deepEqual(session.diagnostics, []);
});


test("opening a stock menu frame does not freeze the party section: a later walk counts one step", () => {
  // Regression for the menu owner publishing a frozen copy instead of freezing the live section: the movement
  // accumulator writes the party section after any menu has opened (docs/spec/engine/plugins-and-battle.md#e-80,
  // docs/spec/engine/movement-and-collision.md#reawakened-party-steps).
  const session = bootHost({ game: gameWithShopItems(), catalogue, width: 320, height: 240, startup: "end()\n" });
  const opened = press(session, "M");
  equal(opened.menu.screens[0]?.screen, "main", "the menu key opened the stock main screen");
  const closed = press(session, "ESC");
  equal(closed.menu.screens.length, 0, "cancel closed the menu");
  const start = session.state().time.tick;
  session.advance(1, [{ tick: start, event: { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true } }]);
  session.advance(1, [{ tick: start + 1, event: { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false } }]);
  for (let step = 0; step < 20 && session.state().party.steps < 1; step += 1) session.advance(2);
  const walked = session.state();
  equal(walked.party.steps, 1, "one completed 32-pixel tile is exactly one step");
  equal(walked.party.stepRemainder, 0, "a whole-tile move leaves no sub-tile remainder");
  deepEqual(session.diagnostics, [], "the walk after a menu ran without a diagnostics entry");
});
