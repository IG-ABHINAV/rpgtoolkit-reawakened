// #1778 research (Opus): editing / no-op / merge / tile / RPGCode / plugin /
// location experiments on REAL projected cohort documents, run identically
// through every notation adapter. Git merges are real `git merge` runs (stock
// ort strategy, no custom merge driver) in throwaway repositories.
//
//   node experiments.mjs --projection <scratch>/projection --work <scratch>/work --out <scratch>/results/experiments.json
//
// Three edit paths per notation:
//   reemit   parse -> modify value -> library/canonical stringify (naive editor save)
//   preserve format-preserving library edit on an authored file with comments
//   raw      the minimal text hunk of the canonical change replayed with
//            `patch` onto the authored, commented file (stands in for a
//            careful hand edit; agent-generated, NOT human testing)
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CODECS, applyOps, libraryVersions } from './notations.mjs';
import { createValidator, validateValue } from './check.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const P = opt('--projection'), WORK = opt('--work'), OUT = opt('--out');
const ONLY = opt('--codecs')?.split(',') ?? Object.keys(CODECS);
const PART = opt('--part')?.split(',');
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
const load = (p) => JSON.parse(readFileSync(join(P, p), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const run = (cmd, a, o = {}) => { const r = spawnSync(cmd, a, { encoding: 'utf8', ...o }); return { status: r.status, stdout: r.stdout, stderr: r.stderr }; };
const validator = createValidator(join(dirname(new URL(import.meta.url).pathname), 'schemas/plugins'));

// ---- representative real constructions (+ clearly labelled proposals) --------
const R = {
  actor: load('demo/model/actors/oldman.json'),
  demoScene: load('demo/model/scenes/start/scene.json'),
  placementsScene: load('CrystalImmortality/model/scenes/castle3left/scene.json'),
  clip: load('CrystalImmortality/model/clips/water1.json'),
  tiles: load('CrystalImmortality/model/scenes/city1/tiles.json'),
  item: load('ChimeranEmpire/model/items/crystal-staff.json'),
  skill: load('ChimeranEmpire/model/skills/mage-sword-1.json'),
  character: load('ChimeranEmpire/model/actors/icharus.json'),
};
const proposals = [];
// Owner-requested design example: the legacy idiom is an onEquip program that
// sets MageSword!=2, which gates Icharus's learnable slot. Proposed explicit grant:
R.item.grants = [{ skill: 'mage-sword-1', while: 'equipped' }];
proposals.push({ document: 'items/crystal-staff', path: '/grants', label: 'PROPOSED item grants skill (legacy uses onEquip program + variable gate)' });
const bolt = R.character.character.skills.learnable.find((s) => s.skill === 'bolt-1');
bolt.perform = { clip: 'bolt-1', stance: 'special' };
proposals.push({ document: 'actors/icharus', path: '/character/skills/learnable/2/perform', label: 'PROPOSED actor-specific performance binding' });
R.demoScene.extensions = {
  'com.example.weather': { version: 1, precipitation: 'rain', intensity: 0.25, windFrom: [-1, 0], onStorm: { inline: 'mwin("Thunder!");' } },
  'org.example.lanterns': { version: 3, glow: [255, 200, 120], flicker: true },
};
proposals.push({ document: 'scenes/start/scene', path: '/extensions', label: 'AUTHORED plugin data: weather has a v1 schema; lanterns has none' });

const COMMENT = { yaml: '#', json: null, 'json-layout': null, json5: '//', 'json5-layout': '//', hjson: '#', toml: '#', 'toml-rows': '#', kdl: '//', edn: ';', 'edn-oneline': ';', ron: '//', 'ron-compact': '//', xml: 'xml' };
const commentLine = (id, indent, text) => (COMMENT[id] === 'xml' ? `${indent}<!-- ${text} -->` : `${indent}${COMMENT[id]} ${text}`);
/** Insert human comments before the first line mentioning each anchor. */
function author(id, text, anchors) {
  if (!COMMENT[id]) return text;
  const lines = text.split('\n');
  for (const [anchor, note] of anchors.slice().reverse()) {
    const i = lines.findIndex((l) => l.includes(anchor));
    if (i < 0) continue;
    lines.splice(i, 0, commentLine(id, /^\s*/.exec(lines[i])[0], note));
  }
  if (id === 'xml') lines.splice(1, 0, '<!-- Authored note: the scene file -->'); else lines.unshift(commentLine(id, '', 'Authored note: the scene file'));
  return lines.join('\n');
}
const countComments = (id, text) => (COMMENT[id] ? (text.match(id === 'xml' ? /<!--/g : new RegExp(`${COMMENT[id].replace(/[/]/g, '\\/')} (Authored|Human)`, 'g')) ?? []).length : 0);

function diffStat(a, b, name) {
  const dir = mkdtempSync(join(WORK, 'diff-')); const fa = join(dir, 'a'), fb = join(dir, 'b');
  writeFileSync(fa, a); writeFileSync(fb, b);
  const ns = run('git', ['diff', '--no-index', '--numstat', '--', fa, fb]).stdout.trim().split(/\s+/);
  const unified = run('git', ['diff', '--no-index', '--unified=1', '--', fa, fb]).stdout;
  if (name) { const t = join(OUT_DIFFS, `${name}.diff`); mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, unified); }
  rmSync(dir, { recursive: true, force: true });
  return { added: Number(ns[0] ?? 0), removed: Number(ns[1] ?? 0), diffBytes: Buffer.byteLength(unified) };
}
const OUT_DIFFS = join(dirname(OUT), 'diffs');

function gitMerge(file, base, a, b) {
  const dir = mkdtempSync(join(WORK, 'git-'));
  const g = (...x) => run('git', ['-C', dir, ...x]);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'opus@research.invalid'); g('config', 'user.name', 'research'); g('config', 'core.autocrlf', 'false'); g('config', 'merge.conflictstyle', 'merge');
  writeFileSync(join(dir, file), base); g('add', '.'); g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 'a'); writeFileSync(join(dir, file), a); g('commit', '-q', '-am', 'a');
  g('checkout', '-q', 'main'); g('checkout', '-q', '-b', 'b'); writeFileSync(join(dir, file), b); g('commit', '-q', '-am', 'b');
  g('checkout', '-q', 'a');
  const m = g('merge', '--no-edit', '-q', 'b');
  const text = readFileSync(join(dir, file), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { conflict: m.status !== 0, text, conflictMarkers: (text.match(/^<<<<<<< /gm) ?? []).length };
}

