# Interruption recovery

**Owner-approved rule, implemented (#777, #778, #779, #782, #783).** Interruption recovery is distinct from normal `Save`/`Load` and saveable VM snapshots; it does not weaken [G1](../../guardrails.md) or change existing mid-battle snapshot continuation. The approved contract and source evidence are in [the recovery decision](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-menu-party-save/recovery-checkpoint-proposal.md). Ledger fields, identity, migrations and validation belong to #776.

<a id="stable-checkpoint"></a>
## Stable checkpoint

A recovery checkpoint represents committed game progress, a board identity and an arrival location, not a serialized continuation of an in-progress scene or battle. A game explicitly marks a settled script point as safe with [`checkpoint()`](rpgcode-functions.md#program-flow-errors--debugging), or the engine may nominate the conservative coherent pre-commit state immediately before battle state changes. A tick boundary alone does not prove authored multi-tick logic is complete; the script author's declaration is not proof of correctness for arbitrary game code.

For an explicit checkpoint request, unknown eligibility means no capture. It requires a running boot, no open tick, no pending host request or blob operation, no deferred image effect or board preview, no board transition or video, no active battle, no menu screens, an active board and selected player, and no failed engine. The pre-battle callback is the sole open-tick exception: it may capture the current open tick immediately before battle commit while `battle === null`, provided every other eligibility condition holds. Do not advance gameplay or run callbacks between checking eligibility and serialization.

### Candidate API and capture timing

`Engine.recoveryCandidate()` returns `{ bytes: Uint8Array, tick: number }` or `null`. Its canonical JSON contains the normal game-save state and audio projection plus a versioned recovery manifest. The manifest fingerprints required board, dependency and program assets and records established associations for startup-created ordinary listener targets that survive in the ledger. The candidate is not an ordinary save slot. `restoreRecoveryCandidate` validates the manifest as well as the save shape; hosts must additionally validate game identity, integrity and ledger consistency before promotion or selection.

Candidates captured before the manifest existed lack capture-time fingerprints and cannot establish the required asset compatibility. Refuse them for recovery without deleting or replacing stored bytes; a later valid capture may be promoted normally. A recovery launch requires compatible required assets and supported formats, not an exact application or game version number. Missing or changed required assets refuse recovery. Ordinary saved-game compatibility and migrations remain separate: reliable version-to-version loading is a project goal, and the normal-save rules are in [save-game.md](../formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling); a recovery candidate additionally requires like-for-like format, so any `ir` (instruction-version) difference refuses it even though a normal `Load` would restart the affected thread. This recovery contract does not change normal save bytes, normal `Save`/`Load` semantics, or `hashGameState`.

For an explicit request, `checkpoint()` only records the request; it does not wait, capture synchronously or advance gameplay. The engine serializes only when the runner asks for a candidate at an eligible settled point. For pre-battle capture, the engine serializes in the validated before-start callback at the coherent pre-commit point, even if the current open tick remains. A request is one-shot: that call consumes it whether it returns bytes or `null`; a serialization failure also returns `null` and clears the request. With no pending explicit request or queued pre-battle candidate, the API returns `null`.
When an explicit request and a pre-battle candidate are both pending, an eligible explicit capture supersedes and discards the older candidate. If the explicit request is ineligible, the queued pre-battle candidate is returned once instead.

The battle owner may invoke an optional before-start callback only after validating the battle start and immediately before changing battle state. The engine applies all eligibility checks except the no-open-tick rule, with `battle === null`; the callback may capture the coherent pre-commit ledger while a script-issued battle still has its current tick open. It serializes then and holds the candidate across battle start so the runner can retrieve it once after the battle has begun. This is a checkpoint of the pre-battle state, not a promise or mechanism to restart a battle from its ledger. A rejected start does not invoke the callback.

The core neither validates candidate identity, version, integrity or ledger consistency nor writes host storage. On `null`, serialization failure, validator refusal or publication failure, the host keeps its previous validated checkpoint. It validates and promotes returned bytes according to its storage guarantees; an unsafe or unavailable candidate never replaces that checkpoint.

## Capture and publication

The engine returns candidates only for explicit script requests and the conservative pre-battle policy above. A host may call `recoveryCandidate()` on an applicable interruption/lifecycle signal while time and platform permit; the call is best effort and cannot force gameplay forward, wait indefinitely for I/O or promise success after abrupt termination. No fixed capture interval or zero-loss guarantee is promised.

The host validates the candidate bytes before publication, reads stored bytes back and revalidates identity, version, integrity, completeness and ledger consistency before atomically switching the durable recovery pointer. Serialize competing promotions. Keep the previous validated generation usable until promotion completes. Retain the current and one previous validated generation per game/profile; candidates in progress are separate. Revalidate before recovery and use an earlier generation only if it also validates. Hosts must define their atomicity and durability guarantees; unsupported guarantees must not be advertised. Normal save slots are not overwritten.

## Reference recovery store layout

The layout below is the reference used by core's `save/recovery-store` promotion and selection functions. **It is optional for hosts**: a host may store candidates any way it likes provided it offers the same observable guarantees — complete game-scoped generations, read-back validation before an atomic pointer switch, and the current plus one previous validated generation retained. A host that cannot make the pointer switch atomic and durable must not advertise durable interruption recovery.

Paths are `gameId`-relative below the game's durable save area and use `/` separators. The `gameId` is one path segment: it cannot be empty, cannot contain `/`, `\` or NUL, and cannot be `.` or `..`.

| Path | Contents |
|---|---|
| `<gameId>/recovery/current.json` | The durable pointer, replaced only by an atomic write. |
| `<gameId>/recovery/generations/<generation>/candidate.bin` | The candidate bytes exactly as captured. |
| `<gameId>/recovery/generations/<generation>/meta.json` | The read-back validation result for that generation. |

A **generation** is a positive integer written as twelve zero-padded decimal digits, so lexical path order is numeric order. Promotion uses the highest existing generation plus one and never reuses a generation. The pointer is canonical JSON with exactly the keys `version`, `gameId`, `generation`, `tick` and `ledgerHash`: `version` is the pointer version, `generation` names the selected generation, and `tick` and `ledgerHash` are the validated candidate's tick and ledger hash. `meta.json` is canonical JSON with exactly the keys `version`, `generation`, `tick` and `ledgerHash`; it records completeness and equality for that generation and never substitutes for revalidating the candidate bytes.

### Promotion

1. Validate the captured candidate bytes first. A refused candidate writes nothing and leaves the pointer untouched.
2. Write the new generation's `candidate.bin`, read those bytes back and validate the read-back; its tick and ledger hash must equal the first validation exactly.
3. Write `meta.json`, read it back and confirm it records the validated generation, then replace `current.json` with an atomic write.
4. Read the pointer back and require it to name the new generation with exactly the validated tick and ledger hash. A pointer read-back failure restores the previous pointer when it was readable and reports promotion failure. The previous validated generation stays usable until this step succeeds.
5. Best-effort prune older generations, retaining the promoted generation and the newest older generation that revalidates. If no older generation validates, the newest remaining generation is kept so a transient read or validation failure does not delete the only fallback. A host without removal keeps the extra generations; selection still validates whichever it reads.

Promotion is synchronous and creates no cross-process lock, so a host serializes competing promotions as the contract requires. Candidate and pointer bytes are opaque to the store: identity, version, integrity, completeness and ledger consistency are the injected validator's responsibility.

### Selection

Selection reads and shape-checks the pointer, then reads the pointed generation's candidate and metadata, revalidates the bytes and requires its tick and ledger hash to match both the pointer and the metadata. A missing or corrupt pointer, a missing or malformed candidate or metadata, a mismatched result or a validator refusal is never returned. In that case selection scans generation directories newest first, fully revalidates each candidate, returns the newest valid one and atomically repairs the pointer best-effort; a failed repair does not make the already-validated candidate invalid. If no generation validates, recovery is unavailable and selection returns nothing. Selected bytes are always the bytes that just passed validation.

A host read that throws is **unreadable**, not corrupt: selection may still return an older validated generation, but it does not repair or demote the pointer when the pointer read threw, when the pointed generation was unreadable, or when any generation newer than the selected one was unreadable. Only an absent or corrupt pointer, candidate or metadata, or a content mismatch, may be repaired to a selected generation.

## Recovery and pause

The prompt and choice are host-side. Only when a validated candidate is available, the host asks “Would you like to continue where you left off?” Decline uses ordinary boot without overwriting normal save slots; checkpoint disposition on decline is undecided. Continue passes selected candidate bytes as `BootInit.recoveryCandidate`; without a candidate ordinary boot and saved-game loading are unchanged.

Recovery first runs the ordinary main-file and asset setup, package/service construction, `initChar`, game-wide `startupPrg` to completion and player-presence check. Normal startup may execute threads and entry programs on a temporary board reached by startup. Before the saved board is staged, stop the temporary board and item threads. Preserve startup-created listeners and services, but never install the candidate's listeners, queues, VM continuation or other transient state.

**Item-action clarification (#589; TKR engineering rule).** A checkpoint that is otherwise eligible may be captured while a script-driven item action waits outside a menu. Recovery discards that action and its result along with the candidate's other VM continuations and queues. Its previously committed durable ledger effects remain, but neither an uncommitted replacement nor a pending post-commit equip program is resumed. See the [item-action contract](plugins-and-battle.md#epic-85-item-action-proposal); this does not turn a mid-action point into a safe authored checkpoint.

After startup, restore the candidate's durable ledger before saved-board conditions, dependencies and item visibility are evaluated. Prepare the ledger's saved board without ordinary `arrive`, retaining saved player placement and trigger progress. Check required assets against their captured fingerprints. An unavailable, changed or incompatible required asset, or any other setup failure, refuses recovery without exposing partial recovered state; the host retains its stored checkpoint.

For ordinary objects with startup-installed listeners that are reachable from the durable ledger, capture stable startup-origin associations only when their identity can be established from the original startup object lifetime and a unique reproducible startup anchor. On re-entry reconcile saved aliases and cycles to the corresponding freshly created startup object, preserving its startup listeners and restoring durable members. Do not infer identity from a reused numeric handle or from a changed global name alone. If an association needed to avoid losing or misattaching a startup listener is missing, conflicts or is ambiguous, refuse capture or recovery rather than guess. Startup listeners on objects outside the durable ledger remain startup state and are not imported from the candidate.

Once the recovered board is prepared, expose it for drawing but keep simulation paused. No recovered-board, item or entry-program instruction runs before explicit Resume; focus gain, debugger continuation and `advance(0)` do not resume. `Engine.recoveryStatus()` reports `none`, `loading`, `paused`, `resumed` or `failed`; the host invokes one-shot `Engine.resumeRecovery()` on explicit Resume. It starts item multitask and board threads and the entry program in ordinary board-entry order, then releases the pause. A waiting entry program accepts ordinary input after Resume.

Implementation and tests have landed for capture, promotion and paused ledger-first re-entry (#778, #779, #782, #783); #780 reconciles BAT-13 evidence and #753 remains the sole Epic 7 closure sweep. Existing behavior evidence is cited in the decision document.
