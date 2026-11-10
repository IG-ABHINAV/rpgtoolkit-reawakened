// #1778 shared-model comparison.
//
// The independent investigations used different logical models, so their results
// were not comparable. This harness drives BOTH investigators' own adapter sets
// with the ONE agreed construction from ./construction.mjs and records what each
// notation does with identical data.
//
// It deliberately reports the investigators' adapters, not a third opinion: when
// the two disagree on the same value, the difference is an adapter/library/printer
// choice, not a property of the notation, and is labelled that way.
//
//   node compare.mjs --astra-tools <worktree>/tools/research/native-data-notations/astra \
//                    --astra-libs  <scratch>/node_modules \
//                    --opus-tools   <worktree>/tools/research/native-data-notations/opus \
//                    --opus-libs    <scratch> \
//                    --work <scratch>/shared-work --out <file>
//
// Nothing here executes a recovered game or program, and no repository build/lint/
// test suite is involved. Real `git merge-file` runs the three-way text merge.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { buildSharedConstruction, SHARED_CONSTRUCTION_META } from './construction.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const ASTRA_TOOLS = opt('--astra-tools');
const ASTRA_LIBS = opt('--astra-libs');
const OPUS_TOOLS = opt('--opus-tools');
const OPUS_LIBS = opt('--opus-libs');
const WORK = opt('--work');
const OUT = opt('--out');
if (!ASTRA_TOOLS || !ASTRA_LIBS || !OPUS_TOOLS || !OPUS_LIBS || !WORK || !OUT) {
  console.error('usage: compare.mjs --astra-tools <dir> --astra-libs <dir> --opus-tools <dir> --opus-libs <dir> --work <dir> --out <file>');
  process.exit(2);
}
process.env.NOTATION_LIBS = OPUS_LIBS;

const sha = (text) => createRequire(import.meta.url)('node:crypto').createHash('sha256').update(text).digest('hex');
const git = (argv, options = {}) => spawnSync('git', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });

// ---- load the two adapter sets ---------------------------------------------
const unwrap = (m) => m.default ?? m;

// Each author's adapter set is loaded independently: a worktree mid-edit, or a
// missing isolated library root, disables only that side and is recorded.
const loadErrors = {};
let astraAdapters = null;
try {
  const astraReq = createRequire(join(ASTRA_LIBS, 'package.json'));
  const loadAstra = async (name) => import(pathToFileURL(astraReq.resolve(name)).href);
  const { createAdapters } = await import(pathToFileURL(join(ASTRA_TOOLS, 'adapters.mjs')).href);
  astraAdapters = createAdapters({
    YAML: await loadAstra('yaml'), KDL: await loadAstra('@bgotink/kdl'), KJSON: await loadAstra('@bgotink/kdl/json'),
    TOML: await loadAstra('smol-toml'), JSON5: unwrap(await loadAstra('json5')), Hjson: unwrap(await loadAstra('hjson')),
    EDN: await loadAstra('edn-data'), XML: unwrap(await loadAstra('fast-xml-parser')), SDL: unwrap(await loadAstra('sdlang')),
  });
} catch (error) {
  loadErrors.astra = String(error.message ?? error).split('\n')[0];
}

// Which Astra adapters expose a genuine format-preserving edit path, as opposed
// to the constructor's decode→mutate→encode fallback. Source: Astra's report
// (`first-pass.md` no-op/edit results), which names YAML, KDL and Hjson for
// comment/no-op preservation; every other entry receives the fallback.
const ASTRA_PRESERVE = new Set(['YAML', 'KDL', 'Hjson']);

let CODECS = null;
try {
  ({ CODECS } = await import(pathToFileURL(join(OPUS_TOOLS, 'notations.mjs')).href));
} catch (error) {
  loadErrors.opus = String(error.message ?? error).split('\n')[0];
}

