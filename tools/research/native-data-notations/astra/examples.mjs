// Entirely authored miniature; supplements, never substitutes for real game projections.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAdapters, inspect } from './inspect.mjs';
const scratch = process.argv[2];
const out = join(scratch, 'examples'); mkdirSync(out, { recursive: true });
const { adapters } = await loadAdapters(scratch);
const canonical = value => JSON.stringify(value, (_key, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
const data = {
  evidence: 'Authored illustration, not a recovered game or adopted native schema',
  actor: { id: 'actor:keeper', kind: 'actor', name: 'Keeper', presentation: 'presentation:keeper',
    movement: { speedSeconds: 0.15 }, skillPerformances: { 'skill:light': { clip: 'clip:gesture' } },
    extensions: { '@example/patrol': { schemaVersion: 1, radius: 6, notes: 'Actor-owned plugin data; core owns placement coordinates' }, '@missing/story': { schemaVersion: 7, untouched: ['future', null, { flag: true }] } } },
  scene: { id: 'scene:plaza', width: 4, height: 3, layers: 1,
    placements: [{ id: 'placement:east', actor: 'actor:keeper', x: 96, y: 32 }, { id: 'placement:west', actor: 'actor:keeper', x: 32, y: 32 }, { id: 'placement:gate', actor: 'actor:keeper', x: 64, y: 64 }],
    geometry: [{ id: 'region:gate', closed: true, points: [[0, 0], [32, 0], [32, 32], [0, 32]] }],
    tileLut: ['', 'stone.tst1'], tileRows: [{ id: 'layer:1/row:0', cells: [1, 1, 1, 1] }, { id: 'layer:1/row:1', cells: [1, 0, 0, 1] }, { id: 'layer:1/row:2', cells: [1, 1, 1, 1] }],
    triggers: [{ id: 'trigger:welcome', binding: { mode: 'inline', bindingId: 'hook:welcome', context: 'placement-interaction', program: null, source: 'mwin("Welcome, traveller");\n// path: C:\\games\\demo; café\n' } },
      { id: 'trigger:leave', binding: { mode: 'file', bindingId: 'hook:leave', context: 'placement-interaction', program: 'program:leave.prg', source: null } }] },
  presentation: { id: 'presentation:keeper', idle: 'clip:gesture', pixelPayload: 'Graphics/keeper.png' },
  clip: { id: 'clip:gesture', delaySeconds: 0.15, frames: [{ id: 'frame:a', graphic: 'keeper.tst1', sound: null }, { id: 'frame:b', graphic: 'keeper.tst2', sound: null }, { id: 'frame:c', graphic: 'keeper.tst3', sound: 'wave.wav' }] },
  item: { id: 'inventory:lantern', kind: 'inventory', name: 'Lantern', grants: [{ skill: 'skill:light', while: 'equipped' }] },
  skill: { id: 'skill:light', name: 'Light', cost: 3 },
  actorCatalogue: ['actor:keeper'],
};
const results = {};
for (const [name, adapter] of Object.entries(adapters)) {
  const path = join(out, 'keeper.' + adapter.ext);
  const text = adapter.comment + adapter.encode(data); writeFileSync(path, text);
  results[name] = { roundtrip: canonical(adapter.decode(text)) === canonical(data), objectKeyOrderEqual: JSON.stringify(adapter.decode(text)) === JSON.stringify(data), validation: await inspect(scratch, name, path) };
}
writeFileSync(join(out, 'leave.prg'), 'mwin("Safe travels");\n');
writeFileSync(join(out, 'core.schema.json'), readFileSync(join(scratch, 'schemas/core.json')));
writeFileSync(join(out, 'patrol-v1.schema.json'), readFileSync(join(scratch, 'schemas/patrol-v1.json')));
writeFileSync(join(scratch, 'examples-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
