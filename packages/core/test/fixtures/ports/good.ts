// Port-contract fixtures that must typecheck (AD-1, AD-3, AD-7, AD-14, AD-16).
import type {
  AssertPlainData,
  AssertPortData,
  AssetKey,
  AssetReply,
  AssetRequest,
  AudioCue,
  AudioCueKind,
  AudioEnded,
  Blend,
  BlitCommand,
  BlobArea,
  BlobKey,
  BlobListed,
  BlobLoaded,
  BlobSaved,
  Breakpoint,
  Diagnostic,
  DrawCommand,
  DrawList,
  EllipseCommand,
  Engine,
  ExtensionCallRequest,
  ExtensionResult,
  FillCommand,
  FocusInput,
  Frame,
  LocalSlot,
  GamepadInput,
  GameState,
  InputEvent,
  InputRecord,
  KeyInput,
  LineCommand,
  ListBlobsRequest,
  LoadBlobRequest,
  OpenUrlRequest,
  PausedState,
  PlayVideoRequest,
  PointerInput,
  PointerCancelInput,
  PopTargetCommand,
  PushTargetCommand,
  QuitRequest,
  RectCommand,
  RunnerRequest,
  SaveBlobRequest,
  ScratchId,
  TickReport,
  SurfaceId,
  SurfacePixels,
  TexRef,
  TextCommand,
  Thread,
  VideoEnded,
  VmState,
} from "../../../src/index.ts";
import { createGameState } from "../../../src/index.ts";

// The real AD-7 shapes (thread, VM and game state) are plain data; importing
// them in place of the earlier stand-ins proves the production types satisfy
// AssertPlainData (G1 rule 2, AD-7, AD-10).
export type VmStateIsPlainData = AssertPlainData<VmState>;
export type GameStateIsPlainData = AssertPlainData<GameState>;
export type FrameIsPlainData = AssertPlainData<Frame>;
export type LocalSlotIsPlainData = AssertPlainData<LocalSlot>;

// A mid-yield game state: the `time` section is a plain tick counter (AD-2) and
// `vm` holds the real thread tree (AD-7, docs/spec/engine/rpgcode-runtime.md THR-3).
export const midYieldState: GameState = {
  ...createGameState({ seed: 0 }),
  time: { tick: 3 },
};

// A pinned thread with its one frame (AD-7).
export const pinThread: Thread = {
  id: 1,
  kind: "blocking",
  owner: "script",
  source: null,
  target: null,
  frames: [
    {
      program: { kind: "inline", text: "end()", ir: "1" },
      ip: 0,
      locals: {},
      operands: [],
      errorHandler: null,
      autoLocal: false,
    },
  ],
  status: "ready",
  wait: null,
  queue: [],
  pending: null,
  detached: [],
  collect: null,
};

// A draw list and an audio cue are plain data, so they hash (AD-3, AD-11, AD-16).
export type DrawListIsPlainData = AssertPlainData<DrawList>;
export type AudioCueIsPlainData = AssertPlainData<AudioCue>;

// Port positions carry bytes as `Uint8Array` leaves (AD-1).
export type TickReportIsPortData = AssertPortData<TickReport>;
export type InputRecordIsPortData = AssertPortData<InputRecord>;
export type InputEventIsPortData = AssertPortData<InputEvent>;
export type RunnerRequestIsPortData = AssertPortData<RunnerRequest>;
export type AudioCueIsPortData = AssertPortData<AudioCue>;

// The rest of the engine's arguments and results (AD-1, AD-27).
export type BreakpointIsPortData = AssertPortData<Breakpoint>;
export type SurfacePixelsIsPortData = AssertPortData<SurfacePixels>;
export type DiagnosticIsPortData = AssertPortData<Diagnostic>;
export type PausedStateIsPortData = AssertPortData<PausedState>;
export type BlobKeyIsPortData = AssertPortData<BlobKey>;

// Engine parameters and return types are PortData (AD-1).
export type EngineAdvanceParam0IsPortData = AssertPortData<Parameters<Engine["advance"]>[0]>;
export type EngineAdvanceParam1IsPortData = AssertPortData<Parameters<Engine["advance"]>[1]>;
export type EngineAdvanceParam2IsPortData = AssertPortData<NonNullable<Parameters<Engine["advance"]>[2]>>;
export type EngineSetBreakpointsParam0IsPortData = AssertPortData<Parameters<Engine["setBreakpoints"]>[0]>;

