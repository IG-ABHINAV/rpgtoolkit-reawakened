/** E-92 engine-backed virtual variables, including board data (R-37). */
import type { Value } from "../ports/value.ts";
import { musicFile } from "../audio/model.ts";
import { MEDIA_EMITTER } from "../audio/events.ts";
import { objectValue, type MediaScriptService } from "../audio/script.ts";
import { GAME_EMITTER } from "../events/model.ts";
import { registerEmitter } from "../events/emitter.ts";
import { createActorService, type ActorService } from "../actors/port.ts";
import type { ActorStats } from "../actors/model.ts";
import { renderNowCanvas } from "../raster/surfaces.ts";
import type { SurfacesSection } from "../save/sections/surfaces.ts";
import type { GameState } from "../save/state.ts";
import { TICKS_PER_SECOND } from "../time/time.ts";
import { createBattleOwner, type BattleOwner } from "../battle/port.ts";
import { registerBattleObject } from "../battle/host.ts";
import { ScriptError } from "./errors.ts";

export type VirtualWriteResult = "written" | "read-only" | "not-virtual";

export type VirtualVariablePort = {
  read(name: string): Value | undefined;
  write?(name: string, value: Value): VirtualWriteResult;
  kill?(name: string): boolean;
};

const ACTOR_ALIASES: Readonly<Record<string, keyof ActorStats>> = {
  experience: "experience",
  hp: "hp",
  maxhp: "maxHp",
  dp: "dp",
  fp: "fp",
  smp: "smp",
  maxsmp: "maxSmp",
  level: "level",
  criticalon: "criticalOn",
  criticalby: "criticalBy",
};

function actorAlias(name: string): keyof ActorStats | undefined {
  const alias = name.endsWith("!") ? name.slice(0, -1) : name;
  return Object.hasOwn(ACTOR_ALIASES, alias) ? ACTOR_ALIASES[alias] : undefined;
}

function isCompileTimeConstant(name: string): boolean {
  return (
    /^tkmv_(?:pause_thread|clear_queue|pathfind|waypoint_path|waypoint_link)$/.test(name) ||
    /^tkvt_(?:solid|under|stairs|waypoint|bkgimage|all_layers_below|frame_intersect)$/.test(name) ||
    /^tkprg_(?:step|keypress|repeat|stops_movement)$/.test(name) ||
    /^tkdir_(?:e|se|s|sw|w|nw|n|ne)$/.test(name)
  );
}

