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
  readonly pixelStep: number;
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
      inputPhaseRegistration({ pixelMovement: options.pixelMovement, pixelStep: options.pixelStep }),
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
  const rig = makeRig({ pixelMovement: 0, pixelStep: 32 });
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

test("four 8-pixel pixel-push advances complete exactly one party step", () => {
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8 });
  for (let count = 1; count <= 3; count += 1) {
    rig.move(["ArrowRight"]);
    equal(rig.state.party.steps, 0, `after ${count} completed 8-pixel moves`);
    equal(rig.state.party.stepRemainder, (count * 8) * 256, `after ${count} completed 8-pixel moves`);
  }
  rig.move(["ArrowRight"]);
  equal(rig.player().x, 80);
  equal(rig.state.party.steps, 1, "four completed 8-pixel moves make one party step");
  equal(rig.state.party.stepRemainder, 0);
});

test("one-pixel movement crosses the boundary only after the 32nd completed move", () => {
  const rig = makeRig({ pixelMovement: 2, pixelStep: 1 });
  for (let count = 1; count <= 31; count += 1) {
    rig.move(["ArrowRight"]);
    equal(rig.state.party.steps, 0, `after ${count} one-pixel moves`);
  }
  equal(rig.state.party.stepRemainder, 31 * 256, "31 pixels are held in the remainder");
  rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 1);
  equal(rig.state.party.stepRemainder, 0);
});

test("a diagonal move counts its distance travelled, not its larger axis", () => {
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8, allowDiagonals: true });
  rig.move(["ArrowRight", "ArrowDown"]);
  equal(rig.player().x, 56);
  equal(rig.player().y, 71);
  // sqrt(8^2 + 8^2) = 11.3137 px = 2896 units of 1/256 px: the Euclidean distance travelled,
  // not the larger axis (8 px = 2048 units).
  equal(rig.state.party.stepRemainder, 2896, "an 8-by-8 move contributes its Euclidean length");
  for (let index = 0; index < 3; index += 1) rig.move(["ArrowRight", "ArrowDown"]);
  equal(rig.state.party.steps, 1, "four 8-by-8 moves pass 32 px of travel");
  equal(rig.state.party.stepRemainder, 4 * 2896 - TILE, "the excess of 45.25 px stays in the remainder");
});

test("completed movement by another party member does not advance party steps", () => {
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8 });
  enqueueDirectionMove(rig.state.sprites, "other", "E", 1, 8);
  for (let tick = 0; tick < 12; tick += 1) rig.engine.advance(1, []);
  equal(rig.player("other").x, 248);
  equal(rig.state.party.steps, 0, "only the currently selected party member contributes");
  equal(rig.state.party.stepRemainder, 0);
});

test("a blocked move contributes no distance, not even its partial advance", () => {
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8, wall: { left: 76, right: 84 } });
  rig.move(["ArrowRight"]);
  equal(rig.player().x, 56);
  equal(rig.state.party.stepRemainder, 8 * 256);
  const stepsBefore = rig.state.party.steps;
  const remainderBefore = rig.state.party.stepRemainder;
  rig.events.length = 0;

  rig.move(["ArrowRight"]);
  ok(rig.events.some((event) => event.type === "blocked" && event.vector === "wall"), "the second move hit the wall");
  ok(
    !rig.events.some((event) => event.type === "step-complete"),
    "a blocked step reports no completion at all, so nothing can reach the counter",
  );
  equal(rig.player().x, 60, "the blocked 8 px move retained its 4 px partial advance");
  equal(rig.state.party.steps, stepsBefore, "the blocked move does not increment the counter");
  equal(
    rig.state.party.stepRemainder,
    remainderBefore,
    "the blocked move discards every unit of its partial displacement",
  );
});

test("a wall slide that completes the move contributes its displacement", () => {
  // Start (48, 63) moving SE 8 px: the first advance is free, the second hits the wall at x = 70, so the
  // step slides south to (53.65625, 72.65625) and passes the (56, 71) target: sqrt(5.65625^2 + 9.65625^2)
  // = 11.1909 px = 2865 units.
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8, allowDiagonals: true, wall: { left: 70, right: 78 } });
  rig.move(["ArrowRight", "ArrowDown"]);
  ok(!rig.events.some((event) => event.type === "blocked"), "the move never ends blocked: it slides and completes");
  equal(rig.player().x, 53.65625, "the slide stopped the eastward advance short of the 56 px target");
  equal(rig.player().y, 72.65625, "the slide carried the player past the 71 px target");
  const completions = rig.events.filter((event) => event.type === "step-complete");
  deepEqual(completions.map((event) => event.partyDistance256), [2865], "the slide completes as a successful step");
  equal(rig.state.party.steps, 0);
  equal(rig.state.party.stepRemainder, 2865, "the completed slide's distance is in the remainder");
});

