// #1778 research (Opus): text-editor-friendly checker for a projected project
// tree in ANY candidate notation. Not a product tool; it demonstrates what a
// creator could run without the graphical editor.
//
//   node check.mjs <project-dir> [--plugins <dir>] [--json]
//   node check.mjs <project-dir> --rename <kind>:<old-id>=<new-id> [--mode preserve|reemit]
//
// 1. Parses every document (codec chosen by file extension).
// 2. Validates it against schemas/native-model.schema.json (JSON Schema 2020-12)
//    and each namespaced extension against an installed plugin schema, or
//    reports it as UNVALIDATED (missing schema / version mismatch) and keeps it.
// 3. Resolves every `x-ref` reference project-wide (JSON Schema cannot) and
//    reports broken ones with file:line:col where the codec can locate them.
// 4. Flags script string literals that look like legacy file names as
//    unverifiable script references (literal screening only, not resolution).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { CODECS, LIBS } from './notations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(LIBS, 'package.json'));
const Ajv2020 = req('ajv/dist/2020').default;

export const EXT_CODEC = { yaml: 'yaml', yml: 'yaml', json: 'json-layout', json5: 'json5-layout', hjson: 'hjson', toml: 'toml-rows', kdl: 'kdl', edn: 'edn', ron: 'ron', xml: 'xml' };
const KIND_DIR = { actor: 'actors', item: 'items', skill: 'skills', effect: 'effects', clip: 'clips', 'tile-animation': 'tile-animations', environment: 'environments' };

export function createValidator(pluginDir) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-ref', schemaType: 'string' });
  const core = JSON.parse(readFileSync(join(here, 'schemas/native-model.schema.json'), 'utf8'));
  const validateCore = ajv.compile(core);
  const plugins = new Map();
  if (pluginDir && existsSync(pluginDir)) for (const f of readdirSync(pluginDir).filter((n) => n.endsWith('.schema.json'))) {
    const m = /^(.*)\.v(\d+)\.schema\.json$/.exec(f); if (!m) continue;
    plugins.set(`${m[1]}@${m[2]}`, ajv.compile(JSON.parse(readFileSync(join(pluginDir, f), 'utf8'))));
  }
  return { core, validateCore, plugins, ajv };
}

/** Validate one decoded document; returns core errors plus per-namespace extension status. */
export function validateValue(v, value) {
  const out = { core: [], extensions: [] };
  if (!v.validateCore(value)) out.core = v.validateCore.errors.map((e) => ({ path: e.instancePath, message: `${e.message}${e.params?.additionalProperty ? ` '${e.params.additionalProperty}'` : ''}${e.params?.allowedValues ? ` ${JSON.stringify(e.params.allowedValues)}` : ''}` }));
  const visit = (x, path) => {
    if (!x || typeof x !== 'object') return;
    if (!Array.isArray(x) && x.extensions && typeof x.extensions === 'object') {
      for (const [ns, data] of Object.entries(x.extensions)) {
        const p = [...path, 'extensions', ns];
        const installed = [...v.plugins.keys()].filter((k) => k.startsWith(`${ns}@`));
        const fn = v.plugins.get(`${ns}@${data?.version}`);
        if (fn) out.extensions.push({ namespace: ns, path: p, status: fn(data) ? 'validated' : 'invalid', errors: fn.errors?.map((e) => ({ path: `/${p.join('/')}${e.instancePath}`, message: e.message })) ?? [] });
        else out.extensions.push({ namespace: ns, path: p, status: installed.length ? 'unvalidated-version-mismatch' : 'unvalidated-no-schema', detail: installed.length ? `data version ${data?.version}; installed ${installed.join(', ')}` : 'plugin schema not installed; data preserved, not executed or trusted' });
      }
    }
    for (const [k, c] of Object.entries(x)) if (k !== 'extensions') visit(c, [...path, Array.isArray(x) ? Number(k) : k]);
  };
  visit(value, []);
  return out;
}

