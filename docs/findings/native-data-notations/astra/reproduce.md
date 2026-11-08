# Reproduce the independent experiments

Author/model: **AstraNotations / openai-codex/gpt-6-astra**. Baseline: `20e0209d`. This page describes research experiments, not production installation or a validated end-to-end clean-clone installer.

## Environment and prerequisites

Observed host: Apple M1 Pro, macOS 27.2 arm64; Node 26.13.0, Python 3.15.2, Git 2.55.0, Rust 1.93.0, Java 27.0.1.0.3, Microsoft Edge 157.0.4341.42. The repository-pinned Node 24.21.0 was **not** exercised. Pkl's own banner reports a different macOS version; the host version above comes from `sw_vers`, not an assumption about that banner.

Required local inputs:

- This worktree, with its existing public `@tk-reawakened/core` package prebuilt/resolvable. The parent supplied that prerequisite; this worker did not run a repository build.
- `local://1778-shared-inputs.json`, copied to `SCRATCH/shared-inputs.json`, and its four original source roots/archives. It records locators, source hashes and shared cohort provenance. The scratch copy already exists for the observed run.
- Node/npm, Python, Git, Java at `/opt/homebrew/opt/openjdk/bin/java`, and Edge at `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` for the exercised macOS commands. No claim is made for a different host/browser.
- Network access only for public pinned dependency/binary downloads during setup. The games themselves are not rehosted in this findings directory.

```sh
ROOT=/private/tmp/tkr-1778-astra
SCRATCH=/private/tmp/tkr-1778-astra-experiments
TOOL="$ROOT/tools/research/native-data-notations/astra"
```

[`setup.py`](../../../../tools/research/native-data-notations/astra/setup.py) packages the setup operations used in this investigation. **The assembled wrapper has not been rerun in a fresh directory.** The dependency installation, official binary execution and Rust compilations underlying it were exercised individually. Do not describe this as a fresh-clone installation verification.

For a new isolated directory on the same platform:

```sh
python3 "$TOOL/setup.py" "$SCRATCH" --rust
export RUSTUP_HOME="$SCRATCH/rustup"
export CARGO_HOME="$SCRATCH/cargo"
export CARGO_TARGET_DIR="$SCRATCH/ron-target"
"$CARGO_HOME/bin/cargo" build --release --manifest-path "$TOOL/ron/Cargo.toml"
"$CARGO_HOME/bin/cargo" build --release --lib --target wasm32-unknown-unknown --manifest-path "$TOOL/ron/Cargo.toml"
```

Exact npm dependencies and transitive resolution are in [`dependencies.json`](../../../../tools/research/native-data-notations/astra/dependencies.json) and [`npm-lock.json`](../../../../tools/research/native-data-notations/astra/npm-lock.json). The isolated Rust bridge has its own checked-in Cargo manifest/lockfile. Official download URLs and observed SHA256s are in [`downloads.json`](../../../../tools/research/native-data-notations/astra/downloads.json). The bootstrap refuses mismatched hashes; those hashes identify observed artifacts, not independently authenticated publisher signatures.

The bridge uses official ron-rs and serde_json. Its handwritten code is transport/conversion glue, **not a replacement parser**. The WASM pointer/length ABI is experimental and not a production-hardened untrusted-input boundary. All compiler output stays under scratch.

## Actual experiment sequence

These entrypoints were run against the original local inputs. The subsequent projection/operation passes were repeated when the independent model was refined (party-member separation, declared LF normalization and actor-owned plugin examples). Earlier diagnostics are retained separately, not mixed with final counts.

```sh
python3 "$TOOL/collect.py" "$SCRATCH/shared-inputs.json" "$SCRATCH"
node "$TOOL/decode.mjs" "$SCRATCH"
python3 "$TOOL/project.py" "$SCRATCH"
python3 "$TOOL/provenance.py" "$SCRATCH"
node "$TOOL/run.mjs" "$SCRATCH"
node "$TOOL/review-corrections.mjs" "$SCRATCH"
node "$TOOL/review-replay.mjs" "$SCRATCH"
node "$TOOL/extra.mjs" "$SCRATCH"
node "$TOOL/browser.mjs" "$SCRATCH"
node "$TOOL/wasm.mjs" "$SCRATCH"
python3 "$TOOL/composition.py" "$SCRATCH"
node "$TOOL/examples.mjs" "$SCRATCH"
node "$TOOL/text-rehearsal.mjs" "$SCRATCH"
node "$TOOL/strings.mjs" "$SCRATCH"
```

Run `provenance.py` after `project.py`: it augments the field mappings with actual header versions/conversion qualifications. `collect.py` verifies hashes and opens ZIP/nested ZIP members; its delimiter handling does not split every `!` occurring in a filename. No installer is launched. `decode.mjs` calls only existing public decoders, while program payloads are decoded as text. `provenance.py` checks documented magic/version headers, not a second implementation of the full legacy formats.

`run.mjs` invokes real `git diff --no-index` and `git merge-file -p` on scratch files. It does not mutate the repository's index/branches or install a merge driver. `browser.mjs` launches real Edge via Playwright and uses a browser-targeted bundle; it is not a jsdom or Node-only browser claim. `wasm.mjs` calls the official RON build both from Node and Edge.

`composition.py` exercises official HOCON, CUE, Dhall, Nickel and Pkl tools with local source/override/invalid-input files. It also compiles the small Java HOCON probe. Nickel's downloaded macOS executable initially failed to load a Nix-path `libiconv`; the **observed** working launch uses `DYLD_LIBRARY_PATH=/usr/lib`, recorded in the harness. This is a packaging workaround for this host, not an assertion that every platform needs it. HOCON environment resolution is disabled and an injected-environment negative probe verifies that choice.