function rawReplay(id, authoredBase, canonBase, canonEdited) {
  const dir = mkdtempSync(join(WORK, 'raw-'));
  writeFileSync(join(dir, 'base'), canonBase); writeFileSync(join(dir, 'edited'), canonEdited); writeFileSync(join(dir, 'target'), authoredBase);
  const d = run('diff', ['-u', join(dir, 'base'), join(dir, 'edited')]).stdout;
  writeFileSync(join(dir, 'p.diff'), d);
  const r = run('patch', ['-s', '-o', join(dir, 'out'), join(dir, 'target'), join(dir, 'p.diff')]);
  const out = !d ? authoredBase : r.status === 0 && existsSync(join(dir, 'out')) ? readFileSync(join(dir, 'out'), 'utf8') : null;
  rmSync(dir, { recursive: true, force: true });
  return out;
}

// ---- scenarios -----------------------------------------------------------------
const pl = (i) => ['placements', i];
const newPlacement = (id, x) => ({ id, actor: 'train-soldier1', at: [x, 607, 1], whilePresent: { program: 'scripts/train sold1.prg' }, activation: { onKey: false } });
const newFrame = (id, img) => ({ id, image: `media/images/${img}`, transparent: [255, 255, 255] });
const S = [
  { id: 'independent-far', doc: 'placementsScene', a: [{ op: 'set', path: [...pl(0), 'at', 0], value: 209 }], b: [{ op: 'set', path: [...pl(5), 'at', 1], value: 512 }], expect: 'both' },
  { id: 'adjacent-elements', doc: 'placementsScene', a: [{ op: 'set', path: [...pl(1), 'at', 0], value: 401 }], b: [{ op: 'set', path: [...pl(2), 'at', 0], value: 209 }], expect: 'both' },
  { id: 'same-element-other-field', doc: 'placementsScene', a: [{ op: 'set', path: [...pl(1), 'at', 0], value: 401 }], b: [{ op: 'set', path: [...pl(1), 'whilePresent'], value: { inline: 'wander();' } }], expect: 'both' },
  { id: 'same-field-incompatible', doc: 'placementsScene', a: [{ op: 'set', path: [...pl(1), 'at', 0], value: 401 }], b: [{ op: 'set', path: [...pl(1), 'at', 0], value: 402 }], expect: 'conflict' },
  { id: 'same-field-identical', doc: 'placementsScene', a: [{ op: 'set', path: [...pl(1), 'at', 0], value: 401 }], b: [{ op: 'set', path: [...pl(1), 'at', 0], value: 401 }], expect: 'value', value: (s) => applyOps(s, [{ op: 'set', path: [...pl(1), 'at', 0], value: 401 }]) },
  { id: 'edit-vs-delete', doc: 'placementsScene', a: [{ op: 'set', path: [...pl(2), 'at', 1], value: 420 }], b: [{ op: 'delete', path: pl(2) }], expect: 'conflict' },
  { id: 'both-append', doc: 'placementsScene', a: [{ op: 'insert', path: ['placements'], index: 6, value: newPlacement('added-by-a', 100) }], b: [{ op: 'insert', path: ['placements'], index: 6, value: newPlacement('added-by-b', 500) }], expect: 'either-order', ids: ['added-by-a', 'added-by-b'] },
  { id: 'insert-vs-edit-other', doc: 'placementsScene', a: [{ op: 'insert', path: ['placements'], index: 2, value: newPlacement('inserted', 300) }], b: [{ op: 'set', path: [...pl(4), 'at', 0], value: 209 }], expect: 'value', value: (s) => applyOps(s, [{ op: 'set', path: [...pl(4), 'at', 0], value: 209 }, { op: 'insert', path: ['placements'], index: 2, value: newPlacement('inserted', 300) }]) },
  { id: 'delete-vs-edit-other', doc: 'placementsScene', a: [{ op: 'delete', path: pl(0) }], b: [{ op: 'set', path: [...pl(3), 'at', 0], value: 210 }], expect: 'value', value: (s) => applyOps(s, [{ op: 'set', path: [...pl(3), 'at', 0], value: 210 }, { op: 'delete', path: pl(0) }]) },
  { id: 'reorder-vs-edit', doc: 'placementsScene', a: [{ op: 'move', path: ['placements'], from: 0, to: 5 }], b: [{ op: 'set', path: [...pl(3), 'at', 1], value: 416 }], expect: 'value', value: (s) => applyOps(s, [{ op: 'set', path: [...pl(3), 'at', 1], value: 416 }, { op: 'move', path: ['placements'], from: 0, to: 5 }]) },
  { id: 'reorder-incompatible', doc: 'placementsScene', a: [{ op: 'move', path: ['placements'], from: 0, to: 5 }], b: [{ op: 'move', path: ['placements'], from: 5, to: 0 }], expect: 'conflict' },
  { id: 'clip-reorder-vs-frame-edit', doc: 'clip', a: [{ op: 'move', path: ['frames'], from: 0, to: 1 }], b: [{ op: 'set', path: ['frames', 4, 'sound'], value: 'media/audio/Water2.wav' }], expect: 'value', value: (s) => applyOps(s, [{ op: 'set', path: ['frames', 4, 'sound'], value: 'media/audio/Water2.wav' }, { op: 'move', path: ['frames'], from: 0, to: 1 }]) },
  { id: 'clip-insert-same-position', doc: 'clip', a: [{ op: 'insert', path: ['frames'], index: 3, value: newFrame('fa', 'bubble2.gif') }], b: [{ op: 'insert', path: ['frames'], index: 3, value: newFrame('fb', 'bubble5.gif') }], expect: 'either-order', ids: ['fa', 'fb'], list: 'frames' },
  { id: 'clip-delete-adjacent', doc: 'clip', a: [{ op: 'delete', path: ['frames', 2] }], b: [{ op: 'delete', path: ['frames', 3] }], expect: 'value', value: (s) => applyOps(s, [{ op: 'delete', path: ['frames', 3] }, { op: 'delete', path: ['frames', 2] }]) },
  { id: 'tiles-different-rows', doc: 'tiles', a: [{ op: 'set', path: ['layers', 0, 'rows', 9, 10], value: 900 }], b: [{ op: 'set', path: ['layers', 0, 'rows', 20, 3], value: 901 }], expect: 'both' },
  { id: 'tiles-same-row-different-cells', doc: 'tiles', a: [{ op: 'set', path: ['layers', 0, 'rows', 9, 2], value: 900 }], b: [{ op: 'set', path: ['layers', 0, 'rows', 9, 40], value: 901 }], expect: 'both' },
  { id: 'tiles-same-cell', doc: 'tiles', a: [{ op: 'set', path: ['layers', 0, 'rows', 9, 2], value: 900 }], b: [{ op: 'set', path: ['layers', 0, 'rows', 9, 2], value: 901 }], expect: 'conflict' },
  // #1789: the same new identity added on both branches at DISJOINT positions.
  // Semantically a conflict (one identity, two definitions); a clean textual
  // merge is a false clean unless an identity check detects the duplicate.
  { id: 'same-id-disjoint-placements', doc: 'placementsScene', a: [{ op: 'insert', path: ['placements'], index: 1, value: newPlacement('reinforcement', 100) }], b: [{ op: 'insert', path: ['placements'], index: 5, value: newPlacement('reinforcement', 500) }], expect: 'conflict-or-detected', list: 'placements' },
  { id: 'same-id-disjoint-frames', doc: 'clip', a: [{ op: 'insert', path: ['frames'], index: 1, value: newFrame('new-frame', 'bubble2.gif') }], b: [{ op: 'insert', path: ['frames'], index: 5, value: newFrame('new-frame', 'bubble5.gif') }], expect: 'conflict-or-detected', list: 'frames' },
];
const anchorsFor = { placementsScene: [['train-soldier2-1', 'Human note: second soldier guards the gate'], ['placements', 'Human note: placements below']], clip: [['f3', 'Human note: splash frame'], ['frames', 'Human note: frames below']], tiles: [['layers', 'Human note: layers below']] };

