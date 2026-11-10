// Run actual parser/validator/edit/Git experiments. Never executes game programs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createAdapters } from './adapters.mjs';
import { duplicateIdentities, unresolvedActorReferences, renameActor, sequenceExpectations, allowedSequenceResult } from './semantic-checks.mjs';

const scratch = process.argv[2];
const req = createRequire(join(scratch, 'package.json'));
const load = async name => import(pathToFileURL(req.resolve(name)).href);
const unwrap = m => m.default ?? m;
const deps = {
  YAML: await load('yaml'), KDL: await load('@bgotink/kdl'), KJSON: await load('@bgotink/kdl/json'),
  TOML: await load('smol-toml'), JSON5: unwrap(await load('json5')), Hjson: unwrap(await load('hjson')),
  EDN: await load('edn-data'), XML: unwrap(await load('fast-xml-parser')), SDL: unwrap(await load('sdlang')),
};
const adapters = createAdapters(deps);
const ronPath = join(scratch, 'ron-target/release/notation-ron-probe');
function ron(mode, text) {
  const result = spawnSync(ronPath, [mode], { input: text, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout;
}
adapters.RON = { ext: 'ron', comment: '// creator note\n', encode: value => ron('encode', JSON.stringify(value)), decode: text => JSON.parse(ron('decode', text)) };
adapters.RON.noop = text => adapters.RON.encode(adapters.RON.decode(text));
adapters.RON.edit = (text, path, value) => { const data = adapters.RON.decode(text); set(data, path, value); return adapters.RON.encode(data); };
const canonical = v => JSON.stringify(v, (_key, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
const same = (a, b) => canonical(a) === canonical(b);
const sha = text => createHash('sha256').update(text).digest('hex');
const clone = value => structuredClone(value);
const save = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };
function set(object, path, value) { let node = object; for (const key of path.slice(0, -1)) node = node[key]; node[path.at(-1)] = value; }
function attempt(fn) { try { return { ok: true, ...fn() }; } catch (error) { return { ok: false, error: String(error) }; } }
const Ajv2020 = unwrap(await load('ajv/dist/2020.js'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const pluginSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.invalid/patrol-v1',
  type: 'object', properties: { schemaVersion: { const: 1 }, radius: { type: 'integer', minimum: 0 }, notes: { type: 'string' } },
  required: ['schemaVersion', 'radius'], unevaluatedProperties: false };
const pluginValidate = ajv.compile(pluginSchema);
const shape = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
  properties: { actor: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, extensions: { type: 'object' } }, required: ['id', 'name', 'extensions'] },
    scene: { type: 'object', properties: { width: { type: 'integer', minimum: 1 }, placements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, actor: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['id', 'actor', 'x', 'y'] } } }, required: ['width', 'placements'] },
    clip: { type: 'object', properties: { frames: { type: 'array' } }, required: ['frames'] } }, required: ['actor', 'scene', 'clip'] };
const validateShape = ajv.compile(shape);
function validate(data, installed = true) {
  const valid = validateShape(data); const identityErrors = duplicateIdentities(data);
  const errors = [...clone(validateShape.errors ?? []), ...identityErrors];
  for (const [namespace, content] of Object.entries(data.actor.extensions ?? {})) {
    if (!installed || namespace !== '@example/patrol') { errors.push({ namespace, status: 'preserved-unvalidated; execution not authorized' }); continue; }
    if (!pluginValidate(content)) errors.push(...clone(pluginValidate.errors).map(e => ({ namespace, ...e })));
  }
  return { schemaValid: valid, coreValid: valid && identityErrors.length === 0, errors };
}
const results = { model: 'openai-codex/gpt-6-astra', baseline: '20e0209d', runtime: process.version,
  platform: `${process.platform}/${process.arch}`, git: spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.trim(),
  schemaDialect: 'JSON Schema draft 2020-12 via Ajv2020; not native syntax schemas', candidates: {}, fixtures: {} };
