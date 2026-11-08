// #1778 research (Opus): executable checks for every review finding against
// this investigator's tools (#1780 #1782-#1797). Each check runs the real code
// path on a reproduction of the reviewer's case and records pass/fail.
//
//   node correction-checks.mjs --projection <scratch>/projection --decoded <scratch>/decoded --results <scratch>/results --out <file>
import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CODECS, applyOps } from './notations.mjs';
import { createValidator, collectRefs, loadProject, checkProject, renameReference } from './check.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => args[args.indexOf(n) + 1];
const P = opt('--projection'), D = opt('--decoded'), RES = opt('--results'), OUT = opt('--out');
const validator = createValidator(join(here, 'schemas/plugins'));
const checks = {};
const check = (id, fn) => { try { const r = fn(); checks[id] = { pass: r.pass === true, ...r }; } catch (e) { checks[id] = { pass: false, error: String(e.message ?? e) }; } };
const cli = (a) => spawnSync(process.execPath, [join(here, 'check.mjs'), ...a], { encoding: 'utf8' });

check('#1782 TOML null mapping injective (nested real {"$null":true}, "$$x" keys, real null)', () => {
  const v = { kind: 'scene', id: 'probe', extensions: { 'org.example.unknown': { version: 1, nested: { $null: true }, actualNull: null, $$x: 2, list: [null, { $null: true }] } } };
  const r = Object.fromEntries(['toml', 'toml-rows'].map((id) => [id, isDeepStrictEqual(CODECS[id].parse(CODECS[id].stringify(v)), v)]));
  return { pass: Object.values(r).every(Boolean), r };
});
check('#1783 JSON preserve path really parses (invalid input rejected, valid no-op parses)', () => {
  const r = {};
  for (const id of ['json', 'json-layout']) { let rejected = false; try { CODECS[id].edit('this is not JSON', []); } catch { rejected = true; } r[id] = { invalidRejected: rejected, validNoopIdentical: CODECS[id].edit('{"a": [1, 2]}\n', []) === '{"a": [1, 2]}\n' }; }
  return { pass: Object.values(r).every((x) => x.invalidRejected && x.validNoopIdentical), r };
});
check('#1790 EDN arbitrary string keys (project-owned layout printer)', () => {
  const v = { payload: { 'a b': 1, 'x/y': 2, '1st': 3, ok: 4, 'com.example.weather': 5 } };
  const back = CODECS.edn.parse(CODECS.edn.stringify(v));
  const lib = CODECS['edn-oneline'].parse(CODECS['edn-oneline'].stringify(v));
  return { pass: isDeepStrictEqual(back, v), libraryOneLinePrinterStillCorrupts: !isDeepStrictEqual(lib, v), libraryResult: lib };
});
check('#1791 XML "__proto__" stays data', () => { const v = JSON.parse('{"payload":{"__proto__":{"secret":7},"safe":1}}'); const back = CODECS.xml.parse(CODECS.xml.stringify(v)); return { pass: isDeepStrictEqual(back, v) && Object.getPrototypeOf(back.payload) === Object.prototype }; });
check('#1792 XML attribute keys with TAB/LF/space stay distinct', () => { const v = { payload: { 'a\nb': 1, 'a\tb': 2, 'a b': 3 } }; return { pass: isDeepStrictEqual(CODECS.xml.parse(CODECS.xml.stringify(v)), v) }; });
check('#1795 XML forbidden characters mapped faithfully (escaped=true) and output is well-formed', () => {
  const v = { payload: 'a\u0000b\uFFFFc', 'k\u0001': '\uD800x' }; const t = CODECS.xml.stringify(v);
  const py = spawnSync('python3', ['-c', 'import sys,xml.etree.ElementTree as E; E.fromstring(sys.stdin.buffer.read()); print("ok")'], { input: t, encoding: 'utf8' });
  return { pass: isDeepStrictEqual(CODECS.xml.parse(t), v) && py.stdout.trim() === 'ok', pythonElementTree: py.stdout.trim() || py.stderr.trim().split('\n').pop() };
});
check('#1793/#1794 KDL edits on argument-only arrays', () => {
  const cases = [['insert-object-among-scalars', { a: [1, 2, 3] }, { op: 'insert', path: ['a'], index: 1, value: { x: 4 } }], ['move-scalars', { a: [1, 2, 3] }, { op: 'move', path: ['a'], from: 0, to: 2 }], ['nested-insert-array', { p: { a: [1, 2] } }, { op: 'insert', path: ['p', 'a'], index: 0, value: [9] }], ['insert-empty-array', { a: [] }, { op: 'insert', path: ['a'], index: 0, value: { x: 4 } }]];
  const r = Object.fromEntries(cases.map(([n, v, op]) => [n, isDeepStrictEqual(CODECS.kdl.parse(CODECS.kdl.edit(CODECS.kdl.stringify(v), [op])), applyOps(v, [op]))]));
  return { pass: Object.values(r).every(Boolean), r };
});
check('#1786 every projected reference-bearing path is collected (combat stances, onLevelUp, portraits, tiles…)', () => {
  const doc = { kind: 'actor', id: 'hero', presence: { portrait: { image: 'media/images/absent.png' }, legacyTiles: { rest: [{ tileset: 'missing-tileset', tile: 1 }, null] } }, character: { progression: { onLevelUp: { program: 'scripts/absent.prg' } }, combat: { stances: { fight: 'missing-clip' }, sounds: ['media/audio/a.wav', null] } }, combatant: { skills: ['s1'], onDefeat: { program: 'scripts/win.prg' } } };
  const kinds = collectRefs(validator.core, doc).map((x) => `${x.kind}:${x.value}`).sort();
  const want = ['asset:media/audio/a.wav', 'asset:media/images/absent.png', 'clip:missing-clip', 'program:scripts/absent.prg', 'program:scripts/win.prg', 'skill:s1', 'tileset:missing-tileset'];
  return { pass: isDeepStrictEqual(kinds, want), kinds };
});
check('#1786 audit: projected string leaves not collected as references (real cohort)', () => {
  const ignored = new Map();
  for (const g of readdirSync(P)) {
    const proj = loadProject(join(P, g, 'model'));
    for (const d of proj.docs) {
      if (!d.value) continue;
      const refPaths = new Set(collectRefs(validator.core, d.value).map((x) => x.path.join('/')));
      const walk = (x, path) => { if (typeof x === 'string') { const p = path.join('/'); if (!refPaths.has(p)) { const k = `${d.value.kind}:${path.map((s) => (typeof s === 'number' ? '#' : s)).join('/')}`; ignored.set(k, (ignored.get(k) ?? 0) + 1); } return; } if (x && typeof x === 'object') for (const [k, c] of Object.entries(x)) walk(c, [...path, Array.isArray(x) ? Number(k) : k]); };
      walk(d.value, []);
    }
  }
  const paths = [...ignored.keys()].sort();
  // Remaining strings must be names, ids, enums, text, variables, inline code or compat data.
  const suspicious = paths.filter((p) => !/(:kind$|:id$|\/id$|:name$|\/name$|description$|:title$|menuLabel$|\/inline$|statVariables|\/variable$|\/equals$|\/set$|\/mode$|restrictedTo|accessory|armourSlots|accessorySlots|\/slots\/|layerTitles|constants|compat\/|:tiles$|tile-layers:scene$|regions\/#\/kind$|\/while$|\/stance$|^effect:)/.test(p));
  return { pass: suspicious.length === 0, uncollectedPathCount: paths.length, suspicious, sample: paths.slice(0, 80) };
});
check('#1787 scene rename moves sibling tiles; checker flags a left-behind tiles doc', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opus-1787-')); cpSync(join(P, 'demo/model'), dir, { recursive: true });
  const ren = cli([dir, '--rename', 'scene:out=harbour']); const after = JSON.parse(cli([dir, '--json']).stdout);
  const dir2 = mkdtempSync(join(tmpdir(), 'opus-1787b-')); cpSync(join(P, 'demo/model'), dir2, { recursive: true });
  const p2 = loadProject(dir2); for (const c of renameReference(p2, validator, 'scene', 'out', 'harbour')) writeFileSync(join(dir2, c.file), c.after); // old behaviour: no folder move
  const stale = JSON.parse(cli([dir2, '--json']).stdout).filter((x) => x.severity === 'error').map((x) => x.code);
  const leftover = existsSync(join(dir, 'scenes/out')) ? readdirSync(join(dir, 'scenes/out')) : [];
  const errorsAfter = after.filter((x) => x.severity === 'error');
  return { pass: ren.status === 0 && existsSync(join(dir, 'scenes/harbour/tiles.json')) && leftover.length === 0 && errorsAfter.length === 0 && stale.includes('id-path-mismatch'), leftoverFilesInOldFolder: leftover, errorsAfterRename: errorsAfter.map((x) => `${x.code} ${x.file}`), renameOutput: ren.stdout.trim().split('\n'), staleTreeErrors: [...new Set(stale)] };
});
check('#1788 rename onto an existing document is refused before any write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opus-1788-')); cpSync(join(P, 'demo/model'), dir, { recursive: true });
  const before = readFileSync(join(dir, 'clips/start/start-defend.json'), 'utf8'); const actorBefore = readFileSync(join(dir, 'actors/start.json'), 'utf8');
  const r = cli([dir, '--rename', 'clip:start/start-fight=start/start-defend']);
  return { pass: r.status === 2 && readFileSync(join(dir, 'clips/start/start-defend.json'), 'utf8') === before && readFileSync(join(dir, 'actors/start.json'), 'utf8') === actorBefore && existsSync(join(dir, 'clips/start/start-fight.json')), exit: r.status, stderr: r.stderr.trim() };
});
check('#1786 rename of a combat-stance clip updates the actor (real demo)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opus-1786-')); cpSync(join(P, 'demo/model'), dir, { recursive: true });
  const r = cli([dir, '--rename', 'clip:start/start-fight=start/fight']); const actor = JSON.parse(readFileSync(join(dir, 'actors/start.json'), 'utf8'));
  return { pass: r.status === 0 && actor.character.combat.stances.fight === 'start/fight' && JSON.parse(cli([dir, '--json']).stdout).filter((x) => x.severity === 'error').length === 0, stance: actor.character.combat.stances.fight };
});
check('#1789 checker detects duplicate identities a clean merge can produce', () => {
  const clip = { kind: 'clip', id: 'water', frames: [{ id: 'f1' }, { id: 'new-frame' }, { id: 'f2' }, { id: 'new-frame' }] };
  const diags = checkProject({ docs: [{ file: 'clips/water.json', id: 'clips/water', codecId: 'json-layout', text: JSON.stringify(clip, null, 2), value: clip }], other: new Set() }, validator);
  const exp = JSON.parse(readFileSync(join(RES, 'experiments.json'), 'utf8')).merge;
  const outcomes = {}; for (const c of Object.keys(exp)) for (const s of ['same-id-disjoint-placements', 'same-id-disjoint-frames']) for (const p of ['reemit', 'preserve', 'raw']) { const o = String(exp[c][s][p]); outcomes[o] = (outcomes[o] ?? 0) + 1; }
  return { pass: diags.some((x) => x.code === 'duplicate-id') && !Object.keys(outcomes).some((o) => o.startsWith('FAIL')), duplicateDiagnostic: diags.find((x) => x.code === 'duplicate-id')?.message, mergeOutcomes: outcomes };
});
check('#1780 full-document merge oracle rejects corruption that keeps added IDs/count', () => {
  const exp = JSON.parse(readFileSync(join(RES, 'experiments.json'), 'utf8'));
  const src = readFileSync(join(here, 'experiments.mjs'), 'utf8');
  const classify = new Function('isDeepStrictEqual', 'applyOps', `${src.slice(src.indexOf('function classify('), src.indexOf('\nconst results ='))}\nreturn classify;`)(isDeepStrictEqual, applyOps);
  const scene = JSON.parse(readFileSync(join(P, 'CrystalImmortality/model/scenes/castle3left/scene.json'), 'utf8'));
  const np = (id, x) => ({ id, actor: 'train-soldier1', at: [x, 607, 1], whilePresent: { program: 'scripts/train sold1.prg' }, activation: { onKey: false } });
  const sc = { expect: 'either-order', b: [{ op: 'insert', path: ['placements'], index: 6, value: np('added-by-b', 500) }] };
  const A = applyOps(scene, [{ op: 'insert', path: ['placements'], index: 6, value: np('added-by-a', 100) }]);
  const corrupted = structuredClone(A); corrupted.placements = [...A.placements.slice(0, 6).toReversed(), A.placements[6], np('added-by-b', 500)]; corrupted.placements[0].actor = 'LOST-ACTOR'; corrupted.start = [999, 999, 1];
  const good = applyOps(A, sc.b);
  const verdictBad = classify(sc, scene, A, null, { conflict: false, text: JSON.stringify(corrupted) }, CODECS.json);
  const verdictGood = classify(sc, scene, A, null, { conflict: false, text: JSON.stringify(good) }, CODECS.json);
  let fails = 0; for (const c of Object.values(exp.merge)) for (const s of Object.values(c)) for (const p of ['reemit', 'preserve', 'raw']) if (String(s[p]).startsWith('FAIL')) fails++;
  return { pass: verdictBad.startsWith('FAIL') && verdictGood === 'pass-clean-both-kept', verdictBad, verdictGood, failsInRerun: fails };
});
check('#1784 host probe makes semantic assertions; accept-everything schema is caught', () => {
  const node = JSON.parse(readFileSync('/private/tmp/tkr-1778-opus-experiments/browser/node-result.json', 'utf8'));
  const parity = JSON.parse(readFileSync('/private/tmp/tkr-1778-opus-experiments/browser/parity.json', 'utf8'));
  return { pass: node.negativeControlAcceptEverythingSchema.ok === false && Object.values(parity.comparison).every((x) => x.sameChecks && x.sameHash && x.nodeOk === x.browserOk), negativeControlFailed: node.negativeControlAcceptEverythingSchema.failed, failingStepsInBothHosts: Object.entries(parity.comparison).filter(([, x]) => !x.nodeOk).map(([k, x]) => `${k}: ${x.failed}`) };
});
check('#1796 physical board version separated from decoder model version', () => {
  const m = JSON.parse(readFileSync(join(D, 'manifest.json'), 'utf8'));
  const row = m.games.Caoquest.files.find((f) => f.path === 'Boards/house3.brd');
  const scene = JSON.parse(readFileSync(join(P, 'Caoquest/model/scenes/house3/scene.json'), 'utf8'));
  return { pass: row.storedForm === 'tk2-text' && `${row.storedMajor}.${row.storedMinor}` === '2.1' && scene.compat.tk3.storedVersion === '2.1' && scene.compat.tk3.decodedModelVersion === '2.4', row: { storedForm: row.storedForm, stored: `${row.storedMajor}.${row.storedMinor}`, decoded: row.decodedModelVersion }, compat: scene.compat.tk3 };
});
check('#1797 HOCON: constant absolute root, varied cwd', () => { const h = JSON.parse(readFileSync(join(RES, 'programmable.json'), 'utf8')).languages.hocon; return { pass: h.absoluteRootVariedCwd.allSucceeded && h.absoluteRootVariedCwd.identicalValues && h.absoluteRootVariedCwd.identicalOrigins && h.absoluteRootVariedCwd.placements === 6, result: h.absoluteRootVariedCwd, relativeRoot: h.relativeRootFromParentCwd }; });

writeFileSync(OUT, JSON.stringify(checks, null, 1));
for (const [k, v] of Object.entries(checks)) console.log(v.pass ? 'PASS' : 'FAIL', k, v.pass ? '' : JSON.stringify(v).slice(0, 400));
