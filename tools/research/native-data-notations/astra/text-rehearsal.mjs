// Corpus-specific literal text copy/edit rehearsal, not a parser or general editor.
// Copies a real placement block between two observed stable-ID lines, then edits text.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAdapters, inspect } from './inspect.mjs';
const scratch = process.argv[2];
const { adapters } = await loadAdapters(scratch);
const fixture = JSON.parse(readFileSync(join(scratch, 'fixtures/Caoquest.json'), 'utf8'));
const canonical = v => JSON.stringify(v, (_k, n) => n && !Array.isArray(n) && typeof n === 'object' ? Object.fromEntries(Object.entries(n).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : n);
const out = join(scratch, 'text-rehearsal'); mkdirSync(out, { recursive: true });
const results = {};
for (const [name, adapter] of Object.entries(adapters)) {
  try {
    const before = adapter.encode(fixture), lines = before.split('\n');
    const first = fixture.scene.placements[0], second = fixture.scene.placements[1];
    const firstLine = lines.findIndex(l => l.includes(first.id));
    const secondLine = lines.findIndex(l => l.includes(second.id));
    const startsOnId = name === 'YAML';
    const start = firstLine - (startsOnId ? 0 : 1), end = secondLine - (startsOnId ? 0 : 1);
    if (start < 0 || end <= start) throw new Error('Observed placement anchors unavailable');
    const originalBlock = lines.slice(start, end).join('\n') + '\n';
    let addedBlock = originalBlock.replace(first.id, 'placement-hand-added');
    const oldX = first.x, newX = first.x + 32;
    const patterns = [[`"x": ${oldX}`, `"x": ${newX}`], [`x: ${oldX}`, `x: ${newX}`], [`x = ${oldX}`, `x = ${newX}`], [`x ${oldX}`, `x ${newX}`], [`"x" ${oldX}`, `"x" ${newX}`], [`key="x" type="number">${oldX}`, `key="x" type="number">${newX}`]];
    const pattern = patterns.find(([old]) => addedBlock.includes(old));
    if (!pattern) throw new Error('Observed x scalar spelling unavailable');
    addedBlock = addedBlock.replace(...pattern);
    const after = lines.slice(0, end).join('\n') + '\n' + addedBlock + lines.slice(end).join('\n');
    const expected = structuredClone(fixture); expected.scene.placements.splice(1, 0, { ...structuredClone(first), id: 'placement-hand-added', x: newX });
    const decoded = adapter.decode(after);
    const folder = join(out, name); mkdirSync(folder, { recursive: true });
    const beforeFile = join(folder, 'before.' + adapter.ext), afterFile = join(folder, 'after.' + adapter.ext);
    writeFileSync(beforeFile, before); writeFileSync(afterFile, after);
    writeFileSync(join(folder, 'add-placement.diff'), spawnSync('git', ['diff', '--no-index', '--no-ext-diff', beforeFile, afterFile], { encoding: 'utf8' }).stdout);
    const brokenBlock = addedBlock.replace(first.actor, 'actor:missing');
    const brokenFile = join(folder, 'broken.' + adapter.ext); writeFileSync(brokenFile, after.replace(addedBlock, brokenBlock));
    results[name] = { exactExpectedSemantics: canonical(decoded) === canonical(expected), sourceBlockLines: end - start,
      placementsBefore: fixture.scene.placements.length, placementsAfter: decoded.scene.placements.length,
      newId: decoded.scene.placements[1].id, actor: decoded.scene.placements[1].actor, x: decoded.scene.placements[1].x,
      valid: await inspect(scratch, name, afterFile), broken: await inspect(scratch, name, brokenFile),
      method: 'literal block copy and scalar text replacement; no serialize/edit call after source text was opened; agent-performed, not a user study' };
  } catch (error) { results[name] = { error: String(error) }; }
}
writeFileSync(join(scratch, 'text-rehearsal-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