/** Notation identity shared by both adapter sets, with each side's codec name. */
const PAIRS = [
  { notation: 'JSON', astra: 'JSON', opus: 'json' },
  { notation: 'JSON (layout)', astra: null, opus: 'json-layout' },
  { notation: 'YAML', astra: 'YAML', opus: 'yaml' },
  { notation: 'KDL', astra: 'KDL', opus: 'kdl' },
  { notation: 'TOML', astra: 'TOML', opus: 'toml' },
  { notation: 'TOML (rows)', astra: null, opus: 'toml-rows' },
  { notation: 'JSON5', astra: 'JSON5', opus: 'json5' },
  { notation: 'Hjson', astra: 'Hjson', opus: 'hjson' },
  { notation: 'EDN', astra: 'EDN', opus: 'edn' },
  { notation: 'XML', astra: 'XML', opus: 'xml' },
];

// ---- normalised per-adapter surface ---------------------------------------
// Astra: encode/decode/noop/edit(text, path, value)
// Opus:  stringify/parse/edit(text, ops)
function surface(author, key) {
  if (author === 'astra') {
    if (!astraAdapters) return null;
    const a = astraAdapters[key];
    if (!a) return null;
    return {
      label: `astra/${key}`,
      encode: (value) => a.encode(value),
      decode: (text) => a.decode(text),
      noop: (text) => (a.noop ? a.noop(text) : a.encode(a.decode(text))),
      reemit: (text, path, value) => a.encode(assign(structuredClone(a.decode(text)), path, value)),
      preserve: ASTRA_PRESERVE.has(key) ? (text, path, value) => a.edit(text, path, value) : null,
      preserveNote: ASTRA_PRESERVE.has(key) ? 'adapter edit path' : null,
    };
  }
  const c = CODECS?.[key];
  if (!c) return null;
  return {
    label: `opus/${key}`,
    encode: (value) => c.stringify(value),
    decode: (text) => c.parse(text),
    noop: (text) => (c.edit ? c.edit(text, []) : c.stringify(c.parse(text))),
    reemit: (text, path, value) => c.stringify(assign(structuredClone(c.parse(text)), path, value)),
    preserve: c.edit ? (text, path, value) => c.edit(text, [{ op: 'set', path, value }]) : null,
    preserveNote: c.edit ? `adapter edit path (${c.printer})` : null,
    printer: c.printer,
  };
}

function assign(target, path, value) {
  let node = target;
  for (const key of path.slice(0, -1)) node = node[key];
  node[path.at(-1)] = value;
  return target;
}

// ---- workspace -------------------------------------------------------------
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const workDir = (name) => { const d = join(WORK, name); mkdirSync(d, { recursive: true }); return d; };

/** Line/byte delta between two texts, via Git's own diff (numstat + patch). */
function diffStats(dir, before, after) {
  const a = join(dir, 'before.txt'); const b = join(dir, 'after.txt');
  writeFileSync(a, before); writeFileSync(b, after);
  const numstat = git(['--no-pager', 'diff', '--no-index', '--numstat', '--', a, b]);
  const patch = git(['--no-pager', 'diff', '--no-index', '--unified=3', '--', a, b]);
  const [added, removed] = (numstat.stdout.trim().split('\n').pop() ?? '0\t0\t').split('\t');
  // Count the patch body only. The headers carry the absolute scratch paths, so
  // including them would make the measurement depend on where the run happened
  // and the committed results would not reproduce.
  const body = patch.stdout.split('\n').filter((line) => /^[@+\-]/.test(line) && !line.startsWith('--- ') && !line.startsWith('+++ '));
  return {
    addedLines: Number(added) || 0,
    removedLines: Number(removed) || 0,
    changedLines: (Number(added) || 0) + (Number(removed) || 0),
    diffBytes: Buffer.byteLength(`${body.join('\n')}\n`),
    identical: patch.stdout.length === 0,
  };
}