const games = ['demo', 'ChimeranEmpire', 'Caoquest', 'CrystalImmortality'];
const fixtures = {};
for (const game of games) {
  const project = JSON.parse(readFileSync(join(scratch, 'projects', game, 'comparison.json'), 'utf8'));
  const scene = project.documents.find(d => d.kind === 'scene');
  const actor = project.documents.find(d => d.id === scene.placements[0].actor);
  const clip = project.documents.find(d => d.kind === 'clip');
  const item = project.documents.find(d => d.kind === 'inventory' && (d.menuUsable || d.equipable)) ?? { id: 'inventory:authored/staff', kind: 'inventory', name: 'Practice staff', evidence: 'owner-requested design example, not legacy' };
  const skill = project.documents.find(d => d.kind === 'skill') ?? { id: 'skill:authored/light', kind: 'skill', name: 'Practice light', evidence: 'authored supplement, not legacy' };
  const extensions = { '@example/patrol': { schemaVersion: 1, radius: 6, notes: 'Authored actor-owned plugin example' }, '@missing/story': { schemaVersion: 7, untouched: ['α', null, { future: true }] } };
  fixtures[game] = { actor: { ...actor, extensions }, scene, clip, item, skill,
    designExample: { evidence: 'proposed, not a legacy field', itemGrantsSkill: { item: item.id, skill: skill.id, while: 'equipped' },
      performance: { actor: actor.id, skill: skill.id, clip: clip.id } },
    script: { mode: 'inline', bindingId: 'hook:research', context: 'placement-interaction', program: null,
      source: 'mwin("C:\\games\\demo");\r\n// \"\"\" \'\'\' </v> ]]>{{ #null :name\n mwin("café 雨");\n' },
    actorCatalogue: project.documents.filter(d => d.kind === 'actor').map(d => d.id),
  };
  save(join(scratch, 'fixtures', game + '.json'), fixtures[game]);
  results.fixtures[game] = { scene: scene.id, dimensions: [scene.width, scene.height, scene.layers], cells: scene.tileRows.reduce((n, r) => n + r.cells.length, 0), placements: scene.placements.length,
    actor: actor.id, clip: clip.id, frames: clip.frames.length, note: 'script edge case, plugins, grants and performance explicitly authored; all main records projected from corpus' };
}
// The Caoquest scene already has six real placements; no fabricated population is needed for merges.
const fixture = fixtures.Caoquest;
function diff(before, after, folder, label) {
  const a = join(folder, label + '.before'); const b = join(folder, label + '.after'); save(a, before); save(b, after);
  const result = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--unified=3', a, b], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  save(join(folder, label + '.diff'), result.stdout);
  const changed = result.stdout.split('\n').filter(l => /^[+-]/.test(l) && !/^(---|\+\+\+)/.test(l));
  return { changedLines: changed.length, diffBytes: Buffer.byteLength(result.stdout), exit: result.status, artifact: label + '.diff' };
}
function merge(adapter, base, left, right, folder, label, expected) {
  const names = ['base', 'left', 'right'].map(s => join(folder, label + '.' + s));
  [base, left, right].forEach((v, i) => save(names[i], v));
  const result = spawnSync('git', ['merge-file', '-p', names[1], names[0], names[2]], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  save(join(folder, label + '.merged'), result.stdout);
  const out = { gitExit: result.status, textualConflict: result.status > 0, source: label + '.merged', semantic: 'not decoded because conflict' };
  if (result.status === 0) {
    try {
      const value = adapter.decode(result.stdout);
      out.identityErrors = duplicateIdentities(value);
      out.semantic = out.identityErrors.length === 0 && expected(value) ? 'preserved' : 'FALSE-CLEAN';
    }
    catch (error) { out.semantic = 'FALSE-CLEAN invalid syntax: ' + error; }
  }
  return out;
}
function rawProperty(text, key, before, after) {
  const old = JSON.stringify(before); const value = JSON.stringify(after);
  const patterns = typeof before === 'string' ? [
    ['"' + key + '": ' + old, '"' + key + '": ' + value],
    [key + ': ' + old, key + ': ' + value],
    [key + ": '" + before.replaceAll("'", "\\'") + "'", key + ": '" + after.replaceAll("'", "\\'") + "'"],
    [key + ' = ' + old, key + ' = ' + value],
    [key + ' ' + old, key + ' ' + value],
    ['"' + key + '" ' + old, '"' + key + '" ' + value],
    ['key="' + key + '" type="string">' + before + '<', 'key="' + key + '" type="string">' + after + '<'],
    [key + ': ' + before + '\n', key + ': ' + after + '\n'],
    [key + ' ' + before + '\n', key + ' ' + after + '\n']]
    : [[key + ': ' + before, key + ': ' + after], ['"' + key + '": ' + before, '"' + key + '": ' + after], [key + ' ' + before, key + ' ' + after], [key + ' = ' + before, key + ' = ' + after], ['"' + key + '" ' + before, '"' + key + '" ' + after], ['key="' + key + '" type="number">' + before, 'key="' + key + '" type="number">' + after]];
  for (const [from, to] of patterns) if (text.includes(from)) return text.replace(from, to);
  throw new Error('No safe authored text replacement pattern for ' + key);
}
for (const [name, adapter] of Object.entries(adapters)) {
  const folder = join(scratch, 'results', name); mkdirSync(folder, { recursive: true });
  const result = results.candidates[name] = { extension: adapter.ext, projections: {} };
  for (const game of games) {
    result.projections[game] = attempt(() => {
      const data = JSON.parse(readFileSync(join(scratch, 'projects', game, 'comparison.json'), 'utf8'));
      const start = performance.now(); const text = adapter.encode(data); const encodedMs = performance.now() - start;
      save(join(scratch, 'projects', game, 'comparison.' + adapter.ext), text);
      const t = performance.now(); const decoded = adapter.decode(text); const parseMs = performance.now() - t;
      let splitDocumentsEqual = true;
      for (const document of data.documents) {
        const documentText = adapter.encode(document);
        const filename = document.id.replace(/[^a-zA-Z0-9]+/g, '-') + '.' + adapter.ext;
        save(join(scratch, 'projects', game, 'notations', name, document.kind, filename), documentText);
        splitDocumentsEqual &&= same(adapter.decode(documentText), document);
      }
      return { semanticEqual: same(decoded, data), splitDocumentsEqual, documents: data.documents.length, bytes: Buffer.byteLength(text), encodedMs, parseMs, sha256: sha(text) };
    });
  }
  const stage = attempt(() => {
    const start = performance.now(); const encoded = adapter.encode(fixture); const encodeMs = performance.now() - start;
    const base = adapter.comment + encoded; save(join(folder, 'base.' + adapter.ext), base);
    const parsed = adapter.decode(base);
    if (!same(parsed, fixture)) throw new Error('Initial fixture semantic roundtrip mismatch');
    result.validation = validate(parsed);
    const noop = adapter.noop(base); save(join(folder, 'noop.' + adapter.ext), noop);
    result.noop = { bytesEqual: noop === base, semanticEqual: same(adapter.decode(noop), fixture), commentPreserved: !adapter.comment || noop.includes('creator note'), keyOrderPreserved: JSON.stringify(Object.keys(adapter.decode(noop))) === JSON.stringify(Object.keys(parsed)), diff: diff(base, noop, folder, 'noop') };
    const crlf = base.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
    result.crlf = attempt(() => { const saved = adapter.noop(crlf); return { bytesEqual: saved === crlf, containsCRLF: saved.includes('\r\n'), semanticEqual: same(adapter.decode(saved), adapter.decode(crlf)) }; });
    const expectedEdit = clone(fixture); expectedEdit.actor.name += '-review';
    const edited = adapter.edit(base, ['actor', 'name'], expectedEdit.actor.name);
    result.propertyEdit = { semanticEqual: same(adapter.decode(edited), expectedEdit), commentPreserved: !adapter.comment || edited.includes('creator note'), diff: diff(base, edited, folder, 'one-property') };
    const malformed = clone(fixture); malformed.scene.width = -1; malformed.actor.extensions['@example/patrol'].radius = 'INVALID_RADIUS';
    const invalidText = adapter.encode(malformed); save(join(folder, 'invalid-schema.' + adapter.ext), invalidText);
    const invalidDecoded = adapter.decode(invalidText); const invalidResult = validate(invalidDecoded);
    const offset = invalidText.indexOf('INVALID_RADIUS');
    result.invalidSchema = { ...invalidResult, markerLocation: { line: invalidText.slice(0, offset).split('\n').length, column: offset - invalidText.lastIndexOf('\n', offset - 1) }, locationMethod: 'unique invalid scalar marker; validator itself reports JSON Pointer, not source location' };
    result.invalidSyntax = attempt(() => { adapter.decode(base.slice(0, Math.floor(base.length / 2)) + '\n"unterminated'); return { accepted: true }; });
    const savedUnknown = adapter.decode(adapter.noop(base));
    result.missingPlugin = { contentPreserved: same(savedUnknown.actor.extensions, fixture.actor.extensions), status: validate(savedUnknown, false).errors };
    const mismatch = clone(fixture); mismatch.actor.extensions['@example/patrol'].schemaVersion = 2;
    const mismatchText = adapter.encode(mismatch); const mismatchSaved = adapter.decode(adapter.noop(mismatchText));
    result.pluginVersionMismatch = { contentPreserved: same(mismatchSaved.actor.extensions, mismatch.actor.extensions), errors: validate(mismatchSaved).errors };
    const scriptText = adapter.encode(fixture.script); const scriptDecoded = adapter.decode(scriptText);
    save(join(folder, 'script-inline.' + adapter.ext), scriptText); save(join(folder, 'extracted.prg'), scriptDecoded.source);
    const external = { ...scriptDecoded, mode: 'file', program: 'program:extracted.prg', source: null };
    save(join(folder, 'script-external.' + adapter.ext), adapter.encode(external));
    result.script = { decodedUtf8BytesEqual: Buffer.from(scriptDecoded.source).equals(Buffer.from(fixture.script.source)), sha256: sha(scriptDecoded.source), bindingIdPreserved: external.bindingId === fixture.script.bindingId, contextPreserved: external.context === fixture.script.context, caveat: 'Source bytes after Unicode decoding; not original Windows-1252 bytes or VM continuation equivalence' };
    const rename = clone(fixture); const oldId = rename.actor.id; const newId = oldId + '-renamed';
    const refs = renameActor(rename, oldId, newId);
    const renamed = adapter.decode(adapter.encode(rename));
    const broken = clone(renamed); broken.scene.placements[0].actor = 'actor:missing';
    const stalePerformance = clone(renamed); stalePerformance.designExample.performance.actor = oldId;
    save(join(folder, 'renamed.' + adapter.ext), adapter.encode(rename)); save(join(folder, 'broken-reference.' + adapter.ext), adapter.encode(broken));
    save(join(folder, 'stale-performance.' + adapter.ext), adapter.encode(stalePerformance));
    result.referenceRename = { rewrittenKnownReferences: refs, performanceActor: renamed.designExample.performance.actor,
      unresolvedAfterRename: unresolvedActorReferences(renamed), brokenReferenceDiagnostics: unresolvedActorReferences(broken),
      stalePerformanceDiagnostics: unresolvedActorReferences(stalePerformance),
      scope: 'explicit placement and designExample.performance actor references plus catalogue; no plugin/string/script rewriting or dynamic dependency proof' };
    result.rawTextMerges = attempt(() => {
      const left = rawProperty(base, 'name', fixture.actor.name, fixture.actor.name + '-left');
      const right = rawProperty(base, 'delaySeconds', fixture.clip.delaySeconds, fixture.clip.delaySeconds + 0.25);
      const expected = clone(fixture); expected.actor.name += '-left'; expected.clip.delaySeconds += 0.25;
      if (adapter.decode(left).actor.name !== expected.actor.name || adapter.decode(right).clip.delaySeconds !== expected.clip.delaySeconds) throw new Error('Raw edit did not hit intended property');
      const conflictRight = rawProperty(base, 'name', fixture.actor.name, fixture.actor.name + '-right');
      return { independent: merge(adapter, base, left, right, folder, 'raw-independent', value => same(value, expected)),
        sameProperty: merge(adapter, base, left, conflictRight, folder, 'raw-same-property', () => false),
        leftDiff: diff(base, left, folder, 'raw-property') };
    });
    const editorLeft = adapter.edit(base, ['actor', 'name'], fixture.actor.name + '-left');
    const editorRight = adapter.edit(base, ['clip', 'delaySeconds'], fixture.clip.delaySeconds + 0.25);
    const expectedIndependent = clone(fixture); expectedIndependent.actor.name += '-left'; expectedIndependent.clip.delaySeconds += 0.25;
    result.editorMerges = { independent: merge(adapter, base, editorLeft, editorRight, folder, 'editor-independent', value => same(value, expectedIndependent)),
      sameProperty: merge(adapter, base, editorLeft, adapter.edit(base, ['actor', 'name'], fixture.actor.name + '-right'), folder, 'editor-same-property', () => false) };
    const scenarios = [
      ['adjacent', a => { a.scene.placements[0].x += 1; }, b => { b.scene.placements[0].y += 1; }],
      ['edit-delete', a => { a.scene.placements.splice(1, 1); }, b => { b.scene.placements[1].x += 1; }],
      ['simultaneous-add', a => { a.scene.placements.push({ ...a.scene.placements[0], id: 'authored-left' }); }, b => { b.scene.placements.push({ ...b.scene.placements[0], id: 'authored-right' }); }],
      ['reorder-edit', a => { a.scene.placements.reverse(); }, b => { b.scene.placements[0].x += 1; }],
      ['frame-insert-reorder', a => { a.clip.frames.splice(1, 0, { ...a.clip.frames[0], id: 'authored-insert' }); }, b => { b.clip.frames.reverse(); }],
      ['frame-remove-edit', a => { a.clip.frames.splice(0, 1); }, b => { b.clip.frames.at(-1).sound = 'authored.wav'; }],
      ['same-id-placement-disjoint', a => { a.scene.placements.splice(1, 0, { ...a.scene.placements[0], id: 'same-added' }); }, b => { b.scene.placements.splice(5, 0, { ...b.scene.placements[0], id: 'same-added', x: 999 }); }],
      ['same-id-frame-disjoint', a => { a.clip.frames.unshift({ ...a.clip.frames[0], id: 'same-frame', sound: 'left.wav' }); }, b => { b.clip.frames.push({ ...b.clip.frames[0], id: 'same-frame', sound: 'right.wav' }); }],
    ];
    result.sequenceMerges = {};
    for (const [label, changeLeft, changeRight] of scenarios) {
      const l = clone(fixture); const r = clone(fixture); changeLeft(l); changeRight(r);
      const allowed = sequenceExpectations(fixture, label);
      result.sequenceMerges[label] = merge(adapter, base, adapter.encode(l), adapter.encode(r), folder, label, value => allowedSequenceResult(value, allowed));
      diff(base, adapter.encode(l), folder, label + '-left'); diff(base, adapter.encode(r), folder, label + '-right');
    }
    result.tiles = {};
    for (const game of games) {
      const data = clone(fixtures[game]); const scene = game === 'CrystalImmortality' ? JSON.parse(readFileSync(join(scratch, 'projects', game, 'comparison.json'), 'utf8')).documents.find(d => d.id === 'scene:boards/city1.brd') : data.scene;
      const text = adapter.encode(scene); const changed = clone(scene); changed.tileRows[3].cells[2] = changed.tileRows[3].cells[2] === 0 ? 1 : 0;
      const t = performance.now(); const editedScene = adapter.encode(changed); const parsedScene = adapter.decode(editedScene);
      result.tiles[game] = { dimensions: [scene.width, scene.height, scene.layers], bytes: Buffer.byteLength(text), operationMs: performance.now() - t, semanticEqual: same(parsedScene, changed), diff: diff(text, editedScene, folder, 'tile-' + game) };
    }
    return { encodeMs, bytes: Buffer.byteLength(base) };
  });
  result.operations = stage;
  save(join(scratch, 'results.json'), results);
  console.log(name, JSON.stringify({ projections: Object.fromEntries(Object.entries(result.projections).map(([g, r]) => [g, r.ok && r.semanticEqual])), operations: stage, noop: result.noop, raw: result.rawTextMerges?.ok }));
}
save(join(scratch, 'schemas/core.json'), shape); save(join(scratch, 'schemas/patrol-v1.json'), pluginSchema);
save(join(scratch, 'results.json'), results);