/** Walk schema + value together and return every x-ref string with its JSON path. */
export function collectRefs(schema, value) {
  const refs = [];
  const resolve = (s) => { while (s && s.$ref) s = s.$ref.startsWith('#/$defs/') ? schema.$defs[s.$ref.slice(8)] : null; return s; };
  const fits = (s, x) => { s = resolve(s); if (!s) return false; if (s.type === 'null') return x === null; if (s.type === 'object' && (typeof x !== 'object' || x === null || Array.isArray(x))) return false; if (s.type === 'string') return typeof x === 'string'; return (s.required ?? []).every((k) => x && Object.hasOwn(x, k)); };
  const walk = (s, x, path) => {
    s = resolve(s); if (!s || x === undefined) return;
    if (s['x-ref'] && typeof x === 'string') refs.push({ kind: s['x-ref'], value: x, path });
    for (const sub of s.allOf ?? []) {
      if (sub.if) { const k = sub.if.properties?.kind?.const; if (k && x?.kind === k) walk(sub.then, x, path); } else walk(sub, x, path);
    }
    if (s.oneOf) { const b = s.oneOf.find((o) => fits(o, x)); if (b) walk(b, x, path); }
    if (Array.isArray(x)) { x.forEach((item, i) => walk(s.prefixItems?.[i] ?? s.items, item, [...path, i])); return; }
    if (x && typeof x === 'object') for (const [k, c] of Object.entries(x)) walk(s.properties?.[k] ?? (typeof s.additionalProperties === 'object' ? s.additionalProperties : null), c, [...path, k]);
  };
  walk(schema, value, []);
  return refs;
}

export function loadProject(dir) {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
  const docs = [], other = new Set();
  for (const f of files) {
    const rel = relative(dir, f); const ext = rel.split('.').at(-1);
    if (rel.startsWith('scripts/') || rel.startsWith('media/') || rel.startsWith('tilesets/') || rel.startsWith('fonts/') || !EXT_CODEC[ext]) { other.add(rel); continue; }
    const codecId = EXT_CODEC[ext]; const text = readFileSync(f, 'utf8');
    try { docs.push({ file: rel, id: rel.slice(0, -(ext.length + 1)), codecId, text, value: CODECS[codecId].parse(text) }); }
    catch (e) { docs.push({ file: rel, codecId, text, parseError: { message: e.message, line: e.line ?? null, col: e.col ?? null } }); }
  }
  return { dir, docs, other };
}