function isSystemVirtual(name: string): boolean {
  return (
    name === "gametime" ||
    name === "music" ||
    name === "battle" ||
    name === "party" ||
    name === "media" ||
    name === GAME_EMITTER ||
    name === "boardbackground" ||
    name === "boardskill" ||
    name === "cnvrendernow" ||
    name === "ambientred" ||
    name === "ambientgreen" ||
    name === "ambientblue" ||
    /^player(?:x|y|layer|handle)\[[0-4]\]$/.test(name) ||
    /^boardtitle\[[1-8]\]$/.test(name) ||
    /^constant\[(10|[0-9])\]$/.test(name) ||
    /^threads\[[0-9]+\]$/.test(name) ||
    isCompileTimeConstant(name) ||
    actorAlias(name) !== undefined
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function requiresBoard(name: string): boolean {
  return name === "boardbackground" || name === "boardskill" || name.startsWith("boardtitle[") || name.startsWith("constant[") || name === "ambientred" || name === "ambientgreen" || name === "ambientblue";
}

/** Read the board-backed virtuals and owner-backed actor aliases. */
export function createDefaultVirtuals(
  state: GameState,
  actors: ActorService = createActorService(state.actors),
  media?: MediaScriptService,
  battle: BattleOwner = createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (section) => { state.battle = section; },
    readBattleCounter: () => state.engine.nextBattleId,
    commitBattleCounter: (next) => { state.engine = { ...state.engine, nextBattleId: next }; },
  }),
): VirtualVariablePort {
  const read = (rawName: string): Value | undefined => {
    const name = rawName.toLowerCase();
    const stat = actorAlias(name);
    if (stat !== undefined) {
      const selected = state.party.selected;
      return (selected === null ? null : actors.readActor(selected))?.stats[stat] ?? 0;
    }
    if (name === "gametime") return Math.floor(state.time.tick / TICKS_PER_SECOND);
    if (name === "music") return musicFile(state.audio) ?? "";
    if (name === "battle") {
      return objectValue(registerBattleObject(state.vm));
    }
    if (name === "media") {
      const record = media === undefined ? registerEmitter(state.vm, state.events, MEDIA_EMITTER) : media.mediaObject();
      return objectValue(record);
    }
    if (name === GAME_EMITTER) {
      const game = registerEmitter(state.vm, state.events, GAME_EMITTER);
      return { kind: "object", handle: game.handle, className: game.className };
    }
    if (name === "party") {
      const party = registerEmitter(state.vm, state.events, "party");
      return { kind: "object", handle: party.handle, className: party.className };
    }
    const world = asRecord(state.world);
    const board = asRecord(world?.board);
    if (requiresBoard(name) && board === undefined) throw new ScriptError("world.no-board", `virtual variable "${rawName}" requires a loaded board`);
    if (name === "boardbackground") return typeof board?.battleBackground === "string" ? board.battleBackground : typeof board?.background === "string" ? board.background : "";
    if (name === "boardskill") return typeof board?.battleSkill === "number" ? board.battleSkill : typeof board?.skill === "number" ? board.skill : 0;
    const surfaces = asRecord(state.surfaces);
    if (name === "cnvrendernow") return surfaces === undefined ? 0 : renderNowCanvas(surfaces as unknown as SurfacesSection) ?? 0;
    const ambient = asRecord(board?.ambient);
    if (name === "ambientred") return typeof ambient?.r === "number" ? ambient.r : 0;
    if (name === "ambientgreen") return typeof ambient?.g === "number" ? ambient.g : 0;
    if (name === "ambientblue") return typeof ambient?.b === "number" ? ambient.b : 0;
    let match = /^playerx\[([0-4])\]$/.exec(name);
    if (match !== null) {
      const member = state.party.members[Number(match[1])];
      const player = asRecord(state.sprites.players.find((value) => value.actorId === member));
      return typeof player?.x === "number" ? player.x : 0;
    }
    match = /^playery\[([0-4])\]$/.exec(name);
    if (match !== null) {
      const member = state.party.members[Number(match[1])];
      const player = asRecord(state.sprites.players.find((value) => value.actorId === member));
      return typeof player?.y === "number" ? player.y : 0;
    }
    match = /^playerlayer\[([0-4])\]$/.exec(name);
    if (match !== null) {
      const member = state.party.members[Number(match[1])];
      const player = asRecord(state.sprites.players.find((value) => value.actorId === member));
      return typeof player?.layer === "number" ? player.layer : 0;
    }
    match = /^playerhandle\[([0-4])\]$/.exec(name);
    if (match !== null) {
      const member = state.party.members[Number(match[1])];
      return member === undefined ? "" : actors.readActor(member)?.name ?? "";
    }
    match = /^boardtitle\[([1-8])\]$/.exec(name);
    if (match !== null) {
      const titles = board?.layerTitles;
      const title = Array.isArray(titles) ? titles[Number(match[1])] : undefined;
      return typeof title === "string" ? title : "";
    }
    match = /^constant\[(10|[0-9])\]$/.exec(name);
    if (match !== null) {
      const constants = board?.constants;
      const value = Array.isArray(constants) ? constants[Number(match[1])] : asRecord(constants)?.[match[1] ?? ""];
      return typeof value === "string" || typeof value === "number" ? value : 0;
    }
    match = /^threads\[([0-9]+)\]$/.exec(name);
    if (match !== null) {
      const thread = state.vm.threads.find((entry) => entry.id === Number(match[1]));
      return thread ? thread.id : 0;
    }
    return undefined;
  };

  return {
    read,
    write(rawName, value) {
      const name = rawName.toLowerCase();
      const stat = actorAlias(name);
      if (stat !== undefined) {
        const selected = state.party.selected;
        if (typeof value !== "number" || selected === null) return "read-only";
        return actors.updateStats(selected, { [stat]: value } as Partial<ActorStats>, { cause: "script" }) === null ? "read-only" : "written";
      }
      if (name === "ambientred" || name === "ambientgreen" || name === "ambientblue") {
        const world = asRecord(state.world);
        const board = asRecord(world?.board);
        const ambient = asRecord(board?.ambient);
        if (board === undefined || ambient === undefined || typeof value !== "number") return "read-only";
        if (board.activeAmbient === undefined) {
          const r = typeof ambient.r === "number" ? ambient.r : 0;
          const g = typeof ambient.g === "number" ? ambient.g : 0;
          const b = typeof ambient.b === "number" ? ambient.b : 0;
          board.activeAmbient = { r, g, b };
        }
        const field = name === "ambientred" ? "r" : name === "ambientgreen" ? "g" : "b";
        ambient[field] = value;
        return "written";
      }
      return isSystemVirtual(name) ? "read-only" : "not-virtual";
    },
    kill(rawName) {
      const name = rawName.toLowerCase();
      if (!isSystemVirtual(name)) return false;
      throw new ScriptError("kill.system-owned", `system-owned name "${rawName}" cannot be killed`);
    },
  };
}
