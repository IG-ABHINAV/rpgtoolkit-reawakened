# Contributing

Thanks for helping reawaken RPG Toolkit. This page gets you from a fresh clone to a pull request that can merge, and then keeps the detailed rules (clean-room, fixtures, golden files) below for reference.

The short version:

1. Read [AGENTS.md](AGENTS.md) and [docs/guardrails.md](docs/guardrails.md). Seven rules (G1 to G7) apply to every change, and CI checks them.
2. Set up, then run the first-run check below so you know your machine works.
3. Pick an issue from the [Project Board](https://github.com/orgs/tk-reawakened/projects/3) (look for `good first issue` or `help wanted`), and comment to claim it.
4. Work in your own git worktree, from the docs, with tests.
5. Run the checks, open a pull request with the template filled in, and get an independent review.

## What this project is

TK Reawakened is its own product. It is not RPG Toolkit v3.x and not v4, and its first release will be v1.0 ([ADR 0005](docs/adr/0005-independent-product-v1-and-native-format.md)). It plays and imports RPG Toolkit 3 games, and it is free to have its own native format when the old one gets in the way.

Toolkit 3.1 behaviour is a compatibility layer, not the model ([ADR 0009](docs/adr/0009-compatibility-layer-not-the-model.md)): the core is built on objects and forward design, and the legacy 3.1 names, commands and data shapes are aliases and adapters onto it. Reason: a design that copies the old limits would keep them. Do not describe the project as a Toolkit version in code, docs or pull requests.

## Ways to help

- **Report a bug or ask a question.** Open an issue at <https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues>. Say what you did, what you expected, what happened, and the exact commands and versions (`node -v`, `pnpm -v`). Never paste credentials or legacy source code.
- **Fix or extend the specification.** [docs/spec/](docs/spec/README.md) is the normative description of what Toolkit 3.1 does ([ADR 0007](docs/adr/0007-docs-spec-is-the-normative-specification.md)). A wrong or missing spec page is a documentation pull request, and it lands before the code that depends on it (G7).
- **Write code or tests.** Pick an issue from the [GitHub Project board](https://github.com/orgs/tk-reawakened/projects/3) or issues list (see "Pick and claim an issue").
- **Review.** Read someone else's pull request against the checklist in [.github/pull_request_template.md](.github/pull_request_template.md) and run its checks. See "Open the pull request, review and merge".

Code and contributions are licensed under the [MIT license](LICENSE).

## The rules

1. **Read [docs/guardrails.md](docs/guardrails.md).** Rules G1–G7 are binding and CI-enforced. Pull requests that break one are not merged unless an ADR approves an exception.
2. **Clean-room (G7).** Work only from `docs/`. Do not consult, copy or translate the legacy GPL-2 RPG Toolkit source. If a spec is unclear or wrong, open a docs PR first.
3. **Cite the spec.** Each behaviour PR names the `docs/spec/<path>#<anchor>` sections or capability IDs (T-xx) it implements. `docs/spec/` is the normative specification ([ADR 0007](docs/adr/0007-docs-spec-is-the-normative-specification.md)).
4. **Dependencies (G6).** New runtime dependencies must use an allowlisted licence. Say in the PR why the dependency is needed.
5. **Architecture changes** go through an ADR in `docs/adr/`.

Also see [docs/architecture-options.md](docs/architecture-options.md) and the [editor feature list](docs/editor-features.md) for background.

## Running RPGCode specs from a project

The Node-side `@tk-reawakened/script-spec` API exposes `runSpecProject(projectRoot, options)`.
It finds files ending in `.spec.prg` recursively, loads the bundled spec library,
and returns per-file cases, failures, skips, and `only` warnings. It runs each
selected case against a fresh board, party and variable set. Skips fail by
default; pass `{ strict: false }` to tolerate them. A focused case narrows the
entire project run. Failure reports include the project-relative file and
assertion line.
Includes resolve against the project's `Prg/` programs using the normal
case-insensitive path rules; spec files use Windows-1252 RPGCode source encoding.

This package is still incomplete: array equality and containment and `toThrow`
remain subject to the owner's F-A ruling; strict `toBe` type identity also
needs a type distinction the current library does not provide; and `toBeCloseTo`
takes both arguments and compares truncated whole numbers only, because RPGCode
truncates a variable's number in arithmetic (F-D) and one callable cannot accept
both one and two arguments without a language change (F-F). The current
`skip(name, body)` and `only(name, body)` forms mark cases, not groups. Group
`beforeAll` and `afterAll` hooks are rerun for each isolated case, including
when that case is outside the group; they do not yet satisfy the once-per-group
contract. Consult [TOOL-5](docs/spec/engine/rpgcode-tooling.md#tool-5) for the
intended API; do not treat the current runner as full conformance.


## Set up

You need:

- **git**.
- **Node 24.21.0.** It is pinned in `.node-version`, and CI uses the same version. Use any version manager that reads `.node-version`, or install that version yourself.
- **pnpm 12.10.1.** It is pinned in `packageManager` in `package.json`. Run `corepack enable` and the right version is picked up.
- **Network access** for `pnpm fixtures:fetch` (the legacy sample games) and `pnpm audit --prod`.

Only some commands need more:

| Tool | Needed only for |
|---|---|
| Bun 1.4.2 (the version CI pins) | `pnpm golden:bun`, which replays the golden and closing suites under Bun against the committed output (Node is covered by `pnpm golden` and `pnpm closing`) |
| Python 3 with Pillow | `pnpm oracle:check`, which compares against the independent reference renderer; use the virtual environment below |
| uv | the BMad ticket scripts under `_bmad/scripts/` and the `bmad-ticket` tool (see "Pick and claim a ticket") |
| GitHub CLI (`gh`) | optional: opening and checking pull requests from a terminal |

### First run on a clean clone

```sh
git clone https://github.com/tk-reawakened/rpgtoolkit-reawakened.git
cd rpgtoolkit-reawakened
corepack enable
pnpm install --frozen-lockfile   # install from the committed lockfile
pnpm build                       # tsc -b
pnpm dump docs/spec/examples     # parse the small example game in the spec and print one line per file
```

`pnpm dump` needs no sample games, because the example game ships inside `docs/spec/examples/`. A working setup prints one line per file, which starts like this (the `skipped` lines are normal: they name files that have no readable legacy format):

```text
README.md  skipped  unrecognised extension: no legacy data format here is read under this extension
files/example_game.tpk  skipped  unrecognised extension: no legacy data format here is read under this extension
files/flower.gph  single-tile  single tile 2.0, detail 1, 32×32, 1024 pixels  digest=9131ae96648d8338
```

Then run one test file, so you know the test loop works:

```sh
node --test packages/core/test/fmath.test.ts   # prints "pass 20", "fail 0" at the end
```

If those work, your setup is fine. Real fixtures and the full gates come later (see "Commands").

### Optional Python tools

For `pnpm oracle:check`, install Pillow in a virtual environment rather than changing your system Python. Keep the environment outside the checkout so it cannot accidentally enter a commit:

```sh
python3 -m venv "$HOME/.venvs/tkr-tools"
. "$HOME/.venvs/tkr-tools/bin/activate"
python -m pip install Pillow
pnpm oracle:check
deactivate
```

While the environment is active, `pnpm oracle:check` finds its `python3` through `PATH`. On Windows, activate the environment with its `Scripts/Activate.ps1` instead. The other shell examples on this page use a POSIX shell, such as Bash or Git Bash.

## Where things are

These packages exist today (`packages/`):

| Package | What it holds |
|---|---|
| `core` | The deterministic engine: file-format readers and writers, the RPGCode script VM, the reference rasteriser, deterministic maths (`fmath`), saves, input, audio rules. It touches no DOM, Node, I/O or timers (G2, G3). |
| `synth` | Audio synthesis: MIDI and PCM playback, mixer and voice pool. |
| `plugin-tk2-compat` | The Toolkit 2 compatibility command pack for RPGCode (deterministic adapters only). |
| `runner-harness` | Shared headless runner logic: the scripted driver, golden, closing and corpus jobs. |
| `runner-headless` | The Node/Bun command line (`golden`, `closing`, `corpus`, `dump`); `pnpm golden`, `pnpm closing` and `pnpm dump` call it. |
| `render-webgl2` | The WebGL2 draw-list replayer: turns a draw list into pixels on a canvas (G4). |
| `runner-web` | The browser/web runner: boots a game folder or package and presents frames; the desktop wrapper runs the same build, and a mobile wrapper is planned. |
| `runner-desktop` | The desktop player: the Electron shell (`app://`) around the `runner-web` build, with a package asset source and save storage. See "Run the desktop player" below. |
| `lsp` | The transport-free RPGCode language server (diagnostics, hover, completion, definition, outline). Host transports live outside this package. |
| `script-spec` | Shared RPGCode tooling contracts: program, project and runner types used by the language server and script tools. |
| `script-tools` | RPGCode analysis, indexing, formatting, diagnostics and quick-fixes used by the language server and stand-alone checks. |

Outside `packages/`: `docs/` (spec, ADRs, guard-rails), `tools/` (the checks and generators CI runs), `golden/` (committed reference output), `fixtures/` (fetched sample games, never committed), `media/`, and `_bmad-output/` (tickets and plans, see below).

The editor and its hosts (`editor-ui`, `host-vscode`, `host-web`, `host-desktop`) and the debug server are **planned** and do not exist in this repository yet. The language server exists as `packages/lsp`. The web and desktop runners do exist (`runner-web`, `runner-desktop`), but a fully interactive player loop is not yet demonstrated: the last recorded desktop run, before E-02, measured the game off-screen and showed only the title screen; no post-E-02 desktop run is recorded. The dependency direction every package must follow is in G2.

## Pick and claim an issue

All tasks and contributor opportunities go through **GitHub Issues** and the **[RPG Toolkit Reawakened Roadmap & Tasks Project Board](https://github.com/orgs/tk-reawakened/projects/3)**.

### Finding work to do

1. Check the [Project Board](https://github.com/orgs/tk-reawakened/projects/3) for cards in **Ready for Dev** or **Backlog**.
2. Check the [Issues tab](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues) filtered by [`good first issue`](https://github.com/tk-reawakened/rpgtoolkit-reawakened/labels/good%20first%20issue) or [`help wanted`](https://github.com/tk-reawakened/rpgtoolkit-reawakened/labels/help%20wanted) for tasks scoped for newcomers.
3. Each issue describes the goal, key files, spec citations (`docs/spec/...#anchor`), acceptance criteria, and clean-room requirements (G7).

### Claiming an issue

Before starting work on an issue:

1. Check that nobody is already working on it (check the issue assignees, comments, and open pull requests: `gh pr list`).
2. Leave a comment on the issue saying you would like to take it so others know it is claimed.
3. Work in your own git worktree (see "Work in a worktree" below).
4. Name branches `<type>/<issue-or-ticket-id>-<short-name>` (e.g. `feat/19-5-class-dictionaries`, `fix/42-string-escape`).
5. Link the issue in your pull request description using GitHub syntax (`Fixes #<number>` or `Closes #<number>`) so the project board updates automatically when merged.

If no existing issue covers what you want to build or fix, open a new issue using one of the templates ([Bug Report](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/new?template=bug_report.yml), [Implementation Task](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/new?template=task.yml), or [Feature Request](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/new?template=feature_request.yml)).

### Planning background (BMAD)

Project maintainers plan large epics, architecture spikes, and initiative roadmaps using BMAD in `_bmad-output/initiative-rpgtoolkit-reawakened/`. Those epics and stories are exported into GitHub Issues and mapped to the Project Board.

Contributors never need to install or run BMAD tooling—all task acceptance criteria and spec references are included directly in the GitHub Issue. If you are a maintainer or working on the initiative planning spine directly, see [initiative-rpgtoolkit-reawakened.md](_bmad-output/initiative-rpgtoolkit-reawakened/initiative-rpgtoolkit-reawakened.md) and `_bmad-output/`.

To publish a planned epic, make `_bmad-output/initiative-rpgtoolkit-reawakened/tickets.toml` and the epic folder's `tickets.toml` authoritative first, then run:

```sh
python3 tools/migrate-tickets-to-github.py --epic epic-slug
python3 tools/create-epic-on-github.py epic-slug
```

The first command mirrors story issues and their tracker IDs. The second creates or syncs the `[Epic N]` parent, writes its `tracker_id` to the initiative index, adds it to Project 3, and links all published story issues as native sub-issues. It also syncs parent/story statuses from BMAD ticket metadata. Use `--dry-run` on either command to preview the planned actions.

## Doing the work

1. **Docs first.** If the spec is wrong or silent, fix it in its own commit first (G7). Then write the code from the spec.
2. **Respect the model boundaries.** Dependencies flow `core ← synth ← runners ← hosts`. Keep `core` free of DOM, Node, I/O, timers, `Math.random`, `Date` and unlisted `Math` functions (G2, G3). `pnpm lint` and `pnpm graph` check this. A legacy 3.1 name is an alias onto the object model, not the model itself.
3. **Test behaviour.** Test what the engine does (state, draw lists, hashes, diagnostics), not how a function is written. Put tests in `packages/<name>/test/` as `*.test.ts`. Never add a skipped test to dodge a failure: `pnpm test:strict` fails on any skip.
4. **Keep tests fast and bounded.** Ordinary unit tests should finish in under 1 second individually. Run each new test by itself and inspect its reported duration. If it exceeds 1 second, profile and reduce setup, repeated rendering, or simulated ticks; if it still needs the time, explain why in the test or pull request. For deterministic behavior that is a pure function of inputs and tick, assert representative boundary ticks directly instead of replaying every intervening tick. Keep full-engine tests to the smallest scenario that proves a cross-layer contract. Use short authored fixtures, bound loops, and avoid sleeps or wall-clock timing.
5. **Golden files are a record, not a convenience.** A golden is committed output that the suite compares against (G5). `pnpm golden:record`, `pnpm closing:record`, `pnpm dump:record`, `pnpm dump:record:examples` and `pnpm fixtures:author` rewrite them; run one only on purpose, never in CI and never as a side effect, and explain every changed golden in the pull request. If a golden changes and you cannot say why the new output is correct, the code is wrong, not the golden.
6. **Help text.** Command and help descriptions first say what the command does in plain terms for someone making a game, then describe it exactly (units, ticks, order, whether the script waits). See the working notes in [AGENTS.md](AGENTS.md).

## Work in a worktree

Do each piece of work in its own git worktree (a second folder checked out from the same repository). Reason: several people or agents can then work at once without overwriting each other's files, and the checkout you cloned stays exactly as it was.

Run this from any checkout of the repository, on any branch. It does not switch branches or touch files in the checkout you run it from:

```sh
git fetch origin
git worktree list                                        # see what others have open
git worktree add -b <type>/<ticket>-<short-name> ../rpgtoolkit-reawakened.worktrees/<short-name> origin/main
cd ../rpgtoolkit-reawakened.worktrees/<short-name>
pnpm install --frozen-lockfile   # dependencies link from the shared pnpm store
pnpm fixtures:fetch              # only when you need the sample games (see "Commands")
```

A new worktree starts without the files git ignores. That is why it needs `pnpm install` (for `node_modules/`) and, when you need them, `pnpm fixtures:fetch` (for the sample games under `fixtures/`). You do not need to copy any personal configuration: the ticket tool works when you give it the initiative folder, as shown above. (Worktrees under the repository's own `.worktrees/` folder also work; git ignores that folder.)

Work only in your own worktree. Never edit, reset, stash or switch branches in someone else's checkout or worktree.

## Commands

Run them from the repository root, in this order, before you open a pull request. The CI job each one runs in is in brackets. Docs-only change? Run at least `pnpm provenance` and `pnpm lint`, and `pnpm catalogue:check` and `pnpm command-docs:check` when you touched command documentation or the catalogue.

```sh
pnpm install --frozen-lockfile   # install from the committed lockfile
pnpm build                       # tsc -b: a quick incremental build
pnpm typecheck                   # tsc -b, then each package's tsconfig.test.json [checks]
pnpm lint                        # the core dependency check, then ESLint [checks]
pnpm test                        # tsc -b, then node --test; sample-game cases skip without fixtures
pnpm fixtures:fetch              # fetch the legacy sample games (network, cached)
pnpm fixtures:check              # fail if anything under fixtures/ is tracked [golden]
pnpm test:strict                 # as `test`, but any skipped test fails; needs fixtures:fetch [unit]
pnpm golden                      # the headless golden suite (G5) [golden]
pnpm closing                     # boot every fetched sample game through the real engine; needs fixtures:fetch [golden]
pnpm dump:check                  # compare the dump of the sample games and the spec examples with the committed digests; needs fixtures:fetch [golden]
pnpm oracle:check                # independent-reference drift checks; needs python3 with Pillow [golden]
pnpm graph:test && pnpm graph    # the dependency-edge tool's tests, then the check (G2, G4) [checks]
pnpm licence:test && pnpm licence  # the licence tool's tests, then the licence gate (G6) [checks]
pnpm audit --prod                # dependency vulnerability audit (network) [checks]
pnpm provenance:test && pnpm provenance  # the scan's tests, then the clean-room provenance scan (G7) [checks]
pnpm fixtures:test               # the fixture tools' own tests [checks]
pnpm catalogue:check             # the generated catalogue stubs match the catalogue [checks]
pnpm command-docs:test && pnpm command-docs:check  # command documentation tool tests, then the check [checks]
pnpm no-skips:test               # the no-skips guard's own tests [checks]
pnpm icons:test                  # the icon builder's own tests [checks]
pnpm golden:bun                  # replay the golden and closing suites under Bun against the committed output; needs Bun and fixtures:fetch [golden-bun]
```

Other commands:

```sh
pnpm dump <path>                 # parse a legacy project and print it (see "The dump tool" below), e.g. `pnpm dump fixtures/legacy/demo` after fixtures:fetch
pnpm corpus                      # run every fetched sample program headlessly (needs fixtures:fetch)
pnpm fixtures:author             # rewrite the authored fixtures (deliberate, see "Committed fixtures")
pnpm fixtures:author:check       # fail if those committed fixtures drift from the generator, or an oracle imports core
pnpm audio-protocol:check        # the audio protocol fixtures match their generator
pnpm catalogue:generate          # rewrite the catalogue stubs (deliberate); `font:generate` and `font:check` do the same for the project font
pnpm icons                       # rebuild media/icons from media/tkr.png (the logo's icon set)
pnpm graph:write                 # dev aid: write the dependency-graph inputs; CI never runs it
```

`pnpm license` and `pnpm license:test` are aliases of `licence` and `licence:test`. The `*:test` scripts are the tool self-tests that CI also runs, so run them when you touch `tools/`.

`pnpm golden:record` rewrites the golden and is the only writer of it. Never run it in CI. A golden change is a reviewed behaviour change (G5), so explain it in the pull request.

`pnpm closing` boots all eight fetched sample games through the real engine and compares their frames, hashes and diagnostics with the baselines committed under `golden/regression/` (it needs `fixtures:fetch`, runs in the `golden` job and again under Bun in `golden-bun`, and takes about a minute). `pnpm closing:record` rewrites those baselines and the closing rows of `golden/ledger.json`; like `golden:record` it is a deliberate act and never runs in CI. The scripted run and each game's expected outcome live in `golden/closing/plan.json`; a Toolkit 2 game that cannot boot yet is listed there as an expected failure with its epic and reason, and fails the suite as soon as it starts to boot, so the entry is removed on purpose.

### Run the desktop player

The desktop player (`runner-desktop`) is an Electron shell over the `runner-web` build. Build it, package a game, then either measure it or launch the window.

```sh
pnpm fixtures:fetch                                             # the sample games, once
pnpm make-package fixtures/legacy/demo --closing-plan golden/closing/plan.json \
  --game demo --out fixtures/packages/demo.tpk --title Demo      # one .tpk package + descriptor
pnpm desktop:build                                              # dist/main.js, dist/preload.js, apps/player-desktop.js
pnpm desktop:measure                                           # run the closing-path measurement, print report, quit
```

The current expected `demo` closing-baseline fields at tick 120 are `"stateHash": "32e892e98b3d2a85"` and `"drawHash": "9c0e4d56e59619da"` with **122 commands** (read them from `golden/regression/closing.json`; they last moved with issues #1154 and #1153, when the presented screen and its draw list left the state hash). This is the committed closing-suite reference, not evidence of a post-E-02 desktop run. The recorded macOS desktop report predates E-02 and printed `"error": null`, with the previous state hash, draw hash `"9a40be8a0b5ca816"` and frame worst 0; that earlier state hash is retained as historical and superseded for current parity. No post-E-02 `desktop:measure` result is recorded here. The command builds the package for you if you leave `--package` off. Point it at a package you built yourself with `pnpm desktop:measure --package path/to/your.tpk`.

The recorded pre-E-02 launch titled its window with the previous state hash; this is historical output, not a post-E-02 title or desktop-pass claim.

```sh
pnpm desktop:run --package fixtures/packages/demo.tpk
```

`pnpm desktop:run` builds the `demo` package when `--package` is absent and passes the player's other flags through unchanged — `--serve <dir>` is the directory pages and data are served from, `--package <file.tpk>` is the game to open, `--page <path>` is the player page, and `--report <file>` / `--quit-after` are for the measurement harness. On Linux a headless machine runs the measurement with `xvfb-run -a pnpm desktop:measure`.

Two things to expect on a fresh worktree: `pnpm install` can return before Electron's ~100 MB runtime has finished downloading in the background, so a first `desktop:measure` may fail with `ENOENT …/Electron` — wait and re-run; and the last recorded pre-E-02 launch drew the board off-screen. The live interactive loop and a post-E-02 visible desktop run remain unverified. The user-facing version of these steps is [docs/playing-the-desktop-player.md](docs/playing-the-desktop-player.md).

### The loop while you work

```sh
pnpm build                                                  # rebuild what changed
node --test packages/core/test/<file>.test.ts               # one test file
node --test --test-name-pattern="<words>" packages/core/test/<file>.test.ts   # tests whose name matches
pnpm test                                                   # all package tests
```

Run `pnpm build` first because packages import each other's built output. Only `synth` has per-package `build`, `typecheck`, `lint` and `test` scripts. `core`, `plugin-tk2-compat`, `runner-harness` and `runner-headless` expose `typecheck:tests` only, and their tests run through the root `pnpm test`. Some tests skip their sample-game cases until you run `pnpm fixtures:fetch`; run `pnpm test:strict` before you push so that none of them silently skip.

## Open the pull request, review and merge

1. Push your branch and open a pull request **against `tk-reawakened/rpgtoolkit-reawakened:main`**. Collaborators with write access can use `git push -u origin <branch>`; everyone else should use [a fork](#contribute-through-a-fork). Fill in [the template](.github/pull_request_template.md): the guard-rail checklist, the spec sections you implement, and any golden changes with the reason.
2. **CI.** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs these jobs on every pull request: `changes` (the change classifier, below), `checks` (typecheck, lint, licence, provenance, dependency graph, catalogue, command-docs, and tool self-tests), `unit` (a fifteen-shard matrix that fetches the sample games and runs each shard once under the no-skips guard with V8 coverage), `golden`, `script-dogfood`, `golden-bun`, `browser`, `desktop` (Linux, macOS and Windows), `mobile` (an Android emulator), and `gate`. `gate` fails unless every one of those jobs succeeded, merges the fifteen shard LCOV reports into `coverage/lcov.info`, and enforces the repository line and branch coverage thresholds.
3. **Green before merge.** All checks, gated by `gate`, must pass. The repository ruleset requires the single `gate` check, which lists every job above in its `needs`, so any failed, skipped, or cancelled job blocks the merge. No job is ever skipped: see "What CI does for a prose-only change" below. Every change goes through a reviewed pull request; never push changes straight to `main`.
4. **Independent review.** Someone other than the author reviews the diff. They read it against the checklist, run the commands that matter for the change, and check that any changed golden is explained. A reviewer who is an AI agent must not be the session that wrote the change.
5. **Behind `main`?** If GitHub says the branch can merge cleanly and checks are green, do not rebase or force-push just to catch up. Merge `origin/main` into your branch only when there is a conflict or `main` changed something your change depends on. Pull requests are merged with a merge commit, which keeps history intact.
6. **Done includes worktree cleanup.** Every worktree you created is removed (`git worktree remove`) or listed as preserved with a reason. Remove a worktree only after the work is pushed and has a destination: a merged pull request, or an open one named in the handoff. Dirty worktrees are preserved first (commit, push or archive). Unmerged branches are never deleted. The final report states each path and its outcome. Follow "Clean up after a merge" below.

### What CI does for a prose-only change

Installing, building, replaying goldens and booting an Android emulator is wasted on a typo fix, so each of `golden`, `golden-bun`, `browser`, `desktop` (each operating system), `mobile` and `script-dogfood` judges for itself whether its work applies ([ADR 0016](docs/adr/0016-ci-classified-steps.md)). The `changes` job lists the files your pull request changed and gives one verdict. Every one of those jobs still runs and still reports success; they only skip their own *steps* when the verdict is "defer". `checks`, `unit` and `gate` always do all of their work, so licence, provenance and coverage always see your change. Because no job is skipped, the required `gate` check keeps its meaning and the repository ruleset is unchanged.

The verdict is "defer" only when **every** changed path is one of these, each of which is read by people and by no CI lane:

- a Markdown file in the repository root (`README.md`, `CONTRIBUTING.md`, ...);
- `docs/guardrails.md`;
- Markdown under `docs/adr/`;
- Markdown under `_bmad-output/` (plans and tickets);
- issue forms under `.github/ISSUE_TEMPLATE/` (`.md`, `.yml`, `.yaml`).

Anything else runs everything, including all of `packages/`, `tools/`, `stock/` and `golden/` (even a README there), all of `docs/spec/`, `.github/workflows/` and the pull request template, any other file in `docs/`, `package.json` and the lockfile, an empty diff, a path nobody has classified, and every push to `main`. The list is positive on purpose: a new kind of file runs everything until someone decides it is inert. A rename counts both its old and its new path.

Open the job log to see which way it went. A job that defers prints one line, and its later steps show as skipped:

```text
CI classifier [golden]: DEFER - nothing this job guards could have changed; inert: _bmad-output/example/plan.md
```

A job that runs prints the path that forced it:

```text
CI classifier [golden]: RUN - full: tools/ci/classify-changes.mjs
```

If the classifier itself cannot decide (git fails, the diff cannot be parsed, it crashes, its tests fail), every job runs in full and `changes` fails, which fails `gate`. That is a CI problem to report, not something your pull request caused by being small. The classifier is `tools/ci/classify-changes.mjs`; its tests are `pnpm ci:classify:test`. The verdict is computed by the **base branch's** copy of that file (with git replacement objects disabled), so editing the classifier cannot change the verdict on the same pull request — and a change under `tools/ci/` or `.github/workflows/` runs everything anyway.

The classifier is a **scheduling optimisation, not a security boundary**. On a pull request, GitHub runs the workflow from your branch, so the workflow that does the classifying is yours — exactly as with every other job here, which you could also weaken by editing `ci.yml`. What is meant to protect that boundary is review: `.github/CODEOWNERS` **requests** an owner review for `.github/workflows/**` and `tools/ci/**`. It does not block a merge yet — that needs the default-branch ruleset to require review from code owners, and the owner is currently the only collaborator, so nobody else could give that approval. `gate` also fails if a "defer" verdict arrives while the diff touches those paths, which catches a mistake but not a determined author. Do not treat a green `gate` as proof that the workflow itself was not changed; read such a diff.

### Contribute through a fork

If you cannot push to this repository, fork it using GitHub's **Fork** button. Keep `origin` pointing at the upstream repository used by the setup commands, and add your fork as another remote. Check `git remote -v` first so you do not add a duplicate. Replace `YOUR-USERNAME` and the branch name with your own:

```sh
git remote add fork https://github.com/YOUR-USERNAME/rpgtoolkit-reawakened.git
git push -u fork <branch>
```

Open the pull request from your fork's branch to **`tk-reawakened/rpgtoolkit-reawakened:main`**, not to your fork's `main`. GitHub's web interface works without `gh`. Continue fetching `origin/main` for upstream changes. If you originally cloned your fork instead, add the original repository as an `upstream` remote and use `upstream/main` wherever this guide uses `origin/main`.

## Clean up after a merge

Run cleanup from a checkout other than the worktree you are removing. Confirm that GitHub shows your pull request merged and that the worktree has no uncommitted work. Set these variables to your own branch and worktree:

```sh
branch='feat/TICKET-short-name'
worktree='../rpgtoolkit-reawakened.worktrees/short-name'
git fetch origin
git merge-base --is-ancestor "$branch" origin/main
```

**Proceed only if the ancestry check succeeds.** If it fails, the branch may contain work that has not landed, or the merge may have used a different history shape: keep it and ask before deleting anything. For a merged branch, remove the clean worktree and delete the branch without forcing:

```sh
git worktree remove "$worktree"
git branch --set-upstream-to=origin/main "$branch"
git branch -d "$branch"
```

The upstream setting makes `-d` check the merged branch against `origin/main`, even when your current checkout is on another branch. These commands affect only your worktree and branch. Do not force removal, discard uncommitted files or switch someone else's checkout.

There is no need to move a local `main` to start the next task: fetch and create the next worktree from `origin/main`. Update a checkout's local `main` with `git merge --ff-only origin/main` only when you own that checkout and it is already on `main`.

## If you are an AI agent

Read [AGENTS.md](AGENTS.md) first (`CLAUDE.md` imports it, so there is one set of instructions). The rules, the checks and the review are the same as for a person. Work only in your own worktree, run the commands that apply, and say in the pull request what you ran and what you did not. If you do not know something, ask the person driving the work or open an issue; do not invent a requirement, a command or a policy.

## If you are stuck

Ask. Open an issue, or comment on your draft pull request, and describe what you tried. If a task seems to need breaking a guard-rail, stop and ask: exceptions need an ADR. If the docs and the code disagree, fix the doc first (G7) or say so in the issue.

## Clean-room provenance

RPG Toolkit Reawakened is a clean-room rebuild. The legacy RPG Toolkit engine and editor are GPL-2, so none of that source may enter this repository.

- The documents in `docs/` describe legacy behaviour and file layouts in our own words. They are the only source for implementation work.
- Do not open, copy, paraphrase or translate the legacy source while writing code. Contributors and AI agents follow the same rule (see [AGENTS.md](AGENTS.md)).
- If `docs/` is wrong or missing something, fix the doc first in its own commit, then the code.
- Whole legacy sample games are test fixtures fetched at CI time. Never commit them. Small anonymised or authored fixtures may be committed (see "Committed fixtures" below).
- The full rule and its checks are G7 in [docs/guardrails.md](docs/guardrails.md).

## Committed fixtures

The fetched sample games are never committed (G5 rule 4), but a few small
fixtures **are** committed under `packages/core/test/fixtures/`, because the
corpus cannot supply them (ticket 2.22):

- `authored/` — bytes written straight from the byte layouts in
  [docs/spec/formats/](docs/spec/formats/README.md) by `tools/fixtures/author/generate.mjs`:
  detail 4/5/6 tilesets, an isometric `.iso`, three Windows bitmaps (24-bit,
  1-bit and RLE8), four GIFs (still, animated, interlaced and full-table),
  a `.tpk` and a deflated copy of it, a Setup ZIP, a backslash-entry ZIP, a
  `CMP1` standalone EXE and two negative EXE stubs. The tool imports no
  `core` reader or writer, so a fixture cannot "pass by sharing the writer
  primitives". `pnpm fixtures:author:check` re-runs it and fails if the
  committed bytes drift; `pnpm fixtures:author` rewrites them and is a
  deliberate act, exactly like `pnpm golden:record` (G5).
- `movement/` — the movement oracle's fourteen named scenes (ticket 5.2), written
  by the same generator from the rules in
  [docs/spec/engine/movement-and-collision.md](docs/spec/engine/movement-and-collision.md)
  (R-50 to R-54 and the ratifications) and
  [docs/spec/engine/display-input-audio.md](docs/spec/engine/display-input-audio.md#reawakened-gamepad-contract):
  authored boards and actors, fixed-tick recorded inputs, and the expected per-tick
  outcome facts (positions, layers, fired triggers, events). The facts come from
  the reference simulation in `tools/fixtures/movement/`, which imports nothing
  from `packages/core`; `--check` also scans for such an import. There are **no
  state or draw hashes**: the consuming entries assert those. `manifest.json` lists
  every scene and case and the "proposed" rulings (`P-n`) each relies on where the
  spec is silent. `demo-npc-pathfinding` and `demo-npc-battle-trigger` model
  programs from the fetched `demo` game and pin their digests; the files are read
  only when fetched and are never committed.
- `audio/` — the audio oracle's fifteen named scenes (ticket 6.4), written by the same
  generator from the rules in
  [docs/spec/engine/audio-media.md](docs/spec/engine/audio-media.md) (the time model,
  cues, waits, voices, fades, the SoundFont and video rules and the legacy parity
  ledger; each scene file lists the anchors it follows): `board-music-boot`,
  `animation-frame-sfx`, `track-transport`, `loop-and-end-ticks`, `same-file-rules`,
  `voices-and-stealing`, `fades`, `synced-start`, `late-start-catch-up`,
  `media-wait-suspend`, `settings-versus-save`, `soundfont-setting`,
  `battle-music-handoff`, `legacy-parity-ledger` and `video-restarts-music`. Each case
  is a recorded script of effects, commands and inputs with the expected per-tick
  track states, cues (every `AudioCue` in full, ids included), wait wake-ups, end
  events and diagnostics. The facts come from the reference timeline in
  `tools/fixtures/audio/`, which imports nothing from `packages/core`; `--check`
  also scans for such an import. There are **no state or cue hashes**: the consuming
  entries (6.6 onwards) assert those. `manifest.json` lists every scene, case,
  authored file and the "proposed" rulings (`P-n`) the oracle relies on where the
  spec is silent. `files/` holds tiny authored WAV (8 and 16-bit PCM, MS-ADPCM,
  IMA-ADPCM) and MIDI (type 0 and 1, tempo changes, XG and GS dialects) files, each
  with a hand-worked length in ticks and the arithmetic behind it; they are written
  from the public layouts and rule F4, so there is nothing to license. Corpus WAV
  and MIDI lengths are pinned by SHA-256 and checked by an independent reader only
  when the corpus is fetched; the files are never committed. Eight scenes run through
  the real core, tick by tick, in `packages/core/test/audio-scenes.test.ts` (ticket 6.6,
  driver in `audio-oracle.ts`): `board-music-boot`, `animation-frame-sfx`,
  `track-transport`, `loop-and-end-ticks`, `same-file-rules`, `settings-versus-save`,
  `soundfont-setting` and `battle-music-handoff`.
- `real/` — tiny files an editor produced: a detail-1, a detail-2 and a detail-3
  tileset, plus a `.tan` and a `.gph` held for ticket 16.7.
- `anonymised/` — derivatives of real legacy samples, produced by
  `tools/fixtures/author/anonymise.mjs`, which keeps the binary layout but
  replaces every name, description, program and asset filename with a neutral
  placeholder and every content byte with a synthetic pattern. The plan of
  ticket 2.22 records the source paths; the sources themselves are never
  committed.
- `parser-oop/` — four compact RPGCode programs and reviewed `*.ast.json` semantic
  expectations for collection, widget composition, inheritance and references.
  They are independently authored from
  [the language specification](docs/spec/engine/rpgcode-language.md#keywords-and-structure)
  and [the object specification](docs/spec/engine/rpgcode-modules-and-objects.md#objects),
  using neutral names and new method bodies. They are parser-contract goldens,
  not original-engine executions or runtime-parity evidence. Run them with
  `pnpm build` followed by
  `node --test packages/core/test/script-oop-goldens.test.ts`. Successful-node
  line bookkeeping is omitted; malformed-input tests retain code and location.
  Tests never rewrite expectations. Change a golden only after manually
  reviewing its semantic nodes and expression grouping against source and spec.
  Valid documented syntax failures belong in the spec/bug workflow, not in
  narrowed fixtures or expected-failure tests. Known valid forms such as
  `returnMethod` references and conversion declarations are not pinned as failures.

`pnpm fixtures:check` fails when anything under the root `fixtures/` is tracked,
so a fetched file can never be committed by mistake.

## The dump tool and the corpus digest gate

`pnpm dump <path>` walks a legacy project and prints one readable line per file. `<path>` is an extracted project folder, a game folder, or a `.tpk`/standalone EXE package ([packaging-and-paths.md](docs/spec/formats/packaging-and-paths.md)). Each file goes to the reader its extension names (`.gam` [main-file.md](docs/spec/formats/main-file.md), `.brd` [board.md](docs/spec/formats/board.md), `.tst`/`.iso` [tiles.md](docs/spec/formats/tiles.md), `.tbm` [tiles.md#tile-bitmap-tbm](docs/spec/formats/tiles.md#tile-bitmap-tbm), `.anm` [animation.md](docs/spec/formats/animation.md), `.tem`/`.itm`/`.ene` [character.md](docs/spec/formats/character.md), [item.md](docs/spec/formats/item.md), [enemy.md](docs/spec/formats/enemy.md), `.spc`/`.ste`/`.bkg` [battle-data.md](docs/spec/formats/battle-data.md), and so on). Unsupported formats are named rather than silently skipped.

`pnpm dump --json <path>` prints the same report as JSON, with a per-file digest: `core`'s FNV-1a over the canonical JSON of the parsed model (AD-11), or over the decoded RGBA for an image. The report is deterministic — files sorted by path, fixed key order, nothing machine-specific — so a reader or decoder that drifts changes a digest.

That is epic 2's Done-when 1 as a **CI gate**, not a local habit: the required `golden` job (which already runs `pnpm fixtures:fetch`) runs `pnpm dump:check`, which compares the six TK2 games pinned from ludotheque plus existing `demo` and `Basic` games against `golden/legacy-corpus.json`, and the JSON report over committed spec examples against `golden/spec-examples.json`. Current formats must parse with 0 failures and 0 residue; unsupported historical formats remain tracked as expected failures/residue rows naming the ticket that clears each. A changed digest or unexpected failure fails the job.

`pnpm dump:record` and `pnpm dump:record:examples` rewrite expectations deliberately, like `pnpm golden:record`: never run them in CI, never let them run as a side effect, and explain any digest changes in the pull request.
