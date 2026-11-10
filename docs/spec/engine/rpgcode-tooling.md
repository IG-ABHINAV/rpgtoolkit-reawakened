# RPGCode tooling: language server, linter, formatter, spec API and command line

This page is the contract for the tooling that reads RPGCode without running it: the language server, the linter, the formatter, the spec (test) API, the machine-readable index, the debug view and the `tkr script` front end. Every rule here was **approved by the owner on 2026-10-31** and is implemented by epic 10.

The language the tools read is in [rpgcode-language.md](rpgcode-language.md); its built-ins are in [rpgcode-functions.md](rpgcode-functions.md); the runtime failures a diagnostic mirrors are in [rpgcode-errors-and-threads.md](rpgcode-errors-and-threads.md). Nothing here changes what a program does at run time: a tool may report, rewrite or explain, and the engine's behaviour is the same before and after.

<a id="tool-1"></a>
**TOOL-1 Packages and transport.** The language server is the package `lsp`, which exports exactly `createServer(connection)` and knows no transport. Each host supplies the connection: stdio in the desktop extension, a worker connection under `vscode-languageclient/browser` in the `vscode.dev` build, and an in-memory or `MessageChannel` pair in tests and in the standalone editor. The stdio entry point is a program binary and is not part of the package's public export, so importing the package can never open a pipe.

The libraries the server is built on are `vscode-languageserver`, `vscode-languageserver-protocol`, `vscode-languageserver-textdocument` and, on the host side of the early extension, `vscode-languageclient`; with their transitive `vscode-jsonrpc` and `vscode-languageserver-types` they are the complete addition to the production dependency tree of the shipped artefacts. All are MIT and acceptable under [G6](../../guardrails.md). Nothing else is added without a ruling recorded here.

The debug adapter is the package `dap`, which depends on `runner-harness` (the platform-neutral half of the headless runner) and never on Node; on the web it registers as a `DebugAdapterInlineImplementation`. Dependency direction is the guard-rails' `core ← synth ← runner-*/lsp/dap/editor-ui ← host-*` ([G2](../../guardrails.md)), unchanged by this page.

<!-- OWNER: D-1, approved 2026-10-31. Rejected: hand-rolled JSON-RPC framing — about 200 lines owned for ever, drifting on cancellation, progress and workspace/configuration, while the browser client is an official dependency anyway. -->