// Oracles compare the WHOLE merged document (#1780): a clean merge passes only
// if it equals a permitted result exactly, never by spot-checking a list.
function classify(sc, base, A, Bv, m, codec) {
  if (m.conflict) return sc.expect === 'conflict' || sc.expect === 'conflict-or-detected' ? 'pass-conflict-surfaced' : sc.expect === 'either-order' ? 'pass-conflict-order-ambiguous' : 'spurious-conflict';
  let merged;
  try { merged = codec.parse(m.text); } catch (e) { return 'FAIL-false-clean-unparseable'; }
  if (sc.expect === 'conflict') return isDeepStrictEqual(merged, A) || isDeepStrictEqual(merged, Bv) ? 'FAIL-silent-overwrite' : 'FAIL-false-clean-wrong';
  if (sc.expect === 'conflict-or-detected') {
    const ids = (merged[sc.list] ?? []).map((x) => x.id);
    return new Set(ids).size !== ids.length ? 'false-clean-text-duplicate-id-detected-by-checker' : 'FAIL-false-clean-undetected';
  }
  if (sc.expect === 'either-order') {
    const b = sc.b[0];
    const permitted = [applyOps(A, sc.b), applyOps(A, [{ ...b, index: b.index + 1 }])];
    return permitted.some((p) => isDeepStrictEqual(merged, p)) ? 'pass-clean-both-kept' : 'FAIL-false-clean-wrong';
  }
  const E = sc.expect === 'both' ? applyOps(A, sc.b) : sc.value(base);
  return isDeepStrictEqual(merged, E) ? 'pass-clean-correct' : 'FAIL-false-clean-wrong';
}

