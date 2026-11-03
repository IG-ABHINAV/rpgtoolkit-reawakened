---
title: "The runner contract page, its message schema and the vector kit"
ticket: 2
status: done
tracker_id: "#927"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/927"
---

# The runner contract page, its message schema and the vector kit

## Intent

Make the runner boundary checkable rather than prose: one language-neutral schema for the records that cross it, one
vector kit a non-TypeScript runner can replay, and gates that keep both equal to `core`.

## Scope

The page itself landed with entry 1 (`docs/spec/engine/runners.md`, one docs-first commit per ruling), so this entry
delivered the limb the page names at `#conformance-lane`:

- `packages/runner-harness/schema/runner-protocol-v1.schema.json` — JSON Schema 2020-12 for the three families: the draw
  list (all eight AD-3 commands), the input record (all eleven AD-14 events) and the host request (all eight AD-5/AD-17
  kinds). Fixed keys, `additionalProperties: false`, absence as `null`, byte leaves as base64 under an enforced pattern.
  Audio is not restated; it stays `packages/synth/schema/audio-protocol-v1.schema.json` (AD-16).
- `tools/fixtures/runner-protocol/{generate.mjs,vectors.json}` — 38 vectors, one valid record per kind plus eight
  refusals, with `--check` on the `audio-protocol` pattern.
- `packages/runner-harness/test/runner-protocol.test.ts` — a dependency-free evaluator for the schema subset used, the
  vector verdicts, and the drift gate: a per-family table of every key of every kind, checked against the core type by
  `satisfies`, by a `never`-exhaustive exclusion, and against the schema's `properties`.
- `package.json` — `runner-protocol:check`, in `oracle:check` and `fixtures:test`.
- `docs/spec/engine/runners.md#conformance-lane` — now describes the kit that ships.

## Landed

**Merged 2026-10-31 in `a9c23513f8512013c98fc9c84a47d0251831418b`** (PR #972, squash), in two commits:

| Commit | Carried |
|---|---|
| `58c81773` | the schema, the kit, the generator, the evaluator test, the script wiring, the page correction |
| `e848fa65` | the independent review's fixes — the generator no longer writes on import (so `check()` can fail), the per-kind key-set gate, the base64 pattern and its refusal vector, the `repeat` key on the page, and the same import-time guard on `tools/fixtures/audio-protocol/generate.mjs`, whose fixtures test could never fail for the same reason |

Both review findings were blocking and were proved fixed by probe: tampering with the kit now fails the fixtures test,
and adding a field to `BlitCommand` now fails the type check until the schema and its vectors follow.

## Gates at the merge

`pnpm typecheck`; `node --test "packages/runner-harness/test/"*.test.ts` 136 pass (the new file: 5 tests, 298 ms);
`pnpm fixtures:test` 99 pass; `pnpm runner-protocol:check`; `node tools/no-skips/run.mjs --verify-groups` 8 groups /
189 files; `pnpm lint`; `pnpm provenance` 725 files, 0 violations. No dependency added.

## Close-out record

Merged in PR #972 (merge commit `a9c23513f`, 2026-10-31). Verified against the
2026-11-03 audit: `pnpm runner-protocol:check` exists at merged main and was
rerun green during the #1218 gate; the audio protocol schema and vectors are
reused rather than duplicated. Ledger entry reconciled to closed issue #927.
