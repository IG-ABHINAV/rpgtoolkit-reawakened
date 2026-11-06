# Battle UI refresh tests — where the time goes, and two ways to cut it

Findings for issue [#732](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/732),
following the shared-rig change merged as [#733](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/733)
and the runtime budget in [#730](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/730).

**This is a measurement record, not a decision.** The two candidates measured in the
original investigation below were throwaway prototypes, not committed changes. Candidate A
needs an owner decision because it is a production API addition; candidate B is a production
performance fix with its own ticket concerns. Later results are recorded in section 8.

Measured on one workstation with Node 24.21.0, using the committed tests at `de837ae9` and
`tools/no-skips/run.mjs --group core-battle`. Local numbers are not CI numbers.

## 1. What a slow run looks like

A reported `--lcov` run of the `core-battle` shard took **337 s for 279 tests**. The same
command on an idle machine here takes **115.8 s**. The inflation is uniform, which is why it
is instrumentation and host load rather than one bad test:

| Measure | Reported run | Local run | Ratio |
|---|---:|---:|---:|
| shard, 279 tests | 337 s | 115.8 s | 2.9× |
| refresh-matrix sub-case | 0.9–1.8 s | 0.25–0.37 s | 2.4–4.9× |
| refresh-matrix parent | 15–21 s | 4.4–4.9 s | 3.1–4.3× |

Locally, V8 coverage alone accounts for 65.2 s → 115.8 s (1.8×); the remainder is host load
and file-level parallelism (the runner passes no `--test-concurrency`, so test files run one
process per core). `battle-ui-refresh.test.ts` is 35.9 s of the 115.8 s — 31% of the shard
from 48 of 279 tests.

## 2. Where the time inside a refresh case goes

A CPU profile of ten identical matrix case bodies attributed the samples as follows.

| Share | Cost |
|---:|---|
| 28.5% | `services.programs.get(frame.program)` in the script program cache — the cache key is rebuilt from the ref on every VM instruction (`vm.ts` step loop), and an inline ref carries its whole source text, ~100 KB for `stock_battle` |
| ~37% | state hashing after each advance: surface re-encode, FNV-1a over the surfaces, canonical serialisation |
| 6.7% | garbage collector |
| ~3% | test-rig asset authoring (boot only) |
| 2.4% | raster blits; 1.2% VM dispatch; <1% rig reading |

Per case wall time is about 350 ms: two six-tick advances (~130 ms each), one settle
advance for idle cases, and three region hashes (~20 ms each). The six-tick advances are
the behaviour under test — they cannot be shortened, and a probe confirmed that a restored
field needs 2 ticks to repaint, 3–4 for charge and a target-mode enemy HP, and 6 for a
renamed target, so six is already the true bound.

## 3. Candidate A — let a host opt out of the per-advance report hash

`advance` always computes `TickReport.stateHash` and returns it. The UI test rig never reads
it, but pays for it on every advance. An optional engine-init flag (`reportStateHash`,
absent meaning "compute it") would let a host that only observes state, pixels and
diagnostics skip that work.

Measured with the flag on the rig's engine and nothing else changed:

| What | today | with opt-out | delta |
|---|---:|---:|---:|
| one matrix case body ×10 (min of 3) | 2,876 ms | 1,834 ms | −36% |
| `battle-ui-refresh.test.ts` | 35.85 s | 17.80 s | −50% |
| same file, with coverage | 74.33 s | 31.31 s | −58% |
| `core-battle` shard, 279 tests | 65.24 s | 41.90 s | −36% |
| shard with `--lcov` (the reported command) | 115.8 s | 71.14 s | −39% |

All 279 shard tests passed with no skips, and shard coverage was unchanged (LCOV 843,834
bytes versus 844,210) because no assertion was touched. The gain is confined to tick-heavy
tests: `battle-ui-screen` 11.60 → 11.60 s, `battle-ui-lists` 14.67 → 14.51 s,
`battle-ui-overlays` 8.89 → 8.93 s, `battle-ui-ended` 9.49 → 9.49 s,
`battle-item-stack-identity` 11.00 → 10.95 s, `battle-ui-cadence` 3.22 → 3.16 s were flat.

Scaled to the reported run, 337 s would become roughly **207 s**.

### Who reads `TickReport.stateHash`

Production code, all of which would keep the default:

- `packages/core/src/ports/engine.ts` — the field itself.
- `packages/runner-harness/src/closing.ts` — per-advance hashes feeding per-tick
  checkpoints, captured frames and golden comparisons (`pnpm golden`, `pnpm closing`).
- `packages/runner-harness/src/tracer.ts` — scene results and per-tick records used by
  `scene-golden.ts` and `job.ts`.
- `packages/runner-harness/src/driver.ts` — the per-tick `state` record.
- `packages/runner-harness/src/restore-check.ts` — the THR-3 snapshot/restore comparison,
  which is the guard-rail check and compares this field between two hosts.
- `packages/runner-harness/src/script-host.ts` and `double/test-engine.ts` compute their own
  hashes through `ScriptHost` and are unaffected.

Ten core test files read the report field directly: `audio-engine`, `audio-lifecycle-engine`,
`battle-cues-engine`, `battle-fresh-load`, `engine-boot`, `engine`, `menu-state`,
`script-plugin-engine`, `surface-guard` and `surface-hash`. Each builds its own engine, so
the opt-out would have to be per engine instance — never a global switch — for those to be
provably untouched.

### Why the default keeps G3 intact

The hash is computed after every phase from finished state, mutates nothing, and only fills
the report field. With the flag absent the expression is the current call unchanged, so
replay hashes, goldens, scene records and dump output are identical. G3 is preserved
structurally rather than by inspection: only an engine that deliberately opts out ever sees
a different value, and none of the consumers above constructs one.

### Risks to weigh

1. **A guard-rail check could be silently disabled.** If a future restore or replay check
   were built on an engine that opted out, it would compare two empty strings and pass. The
   mitigation is an explicit name, a field comment, a line in the guard-rail notes that
   replay/restore engines must not opt out, and optionally having `restore-check` reject an
   empty hash.
2. **`""` is only distinguishable from "not computed" by convention.** Returning `null`
   instead would be stricter but widens the public type.
3. **It is permanent API surface** that no shipped host needs today; real gameplay hosts do
   read the hash.
4. **It is not a general performance fix.** It saves nothing for users.

## 4. Candidate B — stop rebuilding the program-cache key per instruction

The same profile shows 28.5% of a battle tick going into `services.programs.get(...)`, which
is called for every VM instruction from the step loop with `frame.program`. `programKey`
concatenates the ref's fields — including the entire inline source — into a fresh string, so
every instruction rebuilds ~100 KB of key text.

Memoising the compiled program by ref object identity inside `createProgramCache` measured:

| variant | case body ×10 | versus baseline |
|---|---:|---:|
| baseline | 2,876 ms | — |
| report-hash opt-out only | 1,834 ms | −1,042 ms |
| per-ref program memo only | 1,650 ms | −1,226 ms |
| both | 604 ms | −2,272 ms |

The two separate savings sum to 2,268 ms against 2,272 ms observed, so **the overlap is
approximately zero**: they remove different costs. This is the answer to whether the two
workstreams would double-count — they would not.

Memoising by ref identity is only sound while a ref object is replaced rather than mutated.
The current code does that (`withRedirects`, `withOwner`, the include-list extension in
`modules.ts`, and `program.ts`'s stale/fresh merges all build new objects with copied
arrays), but the invariant is implicit and needs to be stated where the memo lives.

File-level timings for a memo-only build were unstable here (24.4–41.8 s for the refresh
file) because other work was loading the machine; the in-process body figures above are
stable to about 2% and are what the overlap conclusion rests on.

## 5. Recommendation

1. **Treat the per-instruction cache key as the first fix.** It is a production performance
   improvement that also helps real gameplay, needs no API decision, and is worth about as
   much as Candidate A on its own.
2. **Then decide Candidate A on its remaining merit.** After the memo, the opt-out still
   removes roughly a third of a battle test's tick cost and about 39% of the `--lcov` shard,
   so it remains worthwhile — but it is an owner decision about adding a permanent engine
   knob, not a pure cleanup.
3. **Do not trade coverage for time.** Shrinking the field × mode matrix from 37 to 24 cases
   measured only −12% of the file and would weaken what the tests prove.

## 6. Alternatives measured and rejected

- **Fewer field × context combinations** (37 → 24 cases, keeping every field in one mode
  plus cross-mode samples): 35.85 → 31.40 s without coverage, 74.33 → 64.11 s with it. Real
  but small, and it reduces coverage.
- **Shorter restore settle** (one tick instead of six): refuted — see the repaint latencies
  in §2.
- **Fixture or asset caching**: earlier work found no end-to-end gain; not pursued.

## 7. What this record does not cover

The headless golden suite, lint, and repository-wide coverage were not part of these runs.
All timings come from one machine; the reported 337 s run differs by roughly 3× from it, so
the projected 207 s should be read as a ratio, not a promise. The profiles are sampled,
not exact; shares are indicative to a few per cent.

## 8. Later recovery and canonicalization measurements

The later battle-list and overlay investigation reduced repeated serialization without
changing the simulation or skipping state hashes. Recovery candidates now build the normal
save projection once and add their asset manifest before canonicalization. Long strings
without UTF-16 surrogate code units can use the standard JSON string escaping operation;
strings containing surrogates still go through the validating path.

On one macOS arm64 workstation with Node 24.21.0 and V8 coverage enabled, the two
affected test files passed all 11 tests in 87.74 seconds before and 51.68 seconds after
the change; user CPU was 159.82 and 89.53 seconds, respectively. The selected-row case
took 14.23 and 8.46 seconds. These local figures are not a promise about CI times.
The existing per-tick assertions, report hashes, and golden files were not changed.

The full `core-battle` coverage shard passed 304 tests in both versions. A repeated run
of the unmodified baseline reported different covered lines in an unchanged sprite
animation file; [#1330](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1330)
tracks that reporting discrepancy separately. Coverage thresholds were not changed.

References: [recovery candidates](../spec/engine/interruption-recovery.md#stable-checkpoint),
[state-hash projection](../spec/formats/save-game.md#state-hash-request-projection),
and [issue #1256](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1256).
