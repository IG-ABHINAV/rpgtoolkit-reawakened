// #1778 follow-up: how RPGCode behaves when it lives inline in a document.
//
// Two questions the first two passes did not answer:
//   A. YAML block scalars: when do the real YAML writers emit one, what do the
//      header forms (| |- |+ |2-) mean for RPGCode, and what happens when a person
//      damages the indentation by hand?
//   B. Script LINES as the unit of change. RPGCode is line-oriented, so the useful
//      Git question is whether two people editing different lines of the same inline
//      script merge cleanly. That depends on whether the notation's writer emits the
//      script as real lines or as one escaped string — measured here, per notation,
//      for both investigators' writers and for each notation's native multi-line
//      spelling.
//
// Newlines are LF throughout: the owner permits normalising RPGCode line endings.
// Nothing here parses or executes RPGCode; a script is an opaque multi-line string.
// Real `git merge-file` runs the three-way merge, and every merged document is
// decoded and compared with the complete expected script.
//
//   node scripts.mjs --astra-tools <dir> --astra-libs <dir> --opus-tools <dir> \
//                    --opus-libs <dir> --work <dir> --out <file>

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSharedConstruction } from './construction.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const [ASTRA_TOOLS, ASTRA_LIBS, OPUS_TOOLS, OPUS_LIBS, WORK, OUT] =
  ['--astra-tools', '--astra-libs', '--opus-tools', '--opus-libs', '--work', '--out'].map(opt);
if (![ASTRA_TOOLS, ASTRA_LIBS, OPUS_TOOLS, OPUS_LIBS, WORK, OUT].every(Boolean)) {
  console.error('usage: scripts.mjs --astra-tools <dir> --astra-libs <dir> --opus-tools <dir> --opus-libs <dir> --work <dir> --out <file>');
  process.exit(2);
}
process.env.NOTATION_LIBS = OPUS_LIBS;

const unwrap = (m) => m.default ?? m;
const astraReq = createRequire(join(ASTRA_LIBS, 'package.json'));
const loadAstra = async (name) => import(pathToFileURL(astraReq.resolve(name)).href);
const { createAdapters } = await import(pathToFileURL(join(ASTRA_TOOLS, 'adapters.mjs')).href);
const astra = createAdapters({
  YAML: await loadAstra('yaml'), KDL: await loadAstra('@bgotink/kdl'), KJSON: await loadAstra('@bgotink/kdl/json'),
  TOML: await loadAstra('smol-toml'), JSON5: unwrap(await loadAstra('json5')), Hjson: unwrap(await loadAstra('hjson')),
  EDN: await loadAstra('edn-data'), XML: unwrap(await loadAstra('fast-xml-parser')), SDL: unwrap(await loadAstra('sdlang')),
});
const { CODECS: opus } = await import(pathToFileURL(join(OPUS_TOOLS, 'notations.mjs')).href);
const YAML = createRequire(join(OPUS_LIBS, 'package.json'))('yaml');

const git = (argv) => spawnSync('git', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const SCRIPT_LINES = buildSharedConstruction().documents['scenes/courtyard/scene'].placements[0].whilePresent.inline.split('\n');
const results = { node: process.version, platform: `${process.platform}-${process.arch}`, scriptLines: SCRIPT_LINES.length };

// ===========================================================================
// A. YAML block scalars
// ===========================================================================
const yamlWriters = {
  astra: (value) => astra.YAML.encode(value),
  opus: (value) => opus.yaml.stringify(value),
};
const parseYaml = (text) => { const doc = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: true }); if (doc.errors.length) throw new Error(doc.errors[0].message.split('\n')[0]); return doc.toJS(); };

/** First header token after `inline:`, e.g. `|-`, `|2-`, `"…"`, `'…'`, or a plain scalar. */
const styleOf = (text) => {
  const m = /^inline:[ ]?(.*)$/m.exec(text.replace(/^[ ]+(?=inline:)/m, ''));
  if (!m) return 'unknown';
  const head = m[1].trim();
  if (/^\|[0-9+-]*$/.test(head)) return head;
  if (/^>[0-9+-]*$/.test(head)) return head;
  if (head.startsWith('"')) return 'double-quoted';
  if (head.startsWith("'")) return "single-quoted";
  return head === '' ? 'block-or-empty' : 'plain';
};

