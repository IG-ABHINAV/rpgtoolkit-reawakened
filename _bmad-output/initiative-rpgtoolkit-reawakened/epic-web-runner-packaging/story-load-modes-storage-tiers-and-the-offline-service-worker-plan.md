---
title: 'Load modes, storage tiers and the offline service worker'
type: 'feature'
ticket: '9'
tracker_id: '#934'
created: '2026-11-01'
status: 'done'
plan_checkpoint: true
baseline_revision: '436c78d65f06c6b6fe31c2330fae9cfc35e88bca'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - 'docs/spec/engine/runners.md'
  - 'docs/guardrails.md'
---

**Delivered:** PR #1041 merged as `62c2ba14`. OQ1 remains as recorded below: first streaming launch transfers the whole archive once for validation; this is an approved property, not a gap. The cited PR does not record independent review approval or the three F6 perturbation reruns; their provenance is unverified here.

**What changed since 454230a1:** The web and desktop pages now use a persistent `createLiveSession`, with fixed-tick accumulation, presentation and pointer/keyboard/focus input; the scripted page remains a measurement/tracer path, not the player. Package creation and interactive loading now agree on the content-derived `GameId`. The browser build already emits `apps/bundled.json`, although the web player still obtains its bytes through `/api/bundled`. The demo state baseline moved: use the board record in `golden/regression/closing.json`, not the old literal. The live pump still has no tiered source, discards prefetch and audio cues, and its current package and blob adapters are not this story's offline implementation.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The live player loads and expands a whole package before starting, fetches bundled assets through an API, and has no offline service worker, load-mode policy, streaming source, observable stall/quota state or decode-ahead path. A locally stored blob adapter exists but does not establish the specified durable, quota-aware offline contract.

**Approach:** Extend the existing `createLiveSession` request pump with a tiered asset source, nonblocking prefetch/decode, durable blob host and observable loading state. Select whole-package or streaming mode using a measured threshold; add the web shell's progress/spinner and a next-launch-only offline worker. Reuse the existing engine, fixed-tick loop, input mapping and presentation; do not create a second player loop.

## Boundaries & Constraints

**Always:** Core stays I/O-free and deterministic (G2/G3); renderers only replay draw lists (G4); the runner does not parse boards for prefetch; hints never block simulation or alter hashes; the threshold is measured; preserve package validation and the same content-derived `GameId` across modes and reloads; the service worker never reads saves and never replaces a running session's worker; no worker in desktop `app://`. Preserve desktop and mobile consumers of the shared session.

**Never:** implement launch resolution, the library, default-game selection or bank picker; change `runClosingFrames`/`runLog` behavior or silently re-record goldens; introduce a second board parser, bank cache, per-entry manifest hashes, or a new player loop. A normative spec amendment, if needed, is a separate owner-approved prerequisite, not part of this plan-only change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Whole package | total uncompressed size at or below measured threshold | validated download with progress, kept and booted | refuse mismatches; report quota and fall back |
| Streaming | forced mode or total uncompressed size above threshold | tiered, on-demand assets and decode-ahead hints | report every actual blocking stall, including unhinted ones |
| Blocking stall | engine loading on an asset | retain last frame; spinner only after 300 ms; already-playing cues continue | answer each blocker; never drop a reply |
| Package-cache quota | durable package put fails with quota | quota state visible, streaming fallback still boots | no silent failure or loop termination |
| Offline relaunch | shell, descriptor, bundled assets and package cached | same demo board baseline and same-GameId save restores; no `/api/` request | surface cache miss as a load error |
| Deploy during play | new worker installed | current session keeps its controller; update takes effect on next launch | never force a mid-session takeover |

</frozen-after-approval>

## Code Map

All anchors below refer to baseline `436c78d65f06c6b6fe31c2330fae9cfc35e88bca`.

