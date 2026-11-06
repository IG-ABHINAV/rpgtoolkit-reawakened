// The movement oracle's producer entry point (ticket 5.2).
//
//   movementFixtureFiles() -> [relative name, bytes][]   the committed fixture bytes
//   checkMovementCorpus(root) -> string[]                 corpus pins, when the corpus is fetched
//   checkMovementImports() -> string[]                    static import scan: no packages/core
//
// Every scene is authored from docs/spec/engine/movement-and-collision.md (and the pages it
// cites) and its expected per-tick outcome facts are derived by this directory's own reference
// simulation. Nothing here imports packages/core, so a later core implementation cannot pass by
// sharing code with its oracle. State and draw hashes are deliberately absent: the consuming
// entries (5.4 onwards) assert those.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collisionSolidStairsUnder, collisionSpriteBlocking, edgesBoardLinkProgram, boardEntryThreadLifecycle, movementTilePixel } from "./scenes-a.mjs";
import { actorHydrationItemMultitask, pathfindingAxialDiagonalVector, triggersPrecedence } from "./scenes-b.mjs";
import { animationFallbackStance, demoNpcBattleTrigger, demoNpcPathfinding, inputReplayButtonSlots, movementWaits, randomEncounter } from "./scenes-c.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
export const MOVEMENT_OUT = join(repoRoot, "packages", "core", "test", "fixtures", "movement");

/** Proposed rulings the specification leaves open; each is recorded in the plan for owner review. */
export const PROPOSED = {
  "P-1": "Step cadence: the next queued step's first advance is one cadence slot after the previous advance; an idle sprite starts on the tick the command arrives.",
  "P-2": "Grid path nodes are the tile's bottom-centre reference point (32 cx + 16, 32 cy + 31); edges are checked by sweeping the base in 4 px samples.",
  "P-3": "A pixel-mode direction step moves 4 px on each axis in one advance; other advances use a Euclidean 4 px increment truncated to 1/256 px.",
  "P-4": "A step ends when its target is reached or passed (non-positive projection on the original direction); a blocked step ends alone and the next queued step continues.",
  "P-5": "R-54 slide: select the hit edge by canonically ordered endpoints independently of vertex order; the turned step has the same length, and the facing is the octant of its vector.",
  "P-6": "Triggers are evaluated when a player step completes and when the activation key is pressed; a repeat region fires on entry then every distanceRepeat px; losing candidates are not marked fired; re-arming is evaluated at step completion.",
  "P-7": "Item activation turns the item to face the player and clears the player's queue (E-43).",
  "P-8": "Trigger programs are modelled as ops (set, gone, abort, silentMove); silent movement locks trigger evaluation until the player's queue drains and evaluates nothing at the end.",
  "P-9": "An item hidden by its loading condition starts no thread; showing it later starts the thread and hiding or removing it stops the thread.",
  "P-10": "Random encounter: type 0 draws one integer in [0, chances) per tile moved and fights on 0; type 1 counts tiles; a fight draws a count 1 + [0, 4) then one index into the skill-level pool per enemy.",
  "P-11": "Edge arrival keeps the player's remaining queue on refusal and clears it on success; send() names a position in the destination board's own coordinate mode - one-based tiles at the tile's bottom-centre on a plain board, board pixels on a board that sets the pixel-coordinate flag; the layer is one-based.",
  "P-12": "With diagonals disabled, two held orthogonal directions move along the most recently pressed one.",
  "P-13": "Button slot hit-test is half-open [x, x + w) x [y, y + h); an enabled slot press is one key-queue entry for its action; a disabled slot swallows the click.",
  "P-14": "Animation: frame delays are round-half-up ticks (minimum 1); a state change resets the frame; idle starts after idleMs of no movement; a held stance releases when movement resumes.",
  "P-15": "Movement and key waits are polled in the `waits` phase, so a thread resumes on the tick after the movement completes; movement started from a blocking thread implies the wait.",
  "P-16": "Diversion and the pathfinder treat every other visible sprite on the layer as an obstacle; a route counts only if it reaches the goal; the 120-tick wait retests each tick.",
  "P-17": "Pathfinder conventions: step costs 10 (4-way) and 10 / 14 (8-way), Manhattan and octile heuristics, ties by (f, x, y, insertion); nearest free node by squared distance then (x, y); the capped search approaches the expanded node nearest the goal; vector mode handles axis-aligned solids and keeps the whole base on the board.",
  "P-18": "Gamepad edges are computed on the merged held state: an action already held by another source appends no queue entry.",
};

const SCENES = [
  ["movement-tile-pixel", movementTilePixel, ["P-1", "P-3", "P-4"]],
  ["collision-solid-stairs-under", collisionSolidStairsUnder, ["P-3", "P-4", "P-5"]],
  ["collision-sprite-blocking", collisionSpriteBlocking, ["P-16", "P-17"]],
  ["edges-board-link-program", edgesBoardLinkProgram, ["P-11"]],
  ["board-entry-thread-lifecycle", boardEntryThreadLifecycle, ["P-11"]],
  ["triggers-precedence", triggersPrecedence, ["P-6", "P-7", "P-8"]],
  ["actor-hydration-item-multitask", actorHydrationItemMultitask, ["P-9"]],
  ["pathfinding-axial-diagonal-vector", pathfindingAxialDiagonalVector, ["P-2", "P-17"]],
  ["input-replay-button-slots", inputReplayButtonSlots, ["P-12", "P-13", "P-18"]],
  ["movement-waits", movementWaits, ["P-15"]],
  ["animation-fallback-stance", animationFallbackStance, ["P-14"]],
  ["random-encounter", randomEncounter, ["P-6", "P-10"]],
  ["demo-npc-pathfinding", demoNpcPathfinding, ["P-10", "P-15", "P-17"]],
  ["demo-npc-battle-trigger", demoNpcBattleTrigger, ["P-15", "P-17"]],
];
export const SCENE_NAMES = SCENES.map(([name]) => name);

