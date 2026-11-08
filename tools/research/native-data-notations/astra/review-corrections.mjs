// Actual post-review experiments and deliberately broken guard controls.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadAdapters, inspect } from './inspect.mjs';
import * as guards from './semantic-checks.mjs';
const scratch = process.argv[2], tool = dirname(fileURLToPath(import.meta.url));
const out = join(scratch, 'post-review'); mkdirSync(out, { recursive: true });
const { adapters, deps } = await loadAdapters(scratch);
const fixture = JSON.parse(readFileSync(join(scratch, 'fixtures/Caoquest.json'), 'utf8'));
const clone = value => structuredClone(value);
const results = { model: 'openai-codex/gpt-6-astra', issues: [1780, 1781, 1789, 1792, 1795, 1798], semanticOracles: {}, references: {}, sameIdGitCases: {}, duplicateValidation: {}, xml: {}, mutations: {} };
const save = (name, value) => writeFileSync(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));

for (const label of ['simultaneous-add', 'frame-insert-reorder', 'frame-remove-edit']) {
  const allowed = guards.sequenceExpectations(fixture, label);
  for (const value of allowed) assert(guards.allowedSequenceResult(value, allowed), label + ' positive');
  const corruptions = {
    actorName: value => { value.actor.name += '-CORRUPTED'; },
    placementOrder: value => { value.scene.placements.reverse(); },
    placementActor: value => { value.scene.placements[0].actor = 'actor:CORRUPTED'; },
    existingFrameSound: value => { value.clip.frames[0].sound = 'CORRUPTED.wav'; },
    frameOrder: value => { value.clip.frames.reverse(); },
    extraRootField: value => { value.unpermitted = true; },
    duplicateFrame: value => { value.clip.frames.push(clone(value.clip.frames[0])); },
  };
  if (label === 'simultaneous-add') corruptions.addedPlacementContent = value => { value.scene.placements.find(p => p.id === 'authored-left').x += 100; };
  if (label === 'frame-insert-reorder') corruptions.insertedFrameContent = value => { value.clip.frames.find(f => f.id === 'authored-insert').sound = 'CORRUPTED.wav'; };
  results.semanticOracles[label] = { allowedFullDocuments: allowed.length, rejected: [] };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    const value = clone(allowed[0]); corrupt(value);
    assert(!guards.allowedSequenceResult(value, allowed), `${label}/${name} must reject`);
    results.semanticOracles[label].rejected.push(name);
  }
}