export type EngineAdvanceReturnIsPortData = AssertPortData<ReturnType<Engine["advance"]>>;
export type EngineDrawListReturnIsPortData = AssertPortData<ReturnType<Engine["drawList"]>>;
export type EngineSurfacePixelsReturnIsPortData = AssertPortData<NonNullable<ReturnType<Engine["surfacePixels"]>>>;

// Exhaustive switches with a never default (AD-3, AD-5, AD-14, AD-16).
export function checkInputEventExhaustive(kind: InputEvent["kind"]): void {
  switch (kind) {
    case "key":
    case "pointer":
    case "pointer.cancel":
    case "gamepad":
    case "action":
    case "host.features":
    case "host.display":
    case "host.gamepads":
    case "focus":
    case "asset":
    case "blob.loaded":
    case "blob.saved":
    case "blob.listed":
    case "extension.result":
    case "audio.ended":
    case "video.ended":
      return;
    default: {
      const _exhaustiveCheck: never = kind;
      return _exhaustiveCheck;
    }
  }
}

export function checkRunnerRequestExhaustive(kind: RunnerRequest["kind"]): void {
  switch (kind) {
    case "asset":
    case "loadBlob":
    case "saveBlob":
    case "listBlobs":
    case "extension.call":
    case "quit":
    case "openUrl":
    case "playVideo":
    case "prefetch":
      return;
    default: {
      const _exhaustiveCheck: never = kind;
      return _exhaustiveCheck;
    }
  }
}

export function checkDrawCommandExhaustive(kind: DrawCommand["kind"]): void {
  switch (kind) {
    case "blit":
    case "fill":
    case "line":
    case "rect":
    case "ellipse":
    case "text":
    case "pushTarget":
    case "popTarget":
      return;
    default: {
      const _exhaustiveCheck: never = kind;
      return _exhaustiveCheck;
    }
  }
}

export function checkAudioCueKindExhaustive(kind: AudioCueKind): void {
  switch (kind) {
    case "media.load":
    case "media.play":
    case "media.stop":
    case "media.pause":
    case "media.resume":
    case "media.seek":
    case "media.volume":
    case "media.fade":
    case "media.flags":
    case "soundfont.set":
      return;
    default: {
      const _exhaustiveCheck: never = kind;
      return _exhaustiveCheck;
    }
  }
}

export function checkBlendExhaustive(blend: Blend): void {
  switch (blend) {
    case "normal":
    case "additive":
    case "translucent":
      return;
    default: {
      const _exhaustiveCheck: never = blend;
      return _exhaustiveCheck;
    }
  }
}

export function checkBlobAreaExhaustive(area: BlobArea): void {
  switch (area) {
    case "saves":
    case "files":
      return;
    default: {
      const _exhaustiveCheck: never = area;
      return _exhaustiveCheck;
    }
  }
}

export function checkFocusStateExhaustive(state: FocusInput["state"]): void {
  switch (state) {
    case "lost":
    case "gained":
      return;
    default: {
      const _exhaustiveCheck: never = state;
      return _exhaustiveCheck;
    }
  }
}

// Value literals pinning every AD-named shape.
export const pinTickReport: TickReport = {
  ticksRun: 1,
  tickAfter: 1,
  consumed: [
    {
      tick: 0,
      event: {
        kind: "key",
        name: "A",
        code: "KeyA",
        char: null,
        down: true,
      },
    },
  ],
  audioCues: [
    {
      cueId: 1,
      tick: 0,
      kind: "soundfont.set",
      track: null,
      voice: null,
      asset: null,
      loop: null,
      flags: null,
      positionTicks: null,
      volume: null,
      targetVolume: null,
      durationTicks: null,
    },
  ],
  requests: [
    {
      kind: "quit",
      reqId: 1,
    },
  ],
  diagnostics: [
    {
      code: "E001",
      file: "main.prg",
      line: 42,
      message: "syntax error",
    },
  ],
  loading: false,
  paused: {
    thread: 1,
    frame: 2,
    line: 10,
  },
  stateHash: "0000000000000000",
};

export const pinTickReportEmpty: TickReport = {
  ticksRun: 0,
  tickAfter: 0,
  consumed: [],
  audioCues: [],
  requests: [],
  diagnostics: [],
  loading: false,
  paused: null,
  stateHash: "0000000000000000",
};

export const pinSurfacePixels: SurfacePixels = {
  w: 320,
  h: 240,
  rgba: new Uint8Array(),
};

