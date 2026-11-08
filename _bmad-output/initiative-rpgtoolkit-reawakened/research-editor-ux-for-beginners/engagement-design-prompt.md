# Prompt: design creator engagement areas

Copy this entire prompt into a fresh design session. The repository is TK Reawakened. Set the research base to `_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/` from its root. Every relative input/output path below is resolved from that research base, not the repository root. Do not assume context from prior chat.

---

## Role and goal

You are designing how creators find and move among related authoring work in TK Reawakened. Continue the work in the two companion documents:

- `engagement-area-map.md` — creator-activity areas, their boundaries, and scenario coverage.
- `engagement-user-flows.md` — concrete journeys through those areas and their editor surfaces.

Treat these as companion research/design artifacts, not architecture, implementation claims, or feature commitments. Do not edit other files.

The owner accepted this direction: **RPG Maker clarity of purpose + VS Code workspace flexibility + Figma-like direct visual editing; game maker first, not IDE setup first.** Game and Files navigation should be available separately or together. A VSCodium/Code-OSS-style workbench is a candidate, not a selected workbench composition. Separately, [ADR 0013](../../../docs/adr/0013-desktop-shell-electron.md) already selects Electron as the desktop shell for the editor and player. Preserve G2's shared `editor-ui` host boundary.

## Input manifest — read before designing

1. `README.md` — scope, authority, evidence limits, terminology.
2. `creator-scenario-inventory.md` — all 54 scenarios (`SC-01`–`SC-54`), evidence labels, hypotheses, tensions, and current-planning reconciliation. Cover every scenario; the IDs are stable references, not priorities.
3. `creator-journey-workspace-rehearsal.md` — continuity across focused and broad work, invocation context, local/shared scope, and what is still only a proposal.
4. `decisions.md` — distinguish accepted owner direction from proposals/open questions.
5. `reawakened-fit.md` and `evidence/review-resolution.md` — planning context and corrections; neither proves delivery.
6. `../../../docs/guardrails.md` — especially G2's shared editor-UI host boundary; `../architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md` provides planning context, not proof of delivery.
7. The existing flow studies linked from `README.md`, especially flows 07–09, and `walkthroughs-house-forest-and-npc.md` where useful. They are paper proposals, not usability results.
8. `../../../docs/editor-features.md`, `../../../docs/spec/README.md`, and relevant normative pages for legacy/editor facts. Do not open legacy source code or infer shipped behavior from plans.

Link sources with relative paths from each output document. Add a **Key source files** section to each output, with relative links and a short statement of what each source establishes (and does not establish). For external visual references, use only the provided/research-described reference prose; do not copy protected assets or imply the reference proves usability.

## Design constraints

- Define an **engagement area** as a coherent creator activity/job, not a menu, file type, persona silo, or presumed permanent user mode. A creator may enter the same activity from different starting points and switch activities in any order.
- Map all `SC-01` through `SC-54` explicitly. Preserve uncertainty, contradictions, and low-evidence scenarios; synthetic scenarios are not real user evidence.
- Distinguish documented/observed legacy 3.1 behavior from proposed future experience. Cite the specific repository documentation for legacy claims; call unverified claims unknown. Do not treat a paper flow or historical report as observed usability.
- Assess current Reawakened implementation only if explicitly requested, and then only with fresh live repository/runtime evidence. Never infer that an old plan, epic, spec, or ticket shipped.
- Compare focused task work with full/broader views; show whether focus can be widened and how the creator returns, without presuming a particular shell layout. Include Game and Files navigation both as separate entry surfaces and as a combined option.
- Show how context survives transitions: originating task/question, subject/selection, pending work, and return destination as relevant. Keep per-visit/task context distinct from shared project/asset state. Make effective edit scope legible; local scope only exists where the data model supports it, otherwise say the edit is shared.
- Make safe cancel, save/durability, test/run, failure, and recovery visible in flows. Do not promise atomic cross-document undo, deterministic runs, backup/recovery guarantees, or other unverified capabilities.
- Include accessibility and a usable independent no-AI route; AI/conversation can be optional, never required to navigate or author.
- Compare the same representative flows under a Code-OSS/VSCodium-style distribution and a custom workbench, without selecting the workbench composition or smuggling in a new distribution/architecture decision. The Electron desktop-shell decision remains in force. Preserve G2 shared `editor-ui` across hosts.
- A **prioritized prototype subset** is only a research/prototyping sequence to learn from. It is not feature priority, roadmap, or implementation commitment.
- Do not require a new format, database, block round-trip, character generator, cloud service, or collaboration system. These are not accepted prerequisites or decisions.