/** Real Git three-way text merge (the engine `git merge` uses for text files). */
function mergeText(dir, base, ours, theirs) {
  const paths = { base: join(dir, 'base'), ours: join(dir, 'ours'), theirs: join(dir, 'theirs') };
  writeFileSync(paths.base, base); writeFileSync(paths.ours, ours); writeFileSync(paths.theirs, theirs);
  const result = git(['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', paths.ours, paths.base, paths.theirs]);
  return {
    exit: result.status,
    textualConflict: result.status === 99 || result.status > 0,
    merged: result.stdout,
    stderr: result.stderr.trim(),
  };
}

function diffPaths(expected, actual, path = [], out = []) {
  if (out.length >= 5) return out;
  if (isDeepStrictEqual(expected, actual)) return out;
  if (typeof expected !== 'object' || typeof actual !== 'object' || expected === null || actual === null) {
    out.push({ path: path.join('.') || '(root)', expected: JSON.stringify(expected)?.slice(0, 120), actual: JSON.stringify(actual)?.slice(0, 120) });
    return out;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) diffPaths(expected[key], actual[key], [...path, key], out);
  if (out.length === 0 && Array.isArray(expected) !== Array.isArray(actual)) out.push({ path: path.join('.'), expected: 'array/object', actual: 'mismatch' });
  return out;
}

/** LF-normalised text comparison: newline conversion is permitted by the owner. */
const normaliseNewlines = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function decodeOrError(surfaceImpl, text) {
  try { return { ok: true, value: surfaceImpl.decode(text) }; } catch (error) { return { ok: false, error: String(error.message ?? error).split('\n')[0] }; }
}

// ---- the construction ------------------------------------------------------
const construction = buildSharedConstruction();
const documents = construction.documents;
const DOC_NAMES = Object.keys(documents);
const SCENE = 'scenes/courtyard/scene';
const TILES = 'scenes/courtyard/tiles';

const results = {
  generated: 'deterministic construction; see tools/research/native-data-notations/shared/construction.mjs',
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  construction: { ...SHARED_CONSTRUCTION_META, documents: DOC_NAMES, documentCount: DOC_NAMES.length },
  authors: {},
  shared: {},
  loadErrors,
};

// ===========================================================================
// 1. Serialise + round-trip every document, per notation, per adapter set.
// ===========================================================================
for (const author of ['astra', 'opus']) {
  const per = {};
  for (const pair of PAIRS) {
    const key = pair[author];
    if (!key) continue;
    const impl = surface(author, key);
    if (!impl) continue;
    const row = { label: impl.label, documents: 0, roundtripped: 0, bytes: 0, lines: 0, maxLineLength: 0, failures: [], mismatches: [], encodeMs: 0, decodeMs: 0 };
    const texts = {};
    for (const name of DOC_NAMES) {
      row.documents++;
      let text;
      const t0 = performance.now();
      try { text = impl.encode(documents[name]); } catch (error) { row.failures.push({ doc: name, stage: 'encode', error: String(error.message ?? error).split('\n')[0] }); continue; }
      row.encodeMs += performance.now() - t0;
      texts[name] = text;
      row.bytes += Buffer.byteLength(text);
      const lines = text.split('\n');
      row.lines += lines.length;
      row.maxLineLength = Math.max(row.maxLineLength, ...lines.map((line) => line.length));
      const t1 = performance.now();
      const decoded = decodeOrError(impl, text);
      row.decodeMs += performance.now() - t1;
      if (!decoded.ok) { row.failures.push({ doc: name, stage: 'decode', error: decoded.error }); continue; }
      if (isDeepStrictEqual(decoded.value, documents[name])) row.roundtripped++;
      else row.mismatches.push({ doc: name, differences: diffPaths(documents[name], decoded.value) });
    }
    row.encodeMs = Math.round(row.encodeMs); row.decodeMs = Math.round(row.decodeMs);
    row.samples = { [SCENE]: texts[SCENE]?.slice(0, 1200) };
    row.texts = texts;
    per[pair.notation] = row;
  }
  results.authors[author] = { notations: per };
}

