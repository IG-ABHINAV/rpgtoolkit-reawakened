---
title: "Core: the prefetch planner and the AD-5 hint wire"
type: 'feature'
ticket: 8
created: '2026-11-01'
status: done
tracker_id: "#933"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/933"
baseline_revision: '4387b66a'
risk: 'medium'
context:
  - 'docs/spec/engine/runners.md#prefetch and #audio'
  - 'docs/spec/engine/audio-media.md#audio-prefetch'
  - 'spine AD-5, AD-17'
  - 'packages/core/src/ports/requests.ts, packages/core/src/script/manifest.ts, packages/runner-harness/src/driver.ts'
  - 'docs/guardrails.md, G3 (determinism)'
---

# Core: the prefetch planner and the AD-5 hint wire

## Intent

Give a runner the plan instead of the guess: the core computes which assets to fetch and decode ahead, in three tiers,
and sends it as a stream request that no hash reads, so a host that ignores hints and a host that uses them present the
same frame.

## The wire record and the plan

```text
PrefetchRequest = { kind: "prefetch", reqId: integer, hints: PrefetchHint[] }
PrefetchHint    = { tier: "now" | "next" | "always", key: AssetKey }
```

`planPrefetch` (`core/prefetch/plan.ts`) is a pure function of the facts the engine already holds. A key appears **once**,
in the earliest tier it belongs to (`now` > `next` > `always`), and the list is ordered by tier then key, so one board
always yields one signature and a repeated entry sends nothing.

| Tier | What lands in it |
|---|---|
| `now` | the current board's `backgroundMusic`; the default bank when that music is a MIDI |
| `next` | the music of boards reachable by the current board's edge `links`; the battle background's `music`, `menuMoveSound`, `menuChooseSound`, `readySound` and `cantDoSound` |
| `always` | the main file's `cursorMoveSound`, `cursorSelectSound` and `cursorCancelSound`; the default bank |

Emission: every board-entry path sends the plan when its signature changed — boot's scene board, an ordinary `send`, a
recovery resume and a return from battle.

## Decisions taken here

1. **A hint's `reqId` comes from its own counter.** The first draft drew from `nextRequestId`, which lives in the saved
   `engine` section — and every sample game's state hash moved. A request that must change nothing cannot draw from a
   saved counter; the hint has its own, and `pnpm closing` went from 4 drifted baselines back to 8/8.
2. **Dedupe across tiers, earliest wins.** One file is fetched once even when it is both the board's music and a linked
   board's music; the tier list stays meaningful per tier.
3. **A hint never causes a read.** A linked board's music is hinted only when that board's bytes are already in the
   cache, and the battle background's sounds only when the `.bkg` is already cached; the hint is a plan, not a fetch.
4. **Two shares of the audio table are not in the plan yet, and the reason is a seam rather than the rule:** the `.anm`
   frame sounds of the animations a board uses (needs a board-actor walk the hydrated board does not carry) and literal
   `send("<board>")` targets (needs a scan of the board's compiled program sources). Both are recorded on `runners.md`
   so no runner guesses them locally.
5. **Every consumer the union touches knows the kind:** `HOST_REQUEST_KINDS` (with its `never` default intact), the
   harness's `isRequest` guard (a hint is validated and observed, never dropped), the runner-protocol schema plus two
   generated vectors, and the port-contract fixtures.

## Verification

- `packages/core/test/prefetch.test.ts` (5): the tiers and their exact contents; a WAV's music does not pull the bank
  into `now`; dedupe and order; an empty plan sends nothing; **both ways** — one board run against a host that observes
  hints and one that discards them has the identical state hash and draw hash, while the observing host really did see
  `now:media/town.mid`.
- `packages/runner-harness/test/runner-protocol.test.ts`: the kit covers the new kind (13 request vectors), and the
  schema's `prefetchRequest`/`prefetchHint` carry exactly the core type's keys.
- `pnpm closing` 8/8 and `pnpm golden` 20 rows byte-identical, which is the suite-level version of the same proof.

## Landing

Merged as **`c6c2f620`** — "feat(entry 8): the prefetch planner and the AD-5 hint wire" (PR
[#1001](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1001), squash; #933 closed as completed). One
commit.

The first draft drew a hint's `reqId` from the saved `nextRequestId` and drifted four closing baselines; the fix — the
hint's own counter — is the entry's most important line, and the both-ways test is what would catch a regression. CI run
41259174964 green on every check, including `unit (core-*)`, `golden`, `golden-bun`, `checks` and the coverage `gate`.

## Out of scope

The runner's consumer (load modes, the service worker and the decode-ahead worker are entry 9), bank prefetch policy
(entry 9), and the two table shares named in decision 4. The live interactive player page is entry 16.

## Close-out record

Merged in PR #1001 (merge commit `c6c2f620b`, 2026-11-01). Verified: the
engine emits the ruled tiered hints for a board with music, a battle
background and menu sounds; `HOST_REQUEST_KINDS` and the request union compile
and an exhaustive switch keeps `never`; `pnpm golden` and `pnpm closing`
hashes are identical with and without hint consumption, and the
withholding-host and undecodable-background edges were later hardened by PR
#1144 (`4eb1c9f8`) for #1081/#1142. Honest caveat, recorded rather than
rewritten into the verify: the verify's latency-fuzz replay test was never
implemented; the order-independence evidence instead lives in `engine-boot.test.ts`
("boot keeps simultaneous asset requests waiting across delayed replies and
hashes their completion independent of order", ~line 2471) plus the golden
suites' per-tick batching rows (1/3/5/7 and the mocked batching rows), which
are the substitute evidence for the same property. Ledger entry reconciled to
closed issue #933.
