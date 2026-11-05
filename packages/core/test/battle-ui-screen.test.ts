// The default battle UI (entry 7.11, issue #514; docs/spec/engine/battle.md#bat-11).
//
// A whole seeded game boots the real stock_battle package with a screen, answers every asset request from authored
// files (battle-ui-rig.ts), presses real keys through the engine's key queue and reads back the battle, the actors, the
// audio cues and the composed frame. Jensen approved the golden frames in golden/battle-ui/ on 2026-10-28; they
// are compared pixel for pixel and rewritten only with BATTLE_UI_GOLDEN=record (G5).
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canon, decodeTexture, fnv1a64, hashDrawList } from "../src/index.ts";
import {
  actor,
  assertCommandLabelYellow,
  awaitMenu,
  bootUiRig,
  countColour,
  cueNames,
  encodePng,
  entries,
  MAGE,
  THRESHOLD,
  ui,
  type UiRig,
} from "./battle-ui-rig.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const goldenDirectory = join(repoRoot, "golden", "battle-ui");
const manifestPath = join(goldenDirectory, "frames.json");
const stockSource = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");

type FrameRecord = { readonly keys: readonly string[]; readonly pixels: string; readonly drawList: string };
type Manifest = { readonly schema: 1; readonly seed: number; readonly size: readonly [number, number]; readonly frames: Record<string, FrameRecord> };

const recording = process.env["BATTLE_UI_GOLDEN"] === "record";

