import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadAdapters, inspect } from './inspect.mjs';
const scratch = process.argv[2];
const { adapters, deps, req } = await loadAdapters(scratch);
const out = join(scratch, 'extra'); mkdirSync(out, { recursive: true });
const save = (name, value) => writeFileSync(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const probe = fn => { try { return { ok: true, ...fn() }; } catch (error) { return { ok: false, error: String(error) }; } };
const sha = text => createHash('sha256').update(text).digest('hex');
const results = { scalar: {}, authoring: {}, noncanonicalNoop: {}, locations: {}, dialect: {}, lineEndings: {} };
const Ajv2020 = req('ajv/dist/2020.js').default;
const ajv = new Ajv2020({ strict: true, allErrors: true });
const scalarSchema = ajv.compile({ type: 'number', minimum: -9007199254740991, maximum: 9007199254740991 });
const cases = { null: { value: null }, absent: {}, unicode: { value: 'café 雨 😀' }, safeInteger: { value: 9007199254740991 }, decimal: { value: 0.15 }, exponent: { value: 1e-7 }, negativeZero: { value: -0 }, markerCollision: { value: { __tkr_null: true }, other: { __tkr_escaped_object: { __tkr_null: true } } } };
const demo = JSON.parse(readFileSync(join(scratch, 'fixtures/demo.json'), 'utf8'));
// Owner ruling: LF normalization is permitted. Byte preservation above is
// diagnostic, not an acceptance requirement or a claim of VM equivalence.
const normalize = source => source.replace(/\r\n?/g, '\n');
for (const [name, adapter] of Object.entries(adapters)) {
  results.scalar[name] = {};
  for (const [label, value] of Object.entries(cases)) results.scalar[name][label] = probe(() => {
    const text = adapter.encode(value), back = adapter.decode(text);
    return { semanticEqual: same(back, value), negativeZeroRetained: label === 'negativeZero' ? Object.is(back.value, -0) : null, text: text.length < 500 ? text : null };
  });
  results.scalar[name].unsafeInteger = probe(() => {
    const text = adapter.encode({ value: 9007199254740991 }).replace('9007199254740991', '9007199254740993');
    const value = adapter.decode(text).value; return { decoded: value, rejectedBySafeNumberProfile: !scalarSchema(value) };
  });
  results.lineEndings[name] = probe(() => {
    const binding = { ...demo.script, source: normalize(demo.script.source) };
    const text = adapter.encode(binding), roundtrip = adapter.decode(text);
    const extracted = roundtrip.source;
    const external = { ...roundtrip, mode: 'file', source: null, program: 'program:normalized.prg' };
    const restored = { ...external, mode: 'inline', source: extracted, program: null };
    const back = adapter.decode(adapter.encode(restored));
    save(name + '-normalized-inline.' + adapter.ext, text);
    return { declaredPolicy: 'CRLF and CR become LF on import and extraction; no VM equivalence claim',
      normalizedTextEqual: back.source === binding.source, otherContentEqual: back.source.replace(/\n/g, '') === binding.source.replace(/\n/g, ''),
      contextPreserved: back.context === binding.context && back.bindingId === binding.bindingId,
      originalUnicodeSha256: sha(demo.script.source), normalizedUnicodeSha256: sha(binding.source) };
  });
  const dir = join(out, name); mkdirSync(dir, { recursive: true });
  results.authoring[name] = probe(() => {
    const before = adapter.comment + adapter.encode(demo);
    const rawScriptEdit = before.replace('send(', 'send( ');
    const decoded = adapter.decode(rawScriptEdit);
    const expectedScript = demo.scene.triggers[0].binding.source.replace('send(', 'send( ');
    if (decoded.scene.triggers[0].binding.source !== expectedScript) throw new Error('Raw script edit missed its owner');
    const after = structuredClone(decoded);
    after.actor.name += '-review';
    after.scene.placements.push({ ...structuredClone(after.scene.placements[0]), id: 'placement-author-added', x: after.scene.placements[0].x + 32 });
    const finalText = adapter.encode(after);
    const beforeFile = join(dir, 'before.' + adapter.ext), scriptFile = join(dir, 'script-edited.' + adapter.ext), afterFile = join(dir, 'after.' + adapter.ext);
    writeFileSync(beforeFile, before); writeFileSync(scriptFile, rawScriptEdit); writeFileSync(afterFile, finalText);
    const rawDiff = spawnSync('git', ['diff', '--no-index', beforeFile, scriptFile], { encoding: 'utf8' }).stdout;
    writeFileSync(join(dir, 'inline-edit.diff'), rawDiff);
    const diff = spawnSync('git', ['diff', '--no-index', beforeFile, afterFile], { encoding: 'utf8' }).stdout;
    writeFileSync(join(dir, 'walkthrough.diff'), diff);
    const extracted = decoded.scene.triggers[0].binding.source;
    writeFileSync(join(dir, 'scene-trigger.prg'), extracted);
    after.scene.triggers[0].binding = { ...after.scene.triggers[0].binding, mode: 'file', source: null, program: 'program:scene-trigger.prg' };
    writeFileSync(join(dir, 'external.' + adapter.ext), adapter.encode(after));
    const broken = structuredClone(after); broken.scene.placements.at(-1).actor = 'actor:missing';
    writeFileSync(join(dir, 'broken.' + adapter.ext), adapter.encode(broken));
    return { beforeFile, afterFile, actorFound: demo.actor.id === demo.scene.placements[0].actor,
      originalActor: demo.actor.id, addedPlacement: after.scene.placements.at(-1).id,
      originalInlineSha256: sha(demo.scene.triggers[0].binding.source), editedInlineSha256: sha(extracted),
      extractionBytesEqual: Buffer.from(readFileSync(join(dir, 'scene-trigger.prg'))).equals(Buffer.from(expectedScript)),
      decodedSourceChangedAsIntended: true, additionsRoundtrip: adapter.decode(finalText).scene.placements.length === 2,
      mode: 'raw source text edit; structural before/after prepared with library for a text-only copy-and-edit walkthrough; not human usability testing' };
  });
  if (results.authoring[name].ok) {
    results.authoring[name].valid = await inspect(scratch, name, join(dir, 'after.' + adapter.ext));
    results.authoring[name].broken = await inspect(scratch, name, join(dir, 'broken.' + adapter.ext));
  }
}
const hand = {
  YAML: "# creator chose this layout\r\nactor: {name: 'Keeper', speed: 2.000} # local note\r\nextensions: { '@absent/plugin': { future: true } }\r\n",
  KDL: '// creator chose this layout\r\n- { actor { name "Keeper"; speed 2.000; }; extensions { "@absent/plugin" future=#true; }; }\r\n',
  Hjson: '# creator chose this layout\r\n{actor: {name: Keeper\r\n speed: 2.000}\r\nextensions: {"@absent/plugin": {future: true}}}\r\n',
};
for (const [name, text] of Object.entries(hand)) results.noncanonicalNoop[name] = probe(() => {
  const a = adapters[name], saved = a.noop(text); save('hand-' + name + '.before', text); save('hand-' + name + '.after', saved);
  return { bytesEqual: text === saved, semanticEqual: same(a.decode(text), a.decode(saved)), commentsRetained: saved.includes('creator chose') && (name !== 'YAML' || saved.includes('local note')), crlfRetained: saved.includes('\r\n'), saved };
});
const invalid = structuredClone(demo); invalid.actor.extensions['@example/patrol'].radius = 'INVALID_RADIUS';
const yamlText = adapters.YAML.encode(invalid), lc = new deps.YAML.LineCounter();
const ydoc = deps.YAML.parseDocument(yamlText, { lineCounter: lc });
const ynode = ydoc.getIn(['actor', 'extensions', '@example/patrol', 'radius'], true);
results.locations.YAML = { jsonPointer: '/actor/extensions/@example~1patrol/radius', ...lc.linePos(ynode.range[0]) };
const ktext = adapters.KDL.encode(invalid), kd = deps.KDL.parse(ktext, { storeLocations: true });
const knode = kd.nodes[0].children.nodes.find(n => n.getName() === 'actor').children.nodes.find(n => n.getName() === 'extensions').children.nodes.find(n => n.getName() === '@example/patrol').children.nodes.find(n => n.getName() === 'radius');
results.locations.KDL = deps.KDL.getLocation(knode.getArgumentEntry(0));
const dialectSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { values: { type: 'array', prefixItems: [{ type: 'integer' }, { type: 'string' }], minItems: 2, items: false } }, required: ['values'], unevaluatedProperties: false };
const dv = ajv.compile(dialectSchema);
results.dialect = { validTuple: dv({ values: [1, 'ok'] }), invalidTupleRejected: !dv({ values: ['wrong', 2] }), unknownFieldRejected: !dv({ values: [1, 'ok'], extra: true }), schema: dialectSchema };
results.lineEndings.HjsonDefaultMultiline = {};
for (const [label, source] of Object.entries({ CRLF: 'mwin("Hello");\r\nreturn;\r\n', CR: 'mwin("Hello");\rreturn;\r', delimiterEdge: demo.script.source })) {
  results.lineEndings.HjsonDefaultMultiline[label] = probe(() => {
    const text = deps.Hjson.stringify({ source }), back = deps.Hjson.parse(text).source;
    const normalizedInputText = deps.Hjson.stringify({ source: normalize(source) });
    return { originalBytesEqual: back === source, normalizedTextEqual: normalize(back) === normalize(source),
      explicitNormalizationRoundtrip: deps.Hjson.parse(normalizedInputText).source === normalize(source), text, normalizedInputText };
  });
}
results.duplicateKeys = {};
const duplicates = {
  JSON: '{"x":1,"x":2}', YAML: 'x: 1\nx: 2\n', KDL: '- { x 1; x 2; }\n', TOML: 'x = 1\nx = 2\n',
  JSON5: '{x:1,x:2}', Hjson: '{x:1,x:2}', EDN: '{"x" 1 "x" 2}', RON: '{"x":1,"x":2}',
  XML: '<v type="object"><v key="x" type="number">1</v><v key="x" type="number">2</v></v>',
  SDLang: 'entry "" type="object" {\n entry "x" 1 type="number"\n entry "x" 2 type="number"\n}\n',
};
for (const [name, text] of Object.entries(duplicates)) results.duplicateKeys[name] = probe(() => ({ value: adapters[name].decode(text) }));
results.ednMalformed = {};
for (const text of ['[1 2', '{"x" 1', '"unterminated']) results.ednMalformed[text] = probe(() => ({ value: adapters.EDN.decode(text) }));
const truncatedEdn = adapters.EDN.encode(demo).trimEnd().slice(0, -1);
results.ednMalformed.truncatedFullFixture = probe(() => {
  const value = adapters.EDN.decode(truncatedEdn);
  const schema = ajv.compile(JSON.parse(readFileSync(join(scratch, 'schemas/core.json'), 'utf8')));
  return { semanticEqualToComplete: same(value, demo), accepted: true, returnedNull: value === null, coreSchemaRejects: !schema(value) };
});
// Reproduce SDLang library defects independently of our labelled mapped serializer.
results.sdlangNative = {};
for (const text of ['value null\n', 'value 0.15\n', 'value 0.15d\n', 'value 1e-7d\n']) results.sdlangNative[text] = probe(() => ({ values: new deps.SDL.SdlReader(text).toAst().children[0].values.map(v => v.value) }));
const sdtag = new deps.SDL.SdlTag('script'); sdtag.values.push(deps.SDL.SdlValue.from('mwin("hello");'));
results.sdlangNative.quotedSerialization = probe(() => { const text = sdtag.toString(false); return { text, parsed: new deps.SDL.SdlReader(text).toAst().children[0].values.map(v => v.value) }; });
save('results.json', results);
console.log(JSON.stringify({ scalarFailures: Object.fromEntries(Object.entries(results.scalar).map(([k,v]) => [k, Object.fromEntries(Object.entries(v).filter(([,r]) => !r.ok || r.semanticEqual === false))])), authoring: Object.fromEntries(Object.entries(results.authoring).map(([k,v])=>[k,v.ok])), noncanonicalNoop: results.noncanonicalNoop, locations: results.locations, dialect: results.dialect, sdlangNative: results.sdlangNative }, null, 2));
