import { ScriptError } from "../script/errors.ts";
import {
  createInventorySection,
  createMenuSection,
  createPartySection,
  INVENTORY_SCHEMA_VERSION,
  MENU_SCHEMA_VERSION,
  PARTY_SCHEMA_VERSION,
  validateInventorySection,
  validateMenuSection,
  validatePartySection,
} from "./model.ts";
import type { ActorsSection } from "../actors/model.ts";

/** Migrate and validate party, inventory, and menu save sections. */
export function migrateMenuSections(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const actors = recordAt(record.actors, "actors") as ActorsSection;
  const owners = [
    ["party", PARTY_SCHEMA_VERSION, createPartySection, validatePartySection],
    ["inventory", INVENTORY_SCHEMA_VERSION, createInventorySection, validateInventorySection],
    ["menu", MENU_SCHEMA_VERSION, createMenuSection, validateMenuSection],
  ] as const;
  for (const [name, currentVersion, create, validate] of owners) {
    const version = schema[name];
    const previousVersion = name === "party" ? 2 : -1;
    if (typeof version !== "number" || !Number.isInteger(version) || (version !== 1 && version !== previousVersion && version !== currentVersion)) {
      shapeError(`the snapshot's schema.${name} must be exactly 1${previousVersion < 0 ? "" : `, ${previousVersion}`} or ${currentVersion}`);
    }
    const section = record[name];
    if (version === 1) {
      if (typeof section !== "object" || section === null || Array.isArray(section) || Object.keys(section).length !== 0) {
        shapeError(`the snapshot's ${name} must be an empty object for schema version 1`);
      }
      record[name] = create();
      schema[name] = currentVersion;
      continue;
    }
    if (version === 2 && name === "party") {
      const party = recordAt(section, "party");
      if (party.version !== 2 || Object.hasOwn(party, "stepRemainder")) {
        shapeError("the snapshot's party section is invalid for schema version 2");
      }
      party.stepRemainder = 0;
      party.version = currentVersion;
      schema.party = currentVersion;
    }
    const issue = validate(section, actors);
    if (issue !== null) shapeError(`${issue.path}: ${issue.message}`);
  }
}

function shapeError(message: string): never {
  throw new ScriptError("restore.shape", message);
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScriptError("restore.shape", `the snapshot's ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}