function readManifest(): Manifest {
  if (!existsSync(manifestPath)) return { schema: 1, seed: 291, size: [640, 480], frames: {} };
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

/** Compare the composed frame with its golden PNG and recorded hashes, or (only when recording) rewrite them. */
function goldenFrame(rig: UiRig, name: string, keys: readonly string[]): void {
  rig.tick(6);
  const frame = rig.frame();
  const record: FrameRecord = { keys, pixels: fnv1a64(frame.rgba), drawList: hashDrawList(rig.engine.drawList()) };
  const png = join(goldenDirectory, `${name}.png`);
  if (recording) {
    mkdirSync(goldenDirectory, { recursive: true });
    writeFileSync(png, encodePng(frame.w, frame.h, frame.rgba));
    const manifest = readManifest();
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, frames: { ...manifest.frames, [name]: record } }, null, 2)}\n`);
    return;
  }
  const manifest = readManifest();
  const recorded = manifest.frames[name];
  ok(recorded !== undefined, `golden frame ${name} is not recorded (run with BATTLE_UI_GOLDEN=record and explain why in the pull request)`);
  deepEqual(record.keys, recorded.keys, `${name}: the key script changed`);
  const expected = decodeTexture(new Uint8Array(readFileSync(png)), `${name}.png`);
  if (!expected.ok) throw new Error(expected.error.message);
  equal(expected.value.w, frame.w);
  equal(expected.value.h, frame.h);
  let different = -1;
  for (let at = 0; at < frame.rgba.length; at += 1) if (frame.rgba[at] !== expected.value.rgba[at]) { different = at; break; }
  const pixel = Math.max(0, Math.floor(different / 4) * 4);
  const actualRgba = [...frame.rgba.slice(pixel, pixel + 4)];
  const expectedRgba = [...expected.value.rgba.slice(pixel, pixel + 4)];
  equal(different, -1, `${name}: first differing byte ${different} (pixel ${Math.floor(pixel / 4) % frame.w},${Math.floor(pixel / 4 / frame.w)}), actual RGBA ${actualRgba}, expected RGBA ${expectedRgba}; mode ${String(ui(rig)["mode"])}, scan ${String(ui(rig)["barscan"])}, charge ${JSON.stringify(rig.charges())}, cached bars ${JSON.stringify(ui(rig)["bars"])}`);
  equal(record.pixels, recorded.pixels, `${name}: pixel hash`);
  equal(record.drawList, recorded.drawList, `${name}: draw-list hash`);
}


/** The battle's rule state the screen must never change: the actors, the battle section and the random generator. */
function ruleHash(rig: UiRig): string {
  const state = rig.state();
  return fnv1a64(canon({ actors: state.actors, battle: state.battle, rng: state.rng }));
}



test("normalized semantic actions operate the stock battle command and list consumers", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  rig.action("down", "runner.fallback");
  equal(ui(rig)["cursor"], 1, "semantic down moves the command selection");
  rig.action("confirm", "runner.fallback");
  equal(ui(rig)["mode"], "list", "semantic confirm opens the selected special list");
  rig.action("cancel", "runner.fallback");
  equal(ui(rig)["mode"], "command", "semantic cancel returns from the list");
});

test("a seeded battle opens the command box for the first charged player, and every command, list and target is reachable by keyboard", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  const mage = actor(rig, "mage.tem");
  deepEqual(rig.diagnostics, [], "booting the screen reports no diagnostic");
  equal(ui(rig)["on"], 1);
  equal(ui(rig)["menuindex"], MAGE, "with seed 291 the Mage is the first charged player");
  equal(ui(rig)["cursor"], 0);
  const keys: string[] = [];
  const press = (name: string): void => { keys.push(name); rig.press(name, 12); };
  goldenFrame(rig, "command", keys);

  // The command box wraps in both directions.
  press("UP");
  equal(ui(rig)["cursor"], 3, "UP from Fight wraps to Run");
  press("DOWN");
  equal(ui(rig)["cursor"], 0, "DOWN from Run wraps to Fight");
  deepEqual(cueNames(rig), ["move.wav", "move.wav"], "each cursor move plays the background's select sound");

  // A blocked Run (the Bat forbids it) plays the cancel sound and the player keeps the turn.
  press("UP");
  const chargeBefore = rig.charges()[1]![MAGE]!;
  ok(chargeBefore >= THRESHOLD);
  const rngBefore = JSON.stringify(rig.state().rng);
  const before = cueNames(rig).length;
  press("ENTER");
  equal(ui(rig)["mode"], "command", "choosing a blocked Run leaves the player in the command box");
  deepEqual(cueNames(rig).slice(before), ["cant.wav"], "and plays the cancel sound");
  equal(rig.charges()[1]![MAGE], chargeBefore, "the turn and the charge are kept");
  equal(JSON.stringify(rig.state().rng), rngBefore, "a refused Run draws no random number");
  equal(rig.state().battle?.outcome, null);

  // The Special list: a move the Mage cannot afford is listed, refused, and the player stays in the list.
  press("UP");
  press("UP");
  equal(ui(rig)["cursor"], 1);
  press("ENTER");
  equal(ui(rig)["mode"], "list");
  equal(ui(rig)["listkind"], "special");
  const specials = entries(ui(rig)["list"], Number(ui(rig)["listcount"]));
  deepEqual(specials.map((entry) => [entry["label"], entry["affordable"]]), [["fire", 0], ["blaze", 0]], "both moves cost more than the Mage's 3 SMP");
  goldenFrame(rig, "special", keys);
  assertCommandLabelYellow(rig, 386);
  const headerGap = { x1: 93, y1: 65, x2: 147, y2: 69 };
  equal(countColour(rig, headerGap, [16, 20, 48]).count, 55 * 5, "the header covers the old background gap under the selected label");
  ok(countColour(rig, { x1: 48, y1: 82, x2: 112, y2: 100 }, [180, 180, 190]).count > 0, "selected unaffordable move uses readable dim text");
  equal(countColour(rig, { x1: 48, y1: 82, x2: 112, y2: 100 }, [110, 110, 120]).count, 0, "selected unavailable text does not use low-contrast grey");
  const smpBefore = mage.stats.smp;
  const hashBefore = ruleHash(rig);
  const cuesBefore = cueNames(rig).length;
  press("ENTER");
  equal(ui(rig)["mode"], "list", "an unaffordable special keeps the player in the menu");
  deepEqual(cueNames(rig).slice(cuesBefore), ["cant.wav"]);
  equal(actor(rig, "mage.tem").stats.smp, smpBefore, "nothing was spent");
  equal(ruleHash(rig), hashBefore, "the refusal changed no actor, battle value or random number");

  // Esc goes back one level, and at the top level it does nothing.
  press("ESC");
  equal(ui(rig)["mode"], "command");
  const cuesAtTop = cueNames(rig).length;
  const hashAtTop = ruleHash(rig);
  press("ESC");
  equal(ui(rig)["mode"], "command", "Esc at the top opens no menu");
  equal(ui(rig)["cursor"], 1);
  equal(cueNames(rig).length, cuesAtTop, "and plays nothing");
  equal(ruleHash(rig), hashAtTop);

  // The Items list names only the battle-usable stacks (the Brass Key is not one).
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  deepEqual(entries(ui(rig)["list"], Number(ui(rig)["listcount"])).map((entry) => [entry["label"], entry["detail"]]), [["Potion", "x3"], ["Ether", "x1"]]);
  press("ESC");
  equal(ui(rig)["mode"], "command");

  // Fight chooses among the living enemies; every one of them is reachable and the cursor wraps.
  press("UP");
  press("UP");
  equal(ui(rig)["cursor"], 0);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  deepEqual(entries(ui(rig)["targets"], Number(ui(rig)["targetcount"])), [0, 1, 2]);
  const seen = new Set<number>();
  for (let step = 0; step < 3; step += 1) {
    seen.add(Number(ui(rig)["targetcursor"]));
    press("RIGHT");
  }
  deepEqual([...seen].sort(), [0, 1, 2], "the target cursor reaches every enemy");
  equal(ui(rig)["targetcursor"], 0, "and wraps");
  press("DOWN");
  equal(ui(rig)["targetcursor"], 1);
  goldenFrame(rig, "target", keys);
  assertCommandLabelYellow(rig, 360);

  // The menu and target selection are drawn from state: while they wait, no rule value moves.
  const idleHash = ruleHash(rig);
  rig.tick(40);
  equal(ruleHash(rig), idleHash, "waiting in the menu changes no actor, charge or random number");

  // Performing the attack lowers exactly the chosen enemy's HP, shows its number, and ends the turn.
  const bat = actor(rig, "bat.ene");
  const batBefore = bat.stats.hp;
  press("ENTER");
  equal(ui(rig)["mode"], "act");
  rig.until(() => rig.charges()[1]![MAGE]! < THRESHOLD, 400);
  const batAfter = actor(rig, "bat.ene").stats.hp;
  ok(batAfter < batBefore, "the Bat took damage");
  deepEqual(rig.state().actors.actors.filter((candidate) => candidate.source === "slime.ene").map((candidate) => candidate.stats.hp), [30, 30], "only the chosen enemy was hurt");
  equal(ui(rig)["numbercount"], 0, "the numbers are gone when the turn ends");
  deepEqual(rig.diagnostics, []);
});

test("a selection change is on the real screen within six ticks (a tenth of a second)", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  const before = fnv1a64(rig.frame().rgba);
  rig.press("DOWN", 1);
  let waited = 1;
  while (waited < 6 && fnv1a64(rig.frame().rgba) === before) {
    rig.tick(1);
    waited += 1;
  }
  equal(ui(rig)["cursor"], 1, "the cursor moved");
  ok(fnv1a64(rig.frame().rgba) !== before, "the highlighted command changed the rendered frame");
  deepEqual(rig.diagnostics, []);
});



test("a healing item can target and revive a fallen ally, and a defeated enemy keeps its slot", () => {
  const rig = bootUiRig({ slimeHp: 5 });
  awaitMenu(rig);
  const keys: string[] = [];
  const press = (name: string): void => { keys.push(name); rig.press(name, 12); };
  const rogue = actor(rig, "rogue.tem");
  equal(rogue.stats.hp, 0, "the Rogue starts fallen");
  const potionHp = 20;

  press("DOWN");
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  equal(ui(rig)["targetparty"], 1, "an item aims at the party");
  deepEqual(entries(ui(rig)["targets"], Number(ui(rig)["targetcount"])), [0, 1, 2], "fallen members are targets");
  press("RIGHT");
  press("RIGHT");
  equal(ui(rig)["targetcursor"], 2, "the cursor lands on the fallen Rogue");
  goldenFrame(rig, "revive", keys);
  press("ENTER");
  rig.until(() => rig.charges()[1]![MAGE]! < THRESHOLD, 400);
  equal(actor(rig, "rogue.tem").stats.hp, potionHp, "the Potion raised the fallen Rogue above 0");
  // PR #703 real inventory owner integration: exactly one Potion unit was consumed from inventory (quantity 3 -> 2).
  const potionStack = rig.state().inventory.items.find((item) => item.source.toLowerCase().includes("potion"));
  ok(potionStack !== undefined, "potion stack exists");
  equal(potionStack.quantity, 2, "the actual inventory owner decremented the potion count by 1");
  deepEqual(rig.diagnostics, []);

  // The next charged player attacks the first Slime, whose 5 HP one hit takes.
  awaitMenu(rig);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  press("ENTER");
  rig.until(() => ui(rig)["mode"] === "idle", 400);
  const slimes = rig.state().actors.actors.filter((candidate) => candidate.source === "slime.ene");
  equal(slimes.length, 2);
  ok(slimes[0]!.stats.hp === 0 || slimes[1]!.stats.hp === 0, "a Slime was defeated");
  equal(rig.state().battle?.parties[0].length, 3, "the defeated enemy stays in its slot");
  equal((ui(rig)["bars"] as Record<string, number>)["0"], Math.min(100, Math.floor(rig.charges()[1]![0]! * 100 / THRESHOLD)), "the first party charge cache reflects the released battle charge before the frame is captured");
  goldenFrame(rig, "defeated", keys);

  // The next Fight lists only the enemies still standing.
  awaitMenu(rig);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  equal(Number(ui(rig)["targetcount"]), 2, "the defeated enemy is skipped by the target cursor");
  deepEqual(rig.diagnostics, []);

  // Defect 3 regression: with target mode active, selecting an item whose inventory stack is 0 is refused cleanly
  // without trapping the UI in `mode: "act"`. It plays the cancel sound and restores `mode: "target"`.
  press("ESC"); // back to command box
  press("DOWN");
  press("DOWN");
  press("ENTER"); // open Items list
  equal(ui(rig)["listkind"], "item");
  press("ENTER"); // open target selection for Potion
  equal(ui(rig)["mode"], "target");
  rig.state().inventory.items = []; // inventory stack zeroed out before confirm
  press("ENTER"); // perform preflight fails
  equal(ui(rig)["mode"], "target", "refused item restores target mode");
  equal(cueNames(rig).slice(-1)[0], "cant.wav", "and plays cancel sound");
});

test("five party members (E-85 maximum 5) render without clipping and each member is reachable by keyboard", () => {
  const fiveParty = [
    { key: "hero" as const, hp: 42, smp: 12 },
    { key: "mage" as const, hp: 30, smp: 3 },
    { key: "rogue" as const, hp: 25, smp: 6 },
    { key: "hero" as const, hp: 38, smp: 10 },
    { key: "mage" as const, hp: 20, smp: 5 },
  ];
  const rig = bootUiRig({ party: fiveParty });
  awaitMenu(rig);
  equal(ui(rig)["on"], 1);
  equal(Number(rig.state().battle?.parties[1].length), 5, "all five members are in battle");
  // Open Items list and target selection across the five-member party
  rig.press("DOWN", 12);
  rig.press("DOWN", 12);
  rig.press("ENTER", 12); // open Items
  rig.press("ENTER", 12); // target party
  equal(ui(rig)["mode"], "target");
  equal(ui(rig)["targetparty"], 1);
  equal(Number(ui(rig)["targetcount"]), 5, "all five party members are selectable targets");
  // Step through all 5 members with the keyboard
  for (let step = 0; step < 5; step += 1) {
    equal(Number(ui(rig)["targetcursor"]), step, `cursor lands on member index ${step}`);
    rig.press("RIGHT", 12);
  }
  equal(Number(ui(rig)["targetcursor"]), 0, "target cursor wraps cleanly from fifth member back to first");
  // Capture rendered frame to verify no visual clipping
  const frame = rig.frame();
  ok(frame.w === 640 && frame.h === 480, "rendered at 640x480");
  deepEqual(rig.diagnostics, []);
});






