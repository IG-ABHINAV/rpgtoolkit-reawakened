import type { EnginePhaseRegistration, EngineResetRegistration } from "../engine/engine.ts";
import { findBlockingThread } from "../script/state.ts";
import { enqueueDirectionMove } from "../sprites/movement.ts";
import type { Facing } from "../sprites/model.ts";
import { enqueuePathMove } from "../sprites/runtime.ts";
import type { GameState } from "../save/state.ts";
import { createInputSection, processGamepadEvents, takeInputActions, type InputConfig } from "./input.ts";

const FACING_BY_ACTION: Record<string, Facing> = {
  up: "N",
  down: "S",
  left: "W",
  right: "E",
};
const FACING_BY_VECTOR: Record<string, Facing> = {
  "0,-1": "N",
  "1,-1": "NE",
  "1,0": "E",
  "1,1": "SE",
  "0,1": "S",
  "-1,1": "SW",
  "-1,0": "W",
  "-1,-1": "NW",
};

export type InputPhaseOptions = {
  readonly rank?: number;
  readonly pixelMovement?: number;
  readonly pixelStep?: number;
};

function selectedPlayer(state: GameState): string | null {
  if (state.input.playerId !== null) return state.input.playerId;
  if (state.sprites.selectedPlayer !== null) return state.sprites.selectedPlayer;
  return state.sprites.players.find((actor) => actor.controlled)?.id ?? state.sprites.players[0]?.id ?? null;
}

function canAcceptDirection(state: GameState, id: string): boolean {
  const actor = state.sprites.players.find((value) => value.id === id);
  return actor !== undefined && actor.visible && actor.movement.active === null && actor.queue.moves.length === 0 && actor.queue.waypoint === null && actor.state !== "moving";
}

function heldFacing(state: GameState): Facing | null {
  let x = (state.input.actions.right === true ? 1 : 0) - (state.input.actions.left === true ? 1 : 0);
  let y = (state.input.actions.down === true ? 1 : 0) - (state.input.actions.up === true ? 1 : 0);
  if (x !== 0 && y !== 0 && !state.input.allowDiagonals) {
    const latest = [...state.input.directionOrder].reverse().find((action) => state.input.actions[action] === true);
    if (latest === "left" || latest === "right") y = 0;
    else x = 0;
  }
  return FACING_BY_VECTOR[`${x},${y}`] ?? null;
}

/** Apply input-owned action edges during AD-26's input phase. */
export function runInputPhase(state: GameState, options: InputPhaseOptions = {}): void {
  processGamepadEvents(state.input);
  const { actions, clicks } = takeInputActions(state.input);
  const id = selectedPlayer(state);
  const board = state.world.board ?? null;
  // A running program or any global wait owns script input until it finishes.
  // Keep recording key state, but never turn its direction edges or holds into steps.
  const directionBlocked = findBlockingThread(state.vm) !== null
    || state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished");
  if (id === null) return;
  if (!directionBlocked && actions.some((action) => FACING_BY_ACTION[action] !== undefined) && canAcceptDirection(state, id)) {
    const facing = heldFacing(state);
    if (facing !== null) enqueueDirectionMove(state.sprites, id, facing, options.pixelMovement ?? 0, options.pixelStep ?? 8);
  }
  // Held-direction continuous movement: while a direction key stays held and the player becomes
  // idle again, queue the next step at the normal cadence (docs/spec/engine/display-input-audio.md#reawakened-held-direction-movement).
  if (!directionBlocked && state.input.focused && canAcceptDirection(state, id)) {
    const facing = heldFacing(state);
    if (facing !== null) enqueueDirectionMove(state.sprites, id, facing, options.pixelMovement ?? 0, options.pixelStep ?? 8);
  }
  if (board === null) return;
  for (const click of clicks) enqueuePathMove(state.sprites, board, id, click, state.input.pathMode, true);
}

/** Register the input owner without changing the engine's fixed phase order. */
export function inputPhaseRegistration(options: InputPhaseOptions = {}): EnginePhaseRegistration {
  return {
    phase: "input",
    rank: options.rank ?? 0,
    run: (state) => runInputPhase(state, options),
  };
}

/** Register the input owner at the reset seam so quit/restart clears transient input state. */
export function inputResetRegistration(config: InputConfig = {}, rank = 0): EngineResetRegistration {
  return { section: "input", rank, reset: (state) => { state.input = createInputSection(config); } };
}
