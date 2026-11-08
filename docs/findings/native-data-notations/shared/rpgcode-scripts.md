# Inline RPGCode: block scalars, native multi-line strings, and script-line merges

A follow-up to the shared comparison, prompted by a gap the owner spotted: the
independent reports touched YAML **block scalars** only lightly (each noted the `|`
versus `|-` trailing-newline trap, and Astra verified one block spelling), and neither measured
the question that matters most for line-oriented code in Git — *do two people editing
different lines of the same inline script merge cleanly?*

RPGCode is treated as an opaque multi-line string with LF line endings, as the owner
permits. Nothing here parses or executes RPGCode.

- Harness: [`scripts.mjs`](../../../../tools/research/native-data-notations/shared/scripts.mjs)
- Results: [`results/rpgcode-scripts.json`](results/rpgcode-scripts.json)
- Script used: the six-line inline hook from the [shared construction](../../../../tools/research/native-data-notations/shared/construction.mjs)
  (quotes, backslashes, `"""`, `|pipe|`, a tab, a Windows path).

## Short answers

1. **Every notation except JSON has a multi-line string syntax.** JSON has none, so an
   inline script is always one escaped line. That is a property of the notation, not of
   any library.
2. **Whether a document ends up with the script as real lines depends on the writer,
   and most stock writers do not do it.** Only the YAML library, XML, and Opus's Hjson
   configuration emitted real lines by default. The TOML, KDL, EDN and JSON5 libraries
   emitted one escaped line, even though TOML, KDL and EDN can spell the script as lines.
3. **Real lines are what make script edits merge.** Two edits to distant lines of the
   same script merged cleanly in every real-line form and conflicted in every
   one-escaped-line form.
4. **YAML block scalars work for RPGCode, with specific hand-editing hazards** listed
   below. Two of them change the script silently.

## 1. Which notations can spell a script as lines

Each native spelling was hand-written, decoded with the real parser, and confirmed to
return exactly the logical script before it was used.