export function checkProject(project, validator, { skipExternal = false } = {}) {
  const diags = [];
  const where = (doc, path) => { try { return CODECS[doc.codecId].locate?.(doc.text, path) ?? null; } catch { return null; } };
  const exists = new Map();
  for (const d of project.docs) if (d.value?.kind) {
    const k = d.value.kind;
    if (k === 'scene') exists.set(`scene|${d.value.id}`, d.file);
    else if (KIND_DIR[k]) exists.set(`${k}|${d.id.slice(KIND_DIR[k].length + 1)}`, d.file);
    if (KIND_DIR[k] && d.id.slice(KIND_DIR[k].length + 1) !== d.value.id) diags.push({ file: d.file, severity: 'error', code: 'id-path-mismatch', message: `document id '${d.value.id}' does not match its path` });
    if (k === 'scene' && d.id !== `scenes/${d.value.id}/scene`) diags.push({ file: d.file, severity: 'error', code: 'id-path-mismatch', message: `scene id '${d.value.id}' must live at scenes/${d.value.id}/scene.*` });
  }
  // Scene <-> sibling tile-layer document consistency (#1787).
  const byId = new Map(project.docs.filter((d) => d.value).map((d) => [d.id, d]));
  for (const d of project.docs) {
    if (d.value?.kind === 'scene' && d.value.tiles) {
      const t = byId.get(`scenes/${d.value.id}/${d.value.tiles}`);
      if (!t || t.value.kind !== 'tile-layers') diags.push({ file: d.file, severity: 'error', code: 'missing-tile-layers', message: `sibling tile-layer document scenes/${d.value.id}/${d.value.tiles}.* not found` });
    }
    if (d.value?.kind === 'tile-layers' && d.id !== `scenes/${d.value.scene}/tiles`) diags.push({ file: d.file, severity: 'error', code: 'id-path-mismatch', message: `tile layers for scene '${d.value.scene}' must live at scenes/${d.value.scene}/tiles.*` });
  }
  // Identity uniqueness inside ordered collections (#1789): a clean textual
  // merge of two same-ID additions must not pass silently.
  const UNIQUE = { scene: [['placements', 'id'], ['regions', 'id'], ['triggers', 'id']], clip: [['frames', 'id']], 'tile-layers': [['palette', 'index'], ['layers', 'layer']] };
  for (const d of project.docs) for (const [list, key] of UNIQUE[d.value?.kind] ?? []) {
    const seen = new Map();
    (d.value[list] ?? []).forEach((x, i) => { const v = x?.[key]; if (v === undefined) return; if (seen.has(v)) diags.push({ file: d.file, ...(CODECS[d.codecId].locate?.(d.text, [list, i, key]) ?? {}), severity: 'error', code: 'duplicate-id', path: `/${list}/${i}/${key}`, message: `${list} ${key} ${JSON.stringify(v)} repeats /${list}/${seen.get(v)}` }); else seen.set(v, i); });
  }
  for (const d of project.docs) {
    if (d.parseError) { diags.push({ file: d.file, line: d.parseError.line, col: d.parseError.col, severity: 'error', code: 'syntax', message: d.parseError.message }); continue; }
    const r = validateValue(validator, d.value);
    for (const e of r.core) { const p = e.path.split('/').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s.replace(/~1/g, '/').replace(/~0/g, '~'))); diags.push({ file: d.file, ...(where(d, p) ?? {}), severity: 'error', code: 'schema', path: e.path, message: e.message }); }
    for (const x of r.extensions) {
      const loc = where(d, x.path) ?? {};
      if (x.status === 'invalid') for (const e of x.errors) { const p = e.path.split('/').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s)); diags.push({ file: d.file, ...(where(d, p) ?? loc), severity: 'error', code: 'plugin-schema', namespace: x.namespace, path: e.path, message: e.message }); }
      else if (x.status !== 'validated') diags.push({ file: d.file, ...loc, severity: 'info', code: x.status, namespace: x.namespace, message: x.detail });
    }
    for (const ref of collectRefs(validator.core, d.value)) {
      let ok;
      if (skipExternal && ['program', 'asset', 'tileset', 'tile-animation'].includes(ref.kind)) continue;
      if (ref.kind === 'program' || ref.kind === 'asset') ok = project.other.has(ref.value);
      else if (ref.kind === 'tileset') ok = project.other.has(`tilesets/${ref.value}.tst`) || project.other.has(`tilesets/${ref.value}.iso`);
      else ok = exists.has(`${ref.kind}|${ref.value}`);
      if (!ok) diags.push({ file: d.file, ...(where(d, ref.path) ?? {}), severity: 'error', code: 'broken-reference', path: `/${ref.path.join('/')}`, message: `${ref.kind} '${ref.value}' not found` });
    }
    // Literal screening of inline RPGCode for legacy file-name strings.
    const scan = (x, path) => { if (!x || typeof x !== 'object') return; if (typeof x.inline === 'string') for (const m of x.inline.matchAll(/"([^"]+\.(?:brd|prg|itm|tem|ene|anm|wav|mid|bmp|jpg|png|gif))"/gi)) diags.push({ file: d.file, ...(where(d, [...path, 'inline']) ?? {}), severity: 'warning', code: 'script-literal-reference', path: `/${[...path, 'inline'].join('/')}`, message: `inline RPGCode names legacy file "${m[1]}"; not resolved or rewritten by data tools` }); for (const [k, c] of Object.entries(x)) scan(c, [...path, Array.isArray(x) ? Number(k) : k]); };
    scan(d.value, []);
  }
  return diags;
}

/**
 * Files a rename of `kind:from` to `to` must move. Scenes move their whole
 * folder (scene + sibling tile layers, #1787); other kinds move one document.
 * Throws, before anything is written, if a destination already exists (#1788).
 */