## Required outputs

### `engagement-area-map.md`

Provide:

- Purpose, status, scope, and evidence/claim legend.
- A coherent set of proposed engagement areas, each described by creator activity, entry intents, outcomes, boundaries, and adjacent areas (not menu/file names or persona labels).
- Explicit crosswalk for every `SC-01`–`SC-54`: primary area, any useful secondary area(s), and one-line rationale. Mark uncertainty rather than forcing a false fit.
- For each area, map relevant legacy 3.1 documented/observed affordances separately from proposed future interactions; cite sources and label evidence class/confidence. Do not equate documented capability with usability.
- Shared seams/cross-cutting capabilities and tensions, without turning them into architecture decisions.
- A prioritized prototype subset, with why it is informative and what competing hypotheses it tests; explicitly state this is not feature priority.
- Sources, assumptions, evidence gaps, open decisions, and concrete creator-validation tasks (participants/conditions/tasks/observations to seek, not simulated results).

### `engagement-user-flows.md`

Provide:

- Purpose, status, scope, evidence/claim legend, and a set of end-to-end flows covering the prototype subset and contrasting creator intents/methods.
- For each flow: starting state and goal; navigation entry (Game, Files, or both); screen/state map; transitions with trigger and destination; focused versus full-view state and promotion/return behavior; context carried; shared versus local scope; save/durability and cancel; test/run state; failure/recovery; accessibility and independent no-AI route.
- Compare each same flow in both host models (Code-OSS/VSCodium-style distribution and custom workbench): what remains shared under G2, what differs, and what is still unknown. Do not choose a workbench composition.
- Cover creating and returning to linked work, existing/missing references, selection/creation, context preservation, and broad management without implying missing assets should be silently created.
- Cite source-backed facts separately from design proposals, assumptions, and hypotheses. Include validation tasks and unresolved interaction decisions.

## Acceptance checklist

Before handing off, confirm:

- [ ] Both named companion files exist and link to each other and the research sources with relative paths.
- [ ] Every `SC-01`–`SC-54` appears explicitly in the map crosswalk; no scenario is silently omitted or presented as a persona.
- [ ] Legacy 3.1 documentation/observations and future proposals are visibly distinct and sourced.
- [ ] No implementation is claimed from old plans; no live implementation claims without requested fresh evidence.
- [ ] Game and Files work as separate or combined navigation; focused/full-view and return/context behavior are mapped.
- [ ] Shared/local scope, cancel/save/test, failures/recovery, accessibility, and no-AI paths are addressed.
- [ ] Both host models are compared on the same flows without an early workbench choice; G2 and the existing Electron desktop-shell decision are preserved.
- [ ] Prototype ordering is explicitly not feature priority; sources, evidence, assumptions, open decisions, and creator-validation tasks are present.
- [ ] No rejected prerequisite or unapproved format, database, block round-trip, character generator, cloud, or collaboration decision is introduced.
- [ ] Neither synthetic scenarios nor paper rehearsals are described as real-user evidence.

## Key source files

- [Engagement-area map](engagement-area-map.md): complete scenario crosswalk and the accepted/open split.
- [Expanded flow rehearsals](engagement-user-flows.md): proposed actions and recovery, not executed editor behaviour.
- [Scenario inventory](creator-scenario-inventory.md): original evidence and confidence.
- [Decisions](decisions.md): owner direction versus proposals.
- [Guardrails](../../../docs/guardrails.md): binding architecture boundaries.
