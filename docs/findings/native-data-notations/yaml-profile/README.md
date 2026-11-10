# YAML authored, JSON derived: profile and walkthrough

Working direction from the owner (2026-11-08), **not an approved format**: YAML is the
read/write language people author; JSON is the read/data form for passing things
around. This page makes that concrete enough to try. Everything here is research
material: a proposed *profile*, a research schema, a checker, and a hands-on walkthrough.

- Example project: [`project/`](project/) (an actor, a scene with two placements, a tile layer with nullable slots, an external script)
- Broken cases to try: [`broken/`](broken/) (17 files)
- Schemas: [`schema.json`](schema.json) plus per-kind wrappers for editors, and a plugin schema
- Checker: [`check.mjs`](../../../../tools/research/native-data-notations/yaml-profile/check.mjs) · edit demo: [`edit-demo.mjs`](../../../../tools/research/native-data-notations/yaml-profile/edit-demo.mjs)
- Recorded output: [`results/`](results/)

## The rule

| | Role | Written by |
|---|---|---|
| YAML file | **Source of truth.** Comments, `\|-` scripts, layout | People, and the editor through a comment-preserving YAML edit |
| JSON | **Derived.** Wire/internal form, schema validation input | Generated from the YAML; **never written back** |

Why never back: JSON has no comments, no block scalars and no layout. Measured on the
example scene (one script line changed):

| Edit path | Comments kept | Lines changed |
|---|---|---|
| Edit the YAML document (`yaml` `Document` API) | 3 of 3, still a `\|-` block | **1** |
| Derive JSON, edit it, regenerate YAML | 0 of 3 | 26 of 26 |

That is the strongest practical reason to treat the YAML as primary. It holds because
the example uses the layout the writer produces (`{a: 1}` without brace padding, one
space before a trailing comment). The library normalises both, so an authored file that
uses padded braces would also change those lines on its first library-driven save.

## Proposed YAML profile (to be decided, not adopted)

A YAML file is in the profile when all of these hold. The checker enforces the rows
marked ✔; the rest need a decision.

| Rule | Why | Checker |
|---|---|---|
| YAML 1.2 core schema; one document per file | No `no`→`false`; no dates or sets | ✔ parse mode |
| String keys only; keys unique within a mapping | Maps to JSON objects; duplicates are silent last-wins elsewhere | ✔ |
| No tags (`!!str`, `!!binary`) | JSON has no equivalent | ✔ |
| No anchors or aliases | JSON has no equivalent; hides edits at a distance | ✔ |
| Scripts: a literal block with header `\|-`, or a one-line scalar | `\|` adds a trailing newline; `>` turns newlines into spaces | ✔ (`>` error, other headers warn) |
| Unquoted `yes/no/on/off` warned | YAML 1.1 readers (many tools) read them as booleans | ✔ warn |
| `null` means "none, deliberately", never "inherit" | Positional arrays need it (legacy tile slots) | schema allows `integer\|null` in tile rows |
| Absent object property = no value | Avoids `key: null` noise on objects | **not decided**: needs the absent-versus-null contract policy |
| Numbers: safe integers and finite floats only | JSON round trip | **not decided** (research used a safe-number check) |
| Layout: no brace padding, one space before comments | Keeps library saves from rewriting unrelated lines | **not decided**: a canonical-writer rule |

## Try it