The scripts capture intentional failing inputs. **Process exit zero is not the success criterion for every inner experiment.** Inspect the JSON: EDN's malformed-input acceptance and SDLang's native scalar failures are retained, not converted into blanket green results. Conversely, expected schema/type/conflict errors are positive evidence that a guard fired.

## Outputs and evidence index

| Output | What it supports |
|---|---|
| `payloads.jsonl`, `decoded.jsonl`, local original roots | 1,692 hashed payloads; 1,689 successful decode/text reads; three zero-byte-source failures |
| `projects/GAME/` | 95 selected source files → 135 populated split documents, all ten notations; unmodified decoded compatibility evidence |
| [`projection-summary.json`](data/projection-summary.json), [`source-mappings.json`](data/source-mappings.json), [`physical-provenance.json`](data/physical-provenance.json) | Exact selection, relationships, physical versus normalized versions, field ownership qualifications |
| [`results.json`](data/results.json), local `results/FORMAT/` | 40 bundle/1,350 document roundtrips; property/no-op/source/plugin/reference probes; exact 120-case Git matrix; substantial tiles |
| [`post-review-results.json`](data/post-review-results.json), local `post-review/` | Full-document corruption controls, stale performance checks, duplicate identities, independent XML parser comparisons, seven deliberately broken guard modules |
| [`review-replay-results.json`](data/review-replay-results.json) | Reviewer failure scenarios replayed: stale performance path, explicit NUL rejection, clean duplicate-identity merges rejected |
| [`tile-sample.json`](data/tile-sample.json) | Retained single-sample tile timings printed in the first-pass report; timing is not a benchmark ranking |
| [`extra-results.json`](data/extra-results.json), local `extra/` | LF policy, delimiter/Unicode/scalar cases, duplicate keys, parser locations, negative schema dialect probes, real inline edits |
| [`text-rehearsal-results.json`](data/text-rehearsal-results.json), local `text-rehearsal/` | Literal copied-block placement additions and deliberately broken references across all ten |
| [`native-string-results.json`](data/native-string-results.json), local `native-string-examples/` | Actual handwritten multiline spellings and direct source edits, including final LF |
| [`browser-results.json`](data/browser-results.json), local `browser/` | Actual browser roundtrip/edit/positive and negative validation for nine JS/control paths; measured library bundle sizes |
| [`wasm-results.json`](data/wasm-results.json) | Actual official RON Node/Edge WASM calls, edits, validation and syntax-error spans |
| [`composition-results.json`](data/composition-results.json), local `composition/` | Real five-tool import/computation/override/conflict/type-error transcripts and origin diagnostics |
| [`examples-results.json`](data/examples-results.json), [`examples/keeper.yaml`](examples/keeper.yaml) and nine counterparts | Authored shareable case; no recovered game source bundled |
| [`npm-metadata.json`](data/npm-metadata.json), [`repository-evidence.json`](data/repository-evidence.json), [`releases.json`](data/releases.json) | Exact package versions, license declarations/shipped-file checks, primary repository/release evidence; reconnaissance-only alternatives are not credited as tested implementations |

The earlier `initial-results.json`, `results-before-owner-normalization.json` and `projects-initial-shape/` remain local diagnostics. They include corrected harness choices and earlier constructions; the first-pass conclusions use the final model. Subsequent actor-owned extension refinement changed the common fixture's no-op formatting count and parser locations; the final report/results reflect that, while the tile scene itself is unchanged.

## Sharing and safety boundaries

Tracked results preserve original SHA256s and relative asset locators, but use `$PROJECTS` for the owner's absolute source-root path and omit the machine hostname. No tokens, credentials, cookies, executable game code, original installers or recovered source-program bodies are intentionally included. The tracked `.prg` example and native-string inputs are newly authored. The complete real projections, original decoded models, actual merge bodies and raw game scripts remain in scratch for local review.

No legacy engine source was read; no RPGCode/game/installer was executed. No production/runtime files, repository metadata, ticket states or Git refs were changed. No repository build/lint/test/formatter suite was run. Compiling the isolated RON bridge and Java probe and executing parser/evaluator/browser/Git experiments were the assigned research work, not repository gates.

## Remaining acceptance work belongs to integration

The original first pass and subsequent [correction record](review-corrections.md) preserve independent conclusions. Assigned corrections respond to four external review triages without reading the other author's report/code. Parent-owned fresh review of fixes, comparison/reconciliation of the two models, owner review, issue filing, adoption decisions and repository gates remain required. The shared-model comparison is **not waived**. See the seven-criterion disposition in the [entrypoint](README.md).

Limitations to carry into review: the core schema is a demonstrated subset, not a complete native schema; source maps are focused probes; browser coverage is one actual browser; Node 24 and other operating systems are unexercised; evaluator writeback and general sandbox/security guarantees are not established; no human usability study or VM-equivalence proof was performed. There is no remaining tool blocker to the experiments reported here.

## Key source files

- [Common mapping adapters](../../../../tools/research/native-data-notations/astra/adapters.mjs)
- [Core corpus and Git experiments](../../../../tools/research/native-data-notations/astra/run.mjs)
- [Five official evaluators](../../../../tools/research/native-data-notations/astra/composition.py)
- [Actual browser harness](../../../../tools/research/native-data-notations/astra/browser.mjs)
- [Actual official RON WASM harness](../../../../tools/research/native-data-notations/astra/wasm.mjs)