const L = SCRIPT_LINES;
const blockCases = [
  ['plain multi-line, no trailing newline', L.join('\n')],
  ['trailing newline', `${L.join('\n')}\n`],
  ['two trailing newlines', `${L.join('\n')}\n\n`],
  ['first line indented (needs an indentation indicator)', `    ${L[1]}\n${L[2]}`],
  ['every line indented (nested block body)', L.map((line) => `  ${line}`).join('\n')],
  ['leading blank line', `\n${L[1]}\n${L[2]}`],
  ['blank line between statements', `${L[1]}\n\n${L[2]}`],
  ['trailing space on a line', `${L[1]} \n${L[2]}`],
  ['a whitespace-only line', `${L[1]}\n   \n${L[2]}`],
  ['tab inside a line', `${L[1]}\n\tindented with a tab\n${L[2]}`],
  ['line starting with #', `${L[1]}\n# not a yaml comment here\n${L[2]}`],
  ['line starting with "- "', `${L[1]}\n- looks like a sequence item\n${L[2]}`],
  ['line "---" (document marker)', `${L[1]}\n---\n${L[2]}`],
  ['line "..." (document end marker)', `${L[1]}\n...\n${L[2]}`],
  ['line starting with %', `${L[1]}\n%directive-like\n${L[2]}`],
  ['line containing ": " and " #"', `${L[1]}\nlabel: value # not a comment\n${L[2]}`],
  ['non-ASCII text', `${L[1]}\nmwin("Séverine — 守门人");\n${L[2]}`],
  ['a 300-character line', `${L[1]}\nmwin("${'x'.repeat(300)}");\n${L[2]}`],
  ['single line, no newline', L[1]],
  ['single line with trailing newline', `${L[1]}\n`],
  ['empty string', ''],
  ['only a newline', '\n'],
  ['lone CR line ending (not normalised)', `${L[1]}\r${L[2]}`],
  ['CRLF line endings (not normalised)', `${L[1]}\r\n${L[2]}`],
];

results.yamlBlockCases = blockCases.map(([name, script]) => {
  const row = { case: name };
  for (const [who, write] of Object.entries(yamlWriters)) {
    try {
      const text = write({ inline: script });
      let decoded; try { decoded = parseYaml(text).inline; } catch (error) { decoded = `ERROR ${error.message}`; }
      row[who] = { style: styleOf(text), roundTrips: decoded === script };
      if (decoded !== script) row[who].problem = typeof decoded === 'string' && decoded.startsWith('ERROR') ? decoded : 'decoded value differs';
    } catch (error) { row[who] = { error: String(error.message ?? error) }; }
  }
  return row;
});

