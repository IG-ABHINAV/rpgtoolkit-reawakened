/** Session-only host object hydration (OOP-10/OOP-12). */

import type { MediaScriptService } from "../audio/script.ts";
import type { BattleOwner } from "../battle/port.ts";
import type { EventsSection } from "../events/model.ts";
import type { GameState } from "../save/state.ts";
import type { Value } from "../ports/value.ts";
import type { ObjectRecord, VmState } from "./state.ts";

/** Context passed to a host type's owner-backed member hooks. */
export type HostObjectContext = {
  readonly state: GameState;
  readonly events: EventsSection;
  readonly vm: VmState;
  readonly record: ObjectRecord;
  /** The script-facing media owner, when the engine provides one (MEDIA-1). */
  readonly media?: MediaScriptService;
  /** Owner-mediated access to the saved battle section. */
  readonly battle?: BattleOwner;
  /** The main file's menu cursor sounds, when the engine knows them (E-80, #585). */
  readonly menuSounds?: () => { readonly move: string; readonly choose: string; readonly cancel: string };
};

/** The result of an owner-backed host member write. */
export type HostWriteResult = "written" | "read-only" | "not-host";

/** The result of an owner-backed host member removal. */
export type HostRemoveResult = "removed" | "system-owned" | "not-host";

/**
 * A host/package object declaration. The declaration is session data: only the
 * object's `hostType` name and ordinary members can appear in a save.
 * `methods` maps hydrated RPGCode names to existing command definitions.
 */
export type HostObjectType = {
  readonly name: string;
  readonly methods?: Readonly<Record<string, string>>;
  /**
   * The emitter key an access to this host object registers it under (MEDIA-2).
   * The key is consulted only when the script uses an emitter method, so the
   * media event domain stays lazy.
   */
  readonly emitterKey?: (record: ObjectRecord) => string | null;
  readonly read?: (context: HostObjectContext, name: string) => Value | undefined;
  readonly write?: (context: HostObjectContext, name: string, value: Value) => HostWriteResult;
  /** Host-owned data members remain readable but reject RPGCode assignment. */
  readonly readOnlyMembers?: readonly string[];
  readonly remove?: (context: HostObjectContext, name: string) => HostRemoveResult;
};

/** Stable callable definition used for a hydrated host method tear-off. */
export function hostMethodDef(typeName: string, methodName: string): string {
  return `host:${typeName}:${methodName}`;
}

/** Parse a hydrated host method definition, or return null for ordinary callables. */
export function parseHostMethodDef(def: string): { typeName: string; methodName: string } | null {
  if (!def.startsWith("host:")) return null;
  const separator = def.indexOf(":", 5);
  if (separator < 0 || separator === 5 || separator === def.length - 1) return null;
  return { typeName: def.slice(5, separator), methodName: def.slice(separator + 1) };
}
