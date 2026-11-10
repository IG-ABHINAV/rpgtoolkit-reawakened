# Text-only editing: exercised tasks and a walkthrough

This is an **agent-performed text-edit rehearsal**, not a timed study with ordinary creators. No graphical game editor was used. Data was opened as text, changed literally, parsed and checked. The tool scripts do not run RPGCode.

Two useful surfaces are retained:

1. **Real Caoquest/demo material**, locally, with full inherited conditions and references. This establishes more than attractive toy syntax.
2. **A wholly authored small example**, tracked, so another person can read and edit it without recovering game files first. It illustrates the proposed model, not an adopted native schema.

## What was actually exercised

| Task | Actual material/action | Observed result |
|---|---|---|
| Change a property by literal text replacement | Real Caoquest actor name; real demo actor label in the extra rehearsal | All ten data notations parsed to the intended values; raw property diff is two changed lines |
| Edit through the chosen library path | Same common actor property | All ten produced the intended value; preservation differs substantially—see [candidate evidence](candidates.md) |
| Add a placement without reserializing the document | Copy the first real Caoquest placement's literal text block, change its ID and x coordinate, insert it after the original | All ten: six → seven placements, same actor reference, x 208 → 240, exact expected parsed semantics |
| Follow/break an actor reference | New placement points to `actor:item/cao2.itm`; then deliberately replace it with `actor:missing` | Existing actor resolved; broken reference detected for `placement-hand-added` in all ten |
| Edit actual inline RPGCode text | Real demo trigger: literal `send(` → `send( ` in encoded source text | All ten extracted exactly the intended source text; no execution attempted |
| Move inline source to external text | Decode actual demo source, write `.prg`, change binding mode/reference while retaining other binding values | All ten retained the extracted normalized text and binding metadata; separate authored binding also retained explicit ID/context |
| Keep an absent plugin's authored content | `actor.extensions["@missing/story"]` with nested arrays/null/objects | Parse/edit/no-op paths retained it; marked unvalidated, not authorized |
| Reject a core error and a plugin error | Negative scene width; nonnumeric patrol radius; wrong installed plugin schema version | Core and plugin validation failed separately; unknown plugin content was not misrepresented as validated |
| Author multiline source in native syntax | Authored source with quotes, backslashes, newline and a literal text edit | All ten retained exact LF text and trailing newline in the specific spellings below |

The actual block-copy files are under `SCRATCH/text-rehearsal/FORMAT/`: `before`, `after`, `broken`, and `add-placement.diff`. Their machine results are [tracked](data/text-rehearsal-results.json). This operation changes raw text, **not** “decode, mutate object, serialize” disguised as manual editing. The only edits inside the copied block are its placement ID and coordinate. The inherited source binding fields still describe unresolved legacy context where the runtime semantics were not established.

A short excerpt of the actual YAML addition (the complete copied block includes hooks and legacy conditions):

```diff
+    - id: placement-hand-added
+      actor: actor:item/cao2.itm
+      x: 240
+      y: 287
+      layer: 1
```

The copied real block occupies 25 lines in YAML, 38 in TOML, 33 in Hjson, and 30 in each other tested mapping. This is **not a usability score**: most of that block is inherited condition/hook material, and an alternative domain-specific mapping would change the numbers.

## A small walkthrough someone else can perform

Use any text editor, terminal or IDE. No game-editor installation is required. The commands assume the research dependencies and schemas described in [reproduction](reproduce.md) are already present.

```sh
ROOT=/private/tmp/tkr-1778-astra
SCRATCH=/private/tmp/tkr-1778-astra-experiments
TOOL="$ROOT/tools/research/native-data-notations/astra"
cp "$ROOT/docs/findings/native-data-notations/astra/examples/keeper.yaml" "$SCRATCH/keeper-edit.yaml"
node "$TOOL/inspect.mjs" "$SCRATCH" YAML "$SCRATCH/keeper-edit.yaml"
```

This is a **combined illustration** for convenient reading; real game projections are split into scene/actor/presentation/clip/inventory/party-member/program documents. The CLI accepts the comparison fixture shape, not every standalone projected document kind. Do not pass a standalone scene to this fixture validator and mistake its missing-actor errors for a scene-format requirement.

### 1. Find an actor and change its display name

