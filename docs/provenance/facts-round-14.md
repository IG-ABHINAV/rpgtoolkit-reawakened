<!-- Owner-relayed fact sheet, clean-room extraction round 14 (ADR 0006). Facts are not rulings; specification changes follow separately (G7). -->

# Clean-room extraction, round 14 — runtime movement settings (owner-relayed)

- **Source consulted:** the answerer read the original program's logic; the behavior was not observed by running it.
- **Answerer:** TK engineer, relayed by Jensen.
- **Date:** 2026-11-05.
- **Versions:** released 3.1.0 and the final unreleased source, as reported; revision identifiers not supplied. The answerer reports an unspecified fractional-variable difference in the latter, so the coercion facts below apply specifically to 3.1.0.
- **Confidence:** facts are read from logic unless explicitly marked as inferred. Active-step and queued-destination conclusions are inferences from that logic.
- **Questions:** runtime movement command arguments and return, initialization, timing, persistence and unusual inputs.
- **Review:** owner-relayed behavior prose; not reviewed by a separate agent.

**D1. Arguments and return.** With no arguments the command changes neither setting and returns the current walking choice as 1 for pixel walking or 0 for tile walking. One argument changes walking; enabling it retains the prior push choice, while disabling it forces tile-sized pushing. With two arguments the second chooses the push increment, but disabling walking still forces tile-sized pushing. The return always describes walking after the call, not pushing. Disabling and then re-enabling walking with one argument does not restore the earlier push choice.

**D2. Initialization.** The main-file modes initialize walking and scripted pushes as follows: mode 0 gives tile walking and 32-pixel pushes; mode 1 gives pixel walking and 32-pixel pushes; mode 2 gives pixel walking and 8-pixel pushes. Although the command forces tile-sized pushes when disabling walking, a restored save can combine tile walking with pixel pushes because the two settings have different restoration sources (D4).

**D3. Timing and queues.** A change takes effect as the command executes; a following command in the same script sees it. A later scripted push uses the increment selected when that push is issued. **Inferred from logic:** changing the setting does not cancel an active step or clear or rebuild queued movement or a path; the active destination and already-calculated queued destinations remain. The changed walking mode can nevertheless affect subsequent movement and collision calculations during an in-progress move.

**D4. Persistence and transitions.** Walking mode is saved and restored; a runtime push-setting change is not itself saved. Loading reopens the save's main file and takes the push setting from it. A board change preserves both current settings. Starting a game initializes them from its main file; successfully loading a different main file resets the game and initializes them from the new file.

**D5. Input interpretation in 3.1.0.** Numeric zero is false and every other number, including a negative or fractional number, is true. A string is false only if it equals `off` ignoring case; empty text, `0`, `false`, and text with spaces around `off` are true. The same interpretation applies to either argument. More than two arguments leave both settings unchanged and return the current walking choice; behavior when evaluating an argument itself fails is not established by that rule.

## Doubts in the relay

Resolved: the initial main-file mapping agrees with the existing main-file specification. Still open: the precise final unreleased version's fractional-variable difference was not described. The queued and active movement conclusions are inferred, not run-confirmed. These facts do not decide whether Reawakened should reproduce the legacy save/load asymmetry.

## Disposition

Nothing below is a ruling.

| Fact | Touches | Effect |
|---|---|---|
| D1–D3, D5 | Runtime movement command and movement specification | Establish a documented basis for a separate implementation contract and tests; retain the inference label for active and queued movement. |
| D4 | Save, recovery, and main-file transitions | Separately decide the Reawakened persistence and migration contract; do not present that choice as observed behavior. |
