import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  createActorService,
  createActorsSection,
  createBehaviourRegistry,
  createGameState,
  enqueueDirectionMove,
  createVmState,
  createSpritesSection,
  hydrateSprites,
  selectActor,
  linkedActor,
  registerPackageBehaviours,
  resolveBehaviour,
  restoreGameState,
  snapshot,
  setItemVisible,
  spriteDraws,
  runMovementPhase,
  type Diagnostic,
  type ResolvedPlugin,
  type WorldBoard,
  createSpriteRuntime,
  coordLayout,
  tileToPixel,
  boardPixelSize,
} from "../src/index.ts";

function board(): WorldBoard {
  return ({
    key: "boards/hall.brd",
    coordType: 0,
    sizeX: 10,
    sizeY: 10,
    sizeL: 1,
    width: 320,
    height: 320,
    background: { r: 0, g: 0, b: 0 },
    ambient: { r: 0, g: 0, b: 0 },
    layers: [],
    items: [
      { slot: 0, itemFile: "clerk", activationPrg: "", multitaskPrg: "clerk.prg", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 112, y: 63, layer: 1, reserved: 0 },
      { slot: 2, itemFile: "ghost", activationPrg: "", multitaskPrg: "ghost.prg", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "haunted", loadingValue: "1", activate: 0, activationType: 0, x: 176, y: 63, layer: 1, reserved: 0 },
    ],
  } as unknown) as WorldBoard;
}
test("party actor selection updates linked sprite control without reordering sprites", () => {
  const actors = createActorsSection();
  const one = addActor(actors, { kind: "party", source: "one.tem", name: "One" });
  const two = addActor(actors, { kind: "party", source: "two.tem", name: "Two" });
  const section = createSpritesSection();
  section.players = [
    { id: "sprite-one", actorId: one.id, index: 0, controlled: true },
    { id: "sprite-two", actorId: two.id, index: 1, controlled: false },
  ] as never;
  section.selectedPlayer = "sprite-one";
  const before = section.players.map((player) => player.id);
  equal(selectActor(section, two.id), true);
  deepEqual(section.players.map((player) => player.id), before);
  equal(section.selectedPlayer, "sprite-two");
  deepEqual(section.players.map((player) => player.controlled), [false, true]);
  equal(selectActor(section, null), true);
  equal(section.selectedPlayer, null);
  deepEqual(section.players.map((player) => player.controlled), [false, false]);
});
test("actor-backed board sprites link to actor behaviour dispatch without copying actor state", () => {
  const actors = createActorsSection();
  const npc = addActor(actors, {
    kind: "npc",
    source: "clerk",
    name: "Clerk",
    stats: { hp: 12, maxHp: 12, dp: 3 },
    behaviour: "npc-pack.guard",
  });
  const plugin: ResolvedPlugin = {
    namespace: "npc-pack",
    definition: {
      id: "npc-pack",
      version: "1.0.0",
      commands: [],
      behaviourStartup(register) {
        register("npc-pack.guard", { statsChanged: () => ({ dp: 9 }) });
      },
    },
  };
  const diagnostics: Diagnostic[] = [];
  const registry = createBehaviourRegistry(["npc-pack"], diagnostics);
  registerPackageBehaviours(registry, [plugin]);
  const service = createActorService(actors, (record) => resolveBehaviour(registry, record, diagnostics));
  const linked = hydrateSprites({
    board: board(),
    actors,
    players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }],
  });
  const sprite = linked.items[0];
  if (sprite === undefined || sprite.actorId === undefined || sprite.actorId === null) throw new Error("fixture NPC was not actor-backed");
  equal(sprite.actorId, npc.id);
  equal(linkedActor(actors, sprite)?.stats.hp, 12);
  equal("stats" in sprite, false);
  equal(service.updateStats(sprite.actorId, { hp: 11 }, { cause: "script" })?.actor.stats.dp, 9);
  equal(actors.actors[0]?.behaviour, "npc-pack.guard");
  const save = createGameState({ seed: 1 });
  save.actors = actors;
  save.sprites = linked;
  equal(restoreGameState(snapshot(save)).sprites.items[0]?.actorId, npc.id);
  addActor(actors, { kind: "npc", source: "clerk", name: "Other Clerk", stats: { hp: 8, maxHp: 8 } });
  const ambiguous = hydrateSprites({ board: board(), actors });
  equal(ambiguous.items[0]?.actorId, undefined);
  const selected = hydrateSprites({ board: board(), actors, actorIds: { clerk: npc.id } });
  equal(selected.items[0]?.actorId, npc.id);

  const plain = hydrateSprites({
    board: board(),
    players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }],
  });
  enqueueDirectionMove(linked, "hero", "E", 0);
  enqueueDirectionMove(plain, "hero", "E", 0);
  for (let tick = 0; tick < 24; tick += 1) {
    runMovementPhase(linked, board(), tick);
    runMovementPhase(plain, board(), tick);
  }
  deepEqual(
    linked.items.map(({ id, x, y, layer, state, facing }) => [id, x, y, layer, state, facing]),
    plain.items.map(({ id, x, y, layer, state, facing }) => [id, x, y, layer, state, facing]),
  );
});