// ===========================================================================
// 2. Shared comparisons on the identical value: sizes, no-op, edits, merges.
// ===========================================================================

/** One edit target: a distinctive scalar that appears once in the encoded text. */
const SCENE_EDIT_A = { path: ['placements', 1, 'onActivate', 'program'], value: 'scripts/gatekeeper-watch.prg' };
const SCENE_EDIT_B = { path: ['extensions', 'com.example.patrol', 'notes'], value: 'walks the south wall' };
const SCENE_INSERT = { op: 'insert', path: ['placements'], index: 3, value: { id: 'gatekeeper-4', actor: 'gatekeeper', at: [192, 96, 1], onActivate: { program: null } } };
const TILE_EDIT = { path: ['layers', 0, 'rows', 10, 20], value: 9 };

const shared = {
  sizes: [],
  noop: [],
  propertyEdit: [],
  tileEdit: [],
  insertPlacement: [],
  merges: [],
  scriptRoundTrip: [],
};

for (const pair of PAIRS) {
  for (const author of ['astra', 'opus']) {
    const key = pair[author];
    if (!key) continue;
    const impl = surface(author, key);
    if (!impl) continue;
    const dir = workDir(`${author}-${String(key).replace(/[^a-z0-9]+/gi, '-')}`);
    const entry = { notation: pair.notation, author, label: impl.label };

    // --- sizes on the scene and tiles documents -----------------------------
    try {
      const sceneText = impl.encode(documents[SCENE]);
      const tilesText = impl.encode(documents[TILES]);
      shared.sizes.push({ ...entry, sceneBytes: Buffer.byteLength(sceneText), sceneLines: sceneText.split('\n').length,
        tilesBytes: Buffer.byteLength(tilesText), tilesLines: tilesText.split('\n').length,
        tilesMaxLineLength: Math.max(...tilesText.split('\n').map((line) => line.length)) });
    } catch (error) { shared.sizes.push({ ...entry, error: String(error.message ?? error).split('\n')[0] }); continue; }

    // --- no-op open/save ----------------------------------------------------
    try {
      const before = impl.encode(documents[SCENE]);
      const after = impl.noop(before);
      shared.noop.push({ ...entry, bytesEqual: before === after, diff: diffStats(dir, before, after) });
    } catch (error) { shared.noop.push({ ...entry, error: String(error.message ?? error).split('\n')[0] }); }

    // --- one property change (canonical re-emit) ----------------------------
    try {
      const before = impl.encode(documents[SCENE]);
      const after = impl.reemit(before, SCENE_EDIT_A.path, SCENE_EDIT_A.value);
      const stats = diffStats(dir, before, after);
      const expected = assign(structuredClone(documents[SCENE]), SCENE_EDIT_A.path, SCENE_EDIT_A.value);
      const decoded = decodeOrError(impl, after);
      shared.propertyEdit.push({ ...entry, mode: 'reemit', ...stats, semanticallyCorrect: decoded.ok && isDeepStrictEqual(decoded.value, expected) });
    } catch (error) { shared.propertyEdit.push({ ...entry, mode: 'reemit', error: String(error.message ?? error).split('\n')[0] }); }

    // --- one property change (adapter preserve path, when it has one) -------
    if (impl.preserve) {
      try {
        const before = impl.encode(documents[SCENE]);
        const after = impl.preserve(before, SCENE_EDIT_A.path, SCENE_EDIT_A.value);
        const stats = diffStats(dir, before, after);
        const expected = assign(structuredClone(documents[SCENE]), SCENE_EDIT_A.path, SCENE_EDIT_A.value);
        const decoded = decodeOrError(impl, after);
        shared.propertyEdit.push({ ...entry, mode: 'preserve', note: impl.preserveNote, ...stats, semanticallyCorrect: decoded.ok && isDeepStrictEqual(decoded.value, expected) });
      } catch (error) { shared.propertyEdit.push({ ...entry, mode: 'preserve', error: String(error.message ?? error).split('\n')[0] }); }
    }

    // --- one tile cell in a substantial layer ------------------------------
    try {
      const before = impl.encode(documents[TILES]);
      const after = impl.reemit(before, TILE_EDIT.path, TILE_EDIT.value);
      const stats = diffStats(dir, before, after);
      const expected = assign(structuredClone(documents[TILES]), TILE_EDIT.path, TILE_EDIT.value);
      const decoded = decodeOrError(impl, after);
      shared.tileEdit.push({ ...entry, tileCells: SHARED_CONSTRUCTION_META.tileCells, ...stats,
        semanticallyCorrect: decoded.ok && isDeepStrictEqual(decoded.value, expected) });
    } catch (error) { shared.tileEdit.push({ ...entry, error: String(error.message ?? error).split('\n')[0] }); }

    // --- insert one placement ----------------------------------------------
    try {
      const before = impl.encode(documents[SCENE]);
      const value = structuredClone(documents[SCENE]);
      value.placements.splice(SCENE_INSERT.index, 0, structuredClone(SCENE_INSERT.value));
      const after = impl.encode(value);
      const stats = diffStats(dir, before, after);
      const decoded = decodeOrError(impl, after);
      shared.insertPlacement.push({ ...entry, ...stats, semanticallyCorrect: decoded.ok && isDeepStrictEqual(decoded.value, value) });
    } catch (error) { shared.insertPlacement.push({ ...entry, error: String(error.message ?? error).split('\n')[0] }); }

    // --- real Git three-way merges -----------------------------------------
    const baseText = (() => { try { return impl.encode(documents[SCENE]); } catch { return null; } })();
    if (baseText) {
      // (a) independent raw-text edits of two different values.
      const uniqueA = 'scripts/gatekeeper-relief.prg';
      const uniqueB = 'walks the north wall';
      if (baseText.includes(uniqueA) && baseText.includes(uniqueB)) {
        const ours = baseText.replace(uniqueA, 'scripts/gatekeeper-watch.prg');
        const theirs = baseText.replace(uniqueB, 'walks the south wall');
        const merged = mergeText(dir, baseText, ours, theirs);
        const expected = assign(assign(structuredClone(documents[SCENE]), SCENE_EDIT_A.path, SCENE_EDIT_A.value), SCENE_EDIT_B.path, SCENE_EDIT_B.value);
        const decoded = merged.textualConflict ? { ok: false } : decodeOrError(impl, merged.merged);
        shared.merges.push({ ...entry, case: 'independent-raw-edits', exit: merged.exit, textualConflict: merged.textualConflict,
          // A conflict-free merge that decodes to the wrong value is a false clean result.
          falseClean: !merged.textualConflict && !(decoded.ok && isDeepStrictEqual(decoded.value, expected)),
          semanticallyCorrect: !merged.textualConflict && decoded.ok && isDeepStrictEqual(decoded.value, expected) });
      }

      // (b) the same value changed incompatibly on both branches.
      if (baseText.includes(uniqueB)) {
        const ours = baseText.replace(uniqueB, 'walks the east wall');
        const theirs = baseText.replace(uniqueB, 'walks the west wall');
        const merged = mergeText(dir, baseText, ours, theirs);
        shared.merges.push({ ...entry, case: 'same-value-conflict', exit: merged.exit, textualConflict: merged.textualConflict,
          silentlyLostEdit: !merged.textualConflict && !(merged.merged.includes('east') && merged.merged.includes('west')) });
      }

      // (d) adjacent edits: two different placements (neighbouring records)
      // change different properties. Whether Git can merge these depends on how
      // much of one record shares a line, which is a printer/layout decision.
      try {
        const oursText = impl.reemit(baseText, ['placements', 0, 'at', 0], 72);
        const theirsText = impl.reemit(baseText, ['placements', 1, 'at', 0], 136);
        const merged = mergeText(dir, baseText, oursText, theirsText);
        const expected = assign(assign(structuredClone(documents[SCENE]), ['placements', 0, 'at', 0], 72), ['placements', 1, 'at', 0], 136);
        const decoded = merged.textualConflict ? { ok: false } : decodeOrError(impl, merged.merged);
        shared.merges.push({ ...entry, case: 'adjacent-placements', exit: merged.exit, textualConflict: merged.textualConflict,
          falseClean: !merged.textualConflict && !(decoded.ok && isDeepStrictEqual(decoded.value, expected)),
          semanticallyCorrect: !merged.textualConflict && decoded.ok && isDeepStrictEqual(decoded.value, expected) });
      } catch (error) { shared.merges.push({ ...entry, case: 'adjacent-placements', error: String(error.message ?? error).split('\n')[0] }); }

      // (c) simultaneous same-ID additions at DIFFERENT positions: Git merges
      // cleanly, and only a semantic check can see the duplicate identity.
      // Ours appends at the end of the list, theirs prepends at the start, so the
      // two hunks are far apart and Git has no textual reason to conflict.
      const addA = { id: 'dup-1', actor: 'gatekeeper', at: [16, 16, 1] };
      const addB = { id: 'dup-1', actor: 'gatekeeper', at: [32, 32, 1] };
      try {
        const oursText = impl.reemit(baseText, ['placements', 3], addA);
        const theirsText = (() => {
          const value = structuredClone(documents[SCENE]);
          value.placements.unshift(addB);
          return impl.encode(value);
        })();
        const merged = mergeText(dir, baseText, oursText, theirsText);
        let duplicateId = null;
        if (!merged.textualConflict) {
          const decoded = decodeOrError(impl, merged.merged);
          if (decoded.ok) {
            const ids = decoded.value.placements.map((placement) => placement.id);
            duplicateId = ids.length !== new Set(ids).size;
          }
        }
        shared.merges.push({ ...entry, case: 'same-id-additions', exit: merged.exit, textualConflict: merged.textualConflict,
          duplicateIdentityVisibleInText: !merged.textualConflict && (merged.merged.match(/dup-1/g) ?? []).length > 1,
          duplicateIdentityVisibleToSemantics: duplicateId });
      } catch (error) { shared.merges.push({ ...entry, case: 'same-id-additions', error: String(error.message ?? error).split('\n')[0] }); }
    }

    // --- adjacent tile cells: the layout-sensitive merge case --------------
    // Two neighbouring cells of one tile row. A printer that keeps a whole row
    // on one line forces a conflict; one cell per line merges cleanly. This is
    // the clearest case where the printer, not the notation, decides.
    try {
      const before = impl.encode(documents[TILES]);
      const oursText = impl.reemit(before, ['layers', 0, 'rows', 10, 20], 4);
      const theirsText = impl.reemit(before, ['layers', 0, 'rows', 10, 21], 4);
      const merged = mergeText(dir, before, oursText, theirsText);
      const expected = assign(assign(structuredClone(documents[TILES]), ['layers', 0, 'rows', 10, 20], 4), ['layers', 0, 'rows', 10, 21], 4);
      const decoded = merged.textualConflict ? { ok: false } : decodeOrError(impl, merged.merged);
      shared.merges.push({ ...entry, case: 'adjacent-tile-cells', exit: merged.exit, textualConflict: merged.textualConflict,
        falseClean: !merged.textualConflict && !(decoded.ok && isDeepStrictEqual(decoded.value, expected)),
        semanticallyCorrect: !merged.textualConflict && decoded.ok && isDeepStrictEqual(decoded.value, expected) });
    } catch (error) { shared.merges.push({ ...entry, case: 'adjacent-tile-cells', error: String(error.message ?? error).split('\n')[0] }); }

    // --- inline RPGCode round-trip (LF-normalised, per the owner's ruling) ---
    const inline = documents[SCENE].placements[0].whilePresent.inline;
    try {
      const text = impl.encode(documents[SCENE]);
      const decoded = decodeOrError(impl, text);
      const back = decoded.ok ? decoded.value.placements[0].whilePresent.inline : null;
      shared.scriptRoundTrip.push({ ...entry, decoded: back !== null,
        contentEqualAfterNewlineNormalisation: back !== null && normaliseNewlines(back) === normaliseNewlines(inline),
        bytesUnchanged: back === inline, sha256: sha(normaliseNewlines(inline)) });
    } catch (error) { shared.scriptRoundTrip.push({ ...entry, error: String(error.message ?? error).split('\n')[0] }); }
  }
}