/**
 * The reachable corpus the two demo scenes model. The files are fetched at test time
 * (`pnpm fixtures:fetch`) and are never committed; only their digests and the few program
 * and asset names the scenes rely on are pinned here.
 */
export const CORPUS = {
  source: "chrisbmatthews/rpgtoolkit @ 9191b9191c9bda0998c6faae16929b3331ed2ead (fixtures/legacy/.fetched.json)",
  game: "demo",
  files: [
    { path: "Prg/man_wander.prg", sha256: "cc07a22a7c48f456e51e05500e657b5af865dd36a2b6fe5fad3bb1351bf39bb6", needs: ["intercept = 96", "range = 256", "tkMV_PAUSE_THREAD | tkMV_PATHFIND", "threadSleep(getThreadId(), 0.5)", 'run("man.prg")'] },
    { path: "Prg/man.prg", sha256: "61d666fc1272d0281c68d4845ad6e4af38d0d81232669f7e5a267b0576c185e0", needs: ['fightEnemy("pirate.ene", "bkg.bkg")'] },
  ],
  note: "The battle-trigger case is reachable in the corpus (man.prg calls fightEnemy), so no authored equivalent was needed. Board geometry is an authored stand-in: this generator decodes no legacy board or item file.",
};
const CORPUS_SCENES = new Set(["demo-npc-pathfinding", "demo-npc-battle-trigger"]);

const INLINE = 118;
const ONE_PER_LINE = new Set(["expect", "script", "boot"]);

/** Stable pretty-printer: short values inline, long ones indented, rows of facts one per line. */
function format(value, indent = "", key = "") {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value) && ONE_PER_LINE.has(key)) {
    if (value.length === 0) return "[]";
    const pad = `${indent}  `;
    return `[\n${value.map((v) => pad + JSON.stringify(v)).join(",\n")}\n${indent}]`;
  }
  const flat = JSON.stringify(value);
  if (flat.length <= INLINE) return flat;
  const pad = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => pad + format(v, pad)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${format(v, pad, k)}`).join(",\n")}\n${indent}}`;
}

function sceneDocument(name, build, proposed) {
  const scene = build();
  const doc = {
    scene: name,
    schema: 1,
    note: "Authored from docs/spec; expected facts are derived by tools/fixtures/movement, not by packages/core. No state or draw hashes: later entries assert those.",
    tick: "60 Hz fixed; phases input, waits, threads, events, movement, edges, triggers, animation, audio, time (AD-26); random encounters hand off from triggers.",
    units: "board pixels; fractions are exact multiples of 1/256",
    spec: scene.spec,
    proposed,
    ...(CORPUS_SCENES.has(name) ? { corpus: CORPUS } : {}),
    ...(scene.thresholds ? { thresholds: scene.thresholds } : {}),
    cases: scene.cases,
  };
  return doc;
}

/** Every committed movement fixture: `[file name, bytes]`, plus the manifest. */
export function movementFixtureFiles() {
  const docs = SCENES.map(([name, build, proposed]) => sceneDocument(name, build, proposed));
  const files = docs.map((doc) => [`${doc.scene}.json`, Buffer.from(`${format(doc)}\n`)]);
  const manifest = {
    schema: 1,
    scenes: docs.map((doc) => ({ scene: doc.scene, file: `${doc.scene}.json`, cases: doc.cases.map((c) => c.name), proposed: doc.proposed })),
    proposed: PROPOSED,
  };
  files.push(["manifest.json", Buffer.from(`${format(manifest)}\n`)]);
  return files;
}

/** When the legacy corpus has been fetched, prove the pinned programs are the ones the demo scenes model. */
export function checkMovementCorpus(root = repoRoot) {
  const base = join(root, "fixtures", "legacy", CORPUS.game);
  if (!existsSync(base)) return [];
  const problems = [];
  for (const file of CORPUS.files) {
    const path = join(base, file.path);
    if (!existsSync(path)) { problems.push(`corpus: ${file.path} is missing from ${base}`); continue; }
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== file.sha256) problems.push(`corpus: ${file.path} digest ${digest} is not the pinned ${file.sha256}`);
    const text = bytes.toString("latin1");
    for (const needle of file.needs) if (!text.includes(needle)) problems.push(`corpus: ${file.path} no longer contains \`${needle}\``);
  }
  return problems;
}

/** The import specifiers in `text` that reach a workspace package (packages/*, @tk-reawakened/*). */
export function workspaceImports(text) {
  const found = [];
  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) {
    const spec = match[1];
    if (/(^|[\\/])packages[\\/]/.test(spec) || /^@tk-reawakened[\\/]/.test(spec) || /(^|[\\/])core[\\/](src|dist)[\\/]/.test(spec)) found.push(spec);
  }
  return found;
}

/** Static import scan (ticket 5.2 verification): no oracle module or the generator may reach packages/core. */
export function checkMovementImports() {
  const files = [...readdirSync(here).filter((f) => f.endsWith(".mjs")).map((f) => join(here, f)), join(here, "..", "author", "generate.mjs")];
  return files.flatMap((file) => workspaceImports(readFileSync(file, "utf8")).map((spec) => `${file}: imports ${spec}`));
}
