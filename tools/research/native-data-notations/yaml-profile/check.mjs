// #1778 research: validate hand-authored YAML against a strict profile, a JSON Schema
// and project references, reporting file:line:col. Not an adopted format or tool.
//
//   node check.mjs [--libs <dir with node_modules>] [--json] <project-dir | file.yaml>...
//
// Layers, reported separately so a failure says which one caught it:
//   profile    YAML 1.2 core only: no tags, anchors, aliases, non-string keys, duplicate
//              keys, multiple documents; unquoted yes/no/on/off warned (YAML 1.1 readers
//              treat them as booleans)
//   schema     JSON Schema 2020-12 on the derived JSON value (Ajv), plus per-plugin schemas
//   reference  placement -> actor, program -> file exists (JSON Schema cannot do this)
// --json prints the derived JSON value (read-only: JSON is never written back to YAML).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const take = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
const libs = take('--libs') ?? process.env.NOTATION_LIBS ?? '/private/tmp/tkr-1778-opus-experiments';
const rootOpt = take('--root');
const printJson = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1);
const req = createRequire(join(libs, 'package.json'));
const YAML = req('yaml');
const Ajv2020 = req('ajv/dist/2020.js').default ?? req('ajv/dist/2020.js');
const here = dirname(new URL(import.meta.url).pathname);
const schemaDir = resolve(here, '../../../../docs/findings/native-data-notations/yaml-profile');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
const coreSchema = read(join(schemaDir, 'schema.json'));
ajv.addSchema(coreSchema);
const branch = { actor: ajv.compile({ $ref: `${coreSchema.$id}#/$defs/actor` }), scene: ajv.compile({ $ref: `${coreSchema.$id}#/$defs/scene` }), 'tile-layers': ajv.compile({ $ref: `${coreSchema.$id}#/$defs/tiles` }) };
const pluginSchemas = new Map([['com.example.weather', ajv.compile(read(join(schemaDir, 'plugin-weather-v1.schema.json')))]]);

const files = [];
const collect = (p) => { if (statSync(p).isDirectory()) readdirSync(p).sort().forEach((n) => collect(join(p, n))); else if (p.endsWith('.yaml')) files.push(p); };
argv.forEach(collect);

const findings = [];
const report = (file, layer, level, text, pos) => findings.push({ file, layer, level, line: pos?.line, col: pos?.col, text });

