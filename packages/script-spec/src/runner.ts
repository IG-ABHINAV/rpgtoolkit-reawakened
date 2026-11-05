/**
 * The spec runner (TOOL-5): `*.spec.prg` discovery, a fresh fixture per case,
 * determinism, and the strict/`only` modes.
 *
 * Each case is isolated by re-running the spec file once with the library's
 * `specOnlyCase` global set, so every case starts from a fresh `GameState` and
 * cannot see or leak state to its neighbour. Two runs of the same case must
 * produce the same outcomes and the same state hash.
 */

import { readFileSync } from "node:fs";
import {
  addActor,
  assetKey,
  advanceScriptTick,
  createAssetIndex,
  createGameState,
  createScriptServices,
  drainDiagnostics,
  drainEffects,
  fileProgramRef,
  hashGameState,
  PACKAGE_ROOT,
  startProgram,
  STEP_BUDGET,
  encodeCp1252,
  utf8Encode,
  type ProgramLoader,
  type ScriptServices,
  type GameState,
} from "@tk-reawakened/core";
import { SPEC_PLUGIN } from "./index.ts";

/**
 * TOOL-5 — "the API is a package, not a set of engine built-ins … a program that
 * wants them includes or loads the package" (docs/spec/engine/rpgcode-tooling.md#tool-5).
 * Loading waits on PKG-7 (a proposed ruling) and a package's script functions
 * are not reachable by an unqualified name today, so the runner uses the
 * documented **include** branch: the library is served as an includable unit of
 * the project's `Prg/` view. `#include` merges only functions and is collected
 * wherever it appears (MOD rules, docs/spec/engine/rpgcode-modules-and-objects.md),
 * so it sits after the spec's own text: every spec statement keeps its authored
 * line and positions come from the compiled units, not an offset guess.
 */
const PACKAGE_STARTUP = readFileSync(new URL("../package/startup.prg", import.meta.url), "utf8");
const SPEC_PROGRAM = "__spec.prg";
const LIBRARY_INCLUDE = "script-spec/startup.prg";
const LIBRARY_PATH = `Prg/${LIBRARY_INCLUDE}`;
const SPEC_FILE_KEY = assetKey(`Prg/${SPEC_PROGRAM}`);

/** The project loader plus this spec file and the includable library unit. */
function specLoader(base: ProgramLoader | undefined, source: string): ProgramLoader {
  const specPath = `Prg/${SPEC_PROGRAM}`;
  const specKey = assetKey(specPath);
  const libraryKey = assetKey(LIBRARY_PATH);
  // Program bytes are Windows-1252 (docs/spec/formats/rpgcode-program.md), so the
  // source the project already decoded is encoded back with the same codec; the
  // bundled library is converted the same way, not UTF-8.
  const specEncoded = encodeCp1252(`${source}\n#include "${LIBRARY_INCLUDE}"\n`);
  const libraryEncoded = encodeCp1252(PACKAGE_STARTUP);
  if (!specEncoded.ok) throw new Error(`spec source is not Windows-1252: ${specEncoded.error.message}`);
  if (!libraryEncoded.ok) throw new Error(`the bundled spec library is not Windows-1252: ${libraryEncoded.error.message}`);
  const specBytes = specEncoded.value;
  const libraryBytes = libraryEncoded.value;
  return {
    index: createAssetIndex([...(base?.index.paths ?? []), specPath, LIBRARY_PATH]),
    root: base?.root ?? PACKAGE_ROOT,
    read: (candidate) => {
      if (candidate === specKey) return specBytes;
      if (candidate === libraryKey) return libraryBytes;
      return base?.read(candidate);
    },
  };
}

export type SpecOutcomeKind = "pass" | "fail" | "skip" | "only";

export type SpecOutcome = {
  readonly kind: SpecOutcomeKind;
  /** `<case>/<matcher>` as the library records it. */
  readonly label: string;
  readonly expected: string;
  readonly actual: string;
  readonly line: number;
  readonly column: number;
};

export type SpecCaseResult = {
  readonly name: string;
  readonly outcomes: readonly SpecOutcome[];
  /** Strict: only passes count. Lenient: a skip is tolerated and still reported. */
  readonly ok: boolean;
  /** `hashGameState` after the case's run. */
  readonly stateHash: string;
};