// ===========================================================================
// 4. Printer-layout probe: same notation (JSON), three tile layouts. This
//    isolates the printer as the cause of merge and diff behaviour, so no
//    notation-specific library difference can explain the result.
// ===========================================================================
function jsonWithTileLayout(doc, layout) {
  // Render only layer 1's rows in the requested layout; the rest of the document
  // keeps the standard two-space JSON layout, so the comparison isolates the row
  // printer and nothing else.
  const clone = structuredClone(doc);
  const layers = clone.layers;
  delete clone.layers;
  const prefix = JSON.stringify(clone, null, 2).replace(/\n}$/, ',\n');
  const rendered = layers.map((layer) => {
    const head = `    { "layer": ${layer.layer}, "name": ${JSON.stringify(layer.name)}, "rows": [`;
    if (layer.layer !== 1) return `${head}${layer.rows.map((row) => `[${row.join(', ')}]`).join(', ')}] }`;
    const rows = layer.rows.map((row) => {
      if (layout === 'cell-per-line') return `      [\n${row.map((cell) => `        ${cell}`).join(',\n')}\n      ]`;
      return `      [${row.join(', ')}]`;
    });
    return `${head}\n${rows.join(',\n')}\n    ] }`;
  });
  return `${prefix}  "layers": [\n${rendered.join(',\n')}\n  ]\n}\n`;
}

