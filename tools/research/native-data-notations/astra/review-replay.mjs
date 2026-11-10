// Replays the reviewer-proven failure modes against the corrected implementation.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAdapters, inspect } from './inspect.mjs';
import { renameActor, unresolvedActorReferences } from './semantic-checks.mjs';
const scratch = process.argv[2];
const { adapters } = await loadAdapters(scratch);
const fixture = JSON.parse(readFileSync(join(scratch, 'fixtures/Caoquest.json'), 'utf8'));
const clone = value => structuredClone(value);
const results = {};

// Review repro "reference": rename actor, catalogue and placements only.
const stale = clone(fixture), oldId = stale.actor.id, newId = oldId + '-renamed';
stale.actor.id = newId;
stale.actorCatalogue = stale.actorCatalogue.map(id => id === oldId ? newId : id);
for (const placement of stale.scene.placements) if (placement.actor === oldId) placement.actor = newId;
const file = join(scratch, 'post-review/review-replay-stale.yaml'); writeFileSync(file, adapters.YAML.encode(stale));
const verdict = await inspect(scratch, 'YAML', file);
assert.equal(verdict.schemaValid, true);
assert(verdict.unresolvedReferences.some(r => r.path === '/designExample/performance/actor' && r.missing === oldId));
results.stalePerformanceRepro = { schemaValid: verdict.schemaValid, errors: verdict.errors, unresolvedReferences: verdict.unresolvedReferences };

// Complete rename must leave nothing unresolved.
const complete = clone(fixture); const rewritten = renameActor(complete, fixture.actor.id, fixture.actor.id + '-full');
assert.deepEqual(unresolvedActorReferences(complete), []);
results.completeRename = { rewrittenReferences: rewritten, designExamplePerformance: complete.designExample.performance.actor };

// Review repro "edge follow-up": NUL must now be an explicit rejection, not an accepted document.
const nul = () => adapters.XML.encode({ payload: 'a\u0000b' });
assert.throws(nul, /XML10_FORBIDDEN_CHARACTER U\+0000/);
results.xmlNulEncode = { rejected: true, message: (() => { try { nul(); } catch (error) { return String(error); } })() };
assert.throws(() => adapters.XML.decode('<v type="boolean">treu</v>'), /XML_BOOLEAN_LEXICAL_VALUE/);
results.xmlBooleanTypo = { rejected: true };

// The actual clean same-ID merge artifacts must be rejected by the checker.
results.duplicateMerges = {};
for (const name of ['JSON', 'YAML', 'KDL', 'TOML', 'JSON5', 'Hjson', 'EDN', 'XML', 'SDLang', 'RON']) {
  results.duplicateMerges[name] = {};
  for (const label of ['same-id-placement-disjoint', 'same-id-frame-disjoint']) {
    const merged = join(scratch, 'results', name, label + '.merged');
    const source = readFileSync(merged, 'utf8');
    const conflict = source.includes('<<<<<<<');
    const check = conflict ? null : await inspect(scratch, name, merged);
    if (check) assert(conflict || check.errors.some(e => e.keyword === 'uniqueIdentity'));
    results.duplicateMerges[name][label] = conflict ? 'textual conflict (no merged document)' : check.errors.filter(e => e.keyword === 'uniqueIdentity');
  }
}
writeFileSync(join(scratch, 'review-replay-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
