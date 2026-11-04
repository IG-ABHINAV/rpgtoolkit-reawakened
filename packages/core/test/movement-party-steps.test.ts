// Party steps (#1231): docs/spec/engine/movement-and-collision.md#reawakened-party-steps.
// A step is 32 board pixels of completed travel by the selected player. Every completed move
// contributes its straight-line distance in 1/256 pixels, and the sub-tile part survives in
// `party.stepRemainder`, which is saved with the party section.
import { TextEncoder } from "node:util";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  advanceScriptTick,
  assetKey,
  CATALOGUE_PLUGIN,
  CORE_PLUGIN,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  createGameState,
  createScriptServices,
  enqueueDirectionMove,
  fileProgramRef,
  hydrateSprites,
  inputPhaseRegistration,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  projectGameLedger,
  restoreGameSave,
  snapshotGameSave,
  startProgram,
  UI_PLUGIN,
  writeBoard,
  type GameState,
  type InputRecord,
  type MovementEvent,
  type ProgramLoader,
  type WorldBoard,
} from "../src/index.ts";
import { applyRecoveryLedger } from "../src/engine/recovery.ts";

/** A wall segment: `left` and `right` board pixels, spanning the board vertically. */
type Wall = { readonly left: number; readonly right: number };

type Options = {
  readonly pixelMovement: 0 | 1 | 2;
  readonly allowDiagonals?: boolean;
  readonly wall?: Wall;
};

const TILE = 32 * 256;

/** An RPGCode menu provider that reads the script-facing party view (plugins-and-battle.md#e-80). */
const PROVIDER_PROGRAM = `registerPlugin({ name: "rpg-steps", commands: {}, menuProviders: { main: (context) => {
  stepsSeen = context.party.steps
  selectedSeen = context.party.selected
} } })
mainmenu()
end()
`;

function makeRig(options: Options) {
  const authored = writeBoard(createEmptyBoard());
  if (!authored.ok) throw new Error(authored.error.message);
  let state: GameState | undefined;
  let world: WorldBoard | undefined;
  let seeded = false;
  const events: MovementEvent[] = [];
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 320,
    height: 240,
    maxTicks: 2000,
    input: {
      bindings: { keys: { ArrowRight: "right", ArrowDown: "down" } },
      allowDiagonals: options.allowDiagonals ?? false,
    },
    phaseRegistrations: [
      { phase: "input", rank: -1, run: (current) => {
        if (seeded) return;
        const base = current.world.board!;
        const wall = options.wall;
        const vectors = wall === undefined ? [] : [{
          handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1,
          points: [{ x: wall.left, y: 32 }, { x: wall.right, y: 32 }, { x: wall.right, y: 200 }, { x: wall.left, y: 200 }],
        }];
        const board = { ...base, key: assetKey("boards/test.brd"), width: 320, height: 240, sizeX: 10, sizeY: 8, sizeL: 1, vectors } as unknown as WorldBoard;
        current.world = { board };
        world = board;
        const hero = addActor(current.actors, { kind: "party", source: "hero.tem", name: "Hero" });
        const other = addActor(current.actors, { kind: "party", source: "other.tem", name: "Other" });
        current.sprites = hydrateSprites({
          board,
          players: [
            { id: "hero", actorId: hero.id, kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, facing: "S", controlled: true },
            { id: "other", actorId: other.id, kind: "player", source: "other.tem", x: 240, y: 160, layer: 1, facing: "S", controlled: false },
          ],
        });
        current.party.members = [hero.id, other.id];
        current.party.selected = hero.id;
        state = current;
        seeded = true;
      } },
      inputPhaseRegistration({ pixelMovement: options.pixelMovement }),
      movementPhaseRegistration({ pixelMovement: options.pixelMovement, onEvent: (event) => events.push(event) }),
    ],
  });
  const boardRequest = engine.advance(0, []).requests[0];
  if (boardRequest?.kind !== "asset") throw new Error("expected board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: authored.value } }]);
  engine.advance(1, []);
  if (state === undefined) throw new Error("engine did not initialize party movement state");
  const key = (code: "ArrowRight" | "ArrowDown", down: boolean): InputRecord => ({
    tick: state!.time.tick,
    event: { kind: "key", name: code.slice("Arrow".length).toUpperCase(), code, char: null, down },
  });
  /** Press and release the keys, then let the queued move finish. */
  const move = (codes: readonly ("ArrowRight" | "ArrowDown")[]) => {
    engine.advance(1, codes.map((code) => key(code, true)));
    engine.advance(1, codes.map((code) => key(code, false)));
    engine.advance(30, []);
  };
  const player = (id = "hero") => state!.sprites.players.find((candidate) => candidate.id === id)!;
  if (world === undefined) throw new Error("engine did not install the movement board");
  return { board: world, engine, events, key, move, player, state };
}