test("the counter follows the input-selected sprite, not the party's roster selection", () => {
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8 });
  const other = rig.state.party.members[1]!;
  // A script may select another party member without moving the sprite selection; the walked sprite still walks.
  rig.state.party.selected = other;
  equal(rig.state.sprites.selectedPlayer, "hero", "the input layer still drives hero");
  for (let index = 0; index < 4; index += 1) rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 1, "the sprite the input drives is the one the counter follows");
  equal(rig.state.party.selected, other, "the roster selection is not rewritten by walking");

  rig.state.party.selected = rig.state.party.members[0]!;
  enqueueDirectionMove(rig.state.sprites, "other", "E", 1, 8);
  for (let tick = 0; tick < 12; tick += 1) rig.engine.advance(1, []);
  equal(rig.state.party.steps, 1, "a sprite the input does not drive contributes nothing even while its actor is selected");
});

test("the interruption-recovery ledger carries the sub-tile remainder", () => {
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8 });
  rig.move(["ArrowRight"]);
  rig.move(["ArrowRight"]);
  rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 0);
  equal(rig.state.party.stepRemainder, 24 * 256);

  const ledger = projectGameLedger(rig.state);
  equal(ledger.party.steps, 0);
  equal(ledger.party.stepRemainder, 24 * 256, "the ledger projection carries the remainder");
  const target = createGameState({ seed: 3 });
  applyRecoveryLedger(target, ledger);
  equal(target.party.steps, 0);
  equal(target.party.stepRemainder, 24 * 256, "a recovered game keeps the accumulation");
});

test("an RPGCode menu provider reads the movement counter from context.party.steps", () => {
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8 });
  for (let index = 0; index < 4; index += 1) rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 1, "four 8-pixel moves made one step");

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
  const rig = makeRig({ pixelMovement: 1, pixelStep: 8 });
  for (let index = 0; index < 3; index += 1) rig.move(["ArrowRight"]);
  equal(rig.state.party.steps, 0, "24 px are accumulated without a completed tile");
  equal(rig.state.party.stepRemainder, 24 * 256);
  // Queue the fourth 8-pixel move and take one 4-pixel advance: it is half done (x = 76 of 80) when saved.
  rig.engine.advance(1, [rig.key("ArrowRight", true)]);
  rig.engine.advance(1, []);
  rig.engine.advance(1, []);
  equal(rig.player().x, 76);
  ok(rig.player().movement.active !== null, "the fourth move is only partway complete");

  // The canonical save contract the engine's Save/Load use (engine.ts imports both of these).
  const text = snapshotGameSave(rig.state);
  const encoded = JSON.parse(text) as {
    party?: { steps?: number; stepRemainder?: number };
    sprites?: { players?: { id: string; x: number; movement: { active: unknown } }[] };
  };
  equal(encoded.party?.steps, 0, "the completed count is saved");
  equal(encoded.party?.stepRemainder, 24 * 256, "the save carries the mid-accumulation remainder");
  const savedPlayer = encoded.sprites?.players?.find(({ id }) => id === "hero");
  equal(savedPlayer?.x, 76);
  ok(savedPlayer?.movement.active !== null, "the save was taken with a movement step still in progress");

  const restored = restoreGameSave(text, rig.state.audio).state;
  equal(restored.party.steps, 0);
  equal(restored.party.stepRemainder, 24 * 256, "Load restored the unfinished remainder");
  equal(restored.sprites.players.find(({ id }) => id === "hero")?.x, 76, "Load restored the half-finished move");
  equal(snapshotGameSave(restored), text, "the restored save re-serialises to the same bytes");

  // The board arrives through the asset provider, not the save; hand the board back the way the engine does,
  // then finish the fourth move: 24 px saved + 8 px travelled is exactly one 32-pixel step.
  restored.world = { board: rig.board };
  const phase = movementPhaseRegistration({ pixelMovement: 1 });
  for (let tick = 0; tick < 40 && (restored.sprites.players.find(({ id }) => id === "hero")?.movement.active ?? null) !== null; tick += 1) {
    restored.time.tick += 1;
    phase.run(restored);
  }
  const hero = restored.sprites.players.find(({ id }) => id === "hero")!;
  equal(hero.x, 80, "the restored half-finished move completes");
  equal(restored.party.steps, 1, "the restored remainder plus the rest of the move completes one step");
  equal(restored.party.stepRemainder, 0);
});