export const pinAudioCueWithOptionals: AudioCue = {
  cueId: 1,
  tick: 0,
  kind: "media.play",
  track: "music",
  voice: 0,
  asset: "music/track.wav" as AssetKey,
  loop: true,
  flags: 1,
  positionTicks: 0,
  volume: 80,
  targetVolume: null,
  durationTicks: null,
};

export const pinAudioCueWithoutOptionals: AudioCue = {
  cueId: 2,
  tick: 12,
  kind: "media.stop",
  track: "music",
  voice: 0,
  asset: null,
  loop: null,
  flags: null,
  positionTicks: null,
  volume: null,
  targetVolume: null,
  durationTicks: null,
};

export const pinAssetRequest: AssetRequest = {
  kind: "asset",
  reqId: 1,
  key: "hero.png" as AssetKey,
};

export const pinLoadBlobRequest: LoadBlobRequest = {
  kind: "loadBlob",
  reqId: 2,
  blob: { area: "saves", path: "slot1.sav" },
};

export const pinSaveBlobRequest: SaveBlobRequest = {
  kind: "saveBlob",
  reqId: 3,
  blob: { area: "saves", path: "slot1.sav" },
  bytes: new Uint8Array([1]),
};

export const pinListBlobsRequest: ListBlobsRequest = {
  kind: "listBlobs",
  reqId: 4,
  area: "saves",
};

export const pinExtensionCallRequest: ExtensionCallRequest = {
  kind: "extension.call",
  reqId: 5,
  name: "fn",
  args: [],
};

export const pinQuitRequest: QuitRequest = {
  kind: "quit",
  reqId: 6,
};

export const pinOpenUrlRequest: OpenUrlRequest = {
  kind: "openUrl",
  reqId: 7,
  url: "https://example.com",
};

export const pinPlayVideoRequest: PlayVideoRequest = {
  kind: "playVideo",
  reqId: 8,
  key: "intro.mp4" as AssetKey,
  presentation: "full",
};

export const pinPrefetchRequest: RunnerRequest = {
  kind: "prefetch",
  reqId: 9,
  hints: [{ tier: "now", key: "media/town.mid" as AssetKey }, { tier: "always", key: "media/move.wav" as AssetKey }],
};

export const pinKeyInputWithChar: KeyInput = {
  kind: "key",
  name: "A",
  code: "KeyA",
  char: "a",
  down: true,
};

export const pinKeyInputWithoutChar: KeyInput = {
  kind: "key",
  name: "B",
  code: "KeyB",
  char: null,
  down: true,
};

export const pinPointerInput: PointerInput = {
  kind: "pointer",
  x: 10,
  y: 20,
  buttons: 1,
};

export const pinPointerCancelInput: PointerCancelInput = {
  kind: "pointer.cancel",
};

export const pinGamepadInput: GamepadInput = {
  kind: "gamepad",
  device: 0,
  connected: true,
  axes: { x: 0, y: 0 },
  buttons: 0,
};

export const pinFocusInput: FocusInput = {
  kind: "focus",
  state: "lost",
};

export const pinAssetReplyBytes: AssetReply = {
  kind: "asset",
  reqId: 1,
  bytes: new Uint8Array([1, 2]),
};

export const pinAssetReplyNull: AssetReply = {
  kind: "asset",
  reqId: 1,
  bytes: null,
};

export const pinBlobLoadedBytes: BlobLoaded = {
  kind: "blob.loaded",
  reqId: 2,
  bytes: new Uint8Array([3, 4]),
};

export const pinBlobLoadedNull: BlobLoaded = {
  kind: "blob.loaded",
  reqId: 2,
  bytes: null,
};

export const pinBlobSaved: BlobSaved = {
  kind: "blob.saved",
  reqId: 3,
  ok: true,
};

export const pinBlobListed: BlobListed = {
  kind: "blob.listed",
  reqId: 4,
  names: ["file1.txt"],
};

export const pinExtensionResult: ExtensionResult = {
  kind: "extension.result",
  reqId: 5,
  result: { x: 1 },
};

export const pinAudioEnded: AudioEnded = {
  kind: "audio.ended",
  cueId: 10,
};

export const pinVideoEnded: VideoEnded = {
  kind: "video.ended",
  reqId: 1,
};

export const pinTexRefWithTile: TexRef = {
  asset: "tiles.png" as AssetKey,
  tile: 1,
};

export const pinTexRefWithoutTile: TexRef = {
  asset: "bg.png" as AssetKey,
  tile: null,
};

export const pinBreakpoint: Breakpoint = {
  file: "script.prg",
  line: 15,
};

export const pinInputRecordPointer: InputRecord = {
  tick: 2,
  event: pinPointerInput,
};