test("each completed tile move counts one party step", () => {
  const rig = makeRig({ pixelMovement: 0 });
  equal(rig.state.party.steps, 0);

  rig.move(["ArrowRight"]);
  equal(rig.player().x, 80, "one 32-pixel step reaches the next tile");
  equal(rig.state.party.steps, 1);
  equal(rig.state.party.stepRemainder, 0, "a whole tile leaves no remainder");

  rig.move(["ArrowRight"]);
  equal(rig.player().x, 112);
  equal(rig.state.party.steps, 2, "two tile steps count two");
  equal(rig.state.party.stepRemainder, 0);
});

test("eight 4-pixel moves complete exactly one party step", () => {
  // R-62: a pixel-mode step is 4 px, so eight of them make the 32 px of one party step.
  const rig = makeRig({ pixelMovement: 1 });
  for (let count = 1; count <= 7; count += 1) {
    rig.move(["ArrowRight"]);
    equal(rig.state.party.steps, 0, `after ${count} completed 4-pixel moves`);
    equal(rig.state.party.stepRemainder, (count * 4) * 256, `after ${count} completed 4-pixel moves`);
  }
  rig.move(["ArrowRight"]);
  equal(rig.player().x, 80);
  equal(rig.state.party.steps, 1, "eight completed 4-pixel moves make one party step");
  equal(rig.state.party.stepRemainder, 0);
});

test("the two pixel modes walk alike, so they count alike", () => {
  // R-62: the main-file value sizes scripted pushes, not the player's step, so modes 1 and 2 move the
  // player identically and leave identical remainders.
  const mode1 = makeRig({ pixelMovement: 1 });
  const mode2 = makeRig({ pixelMovement: 2 });
  for (let count = 0; count < 7; count += 1) {
    mode1.move(["ArrowRight"]);
    mode2.move(["ArrowRight"]);
  }
  equal(mode1.player().x, mode2.player().x, "both modes reach the same pixel");
  equal(mode1.player().x, 76, "seven 4-pixel moves advance 28 px");
  equal(mode1.state.party.stepRemainder, 28 * 256);
  equal(mode2.state.party.stepRemainder, 28 * 256, "modes 1 and 2 hold the same remainder");
  mode1.move(["ArrowRight"]);
  mode2.move(["ArrowRight"]);
  equal(mode1.state.party.steps, 1);
  equal(mode2.state.party.steps, 1);
});

test("a diagonal move counts its distance travelled, not its larger axis", () => {
  const rig = makeRig({ pixelMovement: 1, allowDiagonals: true });
  rig.move(["ArrowRight", "ArrowDown"]);
  equal(rig.player().x, 52);
  equal(rig.player().y, 67);
  // sqrt(4^2 + 4^2) = 5.6569 px = 1448 units of 1/256 px: the Euclidean distance travelled,
  // not the larger axis (4 px = 1024 units).
  equal(rig.state.party.stepRemainder, 1448, "a 4-by-4 move contributes its Euclidean length");
  for (let index = 0; index < 7; index += 1) rig.move(["ArrowRight", "ArrowDown"]);
  equal(rig.state.party.steps, 1, "eight 4-by-4 moves pass 32 px of travel");
  equal(rig.state.party.stepRemainder, 8 * 1448 - TILE, "the excess of 45.25 px stays in the remainder");
});