export type SpecFileReport = {
  readonly file: string;
  readonly cases: readonly SpecCaseResult[];
  readonly skipped: readonly string[];
  /** `only` narrowed the run; the text is stable. */
  readonly warning: string | null;
  readonly failures: readonly string[];
};

export type SpecRunOptions = {
  /** Seed for the fixture's injected RNG (default 0). */
  readonly seed?: number;
  /** A skip fails the run unless this is `false` (default `true`). */
  readonly strict?: boolean;
  /** Optional project program loader for includes made by the spec. */
  readonly loader?: ProgramLoader;
};

export const ONLY_WARNING = "only() narrowed the run to the marked cases; unmarked cases were not run";

const OUTCOME_KINDS = new Set(["pass", "fail", "skip", "only"]);

type IsolatedRun = {
  readonly outcomes: SpecOutcome[];
  readonly hash: string;
  readonly errors: readonly { readonly code: string; readonly message: string; readonly line: number }[];
};

function runIsolated(source: string, onlyCase: number, seed: number, collect = false, loader?: ProgramLoader): IsolatedRun {
  const state: GameState = createGameState({ seed });
  state.world = {
    ...state.world,
    board: {
      key: assetKey("boards/spec-fixture.brd"), coordType: 0,
      sizeX: 1, sizeY: 1, sizeL: 1, width: 32, height: 32,
      background: { r: 0, g: 0, b: 0 }, ambient: { r: 0, g: 0, b: 0 }, layers: [],
    },
  };
  const actor = addActor(state.actors, { kind: "party", source: "spec-fixture.tem", stats: { hp: 10, maxHp: 10 } });
  state.party.members.push(actor.id);
  state.party.selected = actor.id;
  // The library reaches the program by `#include`, so the spec keeps its own lines.
  // The record carries `specResult`'s own library position, not the assertion's,
  // so the spec-file line is captured where the handler runs and keyed by the
  // effect sequence the call is about to take: the effect log may evict records,
  // so pairing by array index would silently drift.
  const positions = new Map<number, { line: number; column: number }>();
  state.vm.globals.speconlycase = onlyCase + 1;
  state.vm.globals.speccollect = collect ? 1 : 0;
  const specProgram = specLoader(loader, source);
  const specRef = fileProgramRef(specProgram, SPEC_PROGRAM);
  startProgram(state.vm, specRef);
  const services: ScriptServices = createScriptServices(state, [{ definition: SPEC_PLUGIN }], undefined, undefined, specProgram,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      postHandler: (handler, threadId) => {
        if (handler.plugin !== "script-spec" || handler.name !== "specresult") return;
        const seq = state.vm.effectSeq + 1;
        const thread = state.vm.threads.find((item) => item.id === threadId);
        for (let index = (thread?.frames.length ?? 0) - 1; index >= 0; index -= 1) {
          const frame = thread!.frames[index]!;
          // Included code is part of the same compiled program, so the position's
          // own file is what separates a spec statement from a library statement.
          const op = services.programs.get(frame.program).ops[frame.ip - 1];
          if (op !== undefined && specRef.kind === "file" && op.pos.file === SPEC_FILE_KEY) {
            positions.set(seq, { line: op.pos.line, column: op.pos.col ?? 0 });
            return;
          }
        }
      },
    });
  let finished = false;
  for (let step = 0; step < 1000; step += 1) {
    if (advanceScriptTick(state, services, STEP_BUDGET) === "finished") {
      finished = true;
      break;
    }
  }
  const errors = drainDiagnostics(services).map((error) => ({
    code: error.code,
    message: error.message,
    line: error.line,
  }));
  if (!finished) errors.push({ code: "spec.timeout", message: "spec did not finish within 1000 ticks", line: 0 });
  const outcomes: SpecOutcome[] = [];
  for (const record of drainEffects(state.vm)) {
    if (record.name !== "specresult") continue;
    const kind = String(record.args[0] ?? "");
    if (!OUTCOME_KINDS.has(kind)) continue;
    const position = positions.get(record.seq);
    outcomes.push({
      kind: kind as SpecOutcomeKind,
      label: String(record.args[1] ?? ""),
      expected: String(record.args[2] ?? ""),
      actual: String(record.args[3] ?? ""),
      line: position?.line ?? 0,
      column: position?.column ?? 0,
    });
  }
  return { outcomes, hash: hashGameState(state), errors };
}