export const pinBlitTexRefWithTile: BlitCommand = {
  kind: "blit",
  source: pinTexRefWithTile,
  src: { x: 0, y: 0, w: 16, h: 16 },
  dst: { x: 0, y: 0, w: 16, h: 16 },
  key: null,
  tint: { r: 0, g: 0, b: 0 },
  alpha: 255,
  blend: "normal",
  iso2d: false,
};

export const pinBlitSurfaceRef: BlitCommand = {
  kind: "blit",
  source: { surface: 1 as SurfaceId, rev: 2 },
  src: { x: 0, y: 0, w: 16, h: 16 },
  dst: { x: 0, y: 0, w: 16, h: 16 },
  key: { r: 255, g: 0, b: 255 },
  tint: { r: 10, g: -5, b: 0 },
  alpha: 200,
  blend: "additive",
  iso2d: true,
};

export const pinFill: FillCommand = {
  kind: "fill",
  rgb: { r: 0, g: 0, b: 0 },
};

export const pinLine: LineCommand = {
  kind: "line",
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 10,
  rgb: { r: 255, g: 255, b: 255 },
};

export const pinRect: RectCommand = {
  kind: "rect",
  rect: { x: 0, y: 0, w: 20, h: 20 },
  rgb: { r: 255, g: 0, b: 0 },
  filled: true,
};

export const pinEllipse: EllipseCommand = {
  kind: "ellipse",
  rect: { x: 0, y: 0, w: 30, h: 30 },
  rgb: { r: 0, g: 255, b: 0 },
  filled: false,
};

export const pinText: TextCommand = {
  kind: "text",
  x: 10,
  y: 20,
  text: "Hello",
  font: { asset: "font.ttf" as AssetKey, size: 8, bold: false, italic: false },
  rgb: { r: 255, g: 255, b: 255 },
  advances: [{ glyph: 65, advance: 8 }],
};

export const pinPushTarget: PushTargetCommand = {
  kind: "pushTarget",
  scratch: 1 as ScratchId,
};

export const pinPopTarget: PopTargetCommand = {
  kind: "popTarget",
};

export const pinDrawList: DrawList = {
  tick: 0,
  width: 320,
  height: 240,
  commands: [pinFill, pinBlitTexRefWithTile, pinBlitSurfaceRef],
  marginCommands: [],
};

// Conforming Engine object and call verification (Item 4).
export const conformingEngine: Engine = {
  advance(_ticks: number, _inputs: readonly InputRecord[], _maxTicks?: number): TickReport {
    return pinTickReport;
  },
  drawList(_alpha?: number): DrawList {
    return pinDrawList;
  },
  customTouchControlsDeclared(): boolean { return false; },
  hostFeatures() { return { touch: false, pointer: "none", keyboard: true, gamepad: false, haptics: false, orientation: null }; },
  accessibilityTree() { return []; },
  hostDisplayGeometry() { return { content: { width: 320, height: 240 }, game: { x: 0, y: 0, width: 320, height: 240 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }; },
  surfaceCacheEpoch() { return 0; },
  registeredActionNames() { return []; },
  registerGameAction() { return true; },
  setPointerMovementSuppressed() {},
  reportUnknownAction() {},
  runnerControlPointerPreemption() { return null; },
  surfacePixels(_id: SurfaceId, _rev: number): SurfacePixels | null {
    return pinSurfacePixels;
  },
  picturePixels(_key: AssetKey): SurfacePixels | null {
    return pinSurfacePixels;
  },
  recoveryCandidate() {
    return null;
  },
  resumeRecovery(): boolean {
    return false;
  },
  recoveryStatus() {
    return "none";
  },
  setBreakpoints(_breakpoints: readonly Breakpoint[]): void {
    // no-op
  },
};

export function testConformingEngineCall(engine: Engine): void {
  engine.advance(1, []);
  engine.advance(1, [], 4);
  engine.drawList();
  engine.drawList(0);
  engine.customTouchControlsDeclared();
  engine.hostFeatures();
  engine.hostDisplayGeometry();
  engine.accessibilityTree();
  const _pixels: SurfacePixels | null = engine.surfacePixels(0 as SurfaceId, 1);
  engine.recoveryCandidate();
  engine.setBreakpoints([]);
  engine.registeredActionNames();
  engine.registerGameAction({ name: "game.fixture", label: "Fixture", icon: null, group: null, controls: [], locked: false, hidden: false });
  engine.setPointerMovementSuppressed(true);
  engine.reportUnknownAction("game.missing");
}
