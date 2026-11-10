// #1778 research: YAML is the source of truth, JSON is derived. Shows why edits must go
// through the YAML document and not through JSON.
//   node edit-demo.mjs <scene.yaml> [--libs <dir>]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const a = process.argv.slice(2);
const li = a.indexOf('--libs'); const libs = li < 0 ? (process.env.NOTATION_LIBS ?? '/private/tmp/tkr-1778-opus-experiments') : a.splice(li, 2)[1];
const YAML = createRequire(join(libs, 'package.json'))('yaml');
const text = readFileSync(a[0], 'utf8');
const newScript = 'mwin("Halt! State your business.");\n// note: the gate is closed\nif (getVar("gateOpen") = 1) then { send("hall", 32, 96, 1); }';
const lines = (t) => t.split('\n');
const changed = (x, y) => lines(y).filter((l, i) => l !== lines(x)[i]).length;

// A. edit through the YAML document: comments, header and layout survive
const doc = YAML.parseDocument(text, { version: '1.2', schema: 'core' });
const node = doc.getIn(['placements', 0, 'whilePresent', 'inline'], true);
node.value = newScript;                       // keeps node.type === BLOCK_LITERAL
const viaYaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
console.log('A. edit through the YAML document');
console.log(`   comments kept: ${(viaYaml.match(/#/g) ?? []).length}/${(text.match(/#/g) ?? []).length}   still a |- block: ${/inline: \|-\n/.test(viaYaml)}   lines changed: ${changed(text, viaYaml)}`);

// B. the wrong way: derive JSON, edit it, write YAML back
const json = JSON.parse(JSON.stringify(doc.toJS()));
json.placements[0].whilePresent.inline = newScript;
const viaJson = YAML.stringify(json, { lineWidth: 0, flowCollectionPadding: false });
console.log('B. derive JSON, edit it, regenerate YAML (do not do this)');
console.log(`   comments kept: ${(viaJson.match(/#/g) ?? []).length}/${(text.match(/#/g) ?? []).length}   lines changed: ${changed(text, viaJson)} of ${lines(viaJson).length}`);
console.log('\n--- A (full file) ---\n' + viaYaml);
