// Text-editor companion; validates the experimental fixture, not a native game schema.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAdapters } from './adapters.mjs';
import { duplicateIdentities, unresolvedActorReferences } from './semantic-checks.mjs';
export async function loadAdapters(scratch) {
  const req = createRequire(join(scratch, 'package.json'));
  const load = async name => import(pathToFileURL(req.resolve(name)).href);
  const unwrap = m => m.default ?? m;
  const deps = { YAML: await load('yaml'), KDL: await load('@bgotink/kdl'), KJSON: await load('@bgotink/kdl/json'),
    TOML: await load('smol-toml'), JSON5: unwrap(await load('json5')), Hjson: unwrap(await load('hjson')),
    EDN: await load('edn-data'), XML: unwrap(await load('fast-xml-parser')), SDL: unwrap(await load('sdlang')) };
  const adapters = createAdapters(deps);
  function ron(mode, text) {
    const result = spawnSync(join(scratch, 'ron-target/release/notation-ron-probe'), [mode], { input: text, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout;
  }
  adapters.RON = { ext: 'ron', comment: '// creator note\n', encode: v => ron('encode', JSON.stringify(v)), decode: s => JSON.parse(ron('decode', s)) };
  adapters.RON.noop = s => adapters.RON.encode(adapters.RON.decode(s));
  adapters.RON.edit = (s, path, value) => { const data = adapters.RON.decode(s); let n = data; for (const key of path.slice(0, -1)) n = n[key]; n[path.at(-1)] = value; return adapters.RON.encode(data); };
  return { adapters, deps, req };
}
export async function inspect(scratch, notation, file) {
  const { adapters, req } = await loadAdapters(scratch);
  const text = readFileSync(file, 'utf8');
  const value = adapters[notation].decode(text);
  const Ajv2020 = req('ajv/dist/2020.js').default;
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(JSON.parse(readFileSync(join(scratch, 'schemas/core.json'), 'utf8')));
  const schemaValid = validate(value); const identityErrors = duplicateIdentities(value);
  const coreValid = schemaValid && identityErrors.length === 0;
  const errors = [...structuredClone(validate.errors ?? []), ...identityErrors];
  const plugin = ajv.compile(JSON.parse(readFileSync(join(scratch, 'schemas/patrol-v1.json'), 'utf8')));
  const unvalidated = [];
  for (const [namespace, content] of Object.entries(value.actor.extensions ?? {})) {
    if (namespace !== '@example/patrol') { unvalidated.push(namespace); continue; }
    if (!plugin(content)) errors.push(...plugin.errors.map(error => ({ namespace, ...error })));
  }
  const refs = unresolvedActorReferences(value);
  return { file, notation, schemaValid, coreValid, errors, unresolvedReferences: refs, preservedButUnvalidatedPlugins: unvalidated, executable: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await inspect(process.argv[2], process.argv[3], process.argv[4]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.coreValid || result.errors.length || result.unresolvedReferences.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