From the repository root, after the research libraries are installed (see the
[integrated report](../README.md#reproduce); `--libs` points at the folder holding
`node_modules` with `yaml` and `ajv`):

```sh
Y=docs/findings/native-data-notations/yaml-profile
C=tools/research/native-data-notations/yaml-profile/check.mjs

node $C $Y/project                                  # clean: 0 errors, 1 note
node $C --root $Y/project $Y/project/actors $Y/broken/scenes/01-dedented-line-with-colon.yaml
node $C --json $Y/project/scenes/courtyard/scene.yaml   # the derived JSON
node tools/research/native-data-notations/yaml-profile/edit-demo.mjs $Y/project/scenes/courtyard/scene.yaml
```

Open `project/scenes/courtyard/scene.yaml` in your editor. Each example file has a
`# yaml-language-server: $schema=…` line. **That setup was not tested in any editor.**
Whether VS Code's YAML support shows the errors below as you type is what you would be
checking.

### The nullable tile row

```yaml
rows:           # one row per line; null means "no tile in this slot", not "inherit"
  - [1, 1, 1, 1, 1, 1, 1, 1]
  - [1, 2, 2, null, null, 2, 2, 1]
```

A native `null` in an array, one row per line, so an edit to one row is a one-line diff
and two people editing different rows merge (the row-versus-cell trade is in the shared
comparison).

### The script

```yaml
whilePresent:
  inline: |-
    mwin("Halt! Who goes there?");
    // note: the gate is closed
    if (getVar("gateOpen") = 1) then { send("hall", 32, 96, 1); }
```

Edit the code as plain text. Keep every line indented by the same amount, two deeper
than `inline`.

## What the checker said about 17 broken files

Output recorded in [`results/broken-cases.txt`](results/broken-cases.txt). "Layer" says
which check caught it: the YAML profile, the JSON Schema, or the project reference check.

| # | Mistake | Caught? | Layer | Reported at |
|---|---|---|---|---|
| 01 | Dedent one script line that contains `: ` | **yes** | schema | 11:14, `"// note"` is an unknown key |
| 02 | Dedent one script line with no colon | yes | profile | 11:5, implicit key error |
| 03 | `\|-` changed to `>-` (folded) | yes | profile | 9:15, folded block |
| 04 | Tab as indentation | yes | profile | 11:1 |
| 05 | `\|-` changed to `\|` | **warning only** | profile | 9:15; the script gains a trailing newline |
| 06 | Anchor and alias | yes | profile | 9:21 and 11:15 |
| 07 | Explicit `!!str` tag | yes | profile | 9:21 |
| 08 | Duplicate key | yes | profile | 10:7 |
| 09 | `program:` names a missing file | yes | reference | 9:16 |
| 10 | Both `inline` and `program` | yes | schema | 9:7 |
| 11 | Placement names an unknown actor | yes | reference | 6:12 |
| 12 | Duplicate placement id | yes | reference | 8:9 |
| 13 | Unquoted `yes` as an id | **warning only** | profile | 5:9 |
| 14 | Position `"96"` instead of `96` | yes | schema | 7:14 |
| 15 | Plugin value out of range (`intensity: 3`) | yes | schema | 7:16 |
| 16 | Plugin `version: 2`, schema is v1 | yes | schema | 6:14 |
| 17 | Tile slot `none` instead of `null` | yes | schema | 7:13 |

Notes that matter:

- **Case 01 is the silent failure found earlier**, where a dedented line containing `: `
  ends the script and becomes a stray key. With `additionalProperties: false` on the
  hook object, the schema reports it with a line and column. This is the mitigation I
  had listed as untried; it works **in this checker**. It depends on the schema being
  strict, and a plugin object that allowed extra keys would not catch it.
- **Cases 05 and 13 are warnings**, which return exit status 0. Whether they should
  fail is a policy choice for you.
- **Nothing here catches a script that is wrong but well-formed.** A typo in the
  RPGCode is invisible to YAML, the schema and the references. RPGCode checking is the
  script tools' job, not this layer's.
- A missing plugin schema is a **note** (`content preserved, not validated, not
  executable`), not an error, and a version mismatch is an error. Unknown nested content
  survives in both.
- Reference checking is **my code, not the schema**: JSON Schema cannot resolve
  `actor: gatekeeper` or test that a file exists.

## What this does not establish

- **No editor was involved.** The schema modelines and the editor's behaviour are
  untested. This is the part only you can answer.
- **No human has done the tasks.** I ran the checker; I did not observe someone editing.
- **No approved schema.** `schema.json` is a research schema shaped to the examples.
- **The profile is a proposal.** Three rules are undecided; see the table.
- **Library-driven edits normalise a little layout** (brace padding, comment spacing).
  The "1 line changed" result depends on authoring to that layout, and it covered a
  scalar block edit only, not inserting or reordering placements through the library.
- **Node 26.13.0**, not the pinned 24.21.0.

## Walkthrough for you

1. Open `project/scenes/courtyard/scene.yaml`. Find the actor for the first placement
   (`actor: gatekeeper`) and open its file. Is the core-versus-plugin split clear in
   `actors/gatekeeper.yaml`?
2. Change the first script line. Run the checker. Then deliberately dedent one line that
   has a `:` in it and run it again: do you see the problem before the checker tells you?
3. Add a third placement by copying the second. Run the checker. Break the actor name.
4. Put `null` slots in a tile row and add a row. Check the diff in your editor.
5. Open [`broken/`](broken/) files in your editor and note which mistakes it underlines
   before running anything. That comparison is the evidence the research could not
   produce.