/** Render the tiles document with exactly one cell changed, in a given layout. */
function tilesWithCell(layout, rowIndex, cellIndex, value) {
  const changed = structuredClone(documents[TILES]);
  changed.layers[0].rows[rowIndex][cellIndex] = value;
  return jsonWithTileLayout(changed, layout);
}

shared.layoutProbe = [];
for (const layout of ['row-per-line', 'cell-per-line']) {
  const dir = workDir(`layout-${layout}`);
  const before = jsonWithTileLayout(documents[TILES], layout);
  const edited = tilesWithCell(layout, 10, 20, 9);
  const parsedBefore = (() => { try { return JSON.parse(before); } catch { return null; } })();
  const parsedEdit = (() => { try { return JSON.parse(edited); } catch { return null; } })();
  const expectedEdit = assign(structuredClone(documents[TILES]), ['layers', 0, 'rows', 10, 20], 9);
  const entry = {
    layout,
    tilesBytes: Buffer.byteLength(before),
    tilesLines: before.split('\n').length,
    roundtrips: parsedBefore !== null && isDeepStrictEqual(parsedBefore, documents[TILES]),
    editCorrect: parsedEdit !== null && isDeepStrictEqual(parsedEdit, expectedEdit),
    oneCellEdit: diffStats(dir, before, edited),
  };
  // Two cells in the same row, five columns apart, edited on separate branches.
  const theirs = tilesWithCell(layout, 10, 25, 9);
  const merged = mergeText(dir, before, edited, theirs);
  const expectedMerge = assign(assign(structuredClone(documents[TILES]), ['layers', 0, 'rows', 10, 20], 9), ['layers', 0, 'rows', 10, 25], 9);
  let semanticOk = false;
  if (!merged.textualConflict) { try { semanticOk = isDeepStrictEqual(JSON.parse(merged.merged), expectedMerge); } catch { semanticOk = false; } }
  entry.sameRowMergeConflicted = merged.textualConflict;
  entry.sameRowMergeSemanticallyCorrect = !merged.textualConflict && semanticOk;
  shared.layoutProbe.push(entry);
  console.log(`layout ${layout.padEnd(14)} bytes=${entry.tilesBytes} lines=${entry.tilesLines} roundtrip=${entry.roundtrips} editOk=${entry.editCorrect} oneCellEditLines=${entry.oneCellEdit.changedLines} sameRowMergeConflict=${entry.sameRowMergeConflicted}`);
}