export function planRenameMoves(project, kind, from, to) {
  const KIND = { ...KIND_DIR, scene: 'scenes' };
  const dirName = KIND[kind];
  if (!dirName) return [];
  const srcPrefix = kind === 'scene' ? `scenes/${from}/` : `${dirName}/${from}.`;
  const moves = project.docs.filter((d) => d.file.startsWith(srcPrefix)).map((d) => ({ from: d.file, to: kind === 'scene' ? `scenes/${to}/${d.file.slice(srcPrefix.length)}` : `${dirName}/${to}.${d.file.slice(srcPrefix.length)}` }));
  const taken = new Set([...project.docs.map((d) => d.file), ...project.other]);
  const clash = kind === 'scene' ? [...taken].filter((f) => f.startsWith(`scenes/${to}/`)) : [...taken].filter((f) => f.startsWith(`${dirName}/${to}.`));
  if (clash.length) throw Object.assign(new Error(`rename refused: destination already exists (${clash.join(', ')}); nothing was written`), { code: 'RENAME_TARGET_EXISTS' });
  return moves;
}

/** Rename a referenced document id project-wide; returns changed files. */
export function renameReference(project, validator, kind, from, to, mode = 'preserve') {
  planRenameMoves(project, kind, from, to);
  const changed = [];
  for (const d of project.docs) {
    if (!d.value) continue;
    const hits = collectRefs(validator.core, d.value).filter((r) => r.kind === kind && r.value === from);
    const selfId = d.value.kind === kind && d.value.id === from ? [{ path: ['id'] }] : [];
    const ops = [...hits, ...selfId].map((h) => ({ op: 'set', path: h.path, value: to }));
    if (!ops.length) continue;
    const codec = CODECS[d.codecId];
    const before = d.text;
    if (mode === 'preserve' && codec.edit) d.text = codec.edit(d.text, ops);
    else { let v = structuredClone(d.value); for (const o of ops) { let p = v; for (const k of o.path.slice(0, -1)) p = p[k]; p[o.path.at(-1)] = to; } d.text = codec.stringify(v); }
    d.value = codec.parse(d.text);
    changed.push({ file: d.file, references: hits.length, renamedSelf: selfId.length > 0, mode: mode === 'preserve' && codec.edit ? 'format-preserving' : 're-emit', before, after: d.text });
  }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args[0];
  const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
  const validator = createValidator(opt('--plugins') ?? join(here, 'schemas/plugins'));
  const project = loadProject(dir);
  const rename = opt('--rename');
  if (rename) {
    const [, kind, from, to] = /^([^:]+):(.+)=(.+)$/.exec(rename);
    let moves;
    try { moves = planRenameMoves(project, kind, from, to); } catch (e) { console.error(e.message); process.exit(2); }
    const changed = renameReference(project, validator, kind, from, to, opt('--mode') ?? 'preserve');
    for (const c of changed) { writeFileSync(join(dir, c.file), c.after); console.log(`updated ${c.file} (${c.references} reference(s)${c.renamedSelf ? ', renamed id' : ''}, ${c.mode})`); }
    for (const m of moves) { const target = join(dir, m.to); mkdirSync(dirname(target), { recursive: true }); renameSync(join(dir, m.from), target); console.log(`moved ${m.from} -> ${m.to}`); }
    process.exit(0);
  }
  const diags = checkProject(project, validator, { skipExternal: args.includes('--skip-external') });
  if (args.includes('--json')) console.log(JSON.stringify(diags, null, 1));
  else for (const d of diags) console.log(`${d.file}${d.line ? `:${d.line}:${d.col ?? 1}` : ''}: ${d.severity}: [${d.code}] ${d.message}${d.path ? ` (at ${d.path})` : ''}`);
  const errors = diags.filter((d) => d.severity === 'error').length;
  console.error(`${project.docs.length} documents, ${errors} error(s), ${diags.length - errors} warning/info`);
  process.exit(errors ? 1 : 0);
}