// Hand-edit damage to a block scalar: what a person can break with an ordinary text editor.
const base = (body) => `id: gate\nrun:\n  inline: |-\n${body}\n`;
const body = (lines, indent = 4) => lines.map((line) => (line === '' ? '' : `${' '.repeat(indent)}${line}`)).join('\n');
const sample = ['mwin("one");', '// note: this has a colon', 'mwin("three");'];
const intended = sample.join('\n');
const hand = [
  ['intended text (control)', base(body(sample)), 'control'],
  ['one line indented MORE than the block', base(body([sample[0], `  ${sample[1]}`, sample[2]])), 'extra leading spaces preserved as the line text'],
  ['one line dedented below the block indent (still inside the mapping)', base([`    ${sample[0]}`, `  ${sample[1]}`, `    ${sample[2]}`].join('\n')), 'the block ends early'],
  ['one line WITHOUT a colon dedented below the block indent', base([`    ${sample[0]}`, `  ${sample[0]}`, `    ${sample[2]}`].join('\n')), 'plain text cannot be a key: loud error'],
  ['one line WITHOUT a colon dedented to column 0', base([`    ${sample[0]}`, sample[0], `    ${sample[2]}`].join('\n')), 'plain text cannot be a key: loud error'],
  ['one line dedented to column 0', base([`    ${sample[0]}`, sample[1], `    ${sample[2]}`].join('\n')), 'the block ends and the line becomes YAML'],
  ['dedented line that happens to contain ": "', base([`    ${sample[0]}`, 'label: value', `    ${sample[2]}`].join('\n')), 'becomes a new key'],
  ['a line indented with a TAB', base([`    ${sample[0]}`, `\t${sample[1]}`, `    ${sample[2]}`].join('\n')), 'tab used as indentation'],
  ['header |- changed to | (drops the minus)', `id: gate\nrun:\n  inline: |\n${body(sample)}\n`, 'adds one trailing newline'],
  ['header |- changed to |+ (keep)', `id: gate\nrun:\n  inline: |+\n${body(sample)}\n\n`, 'keeps trailing blank lines'],
  ['header changed to > (folded)', `id: gate\nrun:\n  inline: >-\n${body(sample)}\n`, 'newlines become spaces'],
  ['pasted block with different base indent (2 instead of 4)', base(body(sample, 2)), 'block indent comes from the first line'],
  ['first line indented, no indicator', base([`      ${sample[0]}`, `    ${sample[1]}`, `    ${sample[2]}`].join('\n')), 'later lines are less indented than the first'],
  // The indentation indicator counts from the PARENT's indent (here 2), so |2 means
  // a base indent of 4 and the first line's 2 extra spaces are kept as text.
  ['first line indented, with explicit indentation indicator |2-', `id: gate\nrun:\n  inline: |2-\n      ${sample[0]}\n    ${sample[1]}\n    ${sample[2]}\n`, 'indicator fixes the base indent; first line keeps 2 extra spaces'],
  ['pasted block at a DEEPER base indent (6)', base(body(sample, 6)), 'any consistent indent deeper than the parent works'],
];
results.yamlHandEdits = hand.map(([name, text, note]) => {
  let parsed; let error = null;
  try { parsed = parseYaml(text); } catch (e) { error = e.message; }
  const value = parsed?.run?.inline;
  const outcome = error ? 'rejected' : value === intended ? 'same-as-intended' : (typeof value === 'string' ? 'accepted-different-value' : 'accepted-different-structure');
  const otherKeys = parsed && typeof parsed === 'object' ? { ...Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== 'id' && k !== 'run')), ...Object.fromEntries(Object.entries(parsed.run ?? {}).filter(([k]) => k !== 'inline').map(([k, v]) => [`run.${k}`, v])) } : undefined;
  return { case: name, note, outcome, error, value: typeof value === 'string' ? value : undefined, otherKeys: otherKeys && Object.keys(otherKeys).length ? otherKeys : undefined, structure: typeof value === 'string' ? undefined : parsed };
});

// ===========================================================================
// B. Merging edits to different lines of one inline script
// ===========================================================================
const esc = (line) => JSON.stringify(line).slice(1, -1);
const doc = (script) => ({ id: 'gate', run: { inline: script } });

// A writer produces the full document text from a script (a list of lines).
// "canonical" ones call the investigators' real writers; "native" ones are
// hand-written to each notation's own multi-line string spelling (the same spellings
// Astra's strings.mjs verified), re-verified here by decoding.
const writers = [];
const add = (notation, form, render, decoders) => writers.push({ notation, form, render, decoders });

for (const [label, enc, dec] of [
  ['astra', (v) => astra.YAML.encode(v), (t) => astra.YAML.decode(t)],
  ['opus', (v) => opus.yaml.stringify(v), (t) => opus.yaml.parse(t)],
]) add('YAML', `canonical (${label} writer)`, (lines) => enc(doc(lines.join('\n'))), [dec]);

add('YAML', 'native literal block |-', (lines) => `id: gate\nrun:\n  inline: |-\n${lines.map((l) => (l === '' ? '' : `    ${l}`)).join('\n')}\n`, [(t) => astra.YAML.decode(t)]);

add('JSON', 'canonical (JSON.stringify)', (lines) => `${JSON.stringify(doc(lines.join('\n')), null, 2)}\n`, [(t) => JSON.parse(t)]);

for (const [label, enc] of [['astra', (v) => astra.JSON5.encode(v)], ['opus', (v) => opus.json5.stringify(v)]]) {
  add('JSON5', `canonical (${label} writer)`, (lines) => enc(doc(lines.join('\n'))), [(t) => astra.JSON5.decode(t)]);
}
add('JSON5', 'native line continuation "…\\n\\<newline>"', (lines) =>
  `{\n  id: 'gate',\n  run: {\n    inline: "${lines.map(esc).join('\\n\\\n')}",\n  },\n}\n`, [(t) => astra.JSON5.decode(t)]);