- `packages/runner-web/src/live-session.ts:28-55,88-117,180-235` — options currently require a fully populated `files` map; the asset index, main bytes and identity are built at boot. `hostReply` reads assets synchronously from that map, strips the GameId prefix once for `LiveBlobHost`, and ignores prefetch; the pump collects replies but never consumes `report.audioCues`. Integrate the source here, not beside it.
- `packages/runner-web/app/main.ts:25-60,74-91,134-168,171-248` — interactive boot downloads the whole package, validates the sidecar, fetches a static manifest then calls `/api/bundled`; its localStorage blob adapter, tick accumulator, input wiring and drawing already exist. `packages/runner-desktop/app/player-live.ts:1-4,25-49,62-80` shares this session and pointer mapping. Keep its existing contract or migrate every host, including mobile.
- `packages/runner-web/src/index.ts:67-75,85-99,123-135,156-183` — API helpers, synchronous texture provider, whole-package decode, and SHA-256/size/derived-identity validation. `tools/browser/build.mjs:17-23,41-50` already emits the bundled manifest; extend its entries and consume its file list instead of recreating it. `tools/browser/serve.mjs:43-81` serves only allowed static roots and does not implement range responses or a worker-scope header.
- `packages/core/src/ports/engine.ts:57-73` and `packages/core/src/engine/engine.ts:3099-3107` — reports carry requests, cues and `loading`. `packages/core/src/ports/requests.ts:32-43,67-75` defines blob requests and reply-free prefetch. `packages/core/src/engine/engine.ts:1505-1526` handles blob restoration.
- `packages/core/src/prefetch/plan.ts:41-59,68-97` and `packages/core/src/engine/engine.ts:1800-1863` — actual facts and emission; notably edge-linked music is included only when linked board bytes are already cached. The normative table is `docs/spec/engine/runners.md:223-238` (see OQ4).
- `packages/runner-web/src/audio-sink.ts:36-40,135-138` and `packages/synth/src/cue-player.ts:142-143,423-426` use synchronous byte lookup. `packages/synth/src/source.ts:25-29` describes a stateful pull voice. The live pump currently drops cues, so connecting and testing audio delivery is necessary; rebuilding the input/presentation loop is not.
- `packages/core/src/formats/package/package.ts:169-180` and `packages/core/src/formats/package/zip.ts:451-454` consume whole archive bytes. `packages/core/src/save/game-id.ts:49-60,63-74` derives identity from every file's content, then derives `GameId` from that identity and main bytes. `packages/runner-web/src/index.ts:156-183` also verifies SHA-256, size and descriptor identity before returning the package. These are real streaming constraints, not an existing range seam.
- `tools/make-package/run.mjs:121-143` and `packages/runner-harness/src/closing.ts:434-443` establish the matched package identity (OQ2). `golden/regression/closing.json:12-27,46-55` is the demo tick-120 state/draw/command baseline; `golden/closing/plan.json` supplies its replay recipe. The harness is the oracle, not the production loop (`packages/runner-harness/src/driver.ts:112-123`).
- `packages/core/src/script/builtins/files.ts:113-114` emits the save request; `packages/core/src/ports/startup.ts:18-35` shows startup's distinct `SavedGamePort`. Blob keys use `area:path` in `packages/runner-harness/src/script-host.ts:96-98`; preserve the live host's existing single-prefix handling rather than prefixing twice.

## Tasks & Acceptance

**Execution:**