const results = { meta: { node: process.version, platform: `${process.platform}-${process.arch}`, git: run('git', ['--version']).stdout.trim(), patch: run('patch', ['--version']).stdout.split('\n')[0], libraryVersions, proposals, inputs: { demoScene: 'demo/model/scenes/start/scene', placementsScene: 'CrystalImmortality/model/scenes/castle3left/scene', clip: 'CrystalImmortality/model/clips/water1', tiles: 'CrystalImmortality/model/scenes/city1/tiles', actor: 'demo/model/actors/oldman', item: 'ChimeranEmpire/model/items/crystal-staff', skill: 'ChimeranEmpire/model/skills/mage-sword-1', character: 'ChimeranEmpire/model/actors/icharus' } } };
const part = (name) => !PART || PART.includes(name);

// ---- E1 parse / validate / malformed / locations / duplicates -----------------------
if (part('validate')) {
  results.validate = {};
  for (const id of ONLY) {
    const c = CODECS[id]; const r = { documents: {}, malformedSyntax: null, schemaViolation: null, typo: null, duplicateKey: null };
    for (const [name, v] of Object.entries(R)) {
      const text = c.stringify(v); const back = c.parse(text); const val = validateValue(validator, back);
      r.documents[name] = { roundTrip: isDeepStrictEqual(back, v), coreErrors: val.core.length, extensions: val.extensions.map((e) => `${e.namespace}:${e.status}`) };
    }
    // Malformed syntax: an unterminated string inserted mid-document.
    const text = c.stringify(R.demoScene); const lines = text.split('\n'); const at = Math.floor(lines.length / 2);
    const bad = [...lines.slice(0, at), id === 'xml' ? '<string key="oops">unterminated' : `${/^\s*/.exec(lines[at])[0]}"unterminated`, ...lines.slice(at)].join('\n');
    try { c.parse(bad); r.malformedSyntax = { rejected: false }; } catch (e) { r.malformedSyntax = { rejected: true, insertedLine: at + 1, reportedLine: e.line ?? null, message: e.message.slice(0, 160) }; }
    // Schema violation on parsed data, with codec source location.
    const wrong = applyOps(R.demoScene, [{ op: 'set', path: ['placements', 0, 'at', 0], value: '214' }]);
    const wt = c.stringify(wrong); const wv = validateValue(validator, c.parse(wt));
    const err = wv.core.find((e) => e.path === '/placements/0/at/0') ?? wv.core[0];
    const loc = c.locate?.(wt, ['placements', 0, 'at', 0]) ?? null;
    r.schemaViolation = { detected: !!err, path: err?.path, message: err?.message, location: loc, locatedLineText: loc ? wt.split('\n')[loc.line - 1]?.trim().slice(0, 80) : null };
    const typo = structuredClone(R.demoScene); typo.placements[0].actr = typo.placements[0].actor; delete typo.placements[0].actor;
    const tv = validateValue(validator, c.parse(c.stringify(typo)));
    r.typo = { detected: tv.core.some((e) => /additional/.test(e.message)), messages: tv.core.slice(0, 2).map((e) => `${e.path} ${e.message}`) };
    results.validate[id] = r;
  }
  // Duplicate keys, written by hand per notation (library behaviour, not notation rules alone).
  const dup = { yaml: 'id: a\nid: b\n', json: '{"id":"a","id":"b"}', 'json-layout': '{"id":"a","id":"b"}', json5: '{id:"a",id:"b"}', 'json5-layout': '{id:"a",id:"b"}', hjson: '{\n  id: a\n  id: b\n}', toml: 'id = "a"\nid = "b"\n', 'toml-rows': 'id = "a"\nid = "b"\n', kdl: '- id=a id=b\n', edn: '{:id "a" :id "b"}', 'edn-oneline': '{:id "a" :id "b"}', ron: '{"id": "a", "id": "b"}', 'ron-compact': '(id: "a", id: "b")', xml: '<map xmlns="http://www.w3.org/2005/xpath-functions"><string key="id">a</string><string key="id">b</string></map>' };
  for (const id of ONLY) { try { const v = CODECS[id].parse(dup[id]); results.validate[id].duplicateKey = { rejected: false, result: JSON.stringify(v) }; } catch (e) { results.validate[id].duplicateKey = { rejected: true, message: e.message.slice(0, 120) }; } }
  console.log('validate done');
}

