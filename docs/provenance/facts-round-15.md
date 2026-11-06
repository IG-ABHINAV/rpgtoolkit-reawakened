<!-- Owner-relayed fact sheet, clean-room extraction round 15 (ADR 0006). Facts are not rulings; specification changes follow separately (G7). -->

# Clean-room extraction, round 15 — blocking program takes the frame (owner-relayed)

- **Source consulted:** the answerer read the original program's logic; the behavior was not observed by running it.
- **Answerer:** TK engineer, relayed by Jensen.
- **Date:** 2026-11-05.
- **Versions:** released 3.1.0 and the final unreleased source, as reported; revision identifiers not supplied.
- **Confidence:** facts are read from the 3.1 frame loop and the program execution loop.
- **Questions:** when does a blocking program take the frame relative to the per-frame thread scheduler, and what happens before the first board opens.

**S1. A started blocking program owns the frame immediately.** In 3.1, the blocking program takes control as soon as it starts — not only when it reaches `Wait`, `Delay` or a prompt. Its instructions are not interleaved with the normal background-thread scheduler. This remains true while it is waiting: those blocking primitives do not hand control back to the per-frame thread scheduler.

**S2. Order relative to the frame pass depends on the launch path.** The frame’s background-thread scheduling pass happens first for movement-triggered programs, then movement and the trigger program run; an activation-key trigger runs during input scanning, before that frame’s thread pass (and if it finishes, the frame continues and eligible threads get their slices afterward); the board-enter program at startup runs before the normal game loop starts, so there is no ordinary thread pass before it in a startup frame; a board-enter program on a board transition runs synchronously within the transition; `Run()` transfers control from inside the caller without returning to it. There is no round-robin between a blocking program and background threads. The thread pass itself visits eligible threads sequentially, giving each up to its instruction-unit budget; sleeping or finished threads do not execute units; their ordering is not guaranteed to be creation order.

**S3. A background thread that starts a blocking program suspends the scheduler at that point.** The blocking program runs, then control returns to the suspended thread/scheduler path; other threads do not run in the meantime.

**S4. No background slices during the start-up program, whatever the thread kind.** A thread created by the start-up program does not execute while that program is still running: creating it registers it with the scheduler; it does not give it a slice. Waiting in the start-up program does not change this. The distinction between thread kinds matters only for lifetime:

- `Thread(..., 0)` — a non-persistent thread associated with the current board object. On the usual start-up path, opening the initial board destroys it before it has received a slice.
- `Thread(..., 1)` — a persistent thread. It survives the initial board load, but still does not receive a slice during the start-up program or the board-enter program. It becomes eligible when the normal game loop reaches its first thread-scheduling pass.
- Board-configured threads do not exist merely because an initial board is configured; they are created when that board is opened, after the start-up program finishes. They likewise wait for the normal scheduler. Item multitask programs created as the board loads follow the same scheduling principle.
- If the start-up program itself loads a board, that changes when board-associated threads are created and which threads survive a subsequent board change, but does not make them run concurrently with the still-running start-up program.
- **Useful rule:** no background slices while start-up is running; persistence decides whether a spawned thread survives long enough to get one afterward.

## Doubts in the relay

None marked. The pre-board scheduler slot is excluded per S4; the launch-path position table of S2 contains process-level rows that are not directly reproducible in the rebuild, where a blocking thread is stepped in the `threads` phase rather than synchronously at its launch site.

## Disposition

| Fact | Touches | Effect |
|---|---|---|
| S1, S3, S4 | `runThreadsPhase` ownership rule, the start-up pre-board exclusion, `docs/spec/engine/rpgcode-errors-and-threads.md` | Fixes the normative contract for live blocking programs; the persistent-thread exception an earlier reading of #1173 admitted is withdrawn — a persistent thread created during start-up is eligible only at the first pass of the normal game loop. |
| S2 | the phase list discussion, thread ordering, `Run()` semantics | Context for the #1167 ruling; the position of a frame's thread pass relative to the launch site does not change the ownership rule. |