- [ ] Measure the uncompressed sum for every fetched corpus package, report the largest and round up to whole MiB; fail loudly when fixtures are absent. Add `pnpm corpus:measure --check` and a CI gate. Record corpus, largest, threshold and date in `docs/spec/engine/runners.md:203-217` in a separate docs-only prerequisite commit before implementation. No threshold is invented in this plan.
- [ ] Correct the prefetch table to match the landed planner in its own owner-approved docs-only prerequisite commit (OQ4), independently of the measured-threshold commit and before implementation.
- [ ] Apply OQ1's approved validation and range strategy. Build a package source that retains L1–L21/path/CRC protections, descriptor size/SHA verification, content-derived identity and main/index validation; handles range support and rejection/missing-server behavior explicitly. Make the initial validation cost and full first-launch download visible.
- [ ] Add a mode controller and source with memory → durable Cache Storage/OPFS → network lookup, progress, injectable threshold/mode for tests, cache keys by package SHA-256, and quota/unpersisted state. A failed package-cache put switches to the real single-file package streaming source, not a test-only endpoint. Specify and exercise the network-unavailable cache-miss error.
- [ ] Adapt `createLiveSession`: bootstrap with validated main bytes, `gameIdentity` and complete asset index; replace the `files.get(request.key)` branch in `hostReply` with asynchronous source lookup and retain request IDs/tick reply semantics. Feed successful bytes into shared synchronous texture/audio caches, not a second loop. Consume `prefetch` requests as nonblocking prioritized source/worker jobs; expose all actual blocking asset stalls and elapsed time. Preserve desktop/mobile callers, deterministic stepping and the existing `advance` queue.
- [ ] Add decode-ahead worker(s), covering images, WAV/ADPCM, MIDI and SoundFont validation/appropriate preparation as resolved in OQ3. Integrate the existing audio pipeline with `report.audioCues`: preserve cue order, keep already-playing audio alive during stalls, and make needed bytes available to its synchronous reader. Do not block simulation merely to wait for a hint: handle same-report cue asset readiness asynchronously while preserving cue order, and test first-board music audibly/through sink events. Do not make a second bank cache.
- [ ] Replace the web blob adapter with a durable, quota-aware `LiveBlobHost` for `saveBlob`, `loadBlob`, `listBlobs`, isolating `area` and `GameId` and preserving the existing prefix-stripping contract. Request `navigator.storage.persist()` where supported and expose its result and quota failure. Save bytes never enter service-worker caches.
- [ ] Author a small spec-derived game fixture that performs real `Save("slot")` and later `Load("slot")`; generate a deterministic independent headless baseline using the same real engine and request/reply protocol with an in-memory blob host. Do not treat the startup `SavedGamePort` or a script-only fake as a real full-engine save. Commit fixture expectation and wire its generation/check into the existing authored fixture convention.
- [ ] Extend the existing web page with load progress and a spinner overlay on the last presented frame after **more than** 300 ms of blocking; use an injectable clock. Ensure the UI timer and audio continue while `session.advance()` is pending: the current page schedules its next animation frame only after that promise resolves. Keep its existing input and draw wiring.
- [ ] Build/register a web-only service worker at a scope that actually controls the player. Cache versioned shell, `apps/bundled.json`, the bundled files (including default bank), package and descriptor needed to boot; use the manifest's file list, not `/api/bundled`. Never route/cache save operations. Hold a newly installed worker until the old session ends, then activate for the next launch without mid-session `skipWaiting`/`clients.claim` takeover. Add server headers/range support only as required by the chosen scope and source; test actual registration/control, not merely worker installation.
- [ ] Add unit and browser coverage for mode selection, validation, all tiers, quota and persist state, stalled/missing assets, spinner clock, decode/cue ordering, save isolation, offline cache miss/relaunch, worker upgrade and desktop/mobile compatibility. Update relevant implementation-facing documentation and changelog in the implementation work, without changing unrelated specs.

**Acceptance Criteria:**

1. Given `demo.tpk` loaded and cached once, block the network and reload under service-worker control. With the `golden/closing/plan.json` recipe, reach tick 120 and compare state hash, draw hash and command count to the `games.demo.frames` record labelled `board` in `golden/regression/closing.json`; issue **no `/api/` request at all**, including failed requests. Also test an offline miss is reported. Do not hardcode the retired or current hashes.
2. Given the authored fixture executing a real `Save("slot")`, reload and execute `Load("slot")`; observe `saveBlob` and `loadBlob` with the same `GameId`-prefixed path, compare the post-load state to the independently recorded headless fixture baseline, and inspect Cache Storage to prove save bytes are absent. Verify separation for a different GameId.
3. Given forced streaming and a delayed unhinted asset, reach a fixed tick; at least one actual blocking stall is recorded, every recorded stall is unhinted, and no hinted asset appears as a stall in this controlled scenario. Verify the first board's music is actually delivered after its needed bytes are ready, including when cue and hint share a report. Hints must not block the engine.
4. Given a quota exception from the durable package-cache put, expose `state.storage` as quota-limited and `state.mode` as streaming, and still reach a deterministic hash using real range-backed access to the same single-file package; independently report an unpersisted result. This acceptance is blocked until OQ1's production path is viable, not replaced by a folder or test endpoint.
5. Given a blocking stall and fake clock, at 250 ms there is no spinner and at 350 ms there is one over unchanged frame pixels; cue handling continues. Resolve the request and verify the spinner disappears and simulation resumes.
6. Given an open, controlled page and an updated worker, prove the open session keeps its old controller and assets; close it, launch again, and prove the new worker controls the next launch. Also verify no service worker is registered on desktop `app://`.