// ---- E2 no-op round trips; E3 change one property ------------------------------
if (part('noop')) {
  results.noop = {}; results.changeOne = {};
  for (const id of ONLY) {
    const c = CODECS[id];
    const canon = c.stringify(R.demoScene);
    const idempotent = c.stringify(c.parse(canon)) === canon;
    // Authored variant: comments, CRLF line endings, swapped top-level key order.
    const swapped = { id: R.demoScene.id, kind: R.demoScene.kind, ...R.demoScene };
    const authoredLf = author(id, c.stringify(swapped), [['wp_oldman', 'Human note: the old man walks this path'], ['placements', 'Human note: placements below']]);
    const authored = authoredLf.replace(/\n/g, '\r\n');
    const r = { canonicalIdempotent: idempotent, commentsAuthored: countComments(id, authored) };
    try {
      const v = c.parse(authored); r.authoredParses = true; r.authoredSemanticEqual = isDeepStrictEqual(v, swapped);
      const re = c.stringify(v);
      r.reemit = { bytesEqual: re === authored, crlfKept: re.includes('\r\n'), commentsKept: countComments(id, re), keyOrderKept: Object.keys(c.parse(re))[0] === 'id', unknownExtensionKept: isDeepStrictEqual(c.parse(re).extensions, R.demoScene.extensions) };
      if (c.edit) {
        const pe = c.edit(authored, []);
        r.preserveNoop = { bytesEqual: pe === authored, crlfKept: pe.includes('\r\n'), commentsKept: countComments(id, pe), unknownExtensionKept: isDeepStrictEqual(c.parse(pe).extensions, R.demoScene.extensions) };
        const pl1 = c.edit(authored, [{ op: 'set', path: ['placements', 0, 'at', 0], value: 215 }]);
        r.preserveUnrelatedEdit = { commentsKept: countComments(id, pl1), crlfLinesKept: (pl1.match(/\r\n/g) ?? []).length, lfOnlyLines: (pl1.match(/(?<!\r)\n/g) ?? []).length, unknownExtensionKept: isDeepStrictEqual(c.parse(pl1).extensions, R.demoScene.extensions) };
      } else r.preserveNoop = { unavailable: 'no format-preserving edit API in the exercised library' };
    } catch (e) { r.authoredParses = false; r.error = e.message.slice(0, 160); }
    results.noop[id] = r;
    // E3: one property change on the canonical file and on the authored (LF) file.
    const ops = [{ op: 'set', path: ['placements', 0, 'at', 0], value: 215 }];
    const re = c.stringify(applyOps(R.demoScene, ops));
    const ch = { reemit: diffStat(canon, re, `change-one/${id}/reemit`) };
    const authoredOne = author(id, canon, [['placements', 'Human note: placements below']]);
    if (c.edit) ch.preserve = diffStat(authoredOne, c.edit(authoredOne, ops), `change-one/${id}/preserve`);
    ch.reemitOnAuthored = diffStat(authoredOne, c.stringify(applyOps(c.parse(authoredOne), ops)), `change-one/${id}/reemit-on-authored`);
    results.changeOne[id] = ch;
  }
  console.log('noop done');
}

// ---- E4-E6 merges ----------------------------------------------------------------
if (part('merge')) {
  results.merge = {};
  for (const id of ONLY) {
    const c = CODECS[id]; const out = {};
    for (const sc of S) {
      const base = R[sc.doc]; const A = applyOps(base, sc.a); const Bv = applyOps(base, sc.b);
      if (isDeepStrictEqual(A, base) || isDeepStrictEqual(Bv, base)) throw new Error(`scenario ${sc.id}: a branch makes no change`);
      const file = `doc.${c.ext}`;
      const row = {};
      const cb = c.stringify(base), ca = c.stringify(A), cbb = c.stringify(Bv);
      const m1 = gitMerge(file, cb, ca, cbb); row.reemit = classify(sc, base, A, Bv, m1, c);
      const authored = author(id, cb, anchorsFor[sc.doc]);
      if (c.edit) {
        try {
          const ea = c.edit(authored, sc.a), eb = c.edit(authored, sc.b);
          const m2 = gitMerge(file, authored, ea, eb); row.preserve = classify(sc, base, A, Bv, m2, c);
          row.preserveComments = { base: countComments(id, authored), a: countComments(id, ea), b: countComments(id, eb), merged: m2.conflict ? null : countComments(id, m2.text) };
          if (!isDeepStrictEqual(c.parse(ea), A) || !isDeepStrictEqual(c.parse(eb), Bv)) row.preserveEditWrong = true;
        } catch (e) { row.preserve = `error: ${e.message.slice(0, 120)}`; }
      } else row.preserve = 'n/a (no format-preserving editor library)';
      if (COMMENT[id]) {
        const ra = rawReplay(id, authored, cb, ca), rb = rawReplay(id, authored, cb, cbb);
        if (ra === null || rb === null) row.raw = 'raw-hunk-did-not-apply';
        else { const m3 = gitMerge(file, authored, ra, rb); row.raw = classify(sc, base, A, Bv, m3, c); }
      } else row.raw = 'n/a (notation has no comments; raw path identical to reemit)';
      out[sc.id] = row;
    }
    results.merge[id] = out;
    console.log('merge', id, Object.values(out).map((r) => r.reemit[0]).join(''));
  }
}

