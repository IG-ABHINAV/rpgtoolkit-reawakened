import {
  canon,
  encodeLog,
  fnv1a64,
  hashState,
  type AudioCue,
  type Breakpoint,
  type DrawCommand,
  type DrawList,
  type Engine,
  type InputEvent,
  type InputRecord,
  type TickReport,
  type SurfaceId,
  type SurfacePixels,
} from "@tk-reawakened/core";
type RegisteredAction = Parameters<Engine["registerGameAction"]>[0];

export type TestEngineState = {
  tick: number;
  /** False while the window is inactive: the main loop runs no frame then (docs/spec/engine/main-loop-and-startup.md#e-03). */
  focused: boolean;
  keys: string[];
  pointer: { x: number; y: number; buttons: number };
  other: number;
  cueId: number;
  log: string;
};

function deepCopyValue<T>(value: T): T {
  if (value instanceof Uint8Array) {
    const fresh = new Uint8Array(value.byteLength);
    fresh.set(value);
    return fresh as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepCopyValue(item)) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      copy[key] = deepCopyValue((value as Record<string, unknown>)[key]);
    }
    return copy as T;
  }
  return value;
}

export function createTestEngine(): Engine {
  const state: TestEngineState = {
    tick: 0,
    focused: true,
    keys: [],
    pointer: { x: 0, y: 0, buttons: 0 },
    other: 0,
    cueId: 0,
    log: "",
  };
  const registeredActions = new Map<string, RegisteredAction>();
  let pointerMovementSuppressed = false;
  return {
    advance(
      ticks: number,
      inputs: readonly InputRecord[],
      maxTicks?: number,
    ): TickReport {
      const actualTicks =
        maxTicks !== undefined && maxTicks < ticks ? maxTicks : ticks;
      const before = state.tick;
      const endTick = before + actualTicks;

      for (const input of inputs) {
        if (input.tick < before || input.tick >= endTick) {
          throw new RangeError(
            `test double: input tick ${input.tick} is outside window [${before}, ${endTick})`,
          );
        }
      }

      const audioCues: AudioCue[] = [];
      const consumed: InputRecord[] = [];
      // E-03: the engine has two passes at the current tick — a pre-tick pass that consumes only focus, asset and
      // blob/video replies, then the frame's input phase, which never runs while the window is inactive
      // (`engine.ts` `processPreTickEvents` and the `state.input.focused` loop guard). Model both: at the first tick
      // apply the pre-tick kinds, and apply the rest only if the window is still focused; every later tick applies
      // its own records and stops counting frames as soon as focus is lost.
      const PRETICK: ReadonlySet<string> = new Set(["focus", "asset", "blob.loaded", "blob.saved", "video.ended"]);
      const apply = (record: InputRecord): void => {
        const event = record.event;
        switch (event.kind) {
          case "key": {
            if (event.down) {
              if (!state.keys.includes(event.name)) {
                state.keys.push(event.name);
                state.keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
              }
              state.cueId++;
              audioCues.push({
                cueId: state.cueId,
                tick: record.tick,
                kind: "media.volume",
                track: null,
                voice: null,
                asset: null,
                loop: null,
                flags: null,
                positionTicks: null,
                volume: 100,
                targetVolume: null,
                durationTicks: null,
              });
            } else {
              const index = state.keys.indexOf(event.name);
              if (index !== -1) {
                state.keys.splice(index, 1);
              }
            }
            break;
          }
          case "action": {
            const index = state.keys.indexOf(event.action);
            if (event.down && index < 0) state.keys.push(event.action);
            else if (!event.down && index >= 0) state.keys.splice(index, 1);
            break;
          }
          case "pointer": {
            state.pointer = {
              x: event.x,
              y: event.y,
              buttons: event.buttons,
            };
            break;
          }
          case "pointer.cancel": {
            state.pointer = { ...state.pointer, buttons: state.pointer.buttons & ~1 };
            break;
          }
          case "gamepad":
          case "host.features":
          case "host.display":
          case "host.gamepads":
          case "asset":
          case "blob.loaded":
          case "blob.saved":
          case "blob.listed":
          case "extension.result":
          case "audio.ended":
          case "video.ended": {
            state.other++;
            break;
          }
          case "focus": {
            // E-03: the Paused state runs no game frame, so losing focus stops the clock advancing until it returns.
            state.focused = event.state === "gained";
            break;
          }
          default: {
            const _never: never = event;
            throw new Error("test double: unexpected event kind");
          }
        }

        state.log = fnv1a64(state.log + canon(encodeLog(record)));
        consumed.push({
          tick: record.tick,
          event: deepCopyValue(record.event as InputEvent),
        });
      };

      let ran = 0;
      let tick = before;
      while (ran < actualTicks) {
        for (const record of inputs) {
          if (record.tick !== tick) continue;
          if (tick === before ? PRETICK.has(record.event.kind) : true) apply(record);
        }
        if (tick === before) {
          for (const record of inputs) {
            if (record.tick !== tick) continue;
            if (PRETICK.has(record.event.kind)) continue;
            if (!state.focused) continue; // left queued until focus returns, as the engine re-queues it
            apply(record);
          }
        }
        if (!state.focused) break;
        ran += 1;
        tick += 1;
      }
      state.tick = tick;
      const stateHash = hashState(state);

      return {
        ticksRun: ran,
        tickAfter: state.tick,
        consumed,
        audioCues,
        requests: [],
        diagnostics: [],
        loading: false,
        paused: null,
        stateHash,
      };
    },

    drawList(_alpha?: number): DrawList {
      const commands: DrawCommand[] = [
        {
          kind: "fill",
          rgb: { r: 0, g: 0, b: 0 },
        },
      ];

      for (let i = 0; i < state.keys.length; i++) {
        commands.push({
          kind: "rect",
          rect: { x: i * 16, y: 0, w: 16, h: 16 },
          rgb: { r: 255, g: 255, b: 255 },
          filled: true,
        });
      }

      commands.push({
        kind: "rect",
        rect: { x: state.pointer.x, y: state.pointer.y, w: 4, h: 4 },
        rgb: { r: 255, g: 0, b: 0 },
        filled: true,
      });

      return {
        tick: state.tick,
        width: 320,
        height: 240,
        commands,
        marginCommands: [],
      };
    },
    registeredActionNames() {
      return ["up", "down", "left", "right", "confirm", "cancel", "menu", ...registeredActions.keys()];
    },
    registerGameAction(action: RegisteredAction) {
      if (!action.name.startsWith("game.") || registeredActions.has(action.name)) return false;
      registeredActions.set(action.name, action);
      return true;
    },
    setPointerMovementSuppressed(suppressed: boolean) {
      pointerMovementSuppressed = suppressed;
    },
    reportUnknownAction(_action: string) {},
    customTouchControlsDeclared() {
      return false;
    },
    hostFeatures() {
      return { touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null };
    },
    hostDisplayGeometry() {
      return {
        content: { width: 320, height: 240 },
        game: { x: 0, y: 0, width: 320, height: 240 },
        safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      };
    },
    surfaceCacheEpoch() {
      return 0;
    },
    accessibilityTree() {
      return [];
    },
    runnerControlPointerPreemption() {
      return null;
    },

    surfacePixels(_id: SurfaceId, _rev: number): SurfacePixels | null {
      return null;
    },
    picturePixels(): SurfacePixels | null {
      return null;
    },
    recoveryCandidate() {
      return null;
    },
    resumeRecovery() {
      return false;
    },
    recoveryStatus() {
      return "none";
    },

    setBreakpoints(_breakpoints: readonly Breakpoint[]): void {},
  };
}