for (const [label, enc] of [['astra', (v) => astra.TOML.encode(v)], ['opus', (v) => opus.toml.stringify(v)]]) {
  add('TOML', `canonical (${label} writer)`, (lines) => enc(doc(lines.join('\n'))), [(t) => astra.TOML.decode(t)]);
}
add('TOML', "native literal block '''", (lines) => `id = "gate"\n\n[run]\ninline = '''\n${lines.join('\n')}'''\n`, [(t) => astra.TOML.decode(t)]);

for (const [label, enc] of [['astra', (v) => astra.KDL.encode(v)], ['opus', (v) => opus.kdl.stringify(v)]]) {
  add('KDL', `canonical (${label} writer)`, (lines) => enc(doc(lines.join('\n'))), [(t) => astra.KDL.decode(t)]);
}
add('KDL', 'native raw multi-line #"""', (lines) =>
  `- {\n  id gate\n  run {\n    inline #"""\n${lines.map((l) => (l === '' ? '' : `      ${l}`)).join('\n')}\n      """#\n  }\n}\n`, [(t) => astra.KDL.decode(t)]);

for (const [label, enc] of [['astra', (v) => astra.Hjson.encode(v)], ['opus', (v) => opus.hjson.stringify(v)]]) {
  add('Hjson', `canonical (${label} writer)`, (lines) => enc(doc(lines.join('\n'))), [(t) => astra.Hjson.decode(t)]);
}
add('Hjson', "native multi-line '''", (lines) =>
  `{\n  id: gate\n  run: {\n    inline:\n    '''\n${lines.map((l) => (l === '' ? '' : `    ${l}`)).join('\n')}\n    '''\n  }\n}\n`, [(t) => astra.Hjson.decode(t)]);

for (const [label, enc] of [['astra', (v) => astra.EDN.encode(v)], ['opus', (v) => opus.edn.stringify(v)]]) {
  add('EDN', `canonical (${label} writer)`, (lines) => enc(doc(lines.join('\n'))), [(t) => astra.EDN.decode(t)]);
}
add('EDN', 'native literal newlines inside the string', (lines) =>
  `{"id" "gate"\n "run" {"inline" "${lines.map(esc).join('\n')}"}}\n`, [(t) => astra.EDN.decode(t)]);

add('XML', 'canonical (opus writer, text node)', (lines) => opus.xml.stringify(doc(lines.join('\n'))), [(t) => opus.xml.parse(t)]);
add('XML', 'native CDATA', (lines) => opus.xml.stringify(doc('@@S@@')).replace('@@S@@', `<![CDATA[${lines.join('\n')}]]>`), [(t) => opus.xml.parse(t)]);

// ---- logical edits on the list of script lines ----------------------------
const clone = (lines) => lines.slice();
const edits = {
  line1: (lines) => { const x = clone(lines); x[1] = 'mwin("Halt! State your business.");'; return x; },
  line2: (lines) => { const x = clone(lines); x[2] = 'itemPath("source", tkMV_WAYPOINT_LINK, "patrol", 1);'; return x; },
  line5: (lines) => { const x = clone(lines); x[5] = 'if (getVar("gateOpen") = 2) then { send("hall", 32, 96, 1); }'; return x; },
  line1alt: (lines) => { const x = clone(lines); x[1] = 'mwin("Halt!");'; return x; },
  insertAfter0: (lines) => { const x = clone(lines); x.splice(1, 0, 'setVar("seen", 1);'); return x; },
  delete2: (lines) => { const x = clone(lines); x.splice(2, 1); return x; },
  appendA: (lines) => [...lines, 'mwin("A");'],
  appendB: (lines) => [...lines, 'mwin("B");'],
};
// scenario: [name, ours, theirs, kind]; kind says what a correct tool does
//   independent -> should merge cleanly      incompatible -> must conflict
//   ambiguous   -> a conflict is acceptable (order undecidable)
const scenarios = [
  ['far-apart lines (1 vs 5)', 'line1', 'line5', 'independent'],
  ['adjacent lines (1 vs 2)', 'line1', 'line2', 'independent'],
  ['same line, incompatible', 'line1', 'line1alt', 'incompatible'],
  ['insert a line vs edit a distant line', 'insertAfter0', 'line5', 'independent'],
  ['delete a line vs edit a distant line', 'delete2', 'line5', 'independent'],
  ['both append a different line', 'appendA', 'appendB', 'ambiguous'],
];
const expected = {
  'far-apart lines (1 vs 5)': (l) => edits.line5(edits.line1(l)),
  'adjacent lines (1 vs 2)': (l) => edits.line2(edits.line1(l)),
  // The distant edit targets an ORIGINAL line, so apply it before the structural
  // change shifts the indices.
  'insert a line vs edit a distant line': (l) => edits.insertAfter0(edits.line5(l)),
  'delete a line vs edit a distant line': (l) => edits.delete2(edits.line5(l)),
};

