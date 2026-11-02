# RPGCode built-in commands

The Toolkit 3.1 engine registers 282 command names, grouped by area; 14 are aliases of another command. Names are case-insensitive. This page also documents Reawakened-only additions, which are not part of that legacy count. Signatures use the engine's own notation: `[x]` = optional parameter, `&` = the argument must be a variable (it receives a result), `ret` = the value the command returns. Types are `int`/`double` (numbers), `string`, `bool` (number or "on"/"off"), `canvas`/`thread`/`animation` (numeric handles).

<a id="e-94"></a>
**E-94 Built-in library.** About 280 functions, grouped by capability. Parity means every name in the 3.1 catalogue resolves, with the same argument conventions, including optional trailing by-reference outputs and handles that accept a name, an index, `"source"` or `"target"`. The 3.1 catalogue on this page is the 282 names the engine registers, aliases included; Reawakened-only commands are identified separately.

**Compatibility notes.**

* **Binding is at compile time (R-35).** Calls to built-ins are bound when a program is compiled, so a script method with the same name as a built-in is never called at those call sites. If a name were registered twice the first registration would win. The control-flow words `if`, `elseif`, `else`, `while`, `until` and `for` are also built-ins internally but are documented in [rpgcode-language.md](rpgcode-language.md).

  **Reawakened rule.** A script method whose name matches a built-in is never called where the compiler binds the built-in — that is 3.1 behaviour, kept for parity — and the definition raises a **required warning** naming the built-in it shadows. The warning follows the owner's standing rule that every override warns (2026-10-11). This binding order is the reverse of the one the architecture spine's AD-8 described; the change is recorded here and applied by entry 3.8.

  **Proposed ruling (pending owner review; entry 18.5) — the run-time environment table.** *In plain terms:* a script still cannot change a command by storing a number or text under its name, but it can now swap in its own function by storing a function there. *Precisely:* R-35 as it stands fixes the order of a built-in, a script function and a plugin command, and a shadowing definition warns. Since entry 18.5 a plain-name call resolves through the environment table at run time ([rpgcode-language.md](rpgcode-language.md#keywords-and-structure), FUN-8), whose first entry is the running scope's own variable of that name when it holds a callable value. That entry sits ahead of the built-in, so a script can intercept a command by assigning a callable to its name; nothing else changes — assigning a non-callable (`castint = 99`) leaves the built-in bound, and a read of a name never yields a command. `bindingOf(name)` answers with the binding a call of that name would run at that moment, so a wrapper can keep what it replaced and call it. <!-- OWNER: R-35 — 2026-10-18, entry 18.5: 100% compatibility is the reason the reassigning entry takes a callable only. Rejected alternative: let any assignment reassign a command name, which would change `castint = 99` and break 3.1. -->
* **Commands that exist only in Reawakened (corpus check).** `bindingOf` is a Reawakened-only command (entry 18.5): 3.1 had no callable values, so it has no legacy counterpart and is not one of the 282 catalogue names. **Corpus check (R-35).** Verified that no legacy corpus or fixture script defines or calls `bindingOf`, so the command cannot shadow a 3.1 definition. It is a command the VM owns, answered ahead of the environment table like the module directives (FUN-8). Its full text is in FUN-8; in short, `bindingOf("name")` returns a callable for whatever a call of `name` runs at that moment, and it does not wait.
* **Obsolete commands (R-36).** A command marked *obsolete: raises an error* is a catchable runtime error, and its statement is skipped; a command marked *obsolete: warning* stays callable and shows a warning when warnings are on. Both kinds are handled the same way by an error handler. The eight names `empty`, `fbranch`, `mbox`, `newplyr` (`newplayer` is its alias), `restorearrayscreen`, `underarrow`, `itemwalkspeed` and `shopcolors` are part of the 282-name catalogue, and the command-effect catalogue JSON lists all 282 names.
* **`random(max)` edge cases and departures (Ruling 3).** *Legacy fact:* 3.1 drew from the C runtime generator (0..32767), took remainder by `max`, and added 1 (facts-round-6, Q6). `max` was truncated to an integer first. `max` 0 returned 1; negative `max` gave 1..|`max`|; NaN `max` gave 1..32768. Because the CRT draw ranged 0..32767, results never exceeded 32768, and the generator was seeded from the system clock at startup. **Reawakened rule:** MATCH the 3.1 edge cases: truncate `max` to an integer first (`Math.trunc`); `max` 0 returns 1; negative `max` gives 1..|`max`|; NaN `max` gives 1..32768. Deliberate departures: ranges above 32768 are NOT capped at 32768, and the draw comes from the injected deterministic RNG `1 + draw % max` rather than the system clock, where `draw` is the port's uniform unsigned 32-bit value (`0 … 2^32 − 1`; AD-12, `core/ports/rng.ts`). A `max` that does not divide `2^32` therefore carries a modulo bias: residues below `2^32 mod max` occur one more time in `2^32` draws. For `random(5)`, `2^32 = 5 × 858,993,459 + 1`, so residue 0 occurs 858,993,460 times and residues 1–4 occur 858,993,459 times each; `random(5) <= 2` succeeds on 1,717,986,919 of 4,294,967,296 draws, `0.4 + 0.6 / 2^32 = 0.4 + 1.39698 × 10^-10`, which is the run roll's accepted bias ([battle.md](battle.md#bat-8)). Non-positive, non-integer and NaN arguments no longer raise `builtin.bad-arg`.
* **`getTickCount()` time source and departure (Ruling 5).** *Legacy fact:* 3.1 returned the Windows system uptime in milliseconds since the computer started, wrapping after ~49.7 days in 10–16 ms steps (facts-round-6, Q7). **Reawakened rule — deliberate departure:** `getTickCount()` returns the elapsed milliseconds since game startup based on the injected fixed 60 Hz simulation tick (`floor((tick * 1000) / 60)`), ensuring deterministic replays across platforms while preserving interval timing semantics.


## Message window, text & fonts (30)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `mwin` | `void mwin(string str)` | Show the message window. | Uses the logical-resolution message surface; the fixed 600×100 geometry, 50% default translucency and all-at-once text are defined below. |
| `dialogue` | `string dialogue(string text)` | Show one dialogue message and wait for the player. | Uses the message window and waits for the next unclaimed input key; returns that key name and queues `dialogue.completed` on normal completion as defined by [E-123](plugins-and-battle.md#e-123). |
| `wait` | `string wait([string &ret])` | Wait for a key press. The lowest unclaimed input sequence resumes the thread and is optionally written to `ret`. |  |
| `mwincls` | `void mwincls()` | Clear and hide the message window. |  |
| `text` | `void text(double x, double y, string str, [canvas cnv])` | Displays text on the screen. | Uses square cells one current-font-size on a side with 1-based coordinates; non-integer cell coordinates are truncated. With a canvas handle the glyphs are drawn into that canvas's pixels, so clearing or redrawing the canvas replaces them; without one they join the screen text layer. An unknown canvas raises `surface.unknown`. |
| `pixeltext` | `void pixeltext(int x, int y, string str, [canvas cnv])` | Displays text on the screen using pixel coordinates. | With a canvas handle the glyphs are drawn into that canvas's pixels (replaced when the canvas is cleared or redrawn); without one they join the screen text layer. An unknown canvas raises `surface.unknown`. |
| `mbox` | `void mbox(string str)` | Show the message window. | alias of `mwin` |
| `font` | `void font(string font)` | Load a true type font. TK2 fonts are not supported. |  |
| `fontsize` | `void fontsize(int size)` | Set the font size. |  |
| `get` | `string get([string &ret])` | Read the next buffered key. It claims that key's monotonic input sequence and optionally writes the name to `ret`. |  |
| `bold` | `void bold(bool enable)` | Toggle emboldening of text. |  |
| `italics` | `void italics(bool enable)` | Toggle italicizing of text. |  |
| `underline` | `void underline(bool enable)` | Toggle underlining of text. |  |
| `wingraphic` | `void wingraphic(string file)` | Set the message window background image. |  |
| `wincolor` | `void wincolor(int dos)` | Set the message window's colour using a DOS code. |  |
| `wincolorrgb` | `void wincolorrgb(int r, int g, int b)` | Set the message window's colour. |  |
| `color` | `void color(int dos)` | Change to a DOS colour. |  |
| `colorrgb` | `void colorrgb(int r, int g, int b)` | Change the active colour to an RGB value. |  |
| `prompt` | `string prompt(string question, [string &ret])` | Ask the player a question and return the result. |  |
| `show` | `void show(string str)` | Show the message window. | alias of `mwin` |
| `print` | `void print(string text)` | Write the specified string one line down from the last call to text(). |  |
| `clearbuffer` | `void clearbuffer()` | Empty the keyboard buffer. It claims every currently buffered sequence and lets the input owner prune them at the phase boundary. |  |
| `textspeed` | `void textspeed(int speed)` | Obsolete. | obsolete: raises an error on any argument and the statement is skipped |
| `mwinsize` | `mwinsize(int percent)` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `getcolor` | `void getcolor(int &r, int &g, int &b)` | Get the current colour. |  |
| `getfontsize` | `int getfontsize([int &ret])` | Get the current font size. |  |
| `statictext` | `void statictext()` | obsolete. | obsolete: raises an error and the statement is skipped |
| `msgbox` | `int msgbox(string text [,string title [, int style [, int textColor [, int backColor [, string bitmap]]]]])` | Display a message box containing one or two buttons, handled using a cursor map (keyboard input only). | The panel is sized from the wrapped text; buttons are 80×28 and read `OK` or `Yes`/`No`; returns 1 (OK), 6 (Yes) or 7 (No), as defined below. |
| `gettextwidth` | `int gettextwidth(string text)` | Get the width of a string of text in pixels, relative to the current font and size. |  |
| `gettextheight` | `int gettextheight(string text)` | Get the height of a string of text in pixels, relative to the current font and size. |  |
| `setmwintranslucency` | `void setmwintranslucency(int percent)` | Set the translucency of the message window. 0% is invisible; 100% is opaque. | The default is 50%. |

<a id="e-55"></a>
**E-55 Message window ("mwin").** A dialogue box along the top of the screen, with a background colour or image, a size (per cent of the screen), translucency, a font, a size, bold/italic/underline and a colour. `Mwin(text)` appends a line and `MwinCls` hides and clears it; the text supports variable splicing (`<var>`), and the text speed is configurable.

<a id="reawakened-message-window-defaults"></a>
**Reawakened rule (OWNER; adopts the owner-relayed round-7 legacy facts; the unanswered parts are unverified defaults).** An author can show dialogue with `mwin(text)` and clear it with `mwincls()`. In plain terms, the message window is a fixed-size strip at the top of the screen, and its text appears all at once. Technically, the message surface is deterministic and measured in logical screen pixels. The window is always 600 × 100 pixels, centred horizontally (`x = floor((logicalWidth − 600) / 2)`, `y = 0`), with no inner margin, so the text starts at the window's top-left corner and wraps at 600 pixels using the current `FontRef` metrics. A logical surface narrower than 600 pixels clips the window to the surface (Reawakened choice: the answer does not cover narrow screens), and text that wraps below the 100th row clips to the window (unverified default). The default translucency is 50%, so the window background is blended with the frame beneath it with integer per-cent weights: each channel is `floor((s × p + d × (100 − p) + 50) / 100)`, where `s` is the window colour, `d` the frame beneath and `p` the translucency percent (0 is invisible and 100 opaque, as `setMwinTranslucency` documents). The background colour is DOS colour 0 and the text colour is DOS colour 15 because the answer does not cover colours; image, colour and translucency settings replace only their corresponding defaults. The whole text appears on the tick the window is drawn; there is no reveal rate. `textspeed` is obsolete: every call, with any argument, raises the catchable obsolete-command error and the statement is skipped (as `mwinsize` already does). The earlier default (x = 10%, y = 4%, 80% × 24%, 8-pixel margin, opaque background, 60 glyphs per second, `textspeed(0)` reveal) is withdrawn; the evidence is the owner-relayed round-7 answer to Q3 in [facts-round-7.md](../../provenance/facts-round-7.md).

<a id="message-window-text-and-fonts"></a>
**Reawakened rule (OWNER; FontRef-facing font semantics).** `font(name)` resolves a project asset by case-insensitive family name. If none resolves, `Arial`/sans-serif uses Liberation Sans, `Times New Roman`/serif uses Liberation Serif, and `Courier New`/monospace uses Liberation Mono, followed by the documented fallback family. A `.fnt` is selected when the name resolves to one or when the project is TK2; other names use family substitution. The draw-list `FontRef` carries `{ asset, size, bold, italic }`; underline remains a separate `line` command. Entry 4.3 owns the library and bundled assets.

<a id="program-flow-errors--debugging"></a>
## Program flow, errors & debugging (25)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `branch` | `void branch(label lbl)` | Jump to a label. |  |
| `checkpoint` | `void checkpoint()` | Mark this point as safe for interruption recovery. | Takes no arguments and never waits. Queues a one-shot request; the engine returns a candidate only when the runner calls `Engine.recoveryCandidate()` at an eligible settled point, otherwise it returns `null` ([interruption recovery](interruption-recovery.md#stable-checkpoint)). |
| `change` | `void change(string program)` | Change this program so that next time it is triggered, a different program runs instead. Change() is active only while the player remains on the board (i.e., leaving... |  |
| `done` | `void done()` | End the program. |  |
| `dos` | `void dos()` | Quit the game. | Legacy alias of `quitGame`; emits one `quit` request and does not wait. |
| `windows` | `void windows()` | Quit the game. | Legacy alias of `dos` and `quitGame`; emits one `quit` request and does not wait. |
| `end` | `void end()` | End the program. |  |
| `fbranch` | `void fbranch(label lbl)` | Jump to a label. | alias of `branch` |
| `gone` | `void gone()` | Suppress the currently running board trigger until the board is left. | Writes only the `triggers` section and does not remove the source program or unrelated threads. |
| `over` | `void over()` | Show the game-over flow. | Requests the game-over flow owned by board-rendering; it does not choose host window behaviour. |
| `reset` | `void reset()` | Reset the game. | Clears the sections listed below, preserves `rng` and `time`, then reruns startup from E-02 step 3; the call does not wait. |
| `run` | `void run(string file, [object context])` | Transfer control to a different program. | Backwards-compatible legacy alias of [`replaceProgram`](#reawakened-replaceprogram) for Toolkit 3.1 games: ends the calling program's frame chain and never returns (FUN-7). To run a program and come back to the next line, use [`executeProgram`](#reawakened-executeprogram). |
| `delay` | `void delay(double time)` | Delay for a certain number of seconds. |  |
| `godos` | `void godos(string command)` | Obsolete. | Obsolete: raises a catchable error and skips the statement; shell commands are unavailable. |
| `debug` | `void debug(bool enable)` | Toggle whether to show debug messages. |  |
| `rpgcode` | `void rpgcode(string line)` | Independently run a line of RPGCode. |  |
| `autocommand` | `void autocommand()` | Obsolete. | obsolete: shows a warning (when warnings are on) and still runs |
| `stop` | `void stop()` | End the program. | alias of `end` |
| `debugger` | `void debugger(string message)` | Show a debug message. |  |
| `setconstants` | `setconstants(...)` | Description. | obsolete: raises an error and the statement is skipped |
| `multirun` | `multirun()` | Multirun()'s behaviour depends on the program's context. |  |
| `iif` | `iif(condition, true, false)` | Obsolete. Use the tertiary operator result = (expression ? true part : false part) | obsolete: warning; use the `?:` operator |
| `gettickcount` | `int gettickcount()` | Get the number of milliseconds since Windows started. |  |
| `resumeNext` | `void resumeNext()` | Return to the statement after the statement where an error occurred. |  |
| `setErrorHandler` | `void setErrorHandler(label lbl)` | Set an error handler for the current function. This does not propagate up the call stack! Refer to the language features section of the manual for more information. |  |
| `setResumeNextHandler` | `void setResumeNextHandler()` | Cause errors in the current function to be silently ignored. |  |

<a id="reawakened-executeprogram"></a>
<!-- OWNER: executeProgram / replaceProgram — Jensen, 2026-10-25 (#506, #508; modern names and shared object-valued context; legacy run aliases replaceProgram) -->
### `executeProgram`: run a program and come back (OWNER)

**Owner ruling (approved; Jensen, 2026-10-25; modern program-flow names and "viewbag" generic context payload; from clean-room round 12, #506, #508). Landed code: none; this is a specification only.** *In plain terms:* `executeProgram("name")` waits while the program in the `Prg` folder runs, then carries on at the next line, like calling a function in another file. [`replaceProgram("name")`](#reawakened-replaceprogram) instead hands control over permanently: the calling program's frame chain ends and never resumes. `executeProgram` and `replaceProgram` are the modern command names; legacy `run` remains a backwards-compatible alias of `replaceProgram` for Toolkit 3.1 games. Both modern commands give the new program fresh locals, share globals, and bind an optional object-valued `context` dictionary (a "viewbag" payload, default `{}`) in its root scope, so game code can read named data such as `context.power` or `context.element`. `context.source` and `context.target` bridge that payload to legacy entity handles. A nested `executeProgram` call restores the caller's slots when it returns; a replacement has no caller to return to. The engine uses `executeProgram` for the nested battle, menu, equipment and outcome calls below. *Precisely:* the paragraphs below. The modern commands are outside the 282-name legacy catalogue; see [Reawakened additions](#reawakened-additions).

```
executeProgram("greet.prg")                                                      // run Prg/greet.prg (context = {}, inherits source & target)
executeProgram("spell.prg", { source: user, target: foe, power: 50, element: "fire" })  // modern viewbag payload; also sets source & target
executeProgram("react.prg", "target", "source")                                  // positional convenience for { source: "target", target: "source" }
```

Signature: `int executeProgram(string file, [object context])`. Positional compatibility convenience: `executeProgram(string file, variant source, variant target)`. It returns 0 when the nested program completes. `file` names `Prg/<file>`.

How to read this section: a paragraph starting **Legacy (R12)** says what Toolkit 3.1 does, as recorded in [facts-round-12.md](../../provenance/facts-round-12.md) (cited as R12 with its section or point number). That round has been reviewed in two independent clean-room passes and fact-checked against both the shipped 3.1.0 release (`2f986f3e`) and the final source (`9191b919`). A paragraph starting **Reawakened rule** is this project's rule, approved by the owner (Jensen, 2026-10-25), and ends with a rejected alternative.

**Legacy (R12), the general model.**

* A nested run is **blocking and synchronous**: the caller waits until the program finishes, with no scheduling and no deferral, and a program can itself start another, so it nests to any depth with no engine limit until the call stack runs out (R12 §1 point 1, §7). — certain.
* Starting a program takes **no source or target argument**: the caller sets the two engine-wide slots beforehand and the program reads whatever is there (R12 §1 point 2). — certain.
* Each run has **fresh local state**; the globals are shared with everything (R12 §1 point 3). — certain.
* A program can produce a final value, but **every engine caller ignores it** (R12 §1 point 4). — certain.
* An error in the nested program is reported and handled by that program's own error handling; **it does not stop the caller**, which continues afterwards (R12 §1 point 5). — certain.
* Between script instructions the engine handles at most one pending window message (keeping repaint, key/mouse input, and window close responsive) while the normal frame loop, sprite movement, board animations, and background threads are frozen; inside waiting commands, key/mouse waits, fades, wipes, animations, scripted walking, and video keep handling window messages while `delay` handles nothing and freezes the window for the whole delay; background threads do not handle window messages between instructions (R12 §1 point 6, §6; [R-32](rpgcode-errors-and-threads.md#blocking-commands-r-32)). — certain.
* Only the **outermost program** grabs a copy of the screen as backdrop and hides and resets the message window to line 1 when it starts, and only it hides the message window when it ends (without resetting the line position then); nested runs share the single message window, append below existing text, and share clears (R12 §1 point 7, §5). — certain.
* The script command that starts another program (`run`, and `over` when a game-over program is set) **ends the calling program first**, so the caller never resumes, but the old program stays underneath the new one on the call stack until the new one finishes, so a handover still counts as a nested run for depth and the message window (R12 §1 point 8, §7; FUN-7 and R2-Q20). — certain.
* **Missing or blank** program name: level-up, win, run, game over, the menu plugin, and board items and board programs (which check the file exists) check for a name first and skip the run when absent; equip and remove, enemy custom AI, and the battle plugin's special-move and item programs run without checking, where legacy behaviour is undefined (R12 §1 point 9). — certain.

**Reawakened rule: a call on the calling thread (OWNER; Jensen, 2026-10-25).** `executeProgram` pushes one frame on the calling thread's frame stack, starting at the first instruction of the named program's top level. The calling thread runs no further instruction of its own until that frame has ended. It creates no thread, appears nowhere in `threads[]`, and pauses no other thread: anything else that stops the world (a blocking command inside the called program, R-32; a trigger program) behaves as if the called program's instructions had been written in the caller. Programs nest to any depth, including a program calling itself; as in legacy (R12 §7), no fixed depth limit is ruled here beyond the per-tick step budget. *Rejected:* running the program on a new thread and waiting for it, because that adds a thread id, a second budget and a second source/target pair for no behaviour the legacy engine shows; and giving `run` a "come back" flag, because the `run` alias preserves the distinct hand-over operation.

**Reawakened rule: locals, globals, handlers (OWNER; Jensen, 2026-10-25).** Each call starts with fresh locals (nothing carries over from an earlier call of the same program, and a program that calls itself gets its own locals each time), with the call's `context` dictionary bound in the called program's root scope; the globals are the one shared table ([SEM-4](rpgcode-runtime.md#sem-4--scope-and-visibility)); the program has its own `autoLocal` setting (default off) and its own error handlers, which the caller's handlers never see (ERR-1). This is R12 §1 point 3 and R2-Q13's rule for a `run()` program, applied to a call. *Rejected:* sharing the caller's locals, which would let a helper program overwrite its caller's variables and would differ from the separate-program scope `run` has.

**Reawakened rule: how the call ends (OWNER; Jensen, 2026-10-25).** The called program ends when it runs out of instructions or runs `end()`, `done` or `stop`. FUN-7 ends only the program whose code is running, so the caller is not ended; every pending function frame of the called program is abandoned and the call returns to the instruction after `executeProgram`. `replaceProgram("other")` (including its `run` alias) is different: it discards the calling program's frame chain, including pending nested-program return continuations, and starts `other` on the same thread; none of those callers resumes. *Legacy (R12 §1 point 8, §7):* a hand-over ended the calling program but kept it underneath the replacement on the native call stack until the replacement finished. The modern replacement does not retain that abandoned chain. *Rejected:* making `end()` inside a called program end the whole thread, or treating a replacement as a nested call that returns.

**Reawakened rule: the result is 0 (OWNER; Jensen, 2026-10-25).** `executeProgram` returns 0 whatever the called program's own final value is. If the chain is replaced instead, there is no return to the discarded caller. *Legacy (R12 §1 point 4):* no engine caller reads that value, so nothing in 3.1 depends on it. *Rejected:* returning the program's final value, because it would make that value (and the difference between 0 and unset) a public contract of every program, with no legacy behaviour to match.

**Reawakened rule: errors (OWNER; Jensen, 2026-10-25).** An error raised inside the called program is seen by that program's own handler if it has set one; with none it is reported and the called program continues with its next step (ERR-2, unchanged), and the caller continues after the call when the called program ends. A catchable error never reaches the caller's handler (ERR-1), and it is handed to the host as the usual diagnostic with the called program's file and line (ERR-2). *Legacy (R12 §1 point 5):* the error is handled by the called program and the caller continues. *Rejected:* passing a called program's error to the caller's handler, which contradicts R12 §1 point 5 and ERR-1 and would let a called program stop its caller.

**Reawakened rule: a blank or missing file (OWNER; Jensen, 2026-10-25).** A `file` that is the empty string does nothing: no program runs, the source and target are untouched, there is no diagnostic, and the call returns 0. A name that matches no program in `Prg` raises a catchable runtime error with the located diagnostic `program.missing` (the code the library-restore rule already uses, see [rpgcode-modules-and-objects.md](rpgcode-modules-and-objects.md)); nothing runs and the caller continues at its next step. *Legacy (R12 §1 point 9):* level-up, win, run, game over, the menu plugin, and board items/board programs check for a blank name or missing file and skip the run, whereas equip/remove, enemy custom AI, and battle special-move and item programs run without checking (where legacy behaviour is undefined); Reawakened normalizes all callers so an empty name is a silent no-op and a non-empty missing file raises `program.missing`. *Rejected:* compiling a name that is not a file as inline code, as a thread started by name does ([rpgcode-language.md](rpgcode-language.md#threads)), because running arbitrary text for a typo is worse; and doing nothing silently for a missing file, which hides typos.

**Reawakened rule: shared `context` payload (viewbag) and `source`/`target` compatibility bridge (OWNER; Jensen, 2026-10-25).** These object-payload and handle-resolution rules apply to both `executeProgram` and [`replaceProgram`](#reawakened-replaceprogram); legacy `run` is an alias of `replaceProgram` and follows its object-context form. Only `executeProgram` also accepts the positional `(file, source, target)` convenience. Their control flow and restoration lifetime differ.

<a id="legacy-call-contexts-and-order"></a>
1. **Primary modern contracts (`executeProgram(file, [context])` and `replaceProgram(file, [context])`):** `context` is an optional dictionary payload (`{ ... }`), defaulting to `{}` when omitted. It is bound as `context` in the new program's root scope, so programs and packages can read arbitrary named arguments (`context.power`, `context.element`, `context.move`, `context.item`, `context.slot`, and so on) without passing data through globals. This is an explicit root-scope variable separate from `this`; neither command binds `this` to the dictionary.
2. **Compatibility bridge for legacy scripts (`context.source`, `context.target`, and positional `(file, source, target)`):**
   * If `context.source` is supplied, the calling thread's `source` slot is set to that actor/entity for the new program; if omitted, it inherits the calling thread's `source` slot.
   * If `context.target` is supplied, the calling thread's `target` slot is set to that actor/entity for the new program; if omitted, it inherits the calling thread's `target` slot.
   * The three-argument form `executeProgram(file, source, target)` wraps the positional values into `{ source: arg2, target: arg3 }`. Two arguments select the dictionary form for either modern command; only `executeProgram` accepts the positional form. Legacy `run(file[, context])` follows `replaceProgram`'s object-context form.
   * Each supplied `source` or `target` value is an entity handle as `sourceHandle()` and `targetHandle()` return it (a player, an enemy or a board item), the special handle `"source"` or `"target"` (read from the calling thread's pair **before** either slot changes or any frames are discarded), or `null` / `0` (the unset value that the handle commands return for an empty slot, which sets that slot to `null`). A supplied `source` or `target` value that names no live entity, or a `context` argument that is not a dictionary/object, raises a catchable `builtin.bad-arg` runtime error and nothing runs; more than three arguments to `executeProgram`, or more than two to `replaceProgram`/`run`, is the ordinary wrong-argument-count error of ERR-2.
3. **Restoration belongs to a returning call:** `executeProgram` stores the caller's pair, puts the resolved pair on the thread ([THR-2](rpgcode-errors-and-threads.md#thr-2)), and restores the caller's pair when the nested program completes normally or through `end()`, `done` or `stop`. Nested calls restore their root-scope `context` bindings and `(source, target)` pairs in last-in, first-out order. `replaceProgram` instead installs the resolved pair for the replacement and discards the old frames and their pending return/restore records; it does not restore a discarded caller's pair. *Legacy (R12 §2):* only equip/remove and board-item activation restored the two engine-wide slots; battle and menu uses left the last values set, while programs that set nothing saw stale values. **Deliberate departures (OWNER; Jensen, 2026-10-25):** a generic `context` dictionary rather than two fixed parameters, restoring the pair after every returning call, inheriting omitted slots, and separating returning calls from non-returning replacement. *Rejected:* rigid positional-only parameters that force extra data through globals; leaving the last pair set after a returning call; clearing omitted slots rather than inheriting them; and restoring frames or slots after a non-returning replacement.

**Reawakened rule: plain data, saves and the step budget (OWNER; Jensen, 2026-10-25).** The call record (the called program, the instruction where the caller resumes, the plain-data `context` dictionary, and the stored `source`/`target` pair) is plain data on the thread's frame stack and part of its snapshot (G1). A save taken inside a called program restores inside it, with `context` and the pending restore of the pair intact, and continues. Every instruction of the called program is one VM step of the calling thread and is charged against that thread's per-tick budget ([THR-3](rpgcode-errors-and-threads.md#thr-3), R-33); the call instruction itself is one step. The thread is preempted at any instruction boundary, inside the called program or not, and resumes there next tick. No timer, wall clock or host recursion is involved (G1, G3). *Rejected:* running the called program by recursing into the interpreter from native code, which cannot be snapshotted in the middle of the call or preempted (G1); and giving a call its own budget, which would let nested calls multiply a thread's per-tick work.

**Reawakened rule: one nested-call path for every engine caller (OWNER; Jensen, 2026-10-25).** The battle, menu, equipment, outcome and start-up programs in the table below are started through `executeProgram`, with the `context` dictionary the table gives (the stock packages by calling the command, the core's own callers by the same frame push), so the `context`, `source`/`target` restore, error, blank-name and budget rules above apply to all of them. `replaceProgram` is the distinct non-returning transfer, not another nested-call starter. *Rejected:* a separate nested starter for each use (battle, menu, equipment, outcomes), which would fork the context, error and budget rules several ways.

**Who calls it, and with what pair.**

| Caller | Legacy (R12 §2): source and target | Legacy (R12 §2): restored afterwards? Certainty | Reawakened rule (OWNER): `context` dictionary and `source`/`target` |
|---|---|---|---|
| An enemy's custom AI program, on its turn | source = that enemy; target = a random living player, chosen by the engine before the program runs | No; certain | `{ source: enemy, target: randomLivingPlayer }` picked before the program ([BAT-7](battle.md#bat-7)); both restored when the program ends |
| A special move in battle | source = the user; target = the victim | No; certain | `{ source: user, target: victim, move: moveData, ... }`; both restored |
| An item used in battle | source = the user; target = the recipient | No; certain | `{ source: user, target: recipient, item: itemData, ... }`; both restored |
| A status program, each time its fighter's turn comes (BAT-6) | source = the afflicted fighter; target = the same fighter | No; certain | `{ source: fighter, target: fighter, status: statusName, ... }`; both restored |
| An item used from the menu | source = the player; target = the same player (3.1.0 menu defect stores an unusable player value from these slots) | No; certain | `{ source: player, target: player, item: itemData, ... }`; both restored (fixing the 3.1.0 menu defect so the program receives a usable player handle) |
| An ability (special move) used from the menu | source = the user; target = the chosen player (same 3.1.0 menu defect) | No; certain | `{ source: user, target: chosenPlayer, move: moveData, ... }`; both restored (fixing the 3.1.0 menu defect) |
| An equip program and a remove program | source left alone (not set by the engine); target = the wearer | Yes; certain | `{ target: wearer, item: itemData, slot: slotName }`; `source` omitted and **inherited** from the calling thread; restored |
| A board item's activation | source = the item; target = the selected player | Yes; certain | `{ source: item, target: selectedPlayer }` ([E-43](movement-and-collision.md#e-43)); both restored |
| The main file's custom fight program, when a random encounter fires | not recorded in R12 | not recorded in R12 | `{ source: null, target: null, trigger, board, actor, program }`: the 5.11 request is the `context`, with no fighters ([BAT-9](battle.md#bat-9)); a Reawakened choice (OWNER; Jensen, 2026-10-26); both slots restored when the program ends |
| A level-up, enemy win, enemy run, game-over, start-up, board-enter, key or link program | not set: the program sees whatever an earlier program or battle left in the slots | n/a; certain | `{ source: null, target: null }` (with room for reward/level details in `context`; a **departure**, OWNER): the caller passes `null` for both slots and restores afterwards |

**Reawakened rule: the last row (OWNER; Jensen, 2026-10-25).** Programs that legacy starts without setting the slots get no source and no target (`{ source: null, target: null }`, with room for outcome, reward, or level details in `context`), rather than a stale value another program left. The thread that runs a start-up, board-enter, key or link program has the plain-thread pair, `null`/`null` (THR-2); a caller that already holds a pair, such as the battle thread running a win, run, game-over or level-up program, explicitly passes `{ source: null, target: null }` so that program never inherits the enclosing battle's pair, and the caller's slots are restored when the call finishes. This is an approved **departure** from R12's stale values. *Rejected:* leaving the caller's pair in place (a win program would then see the last fighter pair of the battle, which depends on the order of the fight), and setting both slots to the character who levels up for a level-up program (R12 records no such behaviour; level-up details can travel in `context` instead).

**Legacy (R12 §3, §4, §8), order details the table does not show (all certain).**

* **Battle special move or item:** for a special move, the engine applies damage and SMP cost and sets the slots, then the battle system plays the animations, runs the program, and applies any status effect after the program returns. For an item in battle, the engine applies HP and SMP and sets the slots, then removes the item from the inventory before the animation and the program run; BAT-5's order ([R11-Q7](../../provenance/facts-round-11.md)) is consistent with this.
* **Item from the menu:** HP and SMP are given first, then the program runs, then the item is removed from the inventory.
* **Status program:** runs on every round tick (once per turn of the afflicted fighter, BAT-6), not when the effect is applied; the count of remaining rounds goes down after the program returns.
* **Enemy custom AI:** replaces the built-in AI for that turn, and the random living player target is picked before the program runs.
* **Equip and remove:** only the `equip` and `remove` script commands run these programs (the default menu's Equip and Remove options build and run those script commands; battles and save-loading never run them). `equip` runs in 5 steps: (1) take the new item from inventory, (2) remove whatever is in that slot (running the old item's remove program, taking off its bonuses, and putting it back in inventory), (3) check that the new item can be equipped and used by this character (in legacy, if step 3 fails or the item file is missing, the new item is lost and the slot is left empty), (4) add the new item's bonuses, (5) run the new item's equip program. `remove` runs the remove program before taking off the stat bonuses and before the item goes back into the inventory. In 3.1.0, `equip` matches items by file name only while the default menu passes the display name, so menu Equip fails in 3.1.0; the final source accepts either file name or display name (R12 §3, §8).
* **Level-up, win, run, game over:** see [progression-and-levels.md](progression-and-levels.md#level-up-rpgcode-hook) for the level-up order (program runs before the level increment and cannot skip or replace built-in stat growth, which is applied on top afterwards, followed by the level-gained message); the win and run programs use the last enemy with a non-empty name (run after escape; win after the experience and GP messages, BAT-8); the game-over program runs if set instead of the message and reset, and the `over` command does the same while ending the calling program.

**Open items (not ruled here).**

* **The message window and the screen for the outermost program.** The target lifecycle is ruled in [main-loop-and-startup.md#reawakened-script-surface-lifecycle](main-loop-and-startup.md#reawakened-script-surface-lifecycle): a program starts with a core-composed copy of the last presented frame and displays its surface with the message window. `send` redraws the board into that surface, replacing program drawing; the overlay is not composed live over the program, and toggling it causes no redraw. Ending a program hides the window flag without immediately erasing displayed pixels. This target is not implemented: today the live board and overlay compose around the script layer and old drawing can persist (#1067, #1171, #1172, #1182, #1183). See [ADR 0018](../../adr/0018-core-composed-program-starting-frame.md).
* **Pages not updated here:** the `over`, `equip` and `remove` rows of this page and the game-over entry of the main-file page still describe the earlier, shorter wording; they are listed in the pull request as follow-up documentation work.

*Evidence:* [facts-round-12.md](../../provenance/facts-round-12.md) §1 to §9 (reviewed in two independent clean-room passes and fact-checked against `2f986f3e` and `9191b919`); R2-Q11, R2-Q13 and R2-Q24 (`docs/provenance/facts-round-2.md`); [facts-round-11.md](../../provenance/facts-round-11.md) Q7, Q10 to Q13; FUN-7 in [rpgcode-language.md](rpgcode-language.md); ERR-1, ERR-2, THR-2 and THR-3 in [rpgcode-errors-and-threads.md](rpgcode-errors-and-threads.md); E-80's nested menu call in [plugins-and-battle.md](plugins-and-battle.md#e-80).

<a id="reawakened-replaceprogram"></a>
### `replaceProgram`: hand control to a different program (OWNER)

Signature: `void replaceProgram(string file, [object context])`. Legacy `run(file[, context])` is retained as a backwards-compatible alias for Toolkit 3.1 games. A successful replacement has no return value because it never returns.


```
replaceProgram("nextChapter.prg")                              // fresh context = {}; retain the thread's source & target
replaceProgram("aftermath.prg", { source: hero, target: null, chapter: 2 })
run("nextChapter.prg")                                         // legacy Toolkit 3.1 alias, same non-returning transfer
```

**Precisely — order and scope.** Resolve the file and the shared [`context` / legacy handle bridge](#reawakened-executeprogram) against the pre-replacement thread state first. Once valid, unwind the current program-frame chain, including its function frames, nested-program continuations, locals, handlers and pending source/target restoration records. Then start the replacement's root program frame with fresh locals, its own `autoLocal` setting (default off), its own handlers, and the new `context` binding (default `{}`). Globals remain shared. Install the resolved source/target pair on the existing thread; omitted payload keys inherit its pre-replacement slots. There is no old root-scope `context` to resume and no later restoration to discarded callers. A nested `executeProgram` invoked by the replacement still restores the replacement's slots when that nested call finishes. *Rejected:* keeping the old program chain alive beneath the new one, returning to an enclosing caller, or starting a new thread.

**Precisely — errors and empty names.** Argument validation, live-handle resolution and the `program.missing` diagnostic follow the shared rules above and happen before the old chain is discarded; a failed replacement leaves the calling program and its slots intact and follows ERR-2. As with `executeProgram`, an empty filename is a silent no-op with no slot changes or unwind; the current program continues. Errors after a successful start belong to the replacement's handlers and file/line diagnostic, not to discarded handlers. Completion (`end()`, `done`, `stop` or end of file) ends the replacement root; it cannot return into the old chain. *Rejected:* discarding the caller before checking whether its replacement can start.

**Precisely — deterministic state and cost.** The replacement is a state transition of the same explicit VM step machine: the command itself costs one VM step, the new program's instructions spend that thread's existing per-tick budget, and replacement grants neither a new thread id nor a fresh budget ([THR-3](rpgcode-errors-and-threads.md#thr-3)). The replacement frame, root-scope `context` and installed thread slots are plain snapshot data (G1); save/restore resumes the replacement at its saved instruction without resurrecting the old chain. No wall clock, timer or native interpreter recursion is involved (G3). The scope and payload semantics are shared with `executeProgram`; the non-returning control flow is not.

## Variables, strings & math (30)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `empty` | `void empty()` | Clear all globals. |  |
| `random` | `int random(int max, [int &ret])` | Generate a random number from one to the supplied maximum, inclusive. |  |
| `castnum` | `double castnum(variant x, [double &ret])` | Cast the specified value to a number (double). There is really no need to do this ever. RPGCode by itself will cast values passed to functions to the correct types as... |  |
| `castlit` | `string castlit(variant x, [string &ret])` | Cast the specified value to a string. There is really no need to do this ever. RPGCode by itself will cast values passed to functions to the correct types as required. |  |
| `castint` | `int castint(variant x, [int &ret])` | Cast the specified value to an integer (i.e., a number in the sequence ...-2, -1, 0, 1, 2...). This is useful for removing fractional parts of numbers. Note that this... |  |
| `charat` | `string charat(string str, int pos, [string &ret])` | Get a character from a string. The first character is one. |  |
| `kill` | `void kill(variant &var, ...)` | Delete variables. |  Reawakened rule (entry 19.1, [KILL-1](rpgcode-language.md#kill-1)): in plain terms, it removes a variable or object field you made, and it cannot remove a name the engine controls. Precisely, it deletes only storage the script owns (a global, a local, a captured cell variable, an object field; `kill(obj.field)` removes the key). Engine-controlled names (the `tk*` constants, the engine virtual variables and actor stat aliases such as `HP!`) raise the catchable runtime error `kill.system-owned` and are left untouched. |
| `sin` | `double sin(double x, [double &ret])` | Calculate sine x. |  |
| `cos` | `double cos(double x, [double &ret])` | Calculate cosine x. |  |
| `tan` | `double tan(double x, [double &ret])` | Calculate tangent x. |  |
| `sqrt` | `double sqrt(double x, [double &ret])` | Calculate the square root of x. |  |
| `local` | `variant &local(variant &var, [variant &ret])` | Allocates a variable off the stack and returns a reference to it. |  |
| `global` | `variant &global(variant &var, [variant &ret])` | Allocates a variable on the heap and returns a reference to it. |  |
| `length` | `int length(string str[, int &ret])` | Get the length of a string. |  |
| `len` | `int len(string str[, int &ret])` | Get the length of a string. | alias of `length` |
| `instr` | `int instr(string haystack, string needle[, int offset])` | Returns the first occurence of needle within haystack, optionally starting from an offset. Both the return value and the offset are one-based. |  |
| `splicevariables` | `string splicevariables(string str)` | Replaces substrings within angle brackets by the value of variables with respective names. |  |
| `split` | `int split(string str, string delimiter, array arr)` | Splits a string at a delimiter. Returns the number of upper bound of the array (i.e. the index of the last set element). |  |
| `asc` | `int asc(string chr[, int &ret])` | Get the ASCII value of a character. |  |
| `chr` | `string chr(int asc, [string &ret])` | Get the character represented by the ASCII code passed in. |  |
| `trim` | `string trim(string str, [string &ret])` | Trim whitespace from a string. |  |
| `right` | `string right(string str, int amount, [string &ret])` | Get characters from the right of a string. |  |
| `left` | `string left(string str, int amount[, string &ret])` | Get characters from the left of a string. |  |
| `log` | `double log(double x, [double &ret])` | Returns n such that en = x. |  |
| `autolocal` | `void autolocal(bool bEnabled)` | Set the default scope for variable resolution. When autolocal() is not enabled, variables are assumed to be global unless a local variable has been defined. When... |  |
| `lcase` | `string lcase(string str, [string &ret])` | Convert a string to lowercase. |  |
| `ucase` | `string ucase(string str, [string &ret])` | Convert a string to uppercase. |  |
| `mid` | `string mid(string str, int start, int length[, string &dest])` | Obtain a substring. The offset is one-based. |  |
| `replace` | `string replace(string str, string find, string replace[, string &dest])` | Replace within a string. |  |
| `regexpreplace` | `string regexpreplace(string subject, string pattern, string replace)` | Replace using a regular expression. |  |

## Threads (7)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `thread` | `thread thread(string file, bool persist, [thread &ret])` | Start a thread. |  |
| `killthread` | `void killthread(thread id)` | Kill a thread. |  |
| `getthreadid` | `thread getthreadid([thread &ret])` | Get the ID of this thread. |  |
| `threadsleep` | `void threadsleep(thread id, double seconds)` | Put a thread to sleep. |  |
| `tellthread` | `variant tellthread(thread id, string code)` | Execute code in the context of a thread (e.g., to run a method located in another thread). TellThread() returns the value returned by the function called in the thread. |  |
| `threadwake` | `void threadwake(thread id)` | Wake up a thread. |  |
| `threadsleepremaining` | `double threadsleepremaining(thread id, [double &ret])` | Check how much sleep remains for a thread. |  |

<a id="board-tiles-vectors-and-screen-effects"></a>
## Board, tiles, vectors & screen effects (33)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `send` | `void send(string file, int x, int y, [int z = 1])` | Send the player to a new board. | Tile coordinates; the caller resumes on the next tick on the new board ([E-19](movement-and-collision.md#reawakened-send-board)). |
| `fade` | `void fade(int type)` | Perform a fade using the current colour. There are several different types of fades. | Types 0 to 5 are stepped effects, 0 when the argument is omitted; every effect runs 30 fixed ticks and blocks; any other type does nothing. |
| `viewbrd` | `void viewbrd(string filename [, int x, int y [, canvas cnv]])` | Draw a board to the screen or to a canvas, starting at co-ordinates topX, topY. |  |
| `move` | `void move(int x, int y, [int z = 1])` | Move this board program to a new location on the board. The effect lasts until the board has been left. |  |
| `prg` | `void prg(string program. int x, int y, [int z = 1])` | Move a program on the current board to a new location. This stays in effect until the board is left. |  |
| `put` | `void put(int x, int y, string tile)` | Puts a tile at the specified location on the board. The tile persists only until the program ends. Use LayerPut() to place a tile for the duration the user is on the... |  |
| `tiletype` | `void tiletype(int x, int y, string type, [int z = 1])` | Change a tile's type. Valid types for the string parameter are "NORMAL", "SOLID", "UNDER", "NS", "EW", "STAIRS#". |  |
| `mainfile` | `void mainfile(string gam)` | Load a new main file. | Requests the board-rendering lifecycle to switch the project; the call does not wait. |
| `scan` | `void scan(int x, int y, int pos)` | Save the tile specified to a buffer identified by pos. There is no particular number to pick for pos; any will do. | deprecated, still works |
| `mem` | `void mem(int x, int y, int pos)` | Lay a scanned tile on the screen at the specified position. | deprecated, still works |
<a id="reawakened-camera-built-ins"></a>
| `zoom` | `zoom(int percent)` | Zoom into the centre of the board by the specified percent. | LOW confidence: `percent` is the shrink amount, not a scale; each call blocks for a bounded 30 ticks. |
| `earthquake` | `earthquake(int intensity)` | Make the screen jump more strongly as intensity rises, from 1 (barely noticeable) to 10 (strongest). The command waits until the shaking ends. | **Technical (OWNER):** clamp `intensity` to 1..10, then run `i` consecutive `shake(amplitudeForIntensity(p), 4)` calls for `p = 1..i`; each pass is four ticks, so the command blocks for `4*i` ticks. `amplitudeForIntensity(p) = p * PX_PER_INTENSITY`, with `PX_PER_INTENSITY = 1` logical pixel. Pass/corner facts are owner-relayed legacy facts logged by entry 2, never source-derived here. |
| `getcorner` | `void getcorner(int &topX, int &topY)` | Get the corner of the currently shown portion of the board. |  |
| `cameraPanTo` | `void cameraPanTo(double x, double y, double duration, string easing)` | Pan the camera to a point. | Reawakened addition; duration is seconds; easing is `linear`, `smoothstep`, `easeIn`, `easeOut` or `easeInOut`; non-blocking. |
| `cameraFollow` | `void cameraFollow(int entityId)` | Follow an entity with the camera. | Reawakened addition. |
| `cameraReset` | `void cameraReset()` | Restore default player-follow camera behaviour. | Reawakened addition. |
| `cameraShake` | `void cameraShake(double duration, double amplitude)` | Make the camera wobble for a while; a larger amplitude feels stronger, and the command does not hold up the script. | **Technical (OWNER):** duration is seconds and amplitude is logical-viewport pixels; `durationTicks = ceil(duration × 60)`, minimum one tick for positive duration; use the shared deterministic `shake(amplitude, ticks)` primitive, non-blocking, with a new shake replacing the active one and no RNG draw. |
| `layerput` | `void layerput(int x, int y, int layer, string tile)` | Place a tile on the board for the duration the player is on the board. |  |
| `getboardtile` | `string getboardtile(int x, int y, int z, [string &ret])` | Get the file name of the tile at x, y, z. |  |
| `boardgettile` | `string boardgettile(int x, int y, int z, [string &ret])` | Get the file name of the tile at x, y, z. | alias of `getboardtile` |
| `getboardtiletype` | `string getboardtiletype(int x, int y, int z[, string &ret])` | Get the type of a tile. |  |
| `forceredraw` | `void forceredraw()` | Force a redrawing of the screen. |  |
| `wipe` | `wipe(string file, int effect [, int speed])` | 'Wipe' a graphic to the screen. file: filename of the image to wipe to. effect: numeric value between 1 and 12. The valid types are: | Effects 1–4 reveal, 5–8 are diagonals and 9–12 are push slides; the default speed is 1 pixel per fixed tick; the call blocks and ends on exactly the new image. |
| `parallax` | `parallax(int setting)` | obsolete. | obsolete: raises an error and the statement is skipped |
| `animatedtiles` | `void animatedtiles()` | Toggle animated tiles. | obsolete: raises an error and the statement is skipped |
| `smartstep` | `void smartstep()` | Toggle "smart" stepping. | obsolete: raises an error and the statement is skipped |
| `getboardname` | `string getboardname([string ret])` | Get the current board's file name. |  |
| `setambientlevel` | `void setambientlevel(int red, int green, int blue)` | Set the global ambient level. Valid values range from -255 to + 255. |  |
| `boardgetvector` | `int boardgetvector()` | void boardGetVector(variant vector, int &type, int &pointCount, int &layer, bool &isClosed, int &attributes) |  |
| `boardsetvector` | `void boardsetvector(variant vector, int type, int pointCount, int layer, bool isClosed, int attributes)` | Sets the properties of a given vector. |  |
| `boardgetvectorpoint` | `void boardgetvectorpoint(variant vector, int pointIndex, int &x, int &y)` | Get a single point on a board vector. x, y are always pixel values. |  |
| `boardsetvectorpoint` | `void boardsetvectorpoint(variant vector, int pointIndex, int x, int y, bool apply)` | Set/move a single point on a board vector. x, y are always pixel values. |  |
| `boardgetprogram` | `void boardgetprogram(int programIndex, string &program, int &pointCount, int &layer, bool &isClosed, int &attributes, int &distanceRepeat)` | int boardGetProgram() |  |
| `boardsetprogram` | `void boardsetprogram(int programIndex, string program, int pointCount, int layer, bool isClosed, int attributes, int distanceRepeat)` | Sets the properties of a given program; creates a new program if one-past-the-end index is given. |  |
| `boardgetprogrampoint` | `void boardgetprogrampoint(int programIndex, int pointIndex, int &x, int &y)` | Get a single point on a board program. x, y are always pixel values. |  |
| `boardsetprogrampoint` | `void boardsetprogrampoint(int programIndex, int pointIndex, int x, int y)` | Set/move a single point on a board program. x, y are always pixel values. |  |

<a id="e-14"></a>
**E-14 Runtime board edits.** Scripts can place tiles (`Put`, `LayerPut`), change legacy tile types, read tiles, add, modify or delete **vectors** and **programs** point by point, and redraw. Path-finding data is rebuilt when a vector edit is "applied".

<a id="reawakened-tile-edit-lifetimes"></a>

**Reawakened rule — tile edit lifetimes and order.** `Put` and `LayerPut` take effect in command/effect order. For each layer and cell, the most recent edit whose lifetime is still active supplies the visible tile. When a program thread finishes, its `Put` edits expire during end-of-thread-phase cleanup. When the engine removes a thread early—including `killThread`, event-thread teardown, or board/item lifecycle cleanup—only that thread's `Put` edits expire, synchronously before subsequent script work can reuse its numeric id. Edits owned by active threads and board-scoped `LayerPut` edits remain, so the latest remaining edit is visible. If no edit remains, restore the tile from the board before runtime edits. `LayerPut` lasts until the board is left.

<a id="e-59"></a>
**E-59 Transitions and effects.** Fades of several types, wipes with an image (several effects and speeds), zoom, earthquake shake, and the border colour.
<a id="reawakened-fade-types"></a>
**Reawakened rule (OWNER; adopts the owner-relayed round-7 legacy facts; the stated tick count is a Reawakened determinism choice).** An author can play a screen effect with `fade(type)`; each type is a different animated effect. The types are: 0, a growing box (also the type used when the argument is omitted); 1, stripes sweeping across the screen; 2, a grey ramp; 3, a sliding grey strip; 4, black ellipse rings; 5, a colour overlay. Technically, a type outside 0–5 does nothing: it raises no `builtin.bad-arg`, records no effect and does not wait. Legacy effects have no fixed duration, so for determinism every effect advances in exactly 30 steps, one step per fixed-60-Hz tick, with integer progress `n/30` for step `n` (1 to 30), no wall-clock and no RNG. The command records a blocking `fx.fade` effect carrying the type and resumes after the thirtieth tick. The round-7 answer gives only the visual name of each type; it does not give the per-step geometry (stripe width and direction, strip width, ring spacing and thickness, the grey and overlay colours) or whether the screen is left covered or restored after the last step. Those details are **unverified** and the owner must settle them in entry 4.22's plan before it builds; this rule fixes only the type table, the 30-tick blocking schedule and the no-op for other types. The earlier table (1 fade out, 2 fade in, 3 out then in, 4 crossfade; type 0 and values above 4 raising `builtin.bad-arg`) is withdrawn; the evidence is the owner-relayed round-7 answer to Q1.

<a id="reawakened-wipe-effects-and-speed"></a>
**Reawakened rule (OWNER; adopts the owner-relayed round-7 legacy facts; the additions are Reawakened determinism choices).** An author can wipe to an image with `wipe(file,effect,speed)`. Effects 1–4 are left-to-right, right-to-left, top-to-bottom and bottom-to-top reveals (these agree with the legacy effects). Effects 5–8 are diagonal reveals and 9–12 are push slides, where the new image pushes the old one off the surface. The round-7 answer does not say which corner or direction each diagonal or slide uses; the Reawakened choice, unverified, is: 5 from the top-left corner, 6 top-right, 7 bottom-left, 8 bottom-right; 9 the new image enters from the left, 10 from the right, 11 from the top, 12 from the bottom. The optional `speed` is a number of logical pixels per fixed tick and defaults to 1 (legacy: pixels per redraw, scaled by the frame rate; the Reawakened rule treats one fixed tick as one redraw with scale factor 1, which the owner confirmed on 2026-10-18 matches the legacy feel: the default speed takes about 10 seconds across 640 pixels, and a larger number is faster). After `t` ticks the progress is `s = min(T, speed × t)`, where `T` is the surface width for effects 1, 2, 9 and 10, the height for 3, 4, 11 and 12, and `width + height − 1` for diagonals; a diagonal reveals the pixels whose distance index from the start corner, `x' + y'`, is below `s`, and a push slide offsets the old image by `s` pixels and the new one by `s − width` (or `s − height`). The wipe lasts `ceil(T / speed)` ticks, so the default speed on a 640 × 480 surface lasts 640 ticks for a horizontal wipe. A `speed` of 0 raises `builtin.bad-arg` (legacy speed 0 hangs and is not reproduced; a negative speed is treated the same way); a speed larger than `T` completes in one tick. On the last tick the surface is exactly the resolved image (a Reawakened addition: legacy has no final full-image draw and the old image can remain), and the call blocks until then. The earlier mapping (5–8 centre-out and edges-in, 9–12 diagonals), the percentage-per-tick speed with default 4 and the speed 0 one-tick completion are withdrawn; the evidence is the owner-relayed round-7 answer to Q2.

<a id="reawakened-zoom"></a>
**Reawakened rule (OWNER; LOW confidence, flagged for owner review).** An author can zoom the board in with `zoom(percent)`. The round-7 answer is that the argument is a *shrink amount*, not a scale, and that each call blocks until it has finished. The unit of the shrink is not given, so the Reawakened reading is: `percent` is how much smaller the visible part of the board becomes, as a per-cent of the full view, so the camera shows `100 − percent` per cent of the logical width and height around its current logical centre, magnified nearest-neighbour to fill the surface. `zoom(0)` is the unzoomed view; values below 0 or above 75 (a magnification of 4, the earlier limit) raise `builtin.bad-arg`. Each call blocks, but its duration is bounded for determinism: the shrink moves linearly in integer steps from the current value to the new one in 30 fixed ticks (`current + floor((target − current) × t / 30)` after `t` ticks), and the final tick is exactly the target. The round-7 answer's remark that a call runs for minutes at 60 frames per second came from reading the timing arithmetic, not from running a game (LOW confidence), and is **not** adopted. A new call starts from the current value; the zoom persists until the next call and does not change world coordinates. The earlier scale reading (100 is one-to-one, 1–400 valid, non-blocking, `zoom(100)` clears) is withdrawn; the evidence is the owner-relayed round-7 answer to Q6.

<a id="reawakened-earthquake"></a>
**Reawakened rule (OWNER; `earthquake` and `cameraShake` help).** An author can use `earthquake` when the whole game should jump in increasingly strong four-tick bursts and the script must wait for the effect; use `cameraShake` when the camera should wobble without stopping the script. Intensity is clamped to 1–10 for `earthquake`; amplitude is measured in logical-viewport pixels for `cameraShake`.

**Technical rule (OWNER).** `earthquake(intensity)` clamps `i` to 1..10 and runs `i` consecutive `shake(amplitudeForIntensity(p), 4)` calls for `p = 1..i`, blocking through the sleep wait until the final call ends. This is `4*i` ticks. `cameraShake(duration, amplitude)` converts positive seconds to `ceil(duration × 60)` ticks (minimum one), uses the same shared primitive and is non-blocking; a new shake replaces the active one. The shared primitive, corner cycle and `amplitudeForIntensity` constant are defined at [movement-and-collision.md#e-51](movement-and-collision.md#e-51). Pass/corner/5 ms details are owner-relayed legacy facts logged by entry 2 as round 7, never presented as read from source. Evidence includes the owner-relayed report and the authored corpus fixtures `fixtures/legacy/Caoquest/Prg/earthquake.prg` and `fixtures/legacy/ChimeranEmpire/Prg/Fire Bomb.prg`.

<a id="e-63"></a>
**E-63 Board preview.** `ViewBrd` renders a board, or part of one, to the screen or to a canvas without entering it.

## Players, party & sprite movement (31)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `newplyr` | `void newplyr(string file)` | Change the graphics of the main player to that of the file passed in. The file must be a character file (*.tem) |  |
| `newplayer` | `void newplayer(string file)` | Change the graphics of the main player to that of the file passed in. The file must be a character file (*.tem) | alias of `newplyr` |
| `push` | `void push(string direction [, variant handle [, int flags]])` | Push the player with the specified handle, or the default player if no handle is specified, along the given directions. The direction should be a comma delimited, but... |  |
| `addplayer` | `void addplayer(string file)` | Add a player to the party. |  |
| `removeplayer` | `void removeplayer(string handle)` | Remove a player from the party [to an old player list]. |  |
| `putplayer` | `void putplayer(string handle, int x, int y, int layer)` | Place the player on the board at the given location. |  |
| `eraseplayer` | `void eraseplayer(string handle)` | Erase a party player from the screen. |  |
| `restoreplayer` | `void restoreplayer(string filename)` | Restore a player who was previously on the team. |  |
| `targetlocation` | `void targetlocation(int &x, &int y)` | Get the location of the target object. |  |
| `walkspeed` | `void walkspeed()` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `posture` | `posture(int id [, handle player])` | Show a custom player animation named "Custom" + str(id) (e.g. "Custom1") This command is obsolete - use playerStance() instead. | deprecated, still works |
| `destroyplayer` | `void destroyplayer(string handle)` | Permanently remove a player from the party. |  |
| `callplayerswap` | `callplayerswap(...)` | Unimplemented in 3.1.0. | not implemented (does nothing) |
| `stance` | `stance(int id [, handle player])` | Show a player stance. | obsolete: shows a warning (when warnings are on) and still runs |
| `characterspeed` | `void characterspeed()` | Obsolete. | obsolete: shows a message, then acts as `gamespeed` |
| `sourcelocation` | `void sourcelocation(int &x, &int y)` | Get the location of the source object. |  |
| `targethandle` | `string targethandle([string &ret])` | Get the handle of the target object. |  |
| `sourcehandle` | `string sourcehandle([string &ret])` | Get the handle of the source object. |  |
| `pathfind` | `string pathfind(int x1, int y1, int x2, int y2, string &ret [, int layer])` | Construct a directional string of the shortest tiled path from one location to the other. |  |
| `playerstep` | `void playerstep(variant handle, int x, int y [, int flags])` | Move a player to a board point. The engine queues a deterministic path to `(x,y)`; a blocking thread or `tkMV_PAUSE` waits for movement completion. |  |
| `gamespeed` | `void gamespeed(int speed)` | Make all walking feel faster or slower. The value changes the fixed-tick cadence used by sprite movement. |  |
| `onboard` | `int onboard(variant handle)` | Check whether a player is shown on the board. |  |
| `pixelmovement` | `bool pixelmovement([bool pixelMovement [, bool pixelPush]])` | Choose whether movement and pushing use pixel steps. The setting is read by the deterministic movement phase. |  |
| `playerspeed` | `void playerspeed(string handle, int speed)` | Set how quickly a player walks. The speed is stored on the actor and affects its fixed-tick step cadence. |  |
| `playerstance` | `playerstance(handle player, string stance [, int flags])` | Play a player's stance animation. The command waits for the animation owner to report completion. |  |
| `playerlocation` | `void playerlocation(variant handle, int &x, int &y, int &layer)` | Read where a player is now. Pixel x/y and the one-based layer are written through the references. |  |
| `spritetranslucency` | `void spritetranslucency(int percent)` | Set how visible sprites remain under covered tiles. |  |
| `activeplayer` | `void activeplayer(variant handle)` | Choose or read the active player. Selection is stored by stable player handle. |  |
| `playerpath` | `void playerpath(variant handle, int flags, int x1, int y1, ... , int xn, int yn)` | Give a player one or more destinations. Points, path-find mode, and waypoint copy/link mode are queued deterministically; pause or blocking waits for completion. |  |
| `playergetpath` | `int playergetpath(variant handle)` | Inspect a queued player destination. The indexed pixel point is returned through x/y references. |  |
| `playerdirection` | `int playerdirection(variant handle)` | Read or set which way a player faces. The facing is one of the eight deterministic directions. |  |
## Items, inventory, shop & gold (28)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `giveitem` | `void giveitem(string itm)` | Add one item from an item file to the inventory. | Filename; `.itm` is appended when absent. |
| `takeitem` | `void takeitem(string itm)` | Remove one available item from the inventory by item filename. | Filename; `.itm` is appended when absent. This script built-in is not blocked by the stock-menu key-item drop restriction. |
| `pushitem` | `void pushitem(variant item, string direction [, int flags])` | Push an item in a direction. Each direction queues a fixed movement target, and pause or blocking waits for completion. |  |
| `wander` | `void wander(variant target, [int restrict = 0])` | Let an item take a deterministic random step. The injected seed controls the chosen direction and the optional restriction. |  |
| `equip` | `void equip(variant handle, int location, string item)` | Equip one available item on a party member. | `handle` accepts a player handle or character filename; `item` accepts a handle or item filename. The 1-based location clamps to 1–16: head, neck, right hand, left hand, body, legs, then custom accessory slots 7–16. |
| `remove` | `void remove(variant handle, int location)` | Unequip an item from a party member. | `handle` accepts a player handle or character filename; the 1-based location clamps to 1–16 as documented for `equip`. |
| `givegp` | `void givegp(int gp)` | Add gold through the inventory owner. | Requires a non-negative safe integer; zero does nothing, and invalid or overflowing additions are refused atomically. |
| `takegp` | `void takegp(int gp)` | Remove gold through the inventory owner. | Requires a non-negative safe integer; zero does nothing, and invalid or unaffordable removals are refused atomically. |
| `getgp` | `int getgp([int &ret])` | Read current inventory gold. | Returns the balance and writes it through the optional reference. |
| `callshop` | `void callshop(string item1, string item2, string item3, ...)` | Run a blocking shop session with the listed items. | Requires at least 1 item filename. Reawakened `CallShop` waits for `menu.screen`; menu owns screen presentation and performs transactions through the E-83 owner actions. Arguments resolve strictly as filenames relative to the Item directory (appends `.itm` if missing); 0 arguments or missing/invalid files raise a script error and fail to open. |
| `eraseitem` | `void eraseitem(variant handle)` | Erase an item from the screen, but keep it in memory. |  |
| `putitem` | `void putitem(variant handle, int x, int y, int layer)` | Place the item on the board at the given location. |  |
| `createitem` | `int createitem(string filename[, int &pos])` | Load an item and return the slot into which it was loaded. |  |
| `destroyitem` | `void destroyitem(variant handle)` | Remove an item from memory. |  |
| `itemwalkspeed` | `void itemwalkspeed()` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `itemcount` | `int itemcount(string fileName[, int &ret])` | Count available inventory items by filename or handle. | With `.itm`, compare item filenames case-insensitively; otherwise compare item handles case-insensitively. |
| `itemlocation` | `void itemlocation(variant handle, int &x, int &y, int &layer)` | Read where an item is now. Pixel x/y and the one-based layer are written through the references. |  |
| `itemstep` | `void itemstep(variant handle, int x, int y [, int flags])` | Move an item to a board point. The engine queues a deterministic path and pause or blocking waits for completion. |  |
| `getitemname` | `string getitemname(string fileName[, string &ret])` | Get an item's handle. |  |
| `getitemdesc` | `string getitemdesc(string fileName[, string &ret])` | Get an item's description. |  |
| `getitemcost` | `int getitemcost(string fileName[, int &ret])` | Get an item's cost. |  |
| `getitemsellprice` | `int getitemsellprice(string fileName[, int &ret])` | Get the price for which an item sells. |  |
| `shopcolors` | `shopcolors(int index, int r, int g, int b)` | Set shop colors. | obsolete: shows a warning (when warnings are on) and still runs |
| `itemspeed` | `void itemspeed(variant handle, int speed)` | Set how quickly an item walks. The speed is stored on the actor and affects fixed-tick cadence. |  |
| `itemstance` | `itemstance(handle item, string stance [, int flags])` | Play an item's stance animation. The command waits for the animation owner to report completion. |  |
| `itempath` | `void itempath(variant handle, int flags, int x1, int y1, ... , int xn, int yn)` | Give an item destinations. Points, path-find mode, and waypoint copy/link mode are queued deterministically; pause or blocking waits for completion. |  |
| `itemgetpath` | `int itemgetpath(variant handle)` | Inspect a queued item destination. The indexed pixel point is returned through x/y references. |  |
| `itemdirection` | `int itemdirection(variant handle)` | Read or set which way an item faces. The facing is one of the eight deterministic directions. |  |

<a id="e-31"></a>
**E-31 Sprite translucency.** The parts of a sprite that are covered by higher content are drawn translucently (`SpriteTranslucency(%)`), so the player stays visible behind trees and roofs.

<a id="e-32"></a>
**E-32 Scripted sprite control.** Place, erase, create and destroy items; get or set a location and a facing; set a speed; play a stance; swap a player's graphics (`NewPlayer`); wander randomly, optionally restricted; query the queued path.

## Battle, stats & menus (33)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `fight` | `void fight(int skill, string background)` | Start a skill level fight. |  |
| `win` | `void win()` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `hp` | `void hp(string handle, int value)` | Set a fighter's hp. |  |
| `givehp` | `void givehp(string handle, int add)` | Increase a fighter's current hp. |  |
| `gethp` | `int gethp(string handle, [int &ret])` | Get a fighter's hp. |  |
| `maxhp` | `void maxhp(string handle, int value)` | Set a fighter's max hp. |  |
| `getmaxhp` | `int getmaxhp(string handle, [int &ret])` | Get a fighter's max hp. |  |
| `smp` | `void smp(string handle, int value)` | Set a fighter's smp. |  |
| `givesmp` | `void givesmp(string handle, int value)` | Increase a fighter's smp. |  |
| `getsmp` | `int getsmp(string handle, [int &ret])` | Get a fighter's smp. |  |
| `maxsmp` | `void maxsmp(string handle, int value)` | Set a fighter's max smp. |  |
| `getmaxsmp` | `int getmaxsmp(string handle, [int &ret])` | Get a fighter's max smp. |  |
| `fightenemy` | `void fightenemy(string enemy, string enemy, ... string background)` | Start a fight. |  |
| `attackall` | `void attackall(int fp)` | Deal the specified amount in HP to all the members of the target's party. |  |
| `drainall` | `void drainall(int fp)` | Deal the specified amount in SMP to all the members of the target's party. |  |
| `inn` | `inn()` | Fully heal the player party. | Headless stat restoration: immediately sets HP to max HP and SMP to max SMP for all active party members, including reviving fallen members; charges 0 GP and leaves status effects unchanged. |
| `getlevel` | `int getlevel(string handle[, int &ret])` | Get the level of a player. |  |
| `ai` | `void ai(int level)` | Have the source enemy use the internal AI. |  |
| `menugraphic` | `void menugraphic(string image)` | Choose an image for the menu. |  |
| `fightmenugraphic` | `void fightmenugraphic(string image)` | Choose an image for the fight menu graphic. |  |
| `fightstyle` | `void fightstyle()` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `battlespeed` | `void battlespeed(int speed)` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `getdp` | `int getdp(string handle, [int &ret])` | Get a fighter's dp. |  |
| `getfp` | `int getfp(string handle, [int &ret])` | Get a fighter's fp. |  |
| `internalmenu` | `void internalmenu(int menu)` | Open a menu by compatibility index. | Reawakened compatibility adapter: 0 = main, 1 = items, 2 = equipment, 4 = abilities; all other values are rejected. These arguments are not legacy native `menu(request)` values (1/2/4/8). |
| `mainmenu` | `void mainmenu()` | Open the main menu. | Reawakened facade; invokes the `main` menu provider immediately and blocks the calling thread until it closes. |
| `itemmenu` | `void itemmenu()` | Open the items menu. | Reawakened facade; invokes the `items` menu provider immediately and blocks the calling thread until it closes. |
| `equipmentmenu` | `void equipmentmenu()` | Open the equipment menu. | Reawakened facade; invokes the `equipment` menu provider immediately and blocks the calling thread until it closes. |
| `abilitiesmenu` | `void abilitiesmenu()` | Open the abilities menu. | Reawakened facade; invokes the `abilities` menu provider immediately and blocks the calling thread until it closes. |
| `applystatus` | `void applystatus(string target, string file)` | Apply a status effect to a fighter. |  |
| `removestatus` | `void removestatus(string target, string file)` | Remove a status effect from a fighter. |  |
| `drawenemy` | `void drawenemy(string file, int x, int y, [canvas cnv])` | Draw an enemy. | Draws battle asset frame 0 at logical pixel coordinates without changing battle state or consuming RNG. |
| `giveexp` | `void giveexp(string handle, int amount)` | Give experience to a player. |  |

### Reawakened actor-stat aliases (not part of the 282 legacy catalogue)

These three additions operate on the referenced actor's stats in Reawakened; they are registered in the battle-stat group but are not legacy 3.1 command names. In plain language, `fp` sets fight power, `givefp` increases it, and `dp` sets defence points.

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `fp` | `void fp(string handle, int value)` | Set a fighter's fp. | Reawakened actor-stat alias; updates the actor's fight power. |
| `givefp` | `void givefp(string handle, int add)` | Increase a fighter's fp. | Reawakened actor-stat alias; adds `add` to the actor's fight power. |
| `dp` | `void dp(string handle, int value)` | Set a fighter's dp. | Reawakened actor-stat alias; updates the actor's defence points. |

<a id="reawakened-draw-enemy"></a>
**Reawakened rule (OWNER; unverified default).** `drawenemy(file,x,y,canvas)` draws frame 0 of the named battle asset at logical-pixel coordinates on the selected canvas. It emits a draw command only: it does not mutate battle state, advance a battle turn or consume RNG, and it does not wait. Invalid asset or canvas references are reported through the normal deterministic asset diagnostic.

<a id="reawakened-pinnedanimation"></a>
**Reawakened rule (entry 7.11; OWNER, Jensen, approved 2026-10-28).** *In plain terms:* `pinnedanimation(file, x, y, loop)` puts an animated picture on the screen that the engine keeps animating by itself, one frame step per frame delay, no matter how busy the script is. A battle screen uses it for each fighter's stance, so a fighter's animation never waits for the script to redraw the screen. *Precisely:* it is `animation` ([E-54](plugins-and-battle.md#e-54)) with two documented differences. (1) **Placement.** The composed frame draws pinned animations after the render-now canvas ([E-57](main-loop-and-startup.md#e-57)) and before the debug overlays and the text layer, in creation order; an ordinary animation still draws below the canvas. Where a script wants a pinned picture visible, its canvas must leave that area clear or simply not draw there. (2) **Holding.** A pinned animation whose `loop` is false plays once and then shows its last frame until `endanimation`; it is not removed. A pinned looping animation loops until `endanimation`. The frame shown is a pure function of the animation's start tick, its frame delay and the current tick, so it is the same on every run, host and save/load; the saved animation records that it is pinned. The call does not wait and returns the same deterministic id as `animation`; `endanimation` with that id removes it, and an unknown id is ignored. A missing or undecodable file is the ordinary `asset.missing` / `asset.invalid` diagnostic and the animation never shows. `showpinnedanimation(id, show)` hides or shows one without touching its timeline (the saved animation records `hidden` only while hidden); an unknown id or a non-pinned animation is ignored. A script that covers the picture's area with its own drawing hides the picture instead of ending it, so a restart cannot replay a one-shot. Whenever an animation ends (`endanimation`, a one-shot that is not pinned finishing, or a failed load) the engine releases the pictures it decoded for it (an animated GIF's frames), so starting and ending animations repeatedly does not accumulate surfaces. *Rejected:* redrawing each frame from the script (measured: a script cannot repaint a screen of eight animated fighters every tick inside the per-tick step budget, so a one-tick frame delay aliased to every second or fourth frame); raising the step budget (it moves the limit instead of removing it and changes every other script's timing); changing `animation` to draw above the canvas (it would reverse the E-57 placement for existing games).

<a id="e-83"></a>
**E-83 Shop.** `CallShop(item, …)` opens a buy/sell screen that uses each item's buy and sell prices and the party's gold; its colours are configurable.

<a id="e-84"></a>
**E-84 Inn.** `Inn()` fully restores the party.

<a id="e-86"></a>
**E-86 Gold.** A global integer, changed by battle rewards, by the shop and by scripts.

**Reawakened rule (OWNER; Epic 8.6 shop and inn contract).** E-83/E-84/E-86 remain the compatibility baseline: shop uses item buy/sell prices and party gold, Inn fully restores the party, and gold is inventory-owned. The existing `callshop(item1, ...)` activates the menu-owned shop context and waits on `menu.screen`; screen presentation belongs to the menu, not the command. `inn()` performs its party operation synchronously. No public RPGCode built-ins are added. `getitemcost(fileName)` and `getitemsellprice(fileName)` remain read-only asset-price queries.

The shared TypeScript/RPGCode menu context exposes a read-only `shop.stock` list for the active `CallShop` invocation (empty outside a shop), with canonical item asset sources. Its named actions are `inventory.buyItem({ source, amount })`, `inventory.sellItem({ entryId, amount })`, and `party.inn()`, using the same language-appropriate calling syntax and `MenuStateResult` as E-81. The transaction owner is inventory for buy/sell and the party owner coordinating actor operations for Inn; no separate shop-owned gold or inventory is introduced.
The blocking `menu.screen` wait for `CallShop` persists the active stock in its existing plain-data payload as `[sources]`, where `sources` is the ordered list of canonical item asset sources. The engine reads this wait payload as the authoritative `shop.stock` context and reconstitutes it when restoring a parked waiter; this adds no `GameState` or save field. Closing the shop clears both the live context and the wait payload to `[]` before the wait resolves, so a snapshot taken after close cannot reopen the shop. The command owns the blocking session and stock resolution; menu owns screen presentation, which is separate UI scope.


**Owner/engineer compatibility ruling (trans3 runtime answer supplied for Epic 8.6; not inferred from repository extraction).** `callshop(item1, ...)` requires at least one parameter; 0 parameters raises a script error immediately and the shop fails to open entirely. Parameters resolve strictly as filenames relative to the Item asset directory (appending `.itm` if missing, case-insensitively); item handles are NOT resolved. If any listed item file is missing or invalid on disk, the engine raises a script error and the shop fails to open entirely (no partial opening, no skipping). `inn()` sets current HP to max HP and current SMP to max SMP for all active party members immediately; fallen party members (HP <= 0) are restored unconditionally (`revived`). `inn()` does not clear status effects, charges 0 GP, and is a pure headless stat restoration with no UI or audio. A price of 0 GP is permitted for buying and selling (0 GP added or deducted).

**TKR design choice (Epic 8.6).** Item definition prices are signed integers on disk, but TKR cleanly rejects negative prices with atomic refusal (`MenuStateResult` error). Buy and sell quantities are positive safe integers.

A buy requires `source` in the active `shop.stock`, an available item definition, and a positive safe-integer `amount`; it merges `amount` under the item's `(source, itemName)` stack and debits `buyPrice × amount`. A sell requires an existing stack and sufficient available (unequipped) quantity; it removes `amount` and credits `sellPrice × amount`. No key-item prohibition is added to selling: E-81's key-item rule covers only the stock-menu drop affordance, and item field 9 has no general engine rule. A buy with insufficient gold, unavailable/out-of-stock asset, negative price, unknown entry, insufficient quantity, exhausted stack ID, or unsafe resulting value refuses atomically without any mutation.

A committed buy emits exactly one `itemAdded`, followed by `goldChanged` if gold changed; a committed sell emits exactly one `itemRemoved`, followed by `goldChanged` if gold changed. Existing EMIT-13 detail shapes are unchanged; zero-price trade emits only its item event. Refusal emits nothing and leaves inventory/gold untouched. Inn is one atomic party-owner operation; it sets HP/SMP to maxima for every active party member including fallen members, without charging gold or changing status, equipment, roster, inventory or gold. It adds no shop/party/inventory event; actor-owner `revived` transitions occur when a member crosses HP <= 0 to positive. Refusal returns the existing `MenuStateResult` with a deterministic `path` and `message`; the RPGCode adapter preserves that location in the existing `menu.state-invalid` diagnostic.

## Graphics, canvases, animation & video (31)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `clear` | `void clear([canvas cnv])` | Clear a surface. clear() blanks the screen. |  |
| `setpixel` | `void setpixel(int x, int y, [canvas cnv])` | Set a pixel in the current colour. |  |
| `drawline` | `void drawline(int x1, int y1, int x2, int y2, [canvas cnv])` | Draw a line. |  |
| `drawrect` | `void drawrect(int x1, int y1, int x2, int y2, [canvas cnv])` | Draw a rectangle. |  |
| `fillrect` | `void fillrect(int x1, int y1, int x2, int y2, [canvas cnv])` | Draw a filled rectangle. |  |
| `bitmap` | `void bitmap(string file, [canvas cnv])` | Fill a surface with an image. |  |
| `bordercolor` | `void bordercolor(int r, int g, int b)` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `playavi` | `void playavi(string movie)` | Play a movie full screen. Supported types are *.avi, *.mpg, and *.mov. |  |
| `playavismall` | `playavismall(string movie)` | Play a movie at actual size, centred. |  |
| `setimage` | `void setimage(string str, int x, int y, int width, int height, [canvas cnv])` | Set an image. |  |
| `drawcircle` | `void drawcircle(int x, int y, int radius [, int canvas])` | Draw a circle at x,y, optionally to a canvas. Previously an arc could be defined but this never worked, so the two parameters have been cut and the optional canvas is... |  |
| `fillcircle` | `void fillcircle(int x, int y, int radius [, int canvas])` | Draw a filled circle at x, y, to screen or canvas. |  |
| `savescreen` | `void savescreen([int position = 0])` | Save the current screen onto a canvas that can be restored at a later time. |  |
| `restorescreen` | `void restorescreen([int x1, int y1, int x2, int y2, int xdest, int ydest])` | Draw a buffered screen capture to the screen. The canvas drawn is the first in the screen array. x1, x2 specify the bottom- right corner of the screen, so that width... |  |
| `getpixel` | `void getpixel(int x, int y, int &r, int &g, int &b, [canvas cnv])` | Get the colour of the pixel at (x, y). |  |
| `setimagetransparent` | `void setimagetransparent(string file, int x, int y, int width, int height, int r, int g, int b, [canvas cnv])` | Set an image with a transparent colour. |  |
| `setimagetranslucent` | `void setimagetranslucent(string file, int x, int y, int width, int height, [canvas cnv])` | Set an image translucently. |  |
| `setimageadditive` | `void setimageadditive(string file, int x, int y, int width, int height, double percent[, canvas cnv])` | Set an image with a tint of the specified percent. |  |
| `animation` | `int id = animation(string file, int x, int y [, bool loop])` | Play an animation at pixel x,y. If animation() is called in a thread, it may be looped using the last parameter and returns an id that can be used to end the animation. |  |
| `sizedanimation` | `int id = sizedAnimation(string file, int x, int y, int height, int width [, bool loop])` | Play a resized animation at pixel x,y. If sizedAnimation() is called  in a thread, it may be looped using the last parameter and returns an id that can be used to end... |  |
| `getres` | `void getres(int &x, int &y)` | Get the screen's resolution. |  |
| `createcanvas` | `canvas createcanvas(int width, int height, [canvas &cnv])` | Create a canvas. |  |
| `killcanvas` | `void killcanvas(canvas cnv)` | Kill a canvas. |  |
| `drawcanvas` | `void drawcanvas(canvas cnv, int x, int y, [int width, int height, [canvas dest]])` | Blit a canvas forward. |  |
| `restorescreenarray` | `void restorescreenarray(int pos [,int x1, int y1, int x2, int y2, int xdest, int ydest])` | Draw a buffered screen capture to the screen. |  |
| `restorearrayscreen` | `void restorearrayscreen(int pos [,int x1, int y1, int x2, int y2, int xdest, int ydest])` | Draw a buffered screen capture to the screen. | alias of `restorescreenarray` |
| `endanimation` | `endanimation(int animationID)` | End a multitasking animation. |  |
| `pinnedanimation` | `int id = pinnedanimation(string file, int x, int y [, bool loop])` | Play an animation as a fixed picture the engine keeps animating, drawn above the render-now canvas. | **Reawakened addition (entry 7.11; OWNER, Jensen, approved 2026-10-28).** Starts the named `.anm` or animated GIF exactly like `animation` (same lookup, same frame delay, same id and `endanimation`), with two differences, see [`pinnedanimation`](#reawakened-pinnedanimation): it is drawn **above** the render-now canvas instead of below it, and a one-shot one keeps showing its last frame until `endanimation`. |
| `showpinnedanimation` | `void showpinnedanimation(int id, bool show)` | Show or hide a pinned animation without restarting it. | **Reawakened addition (entry 7.11; OWNER, Jensen, approved 2026-10-28).** A hidden pinned animation is not drawn but keeps its clock, frame and hold: showing it again displays the frame its timeline has reached, and a one-shot that finished while hidden is still on its last frame. An unknown id, or an animation that is not pinned, is ignored. See [`pinnedanimation`](#reawakened-pinnedanimation). |
| `rendernow` | `void rendernow(bool draw)` | Controls rendering of the cnvRenderNow reserved canvas. The canvas is drawn every frame above all board elements (e.g. tiles, sprites, animations). | Reawakened lifecycle: `true` creates the reserved canvas when it does not exist and turns drawing on; `false` only turns drawing off and keeps the canvas and its pixels; see [E-57](main-loop-and-startup.md#e-57). |
| `rendernowenabled` | `bool rendernowenabled()` | Read whether the render-now overlay canvas is drawn. | Reawakened read-only addition; returns 1 while `rendernow(true)` is in effect and the canvas is live, otherwise 0. Changes nothing and does not wait. A screen that borrows the overlay reads it first so it can put the flag back; see [E-57](main-loop-and-startup.md#e-57). |
| `drawcanvastransparent` | `void drawcanvastransparent(canvas cnv, int x, int y, int r, int g, int b[, int width, int height[, canvas dest]])` | Blit a canvas forward, but don't blit one colour (the transparent colour). |  |
| `canvasdrawpart` | `void canvasdrawpart(int cnv, int x, int y, int xSrc, int ySrc, int width, int height[, canvas cnvDest])` | Draw part of a canvas. |  |
| `canvasgetscreen` | `void canvasgetscreen(canvas cnvDest)` | Copy the screen onto a canvas. |  |

<a id="e-56"></a>
**E-56 Text and primitives.** Text at tile-cell or pixel coordinates; lines, rectangles and circles, filled or outlined; pixel get and set; images drawn normally, colour-keyed, translucent (50 %) or additive (per cent). All of them work on the screen or on an **off-screen canvas**, and a canvas can be created, drawn whole or in part, colour-keyed and captured from the screen.

<a id="reawakened-text-cell-size"></a>
**Reawakened rule (OWNER; adopts the owner-relayed round-7 legacy facts).** An author can place text with `text(x,y,...)` on a grid of square cells, or use `pixeltext` for exact pixels. In plain terms, each cell is as wide and as tall as the current font size, and the first cell is (1,1), not (0,0). Technically, with `s` the current font size in logical pixels (`getfontsize()`), `text` truncates each coordinate toward zero and maps `(x,y)` to the logical-pixel origin `((x − 1) × s, (y − 1) × s)`; the cell changes when the font size changes. A coordinate below 1 therefore starts left of or above the surface and clips. A newline advances the next line by one cell row, `s` pixels (the newline behaviour was relayed with MEDIUM confidence and its content was not given, so the earlier one-row rule is kept, now one cell row), and text outside the surface clips to it. `pixeltext` keeps pixel coordinates. Both use the current `FontRef` metrics for glyph layout. Fractional and negative coordinates beyond the truncation above, clipping and the difference from `pixeltext` were not covered by the answer and keep the earlier unverified defaults. The earlier fixed 8×16 cell with `(x*8, y*16)` and 0-based coordinates is withdrawn; the evidence is the owner-relayed round-7 answer to Q5.

<a id="e-58"></a>
**E-58 Screen save and restore.** Save the screen to numbered slots and restore it, whole or as partial rectangles.

## Mouse, buttons & cursor maps (11)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `setbutton` | `setbutton(string file, int slot, int x, int y, int width, int height)` | Create a clickable button. The slot is replaced at fixed pixel coordinates until clearButtons removes it. |  |
| `checkbutton` | `int = checkbutton(int x, int y)` | Check whether a button covers a pixel. It returns 1 for an enabled slot and 0 otherwise without waiting. |  |
| `clearbuttons` | `clearbuttons([int slot1, int slot2...])` | Remove selected button slots, or all slots when no slot is supplied. |  |
| `mouseclick` | `mouseclick(int &x, int &y [, bool noWait])` | Wait for a click or read the current pointer position. Blocking mode resumes from the input event; noWait writes pixel x/y immediately. |  |
| `mousemove` | `mousemove(int &x, int &y)` | Read the pointer position. The current window-relative pixel x/y are written by reference without waiting. |  |
| `createcursormap` | `cursor_map createcursormap([cursor_map &ret])` | Create a cursor map. |  |
| `killcursormap` | `void killcursormap(cursor_map map)` | Kill a cursor map. |  |
| `cursormapadd` | `void cursormapadd(int x, int y, cursor_map map)` | Add a point to a cursor map. |  |
| `cursormaprun` | `int cursormaprun(cursor_map map, [int &ret])` | Run a cursor map. |  |
| `cursormaphand` | `void cursormaphand(string cursor[, bool stretch = true])` | Change the cursor used everywhere cursors are used (e.g. cursor maps, the menu, the battle system), optionally not stretching it to 32 by 32 pixels. | The default hand is a bundled 32×32 asset with no hot spot, drawn at an offset of (−40, −10) from the cursor-map point; `stretch=true` scales a supplied image to 32×32 with nearest-neighbour sampling. |
| `mousecursor` | `void mousecursor(string file, int x, int y, int red, int green. int blue)` | Change the mouse cursor. "TK DEFAULT" or "" restores the default cursor. | `TK DEFAULT` and empty file restore the bundled 32×32 arrow with hot spot (0,0); custom assets retain the supplied hot spot and transparent colour. |

<a id="e-60"></a>
**E-60 Modal UI primitives.** A message box with OK or Yes/No buttons (keyboard or mouse), a text prompt, **cursor maps** (a list of hotspots navigated with the arrow keys or the mouse, returning the chosen index, with a custom cursor image), on-screen clickable **buttons** (slots with images), and a save-file picker (`DirSav`).
<a id="reawakened-msgbox-layout"></a>
**Reawakened rule (OWNER; adopts the owner-relayed round-7 legacy facts; the unanswered parts are unverified defaults).** An author can ask a player a question with `msgbox(text,title,style,...)`. In plain terms, the box is as large as its text needs, and the title is just part of the text. Technically, the panel is sized from the wrapped text and centred on the logical surface. The title is merged into the body: no separate title row is drawn, and the Reawakened choice is that the title is the first line of the body, followed by the text. The wrap rule was not covered by the answer, so the earlier bounds are kept: the body wraps at word boundaries using the current `FontRef` metrics within at most 60% of the logical width less the 8-pixel inner margin on each side. The panel width is the widest wrapped line or the button row, whichever is wider, plus the margins, and its height is the wrapped text height plus the 28-pixel button row and the margins, clamped to the surface. Buttons are 80 × 28 pixels with 8-pixel gaps. Style 0 displays one centred button reading `OK`; style 1 displays `Yes` then `No` left to right. The first button is selected, and the command yields `render.msgbox` until the cursor-map key selects a button. The return codes are 1 for OK, 6 for Yes and 7 for No. Explicit colours or a bitmap replace only their defaults. Invalid style values raise `builtin.bad-arg`. The earlier layout (60% × 22% panel, separate title row, 16-pixel `OK`/`YES`/`NO` buttons, returned button index) is withdrawn; the evidence is the owner-relayed round-7 answer to Q4.

<a id="reawakened-default-cursors"></a>
**Reawakened rule (OWNER; adopts the owner-relayed round-7 legacy facts; the unanswered parts are unverified defaults).** An author can restore a deterministic cursor with `mousecursor("TK DEFAULT",...)` or an empty file, rather than using a host cursor. The bundled arrow and the bundled cursor-map hand are both 32×32 with a transparent background. The arrow's hot spot stays (0,0) because the answer does not cover it. The hand has no hot spot: it is drawn with its top-left corner at `(mapX − 40, mapY − 10)`, where `(mapX, mapY)` is the cursor-map point; this offset is applied to every hand image drawn at a cursor-map point, bundled or supplied (an assumption). `cursormaphand(...,true)` scales a supplied hand image to 32×32 with nearest-neighbour sampling and `false` keeps its own size; for the bundled 32×32 hand the stretch changes nothing (the stretch option was not covered by the answer). Asset keys, dimensions and hot spots are part of UI state. The earlier 16×16 assets and the hand's hot spot (1,1) are withdrawn; the evidence is the owner-relayed round-7 answer to Q7.

## Audio (23)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `sound` | `void sound()` | Obsolete. | obsolete: raises an error and the statement is skipped |
| `wav` | `void wav(string file)` | Play a wave file (e.g. a sound effect). | deprecated; replaced by `mediaplay` |
| `midiplay` | `void midiplay(string file)` | Play a media file on a named track. | deprecated; replaced by `mediaplay`; music loops |
| `playmidi` | `void playmidi(string file)` | Play a media file on a named track. | deprecated; replaced by `mediaplay`; music loops |
| `mediaplay` | `object mediaplay(string file[, object options])` | Play a media file on a named track. | Reawakened addition (MEDIA-1): returns the voice object; `options` may set `track`, `loop`, `volume`, `priority`, `sync` and `wait`; the one-argument Toolkit 3.1 call uses `music`/loop defaults and returns the voice object, which existing bare statements ignore. |
| `mediastop` | `void mediastop([string track[, int voice]])` | Stop a track or voice. |  |
| `mediarest` | `void mediarest([string track[, int voice]])` | Stop a track or voice. | deprecated; replaced by `mediastop` |
| `midirest` | `void midirest([string track[, int voice]])` | Stop a track or voice. | deprecated; replaced by `mediastop` |
| `wavstop` | `void wavstop()` | Stop the current sound effect. | deprecated; replaced by `mediastop` |
| `mp3` | `void mp3(string file)` | Play a wave file (e.g. a sound effect). | deprecated; replaced by `mediaplay`; sound effects play once |
| `mp3pause` | `void mp3pause(string file)` | Play a sound effect and pause the engine until it finishes. | deprecated; replaced by `mediaplay`; plays once, then waits on `audio.track` |
| `setvolume` | `void setvolume(int percent)` | Set the volume of all music and sound using a value between 0 and 100. | master volume |

<a id="e-102"></a>
**E-102 Volume.** A master volume as a percentage, applied to all music and sound.

## Files, saves & OS (15)

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `start` | `void start(string file)` | Obsolete. | Obsolete: raises a catchable error and skips the statement because shell-open is unavailable in Reawakened. |
| `dirsav` | `string dirsav(string title, bool allowNewFile, int textColor, int backColor, string image)` | Allow the user to choose a *.sav file from the "Saved" directory. For historical reasons, returns "CANCEL" if no file is chosen, not "". |  |
| `save` | `void save(string file)` | Save the current game state to a file. |  |
| `load` | `void load(string file)` | Load the game state from a file. |  |
| `openfileinput` | `void openfileinput(string file, string folder)` | Open a file in input mode. |  |
| `openfileoutput` | `void openfileoutput(string file, string folder)` | Open a file in output mode. |  |
| `openfileappend` | `void openfileappend(string file, string folder)` | Open a file for appending. |  |
| `openfilebinary` | `void openfilebinary(string file, string folder)` | Obsolete. | obsolete: shows a message, then acts as `openfileinput` |
| `closefile` | `void closefile(string file)` | Close a file. |  |
| `fileinput` | `string fileinput(string file, [string &ret])` | Read a line from a line. |  |
| `fileprint` | `void fileprint(string file, string line)` | Write a line to a file. |  |
| `fileget` | `string fileget(string file, [string &ret])` | Get a byte from a file. |  |
| `fileput` | `void fileput(string file, string byte)` | Write a byte to a file. |  |
| `fileeof` | `bool fileeof(string file, [bool &ret])` | Check whether the end of a file has been reached. |  |
| `apppath` | `string apppath([string &dest])` | Retrieve the path of trans3.exe, without the final backslash. |  |

<a id="e-97"></a>
**E-97 File I/O.** Scripts can open text or binary files *inside the game's folders* (input, output, append, binary) to read and write lines or bytes ([../formats/rpgcode-program.md](../formats/rpgcode-program.md#other-script-created-files)).

**Reawakened rule.** Script file I/O is **sandboxed to the game's save area**: a script's file commands can only reach files under the game's own folders, never an arbitrary host path.

<a id="actions-and-bindings"></a>
## Actions and bindings (Reawakened only)

None of these names is one of the 282 catalogue names: Toolkit 3.1 had no actions, so there is nothing to alias, and a legacy script that happens to define a function with one of these names is unaffected (FUN-8). They are ordinary built-ins of the movement-and-input part, and the `input.action` wait kind they yield is the **VM's**, registered in the same wait registry as `input.key` (`wait.duplicate-kind`, `wait.unknown-kind`).

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `registerAction` | `void registerAction(string name, object definition)` | Define a game action: its label, icon, group, default controls, and whether it is locked or hidden. | `name` must start with `game.` ([ACT-2](display-input-audio.md#act-2)); `definition` is plain data with exactly the `RegisteredAction` fields. Never waits and never runs game logic. After startup, a repeated registration updates label, icon and group but cannot change `locked`; changing it is a `builtin.bad-arg` refusal. |
| `actionDown` | `bool actionDown(string name)` | Is the action held right now? | Never waits and never claims; an unknown name returns `false` and reports `input.unknown-action` once. |
| `actionPressed` | `bool actionPressed(string name)` | Has the action been pressed since this call last claimed it? | Claims through the shared input-sequence protocol, exactly as `get` does, so a press is delivered once. Never waits. |
| `actionWait` | `string actionWait(string name)` | Wait for the action to be pressed, then return its name. | Parks the thread on `input.action`; the thread resumes on the next unclaimed press at or after the park sequence, and the wait's claim is pruned like any other. |
| `actionControls` | `string actionControls(string name)` | The action's bound control ids. | Comma-separated in binding order, `""` when unbound. Read-only. |
| `rebindAction` | `bool rebindAction(string name, string controls)` | Add controls to an action as player overrides. | The comma-separated controls are **added** to the action's effective list and no game default is removed, so a script that reads the original key keeps receiving it ([ACT-6](display-input-audio.md#act-6) rule 3). Returns `false` and changes nothing for a locked action, an invalid control id, or a duplicate within the engine set. Writes the player override layer, so the change is saved. |
| `unbindAction` | `bool unbindAction(string name, string control)` | Remove one control from an action. | The only way a game-default control stops producing its action: the removal is recorded in the override layer's `removed` list. Returns `false` and changes nothing for a locked action or a control that is not bound. Saved. |
| `resetBindings` | `void resetBindings()` | Discard every player override and return to the game's defaults. | Never waits; locked actions are unaffected because they were never overridable. |

The legacy key surface is unchanged and is not a wrapper over these: `wait`, `get`, `clearBuffer`, `scan`, `mem`, the button commands and the plugin `checkKey` path keep their 3.1 names, return values and quirks ([E-110](display-input-audio.md#e-110)). A script may mix both in one program; both read the same incoming events.

## Ownership of names with no single owner

The catalogue above groups names by capability, not by which part of the engine implements them, and a few names fell between two owners. This is the map the build uses so that every name resolves exactly once. It follows the command-effect catalogue's proposal; where it differs from a group label above, this map wins.

* **Input** (`wait`, `get`, `mouseClick`, `mouseMove`, `scan`, `mem`, `clearBuffer`, `setButton`, `checkButton`, `clearButtons`, and the Reawakened-only [action commands](#actions-and-bindings)) belongs to the **movement-and-input** part. The `input.key`, `input.action` and `sleep` wait *kinds* those commands yield are the **VM's** (the VM owns the wait registry); the built-in itself is the input part's.
* **Cursor maps and the mouse cursor** (`createCursorMap`, `cursorMapAdd`, `cursorMapRun`, `killCursorMap`, `cursorMapHand`, `mouseCursor`) belong to **board-rendering**, even though the catalogue above files them under mouse, buttons and cursor maps: they draw onto the `ui` surface, so the section owner decides.
* **`wait`** is the input part's built-in and its `input.key` wait kind is the VM's — a split name, both parts stated.
* **`dirSav`** (the save/load picker) belongs to **menu-and-save**, which owns the save list and the `menu.screen` wait; board-rendering supplies the surface it draws on — a split name.
* **Game lifecycle** (`reset`, `mainFile`, `win`, `gone`, `over`, `quitGame`, `boot` and `quit`) belongs to **board-rendering**, which owns boot, reset and quit. The "Game state" group above does not imply the menu part. <!-- OWNER: §9.13 game lifecycle — alternatives: leave these with menu-and-save (where the catalogue guessed) or move them to board-rendering (the proposal). Decided: board-rendering, to match the boot/reset/quit owner. -->
* **Lifecycle aliases and obsolete names.** `dos()` and `windows()` are live aliases of `quitGame()` and emit one AD-17 `quit` request. `start(file)` and `godos(command)` are obsolete errors: shell-open and arbitrary shell commands are unavailable. `done()`, `end()` and `stop()` remain VM program-flow controls.
* **`menuGraphic`** belongs to **menu-and-save**, not battle, even though the catalogue above lists `menuGraphic` under battle; `internalMenu` and `fightMenuGraphic` stay with menu-and-save and battle respectively.
* The remaining names the catalogue's ownership table flags as ambiguous (`itemCount`, `giveExp`, `sourceHandle`, `targetHandle`, `sourceLocation`, `targetLocation`, and the party/player movement names) are owned as that table says: movement-and-input for the sprite and player movement names, battle for the fight stat writes, the VM for the source/target handle reads.

<!-- OWNER: §9.13 — the owner should confirm the game-lifecycle move (to board-rendering) and the two split names (`wait`,
`dirSav`) hardest; the rest follows the catalogue. If the game-lifecycle names stay with menu-and-save, edit this bullet
and the catalogue together. -->

## Not callable by name

The interpreter also has internal entries for operators, `if`/`else`/`elseif`/`while`/`until`/`for`, method and class definitions, and plugin calls. Scripts reach them only through the language syntax.

<a id="reawakened-additions"></a>
## Reawakened additions (not part of the 282 legacy catalogue)

The following functions are Reawakened built-in additions, not part of the 282 legacy 3.1 command catalogue. The existing additions are provided in the pure built-in pack (`pure.ts`); the `executeProgram` and `replaceProgram` rows record owner-approved specifications, not landed implementations.

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `quitGame` | `void quitGame()` | Quit the game. | Reawakened addition; board-rendering posts one AD-17 `quit` request without choosing host window behaviour and the call does not wait. `dos()` and `windows()` are legacy aliases. |
| `isNaN` | `int isNaN(variant &value, [int &ret])` | Returns 1 if `value` is numeric and NaN, 0 otherwise. | Reawakened addition; takes first arg byRef |
| `isInfinity` | `int isInfinity(variant &value, [int &ret])` | Returns 1 if `value` is numeric and +Infinity or -Infinity, 0 otherwise. | Reawakened addition; takes first arg byRef |
| `isFinite` | `int isFinite(variant &value, [int &ret])` | Returns 1 if `value` is numeric and a finite number (not NaN, not ±Infinity), 0 otherwise. | Reawakened addition; takes first arg byRef |
| `bindThis` | `callable bindThis(callable fn, object obj)` | Return a new callable whose `this` receiver is `obj`, without mutating `fn`. | Reawakened addition; `fn` must be callable and `obj` must be a live object handle; see [OOP-11](rpgcode-modules-and-objects.md#oop-11). |
| `registerPlugin` | `object registerPlugin(object definition)` | Register command layers and/or replaceable menu-screen providers. | Reawakened addition; `definition` has a `name`, required `commands` dictionary (which may be empty), and optional `menuProviders` dictionary keyed by `main`, `items`, `equipment`, or `abilities`; empty dictionaries contribute no entries. If `stock_menu` is loaded, unspecified screen keys retain its default provider; without a custom or loaded stock provider, a direct facade call raises catchable `menu.provider-missing` without changing the menu stack. Menu-only RPGCode registrations use `commands: {}`. See [E-80](plugins-and-battle.md#e-80) and [MOD-4](rpgcode-modules-and-objects.md#pure-rpgcode-plugins-and-middleware-mod-4--reawakened-rule). The value is `{ name, remove }`; registration does not wait. |
| `on` | `void on(object emitter, string type, callable fn)` | Add a listener for an event type to an object. | Reawakened addition; the free-function form of `emitter.on(type, fn)`; see [EMIT-2](rpgcode-modules-and-objects.md#emit-1) and [EMIT-14](rpgcode-modules-and-objects.md#emit-14). |
| `once` | `void once(object emitter, string type, callable fn)` | Add a listener for an event type to an object that runs at most one time. | Reawakened addition; the free-function form of `emitter.once(type, fn)`; see [EMIT-4](rpgcode-modules-and-objects.md#emit-1) and [EMIT-14](rpgcode-modules-and-objects.md#emit-14). |
| `off` | `void off(object emitter, string type, [callable fn])` | Remove one listener, or every listener, of an event type from an object. | Reawakened addition; the free-function form of `emitter.off(type, fn)`; see [EMIT-4](rpgcode-modules-and-objects.md#emit-1) and [EMIT-14](rpgcode-modules-and-objects.md#emit-14). |
| `emit` | `void emit(object emitter, string type, [object detail])` | Queue an event on an object and carry on; its listeners run later. | Reawakened addition; the free-function form of `emitter.emit(type, detail)`; see [EMIT-3](rpgcode-modules-and-objects.md#emit-1) and [EMIT-14](rpgcode-modules-and-objects.md#emit-14). |
| `emitCancelable` | `object emitCancelable(object emitter, string type, [object detail])` | Send an event and wait until every listener has run; the value is the event, which a listener may have changed or cancelled. | Reawakened addition; the free-function form of `emitter.emitCancelable(type, detail)`; waits (only this thread) on `event.dispatch`; see [EMIT-5](rpgcode-modules-and-objects.md#emit-1) and [EMIT-16](rpgcode-modules-and-objects.md#emit-16). |
| `cancelEvent` | `void cancelEvent(object event)` | Cancel the cancelable event a listener is handling. | Reawakened addition; the free-function form of `event.cancel()`; does not wait and does not stop later listeners; see [EMIT-17](rpgcode-modules-and-objects.md#emit-17). |
| `getstatus` | `string getstatus(variant fighter, int index)` | Read one of a fighter's active status file names. | Reawakened read-only addition; index is zero-based in canonical filename order (the same order before and after a snapshot), and `""` means past the end. A present zero-round counter is included. Requires a valid actor handle and non-negative safe-integer index; does not change counters or read status effects. |
| `statusdata` | `object statusdata(string file)` | Read a status file's battle-round data. | Reads round settings from `.ste` without applying them. |
| `statusflags` | `object statusflags(string file)` | Read a status file's speed, slow and disable flags. | Reawakened read-only addition; waits for a `StatusE/<file>.ste` asset reply (prefix and extension may be omitted), then returns `{ speed, slow, disable }`, each numeric 1 for a nonzero file flag or 0 otherwise. Missing files, malformed replies and invalid files produce the ordinary located diagnostic; no actor state, rate, duration or effect is changed. |
| `statussignature` | `string statussignature(variant fighter)` | Read a fighter's status signature. | Reawakened read-only addition; returns an opaque exact canonical JSON text token for the current status names and round counters, including zero-round entries. Requires a valid actor handle; synchronous, loads no StatusE files, changes no actor state, and is safe to save and compare after restore regardless of insertion order. |
| `executeProgram` | `int executeProgram(string file, [object context])` | Run `Prg/<file>` as a nested call and return 0 when it finishes. | **OWNER; Jensen, 2026-10-25; specification only.** `context` (default `{}`) is bound in fresh root locals and globals are shared. `context.source` / `context.target`, or positional `(file, source, target)`, bridge to the calling thread's slots, inheriting omitted slots and restoring both on return. Same thread and budget; see [`executeProgram`](#reawakened-executeprogram). |
| `replaceProgram` | `void replaceProgram(string file, [object context])` | End the calling program's frame chain and start `Prg/<file>` on the same thread without returning. | **OWNER; Jensen, 2026-10-25; specification only.** Uses the same object-valued `context` payload and handle bridge as `executeProgram`, but not its positional convenience; discarded callers and restoration records never resume. Fresh locals, shared globals, unchanged thread budget. Legacy `run(file[, context])` remains an alias for Toolkit 3.1 games; see [`replaceProgram`](#reawakened-replaceprogram). |
| `battlemovedata` | `object battlemovedata(string file)` | Read a special move file's battle numbers, references and description. | Reawakened read-only addition; waits for a `SpcMove/<file>.spc` asset reply (prefix and extension may be omitted), then returns `{ fp, smp, targetsmp, animation, program, statuseffect, battle, menu, description }`: damage, cost to the user, SMP drained from the target, three file names (possibly empty), the two stored usability bytes passed through unchanged (stored 0 = usable, non-zero = not usable; the script compares), and the move's description text, so a menu can show it without a second request. `description` is the text stored in the file exactly as read, with no trimming or translation; it is the empty string when the file stores none. Member names match ignoring case. Changes no state and decides no rules; a failed request raises the ordinary located diagnostic and the call result is null. |
| `battleitemdata` | `object battleitemdata(string file)` | Read an item file's battle-use numbers, references and description. | Reawakened read-only addition; waits for an `Item/<file>.itm` asset reply (prefix and extension may be omitted), then returns `{ hp, smp, animation, program, usable, description }` from the item's battle-use fields plus its description text, so a menu can show it without a second request; `usable` is the stored fight byte (1 = usable in a fight, 0 = not), and `description` is the text stored in the file exactly as read, with no trimming or translation, the empty string when the file stores none. Does not itself refuse an item that is not battle-usable, does not check that it is owned, and changes no state; a menu that lists only usable items compares `usable`. A failed request raises the ordinary located diagnostic and the call result is null. |
| `battleenemydata` | `object battleenemydata(variant fighter)` | Read an enemy's battle settings. | Reawakened read-only addition; reads the `.ene` file named by an active enemy's source and returns `{ specialmoves, specialcount, ailevel, customai, aiprogram }`. `specialmoves` is a dictionary indexed from 0 through `specialcount - 1`; stored move names and custom-AI flag values pass through unchanged. It chooses no action and checks no move costs. Changes no state; a failed request or invalid file raises the ordinary located diagnostic and the call result is null. |
| `battlecharacterdata` | `object battlecharacterdata(variant fighter)` | Read a character's level-up program and special-move list. | Reawakened read-only addition; for a party fighter (a fallen one still in the battle is accepted), waits for its `.cha` asset and returns `{ levelupprogram, specialname, hasspecial, specialcount, specialmoves }`. `specialname` is the character's menu label for its special moves (for example "Magic"), `hasspecial` is 1 when the character has special moves and 0 when its file says it has none, and `specialmoves` is a dictionary indexed from 0 through `specialcount - 1` of the non-empty slots in slot order, each `{ file, minexp, minlevel, available }`. `available` is 1 when at least one learn condition holds now ([progression-and-levels.md](progression-and-levels.md#special-moves): experience at least `minexp`, level at least `minlevel`, or the slot's condition variable equals its required value) and 0 otherwise; it does not read the move's own battle byte, cost or file. Changes no state. |
| `battleinventory` | `object battleinventory()` | List the available inventory stacks a battle menu can offer. | Reawakened read-only addition; returns `{ count, items }` where `items` is a dictionary indexed from 0 through `count - 1` of the stacks with at least one available unit, in inventory order, each `{ source, handle, quantity }`. It reads the same stacks as `itemcount`, loads no item file, says nothing about battle use (read `battleitemdata(source).usable`) and changes no inventory, quantity or stat. Requires an active battle. |
| `battlescreensize` | `object battlescreensize()` | Read the size of the screen a battle screen would draw on. | Reawakened read-only addition; returns `{ width, height }`, the logical-pixel size of the screen surface, or null when the host has no screen surface (a headless run). Changes nothing and does not wait. A battle package draws its screen only when this is not null, so a headless run needs no drawing commands at all. |
| `battlebackgrounddata` | `object battlebackgrounddata()` | Read the active battle's background settings. | Reawakened read-only addition; reads its `.bkg` asset and returns `{ image, music, selectsound, choosesound, readysound, cantsound }`, preserving stored file names. Returns null when there is no background; requires an active battle. |
| `fighteranimationfile` | `string fighteranimationfile(variant fighter, string stance)` | Look up the animation file a fighter's source asset names for a battle stance. | Reawakened read-only addition; waits for the fighter's source asset (`.cha` for non-enemies, `.ene` for enemies). `stance` is `fight`/`attack`, `defend`, `special move`, `die` or `rest`, matched ignoring case, spaces and punctuation (character slots 0 FIGHT, 1 DEFEND, 2 SPECIAL MOVE, 3 DIE, 4 REST; enemy slots 0 REST, 1 FIGHT, 2 DEFEND, 3 SPECIAL MOVE, 4 DIE). Returns `""` when the asset stores none or the source is empty. Reads a file name only: plays nothing, assumes no position, changes no state. |
| `battleconsume` | `void battleconsume(string item, variant target, int hp, int smp, [string handle])` | Ask the inventory to consume one battle item. | Reawakened addition; posts exactly one `inventory` section effect carrying `{ kind: "inventory.consume", item, target, hp, smp, handle }` (`target` is the numeric actor id; `handle` is the optional stack handle). `handle` names no stack when it is omitted, `null`, `0` (an RPGCode `null` and an unset parameter are both 0) or the empty string; the effect then carries `handle: null`. The battle script has already applied HP/SMP, so the inventory owner does not apply those values again. With a `handle` the owner removes one available unit from exactly the `(item, handle)` stack and refuses when that stack is missing or empty; without one it resolves the item source/definition name to a stable inventory entry and removes one available unit through `inventory.removeItem`, and ambiguous source-only matches refuse rather than consuming an arbitrary stack ([plugins-and-battle.md](plugins-and-battle.md#e-81)). Raises `builtin.bad-arg` for an empty item, any other non-string `handle`, or non-safe-integer amounts. |
| `battleunaffordable` | `void battleunaffordable()` | Stop the current action because it cannot be paid for. | Reawakened addition; always raises the catchable `battle.unaffordable` error, because RPGCode has no command to raise one. The calling script does its own cost comparison first; this command decides nothing. |
| `a11yLabel` | `void a11yLabel(string text [, variant target])` | Name a drawn image, canvas, button slot or surface for the accessibility tree. | Reawakened addition; `target` is `"slot:<n>"`, `"canvas"`, `"surface"` or omitted, which labels the next draw call in this thread. Never waits; a label on a slot or surface replaces one the projector derived ([A11Y-14](accessibility.md#a11y-14)). |
| `a11yRole` | `void a11yRole(string role [, string label])` | Give the current script surface a tree node with an explicit role and label. | Reawakened addition; `role` is one of the [A11Y-11](accessibility.md#a11y-11) roles or `"hidden"`, which suppresses the surface's node without suppressing its pixels. Never waits. |
| `a11yAnnounce` | `void a11yAnnounce(string text [, bool assertive])` | Queue an announcement for the screen reader. | Reawakened addition; `polite` unless the second argument is true, which makes it `assertive`. Never waits and is heard once, not per frame. |
| `a11yPref` | `string a11yPref(string name)` | Read a player accessibility preference. | Reawakened addition; `name` is `reduceMotion`, `largeCursor`, `focusScale` or `contrast`; returns `"on"`, `"off"` or `"unknown"`. Never waits and changes nothing. |
| `contrastRatio` | `double contrastRatio(string colourA, string colourB)` | WCAG contrast ratio between two `#RRGGBB` colours. | Reawakened addition; computed with `core/fmath` under ADR 0002, from 1 to 21, so a script can check its own text. Never waits. |
| `uiBegin` | `int uiBegin(string id, string role, int x, int y, int w, int h)` | Declare a script-drawn surface so the engine navigates and describes it. | Reawakened addition; `role` is a [A11Y-11](accessibility.md#a11y-11) role, bounds are logical pixels, and the surface is open until `uiEnd()` in the same thread. Returns 1 when the surface opened and 0 when it was refused ([A11Y-15](accessibility.md#a11y-15) rule 6). Draws nothing. Only one surface per thread is open at a time. |
| `uiItem` | `void uiItem(string label [, object options])` | Append one item to the open surface. | Reawakened addition; `options` accepts `id`, `value`, `enabled`, `role` and `bounds`. Items appear in call order, which is both the tree order and the navigation order. Requires an open surface; appends nothing and reports `a11y.surface` otherwise. |
| `uiEnd` | `void uiEnd()` | Close the open surface and publish it for this frame. | Reawakened addition; the engine then applies the cursor, the pointer and the accessibility tree to it. Never waits. A surface not closed in the frame it was opened is dropped at frame end. |
| `uiSelection` | `int uiSelection([int &ret])` | Read the focused item index of the open surface. | Reawakened addition; 0-based, or −1 when no item can be focused. Returns the value and writes it through the optional reference. Never waits. |
| `uiFocus` | `void uiFocus(int index)` | Move the cursor to an item of the open surface. | Reawakened addition; out-of-range and disabled items are refused without moving the cursor. The pointer and the navigation actions write the same value, so all three devices agree. Never waits. |
| `uiActivated` | `int uiActivated([int &ret])` | Did the focused item get confirmed on this frame? | Reawakened addition; returns the 0-based index of the confirmed item on the one frame it happened and `-1` otherwise (so item 0 is distinguishable from "not activated"; test `>= 0`, not truthiness), writes the same value through the optional reference, and claims the press through the shared input-sequence protocol, so a loop cannot act twice on one press. Never waits. |
| `uiCancelled` | `int uiCancelled()` | Did `cancel` arrive on this frame for the open surface? | Reawakened addition; returns 1 on the one frame it happened and 0 otherwise, and claims the press like `uiActivated`. The script closes the surface itself; the engine does not close it for the script. |
| `integermuldiv` | `int integermuldiv(int a, int b, int divisor)` | Multiply two whole numbers and divide by a third, exactly. | Reawakened read-only addition; computes `BigInt(a) * BigInt(b) / BigInt(divisor)` exactly (no 32-bit wrap-around) and truncates toward zero. Raises `builtin.bad-arg` for a non-safe-integer argument, a zero divisor or a result that is not a safe integer. Because a plain named variable narrows to 32 bits (SEM-3), pass wide values through dictionary members or expressions. |

* **Parameter by reference.** Each function declares its first parameter `byRef: true` (`&value`). This is necessary because reading a variable by name in RPGCode truncates numbers to 32-bit integers (SEM-3), which would convert NaN or Infinity to 0 before the function sees it. Passing by reference ensures the function inspects the stored full value directly. Computed temporaries (for example `isNaN(0/0)` or `isInfinity(1/0)`) pass their temporary value and work identically.
* **String handling.** Strings (both non-numeric strings like `"abc"` and numeric strings like `"123"`) return 0 for all three functions, because a string is not a number.
* **Numeric invariant.** For any numeric input, exactly one of `isNaN`, `isInfinity` and `isFinite` returns 1, and the other two return 0 (`isFinite == 1` iff `isNaN == 0 && isInfinity == 0`).
* **Corpus check (R-35).** None of these functions existed in 3.1. Verified that no legacy corpus or fixture script defines `isNaN`, `isInfinity` or `isFinite`.
* **Emitter commands (entries 19.10 and 19.11; corpus check, R-35).** `on`, `once`, `off`, `emit`, `emitCancelable` and `cancelEvent` are the free-function aliases of the methods every object has ([EMIT-14](rpgcode-modules-and-objects.md#emit-14), [EMIT-16](rpgcode-modules-and-objects.md#emit-16), [EMIT-17](rpgcode-modules-and-objects.md#emit-17)); the rows above describe the call, the method form is the normative one ([EMIT-2](rpgcode-modules-and-objects.md#emit-1)). None of them existed in 3.1. Verified that no script of the fetched legacy corpus (`fixtures/legacy`, every game) calls or defines a function named `on`, `off`, `once`, `emit`, `emitCancelable` or `cancelEvent`, so no legacy program meets the new names. A script that defines its own function of one of these names gets the load-time `command.shadowed` notice and its calls bind to the built-in (R-35).

## Tooling: the RPGCode spec package (not part of the 282 legacy catalogue)

The commands of the test package `script-spec`, ruled by [rpgcode-tooling.md#tool-5](rpgcode-tooling.md#tool-5) and [ADR 0014](../../adr/0014-rpgcode-spec-package.md). The package is loaded only by the test runner and is never part of a game's manifest; `specResult` is the one native command and every other name is defined by the package's library program in RPGCode. The matcher methods are called on the object `expect` returns and are documented here so an author finds them in one place.

| Command | Signature | Purpose | Notes |
|---|---|---|---|
| `specResult` | `void specResult(string kind, string name, string expected, string actual)` | Record one spec outcome with the source position of this call. | Native. `kind` is `pass`, `fail`, `skip` or `only`; the runner reports it with the file and line of the call. |
| `describe` | `void describe(string name, function body)` | Group cases; groups nest. | Package-defined. |
| `it` | `void it(string name, function body)` | Run one case by calling `body`. | Package-defined; the body is a callable ([FUN-8](rpgcode-language.md#keywords-and-structure)). |
| `test` | `void test(string name, function body)` | The other spelling of `it`. | Package-defined. |
| `beforeEach` | `void beforeEach(function body)` | Run before each case of the enclosing `describe`. | Package-defined. |
| `afterEach` | `void afterEach(function body)` | Run after each case of the enclosing `describe`. | Package-defined. |
| `beforeAll` | `void beforeAll(function body)` | Run once before the enclosing `describe`'s cases. | Package-defined. |
| `afterAll` | `void afterAll(function body)` | Run once after the enclosing `describe`'s cases. | Package-defined. |
| `expect` | `object expect(value)` | Return a matcher object over `value`. | Package-defined; `.not` negates every matcher below. |
| `toBe` | `void toBe(value expected)` | Assert strict equality. | Package-defined matcher method. |
| `toEqual` | `void toEqual(value expected)` | Assert value equality: numbers, strings, arrays element-wise. | Package-defined matcher method. |
| `toBeTruthy` | `void toBeTruthy()` | Assert the engine's truth test ([R-39](rpgcode-language.md#compatibility-notes)). | Package-defined matcher method. |
| `toBeNull` | `void toBeNull()` | Assert the unset value. | Package-defined matcher method. |
| `toContain` | `void toContain(value needle)` | Assert a string or array contains `needle`. | Package-defined matcher method. |
| `toBeCloseTo` | `void toBeCloseTo(double expected, [double tolerance])` | Assert numeric closeness. | Package-defined matcher method. |
| `toThrow` | `void toThrow([function body])` | Assert a callable raises a runtime error. | Package-defined matcher method. |
| `skip` | `void skip(string name, function body)` | Leave a case out. | Package-defined; a skip fails the strict run. |
| `only` | `void only(string name, function body)` | Run only the marked cases. | Package-defined; warns that it narrowed the run. |
