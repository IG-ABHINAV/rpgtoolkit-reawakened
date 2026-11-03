/** Owner-scoped actions, not package state mutation (AD-10; canonical menu save contract). */
import type { GameState } from "../save/state.ts";
import type { EffectRecord } from "../script/effects.ts";
import { addActor, removeActor, type ActorCreateInput } from "../actors/model.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import { ScriptError } from "../script/errors.ts";
import {
  readonlyCopy,
  validateActionFields,
  validateMenuSection,
  validatePartySection,
  type DeepReadonly,
  type InventorySection,
  type MenuScreen,
  type MenuSection,
  type MenuStateResult,
  type PartySection,
  type StateIssue,
} from "./model.ts";
import {
  applyInventoryAction,
  commitItemAction,
  itemActionHooks,
  missingItemActionAssets,
  preflightItemAction,
  type InventoryAction as InventoryActionType,
  type InventoryEvent,
  type InventoryRuntime,
  type ItemActionAsset,
  type ItemActionHooks,
  type ItemActionPhase,
  type ItemActionPreflight,
  type ItemActionRequest,
  type ItemActionResult,
  type ItemActionSelection,
} from "./inventory.ts";
export type {
  InventoryAction,
  ItemActionAsset,
  ItemActionHook,
  InventoryRuntime,
  ItemActionHooks,
  ItemActionPhase,
  ItemActionPreflight,
  ItemActionRequest,
  ItemActionResult,
  ItemActionSelection,
} from "./inventory.ts";
export type PartyAction =
  | { readonly type: "roster"; readonly members: readonly number[]; readonly selected: number | null }
  | { readonly type: "steps"; readonly value: number }
  | { readonly type: "add"; readonly actor?: ActorCreateInput; readonly actorId?: number }
  | { readonly type: "restore" | "remove" | "destroy" | "select"; readonly actorId: number }
  | { readonly type: "swap"; readonly firstActorId: number; readonly secondActorId: number }
  | { readonly type: "inn" };
export type MenuAction =
  | { readonly type: "navigation"; readonly screens: readonly Readonly<MenuScreen>[] }
  | { readonly type: "graphic"; readonly value: string | null }
  | { readonly type: "updateCurrent"; readonly actorId: number | null; readonly selection: number };
export type SectionOwnerPort<S, A> = {
  read(): DeepReadonly<S>;
  apply(action: A): MenuStateResult;
};
export type MenuOwnerPorts = {
  readonly party: SectionOwnerPort<PartySection, PartyAction>;
  readonly inventory: SectionOwnerPort<InventorySection, InventoryActionType> & {
    /** Pure validation; captures the exact actor, stack and displaced-tuple identities for a resumable caller. */
    preflightItemAction(request: ItemActionRequest): ItemActionPreflight;
    /** Commit one boundary of a composed item action (see `commitItemAction`). */
    commitItemAction(request: ItemActionRequest, selection: ItemActionSelection, phase: ItemActionPhase): ItemActionResult;
    /** Definitions the action still needs from the host, in canonical order (see `missingItemActionAssets`). */
    missingItemActionAssets(request: ItemActionRequest): readonly ItemActionAsset[];
    /** The non-empty item programs the action runs and the plain item data each receives. */
    itemActionHooks(request: ItemActionRequest, selection: ItemActionSelection): ItemActionHooks;
  };
  readonly menu: SectionOwnerPort<MenuSection, MenuAction> & {
    updateCurrent(input: { readonly actorId: number | null; readonly selection: number }): MenuStateResult;
  };
  readonly shop: {
    readonly stock: () => readonly string[];
    activate(sources: unknown): MenuStateResult;
    close(): void;
  };
};
export type PartyEvent =
  | { readonly type: "memberAdded"; readonly detail: { readonly actorId: number; readonly index: number } }
  | { readonly type: "memberRemoved"; readonly detail: { readonly actorId: number; readonly index: number } }
  | { readonly type: "membersSwapped"; readonly detail: { readonly firstActorId: number; readonly secondActorId: number; readonly firstIndex: number; readonly secondIndex: number } }
  | { readonly type: "activeMemberChanged"; readonly detail: { readonly previousActorId: number | null; readonly currentActorId: number | null } };
export type PartyEventSink = (event: PartyEvent) => void;
export type InventoryEventSink = (event: InventoryEvent) => void;
export type PartyInnOperation = () => MenuStateResult;