/** `<matcher>: expected X, actual Y`, the message a failing case reports verbatim. */
export function failureMessage(outcome: SpecOutcome): string {
  const slash = outcome.label.lastIndexOf("/");
  const matcher = slash < 0 ? outcome.label : outcome.label.slice(slash + 1);
  return `${matcher}: expected ${outcome.expected}, actual ${outcome.actual}`;
}

type DiscoveredCase = { readonly name: string; readonly kind: "normal" | "skip" | "only" };

function collectCases(source: string, seed: number, loader?: ProgramLoader): DiscoveredCase[] {
  const discovery = runIsolated(source, -1, seed, true, loader);
  if (discovery.errors.length > 0) {
    const error = discovery.errors[0]!;
    throw new Error(`spec discovery failed at line ${error.line} (${error.code}): ${error.message}`);
  }
  return discovery.outcomes
    .filter((outcome) => outcome.kind === "pass" && outcome.expected === "case"
      && (outcome.actual === "normal" || outcome.actual === "skip" || outcome.actual === "only"))
    .map((outcome) => ({ name: outcome.label, kind: outcome.actual as DiscoveredCase["kind"] }));
}

/** The registered cases in source order, without executing their bodies. */
export function discoverCases(source: string, seed = 0, loader?: ProgramLoader): string[] {
  return collectCases(source, seed, loader).map((item) => item.name);
}

/** Whether the file registers at least one focused case, without running cases. */
export function hasOnlyCases(source: string, seed = 0, loader?: ProgramLoader): boolean {
  return collectCases(source, seed, loader).some((item) => item.kind === "only");
}

/** Run one spec file: every case on a fresh fixture, twice, and compare. */
export function runSpecFile(file: string, source: string, options: SpecRunOptions): SpecFileReport {
  const seed = options.seed ?? 0;
  const strict = options.strict ?? true;
  const discovered = collectCases(source, seed, options.loader);
  const onlySeen = discovered.some((item) => item.kind === "only");
  const cases: SpecCaseResult[] = [];
  const skipped: string[] = [];
  const failures: string[] = [];
  discovered.forEach(({ name, kind }, index) => {
    if (onlySeen && kind !== "only") return;
    const first = runIsolated(source, index, seed, false, options.loader);
    const second = runIsolated(source, index, seed, false, options.loader);
    if (first.hash !== second.hash) {
      throw new Error(`${name}: two runs gave different state hashes (${first.hash} vs ${second.hash})`);
    }
    if (JSON.stringify(first.outcomes) !== JSON.stringify(second.outcomes)
      || JSON.stringify(first.errors) !== JSON.stringify(second.errors)) {
      throw new Error(`${name}: two runs gave different outcomes`);
    }
    if (kind === "skip") skipped.push(name);
    const outcomes = [...first.outcomes];
    for (const error of first.errors) {
      outcomes.push({ kind: "fail", label: `${name}/runtime error`, expected: "no runtime error", actual: `${error.code}: ${error.message}`, line: error.line, column: 0 });
    }
    // A case that records nothing has tested nothing: it must not read as healthy.
    const ok = outcomes.length > 0
      && outcomes.every((outcome) => outcome.kind === "pass" || outcome.kind === "only" || (!strict && outcome.kind === "skip"));
    if (outcomes.length === 0) failures.push(`${file}: ${name}: recorded no assertion`);
    if (kind === "skip" && strict) failures.push(`${file}: ${name}: skipped in strict mode`);
    for (const outcome of outcomes) if (outcome.kind === "fail") failures.push(`${file}: ${name}: ${failureMessage(outcome)} (line ${outcome.line})`);
    cases.push({ name, outcomes, ok, stateHash: first.hash });
  });
  return { file, cases, skipped, warning: onlySeen ? ONLY_WARNING : null, failures };
}
