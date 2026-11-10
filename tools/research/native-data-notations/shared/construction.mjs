// #1778 shared-model comparison: the agreed representative construction.
//
// The two independent investigations each proposed their own logical model, so
// their notation results could not be compared directly. This module defines ONE
// construction, covering every item the ticket lists, and both investigators'
// adapter sets are driven with the identical value.
//
// Every value here is authored or deterministically generated. No recovered game
// content, media or program is included; the corpus evidence lives in each
// investigator's own projection.
//
// Deterministic by construction: no clock, no randomness, no floating-point
// accumulation. `buildSharedConstruction()` returns the same value every run.

const INLINE_CODE = [
  '"Halt! Who goes there?" asked the gatekeeper.',
  'mwin("Halt! Who goes there?");',
  'itemPath("source", tkMV_WAYPOINT_LINK, "patrol", 0);',
  '// backslash \\ and a quoted "word" and a delimiter-like """triple""" plus |pipe|',
  "// single 'quotes', a tab\there, and C:\\Games\\Project\\Prg\\relief.prg",
  'if (getVar("gateOpen") = 1) then { send("hall", 32, 96, 1); }',
].join('\n');

const UNICODE = 'Séverine — 守门人';

/** A substantial, deterministic tile layer: WIDTH×HEIGHT cells on each layer. */
const TILE_WIDTH = 48;
const TILE_HEIGHT = 36;
const TILE_LAYERS = 3;

