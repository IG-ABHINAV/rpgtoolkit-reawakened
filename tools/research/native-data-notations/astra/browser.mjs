// Real browser experiment, not a jsdom or claimed browser-compatible Node run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const scratch = process.argv[2];
const req = createRequire(join(scratch, 'package.json'));
const esbuild = req('esbuild');
const { chromium } = req('playwright');
const out = join(scratch, 'browser'); mkdirSync(out, { recursive: true });
const packages = { YAML: 'yaml', KDL: '@bgotink/kdl', TOML: 'smol-toml', JSON5: 'json5', Hjson: 'hjson/bundle/hjson.js', EDN: 'edn-data', XML: 'fast-xml-parser', SDLang: 'sdlang', Ajv2020: 'ajv/dist/2020.js' };
const results = { bundle: {}, browser: null, probes: {} };
for (const [name, pkg] of Object.entries(packages)) {
  try {
    const built = await esbuild.build({ stdin: { contents: `import * as lib from '${pkg}'; globalThis.library = lib;`, resolveDir: scratch }, bundle: true, minify: true, write: false, platform: 'browser' });
    results.bundle[name] = { rawBytes: built.outputFiles[0].contents.length, gzipBytes: gzipSync(built.outputFiles[0].contents).length };
  } catch (error) { results.bundle[name] = { error: String(error) }; }
}
const adapterFile = join(dirname(fileURLToPath(import.meta.url)), 'adapters.mjs');
const content = `import {createAdapters} from ${JSON.stringify(adapterFile)};
import {duplicateIdentities,unresolvedActorReferences,renameActor,sequenceExpectations,allowedSequenceResult} from ${JSON.stringify(join(dirname(adapterFile), 'semantic-checks.mjs'))};
import * as YAML from 'yaml';import * as KDL from '@bgotink/kdl';import * as KJSON from '@bgotink/kdl/json';
import * as TOML from 'smol-toml';import JSON5 from 'json5';import Hjson from 'hjson/bundle/hjson.js';import * as EDN from 'edn-data';
import * as XML from 'fast-xml-parser';import * as SDL from 'sdlang';import Ajv2020 from 'ajv/dist/2020.js';
const adapters=createAdapters({YAML,KDL,KJSON,TOML,JSON5,Hjson,EDN,XML,SDL});
const canonical=v=>JSON.stringify(v,(_k,o)=>o && !Array.isArray(o) && typeof o==='object'?Object.fromEntries(Object.entries(o).sort()):o);
globalThis.probe=(data,schema)=>{const result={};const ajv=new Ajv2020({allErrors:true});const valid=ajv.compile(schema);
for(const [name,a] of Object.entries(adapters)){try{const t=performance.now();const text=a.encode(data);const parsed=a.decode(text);const changed=a.edit(text,['actor','name'],'browser-review');const edited=a.decode(changed);const noOp=a.noop(text);const bad=structuredClone(parsed);bad.scene.width=-1;
result[name]={roundtrip:canonical(parsed)===canonical(data),noOpSemantic:canonical(a.decode(noOp))===canonical(data),edited:edited.actor.name==='browser-review',valid:valid(parsed),invalidRejected:!valid(bad),elapsedMs:performance.now()-t};}catch(e){result[name]={error:String(e)}}}return result;};
globalThis.reviewProbe=data=>{
 const result={};
 for(const [name,a] of Object.entries(adapters)){
  const duplicate=structuredClone(data);duplicate.scene.placements.push(structuredClone(duplicate.scene.placements[0]));duplicate.clip.frames.push(structuredClone(duplicate.clip.frames[0]));
  const errors=duplicateIdentities(a.decode(a.encode(duplicate)));
  const stale=structuredClone(data),old=stale.actor.id;renameActor(stale,old,old+'-browser');stale.designExample.performance.actor=old;
  const allowed=sequenceExpectations(data,'simultaneous-add'),bad=structuredClone(allowed[0]);bad.actor.name='CORRUPTED';
  result[name]={duplicatePlacementsRejected:errors.some(e=>e.instancePath.startsWith('/scene/placements/')),duplicateFramesRejected:errors.some(e=>e.instancePath.startsWith('/clip/frames/')),
   stalePerformanceRejected:unresolvedActorReferences(a.decode(a.encode(stale))).some(e=>e.path==='/designExample/performance/actor'),fullDocumentCorruptionRejected:!allowedSequenceResult(bad,allowed)};
 }
 const sample=Object.fromEntries([['a\\nb',1],['a\\tb',2],['a\\rb',3],['a b',4]]);
 const doc=new DOMParser().parseFromString(adapters.XML.encode(sample),'application/xml');
 const actual=Object.fromEntries([...doc.documentElement.children].map(n=>[n.getAttribute('key'),Number(n.textContent)]));
 const rejects=(fn,code)=>{try{fn();return false;}catch(e){return String(e).includes(code);}};
 result.XML.attributeReferencesMatchDOM=canonical(actual)===canonical(sample)&&!doc.querySelector('parsererror');
 result.XML.controlEncodingRejected=rejects(()=>adapters.XML.encode({value:String.fromCharCode(0)}),'XML10_FORBIDDEN_CHARACTER');
 result.XML.booleanTypoRejected=rejects(()=>adapters.XML.decode('<v type="boolean">treu</v>'),'XML_BOOLEAN_LEXICAL_VALUE');
 return result;
};`;
await esbuild.build({ stdin: { contents: content, resolveDir: scratch }, outfile: join(out, 'probe.js'), bundle: true, platform: 'browser', format: 'iife' });
let browser;
try {
  browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
  results.browser = await browser.version();
  const page = await browser.newPage();
  await page.addScriptTag({ path: join(out, 'probe.js') });
  const data = JSON.parse(readFileSync(join(scratch, 'fixtures/Caoquest.json'), 'utf8'));
  const schema = JSON.parse(readFileSync(join(scratch, 'schemas/core.json'), 'utf8'));
  results.probes = await page.evaluate(({ data, schema }) => globalThis.probe(data, schema), { data, schema });
  results.postReview = await page.evaluate(data => globalThis.reviewProbe(data), data);
} catch (error) { results.browserError = String(error); }
finally { if (browser) await browser.close(); }
writeFileSync(join(scratch, 'browser-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
assert(!results.browserError, results.browserError);
for (const [name, probe] of Object.entries(results.probes)) {
  for (const key of ['roundtrip', 'noOpSemantic', 'edited', 'valid', 'invalidRejected']) assert.equal(probe[key], true, name + '/' + key);
}
for (const [name, probe] of Object.entries(results.postReview ?? {})) {
  for (const [key, value] of Object.entries(probe)) assert.equal(value, true, name + '/' + key);
}