results.shared = shared;

// ===========================================================================
// 3. Cross-model view: the same notation, same value, two adapter choices.
// ===========================================================================
results.crossModel = PAIRS.filter((pair) => pair.astra && pair.opus).map((pair) => {
  const astraRow = results.authors.astra.notations[pair.notation];
  const opusRow = results.authors.opus.notations[pair.notation];
  const astraSize = shared.sizes.find((row) => row.notation === pair.notation && row.author === 'astra');
  const opusSize = shared.sizes.find((row) => row.notation === pair.notation && row.author === 'opus');
  return {
    notation: pair.notation,
    astra: { label: astraRow?.label, bytes: astraRow?.bytes, lines: astraRow?.lines, maxLineLength: astraRow?.maxLineLength,
      roundtripped: astraRow?.roundtripped, sceneBytes: astraSize?.sceneBytes, tilesBytes: astraSize?.tilesBytes },
    opus: { label: opusRow?.label, bytes: opusRow?.bytes, lines: opusRow?.lines, maxLineLength: opusRow?.maxLineLength,
      roundtripped: opusRow?.roundtripped, sceneBytes: opusSize?.sceneBytes, tilesBytes: opusSize?.tilesBytes },
    sameValueBothRoundtrip: astraRow?.roundtripped === astraRow?.documents && opusRow?.roundtripped === opusRow?.documents,
  };
});

