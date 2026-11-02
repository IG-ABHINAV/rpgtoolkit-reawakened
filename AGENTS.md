# TK Reawakened — agent instructions

Clean-room, MIT/Apache rebuild of the RPG Toolkit 3 engine and editor in **TypeScript** ([ADR 0001](docs/adr/0001-typescript-core.md)).

**This is its own product, not RPG Toolkit v3.x or v4.** Its first release is v1.0. It plays and imports TK3 worlds, and is free to get its own native format (working name "TKR") if legacy limits a feature. See [ADR 0005](docs/adr/0005-independent-product-v1-and-native-format.md). Never describe it as a TK version.

## Non-negotiable: the guard-rails

Read and follow **[docs/guardrails.md](docs/guardrails.md)** (G1–G7) for every change. In short:

- **G1** The RPGCode VM is an explicit step machine. State is plain JSON data. No generators, async/await or Promises for script threads.
- **G2** `core` touches no DOM, Node, I/O or timers. `editor-ui` reaches the host only through platform-services. Dependencies flow `core ← synth ← runners/lsp/dap/editor-ui ← host-*`.
- **G3** No `Math.random`, `Date`, `performance.now` or `Intl` in `core`. Use the injected clock and seeded RNG, with a fixed time tick. Only the exact `Math` functions are allowed (`abs`, `ceil`, `floor`, `round`, `trunc`, `sign`, `min`, `max`, `fround`, `imul`, `clz32`, `sqrt`), and `**` is banned, because other maths can give different answers on different JavaScript engines; use `core/fmath` instead ([ADR 0002](docs/adr/0002-core-pixels-and-deterministic-maths.md)).
- **G4** Renderers only replay draw lists. Phaser and Pixi are never the loop and never hold state.
- **G5** The headless golden tests must pass. Change goldens only deliberately, and explain why.
- **G6** Dependencies only under licences rated Bronze or better on the Blue Oak Council list (MIT, Apache-2.0, BSD, ISC, Zlib, 0BSD and the like; CC0 for assets). Never add copyleft (GPL, LGPL, AGPL, MPL) or restricted licences.
- **G7** Clean-room: implement only from `docs/`. Never open, copy or translate the legacy GPL source (`../rpgtoolkit`) while writing code. If the docs are wrong or missing something, fix the doc first in its own commit, then the code.

If a task seems to need breaking a rule, stop and ask. Exceptions require an ADR.

Setup, choosing a ticket, the checks to run and the pull-request flow are in [CONTRIBUTING.md](CONTRIBUTING.md). People and AI agents follow the same rules.

## Working notes

- **Worktree cleanup:** Finish the task and commit what is needed. Confirm the work is in its destination branch (merged, or pushed and named in the handoff); never leave the worktree as the only copy. Never delete an unmerged branch or remove a dirty worktree: preserve changes first (commit, push, or archive), then remove the checkout with `git worktree remove <path>`. If it is a managed Codex worktree, also archive it through Codex so changes remain recoverable. Report the worktree path and cleanup result in the handoff; cleanup must never make a change disappear. Cleanup is part of the done definition, and the final report must list each worktree path and its outcome. Verify `pwd` and `git branch --show-current` before each git command so you never change the main checkout while working in a worktree.
- **Track every defect:** Before finishing the work that found it, file an issue for each defect found by a person, a review perturbation, a test that passes when it should fail, or a flaky check. Record the symptom, evidence (file and line, transcript, log, or hashes), what proves the fix, and the branch or PR if one exists. An epic is optional; an issue with the `bug` label is enough. If the same PR fixes it, say so in the issue and close it from that PR.
- Specs: `docs/spec/` is the normative specification of what Toolkit 3.1 does ([ADR 0007](docs/adr/0007-docs-spec-is-the-normative-specification.md)); its engine pages carry the E-xx IDs as anchors. `docs/editor-features.md` (T-xx IDs) is not replaced. Cite `docs/spec/<path>#<anchor>` in commits and PRs.
- Editor features land in `editor-ui` first. Host packages (`host-vscode`, `host-web`, `host-desktop`) contain only platform services and chrome. The VS Code extension is a primary host, not the only one.
- Legacy sample games are CI fixtures fetched at test time. Never commit whole games. G7 is about the GPL source, so small anonymised or authored fixtures under `packages/core/test/fixtures/` are fine.
- **Tests stay fast (Owner rule, 2026-10-28):** ordinary unit tests should finish in under 1 second individually. Run a new test by itself and inspect its reported duration. If it exceeds 1 second, profile and reduce setup, repeated rendering, or simulated ticks before keeping it. For deterministic behavior that is a pure function of inputs and tick, assert representative boundary ticks directly instead of replaying every intervening tick. Full-engine tests should cover only the smallest scenario needed to prove a cross-layer contract; any test that still takes over 1 second needs a short explanation of why a faster test would miss the behavior. Do not add wall-clock sleeps or timing-dependent assertions.
- Help text and user-facing command descriptions (the editor's help, the built-in's `docs/spec` row, the documentation site): first explain what it does in simple terms for someone writing a game, then describe the action technically and deterministically (units, ticks, order, whether the script waits) so a reader knows exactly how it will behave. Owner rule, 2026-10-17; the `earthquake` intensity text is the model.
- 3.1 is a compatibility layer, not the model ([ADR 0009](docs/adr/0009-compatibility-layer-not-the-model.md)): the core is built on objects and forward design, and legacy 3.1 names, commands and data shapes are aliases/adapters onto it. Owner rule, 2026-10-19; consistent with ADR 0005.
- **GitHub Project is the primary interface (Owner rule, 2026-10-19):** Planning happens via BMAD, but all epics, stories, and tasks must exist in the GitHub ecosystem.
  - Project Board: [RPG Toolkit Reawakened Roadmap & Tasks](https://github.com/orgs/tk-reawakened/projects/3).
  - Every BMAD ticket in `_bmad-output/` must have a corresponding GitHub issue with `tracker_id = "#<num>"` recorded in its `tickets.toml` (or leaf frontmatter).
  - New Epics are created as GitHub Parent Issues (`[Epic <num>] <title>`) with their stories attached as native sub-issues (`addSubIssue`).
  - Active sprint tasks belong to the current sprint (`sprint:@current`); unstarted future epics sit in the Backlog (`no:sprint`).
  - Branches name the ticket/issue (`feat/<ticket>-<short-name>`), and pull requests must cite their issue (`Fixes #<num>`).

<!-- CODEGRAPH_START -->
## CodeGraph (TypeScript navigation)

The optional CodeGraph index is rooted at `packages/` and lives in
`packages/.codegraph/`. **Never initialize or index the repository root**: `docs/`
and `_bmad-output/` are outside its scope. The project-local Codex MCP configuration
passes `--path packages`; launch the agent from this repository root. For other
clients, pass the absolute path to this checkout's `packages/` directory.

When the index is available, use `codegraph_explore` for TypeScript navigation, or
`codegraph explore --path packages "<question or symbol>"` from the repository root.
Use targeted searches/reads when the graph is missing or insufficient. Initialize
with `codegraph init packages --yes`; refresh with `codegraph sync packages`.
The CLI is an external development tool, not a workspace dependency.

CodeGraph does not parse RPGCode (`.rnc`/`.prg`). Its TypeScript graph is not a
language specification. Any independent RPGCode grammar must derive from
`docs/spec/`, never from `packages/core/src/script/parse.ts` (G7).
<!-- CODEGRAPH_END -->