Search for `id: actor:keeper`; change `name: Keeper` to `name: Night keeper`. Do not change the ID. All three placements continue referring to `actor:keeper`; appearance and party/inventory definitions are not duplicated.

In a split project, search the text files for the exact ID. For example, a real demo placement's `actor:item/man.itm` resolves to `actor/actor-item-man-itm.yaml` in the YAML projection. An index can make that navigation nicer later, but it is not required to inspect the files now.

Run the CLI again. It parses the notation, checks the demonstrated core subset and installed plugin schema, and resolves the fixture's known actor references. It does **not** certify every RPGCode reference, every media asset, or runtime safety.

### 2. Add one more occurrence, not another actor definition

Under `scene.placements`, copy the complete four-line `placement:east` entry. Give the copy a unique ID and a new position, for example:

```yaml
    - id: placement:north
      actor: actor:keeper
      x: 64
      y: 16
```

The new occurrence shares the actor and presentation. Nothing requires copying the actor's skill-performance or inventory capability into the placement. The existing clip's ordered frame list is independent.

For the actual, larger rehearsal inspect:

```sh
node "$TOOL/inspect.mjs" "$SCRATCH" YAML "$SCRATCH/text-rehearsal/YAML/after.yaml"
node "$TOOL/inspect.mjs" "$SCRATCH" YAML "$SCRATCH/text-rehearsal/YAML/broken.yaml"
```

The second is intentionally a failing case: the actor ID `actor:missing` is not in the known catalogue. It should exit nonzero. The error belongs to reference resolution, not a claim that JSON Schema alone proves cross-file existence. The complete project-wide catalogue, dynamic program dependencies and media resolution are outside this miniature validator.

### 3. Read and edit source without losing its owning binding

Find `trigger:welcome`. Its binding explicitly records:

```yaml
mode: inline
bindingId: hook:welcome
context: placement-interaction
program: null
source: |
  mwin("Welcome, traveller");
  // path: C:\games\demo; café
```

Change the greeting directly. This is ordinary source text inside a YAML literal block. On extraction, write the block's text to a `.prg` file, retain `bindingId` and `context`, set `mode: file`, set the program reference and set `source: null`. The repository example already includes a second external binding and an authored [`leave.prg`](examples/leave.prg).

The observed real-demo counterparts are under `SCRATCH/extra/YAML/`: `before.yaml`, `script-edited.yaml`, `scene-trigger.prg` and `external.yaml`. All ten formats have counterparts. Their source comparisons use declared **CRLF/CR → LF normalization**. Original recovered-byte hashes remain untouched in provenance.

This demonstrates content and metadata preservation, **not VM equivalence**. It does not prove identical `Self`, argument stacks, save/resume state or execution context. The real legacy-context label is deliberately not promoted to a fully specified new runtime contract. The owner and runtime specification must define that contract before adoption.

### 4. Distinguish a core field from plugin-owned data

`scene.width` and a placement's coordinates are core. The patrol radius belongs to:

```yaml
actor:
  extensions:
    "@example/patrol":
      schemaVersion: 1
      radius: 6
```

The example plugin's own schema permits a nonnegative integer radius. Changing it to `-1` or a string should fail that schema. Changing `schemaVersion` to 2 does not automatically run version-1 rules as if compatible. The tested version-mismatch path reports an error and keeps the content.

The sibling `@missing/story` namespace is intentionally unavailable. Its nested content must survive a save, but the CLI reports it as **unvalidated**. “Preserved” is not “safe to execute,” and disabling a plugin does not transfer ownership of its data to core. This experiment never executes a plugin or grants a capability.

### 5. Examine a diff and a conflict

Each candidate has real `git merge-file` inputs/outputs under `SCRATCH/results/FORMAT/`. The corrected **120-case** matrix has 30 exact-intent clean merges, 72 textual conflicts and **18 false-clean duplicate-ID merges**, all rejected by the application identity checks. The original 100-case zero-observed-false-clean statement did not cover these same-ID additions. See [correction evidence](review-corrections.md).

Do not blindly accept both sides of an ordered-frame conflict. Stable frame IDs help identify the affected content, but order changes are still semantic. A post-merge parser, core/plugin schemas and reference checks are required; Git markers or syntax validity alone are insufficient.

