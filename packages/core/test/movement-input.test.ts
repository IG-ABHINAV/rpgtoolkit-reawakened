import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InputEvent } from "../src/ports/input.ts";
import { applyInputEvent, createInputSection, processGamepadEvents, takeInputActions } from "../src/input/input.ts";
import type { InputSection } from "../src/save/sections/input.ts";

type Fixture = {
  cases: Array<{
    setup: { bindings: { keys: Record<string, string> }; slots: Array<{ id: string; x: number; y: number; w: number; h: number; action: string; enabled: boolean }>; camera: [number, number]; allowDiagonals: boolean };
    script: Array<{ t: number; ev: Record<string, unknown> }>;
    ticks: number;
    expect: Array<{ t: number; held?: string[]; intent?: string | null; queue?: Array<{ seq: number; key: string }>; click?: { logical: [number, number]; board: [number, number]; via: string }; slots?: string[] }>;
  }>;
};

function fixture(): Fixture {
  const path = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement", "input-replay-button-slots.json");
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

function eventOf(raw: Record<string, unknown>): InputEvent | null {
  if (raw.kind === "key") return { kind: "key", name: String(raw.code), code: String(raw.code), char: null, down: raw.down === true, ...(raw.repeat === true ? { repeat: true } : {}) };
  if (raw.kind === "pointer") return { kind: "pointer", x: Number(raw.x), y: Number(raw.y), buttons: Number(raw.buttons ?? (raw.phase === "up" ? 0 : 1)) };
  if (raw.kind === "pointer.cancel") return { kind: "pointer.cancel" };
  if (raw.kind === "gamepad") return raw as unknown as InputEvent;
  return null;
}

function intent(state: InputSection): string | null {
  const x = (state.actions.right === true ? 1 : 0) - (state.actions.left === true ? 1 : 0);
  const y = (state.actions.down === true ? 1 : 0) - (state.actions.up === true ? 1 : 0);
  if (x !== 0 && y !== 0 && !state.allowDiagonals) {
    const latest = [...state.directionOrder].reverse().find((action) => state.actions[action] === true);
    if (latest === "left" || latest === "right") return latest === "left" ? "W" : "E";
    return latest === "up" ? "N" : latest === "down" ? "S" : null;
  }
  const byVector: Record<string, string> = { "0,-1": "N", "1,-1": "NE", "1,0": "E", "1,1": "SE", "0,1": "S", "-1,1": "SW", "-1,0": "W", "-1,-1": "NW" };
  return byVector[`${x},${y}`] ?? null;
}

test("input-replay-button-slots drives every recorded case through core input state", () => {
  const data = fixture();
  for (const inputCase of data.cases) {
    const [cameraX, cameraY] = inputCase.setup.camera;
    const state = createInputSection({ bindings: inputCase.setup.bindings, buttons: inputCase.setup.slots, allowDiagonals: inputCase.setup.allowDiagonals });
    state.camera = { x: cameraX, y: cameraY };
    let previousKeys = 0;
    let previousClicks = 0;
    for (let tick = 0; tick < inputCase.ticks; tick += 1) {
      for (const record of inputCase.script.filter((entry) => entry.t === tick)) {
        if (record.ev.kind === "slot-enabled") {
          const button = state.buttons.find((candidate) => "id" in candidate && candidate.id === record.ev.id);
          if (button !== undefined && "id" in button) state.buttons = state.buttons.map((candidate) => candidate === button ? { ...candidate, enabled: record.ev.enabled === true } : candidate);
          continue;
        }
        const event = eventOf(record.ev);
        if (event !== null) applyInputEvent(state, event);
      }
      processGamepadEvents(state);
      const expected = inputCase.expect[tick] ?? { t: tick };
      const held = ["up", "down", "left", "right", "confirm", "cancel", "menu"].filter((action) => state.actions[action] === true);
      deepEqual(held, expected.held ?? [], `${inputCase.setup.bindings.keys} tick ${tick} held`);
      equal(intent(state), expected.intent ?? null, `tick ${tick} intent`);
      const queue = state.keys.slice(previousKeys).map((key) => key.action !== null && key.action.startsWith("slot:") ? { seq: key.seq, key: key.name, via: key.action } : { seq: key.seq, key: key.name });
      previousKeys = state.keys.length;
      const clicks = state.pendingClicks.slice(previousClicks).map(({ x, y }) => ({ x, y }));
      previousClicks = state.pendingClicks.length;
      if (expected.click === undefined) equal(clicks.length, 0, `tick ${tick} click`);
      else deepEqual(clicks, [{ x: expected.click.board[0], y: expected.click.board[1] }], `tick ${tick} click`);
      deepEqual(state.buttons.filter((button) => "id" in button && button.enabled).map((button) => "id" in button ? button.id : "").filter((id) => id !== ""), expected.slots ?? [], `tick ${tick} slots`);
      takeInputActions(state);
    }
  }
});