// Trim the bulky per-document text from the tracked result (kept for inspection
// in an adjacent file) so the tracked summary stays readable.
const fullTexts = {};
for (const author of ['astra', 'opus']) {
  for (const [notation, row] of Object.entries(results.authors[author].notations)) {
    fullTexts[`${author}/${notation}`] = row.texts;
    delete row.texts;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(results, null, 1)}\n`);
writeFileSync(join(dirname(OUT), 'shared-encoded-texts.json'), `${JSON.stringify(fullTexts, null, 1)}\n`);

// ---- console summary -------------------------------------------------------
for (const pair of PAIRS) {
  const a = results.authors.astra?.notations?.[pair.notation];
  const o = results.authors.opus?.notations?.[pair.notation];
  const noopA = shared.noop.find((row) => row.notation === pair.notation && row.author === 'astra');
  const noopO = shared.noop.find((row) => row.notation === pair.notation && row.author === 'opus');
  console.log(
    pair.notation.padEnd(14),
    `astra ${a ? `${a.roundtripped}/${a.documents} docs ${a.bytes}B maxLine ${a.maxLineLength} noop=${noopA?.bytesEqual}` : '—'}`,
    '|',
    `opus ${o ? `${o.roundtripped}/${o.documents} docs ${o.bytes}B maxLine ${o.maxLineLength} noop=${noopO?.bytesEqual}` : '—'}`,
  );
}
const falseClean = shared.merges.filter((row) => row.falseClean === true);
const lost = shared.merges.filter((row) => row.silentlyLostEdit === true);
const scriptBad = shared.scriptRoundTrip.filter((row) => row.decoded && !row.contentEqualAfterNewlineNormalisation);
console.log(`\nmerges: ${shared.merges.length}, false-clean: ${falseClean.length}, silently-lost-edit: ${lost.length}, script content broken: ${scriptBad.length}`);
console.log(`wrote ${OUT}`);