test("hydrates compact actors, owns item threads, and keeps draw ids stable", () => {
  const vm = createVmState();
  const state = hydrateSprites({
    board: board(),
    variables: { haunted: 0 },
    players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }],
    vm,
    programRef: () => ({ kind: "inline", text: "end()\n", ir: "1" }),
  });
  equal(state.items.length, 2);
  equal(state.items[0]?.handle, 0);
  equal(state.items[1]?.handle, 1);
  equal(state.items[1]?.visible, false);
  equal(vm.threads.length, 1);
  deepEqual(spriteDraws(state).map((draw) => [draw.id, draw.drawId]), [["hero", 0], ["clerk", 1]]);
  setItemVisible(state, "ghost", true, vm, () => ({ kind: "inline", text: "end()\n", ir: "1" }));
  equal(vm.threads.length, 2);
  setItemVisible(state, "clerk", false, vm, null);
  equal(vm.threads.length, 1);
});

test("sprites survive snapshot restore with an equal canonical hash", () => {
  const game = createGameState({ seed: 7 });
  game.sprites = hydrateSprites({ board: board(), players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }] });
  const json = snapshot(game);
  equal(snapshot(restoreGameState(json)), json);
});

test("the effect applier converts tile placements through the effect's own coordType and sizeX", () => {
  // The engine posts the board's coordType and sizeX with tile placements; a host-side sprites runtime
  // consuming the effect must land the player on the same pixel for every layout.
  for (const [coordType, x, y] of [[0, 2, 2], [1, 4, 4], [2, 5, 3]] as const) {
    const layout = coordLayout(coordType);
    const world = {
      ...board(),
      coordType,
      sizeX: 32,
      sizeY: 32,
      width: boardPixelSize(layout, 32, 32).width,
      height: boardPixelSize(layout, 32, 32).height,
    } as WorldBoard;
    const runtime = createSpriteRuntime({ section: createSpritesSection() });
    runtime.hydrate({ board: world, players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }] });
    ok(runtime.applyEffect({ name: "placeplayer", args: [x, y, 1, "tile", coordType, 32] }), "the effect applied");
    deepEqual(
      { x: runtime.section.players[0]!.x, y: runtime.section.players[0]!.y },
      tileToPixel(layout, 32, x, y),
      `${layout}: the placed pixel`,
    );
    ok(runtime.applyEffect({ name: "placeplayer", args: [48, 63, 1, "pixel"] as never }), "a pixel effect applies as its own position");
    deepEqual({ x: runtime.section.players[0]!.x, y: runtime.section.players[0]!.y }, { x: 48, y: 63 }, `${layout}: a pixel placement is verbatim`);
  }
});