| Notation | Multi-line spelling | Emitted by the stock writer? |
|---|---|---|
| JSON | none | — (one escaped line always) |
| YAML | literal block `\|-` (also `\|`, `\|+`, `\|2-`) | **yes**, both investigators' writers |
| TOML | `'''` literal block | no — both writers emit one escaped line |
| KDL | `#"""` raw multi-line string | no — both writers emit one escaped line |
| Hjson | `'''` multi-line | Opus's configuration yes; Astra's no (it disables multi-line) |
| EDN | literal newlines inside the string | no — both writers emit one escaped line |
| JSON5 | line continuation `"…\n\⏎…"` | no — both writers emit one escaped line |
| XML | text node or `<![CDATA[…]]>` | yes (Opus's vocabulary) |
| RON | raw string `r#"…"#` | not measured here |
| SDLang | backtick raw string | not measured here (the only JavaScript library is unusable, see the candidate reports) |

So "YAML does this and the others do not" is **not** a statement about the notations.
It is a statement about which stock writers choose lines by default. A project-owned
writer can emit real lines in TOML, KDL, EDN and Hjson — at the cost of writing and
maintaining it, which both investigators already identified as required anyway.

## 2. Script-line merges (real `git merge-file`)

Twenty-one writer forms (both investigators' canonical writers plus each notation's
native spelling) × six scenarios = 126 three-way merges. Every base document was
decoded back to the logical script first; every clean merge was decoded and compared
with the complete expected script.

Legend: **C** clean and exactly correct · **s** spurious conflict (the edits were
independent) · **X** conflict where the edits really are incompatible (correct) · **O**
conflict where order is genuinely ambiguous (acceptable) · **F** wrong clean merge
(none occurred).

| Notation: form | Edits distant lines | Edits adjacent lines | Same line, incompatible | Insert a line vs edit a distant line | Delete a line vs edit a distant line | Both append a line |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| YAML: canonical (Astra) | **C** | s | X | **C** | **C** | O |
| YAML: canonical (Opus) | **C** | s | X | **C** | **C** | O |
| YAML: `\|-` block | **C** | s | X | **C** | **C** | O |
| JSON: `JSON.stringify` | s | s | X | s | s | O |
| JSON5: canonical (Astra) | s | s | X | s | s | O |
| JSON5: canonical (Opus) | s | s | X | s | s | O |
| JSON5: line continuation | **C** | s | X | **C** | **C** | O |
| TOML: canonical (Astra) | s | s | X | s | s | O |
| TOML: canonical (Opus) | s | s | X | s | s | O |
| TOML: `'''` block | **C** | s | X | **C** | **C** | O |
| KDL: canonical (Astra) | s | s | X | s | s | O |
| KDL: canonical (Opus) | s | s | X | s | s | O |
| KDL: `#"""` raw block | **C** | s | X | **C** | **C** | O |
| Hjson: canonical (Astra) | s | s | X | s | s | O |
| Hjson: canonical (Opus) | **C** | s | X | **C** | **C** | O |
| Hjson: `'''` block | **C** | s | X | **C** | **C** | O |
| EDN: canonical (Astra) | s | s | X | s | s | O |
| EDN: canonical (Opus) | s | s | X | s | s | O |
| EDN: literal newlines | **C** | s | X | **C** | **C** | O |
| XML: text node (Opus) | **C** | s | X | **C** | **C** | O |
| XML: CDATA | **C** | s | X | **C** | **C** | O |

Reading the table:

- The split is exact: a form either merges distant script edits or conflicts on them,
  and the dividing line is **one escaped line versus real lines**, not the notation.
- Adjacent-line edits conflict in *every* form. That is Git's own rule for hunks with
  no unchanged line between them, so line-level layout cannot remove it.
- "Same line, incompatible" and "both append" behave identically everywhere, as they
  should.
- JSON has no row that merges, because it has no spelling that does.

## 3. Does a format-preserving edit keep the native spelling?

Starting from each notation's native multi-line form, one unrelated property was
changed, then the script was replaced with a copy that differs on one line, both through
the preserve-edit path of the library that the investigators used. Counts are changed
lines from `git diff --numstat`.

| Notation | Unrelated edit | One-line script edit | Result |
|---|---|---|---|
| YAML `yaml` | +1 / −1 | +1 / −1 | Block kept; the edit stays one line |
| TOML `toml-patch` | +1 / −1 | +1 / −1 | Block kept |
| KDL `@bgotink/kdl` | +1 / −1 | +1 / −8 | Unrelated edits keep the raw block; **replacing the whole string collapsed it to one escaped line** through this adapter |
| Hjson `Hjson.rt` | +9 / −9 | +8 / −8 | Rewrote the multi-line layout either way |
| XML `@xmldom/xmldom` | +1 / −1 | +3 / −3 | Still real lines, but CDATA became a plain text node |

The KDL and Hjson results are properties of the editing path used, not proof about the
notation: whether the KDL library can set a string with a raw multi-line format was not
investigated. They matter because a project adopting either would need to solve it.

## 4. YAML block scalars

### What the real writers emit

Both investigators' YAML writers (the `yaml` library, 24 cases each) chose the header
that reproduces the value exactly in every case, and every case round-tripped:

| Script | Header emitted |
|---|---|
| No trailing newline | `\|-` |
| One trailing newline | `\|` |
| Two trailing newlines | `\|+` |
| First line indented, or every line indented | `\|2-` (explicit indentation indicator) |
| Lines starting with `#`, `- `, `%`, `---`, `...`, or containing `: ` and ` #` | `\|-` |
| Trailing spaces, whitespace-only lines, tabs, blank lines, non-ASCII, a 300-character line | `\|-` |
| A single line | a plain scalar |
| Empty string, CR or CRLF line endings | double-quoted |

Because RPGCode here is LF-normalised, the double-quoted fallback applies only to the
empty string and to un-normalised input. The indentation indicator counts from the
**parent's** indentation, which the writer handles and which is easy to get wrong by
hand.

### What a person can break with a text editor

These are plain text edits to a block scalar, parsed with the same library. "Loud"
means the parser rejected the document with a line and column.

| Edit | Outcome |
|---|---|
| Indent one line deeper | Kept as leading spaces on that line — correct |
| Paste the block at a deeper consistent indent | Same script — correct |
| Add a line with a **tab** as indentation | Loud |
| Dedent one line that has **no** colon | Loud |
| Dedent one line that **contains `: `** | **Silent.** The script is truncated at that line, and the rest becomes a stray key |
| First line indented, no indicator | Loud |
| First line indented, with the indicator `\|2-` | Correct — first line keeps two extra spaces |
| Delete the `-` from `\|-` | **Silent.** The script gains a trailing newline |
| Change `\|` to `>` (folded) | **Silent.** Every newline becomes a space; the script is one line |
| Paste the block at the same indent as its parent key | Loud |

The silent dedent is the one to take seriously. RPGCode lines often contain `: `
(`mwin("Health: 10");`, `// note: …`). A line dedented by accident silently becomes
a new YAML key and ends the script early. Example, observed:

```yaml
run:
  inline: |-
    mwin("one");
  // note: this has a colon      <- dedented by two spaces
    mwin("three");
```

parses as `inline: 'mwin("one");'` plus a stray key `run.// note`. A core schema that
forbids unknown keys under `run` would flag the stray key; that was **not** exercised
here, so treat it as a mitigation to verify, not a result.

## What this does and does not establish

**Established, on the data and tools tested:**

- JSON cannot represent an inline script as lines, so any two edits to one script
  conflict in Git. This is a notation limit.
- For every other notation tested, the capability exists, and the merge result follows
  the writer's choice of lines exactly.
- YAML block scalars round-trip the awkward RPGCode cases and merge per line, with the
  hand-editing hazards above.

**Not established:**

- It does not rank YAML over KDL, TOML, Hjson or EDN. Those can spell scripts as lines;
  they need a project-owned writer (and, for KDL and Hjson, a preserve-edit path that
  keeps the form) to match what the YAML library does by default.
- It does not test RON or SDLang.
- It does not test human editing. The damage cases above are scripted text edits, not
  observed people.
- Adjacent-line conflicts remain in every form; this research does not remove them.

## Reproduce

```sh
node tools/research/native-data-notations/shared/scripts.mjs \
  --astra-tools <astra worktree>/tools/research/native-data-notations/astra \
  --astra-libs  <astra scratch>/node_modules \
  --opus-tools  <opus worktree>/tools/research/native-data-notations/opus \
  --opus-libs   <opus scratch> \
  --work <scratch>/scripts-work --out <scratch>/scripts.json
```

Two runs from different scratch directories produced identical output.

## Key source files

- [`scripts.mjs`](../../../../tools/research/native-data-notations/shared/scripts.mjs), [`construction.mjs`](../../../../tools/research/native-data-notations/shared/construction.mjs).
- [Shared comparison](README.md), [integrated report](../README.md).
- Astra's earlier native-spelling check: [`strings.mjs`](../../../../tools/research/native-data-notations/astra/strings.mjs).
