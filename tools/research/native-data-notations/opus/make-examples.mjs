// #1778 research (Opus): write the AUTHORED mini project (fixtures/authored-mini.json)
// in every compared notation, plus deliberately invalid files, so reviewers can
// open them in an ordinary editor and re-run the checker. Output is small and
// contains no game data.
//
//   node make-examples.mjs --out docs/findings/native-data-notations/opus/examples
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODECS, applyOps } from './notations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[process.argv.indexOf('--out') + 1];
const { documents } = JSON.parse(readFileSync(join(here, 'fixtures/authored-mini.json'), 'utf8'));
const SHOWN = ['yaml', 'json-layout', 'json5-layout', 'hjson', 'toml-rows', 'kdl', 'edn', 'ron-compact', 'xml'];
rmSync(out, { recursive: true, force: true });
for (const id of SHOWN) {
  const c = CODECS[id];
  for (const [path, value] of Object.entries(documents)) {
    const t = join(out, id, `${path}.${c.ext}`); mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, c.stringify(value));
  }
  const scene = documents['scenes/courtyard/scene'];
  const schemaBad = applyOps(scene, [{ op: 'set', path: ['placements', 1, 'at', 2], value: 0 }, { op: 'set', path: ['extensions', 'com.example.weather', 'precipitation'], value: 'hail' }]);
  const inv = join(out, `${id}-invalid`, 'scenes/courtyard'); mkdirSync(inv, { recursive: true });
  writeFileSync(join(inv, `scene.${c.ext}`), c.stringify(schemaBad));
  const text = c.stringify(scene).split('\n'); const at = Math.floor(text.length / 3);
  text.splice(at, 0, id === 'xml' ? '  <string key="broken">no closing tag' : `${/^\s*/.exec(text[at])[0]}"unterminated string`);
  const syn = join(out, `${id}-invalid`, 'scenes/hall'); mkdirSync(syn, { recursive: true });
  writeFileSync(join(syn, `scene.${c.ext}`), text.join('\n'));
}
console.log('wrote', SHOWN.length, 'notations to', out);