<a id="tool-2"></a>
**TOOL-2 The early extension.** Until the editor exists, the language server ships in its own extension, `extensions/rpgcode/`: a thin language client over `lsp` with its own extension id, built to a VSIX in CI and published to the Visual Studio Marketplace and to Open VSX (`ovsx` is the repository's named dev-tool licence exception in [G6](../../guardrails.md)). It registers `.prg` and `.rnc` and contributes no editor feature of its own; the `contributes.languages` block is one file shared with any later host, so the two registrations cannot diverge. When the editor host exists it either takes this client over or supersedes the extension, and that decision belongs to the editor epic.

<!-- OWNER: D-2, approved 2026-10-31. Rejected: folding the client into the editor's VS Code host now — that host does not exist, its epic waits on this one, and folding would make the extension requirement circular. -->

<a id="tool-3"></a>
**TOOL-3 One diagnostic model.** One diagnostic shape serves the parser, the linter, the language server, the CLI and CI:

| Field | Meaning |
|---|---|
| `code` | the stable failure or rule code, lower-case with dots for a failure (`syntax.error`) or `<area>/<rule>` for a lint rule (`lint/unused-variable`) |
| `severity` | `error`, `warning`, `info` or `hint` |
| `range` | start and end position in the source, in **UTF-16 code units of the decoded source** — lines 1-based, columns 1-based inclusive — so a range slices the text exactly ([TOOL-3 range convention](#tool-3-range-convention)) |
| `message` | one sentence a game author can act on |
| `rule` | the lint rule id when a rule raised it, absent for a parser diagnostic |
| `fix` | optional: one or more text edits over ranges, each with the rule that produced it |

A diagnostic from the engine's own run is the same object with its `pos` mapped to a range, so a script error seen in the editor and one seen in CI are the same shape. The range is exact: a diagnostic about a token starts at that token's first character and ends after its last.

Lint rules carry a stable id of the form `<area>/<rule>`, a default severity, a one-line rationale and, where a rewrite is safe, an autofix. A project configures them in one file per project — per-rule severity and an ignore list — and a project that configures nothing gets the defaults. A rule is never silently suppressed: `check` reports the count of disabled rules and ignored ranges in its summary.

<!-- OWNER: D-3, approved 2026-10-31. Rejected: a linter-only diagnostic type — the premise of this page is that one model feeds the server, the CLI and CI; two shapes would need a translation layer whose only job is to lose the rule id. -->

<a id="tool-3-range-convention"></a>
**TOOL-3 range convention.** A range is a `start` and an `end` position. A position is a `line` and a `column`, both **1-based**, and `end` is **inclusive**: it names the last code unit of the range, so an empty range has `end` equal to `start`. A column counts **UTF-16 code units of the decoded source**, never bytes or code points. That single choice is what lets a consumer slice the text exactly: for a range on one line, `source.split("\n")[line - 1].slice(start.column - 1, end.column)` is exactly the text the diagnostic is about.

Three consequences the tooling relies on:

- A Windows-1252 byte is one code unit, so it advances a column by one; a supplementary-plane character is a surrogate pair, so it advances a column by two. Byte offsets and code-point offsets both disagree with this, which is why neither is used.
- The CR of a CRLF pair is not counted: it precedes the line break, so the first code unit of the next line is column 1.
- A token never spans a line. A zero-width token — the `end` marker of a statement on a newline, or end of file — has `end.column === start.column`, which is a valid position, not an empty one to be special-cased. A composite syntax node anchors on the token its `line` came from, so its own range is one token's range.

The tokens the lexer emits carry exactly this range (`col` and `endCol` on `Token`, `packages/core/src/script/lex.ts`), and `packages/core/test/script-lex-spans.test.ts` proves it on tabs, CRLF, a Windows-1252 byte, an astral character and slicing.

<!-- OWNER: D-3, approved 2026-10-31 (the range convention fixed in 10.3 after the lexer showed "decoded characters" was ambiguous). Rejected: byte offsets — they would disagree with the editor's and the LSP's positions at every non-ASCII character; and code-point offsets — they would split a surrogate pair and make slicing throw one code unit short. -->

<a id="tool-4"></a>
**TOOL-4 Formatting.** The formatter is a source-text rewrite with exactly two jobs: re-indent by brace depth, with a configurable indent width (default four spaces), and normalise built-in names, keywords and the reserved literals to their canonical lower-case spelling. It leaves string contents, map keys written as strings, comments and label spelling alone.

It is a **3.1 source formatter**. A Toolkit 2.x file is a different dialect, and in it a loose text line with no `#` is **dialogue data**, not code: rewriting it would change what a game says. The formatter therefore refuses a file it is told is TK2 — it returns the text byte-identical with the reason `tk2-dialect`, and `--check` counts that file as **skipped with its reason, never as clean**, so a bulk run cannot claim a file was formatted when it was not. Converting TK2 text is the dialect quick fixes' job (§T-42's neighbours), not the formatter's; a TK2 formatter is not planned.

It is **idempotent** — formatting formatted text is a no-op — and **behaviour-preserving** — a run before and after formatting gives the same lowering. (The state hash includes each program's source hash under [R-42](rpgcode-modules-and-objects.md#redirects), so a text-only edit normally moves that hash even when the instructions are identical; the spec's promise is the instructions.) It never reorders statements, drops a comment, joins a continued line, or adds a final newline that the file did not have. A file whose last line has no newline keeps it that way ([PRG-2](rpgcode-language.md#programs-and-encodings)).

<!-- OWNER: D-4, approved 2026-10-31. Rejected: an AST-printing formatter (parse, then print) — the parser discards whitespace and comments irrecoverably, so a printer would delete comments, the one thing the legacy indent and cleanup wizards never did. -->

<a id="tool-5"></a>
**TOOL-5 The spec API.** RPGCode programs can be tested in RPGCode. The API is a package, not a set of engine built-ins: `script-spec` ships a library program and one native command, `specResult`, which records a result and the source position the VM already knows. The package defines the names below; a program that wants them includes or loads the package, and a shipped game never does.

| Name | Shape | Meaning |
|---|---|---|
| `describe(name, body)` | nestable | a group of cases |
| `it(name, body)` / `test(name, body)` | `body` is a callable called with no arguments | one case |
| `beforeEach` / `afterEach` / `beforeAll` / `afterAll` | `body` callable | hooks around the cases in the enclosing `describe` |
| `expect(actual)` | returns a matcher object | assertions listed below |
| `expect(actual).not` | the negation of every matcher | |
| `toBe`, `toEqual`, `toBeTruthy`, `toBeNull`, `toContain`, `toBeCloseTo`, `toThrow` | chained on the matcher object | see below |
| `skip` / `only` | prefix a case or a `describe` | run control |

`toBe` compares strictly, `toEqual` compares by value (numbers, strings and arrays element-wise), `toBeTruthy` applies the engine's own truth test ([R-39](rpgcode-language.md#compatibility-notes)), `toBeNull` passes for the unset value, `toContain` searches a string or an array, `toBeCloseTo` takes an optional tolerance and `toThrow` takes a callable and passes when it raises a runtime error. A failure message shows expected against actual and the source line of the failing assertion.

The runner discovers `*.spec.prg`, runs each case on a fresh fixture (board, party and variables) under the injected clock and the seeded RNG, so two runs of the same spec file give identical results and identical state hashes. A skipped case fails the strict run; `only` narrows the run to the marked cases and warns that it did. The package is loadable only by the test runner: it must not appear in the engine's default manifest, and a test asserts that it does not.

The commands this page adds to the catalogue are listed in [rpgcode-functions.md](rpgcode-functions.md#reawakened-additions-not-part-of-the-282-legacy-catalogue) (`specResult` and the package's public names).

<!-- OWNER: D-5, approved 2026-10-31. Rejected: about twenty native built-ins — each would need a spec row and a catalogue entry, `it` could not call its lambda without a new VM capability, and every shipped game's catalogue would carry test commands. -->

<a id="tool-5-creator-tests"></a>
**Reawakened rule (accepted by the owner, 2026-11-09; entry 11.1, [ADR 0022](../../adr/0022-shared-editor-authoring-contracts.md) D9; creator tests).** In plain terms: a creator can write a short test in an ordinary `*.spec.prg` file that sets up a tiny scene, makes the player walk or interact, waits a bounded time for something to happen, and checks the result. It runs the real game engine, not a pretend one, and the result points at the failing line. Technically, this extends TOOL-5; it adds no second runner, no new file type and no wall-clock waiting.

1. **One framework.** Creator tests are TOOL-5 specs. `describe`, `it`, hooks and matchers keep their meaning above. The additions below are provided by the same `script-spec` package and, like it, never appear in a game's default manifest.
2. **Fixture.** A case starts from a fresh simulation: board, party, variables, seeded RNG and provider state all reset, so a case cannot see another's changes. A fixture names **one authored board** from the project (a small purpose-built board, not the whole game) and the player's starting position and facing, and may set stats, inventory and variables. Collision, triggers and programs on that board run as the engine runs them; **nothing is substituted by a mock**. A fixture never loads files the case did not name.
3. **Actions.** An action list is an ordered list of player **actions** — the engine vocabulary of [ADR 0017](../../adr/0017-input-actions-devices-and-accessibility.md), `up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu` and any `game.*` action the project registers, never a physical key or button: a movement action held for a stated number of ticks, an interact (`confirm`) press, a menu or item choice. Each action is applied to the simulation at a tick, in order; a later action starts only after the previous one's ticks have elapsed. Naming actions rather than keys is what lets a test survive a changed `.gam` binding or a player's remap. The driver keeps advancing the simulation while a program waits (G1: programs stay step machines; the driver never blocks on them).
4. **Waiting.** A wait names a condition over observable state (a variable, a position, a board, an inventory entry) and a **maximum number of ticks**. It passes when the condition holds at a tick no later than the maximum and fails with `spec.timeout` otherwise, naming the condition, the tick budget and the last observed value. There is no real-time sleep and no unbounded wait; the existing 1,000-tick safety limit remains the ceiling.
5. **Assertions.** Assertions read state and events the engine already exposes (variables, actor position, current board, inventory, emitted effects such as `specresult`). A new projection is added only by editing this page first.
6. **Reports.** A failure shows expected against actual, the source line, the **last completed action**, the tick it completed on and the fixture's board file, plus a link to the owning program. Results carry the run snapshot of [ADR 0022 D8](../../adr/0022-shared-editor-authoring-contracts.md#d8--launches-and-run-snapshots) so a result names the revisions it ran against.
7. **Determinism.** The same fixture, actions and seed give the same tick-by-tick state and the same state hash on every runner, headless or visible.
8. **Exclusion.** Spec files, fixtures and the `script-spec` helpers are **not** shipped. Packaging excludes them, and acceptance inspects the produced package for them; a check that only reads the default manifest is not sufficient. The exclusion is written into the package rules (`docs/spec/formats/packaging-and-paths.md`, whose "Not included" row today names only `Saved\` and other projects' mains) and proved by the packaging workflow in **12.9**, together with the editor's reserved history folder ([ADR 0022](../../adr/0022-shared-editor-authoring-contracts.md) D12.7).
9. **Spellings.** The RPGCode names and argument shapes of the fixture, action and wait operations are **not fixed on this page yet**. Entry 11.9 proposes them in the function catalogue, with a help line for each in the plain-then-technical form this project uses, and the owner approves them in a docs-only commit before any implementation. Entry 14.1 separately rules how a visual fixture editor represents the same definition.

**Evidence.** TOOL-5 above (discovery, fresh fixture, injected clock, seeded RNG); `docs/spec/formats/rpgcode-program.md#test-runs-from-the-editor` (the 3.1 editor's test run); the owner direction in `_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/connected-authoring-and-tests.md`; the 2026-11-08 audit of `packages/script-spec`, which found a hard-coded 1×1 synthetic board, no input driver, a fixed 1,000-tick limit and a `node:fs` dependency (`packages/script-spec/src/runner.ts:125-179`, `src/project.ts:1-5`).

**Open dependency (not decided here).** Entry 10.8's matcher ruling "F-A" is still awaiting an owner yes/no (`_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-tooling/story-rpgcode-spec-framework-the-describe-it-expect-pack-its-runne-plan.md`): element-wise `toEqual`, array `toContain` and `toThrow` cannot be implemented by a library program alone, and its recommended option is a closed, test-only set of native commands beside `specResult`. If that is approved, the sentence above that the package ships "one native command" is widened to that closed set; the fixture, action and wait operations of this rule would use the same set. Nothing in this rule depends on the outcome until 11.9 implements it.

**Rejected alternative.** A separate editor-only test runner or a Playwright-style browser driver for game behaviour: it would duplicate the engine's rules and could pass where the real game fails. Playwright remains fine for testing the editor itself.

<a id="tool-6"></a>
**TOOL-6 Machine-readable index.** `tkr script index` writes one JSON document describing the programs it was given:

| Field | Contents |
|---|---|
| `schema` | `tkr-index/<major>.<minor>` |
| `programs` | per program: its reference, its functions (name as written, folded name, arity, line), classes with bases, members and methods, labels, the include edges it resolved (explicit and implicit, in order), the files it reached, its call and reference sites (name, arity, position), its literal event-listener names and its package start-up entry points |
| `diagnostics` | the [TOOL-3](#tool-3) diagnostics, so a program that did not compile is reported and given no invented facts |

**Stability promise.** Adding an optional field, or adding a value to an enumerated field, is a minor change; removing a field, retyping it, renaming it, or changing the meaning of an existing field is a major change. A consumer may rely on every field above; it may not rely on the order of members inside an object, on whitespace, or on fields not listed here.

<a id="tool-6-identity"></a>
**TOOL-6 symbol identity and the document's fields.** Every symbol has one stable id, `<file>#<kind>:<name>`, where `<file>` is the unit's canonical key (an inline program uses `<inline>`), `<kind>` is `function`, `method`, `member`, `class` or `label`, and `<name>` is the **folded** spelling. RPGCode folds identifiers ([LEX-10](rpgcode-language.md#lexical-rules)), so `MWin`, `mwin` and `MWIN` are one symbol; the folded spelling is its identity and the only spelling the compiler's tables hold. A class member or method qualifies with its owner: `prg/startup.prg#method:counter.bump`. Each definition also carries `qualifiedName`, the dotted name a reader recognises (`counter.bump`), which is not an identity because two files can define the same dotted name.

A **site** — a call, a member access, a variable read or write, a declaration — is `{ kind, name, written, scope, pos }`. `written` is the exact source spelling, present whenever the compiler's position is the identifier token: the site's range slices the text, so `written` is that slice. It is absent when the position is a keyword, because [TOOL-3](#tool-3-range-convention) anchors a function on `function` and a label on `:`.

Per program the document carries:

| Field | Contents |
|---|---|
| `name`, `key`, `files` | the caller's name for the program, its main unit's canonical key, and every unit key in load order (main first) |
| `functions` | `{ id, qualifiedName, name, arity, file, line, col, endCol, className }` per definition, from the compiler's own function table and the parsed unit |
| `classes` | `{ id, qualifiedName, name, file, line, col, endCol, bases, members, methods }`, members with `access` and `arraySize`, methods with `arity`, `access` and `isPure` |
| `labels` | `{ id, name, file, line, col, endCol }` |
| `includes` | one entry per `IncludeRequest` in source order: `{ path, implicit, key, file, line, col, endCol }`, where `key` is the resolved canonical key or absent when nothing served it |
| `calls` | `{ name, written, arity, file, fileParam, pos }` per `call`, `methodCall` and `construct` |
| `references` | `{ kind, name, written, scope, pos }` per `load`, `declRef`, `member`, `get_member_bound` and `storeRef`; a `storeRef` carries no name because the IR keeps the target on the stack, and its `kind` says so |
| `listeners` | `{ event, call, pos }` for every literal first argument of `on`, `once` and `emit` |
| `startup` | the package names whose start-up program this program is |
| `diagnostics` | the [TOOL-3](#tool-3) diagnostics of that program |

**Broken programs.** A program that does not compile contributes its diagnostic and an otherwise empty entry — no functions, classes, labels, includes, calls, references, listeners or start-up points are invented from a partial parse. The absence is the fact, and a consumer must not read "not listed" as "does not exist".

The index is **read from the compiler, not a second walk**: definitions come from `Program.functions`/`classes`/`labels` and the parsed units, sites from the lowered ops at their `SourcePos`, and the include requests from the units the compiler parsed. The schema is [schemas/tkr-script-index.schema.json](../schemas/tkr-script-index.schema.json); the same inputs produce the same bytes, so a diff means the source changed.

The document is the whole surface this epic publishes for other tools. Writing it into a code graph, or serving it over a protocol, is not this page's contract: the syntactic graph a code-graph tool builds from its own grammar is separate work, and the two must not be confused — this index is the compiler's own semantic view, that graph is a syntax view ([ADR 0011](../../adr/0011-tree-sitter-rpgcode.md)).

<!-- OWNER: D-6, approved 2026-10-31. Rejected: every tool reading the compiler in process — that is what the server, the linter and the CLI would each do, and it is why the index has one owner; and emitting grammar or graph nodes here would duplicate the independent extractor and tempt the grammar work to use parser output, which ADR 0011 forbids. -->

<a id="tool-7"></a>
**TOOL-7 Dogfooding in CI.** This repository runs its own tools on its own RPGCode. The tool job executes, in this order: build, then `tkr script check` over `stock/` and the authored fixtures, then `tkr script fmt --check` over the same set, then `tkr script test` over the packages' own spec files — each comparing against the committed baselines and failing with the file and the rule or case named. The baselines are committed and reviewed like goldens ([G5](../../guardrails.md)).

Until a change classifier exists in the pipeline, the job runs unconditionally and is part of the required `gate`. When the classifier lands, the job's only change is its condition: it gains a dependency on the classifier and an `if:` that runs it only when RPGCode files changed, with the gate taught that an intended skip is a pass. Its steps and its baselines do not change.

<!-- OWNER: D-7, approved 2026-10-31. Rejected: making the CI classifier a prerequisite of the tooling — it would block the dogfooding requirement on unrelated pipeline work that no epic of this initiative owns. -->

<a id="tool-8"></a>
**TOOL-8 The read-only debug view.** The engine exposes one projection for debuggers, `debugView()`, returning plain data:

| Field | Contents |
|---|---|
| `tick` | the tick the view was taken in |
| `threads` | per thread: `id`, `kind`, `status`, the wait it is parked on (kind and remaining ticks) and its frames |
| `frames` | outermost to innermost: the program reference, the instruction pointer, the source line and the function name |
| `locals` | the innermost frame's variables as name/value pairs |
| `globals` | the global table as name/value pairs |

The view is **copied out, never aliased to the live frames or tables**: mutating anything it returns cannot change the VM, and a call leaves the state hash unchanged. It is the only seam a debug adapter reads. Step over, step in and step out are computed by the adapter from the frame depth it sees between one-instruction resumes ([THR-3](rpgcode-errors-and-threads.md#thr-3)), so the engine gains no new stepping mode beyond the breakpoint contract in [AD-1](../../../_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md).

<!-- OWNER: D-8, approved 2026-10-31. Rejected: exposing the whole game state from the engine — it would let a debugger read and, through a shared reference, mutate the versioned state, and it couples the debugger to every section's shape rather than to one projection. -->

<a id="tool-9"></a>
**TOOL-9 The command-line front end.** The tool is one binary, `tkr`, and RPGCode tooling is its `script` group: `tkr script check`, `fmt`, `test`, `docs` and `index`. Later groups (`tkr run`, `tkr pack`) may follow without renaming anything.

| Subcommand | Reads | Writes |
|---|---|---|
| `check` | `.prg`/`.rnc` sources and the project config | nothing |
| `fmt` | the sources it is given | the sources, unless `--check` is passed |
| `test` | the project's `*.spec.prg` files | a report file only when one is asked for |
| `docs` | the catalogue and `docs/spec` | the generated quick reference and language reference, to a path or stdout |
| `index` | the programs it is given | the [TOOL-6](#tool-6) document, to a path or stdout |

Every subcommand accepts `--json`. With it, the envelope below goes to stdout and human-readable progress to stderr, in both success and failure.

**Exit codes.** Stable and public once published; a code is never reused for a different meaning.

| Code | Meaning | `check` | `fmt` | `test` | `docs` | `index` |
|---|---|---|---|---|---|---|
| `0` | nothing to report | no diagnostic at the failure severity | nothing would change (with `--check`) | every case passed, or was skipped outside strict mode | the committed reference matches | the document was written |
| `1` | findings in the project | a diagnostic at the failure severity | at least one file would change | at least one failing case, or a skip under strict mode | the generated reference differs from the committed one | — |
| `2` | usage or configuration error | unknown subcommand, bad argument, missing path, unreadable or invalid project config — nothing is written | the same | the same | the same | the same |
| `3` | internal error | the tool itself failed unexpectedly — never for a program's content | the same | the same | the same | the same |

**The JSON envelope.** One shape for every subcommand and both outcomes:

```json
{
  "schema": "tkr-script-result/1",
  "tool": "tkr",
  "subcommand": "check",
  "status": "findings",
  "exitCode": 1,
  "diagnostics": [],
  "summary": { "files": 0, "diagnostics": { "error": 0, "warning": 0, "info": 0, "hint": 0 }, "changed": 0, "passed": 0, "failed": 0, "skipped": 0 },
  "results": {}
}
```

`status` is `ok`, `findings` or `error` and agrees with `exitCode`. `diagnostics` carries [TOOL-3](#tool-3) objects themselves — the same objects the language server publishes, so a CI job and an editor see one shape. `results` holds the subcommand's own payload: the changed paths for `fmt`, the cases with expected and actual for `test`, the written path or a drift list for `docs`, and the [TOOL-6](#tool-6) document for `index`. The schema is [schemas/tkr-script-result.schema.json](../schemas/tkr-script-result.schema.json); a test validates every subcommand's `--json` output against it.

**Stability promise.** Adding an optional field or an enumerated value is a minor change; removing, retyping or renaming a field, or adding or repurposing an exit code, is a major one.

<!-- OWNER: D-9, approved 2026-10-31. Rejected: one non-zero code for everything — a CI job or a wrapper could then not tell "your script has a warning" from "your config is broken" from "the tool crashed", which is the distinction --strict and --fix workflows turn on; and a per-subcommand envelope would mean two schemas to version for one contract. -->
