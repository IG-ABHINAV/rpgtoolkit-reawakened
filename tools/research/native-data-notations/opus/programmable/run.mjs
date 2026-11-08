// #1778 research (Opus): programmable / composition track (HOCON, CUE, Dhall,
// Nickel, Pkl). Evaluates the authored fixtures that regenerate Crystal
// Immortality's real castle3left placements, compares with the projection,
// and records override/conflict semantics, error locations, environment
// dependence, key order and timing. Tool binaries come from an isolated
// scratch directory; nothing is installed globally.
//
//   node programmable/run.mjs --bin <scratch>/bin --jars <scratch>/jars \
//     --projection <scratch>/projection --work <scratch>/programmable --out <scratch>/results/programmable.json
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { LIBS } from '../notations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const BIN = opt('--bin'), JARS = opt('--jars'), WORK = opt('--work'), OUT = opt('--out');
const expected = JSON.parse(readFileSync(join(opt('--projection'), 'CrystalImmortality/model/scenes/castle3left/scene.json'), 'utf8')).placements;
mkdirSync(WORK, { recursive: true });
const env = { ...process.env, DYLD_FALLBACK_LIBRARY_PATH: '/usr/lib', XDG_CACHE_HOME: join(WORK, 'cache') };
const run = (cmd, a, o = {}) => { const t = performance.now(); const r = spawnSync(cmd, a, { encoding: 'utf8', env, ...o }); return { status: r.status, out: r.stdout, err: r.stderr, ms: Math.round(performance.now() - t) }; };
const firstLines = (s, n = 6) => s.split('\n').filter(Boolean).slice(0, n).join('\n');
const write = (name, text) => { const p = join(WORK, name); writeFileSync(p, text); return p; };
const CP = ['config-1.4.10.jar', 'clojure-1.12.3.jar', 'spec.alpha-0.5.238.jar', 'core.specs.alpha-0.4.74.jar'].map((j) => join(JARS, j)).join(':');
const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)])) : x);
function compare(json) { const got = JSON.parse(json).placements; return { semanticEqual: isDeepStrictEqual(sortKeys(got), sortKeys(expected)), authoredKeyOrderKept: JSON.stringify(got) === JSON.stringify(expected) }; }

const results = { node: process.version, versions: {}, languages: {} };
results.versions.cue = run(join(BIN, 'cue'), ['version']).out.split('\n')[0];
results.versions.dhall = run(join(BIN, 'dhall'), ['--version']).out.trim();
results.versions.nickel = run(join(BIN, 'nickel'), ['--version']).out.trim();
results.versions.pkl = run(join(BIN, 'pkl'), ['--version']).out.trim();
results.versions.hocon = 'com.typesafe:config 1.4.10 (Java 8 via Clojure 1.12.3)';