const docs = new Map();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lc = new YAML.LineCounter();
  const all = YAML.parseAllDocuments(text, { version: '1.2', schema: 'core', uniqueKeys: true, lineCounter: lc, prettyErrors: false });
  const at = (offset) => (offset == null ? undefined : lc.linePos(offset));
  if (all.length !== 1) report(file, 'profile', 'error', `expected one YAML document, found ${all.length}`);
  const doc = all[0];
  for (const e of doc.errors) report(file, 'profile', 'error', e.message.split('\n')[0], at(e.pos?.[0]));

  const tagAndAnchor = (node) => {
    if (node.anchor) report(file, 'profile', 'error', `anchor &${node.anchor} is not in the profile`, at(node.range?.[0]));
    if (node.tag) report(file, 'profile', 'error', `explicit tag ${node.tag} is not in the profile`, at(node.range?.[0]));
  };
  YAML.visit(doc, {
    // yaml's visitor calls the most specific handler only, so tags and anchors are
    // checked from each node-kind handler through one helper.
    Map(_, node) { tagAndAnchor(node); },
    Seq(_, node) { tagAndAnchor(node); },
    Alias(_, node) { report(file, 'profile', 'error', `alias *${node.source} is not in the profile`, at(node.range[0])); },
    Pair(_, pair) {
      if (!YAML.isScalar(pair.key) || typeof pair.key.value !== 'string') report(file, 'profile', 'error', 'mapping keys must be strings', at(pair.key?.range?.[0]));
    },
    Scalar(_, node, path) {
      tagAndAnchor(node);
      const parent = path[path.length - 1];
      if (YAML.isPair(parent) && parent.key?.value === 'inline' && (node.type === 'BLOCK_FOLDED' || node.type === 'BLOCK_LITERAL')) {
        const header = text.slice(node.range[0], text.indexOf('\n', node.range[0]));
        if (node.type === 'BLOCK_FOLDED') report(file, 'profile', 'error', `script uses a folded block (${header}): newlines would become spaces; use |-`, at(node.range[0]));
        else if (!/^\|[0-9]?-$/.test(header)) report(file, 'profile', 'warn', `script block header is "${header}"; use |- so the script gains no trailing newline`, at(node.range[0]));
      }
      if (node.type === 'PLAIN' && typeof node.value === 'string' && /^(y|yes|n|no|on|off|true|false)$/i.test(node.value) && !/^(true|false)$/.test(node.value))
        report(file, 'profile', 'warn', `unquoted "${node.value}" is a string here but a boolean to YAML 1.1 readers; quote it`, at(node.range[0]));
    },
  });

  if (findings.some((f) => f.file === file && f.layer === 'profile' && f.level === 'error')) continue;
  const value = doc.toJS({ maxAliasCount: 0 });
  docs.set(file, { value, doc, at });
  if (printJson) console.log(JSON.stringify(value, null, 2));

  const locate = (path) => {
    for (let n = path.length; n >= 0; n--) {
      const node = doc.getIn(path.slice(0, n), true);
      if (node?.range) return at(node.range[0]);
    }
  };
  const validateCore = branch[value?.kind];
  if (!validateCore) report(file, 'schema', 'error', `unknown kind ${JSON.stringify(value?.kind)}; expected one of ${Object.keys(branch).join(', ')}`, locate(['kind']));
  else if (!validateCore(value)) {
    for (const e of validateCore.errors) {
      const path = e.instancePath.split('/').slice(1).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
      const extra = e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : '';
      report(file, 'schema', 'error', `${e.instancePath || '(root)'} ${e.message}${extra}`, locate(e.params?.additionalProperty ? [...path, e.params.additionalProperty] : path));
    }
  }
  for (const [ns, body] of Object.entries(value?.extensions ?? {})) {
    const validate = pluginSchemas.get(ns);
    if (!validate) report(file, 'schema', 'info', `plugin "${ns}": no schema installed; content preserved, not validated, not executable`, locate(['extensions', ns]));
    else if (!validate(body)) for (const e of validate.errors) report(file, 'schema', 'error', `plugin "${ns}"${e.instancePath} ${e.message}`, locate(['extensions', ns, ...e.instancePath.split('/').slice(1)]));
  }
}

// ---- project-wide references ----
const actors = new Set([...docs.values()].filter((d) => d.value?.kind === 'actor').map((d) => d.value.id));
for (const [file, { value, doc, at }] of docs) {
  const pos = (path) => { const n = doc.getIn(path, true); return n?.range ? at(n.range[0]) : undefined; };
  if (value?.kind === 'scene') {
    value.placements?.forEach((p, i) => {
      if (actors.size && !actors.has(p.actor)) report(file, 'reference', 'error', `placement "${p.id}" refers to unknown actor "${p.actor}"`, pos(['placements', i, 'actor']));
      for (const hook of ['whilePresent', 'onActivate']) {
        const prog = p[hook]?.program;
        if (prog && !existsSync(join(rootOpt ?? file.replace(/scenes\/.*$/, ''), prog))) report(file, 'reference', 'error', `program "${prog}" does not exist`, pos(['placements', i, hook, 'program']));
      }
    });
    const ids = value.placements?.map((p) => p.id) ?? [];
    ids.forEach((id, i) => { if (ids.indexOf(id) !== i) report(file, 'reference', 'error', `duplicate placement id "${id}"`, pos(['placements', i, 'id'])); });
  }
}

const cwd = process.cwd();
for (const f of findings) console.log(`${relative(cwd, f.file)}:${f.line ?? '?'}:${f.col ?? '?'}  ${f.level.padEnd(5)} [${f.layer}] ${f.text}`);
const errors = findings.filter((f) => f.level === 'error').length;
console.log(`${files.length} file(s): ${errors} error(s), ${findings.filter((f) => f.level === 'warn').length} warning(s), ${findings.filter((f) => f.level === 'info').length} note(s)`);
process.exit(errors ? 1 : 0);
