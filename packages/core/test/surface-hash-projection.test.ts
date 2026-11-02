import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createGameState, hashGameState } from "../src/index.ts";
import { hashState } from "../src/canon/canon.ts";
import { withoutSettings } from "../src/audio/model.ts";
import type { GameState } from "../src/save/state.ts";
import type { SurfaceId } from "../src/ports/keys.ts";

function referenceHashProjection(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const { nextRequestId: _nextRequestId, ...engine } = state.engine;
  const entries = Object.fromEntries(Object.entries(state.surfaces.entries).filter(([key]) => key !== "0"));
  const surfaces = { ...state.surfaces, entries };
  return hashState({ ...state, vm, engine, surfaces, audio: withoutSettings(state.audio) });
}

function withScreenAndCanvas(): GameState {
  const state = createGameState({ seed: 1048 });
  state.surfaces = {
    nextId: 2,
    entries: {
      "0": { id: 0 as SurfaceId, rev: 0, bitmap: { t: "rgba", w: 1, h: 1, b64: "AAAAAA==" } },
      "1": { id: 1 as SurfaceId, rev: 0, bitmap: { t: "rgba", w: 1, h: 1, b64: "AAAAAA==" } },
    },
    slots: {},
    colours: {},
  };
  return state;
}

test("presented screen entry zero is excluded while application canvas state remains hashed", () => {
  const state = withScreenAndCanvas();
  const initial = hashGameState(state);
  equal(initial, referenceHashProjection(state));

  state.surfaces.entries["0"]!.bitmap = { t: "rgba", w: 1, h: 1, b64: "/////w==" };
  state.surfaces.entries["0"]!.rev += 1;
  equal(hashGameState(state), initial);
  equal(hashGameState(state), referenceHashProjection(state));
  state.surfaces.entries["1"]!.bitmap = { t: "rgba", w: 1, h: 1, b64: "/////w==" };
  state.surfaces.entries["1"]!.rev += 1;
  const canvasHash = hashGameState(state);
  ok(canvasHash !== initial);

  state.vm.globals["playerX"] = 12;
  ok(hashGameState(state) !== canvasHash);
});

test("fallback surface canonicalization also omits entry zero and retains other fields", () => {
  const state = withScreenAndCanvas();
  const surfaces = state.surfaces as typeof state.surfaces & { diagnostic: string };
  surfaces.diagnostic = "kept";
  const initial = hashGameState(state);
  equal(initial, referenceHashProjection(state));

  state.surfaces.entries["0"]!.bitmap = { t: "rgba", w: 1, h: 1, b64: "/////w==" };
  state.surfaces.entries["0"]!.rev += 1;
  equal(hashGameState(state), initial);
  equal(hashGameState(state), referenceHashProjection(state));

  surfaces.diagnostic = "changed";
  ok(hashGameState(state) !== initial);
});