// CUE ---------------------------------------------------------------------------
{
  const d = join(here, 'cue'); const r = {};
  const ev = run(join(BIN, 'cue'), ['export', 'castle3left.cue', 'soldiers.cue', '--out', 'json'], { cwd: d });
  r.evaluate = { status: ev.status, ms: ev.ms, ...compare(ev.out) };
  r.overrideComputed = firstLines(run(join(BIN, 'cue'), ['export', 'castle3left.cue', 'soldiers.cue', write('cue-override.cue', 'package scene\nplacements: [_, _, _, {at: [401, 415, 1]}, _, _]\n'), '--out', 'json'], { cwd: d }).err);
  r.overrideDefault = JSON.parse(run(join(BIN, 'cue'), ['export', 'castle3left.cue', 'soldiers.cue', write('cue-default.cue', 'package scene\nplacements: [_, {activation: onKey: true}, _, _, _, _]\n'), '--out', 'json'], { cwd: d }).out).placements[1].activation;
  r.constraintViolation = firstLines(run(join(BIN, 'cue'), ['vet', '-c', 'castle3left.cue', 'soldiers.cue', write('cue-bad.cue', 'package scene\nplacements: [{at: [208, 319, 0]}, _, _, _, _, _]\n')], { cwd: d }).err, 8);
  // CUE as a schema system for plain data files in other notations.
  const yamlData = write('placement.yaml', '# authored data file validated by CUE\nid: train-soldier1-1\nactor: train-soldier1\nat: [208, 319, 0]\nactivation: {onKey: false}\n');
  r.vetYamlDataFile = firstLines(run(join(BIN, 'cue'), ['vet', '-c', 'soldiers.cue', yamlData, '-d', '#Placement'], { cwd: d }).err, 6);
  const tomlData = write('placement.toml', 'id = "train-soldier1-1"\nactor = "train-soldier1"\nat = [208, 319, 0]\n[activation]\nonKey = false\n');
  r.vetTomlDataFile = firstLines(run(join(BIN, 'cue'), ['vet', '-c', 'soldiers.cue', tomlData, '-d', '#Placement'], { cwd: d }).err, 6);
  r.environment = 'no environment access during export/vet; only `cue cmd` tool files can read env/files (not exercised)';
  results.languages.cue = r;
}
// Nickel ------------------------------------------------------------------------
{
  const d = join(here, 'nickel'); const r = {};
  const ev = run(join(BIN, 'nickel'), ['export', 'castle3left.ncl', '--format', 'json'], { cwd: d });
  r.evaluate = { status: ev.status, ms: ev.ms, ...compare(ev.out) };
  r.overrideConcrete = firstLines(run(join(BIN, 'nickel'), ['export', write('ncl-override.ncl', `let s = import "${join(d, 'castle3left.ncl')}" in s & { size = { width = 20 } }\n`), '--format', 'json']).err, 12);
  r.overrideDefault = JSON.parse(run(join(BIN, 'nickel'), ['export', write('ncl-default.ncl', `(import "${join(d, 'soldiers.ncl')}").template & { activation = { onKey = true } }\n`), '--format', 'json']).out);
  r.contractViolation = firstLines(run(join(BIN, 'nickel'), ['export', write('ncl-bad.ncl', `let s = import "${join(d, 'soldiers.ncl')}" in [ { id = "x", actor = "a", at = "not-a-list", activation = { onKey = false } } ] | Array s.Placement\n`), '--format', 'json']).err, 12);
  r.query = firstLines(run(join(BIN, 'nickel'), ['query', '--field', 'placements', 'castle3left.ncl'], { cwd: d }).out, 6);
  r.environment = 'no environment builtin exercised; imports are files';
  r.binaryNote = 'nickel 1.18.0 arm64-macos release links /nix/store libiconv; run with DYLD_FALLBACK_LIBRARY_PATH=/usr/lib';
  results.languages.nickel = r;
}
// Pkl ---------------------------------------------------------------------------
{
  const d = join(here, 'pkl'); const r = {}; const main = join(d, 'castle3left.pkl');
  const ev = run(join(BIN, 'pkl'), ['eval', '-f', 'json', 'castle3left.pkl'], { cwd: d });
  r.evaluate = { status: ev.status, ms: ev.ms, ...compare(ev.out) };
  const am = run(join(BIN, 'pkl'), ['eval', '-f', 'json', write('pkl-amend.pkl', `amends "${main}"\nsize { width = 20 }\nplacements { [3] { at = List(401, 415, 1) } }\n`)]);
  r.amendComputedElement = { status: am.status, size: JSON.parse(am.out).size, placement3at: JSON.parse(am.out).placements[3].at, note: 'amend silently overrides the generated value (by design)' };
  r.constraintViolation = firstLines(run(join(BIN, 'pkl'), ['eval', '-f', 'json', write('pkl-bad.pkl', `amends "${main}"\nplacements { [0] { at = List(208, 319, 0) } }\n`)]).err + run(join(BIN, 'pkl'), ['eval', '-f', 'json', join(WORK, 'pkl-bad.pkl')]).out, 14);
  const envFile = write('pkl-env.pkl', 'x = read("env:HOME")\n');
  r.environment = { default: JSON.parse(run(join(BIN, 'pkl'), ['eval', '-f', 'json', envFile]).out).x === process.env.HOME ? 'reads HOME by default' : 'other', restricted: firstLines(run(join(BIN, 'pkl'), ['eval', '-f', 'json', '--allowed-resources', 'prop:', envFile]).err, 3) };
  results.languages.pkl = r;
}
// Dhall -------------------------------------------------------------------------
{
  const d = join(here, 'dhall'); const r = {};
  const ev = run(join(BIN, 'dhall-to-json'), ['--file', 'castle3left.dhall'], { cwd: d });
  r.evaluate = { status: ev.status, ms: ev.ms, ...compare(ev.out) };
  r.rightBiasedMerge = JSON.parse(run(join(BIN, 'dhall-to-json'), ['--file', write('dhall-override.dhall', `let s = ${join(d, 'castle3left.dhall')} in s // { size = s.size // { width = 20 } }\n`)]).out).size;
  r.recursiveMergeCollision = firstLines(run(join(BIN, 'dhall-to-json'), ['--file', write('dhall-collide.dhall', `let s = ${join(d, 'castle3left.dhall')} in s /\\ { size = { width = 20 } }\n`)]).err, 4);
  r.typeError = firstLines(run(join(BIN, 'dhall-to-json'), ['--file', write('dhall-bad.dhall', `let S = ${join(d, 'soldiers.dhall')} in [ S.default // { id = "x", actor = "a", at = [ +1 ], whilePresent = Some { program = 3 } } ] : List S.Placement\n`)]).err, 10);
  r.environment = { envImport: run(join(BIN, 'dhall-to-json'), ['--file', write('dhall-env.dhall', 'env:HOME as Text\n')]).out.trim(), note: 'env: and https:// imports are language features; remote imports can be pinned by sha256 and cached' };
  results.languages.dhall = r;
}
// HOCON -------------------------------------------------------------------------
{
  const d = join(here, 'hocon'); const r = {};
  const ev = run('java', ['-cp', CP, 'clojure.main', 'origins.clj', join(d, 'castle3left.conf')], { cwd: d });
  const json = ev.out.split('\n').find((l) => l.startsWith('JSON '))?.slice(5);
  r.evaluate = { status: ev.status, ms: ev.ms, ...(json ? compare(json) : { error: firstLines(ev.err) }) };
  r.origins = ev.out.split('\n').filter((l) => l.startsWith('ORIGIN placements[3]')).map((l) => l.replace(d, '.'));
  r.envSubstitution = ev.out.split('\n').find((l) => l.startsWith('ENV-SUBSTITUTION'));
  // #1797: the first pass changed cwd AND the root path at once. Correct probe:
  // the same ABSOLUTE root file from several working directories; compare the
  // resolved values and per-value origins. A relative root is reported separately.
  const absRoot = join(d, 'castle3left.conf');
  const runs = Object.fromEntries([d, dirname(d), '/private/tmp', '/'].map((cwd) => { const o = run('java', ['-cp', CP, 'clojure.main', join(d, 'origins.clj'), absRoot], { cwd }); return [cwd, { status: o.status, json: o.out.split('\n').find((l) => l.startsWith('JSON ')) ?? null, origins: o.out.split('\n').filter((l) => l.startsWith('ORIGIN')).join('\n') }]; }));
  const vals = Object.values(runs);
  r.absoluteRootVariedCwd = { cwds: Object.keys(runs), allSucceeded: vals.every((x) => x.status === 0 && x.json), identicalValues: vals.every((x) => x.json === vals[0].json), identicalOrigins: vals.every((x) => x.origins === vals[0].origins), placements: vals[0].json ? JSON.parse(vals[0].json.slice(5)).placements.length : null };
  r.relativeRootFromParentCwd = { note: 'root path given relative to the cwd (programmable/hocon/castle3left.conf from the opus tools dir); this tests root-path resolution, not include resolution', status: run('java', ['-cp', CP, 'clojure.main', join(d, 'origins.clj'), 'programmable/hocon/castle3left.conf'], { cwd: dirname(dirname(d)) }).status };
  const silent = write('hocon-silent.conf', 'include "does-not-exist.conf"\na = 1\n');
  r.missingOptionalInclude = run('java', ['-cp', CP, 'clojure.main', '-e', `(import 'com.typesafe.config.ConfigFactory) (println (.render (.root (ConfigFactory/parseFile (java.io.File. "${silent}")))))`]).out.trim().slice(0, 200);
  const dup = write('hocon-dup.conf', 'speed = 0.3\nspeed = 0.5\nobj { a = 1 }\nobj { b = 2 }\n');
  r.duplicateKeys = run('java', ['-cp', CP, 'clojure.main', '-e', `(import '(com.typesafe.config ConfigFactory ConfigRenderOptions)) (println (.render (.root (ConfigFactory/parseFile (java.io.File. "${dup}"))) (ConfigRenderOptions/concise)))`]).out.trim();
  // Pure TypeScript implementation in Node (browser-capable library).
  const req = createRequire(join(LIBS, 'package.json'));
  try {
    const mod = req('@o3co/ts.hocon');
    const text = readFileSync(join(d, 'soldiers.conf'), 'utf8') + '\n' + readFileSync(join(d, 'castle3left.conf'), 'utf8').replace(/^include .*$/m, '');
    const parse = mod.parse ?? mod.default?.parse;
    const v = parse(text); const obj = typeof v?.toObject === 'function' ? v.toObject() : v?.toJSON?.() ?? v;
    r.tsHocon = { version: JSON.parse(readFileSync(join(LIBS, 'node_modules/@o3co/ts.hocon/package.json'), 'utf8')).version, exports: Object.keys(mod).slice(0, 12), placementsEqual: obj?.placements ? isDeepStrictEqual(sortKeys(obj.placements), sortKeys(expected)) : `no placements (${typeof obj})` };
  } catch (e) { r.tsHocon = { error: e.message.slice(0, 200) }; }
  results.languages.hocon = r;
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(results.languages).map(([k, v]) => [k, v.evaluate]))));