// ---- E7 tile row edit: size / diff / time ----------------------------------------
if (part('tiles')) {
  results.tiles = { layerDimensions: { width: R.tiles.size.width, height: R.tiles.size.height, layers: R.tiles.layers.length, cells: R.tiles.size.width * R.tiles.size.height * R.tiles.layers.length, paletteEntries: R.tiles.palette.length } };
  const row = R.tiles.layers[0].rows[9].slice(); for (let x = 10; x < 15; x++) row[x] = 7;
  const ops = [{ op: 'set', path: ['layers', 0, 'rows', 9], value: row }];
  for (const id of ONLY) {
    const c = CODECS[id];
    const t0 = performance.now(); const text = c.stringify(R.tiles); const tStr = performance.now() - t0;
    const t1 = performance.now(); const v = c.parse(text); const tParse = performance.now() - t1;
    const t2 = performance.now(); const re = c.stringify(applyOps(v, ops)); const tRe = performance.now() - t2;
    const r = { bytes: Buffer.byteLength(text), lines: text.split('\n').length, maxLine: Math.max(...text.split('\n').map((l) => l.length)), stringifyMs: +tStr.toFixed(1), parseMs: +tParse.toFixed(1), reemitEditMs: +tRe.toFixed(1), reemitDiff: diffStat(text, re, `tiles/${id}/reemit`) };
    if (c.edit) { const t3 = performance.now(); try { const pe = c.edit(text, ops); r.preserveEditMs = +(performance.now() - t3).toFixed(1); r.preserveDiff = diffStat(text, pe, `tiles/${id}/preserve`); r.preserveCorrect = isDeepStrictEqual(c.parse(pe), applyOps(R.tiles, ops)); } catch (e) { r.preserveError = e.message.slice(0, 120); } }
    results.tiles[id] = r;
  }
  console.log('tiles done');
}