function rosterEvents(previous: PartySection, current: PartySection): PartyEvent[] {
  const events: PartyEvent[] = [];
  previous.members.forEach((actorId, index) => {
    if (!current.members.includes(actorId)) events.push({ type: "memberRemoved", detail: { actorId, index } });
  });
  current.members.forEach((actorId, index) => {
    if (!previous.members.includes(actorId)) events.push({ type: "memberAdded", detail: { actorId, index } });
  });
  if (previous.members.length === current.members.length &&
      previous.members.every((actorId) => current.members.includes(actorId))) {
    const work = [...previous.members];
    for (let i = 0; i < current.members.length; i += 1) {
      if (work[i] === current.members[i]) continue;
      const j = work.indexOf(current.members[i]!, i + 1);
      const firstActorId = work[i]!;
      const secondActorId = work[j]!;
      [work[i], work[j]] = [work[j]!, work[i]!];
      events.push({ type: "membersSwapped", detail: { firstActorId, secondActorId, firstIndex: i, secondIndex: j } });
    }
  }
  if (previous.selected !== current.selected) {
    events.push({ type: "activeMemberChanged", detail: { previousActorId: previous.selected, currentActorId: current.selected } });
  }
  return events;
}
type OwnerState = Pick<GameState, "party" | "inventory" | "menu" | "actors">;
const ACCEPTED: MenuStateResult = Object.freeze({ ok: true, error: null });

function rejected(error: StateIssue): MenuStateResult {
  return { ok: false, error };
}

function actionRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Resolves current section values on every call, including after reset/restore. */
export function createMenuOwnerPorts(
  state: OwnerState,
  onPartyEvent?: PartyEventSink,
  inventoryRuntime?: InventoryRuntime,
  onInventoryEvent?: InventoryEventSink,
  innOperation?: PartyInnOperation,
): MenuOwnerPorts {
  const commitParty = (next: PartySection, destroyActorId?: number): MenuStateResult => {
    const previous = state.party;
    const same = previous.selected === next.selected && previous.steps === next.steps &&
      previous.stepRemainder === next.stepRemainder &&
      previous.members.length === next.members.length &&
      previous.members.every((actorId, index) => actorId === next.members[index]);
    if (same) {
      state.party = { ...previous, members: [...previous.members] };
      return ACCEPTED;
    }
    state.party = { ...next, members: [...next.members] };
    if (destroyActorId !== undefined) removeActor(state.actors, destroyActorId);
    for (const event of rosterEvents(previous, state.party)) onPartyEvent?.(event);
    return ACCEPTED;
  };
  return {
    shop: {
      stock: () => Object.freeze([...(inventoryRuntime?.shopStock?.() ?? [])]),
      activate(value: unknown): MenuStateResult {
        if (!Array.isArray(value) || value.length === 0) return rejected({ path: "shop.stock", message: "expected at least one item source" });
        if (inventoryRuntime?.setShopStock === undefined) return rejected({ path: "shop.stock", message: "shop context is unavailable" });
        const sources: string[] = [];
        for (const entry of value) {
          if (typeof entry !== "string") return rejected({ path: "shop.stock", message: "expected item asset sources" });
          const relative = entry.replaceAll("\\", "/").replace(/^item\//i, "");
          if (!relative.toLowerCase().endsWith(".itm")) return rejected({ path: "shop.stock", message: "expected an .itm asset source" });
          const source = assetKey(`item/${relative}`);
          if (inventoryRuntime.item(source) === undefined) return rejected({ path: "shop.stock", message: `item definition is unavailable: ${source}` });
          sources.push(source);
        }
        if (inventoryRuntime.setShopStock(sources) === false) return rejected({ path: "shop.stock", message: "another shop session is already active" });
        return ACCEPTED;
      },
      close() {
        if (inventoryRuntime?.closeShop !== undefined) inventoryRuntime.closeShop();
        else inventoryRuntime?.setShopStock?.([]);
      },
    },
    party: {
      read: () => readonlyCopy(state.party),
      apply(action: unknown): MenuStateResult {
        const record = actionRecord(action);
        if (record === null) return rejected({ path: "party.action", message: "expected an action object" });
        if (record.type === "inn") {
          const error = validateActionFields(record, ["type"], "party.action");
          if (error !== null) return rejected(error);
          return innOperation?.() ?? rejected({ path: "party.inn", message: "inn operation is unavailable" });
        }
        let keys: readonly string[];
        let candidate: unknown;
        let destroyActorId: number | undefined;
        let createdActor: ActorCreateInput | undefined;
        let candidateActors = state.actors;
        const old = state.party;
        switch (record.type) {
          case "roster":
            keys = ["type", "members", "selected"];
            candidate = { ...old, members: record.members, selected: record.selected };
            break;
          case "steps":
            keys = ["type", "value"];
            candidate = { ...old, steps: record.value };
            break;
          case "add":
          case "restore": {
            let actorId = record.actorId as number;
            if (record.actor !== undefined) {
              keys = ["type", "actor"];
              createdActor = record.actor as ActorCreateInput;
              candidateActors = { ...state.actors, actors: state.actors.actors.map((actor) => ({ ...actor })) };
              actorId = addActor(candidateActors, createdActor).id;
            } else {
              keys = ["type", "actorId"];
            }
            if (old.members.includes(actorId)) return ACCEPTED;
            const members = [...old.members, actorId];
            candidate = { ...old, members, selected: old.selected ?? members[0] ?? null };
            break;
          }
          case "remove":
          case "destroy": {
            keys = ["type", "actorId"];
            if (record.type === "destroy") destroyActorId = record.actorId as number;
            const index = old.members.indexOf(record.actorId as number);
            if (index < 0) return ACCEPTED;
            const members = old.members.filter((actorId) => actorId !== record.actorId);
            const selected = old.selected !== record.actorId
              ? old.selected
              : members.length === 0 ? null : members[Math.min(index, members.length - 1)]!;
            candidate = { ...old, members, selected };
            break;
          }
          case "select":
            keys = ["type", "actorId"];
            if (!old.members.includes(record.actorId as number)) {
              return rejected({ path: "party.selected", message: "expected a current party member id" });
            }
            candidate = { ...old, selected: record.actorId };
            break;
          case "swap": {
            keys = ["type", "firstActorId", "secondActorId"];
            const firstIndex = old.members.indexOf(record.firstActorId as number);
            const secondIndex = old.members.indexOf(record.secondActorId as number);
            if (firstIndex < 0) return rejected({ path: "party.action.firstActorId", message: "expected a current party member id" });
            if (secondIndex < 0) return rejected({ path: "party.action.secondActorId", message: "expected a current party member id" });
            if (firstIndex === secondIndex) return ACCEPTED;
            const members = [...old.members];
            [members[firstIndex], members[secondIndex]] = [members[secondIndex]!, members[firstIndex]!];
            candidate = { ...old, members };
            break;
          }
          default:
            return rejected({ path: "party.action.type", message: "unknown party action" });
        }
        const error = validateActionFields(record, keys, "party.action") ?? validatePartySection(candidate, candidateActors);
        if (error !== null) return rejected(error);
        if (createdActor !== undefined) addActor(state.actors, createdActor);
        const next = candidate as PartySection;
        return commitParty(next, destroyActorId);
      },
    },
    inventory: {
      read: () => readonlyCopy(state.inventory),
      apply(action: unknown): MenuStateResult {
        const outcome = applyInventoryAction(state, action, inventoryRuntime);
        for (const event of outcome.events) onInventoryEvent?.(event);
        return outcome.result;
      },
      preflightItemAction(request) {
        return preflightItemAction({ inventory: state.inventory, actors: state.actors, party: state.party }, request, inventoryRuntime);
      },
      commitItemAction(request, selection, phase) {
        return commitItemAction(state, request, selection, phase, inventoryRuntime, onInventoryEvent);
      },
      missingItemActionAssets(request) {
        return missingItemActionAssets(state, request, inventoryRuntime);
      },
      itemActionHooks(_request, selection) {
        return itemActionHooks(state, selection, inventoryRuntime);
      },
    },
    menu: {
      read: () => readonlyCopy(state.menu),
      apply(action: unknown): MenuStateResult {
        const record = actionRecord(action);
        if (record === null) return rejected({ path: "menu.action", message: "expected an action object" });
        if (record.type === "updateCurrent") {
          const error = validateActionFields(record, ["type", "actorId", "selection"], "menu.action");
          if (error !== null) return rejected(error);
          if (state.menu.screens.length === 0) return rejected({ path: "menu.screens", message: "no active menu frame" });
          const candidate = { ...state.menu.screens[state.menu.screens.length - 1]!, actorId: record.actorId as number | null, selection: record.selection as number };
          const candidateState = { ...state.menu, screens: [...state.menu.screens.slice(0, -1), candidate] };
          const issue = validateMenuSection(candidateState, state.actors);
          if (issue !== null) return rejected(issue);
          state.menu = candidateState as MenuSection;
          return ACCEPTED;
        }
        let keys: readonly string[];
        let candidate: unknown;
        switch (record.type) {
          case "navigation":
            keys = ["type", "screens"];
            candidate = { ...state.menu, screens: record.screens };
            break;
          case "graphic":
            keys = ["type", "value"];
            candidate = { ...state.menu, graphic: record.value };
            break;
          default:
            return rejected({ path: "menu.action.type", message: "unknown menu action" });
        }
        const error = validateActionFields(record, keys, "menu.action") ?? validateMenuSection(candidate, state.actors);
        if (error !== null) return rejected(error);
        const next = candidate as MenuSection;
        state.menu = { ...next, screens: record.type === "navigation" ? next.screens.map((screen) => ({ ...screen })) : next.screens };
        return ACCEPTED;
      },
      updateCurrent(input: { readonly actorId: number | null; readonly selection: number }): MenuStateResult {
        return this.apply({ type: "updateCurrent", actorId: input.actorId, selection: input.selection });
      },
    },
  };
}

/** Routes documented party effects and section actions through their owners. */
export function applyMenuStateEffect(ports: MenuOwnerPorts, effect: EffectRecord): void {
  const section = effect.patch?.section;
  if (effect.name === "shop.open") {
    if (effect.args.length !== 1) throw new ScriptError("menu.state-invalid", "shop.stock: expected one source list");
    const result = ports.shop.activate(effect.args[0]);
    if (result.error !== null) throw new ScriptError("menu.state-invalid", `${result.error.path}: ${result.error.message}`);
    return;
  }
  if (effect.name === "shop.close") {
    if (effect.args.length !== 0) throw new ScriptError("menu.state-invalid", "shop.close: expected no arguments");
    ports.shop.close();
    return;
  }
  if (effect.name === "activeplayer" || effect.name === "addplayer" || effect.name === "restoreplayer" || effect.name === "removeplayer" || effect.name === "destroyplayer" || effect.name === "__party_addplayer_asset" || effect.name === "inn") {
    if (section !== "party" || effect.args.length !== 1) throw new ScriptError("menu.state-invalid", "party.action: expected one party action");
    const result = ports.party.apply(effect.args[0] as PartyAction);
    if (result.error !== null) throw new ScriptError("menu.state-invalid", `${result.error.path}: ${result.error.message}`);
    return;
  }
  if (section === "menu" && effect.kind === "state-write" && effect.args.length === 1) {
    const action = actionRecord(effect.args[0]);
    if (action?.type === "shop.open") {
      const result = ports.shop.activate(action.sources);
      if (result.error !== null) throw new ScriptError("menu.state-invalid", `${result.error.path}: ${result.error.message}`);
      return;
    }
    if (action?.type === "shop.close") {
      if (Object.keys(action).length !== 1) throw new ScriptError("menu.state-invalid", "shop.close: expected no fields");
      ports.shop.close();
      return;
    }
  }
  if (section === "inventory" && effect.kind === "state-write" && effect.args.length === 1 && actionRecord(effect.args[0])?.kind === "inventory.consume") {
    const payload = actionRecord(effect.args[0]);
    if (payload === null) throw new ScriptError("menu.state-invalid", "inventory.consume: expected a payload object");
    const error = validateActionFields(payload, ["kind", "item", "target", "hp", "smp", "handle"], "inventory.consume");
    if (error !== null) throw new ScriptError("menu.state-invalid", `${error.path}: ${error.message}`);
    if (payload.kind !== "inventory.consume" || typeof payload.item !== "string" || payload.item.trim() === "") {
      throw new ScriptError("menu.state-invalid", "inventory.consume: expected a non-empty item source");
    }
    if (typeof payload.target !== "number" || !Number.isSafeInteger(payload.target) || payload.target < 1) {
      throw new ScriptError("menu.state-invalid", "inventory.consume: expected a positive target actor id");
    }
    if (typeof payload.hp !== "number" || !Number.isSafeInteger(payload.hp) ||
        typeof payload.smp !== "number" || !Number.isSafeInteger(payload.smp)) {
      throw new ScriptError("menu.state-invalid", "inventory.consume: expected safe-integer HP and SMP values");
    }
    if (payload.handle !== null && (typeof payload.handle !== "string" || payload.handle === "")) {
      throw new ScriptError("menu.state-invalid", "inventory.consume: expected a null or non-empty stack handle");
    }
    const result = ports.inventory.apply({ type: "consumeBattleItem", item: payload.item, target: payload.target, handle: payload.handle });
    if (result.error !== null) throw new ScriptError("menu.state-invalid", `${result.error.path}: ${result.error.message}`);
    return;
  }
  // A section-owning command that posts one plain action (`inn`, `menugraphic`, an internal menu or stack action) reaches
  // the same router as a script `state` effect; the section decides which actions it accepts.
  if (effect.name !== "state" && effect.name !== "menu.state" &&
      !((section === "inventory" || section === "menu") && effect.kind === "state-write")) return;
  if (section !== "party" && section !== "inventory" && section !== "menu") {
    throw new ScriptError("menu.state-invalid", "menu.action: expected a party, inventory or menu section");
  }
  if (effect.args.length !== 1) throw new ScriptError("menu.state-invalid", `${section}.action: expected exactly one action`);
  const result = ports[section].apply(effect.args[0] as PartyAction & InventoryActionType & MenuAction);
  if (result.error !== null) throw new ScriptError("menu.state-invalid", `${result.error.path}: ${result.error.message}`);
}
