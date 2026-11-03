/**
 * The member names the engine's host objects expose as callable methods (OOP-10/OOP-12).
 *
 * A host method is a real call target in RPGCode — `context.inventory.use(...)`,
 * `fighter.damage(...)` — but it is not a registered command, so a tool that only knows the command catalogue
 * reports it as unknown. Publishing the names once, from the declarations that create them, keeps that list honest
 * without inventing a second registry (docs/spec/engine/rpgcode-tooling.md#tool-3).
 */
import { MEDIA_HOST_TYPES } from "../audio/script.ts";
import { createBattleHostType } from "../battle/host.ts";
import { INVENTORY_HOST_TYPE } from "./packs/inventory.ts";
import { MENU_HOST_TYPE, PARTY_HOST_TYPE, SHOP_HOST_TYPE } from "./packs/menu.ts";
import type { HostObjectType } from "./host.ts";

const ACTOR_METHODS: readonly string[] = ["damage"];

function methodsOf(type: HostObjectType): readonly string[] {
  return Object.keys(type.methods ?? {});
}

/** Every host method name the engine installs, ASCII-folded by the caller when it compares. */
export const HOST_METHOD_NAMES: ReadonlySet<string> = new Set([
  ...ACTOR_METHODS,
  ...methodsOf(INVENTORY_HOST_TYPE),
  ...methodsOf(MENU_HOST_TYPE),
  ...methodsOf(PARTY_HOST_TYPE),
  ...methodsOf(SHOP_HOST_TYPE),
  ...methodsOf(createBattleHostType()),
  ...MEDIA_HOST_TYPES.flatMap((type) => methodsOf(type)),
]);