// ---- E8 embedded RPGCode ---------------------------------------------------------
if (part('rpgcode')) {
  const edge = [
    '// authored edge case: quotes " and \' and backslash \\ and \\n literal',
    'mwin("He said \\"hi\\" \\\\ then left");',
    'text(1, 1, "C:\\\\Games\\\\TK3\\\\save.dat")',
    '"""  \'\'\'  ]]>  -->  */  #  ---  ...  `  #"  "#  }}  ;; ${x}  \\u0041',
    '\tif (a$ == "é") { wait(); }   ',
    '',
    'end',
  ].join('\n');
  const realCrlf = readFileSync(join(P, 'ChimeranEmpire/model/scripts/Add Mage Sword.prg'), 'latin1');
  const realDemo = readFileSync(join(P, 'demo/model/scripts/oldman.prg'), 'latin1');
  // Owner rule (2026-11-08): RPGCode MAY be normalised to LF. docs/spec/formats/rpgcode-program.md
  // ("Line endings": the engine accepts CRLF, CR or LF; statements end at a newline or ';')
  // supports a declared import normalisation CRLF/CR -> LF. The original bytes stay identified by
  // their sha256 in provenance. Comparison is made AFTER that declared normalisation; anything that
  // still differs is content/escaping corruption. Normalised-text equality is not VM equivalence.
  const normalise = (s) => s.replace(/\r\n?/g, '\n');
  const cases = { authoredEdgeLf: edge, authoredEdgeCrlf: edge.replace(/\n/g, '\r\n'), realChimeranCrlf: realCrlf, realDemoLf: realDemo, realDemoInlineHook: R.demoScene.placements[0].whilePresent.inline };
  results.rpgcode = { normalisation: 'CRLF and lone CR -> LF on import (declared); original sha256 retained for provenance', cases: Object.fromEntries(Object.entries(cases).map(([k, s]) => [k, { chars: s.length, originalSha256: sha(s), normalisedSha256: sha(normalise(s)), crlf: s.includes('\r\n'), lines: normalise(s).split('\n').length }])), perCodec: {} };
  const verdict = (orig, back) => (back === normalise(orig) ? 'equal-after-declared-normalisation' : normalise(back) === normalise(orig) ? 'equal-after-normalising-output' : 'CORRUPTED');
  for (const id of ONLY) {
    const c = CODECS[id]; const r = {};
    for (const [k, s] of Object.entries(cases)) {
      const res = {};
      // (a) normalised text stored inline: the declared pipeline.
      const doc = applyOps(R.demoScene, [{ op: 'set', path: ['placements', 0, 'whilePresent'], value: { inline: normalise(s) } }]);
      try { const text = c.stringify(doc); const back = c.parse(text).placements[0].whilePresent.inline; res.reemit = verdict(s, back); res.addedDocumentLines = text.split('\n').length - c.stringify(applyOps(R.demoScene, [{ op: 'set', path: ['placements', 0, 'whilePresent'], value: { inline: 'x' } }])).split('\n').length; }
      catch (e) { res.reemit = `error: ${e.message.slice(0, 120)}`; }
      if (c.edit) { try { const ed = c.edit(c.stringify(R.demoScene), [{ op: 'set', path: ['placements', 0, 'whilePresent'], value: { inline: normalise(s) } }]); res.preserve = verdict(s, c.parse(ed).placements[0].whilePresent.inline); } catch (e) { res.preserve = `error: ${e.message.slice(0, 120)}`; } }
      // (b) informational only: un-normalised CR bytes stored as-is.
      if (s.includes('\r')) { try { const raw = applyOps(R.demoScene, [{ op: 'set', path: ['placements', 0, 'whilePresent'], value: { inline: s } }]); res.unnormalisedCrKeptByteExact = c.parse(c.stringify(raw)).placements[0].whilePresent.inline === s; } catch (e) { res.unnormalisedCrKeptByteExact = `error: ${e.message.slice(0, 80)}`; } }
      r[k] = res;
    }
    // Hand-authored multi-line blocks (what a person would type), including
    // plausible mistakes, to expose escaping/chomping pitfalls per notation.
    const blocks = {
      yaml: { 'literal-strip |-': `x: |-\n  line1 "q" \\ back\n  line2\n`, 'literal-clip | (keeps final newline)': `x: |\n  line1 "q" \\ back\n  line2\n` },
      toml: { 'multiline-basic """ (escapes processed)': `x = """\nline1 "q" \\\\ back\nline2"""\n`, "multiline-literal '''": `x = '''\nline1 "q" \\ back\nline2'''\n`, 'multiline-basic with unescaped backslash': `x = """\nline1 "q" \\ back\nline2"""\n` },
      kdl: { 'raw multiline #"""..."""#': `- x=#"""\n  line1 "q" \\ back\n  line2\n  """#\n`, 'escaped multiline """ with unescaped backslash': `- x="""\n  line1 "q" \\ back\n  line2\n  """\n` },
      hjson: { "multiline '''": `{\n  x:\n    '''\n    line1 "q" \\ back\n    line2\n    '''\n}\n` },
      edn: { 'string with literal newline': '{:x "line1 \\"q\\" \\\\ back\nline2"}\n' },
      ron: { 'raw string r#"..."#': '{"x": r#"line1 "q" \\ back\nline2"#}\n' },
      xml: { 'element text': '<map xmlns="http://www.w3.org/2005/xpath-functions"><string key="x">line1 "q" \\ back\nline2</string></map>\n' },
      json5: { 'escaped \\n plus line continuation': '{x: "line1 \\"q\\" \\\\ back\\n\\\nline2"}\n' },
      json: { 'escaped \\n (no multi-line strings)': '{"x": "line1 \\"q\\" \\\\ back\\nline2"}\n' },
    };
    const want = 'line1 "q" \\ back\nline2';
    const variants = blocks[id] ?? blocks[id.replace(/-.*$/, '')] ?? {};
    r.handAuthoredBlocks = Object.fromEntries(Object.entries(variants).map(([name, src]) => { try { const got = c.parse(src).x; return [name, { source: src, exact: got === want, got: got === want ? undefined : JSON.stringify(got) }]; } catch (e) { return [name, { source: src, error: e.message.slice(0, 120) }]; } }));
    // Extract inline -> external program file (LF, declared), compare text; binding becomes explicit.
    const text = c.stringify(applyOps(R.demoScene, [{ op: 'set', path: ['placements', 0, 'whilePresent'], value: { inline: normalise(cases.realChimeranCrlf) } }]));
    const inline = c.parse(text).placements[0].whilePresent.inline;
    const ext = join(WORK, `extract-${id}.prg`); writeFileSync(ext, inline, 'latin1');
    const extracted = applyOps(c.parse(text), [{ op: 'set', path: ['placements', 0, 'whilePresent'], value: { program: 'scripts/Add Mage Sword (extracted).prg' } }]);
    r.extractToFile = { fileEqualsNormalisedOriginal: sha(readFileSync(ext, 'latin1')) === sha(normalise(realCrlf)), originalSha256: sha(realCrlf), bindingAfter: extracted.placements[0].whilePresent, inlineBackFromFile: c.parse(c.stringify(applyOps(extracted, [{ op: 'set', path: ['placements', 0, 'whilePresent'], value: { inline: readFileSync(ext, 'latin1') } }]))).placements[0].whilePresent.inline === normalise(realCrlf) };
    results.rpgcode.perCodec[id] = r;
  }
  console.log('rpgcode done');
}

