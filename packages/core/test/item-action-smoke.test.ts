// Cross-layer smoke for the native item-action continuation (E-80 and #589).
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  assetKey,
  CATALOGUE_PLUGIN,
  CORE_PLUGIN,
  createAssetIndex,
  createGameState,
  createScriptServices,
  fileProgramRef,
  PACKAGE_ROOT,
  startProgram,
  UI_PLUGIN,
  type PluginDefinition,
  type ProgramLoader,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";

test("native menu action refusal returns once without changing inventory or actors", () => {
  const program = new TextEncoder().encode("itemmenu()\nend()\n");
  const loader: ProgramLoader = {
    index: createAssetIndex(["Prg/item-action-smoke.prg"]),
    root: PACKAGE_ROOT,
    read: (key) => key === assetKey("Prg/item-action-smoke.prg") ? program : undefined,
  };
  const state = createGameState({ seed: 0 });
  const beforeActors = JSON.stringify(state.actors);
  const beforeInventory = JSON.stringify(state.inventory);
  const events: string[] = [];
  const provider: PluginDefinition = {
    id: "item-action-smoke",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      items: ({ event, state: providerState }) => {
        events.push(event.type);
        if (event.type === "enter") {
          return { kind: "item.action", state: { marker: 7 }, action: { kind: "use", entryId: 1, actorId: 999 } };
        }
        if (event.type === "item.action.completed") {
          deepEqual(providerState, { marker: 7 });
          equal(event.result.status, "refused");
          equal(event.result.error?.path, "inventory.action.actorId");
          return { kind: "complete" };
        }
        throw new Error(`unexpected provider event ${event.type}`);
      },
    },
  };
  const services = createScriptServices(state, [
    { definition: CORE_PLUGIN },
    { definition: UI_PLUGIN },
    { definition: CATALOGUE_PLUGIN },
    { definition: provider },
  ], undefined, undefined, loader);
  startProgram(state.vm, fileProgramRef(loader, "item-action-smoke.prg"));
  for (let i = 0; i < 4; i += 1) advanceOrFail(state, services);
  deepEqual(events, ["enter", "item.action.completed"]);
  equal(JSON.stringify(state.actors), beforeActors);
  equal(JSON.stringify(state.inventory), beforeInventory);
  equal(state.menu.screens.length, 0);
});