test("completed movement by another party member does not advance party steps", () => {
  const rig = makeRig({ pixelMovement: 1 });
  enqueueDirectionMove(rig.state.sprites, "other", "E", 1);
  for (let tick = 0; tick < 12; tick += 1) rig.engine.advance(1, []);
  equal(rig.player("other").x, 244);
  equal(rig.state.party.steps, 0, "only the currently selected party member contributes");
  equal(rig.state.party.stepRemainder, 0);
});

test("a blocked move contributes no distance", () => {
  // The collision base reaches x = target + 15, so the wall at 76 first blocks the step whose target is 64.
  const rig = makeRig({ pixelMovement: 1, wall: { left: 76, right: 84 } });
  for (let index = 0; index < 3; index += 1) rig.move(["ArrowRight"]);
  equal(rig.player().x, 60, "three free 4-pixel moves");
  equal(rig.state.party.stepRemainder, 12 * 256);
  const stepsBefore = rig.state.party.steps;
  const remainderBefore = rig.state.party.stepRemainder;
  rig.events.length = 0;

  rig.move(["ArrowRight"]);
  ok(rig.events.some((event) => event.type === "blocked" && event.vector === "wall"), "the fourth move hit the wall");
  ok(
    !rig.events.some((event) => event.type === "step-complete"),
    "a blocked step reports no completion at all, so nothing can reach the counter",
  );
  equal(rig.player().x, 60, "a blocked 4-pixel step does not move at all: the step is its whole advance");
  equal(rig.state.party.steps, stepsBefore, "the blocked move does not increment the counter");
  equal(rig.state.party.stepRemainder, remainderBefore, "the blocked move contributes no distance");
});

test("a wall slide that completes the move contributes its displacement", () => {
  // Start (48, 63) moving SE 4 px: the target (52, 67) puts the base at x 37..67, on the wall at 64, so
  // the step slides south to (48, 67) — 4 px of travel, and the step completes there (R-54 item 3).
  const rig = makeRig({ pixelMovement: 1, allowDiagonals: true, wall: { left: 64, right: 72 } });
  rig.move(["ArrowRight", "ArrowDown"]);
  ok(!rig.events.some((event) => event.type === "blocked"), "the move never ends blocked: it slides and completes");
  equal(rig.player().x, 48, "the slide keeps x on the wall's clear side");
  equal(rig.player().y, 67, "the slide carries the player south by the whole step");
  const completions = rig.events.filter((event) => event.type === "step-complete");
  deepEqual(completions.map((event) => event.partyDistance256), [4 * 256], "the slide completes as a successful step");
  equal(rig.state.party.steps, 0);
  equal(rig.state.party.stepRemainder, 4 * 256, "the completed slide's distance is in the remainder");
});

test("the counter follows the input-selected sprite, not the party's roster selection", () => {
  const rig = makeRig({ pixelMovement: 1 });
  const other = rig.state.party.members[1]!;
  // A script may select another party member without moving the sprite selection; the walked sprite still walks.
  rig.state.party.selected = other;
  equal(rig.state.sprites.selectedPlayer, "hero", "the input layer still drives hero");
  for (let index = 0; index < 8; index += 1) rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 1, "the sprite the input drives is the one the counter follows");
  equal(rig.state.party.selected, other, "the roster selection is not rewritten by walking");

  rig.state.party.selected = rig.state.party.members[0]!;
  enqueueDirectionMove(rig.state.sprites, "other", "E", 1);
  for (let tick = 0; tick < 12; tick += 1) rig.engine.advance(1, []);
  equal(rig.state.party.steps, 1, "a sprite the input does not drive contributes nothing even while its actor is selected");
});

test("the interruption-recovery ledger carries the sub-tile remainder", () => {
  const rig = makeRig({ pixelMovement: 1 });
  for (let index = 0; index < 7; index += 1) rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 0);
  equal(rig.state.party.stepRemainder, 28 * 256);

  const ledger = projectGameLedger(rig.state);
  equal(ledger.party.steps, 0);
  equal(ledger.party.stepRemainder, 28 * 256, "the ledger projection carries the remainder");
  const target = createGameState({ seed: 3 });
  applyRecoveryLedger(target, ledger);
  equal(target.party.steps, 0);
  equal(target.party.stepRemainder, 28 * 256, "a recovered game keeps the accumulation");
});

