# Epic 15 inception — independent desktop editor

The desktop editor is a separate Electron application, not a mode of the player. First prove that a creator can open a real game settings file, change it, save it and reopen it through the same shared editor model and UI used by other hosts. Then complete host security, lifecycle, native entry points, shared features, actual three-platform measurements and an independently signed and updated release. This is a delivery plan, not evidence that any of those operations already work.

## Requirements and boundaries

| Source | Desktop obligation | Entries |
|---|---|---|
| CAP-18; Done when 2–3 | Own `host-desktop` platform-services, shared UI/model, open/edit/save/reopen, no host-only editor feature | 1–6, 10 |
| CAP-18 / T-82 | User-initiated editor association and project entry, without conflating it with the player | 4, 7, 10 |
| Done when 1; ADR 0013 | Record decision, editor-specific I/O/watch/dialog/association/drop results on Windows, macOS, Linux, with real board editing | 7, 10 |
| ADR 0013; G6 | Separate app, harness preview, app:// secure scheme, no service worker, shared Electron version and binary inventory, independent signing/notarisation/updater/cadence | 1–2, 6–8, 10 |
| AD-18/19/20/21/22/29; G2 | Shared format round-trip, one document per URI, host undo/save, platform-services-only access, transport-free tooling, boundary and shared board compositor | 1–7, 10 |
| Experience and connected-authoring proposals | Shared Game/Files and linked views, honest save/conflict state, explicit test revision; authoring synchronization is not game hot reload | 3–6, 10 |

Epic 11 owns shared documents and services; Epic 12 owns P0 asset editing. The early desktop tracer does not wait for the whole P0 epic, or any P1/P2 editor; final acceptance consumes 12.14's complete P0 creator journey. Desktop implements only host chrome, adapters, lifecycle, security, packaging and release. The player is not turned into an editor. Test-only and unavailable capabilities stay explicitly labeled.

## Build order, lanes and dependencies

| Entry | Lane / output | Pinned prerequisites | Gate or uncertainty |
|---|---|---|---|
| 15.1 | Host tracer: shared `.gam` open/edit/save/reopen | 11.1, 11.2 | 11.1 contract before implementation |
| 15.2 | Host security and constrained IPC | 15.1 | project authority and external-link policy must be documented within shared contract |
| 15.3 | Host lifecycle and watches | 15.2, 11.3 | external-change and recovery behavior must preserve dirty data |
| 15.4 | Native entry/association | 15.3 | HITL OS association behavior and explicit consent |
| 15.5 | Shared workspace/preferences/Monaco adapters | 15.4, 11.4, 11.5, 11.7 | shared integration contract, no separate document identity |
| 15.6 | Embedded preview and creator tests | 15.5, 11.8, 11.9 | real fixture/action support only; no silent hot reload |
| 15.7 | Platform measurements on board | 15.6, 12.1 | HITL access to all three actual platforms; report failures, not assumed support |
| 15.8 | Signed independent editor distribution/update | 15.7, 9.10 | HITL signing credentials, Apple notarisation account, release access and platform-specific update policy; real independent player artifact required |
| 15.9 | Refactor sweep | 15.1–15.8 | cleanup only |
| 15.10 | End-to-end production acceptance plus shared P0 author-to-package proof | 15.9, 12.14 | HITL signed artifacts, three OS environments and evidence; early tracer remains narrow |

The desktop host is one integration lane: entries 1–6 sequence shared package configuration, bridge, registration and chrome changes. Measurement and release consume that integrated host. Shared-service and board-tracer work in other epics may proceed concurrently; the exact 11.x/12.x prerequisites are pinned and declared at initiative level, not evidence that those providers already exist.

## Decisions and risks

| Decision or unknown | Plan and effect if different |
|---|---|
| Shell | Electron is already selected by ADR 0013, including version maintenance and separate app identity; a divergence needs a superseding ADR, not an in-epic shell spike. |
| Host contract details | Follow 11.1, document any remaining OS-scoped access, URI/IPC and lifecycle decisions before affected implementation; an incompatible choice changes 15.2–15.6 and requires shared-contract coordination. |
| Association registration | Explicit user action; packaging and OS permission mechanics must be proven on each platform; unsupported or rejected registration must be explained, not silently claimed. |
| Update distribution | Choose and document editor update channel, signature trust and failure/rollback policy before implementation; OS-specific limitations must be visible, never reported as successful updates. |
| Credentials and machines | A human supplies authorised signing/notarisation credentials, distribution access and Windows, macOS and Linux environments; absent access blocks 15.7/15.8/15.10, never a substitute test double. |
| PWA/VS Code parity | Consume their shared UI and contracts rather than importing either host; compare behavior, not a promise of unsupported browser filesystem features. |

## First runnable proof and final acceptance

The first demonstrable artifact is the independent Electron editor opening an actual `.gam`, changing a settings field in the shared UI, saving via desktop platform services and reopening the persisted value after restart. It waits only on the shared contract and the 11.2 tracer, not the board editor.

The final per-platform journey installs a signed editor, opens a project through each supported native entry route, edits and saves both `.gam` and the 12.1 board, restarts and reopens, observes a real external change without losing dirty data, exercises cancel/failure and recovery, opens a program with shared language feedback, runs a real preview and fixture with identified revisions, and updates the editor without changing the separately installed player. Record OS/version/architecture, artifact version and digest, signing/verification and update evidence, exact operations, observed results and any failures; an unsigned local run is not production-release proof.

## Source reconciliation and verification status

The old package map and ADR 0001 shell-spike wording predate ADR 0013. The initiative now names 12.1 for the early board tracer and 12.14 for full desktop acceptance. CAP-18's older success clause explicitly names VS Code and PWA; this epic additionally proves desktop. The retained audit's missing-parent claim is historical: #1361 exists. No shell choice is reopened.

Planning checks and independent review are recorded below and in the linked delivery plan. No platform, signing or runtime acceptance is claimed. No desktop requirements are intentionally deferred; broader editor features stay with their owning epics.

## Independent review

Desktop review passed after pinning the independent player application before release and the full P0 journey before final acceptance; the early tracer stays narrow. See the [validation record](../../ux-connected-editors/editor-delivery-plan.md#validation-and-publication-record); no OS, signing or runtime acceptance is claimed.
