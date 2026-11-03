/**
 * The one state tree (AD-10, AD-23; decisions Q2/Q3).
 *
 * `GameState` has exactly AD-10's 20 sections. Entry 2 owns four of them —
 * `schema` (here), `vm` (`core/script`), `rng` (`core/rng`) and `time`
 * (`core/time`); of the other sixteen, seven are real sections declared under
 * `save/sections/` (`world`, `camera`, `ui`, `fx`, `surfaces`, `input`,
 * `engine`), nine are owned by their modules (`sprites`, `actors`,
 * `triggers`, `audio`, `events`, `party`, `inventory`, `menu`, and `battle`).
 * `SchemaState` is AD-23's per-section version map plus the instruction version (`ir`).
 *
 * **The version rules (AD-7's check; owner ruling 2026-10-30).** A change to a
 * `*State` type bumps that section's version in `SCHEMA_VERSIONS`, plus a fixture
 * save from the previous version and a restore test over it. A change to `StepOp`,
 * the lowering or the emission order bumps `IR_VERSION` and the step-op
 * fingerprint instead; the per-section numbers are the migration chain's keys and
 * never carry instruction meaning
 * (docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling).
 *
 * AD-10 (the state tree), AD-11 (the canonical form) and AD-23 (per-section
 * versions); docs/spec/formats/save-game.md#layout-minor-4 (the saved game).
 */

import type { AssertPlainData } from "../ports/plain-data.ts";
import { seedRng, type RngState } from "../rng/xoshiro.ts";
import { IR_VERSION } from "../script/program.ts";
import { createVmState, type VmState } from "../script/state.ts";
import { createTimeState, type TimeState } from "../time/time.ts";
import {
  createCameraSection,
  createUiSection,
  createFxSection,
  type ActorsSection,
  type AudioSection,
  type BattleSection,
  type CameraSection,
  type EngineSection,
  type FxSection,
  type InputSection,
  type InventorySection,
  type MenuSection,
  type PartySection,
  type SpritesSection,
  type SurfacesSection,
  type TriggersSection,
  type UiSection,
  type WorldSection,
} from "./sections.ts";
import { createTriggersSection } from "../triggers/model.ts";
import { createSpritesSection } from "../sprites/model.ts";
import { createActorsSection } from "../actors/model.ts";
import { createInputSection } from "../input/input.ts";
import { createAudioSection } from "../audio/model.ts";
import { createEventsSection, type EventsSection } from "../events/model.ts";
import {
  createPartySection, createInventorySection, createMenuSection,
  PARTY_SCHEMA_VERSION, INVENTORY_SCHEMA_VERSION, MENU_SCHEMA_VERSION,
} from "../menu/model.ts";
import { BATTLE_SCHEMA_VERSION, createBattleSection } from "../battle/model.ts";

/** Every `GameState` section key (AD-10), i.e. the schema version map's keys. */
export const SCHEMA_VERSIONS = {
  schema: 2,
  world: 1,
  sprites: 2,
  actors: 2,
  party: PARTY_SCHEMA_VERSION,
  inventory: INVENTORY_SCHEMA_VERSION,
  triggers: 2,
  vm: 7,
  battle: BATTLE_SCHEMA_VERSION,
  menu: MENU_SCHEMA_VERSION,
  input: 2,
  ui: 1,
  camera: 1,
  fx: 1,
  audio: 2,
  surfaces: 1,
  rng: 1,
  time: 1,
  engine: 1,
  events: 1,
} as const;

/** One `GameState` section key. */
export type SectionKey = keyof typeof SCHEMA_VERSIONS;

/** AD-23's `GameState.schema`: a version per section plus the instruction version (`ir`). */
export type SchemaState = {
  schema: number;
  world: number;
  sprites: number;
  actors: number;
  party: number;
  inventory: number;
  triggers: number;
  vm: number;
  battle: number;
  menu: number;
  input: number;
  ui: number;
  camera: number;
  fx: number;
  audio: number;
  surfaces: number;
  rng: number;
  time: number;
  engine: number;
  events: number;
  ir: string;
};

/** AD-10's 20-section state tree (`events` is entry 19.10's); `SaveState` is this type. */
export type GameState = {
  schema: SchemaState;
  world: WorldSection;
  sprites: SpritesSection;
  actors: ActorsSection;
  party: PartySection;
  inventory: InventorySection;
  triggers: TriggersSection;
  vm: VmState;
  battle: BattleSection;
  menu: MenuSection;
  input: InputSection;
  ui: UiSection;
  camera: CameraSection;
  fx: FxSection;
  audio: AudioSection;
  surfaces: SurfacesSection;
  rng: RngState;
  time: TimeState;
  engine: EngineSection;
  events: EventsSection;
};

/** Build-time proof that the whole state tree stays plain data (G1 rule 2). */
export type GameStateIsPlainData = AssertPlainData<GameState>;

/** The `schema` section at the current versions (AD-23). */
export function createSchemaState(): SchemaState {
  return {
    schema: SCHEMA_VERSIONS.schema,
    world: SCHEMA_VERSIONS.world,
    sprites: SCHEMA_VERSIONS.sprites,
    actors: SCHEMA_VERSIONS.actors,
    party: SCHEMA_VERSIONS.party,
    inventory: SCHEMA_VERSIONS.inventory,
    triggers: SCHEMA_VERSIONS.triggers,
    vm: SCHEMA_VERSIONS.vm,
    battle: SCHEMA_VERSIONS.battle,
    menu: SCHEMA_VERSIONS.menu,
    input: SCHEMA_VERSIONS.input,
    ui: SCHEMA_VERSIONS.ui,
    camera: SCHEMA_VERSIONS.camera,
    fx: SCHEMA_VERSIONS.fx,
    audio: SCHEMA_VERSIONS.audio,
    surfaces: SCHEMA_VERSIONS.surfaces,
    rng: SCHEMA_VERSIONS.rng,
    time: SCHEMA_VERSIONS.time,
    engine: SCHEMA_VERSIONS.engine,
    events: SCHEMA_VERSIONS.events,
    ir: IR_VERSION,
  };
}

/** A fresh `GameState`: empty sections, a seeded RNG and the tick counter at 0. */
export function createGameState(init: { seed: number }): GameState {
  return {
    schema: createSchemaState(),
    world: {},
    sprites: createSpritesSection(),
    actors: createActorsSection(),
    party: createPartySection(),
    inventory: createInventorySection(),
    triggers: createTriggersSection(),
    vm: createVmState(),
    battle: createBattleSection(),
    menu: createMenuSection(),
    input: createInputSection(),
    ui: {} as UiSection,
    camera: {} as CameraSection,
    fx: {} as FxSection,
    audio: createAudioSection(),
    surfaces: {} as SurfacesSection,
    rng: seedRng(init.seed),
    time: createTimeState(),
    engine: {},
    events: createEventsSection(),
  };
}
