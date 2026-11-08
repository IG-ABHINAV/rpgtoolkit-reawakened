# Epic 13 inception proposal — P1 editor tools

## Purpose and source authority

CAP-16 and the epic envelope require usable legacy-format editors, runner loading and reopening, community-order autotiling, clean export and explicit board upgrades. `docs/editor-features.md` supplies the T-IDs, `docs/spec/formats/tiles.md`, `board.md`, `enemy.md`, `battle-data.md` and `legacy/` govern representations; `docs/guardrails.md` G1–G7 and architecture AD-18–22/29 govern implementation. The owner-approved `ux-connected-editors/connected-authoring-and-tests.md` takes precedence over earlier schematic tile-browser sketches; `EXPERIENCE.md` and `research-editor-ux-for-beginners/engagement-user-flows.md` are design proposals, not proof of capability. Linked documents remain one URI/model; authoring views synchronize, not a running game.

## Traceability and first proof

| Requirement / flow | Entry and tangible result |
|---|---|
| CAP-16, T-36, F-04 | 1 opens a real TST via 12.2, edits a pixel, saves/reopens and paints it in the correct board in web and VS Code; 2 decides art reuse, 3 completes all pixel tools and disclosed shared impact. |
| T-37, F-04 | 4 reviewed image grid extraction, transparency, padding and batch save. |
| T-38, F-04 | 5 staged two-set and GPH curation with index/reference impact. |
| T-39, F-05 | 6 TAN frame sequence and preview; 12.2 is the sole contextual browser. |
| T-25, F-04 | 7 verified community index evidence; 8 corner-aware eight-neighbour brush and neighbour updates. |
| T-56–58, T-63, F-09/F-10 | 9 enemy, 10 move/effect, 11 background; linked authored records and selected real rules provider, no fabricated battle behaviour. |
| T-23/T-26, F-03 | 12 lighting, shade and explicit bake; P0 retains ordinary board objects. |
| T-28 | 13 expanded clipboard; P0 12.1 supplies basic undo. |
| T-32, F-03 | 14 current/whole board PNG from the AD-29 compositor, no overlays; indexed at ≤256 colours, as the owner-approved images storage policy requires rather than the legacy PNG/JPEG/BMP inventory. |
| T-30/T-31 | 15 explicit coordinate and pre-vector upgrades, including objects and preserved originals. |
| T-42–44/T-46, F-11 | 16 reviewable formatter and migration UI consumes 10.5/10.7, with actual missing transformations supplied at the provider rather than a competing implementation. |
| T-73, F-13 | The spec identifies 2.x folder-layout upgrade as a non-priority non-goal; no implementation is allocated without a future owner scope decision. |
| CAP-16 overall | 18 cleanup sweep, 19 integrated acceptance including every epic Done-when criterion. |

After 13.2's human-approved reuse decision, the first runnable proof is **13.1**: select an existing tile in the 12.2 browser, open the one shared tile document, change and save a pixel, switch to the real board, paint it, reopen and see the same pixels in the runner; focusing the browser never loses the active target. This is not a disposable mock or a substitute tileset browser.

## Dependencies, lanes and open decisions

| Lane / entries | Needed providers and collision ownership | Unknowns and gate |
|---|---|---|
| Artwork 1–6 | 11.1–4 and 12.1/12.2 for the tracer; serial artwork modules; 1 owns feature registration and interface for later independent modules. | 2 evaluates candidates, license and transitive dependencies, offline/keyboard and host integration before tracer construction and any dependency install; human approves reuse or in-house, never assume a candidate. A version lacking a matching writer needs the AD-18 issue resolved docs-first. |
| Terrain 7–8 | 12.1 and 12.2; 8 after 1 and 7, owns the separate terrain brush implementation without changing browser ownership. | Sample sets, rights and complete index mapping are not known: human evidence approval in 7 is a hard prerequisite, with ambiguity blocked, not filled by a generic blob ordering. |
| Battle definitions 9–11 | 1, 11.3/11.4/11.6, 12.4 shared sprite editing; serial shared database module changes; linked encounter pool uses foundation settings. | Verify available format writers and provider interpretation, including special-move flags; preserve unknown fields and disclose unavailable provider. |
| Board enhancements 12–15 | 1, 12.1 and 12.11 object modes/inspector; serial shared board module changes. | Verify bake and coordinate conversion semantics from current specs and fixtures; upgrade is explicit and scripts are not rewritten. |
| Migration 16 | 1, 11.3/11.7 and existing 10.5 language actions/10.7 formatter. | Verify individual rewrite coverage and docs-first fill missing provider primitives; disclose unsupported fragments and host operations. |
| Integration 18–19 | 18 waits on all 1–16, 19 on 18 and the board/browser providers. | Evidence required from real saves, reopen, runner and both available hosts; report capability limits rather than silently substituting them. |

The independent lanes use separate feature modules, and 1 owns their P1 integration registration contract; changes to shared registries/config must go through that owner or be explicitly ordered before work starts, never edited simultaneously. 11.1 decides shared schemas, document services, host integration and language ownership; this epic consumes those decisions. 12.2 owns one browser and its action routing, 12.4 owns shared sprite controls, 12.11 owns existing board object modes. None of these entries duplicates their models. Parent integration must declare each actual cross-epic dependency in the initiative.

## Safety and evidence conditions

- Preserve model residue and source version under AD-18; `packages/core/src/formats/actor/enemy.ts` has a text reader but `writeEnemy` only accepts the binary minor, so a read is not proof of same-version write. Complete the normative writer or get an explicit docs-first owner ruling before any conversion; do not silently downgrade this acceptance.
- T-39 is explicitly allocated here because section 11 omits it although section 4 inventories it. T-42/43/44/46 are CAP-14 tooling with editor workflows allocated to 13.16; T-73 is a spec non-priority non-goal requiring a future scope decision, not an allocated implementation, and T-71 is not a distinct compiler.
- Editing a shared tile shows known uses and uncertain dynamic references. Select/brush is non-mutating; opening an already-open asset focuses its existing document. Cancel and failed saves preserve data; any unique-copy or multi-document undo promise requires its actual supported contract.
- Approved samples and findings must be traceable without reading GPL legacy source; fixture rights and provenance are prerequisites. Existing source readers, writers and conversion helpers are implementation inputs, not proof of every capability.
- Every entry includes focused verification; final acceptance covers independent positive and negative paths, accessible keyboard/numeric alternatives, host capability differences, failure handling and real runner loading. Paper research and previews are not usability or gameplay results.

## Independent review

P1 review passed after reconciling legacy T-32 with the accepted PNG-only authoring policy; no new format ruling is implied. See the [validation record](../../ux-connected-editors/editor-delivery-plan.md#validation-and-publication-record); implementation remains unstarted.