const outcomeLabel = (kind, conflicted, correct) => {
  if (kind === 'incompatible') return conflicted ? 'X' : 'F';
  if (kind === 'ambiguous') return conflicted ? 'O' : (correct === null ? 'F' : 'F');
  if (conflicted) return 's';
  return correct ? 'C' : 'F';
};

const rows = [];
let dirIndex = 0;
for (const writer of writers) {
  const dir = join(WORK, `w${String(dirIndex++).padStart(2, '0')}`);
  mkdirSync(dir, { recursive: true });
  const row = { notation: writer.notation, form: writer.form, roundTrips: false, scenarios: {} };
  let baseText;
  try {
    baseText = writer.render(SCRIPT_LINES);
    row.roundTrips = writer.decoders.every((decode) => {
      try { return decode(baseText)?.run?.inline === SCRIPT_LINES.join('\n'); } catch { return false; }
    });
    row.bytes = Buffer.byteLength(baseText);
    row.lines = baseText.split('\n').length;
  } catch (error) { row.error = String(error.message ?? error).split('\n')[0]; rows.push(row); continue; }
  if (!row.roundTrips) { row.note = 'base document did not decode to the logical script'; rows.push(row); continue; }

  for (const [name, oursKey, theirsKey, kind] of scenarios) {
    const ours = writer.render(edits[oursKey](SCRIPT_LINES));
    const theirs = writer.render(edits[theirsKey](SCRIPT_LINES));
    const paths = ['base', 'ours', 'theirs'].map((n) => join(dir, `${name.replace(/[^a-z0-9]+/gi, '-')}.${n}`));
    writeFileSync(paths[0], baseText); writeFileSync(paths[1], ours); writeFileSync(paths[2], theirs);
    const merged = git(['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', paths[1], paths[0], paths[2]]);
    const conflicted = merged.status !== 0;
    let correct = null;
    if (!conflicted && expected[name]) {
      try { correct = writer.decoders.every((decode) => decode(merged.stdout)?.run?.inline === expected[name](SCRIPT_LINES).join('\n')); } catch { correct = false; }
    } else if (!conflicted) { correct = false; }
    row.scenarios[name] = outcomeLabel(kind, conflicted, correct);
  }
  row.linesMergeIndependently = row.scenarios['far-apart lines (1 vs 5)'] === 'C';
  rows.push(row);
}
results.scriptMerge = { scenarios: scenarios.map(([name, , , kind]) => ({ name, kind })), rows };