test("an RPGCode menu provider reads the movement counter from context.party.steps", () => {
  const rig = makeRig({ pixelMovement: 1 });
  for (let index = 0; index < 8; index += 1) rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 1, "eight 4-pixel moves made one step");

  // `context.party` is the RPGCode-facing party view (plugins-and-battle.md#e-80), and `steps` is the
  // read-only member E-87 exposes to scripts.
  const bytes = new Map([[assetKey("Prg/read.prg"), new TextEncoder().encode(PROVIDER_PROGRAM)]]);
  const loader: ProgramLoader = {
    index: createAssetIndex(["Prg/read.prg"]),
    root: PACKAGE_ROOT,
    read: (key) => bytes.get(key),
  };
  const services = createScriptServices(
    rig.state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }],
    undefined,
    undefined,
    loader,
  );
  startProgram(rig.state.vm, fileProgramRef(loader, "read.prg"));
  for (let tick = 0; tick < 40 && rig.state.vm.threads.some((thread) => thread.status !== "finished"); tick += 1) {
    advanceScriptTick(rig.state, services);
  }
  equal(rig.state.vm.globals.stepsseen, 1, "the script read the same completed step as party.steps");
  equal(rig.state.vm.globals.selectedseen, rig.state.party.selected, "the view also names the selected member");
});

test("a save taken mid-accumulation restores the remainder and completes the same total", () => {
  const rig = makeRig({ pixelMovement: 1 });
  for (let index = 0; index < 7; index += 1) rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 0, "28 px are accumulated without a completed tile");
  equal(rig.state.party.stepRemainder, 28 * 256);
  // A scripted push still moves a whole tile in pixel movement (E-23), so it takes eight 4-pixel
  // advances and lets the save catch the move partway: queue it and take two advances (x = 84 of 108,
  // at the default 0.05 s speed that is three ticks per advance).
  enqueueDirectionMove(rig.state.sprites, "hero", "E", 0);
  for (let tick = 0; tick < 7; tick += 1) rig.engine.advance(1, []);
  equal(rig.player().x, 84);
  ok(rig.player().movement.active !== null, "the 32 px move is only partway complete");

  // The canonical save contract the engine's Save/Load use (engine.ts imports both of these).
  const text = snapshotGameSave(rig.state);
  const encoded = JSON.parse(text) as {
    party?: { steps?: number; stepRemainder?: number };
    sprites?: { players?: { id: string; x: number; movement: { active: unknown } }[] };
  };
  equal(encoded.party?.steps, 0, "the completed count is saved");
  equal(encoded.party?.stepRemainder, 28 * 256, "the save carries the mid-accumulation remainder");
  const savedPlayer = encoded.sprites?.players?.find(({ id }) => id === "hero");
  equal(savedPlayer?.x, 84);
  ok(savedPlayer?.movement.active !== null, "the save was taken with a movement step still in progress");

  const restored = restoreGameSave(text, rig.state.audio).state;
  equal(restored.party.steps, 0);
  equal(restored.party.stepRemainder, 28 * 256, "Load restored the unfinished remainder");
  equal(restored.sprites.players.find(({ id }) => id === "hero")?.x, 84, "Load restored the half-finished move");
  equal(snapshotGameSave(restored), text, "the restored save re-serialises to the same bytes");

  // The board arrives through the asset provider, not the save; hand the board back the way the engine does,
  // then finish the move: 28 px saved + the rest of the 32 px step is 60 px, one whole party step.
  restored.world = { board: rig.board };
  const phase = movementPhaseRegistration({ pixelMovement: 1 });
  for (let tick = 0; tick < 40 && (restored.sprites.players.find(({ id }) => id === "hero")?.movement.active ?? null) !== null; tick += 1) {
    restored.time.tick += 1;
    phase.run(restored);
  }
  const hero = restored.sprites.players.find(({ id }) => id === "hero")!;
  equal(hero.x, 108, "the restored half-finished move completes");
  equal(restored.party.steps, 1, "the restored remainder plus the rest of the move completes one step");
  equal(restored.party.stepRemainder, 28 * 256, "the 32 px step leaves 28 px of accumulated travel");
});