// ---- E10/E11 plugin data and schema dialect ---------------------------------------
if (part('plugins')) {
  results.plugins = { perCodec: {} };
  const invalid = applyOps(R.demoScene, [{ op: 'set', path: ['extensions', 'com.example.weather', 'precipitation'], value: 'hail' }, { op: 'set', path: ['extensions', 'com.example.weather', 'colour'], value: 'grey' }]);
  const mismatch = applyOps(R.demoScene, [{ op: 'set', path: ['extensions', 'com.example.weather', 'version'], value: 2 }, { op: 'set', path: ['extensions', 'com.example.weather', 'fog'], value: true }]);
  const noSchemas = createValidator('/nonexistent');
  for (const id of ONLY) {
    const c = CODECS[id]; const r = {};
    const t = c.stringify(R.demoScene);
    r.withSchema = validateValue(validator, c.parse(t)).extensions.map((e) => `${e.namespace}:${e.status}`);
    r.withoutAnyPluginSchema = validateValue(noSchemas, c.parse(t)).extensions.map((e) => `${e.namespace}:${e.status}`);
    const reemitted = c.stringify(c.parse(t)); r.preservedThroughReemit = isDeepStrictEqual(c.parse(reemitted).extensions, R.demoScene.extensions);
    if (c.edit) r.preservedThroughUnrelatedPreserveEdit = isDeepStrictEqual(c.parse(c.edit(t, [{ op: 'set', path: ['start', 0], value: 200 }])).extensions, R.demoScene.extensions);
    const it = c.stringify(invalid); const iv = validateValue(validator, c.parse(it));
    const bad = iv.extensions.find((e) => e.namespace === 'com.example.weather');
    r.invalidPluginData = { status: bad.status, errors: bad.errors.map((e) => `${e.path} ${e.message}`), location: c.locate?.(it, ['extensions', 'com.example.weather', 'precipitation']) ?? null };
    const mt = c.stringify(mismatch); const mv = validateValue(validator, c.parse(mt)).extensions.find((e) => e.namespace === 'com.example.weather');
    r.versionMismatch = { status: mv.status, detail: mv.detail, unknownFieldPreserved: c.parse(mt).extensions['com.example.weather'].fog === true };
    results.plugins.perCodec[id] = r;
  }
  // Dialect checks: a probe schema using 2020-12 keywords (unevaluatedProperties,
  // prefixItems, $dynamicRef to a $dynamicAnchor declared under $defs) run through
  // Ajv's default (draft-07) class, Ajv2020, and Hyperjump's 2020-12 validator.
  const createRequire = (await import('node:module')).createRequire;
  const { LIBS } = await import('./notations.mjs');
  const req = createRequire(join(LIBS, 'package.json'));
  const Ajv = req('ajv').default; const Ajv2020 = req('ajv/dist/2020').default;
  const schema = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), 'schemas/dialect-probe.schema.json'), 'utf8'));
  const probes = { valid: { version: 1, precipitation: 'rain', windFrom: [1, 0], onStorm: { program: 'scripts/a.prg' } }, unevaluatedExtra: { version: 1, precipitation: 'rain', extra: 1 }, badDynamicRefTarget: { version: 1, precipitation: 'rain', onStorm: { inline: 1 } }, badPrefixItem: { version: 1, precipitation: 'rain', windFrom: ['x', 0] } };
  const dialect = { expected: { valid: true, unevaluatedExtra: false, badDynamicRefTarget: false, badPrefixItem: false } };
  try { new Ajv({ strict: false }).compile(schema); dialect.ajvDefaultClass = 'compiled'; } catch (e) { dialect.ajvDefaultClass = `rejected: ${e.message.slice(0, 100)}`; }
  const a20 = new Ajv2020({ strict: true }).compile(schema);
  dialect.ajv2020 = Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, a20(v)]));
  const lax = new Ajv({ strict: false, validateSchema: false }); const { $schema, ...noDialect } = schema; void $schema;
  const v7 = lax.compile(noDialect); dialect.ajvDefaultClassWithoutDialectUri = Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v7(v)]));
  const hj = await import(req.resolve('@hyperjump/json-schema/draft-2020-12'));
  hj.registerSchema(schema);
  dialect.hyperjump = {}; for (const [k, v] of Object.entries(probes)) dialect.hyperjump[k] = (await hj.validate(schema.$id, v)).valid;
  dialect.versions = { ajv: libraryVersions.ajv, hyperjump: JSON.parse(readFileSync(join(LIBS, 'node_modules/@hyperjump/json-schema/package.json'), 'utf8')).version };
  results.plugins.dialect = dialect;
  console.log('plugins done');
}

mkdirSync(dirname(OUT), { recursive: true });
let prior = {}; try { prior = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* first run */ }
writeFileSync(OUT, JSON.stringify({ ...prior, ...results }, null, 1));
console.log('wrote', OUT);