for (const [name, adapter] of Object.entries(adapters)) {
  const renamed = clone(fixture), oldId = renamed.actor.id, newId = oldId + '-review-renamed';
  const refs = guards.renameActor(renamed, oldId, newId);
  // Independent expected construction, not a second call into the mutator.
  const expected = clone(fixture); expected.actor.id = newId;
  expected.actorCatalogue = expected.actorCatalogue.map(id => id === oldId ? newId : id);
  for (const placement of expected.scene.placements) if (placement.actor === oldId) placement.actor = newId;
  expected.designExample.performance.actor = newId;
  assert(guards.sameJson(renamed, expected));
  const decoded = adapter.decode(adapter.encode(renamed));
  assert(guards.sameJson(decoded, expected));
  assert.deepEqual(guards.unresolvedActorReferences(decoded), []);
  const stale = clone(decoded); stale.designExample.performance.actor = oldId;
  const staleFile = join(out, `stale-performance.${adapter.ext}`); writeFileSync(staleFile, adapter.encode(stale));
  const verdict = await inspect(scratch, name, staleFile);
  assert(verdict.unresolvedReferences.some(r => r.path === '/designExample/performance/actor' && r.missing === oldId));
  const cli = spawnSync(process.execPath, [join(tool, 'inspect.mjs'), scratch, name, staleFile], { encoding: 'utf8' });
  assert.equal(cli.status, 1); assert(JSON.parse(cli.stdout).unresolvedReferences.some(r => r.path === '/designExample/performance/actor'));
  results.references[name] = { fullExpectedDocument: true, rewrittenReferences: refs, stalePerformance: verdict.unresolvedReferences, cliExit: cli.status };
  results.sameIdGitCases[name] = {};
  for (const [label, path] of [['same-id-placement-disjoint', '/scene/placements/'], ['same-id-frame-disjoint', '/clip/frames/']]) {
    const directory = join(scratch, 'results', name), merged = join(directory, label + '.merged');
    const command = spawnSync('git', ['merge-file', '-p', join(directory, label + '.left'), join(directory, label + '.base'), join(directory, label + '.right')], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
    assert(Number.isInteger(command.status) && command.status >= 0);
    if (command.status > 0) {
      assert(command.stdout.includes('<<<<<<<'), name + '/' + label + ' must be an actual textual conflict');
      results.sameIdGitCases[name][label] = { gitExit: command.status, classification: 'textual conflict; no parsed merge credited' };
      continue;
    }
    assert.equal(command.stdout, readFileSync(merged, 'utf8'));
    const value = adapter.decode(command.stdout), identities = guards.duplicateIdentities(value);
    assert(identities.some(e => e.instancePath.startsWith(path)));
    const verdict = await inspect(scratch, name, merged);
    assert.equal(verdict.schemaValid, true); assert.equal(verdict.coreValid, false);
    assert(verdict.errors.some(e => e.keyword === 'uniqueIdentity' && e.instancePath.startsWith(path)));
    const cli = spawnSync(process.execPath, [join(tool, 'inspect.mjs'), scratch, name, merged], { encoding: 'utf8' });
    assert.equal(cli.status, 1); assert(JSON.parse(cli.stdout).errors.some(e => e.keyword === 'uniqueIdentity'));
    results.sameIdGitCases[name][label] = { gitExit: command.status, classification: 'false-clean duplicate identity rejected', identityErrors: identities, schemaValid: verdict.schemaValid, coreValid: verdict.coreValid, cliExit: cli.status };
  }

  const duplicate = clone(fixture);
  duplicate.scene.placements.push(clone(duplicate.scene.placements[0]));
  duplicate.clip.frames.push(clone(duplicate.clip.frames[0]));
  const duplicateFile = join(out, `duplicate-identities.${adapter.ext}`); writeFileSync(duplicateFile, adapter.encode(duplicate));
  const duplicateVerdict = await inspect(scratch, name, duplicateFile);
  assert.equal(duplicateVerdict.schemaValid, true); assert.equal(duplicateVerdict.coreValid, false);
  assert(duplicateVerdict.errors.some(e => e.keyword === 'uniqueIdentity' && e.instancePath.startsWith('/scene/placements/')));
  assert(duplicateVerdict.errors.some(e => e.keyword === 'uniqueIdentity' && e.instancePath.startsWith('/clip/frames/')));
  const duplicateCli = spawnSync(process.execPath, [join(tool, 'inspect.mjs'), scratch, name, duplicateFile], { encoding: 'utf8' });
  assert.equal(duplicateCli.status, 1);
  results.duplicateValidation[name] = { errors: duplicateVerdict.errors, cliExit: duplicateCli.status };
}

function independent(text) {
  const command = spawnSync('python3', [join(tool, 'xml-reference.py')], { input: text, encoding: 'utf8' });
  return { status: command.status, value: command.status === 0 ? JSON.parse(command.stdout) : null, error: command.stderr.trim() };
}
const xmlData = { payload: Object.fromEntries([['a\nb', 1], ['a\tb', 2], ['a\rb', 3], ['a b', 4], ['a&#10;b', 5], ['quote"&<', 6]]), source: 'line\r\n\tα雨😀\n' };
const xml = adapters.XML.encode(xmlData); save('attribute-whitespace.xml', xml);
assert(xml.includes('key="a&#10;b"')); assert(xml.includes('key="a&#9;b"')); assert(xml.includes('key="a&#13;b"'));
assert.deepEqual(adapters.XML.decode(xml), xmlData);
const conforming = independent(xml); assert.equal(conforming.status, 0); assert.deepEqual(conforming.value, xmlData);
results.xml.whitespace = { ownParserEqual: true, independentParser: 'Python xml.etree.ElementTree', independentEqual: true, keys: Object.keys(conforming.value.payload) };
results.xml.forbidden = [];
for (const code of [0, 1, 8, 11, 12, 14, 31, 0xd800, 0xdc00, 0xfffe, 0xffff]) {
  const char = String.fromCodePoint(code);
  assert.throws(() => adapters.XML.encode({ payload: 'a' + char + 'b' }), /XML10_FORBIDDEN_CHARACTER/);
  assert.throws(() => adapters.XML.encode({ ['key' + char]: true }), /XML10_FORBIDDEN_CHARACTER/);
  assert.throws(() => adapters.XML.decode('<v type="string">a' + char + 'b</v>'), /XML10_FORBIDDEN_CHARACTER/);
  const reference = `<v type="string">&#${code};</v>`;
  assert.throws(() => adapters.XML.decode(reference), /XML10_FORBIDDEN_REFERENCE/);
  const oracle = independent(reference); assert.notEqual(oracle.status, 0);
  results.xml.forbidden.push({ code, rejectedEncodeKeyAndValue: true, rejectedDecodeLiteralAndReference: true, independentReferenceExit: oracle.status });
}
for (const reference of ['&#x0;', '&#xD800;', '&#x110000;', '&#1114112;']) {
  assert.throws(() => adapters.XML.decode(`<v type="string">${reference}</v>`), /XML10_FORBIDDEN_REFERENCE/);
}
const literalReference = '<v type="string"><![CDATA[&#0;]]></v>';
assert.equal(adapters.XML.decode(literalReference), '&#0;'); assert.equal(independent(literalReference).value, '&#0;');
assert.equal(adapters.XML.decode('<v type="string">&amp;#0;</v>'), '&#0;');
const allowedUnicode = { text: '\t\r\n' + String.fromCodePoint(0x20, 0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff) };
assert.deepEqual(independent(adapters.XML.encode(allowedUnicode)).value, allowedUnicode);
assert.deepEqual(adapters.XML.decode(adapters.XML.encode(allowedUnicode)), allowedUnicode);
results.xml.allowedCharacterBoundariesAndLiteralReferences = true;
results.xml.booleans = [];
for (const token of ['treu', 'FALSE', '', '1', '0', ' true ']) {
  const text = `<v type="boolean">${token}</v>`;
  assert.throws(() => adapters.XML.decode(text), /XML_BOOLEAN_LEXICAL_VALUE/);
  assert.notEqual(independent(text).status, 0);
  results.xml.booleans.push({ token, rejected: true });
}
for (const token of ['true', 'false']) assert.equal(adapters.XML.decode(`<v type="boolean">${token}</v>`), token === 'true');

// Deliberately disable real guards in scratch-only module copies. Each former
// correctness assertion must fail for the specific wrong result, then pass using
// the unchanged corrected implementation. No repository file is mutated here.
const guardSource = readFileSync(join(tool, 'semantic-checks.mjs'), 'utf8');
const adapterSource = readFileSync(join(tool, 'adapters.mjs'), 'utf8');
async function mutant(label, source, before, after) {
  assert(source.includes(before), 'Mutation anchor missing: ' + label);
  const file = join(out, 'mutant-' + label + '.mjs'); writeFileSync(file, source.replace(before, after));
  return import(pathToFileURL(file).href);
}
function requireBroken(label, assertion) {
  try { assertion(); } catch (error) {
    assert.equal(error.code, 'ERR_ASSERTION', label + ' must fail an assertion, not crash');
    results.mutations[label] = { brokenGuard: 'assertion failed as required', reason: error.message, restoredGuard: 'passed in positive/negative probes above' };
    return;
  }
  throw new Error('Mutation survived: ' + label);
}
const weak = await mutant('full-document', guardSource, 'export function sameJson(a, b) {', 'export function sameJson(a, b) { return true;');
const allowed = guards.sequenceExpectations(fixture, 'simultaneous-add'); const corrupt = clone(allowed[0]); corrupt.actor.name = 'CORRUPTED';
requireBroken('full-document', () => assert.equal(weak.allowedSequenceResult(corrupt, allowed), false));
const missingRef = await mutant('performance-reference', guardSource, '  return refs;', "  return refs.filter(ref => ref.path !== '/designExample/performance/actor');");
const stale = clone(fixture); guards.renameActor(stale, stale.actor.id, 'actor:renamed'); stale.designExample.performance.actor = fixture.actor.id;
requireBroken('performance-reference', () => assert(missingRef.unresolvedActorReferences(stale).some(r => r.path === '/designExample/performance/actor')));
const noIdentity = await mutant('duplicate-identity', guardSource, 'export function duplicateIdentities(data) {', 'export function duplicateIdentities(data) { return [];');
const duplicates = clone(fixture); duplicates.scene.placements.push(clone(duplicates.scene.placements[0]));
requireBroken('duplicate-identity', () => assert(noIdentity.duplicateIdentities(duplicates).some(e => e.keyword === 'uniqueIdentity')));
const noWhitespace = await mutant('xml-whitespace', adapterSource, ".replaceAll('\\t', '&#9;').replaceAll('\\n', '&#10;')", '');
const badWhitespace = noWhitespace.createAdapters(deps).XML.encode(xmlData);
requireBroken('xml-whitespace', () => assert.deepEqual(independent(badWhitespace).value, xmlData));
const noCharacter = await mutant('xml-character', adapterSource, '  function assertXmlCharacters(text) {', '  function assertXmlCharacters(text) { return;');
requireBroken('xml-character', () => assert.throws(() => noCharacter.createAdapters(deps).XML.encode({ payload: '\u0000' }), /XML10_FORBIDDEN_CHARACTER/));
const noReference = await mutant('xml-character-reference', adapterSource, '  function assertXmlReferences(text) {', '  function assertXmlReferences(text) { return;');
requireBroken('xml-character-reference', () => assert.throws(() => noReference.createAdapters(deps).XML.decode('<v type="string">&#0;</v>'), /XML10_FORBIDDEN_REFERENCE/));
const noBoolean = await mutant('xml-boolean', adapterSource, "      if (node['#text'] !== 'true' && node['#text'] !== 'false') throw new Error('XML_BOOLEAN_LEXICAL_VALUE must be true or false');", '');
requireBroken('xml-boolean', () => assert.throws(() => noBoolean.createAdapters(deps).XML.decode('<v type="boolean">treu</v>'), /XML_BOOLEAN_LEXICAL_VALUE/));
writeFileSync(join(scratch, 'post-review-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ issues: results.issues, formats: Object.keys(results.references), mutantsKilled: Object.keys(results.mutations), xml: results.xml }, null, 2));