For an actual clean-but-invalid YAML result, run `node "$TOOL/inspect.mjs" "$SCRATCH" YAML "$SCRATCH/results/YAML/same-id-placement-disjoint.merged"`. Git returned zero, but inspection exits 1 with a `uniqueIdentity` error and both occurrence paths. `schemaValid: true` is not sufficient: `coreValid` is false. The corresponding `same-id-frame-disjoint.merged` demonstrates the same problem for frames. The checker also now rejects a stale `/designExample/performance/actor` reference, not only placement references.

## Native multiline authoring is not the same as emitter output

The conservative common encoders often choose quoted escaped strings. That is an implementation choice, not a blanket limitation of the notations. [`strings.mjs`](../../../../tools/research/native-data-notations/astra/strings.mjs) separately supplied **handwritten syntax-specific source spellings**, parsed them, changed `Hello` to `Welcome` literally and compared text including its trailing LF. All ten passed these particular examples; [exact input text and results](data/native-string-results.json) are preserved.

| Notation | Exercised handwritten source form | Relevant friction |
|---|---|---|
| JSON | Quoted string with `\n`, escaped quotes/backslashes | No native multiline literal; textual source is less directly readable |
| YAML | `source: |` block | Indentation and final-newline/chomping rules matter |
| KDL | Raw multiline `#""" … """#` string | Delimiter level and dedent rules; common encoder did not automatically choose this spelling |
| TOML | Triple-single-quoted multiline literal | Readable source, but null/mixed-value mapping costs remain elsewhere |
| JSON5 | Quoted string with explicit `\n` | A line continuation removes a physical newline; it is not an implicit source newline |
| Hjson | Triple-single-quoted multiline value | Explicit LF import normalization avoids the observed lone-CR behavior; trailing newline needs deliberate spelling |
| EDN | Literal multiline quoted string | Quotes and backslashes still require escaping; malformed-input diagnostics remain a library concern |
| XML | CDATA in the mapped string element | CDATA end markers require splitting/escaping; typed wrapper verbosity remains |
| SDLang | Backtick raw string | Raw delimiter collisions need handling; scalar-number/null library limitations are independent |
| RON | `r#" … "#` raw string | Official parser/WASM handles the example; editor-preserving integration is still separate work |

These are small authored inputs, not proof that any single delimiter handles every possible program. The broader delimiter/Unicode/normalization probes are recorded separately in [extra results](data/extra-results.json). Importers must choose escaping/delimiters from content and compare normalized text; they must not silently change source beyond the declared newline policy.

## Friction observed, not a popularity verdict

- YAML gave readable block source and compact nested field editing, plus real parser source ranges. Its noncanonical no-op normalized some spacing/line endings, which is acceptable for scripts under the declared normalization policy but still a general formatting trade-off.
- KDL retained the tested noncanonical bytes and comments exactly. Its raw multiline syntax works; the tested JSON mapping and escaped default emitter are not the only possible domain surface.
- TOML's array-of-table/context structure needs more care when copying a nested occurrence. Its null sentinel is not an ordinary creator concept and is a substantial fit cost.
- Hjson retained comments but reformatted the common no-op example. Comments alone do not make an editor-preserving representation.
- EDN/RON/SDLang have useful source spellings, but the chosen parser/bridge and edit APIs matter as much as literal syntax. Silent malformed EDN-to-null and SDLang numeric behavior remain concrete issues.
- XML is inspectable and CDATA is readable; the deliberately generic mapping is much more verbose. No idiomatic XSD/domain-XML design was implemented, so its verbosity is not a universal XML lower bound.

A creator study could still reverse a preference. The research establishes runnable text-only tasks and failure evidence, not measured learning time or demonstrated accessibility for a human cohort.

## Key source files

- [Raw placement copy/add/reference rehearsal](../../../../tools/research/native-data-notations/astra/text-rehearsal.mjs)
- [Literal real-script edits, normalization and source locations](../../../../tools/research/native-data-notations/astra/extra.mjs)
- [Text-only inspection CLI](../../../../tools/research/native-data-notations/astra/inspect.mjs)
- [Authored miniature generator](../../../../tools/research/native-data-notations/astra/examples.mjs)
- [Common edit and real Git matrix](../../../../tools/research/native-data-notations/astra/run.mjs)
