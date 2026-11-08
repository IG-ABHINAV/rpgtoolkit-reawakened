// #1778 research (Opus): emit EVERY projected logical document of each cohort
// game in every notation adapter, parse it back and compare with the logical
// value (semantic round trip). Writes populated projections to scratch and a
// machine-readable summary. Real game data, not synthetic fixtures.
//
//   node roundtrip-corpus.mjs --projection <scratch>/projection --out <scratch>/results/roundtrip-corpus.json [--write]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CODECS } from './notations.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const root = opt('--projection');
const out = opt('--out');
const write = args.includes('--write');
const only = opt('--codecs')?.split(',');

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const stats = { strings: 0, nonAscii: 0, multiline: 0, quotes: 0, backslashes: 0, numbersNonInteger: 0, nulls: 0, maxDepth: 0 };
function census(v, depth = 0) {
  stats.maxDepth = Math.max(stats.maxDepth, depth);
  if (v === null) { stats.nulls++; return; }
  if (typeof v === 'string') { stats.strings++; if (/[^\x00-\x7f]/.test(v)) stats.nonAscii++; if (v.includes('\n')) stats.multiline++; if (v.includes('"')) stats.quotes++; if (v.includes('\\')) stats.backslashes++; return; }
  if (typeof v === 'number') { if (!Number.isInteger(v)) stats.numbersNonInteger++; return; }
  if (typeof v === 'object') for (const x of Object.values(v)) census(x, depth + 1);
}

const results = { node: process.version, platform: `${process.platform}-${process.arch}`, games: {} };
for (const game of readdirSync(root).filter((g) => statSync(join(root, g)).isDirectory())) {
  const modelDir = join(root, game, 'model');
  const files = walk(modelDir).filter((p) => p.endsWith('.json'));
  const docs = files.map((p) => ({ rel: relative(modelDir, p).replace(/\.json$/, ''), value: JSON.parse(readFileSync(p, 'utf8')) }));
  for (const d of docs) census(d.value);
  const perCodec = {};
  for (const [id, codec] of Object.entries(CODECS)) {
    if (only && !only.includes(id)) continue;
    const r = { documents: docs.length, ok: 0, mismatches: [], failures: [], bytes: 0, lines: 0, maxLineLength: 0, stringifyMs: 0, parseMs: 0 };
    for (const d of docs) {
      let text;
      try { const t0 = performance.now(); text = codec.stringify(d.value); r.stringifyMs += performance.now() - t0; }
      catch (e) { r.failures.push({ doc: d.rel, stage: 'stringify', error: e.message.slice(0, 200) }); continue; }
      r.bytes += Buffer.byteLength(text); const lines = text.split('\n'); r.lines += lines.length; r.maxLineLength = Math.max(r.maxLineLength, ...lines.map((l) => l.length));
      if (write) { const t = join(root, game, 'notations', id, `${d.rel}.${codec.ext}`); mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, text); }
      try {
        const t0 = performance.now(); const back = codec.parse(text); r.parseMs += performance.now() - t0;
        if (isDeepStrictEqual(back, d.value)) r.ok++; else r.mismatches.push({ doc: d.rel, firstDifference: firstDiff(d.value, back) });
      } catch (e) { r.failures.push({ doc: d.rel, stage: 'parse', error: e.message.slice(0, 200), line: e.line }); }
    }
    r.stringifyMs = Math.round(r.stringifyMs); r.parseMs = Math.round(r.parseMs);
    r.mismatches = r.mismatches.slice(0, 5).concat(r.mismatches.length > 5 ? [{ more: r.mismatches.length - 5 }] : []);
    r.failures = r.failures.slice(0, 5).concat(r.failures.length > 5 ? [{ more: r.failures.length - 5 }] : []);
    perCodec[id] = r;
    console.log(game.padEnd(20), id.padEnd(14), `${r.ok}/${r.documents}`, `bytes=${r.bytes}`, `maxLine=${r.maxLineLength}`, `stringify=${r.stringifyMs}ms parse=${r.parseMs}ms`, r.failures.length ? `FAIL ${JSON.stringify(r.failures[0])}` : '', r.mismatches.length ? `MISMATCH ${JSON.stringify(r.mismatches[0])}` : '');
  }
  results.games[game] = { documents: docs.length, perCodec };
}
results.valueCensus = stats;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 1));
console.log(JSON.stringify(stats));

function firstDiff(a, b, path = []) {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return { path: path.join('.'), expected: JSON.stringify(a)?.slice(0, 80), actual: JSON.stringify(b)?.slice(0, 80) };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { const d = firstDiff(a[k], b[k], [...path, k]); if (d) return d; }
  if (Array.isArray(a) !== Array.isArray(b)) return { path: path.join('.'), expected: 'array/object kind', actual: 'differs' };
  return { path: path.join('.'), expected: 'key order', actual: 'differs' };
}
