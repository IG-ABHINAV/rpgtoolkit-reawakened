/**
 * Module commands at run time: `include`, `redirect`, `killRedirect` and
 * `killAllRedirects` (docs/spec/engine/rpgcode-modules-and-objects.md#includes
 * MOD-3, #redirects R-42..R-44).
 *
 * The parser applies a literal redirect to the text parsed after it, in textual
 * order (the compiled call sites carry the substituted names). Running the
 * command keeps the one run-wide table in `VmState.redirects`, so it travels in
 * a saved game and is stamped onto every program compiled afterwards
 * (`withRedirects`). `include()` adds a file to the program's run-time include
 * list, which lives in the `ProgramRef` and so in saved state; the program is
 * then compiled afresh under its new identity.
 */

import { foldPath } from "../formats/main-file/layout.ts";
import type { Arg } from "./builtins.ts";
import type { ProgramCache } from "./cache.ts";
import { INCLUDE_MISSING, INCLUDE_REFUSED, ScriptError } from "./errors.ts";
import { resolveProgram, type ProgramLoader } from "./loader.ts";
import type { SourcePos } from "./ops.ts";
import { programKey, type Program, type ProgramRef } from "./program.ts";
import type { VmState } from "./state.ts";
import { foldAscii, toStringValue } from "./values.ts";

/** Make `from` redirect to `to`; an existing entry for `from` keeps its place (R-42). Names fold (ASCII). */
export function setRedirect(vm: VmState, from: string, to: string): void {
  const key = foldAscii(from);
  const value = foldAscii(to);
  const at = vm.redirects.findIndex((pair) => pair[0] === key);
  if (at >= 0) {
    vm.redirects[at] = [key, value];
  } else {
    vm.redirects.push([key, value]);
  }
}

/** Remove the redirect of `from`, if any (R-43). */
export function killRedirect(vm: VmState, from: string): void {
  const key = foldAscii(from);
  vm.redirects = vm.redirects.filter((pair) => pair[0] !== key);
}

/** Remove every redirect (R-43). */
export function killAllRedirects(vm: VmState): void {
  vm.redirects = [];
}

function needArgs(name: string, args: readonly Arg[], count: number, pos: SourcePos): void {
  if (args.length !== count) {
    throw new ScriptError(
      "arity.mismatch",
      `\`${name}\` takes ${count} argument(s) but was called with ${args.length}`,
      pos,
    );
  }
}

/** Move every frame and object running `from` over to `to` (the program grew an include). */
function replaceRefs(vm: VmState, from: ProgramRef, to: ProgramRef): void {
  const key = programKey(from);
  for (const thread of vm.threads) {
    for (const frame of thread.frames) {
      if (programKey(frame.program) === key) frame.program = to;
    }
  }
  for (const record of vm.objects) {
    if (record.program !== null && programKey(record.program) === key) record.program = to;
  }
}

/**
 * Run one module command. The call site is already past argument evaluation;
 * the caller advances the instruction and pushes the unset value.
 */
export function runModuleCommand(
  name: string,
  args: readonly Arg[],
  vm: VmState,
  loader: ProgramLoader | undefined,
  programs: ProgramCache,
  program: Program,
  pos: SourcePos,
  onInclude?: (from: ProgramRef, to: ProgramRef) => void,
): void {
  switch (name) {
    case "redirect":
      needArgs(name, args, 2, pos);
      setRedirect(vm, toStringValue(args[0]!.value), toStringValue(args[1]!.value));
      return;
    case "killredirect":
      needArgs(name, args, 1, pos);
      killRedirect(vm, toStringValue(args[0]!.value));
      return;
    case "killallredirects":
      needArgs(name, args, 0, pos);
      killAllRedirects(vm);
      return;
    case "include": {
      needArgs(name, args, 1, pos);
      const path = toStringValue(args[0]!.value);
      const key = loader === undefined ? undefined : resolveProgram(loader, path);
      if (loader === undefined || key === undefined) {
        throw new ScriptError(INCLUDE_MISSING, `include("${path}"): the file is not in the asset index`, pos);
      }
      // One folded path is one include (MOD-3): a file the program already holds adds nothing.
      if (Object.hasOwn(program.files, key)) return;
      const folded = foldPath(path);
      const already = program.ref.includes ?? [];
      if (already.includes(folded)) return;
      // Read and compile the program with the file before any saved ref changes, so a missing,
      // unreadable or refused file is a catchable failure that leaves the state as it was.
      const next: ProgramRef = { ...program.ref, includes: [...already, folded] };
      try {
        programs.get(next);
      } catch (error) {
        if (!(error instanceof ScriptError)) throw error;
        const missing = error.code === "program.include-missing";
        throw new ScriptError(
          missing ? INCLUDE_MISSING : INCLUDE_REFUSED,
          `include("${path}"): ${error.message}`,
          pos,
        );
      }
      replaceRefs(vm, program.ref, next);
      onInclude?.(program.ref, next);
      return;
    }
    default:
      throw new ScriptError("unknown.command", `\`${name}\` is not a module command`, pos);
  }
}