/** Seeded generator (no Math.random): xorshift32 over a fixed seed. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
}

function tileRows(layer, width, height) {
  const next = seeded(0x9e3779b9 ^ (layer * 0x85ebca6b));
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      // Mostly a border/wall pattern so the data is plausible, with seeded
      // variation in the interior. Values are palette indices, 1..4.
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(border ? 1 : layer === 0 ? 2 + (next() % 2) : 3 + (next() % 2));
    }
    rows.push(row);
  }
  return rows;
}

export function buildSharedConstruction() {
  const layers = [];
  for (let layer = 0; layer < TILE_LAYERS; layer++) {
    layers.push({ layer: layer + 1, name: ['ground', 'objects', 'overhead'][layer], rows: tileRows(layer + 1, TILE_WIDTH, TILE_HEIGHT) });
  }

  return {
    /** Every separately meaningful document, keyed by its authored path. */
    documents: {
      // 1. An actor definition.
      'actors/gatekeeper': {
        kind: 'actor',
        id: 'gatekeeper',
        name: UNICODE,
        presence: {
          clips: { walk: { south: 'gatekeeper/walk-south', north: 'gatekeeper/walk-north' } },
          timing: { secondsPerFrame: 0.15, idleAfterSeconds: 3, idleSpeed: 0.30000000000000004 },
          collision: [[-15, -15], [15, -15], [15, 0], [-15, 0]],
          activation: [[-24, -24], [24, -24], [24, 8], [-24, 8]],
        },
        behaviour: { onActivate: { program: 'scripts/gatekeeper.prg' } },
        // 8. Namespaced plugin properties (a plugin whose schema is present).
        extensions: {
          'com.example.weather': { version: 1, precipitation: 'rain', intensity: 0.25, windFrom: [-1, 0] },
          // A plugin whose schema is absent, holding content a mapping must keep
          // intact — including an object that happens to look like a null marker.
          'org.example.unknown-plugin': { deep: [1, { $null: true }, -1, 65535], nested: { 'a b': 2, 'x/y': 3 } },
        },
      },

      // 2. Several scene placements of that actor (explicit, stable identities).
      'scenes/courtyard/scene': {
        kind: 'scene',
        id: 'courtyard',
        size: { width: TILE_WIDTH, height: TILE_HEIGHT, layers: TILE_LAYERS },
        tiles: 'tiles',
        background: { colour: [0, 0, 0], music: 'media/audio/courtyard.ogg' },
        start: [96, 96, 1],
        // 6. Geometry: regions and triggers with polygon vertices.
        regions: [
          { id: 'north-wall', kind: 'solid', layer: 1, closed: true, points: [[0, 0], [192, 0], [192, 32], [0, 32]] },
          { id: 'patrol', kind: 'waypoint', layer: 1, closed: false, points: [[48, 64], [144, 64], [144, 112]] },
        ],
        triggers: [
          { id: 'to-hall', layer: 1, area: [[160, 96], [192, 96], [192, 128], [160, 128]], run: { inline: 'send("hall", 32, 96, 1);' }, activation: { onKey: false } },
        ],
        placements: [
          // 7. Inline RPGCode on a placement.
          { id: 'gatekeeper-1', actor: 'gatekeeper', at: [64, 96, 1], whilePresent: { inline: INLINE_CODE } },
          // 7. An external program reference on a sibling placement.
          { id: 'gatekeeper-2', actor: 'gatekeeper', at: [128, 96, 1], onActivate: { program: 'scripts/gatekeeper-relief.prg' } },
          { id: 'gatekeeper-3', actor: 'gatekeeper', at: [160, 96, 1], onActivate: { program: null } },
        ],
        extensions: { 'com.example.patrol': { version: 1, radius: 4, notes: 'walks the north wall' } },
      },

      // 6. Geometry and a substantial tile layer, as a sibling document.
      'scenes/courtyard/tiles': {
        kind: 'tile-layers',
        scene: 'courtyard',
        size: { width: TILE_WIDTH, height: TILE_HEIGHT },
        palette: [
          { index: 1, tileset: 'stone', tile: 3 },
          { index: 2, tileset: 'stone', tile: 7 },
          { index: 3, animation: 'fountain' },
          { index: 4, tileset: 'people', tile: 12 },
        ],
        layers,
      },

      // 3. An inventory item and an illustrative skill grant (PROPOSED, not a
      // legacy field: no legacy property was found that grants a skill).
      'items/ember-staff': {
        kind: 'item',
        id: 'ember-staff',
        name: 'Ember Staff',
        description: 'Warm to the touch. Teaches Spark while held ready.',
        value: { buy: 400, sell: 200 },
        equip: { slots: [null, 'right-hand', null], bonus: { hp: 0, dp: 0, fp: 6, smp: 4 } },
        grants: [{ skill: 'spark', while: 'equipped' }],
      },

      // 4. A skill with an actor-specific performance binding.
      'skills/spark': {
        kind: 'skill',
        id: 'spark',
        name: 'Spark',
        description: 'A small arc of light that stings one foe.',
        cost: { smp: 4 },
        power: 18,
        usable: { battle: true, menu: false },
        presentation: { clip: 'effects/spark' },
        perform: { 'actor:mira': { clip: 'mira/cast-spark', stance: 'special' } },
      },

      // 5. An ordered presentation clip.
      'clips/gatekeeper/walk-south': {
        kind: 'clip',
        id: 'gatekeeper/walk-south',
        size: [32, 64],
        secondsPerFrame: 0.15,
        frames: [
          { id: 'step-left', tile: { tileset: 'people', tile: 12 }, transparent: [255, 0, 255] },
          { id: 'stand', tile: { tileset: 'people', tile: 13 }, transparent: [255, 0, 255] },
          { id: 'step-right', tile: { tileset: 'people', tile: 14 }, transparent: [255, 0, 255], sound: 'media/audio/step.wav' },
        ],
      },
      'clips/mira/cast-spark': {
        kind: 'clip',
        id: 'mira/cast-spark',
        size: [32, 64],
        secondsPerFrame: 0.1,
        frames: [
          { id: 'raise', tile: { tileset: 'people', tile: 44 } },
          { id: 'release', tile: { tileset: 'people', tile: 45 }, sound: 'media/audio/zap.wav' },
        ],
      },
    },
  };
}

export const SHARED_CONSTRUCTION_META = {
  tileWidth: TILE_WIDTH,
  tileHeight: TILE_HEIGHT,
  tileLayers: TILE_LAYERS,
  tileCells: TILE_WIDTH * TILE_HEIGHT * TILE_LAYERS,
  inlineCodeLines: INLINE_CODE.split('\n').length,
};
