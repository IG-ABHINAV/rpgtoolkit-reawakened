/** Saveable trigger state (E-40..E-45, R-52; AD-10). */

export const TRIGGERS_SCHEMA_VERSION = 2;

export type TriggerActive = {
  key: string;
  thread: number;
  setVar: string;
  setValue: string;
  source: "item" | "region";
  /** A trigger program can enqueue movement that must not retrigger anything. */
  silentMovement: boolean;
};

/** Runtime state for board activation dispatch. Every field is plain JSON data. */
export type TriggersSection = {
  version: number;
  boardKey: string | null;
  /** A key is fired for step/repeat re-arm and for diagnostics. */
  fired: { [key: string]: boolean };
  /** Distance accumulated since the last repeat firing, in board pixels. */
  repeat: { [key: string]: number };
  /** `gone()` suppression, scoped to the active board. */
  suppressed: string[];
  /** Arrival deactivation prevents an immediate trigger at a send destination. */
  deactivated: string[];
  deactivateAt: { x: number; y: number; layer: number } | null;
  active: TriggerActive | null;
  /** Highest processed key sequence; -1 marks the first free-roam frame after boot. */
  lastKeySeq: number;
  silentUntilIdle: boolean;
};

export function createTriggersSection(): TriggersSection {
  return {
    version: TRIGGERS_SCHEMA_VERSION,
    boardKey: null,
    fired: {},
    repeat: {},
    suppressed: [],
    deactivated: [],
    deactivateAt: null,
    active: null,
    lastKeySeq: 0,
    silentUntilIdle: false,
  };
}

export function resetTriggersSection(section: TriggersSection): void {
  const fresh = createTriggersSection();
  section.version = fresh.version;
  section.boardKey = fresh.boardKey;
  section.fired = fresh.fired;
  section.repeat = fresh.repeat;
  section.suppressed = fresh.suppressed;
  section.deactivated = fresh.deactivated;
  section.deactivateAt = fresh.deactivateAt;
  section.active = fresh.active;
  section.lastKeySeq = fresh.lastKeySeq;
  section.silentUntilIdle = fresh.silentUntilIdle;
}