// ===========================================================================
// C. Does a format-preserving library edit keep a hand-written multi-line form?
// ===========================================================================
// Start from each notation's native multi-line spelling, then (1) change an unrelated
// property and (2) replace the script with a copy that differs on ONE line, both
// through the notation's own preserve-edit path. If the library flattens the string
// to one escaped line, the benefit of the native spelling is lost on the first
// editor-driven save.
const diffLines = (before, after) => {
  const a = join(WORK, 'c-before.txt'); const b = join(WORK, 'c-after.txt');
  writeFileSync(a, before); writeFileSync(b, after);
  const n = git(['--no-pager', 'diff', '--no-index', '--numstat', '--', a, b]).stdout.trim().split('\n').pop() ?? '0\t0\t';
  const [added, removed] = n.split('\t');
  return { added: Number(added) || 0, removed: Number(removed) || 0 };
};
const preserveTargets = [
  ['YAML', 'yaml', writers.find((w) => w.notation === 'YAML' && w.form.startsWith('native'))],
  ['KDL', 'kdl', writers.find((w) => w.notation === 'KDL' && w.form.startsWith('native'))],
  ['TOML', 'toml', writers.find((w) => w.notation === 'TOML' && w.form.startsWith('native'))],
  ['Hjson', 'hjson', writers.find((w) => w.notation === 'Hjson' && w.form.startsWith('native'))],
  ['XML', 'xml', writers.find((w) => w.notation === 'XML' && w.form.startsWith('native'))],
];
results.preserveEdit = preserveTargets.map(([notation, key, writer]) => {
  const row = { notation, library: opus[key].libraries.join(', '), form: writer.form };
  const text = writer.render(SCRIPT_LINES);
  const decode = (t) => writer.decoders[0](t);
  const attempt = (label, fn) => {
    try {
      const after = fn();
      row[label] = { decodesTo: null, ...diffLines(text, after) };
      row[label].after = after;
      return after;
    } catch (error) { row[label] = { error: String(error.message ?? error).split('\n')[0] }; return null; }
  };
  const unrelated = attempt('unrelatedEdit', () => opus[key].edit(text, [{ op: 'set', path: ['id'], value: 'gate2' }]));
  if (unrelated) {
    const value = decode(unrelated);
    row.unrelatedEdit.scriptUnchanged = value?.run?.inline === SCRIPT_LINES.join('\n') && value?.id === 'gate2';
    row.unrelatedEdit.formKept = unrelated.split('\n').filter((l) => SCRIPT_LINES.some((sl) => l.includes(sl.slice(0, 12)))).length >= 3;
    delete row.unrelatedEdit.after;
  }
  const oneLine = edits.line1(SCRIPT_LINES);
  const edited = attempt('scriptEdit', () => opus[key].edit(text, [{ op: 'set', path: ['run', 'inline'], value: oneLine.join('\n') }]));
  if (edited) {
    row.scriptEdit.correct = decode(edited)?.run?.inline === oneLine.join('\n');
    row.scriptEdit.stillPerLine = row.scriptEdit.added <= 2 && row.scriptEdit.removed <= 2;
    delete row.scriptEdit.after;
  }
  return row;
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(results, null, 1)}\n`);

// ---- console summary --------------------------------------------------------
console.log('\nA. YAML block-scalar styles emitted (astra | opus)');
for (const r of results.yamlBlockCases) {
  console.log(`  ${r.case.padEnd(55)} ${String(r.astra?.style).padEnd(14)} ${r.astra?.roundTrips ? 'ok ' : 'BAD'} | ${String(r.opus?.style).padEnd(14)} ${r.opus?.roundTrips ? 'ok ' : 'BAD'}${r.astra?.problem ? '  ' + r.astra.problem : ''}`);
}
console.log('\nA. YAML hand-edit damage');
for (const r of results.yamlHandEdits) console.log(`  ${r.case.padEnd(66)} ${r.outcome}${r.error ? '  — ' + r.error : ''}${r.outcome === 'accepted-different-value' ? '  inline=' + JSON.stringify(r.value) + (r.otherKeys ? ' otherKeys=' + JSON.stringify(r.otherKeys) : '') : ''}`);
console.log('\nB. Script-line merges');
const names = scenarios.map((s) => s[0]);
console.log(`  ${'notation / form'.padEnd(58)} per-line   ${names.map((_n, i) => String(i + 1)).join(' ')}   ${names.map((n, i) => `${i + 1}=${n}`).join('; ')}`);
for (const r of rows) console.log(`  ${(`${r.notation}: ${r.form}`).padEnd(58)} ${String(r.linesMergeIndependently ?? '').padEnd(9)}  ${names.map((n) => r.scenarios[n] ?? '?').join(' ')}${r.note ? '  ' + r.note : ''}${r.error ? '  ' + r.error : ''}`);
console.log('\nC. Format-preserving edit keeps the native multi-line form?');
for (const r of results.preserveEdit) console.log(`  ${r.notation.padEnd(6)} ${r.form.padEnd(44)} unrelated edit: ${r.unrelatedEdit?.error ?? `+${r.unrelatedEdit.added}/-${r.unrelatedEdit.removed} value ok=${r.unrelatedEdit.scriptUnchanged}`}   one-line script edit: ${r.scriptEdit?.error ?? `+${r.scriptEdit.added}/-${r.scriptEdit.removed} correct=${r.scriptEdit.correct} perLine=${r.scriptEdit.stillPerLine}`}`);
console.log(`\nwrote ${OUT}`);