## Owner Rulings and Resolved Questions

1. **Single-file streaming and verification. Approved ruling (owner: Jensen, 2026-11-01).** `package.ts:169-180` and `zip.ts:451-454` take whole bytes; `packages/runner-web/src/index.ts:156-183` and `packages/core/src/save/game-id.ts:49-60` require whole-archive SHA and content-derived identity. Validate the whole archive once with bounded memory and unchanged L1–L21, CRC, manifest, SHA and content-derived identity checks, then discard non-essential bytes and fetch entries by validated ranges on demand. **First launch still transfers the whole package.** Protect against changed bytes between validation and range reads using immutable/versioned URLs or validated strong ETags and conditional ranges. Rejected: test-only endpoints, folder-only fallback, and trusting an unverified sidecar.
2. **GameId parity — resolved.** `tools/make-package/run.mjs:121-143` writes `deriveGameId(mainBytes, derivePackageIdentity(files))`; the descriptor's value changed from the old title-derived value. `packages/runner-web/src/index.ts:177-183` recomputes and verifies the same pair; `packages/runner-web/src/live-session.ts:112-117,134-140` passes identity to the engine, as the closing harness does at `packages/runner-harness/src/closing.ts:434-443`. Keep this parity in both load modes and save tests. The title-derived alternative is rejected.
3. **Worker decode scope. Approved ruling (owner: Jensen, 2026-11-01).** Audio reads are synchronous (`packages/runner-web/src/audio-sink.ts:36-40,135-138`, `packages/synth/src/cue-player.ts:142-143,423-426`) and `SourceVoice` is stateful (`packages/synth/src/source.ts:25-29`). Expose a pure decode/preparation seam for WAV/ADPCM and run it in the worker beside image decode and MIDI/SoundFont preparation; retain stateful playback and the single bank cache on the host. Name any format that cannot be prepared this way as a gap; do not silently drop it. Rejected: silently leaving PCM on the main thread and declaring worker scope complete.
4. **Prefetch table drift. Approved ruling (owner: Jensen, 2026-11-01).** `docs/spec/engine/runners.md:230-234` overstates the landed planner (`packages/core/src/prefetch/plan.ts:41-59,68-84`, `packages/core/src/engine/engine.ts:1800-1823`), including current-board assets, animation sounds and literal `send(...)` targets; linked-board music depends on cached bytes. Correct the normative table to the landed planner in its own owner-approved docs commit before relying on it; do not test around the discrepancy. Rejected: leaving the normative table overstated.

## Design Notes

A full verification pass followed by entry-range reads is **not** a reduction in first-launch network bytes; it bounds retained memory and enables on-demand later asset retrieval. Offline relaunch requires a successfully kept package and cannot be promised after quota prevented caching. Current `createLiveSession` requires a full map and derives its index at construction, so adapting its bootstrap contract and synchronous render/audio caches is necessary; simply swapping the existing `files.get` for `fetch` is insufficient. Apply OQ1's approved validation decision before claiming streaming complete.

The previous draft's advice to await hinted assets before advancing the report conflicts with the normative nonblocking-hint rule (`docs/spec/engine/runners.md:236-238`). Schedule hints and cue preparation independently; only an actual blocking core asset request may freeze simulation. The UI overlay must be driven independently of the currently pending `advance` promise.

## Verification

Implementation owner runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:strict`, `pnpm browser:test`, `pnpm make-package:test`, `pnpm corpus:measure --check`, `pnpm licence`, `pnpm provenance` and `pnpm graph`, plus desktop/mobile compatibility checks. Review actual browser network and service-worker-controller evidence and the save bytes/cache assertion; never regenerate closing goldens merely to pass. These are proposed future checks, not checks run for this plan.
