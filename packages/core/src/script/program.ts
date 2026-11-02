/**
 * Program references and compilation (AD-7; docs/spec/engine/rpgcode-language.md#open-questions follow-ups 5/6).
 *
 * `ProgramRef` is AD-7's shape plus the two lists a faithful rebuild needs
 * (docs/spec/engine/rpgcode-modules-and-objects.md#includes MOD-3 and
 * #redirects R-42): the files the program included at run time, and the
 * redirect table in force when it was compiled. Both are absent when empty, so
 * a ref without them is the shape that was saved before modules existed.
 * Compiled code is held outside state and rebuilt from the file or inline text
 * on restore, so `Program` is the compiled artefact and never enters
 * `GameState`.
 *
 * A file program is compiled together with every file it includes into one
 * flat `Program`: the main file's code comes first, then each included file's
 * code in the order the includes were applied. Only functions and classes of an
 * included file are reachable; its loose top-level code is in the array but no
 * jump enters it.
 *
 * docs/adr/0004 (decision 1's compiled-program cache); docs/spec/formats/rpgcode-program.md#compiled-form and docs/spec/engine/rpgcode-language.md#lexical-rules / docs/spec/engine/rpgcode-functions.md.
 */

import { foldPath } from "../formats/main-file/layout.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { Ast, IncludeRequest } from "./ast.ts";
import { INCLUDE_CYCLE, ScriptError } from "./errors.ts";
import { scan } from "./lex.ts";
import { relocate } from "./link.ts";
import { readProgram, resolveProgram, type ProgramLoader } from "./loader.ts";
import {
  lower,
  type CompiledClass,
  type FunctionInfo,
  type LowerResult,
  type StatementRange,
} from "./lower.ts";
import type { StepOp } from "./ops.ts";
import { parse } from "./parse.ts";
import { parseTk2 } from "./tk2.ts";

export type { CompiledClass, FunctionInfo, StatementRange } from "./lower.ts";
export type { ProgramLoader } from "./loader.ts";

/**
 * The instruction version: the meaning of a saved instruction position (`ip`,
 * `operands`). It is `GameState.schema.ir` and `ProgramRef.ir`, and it changes
 * only when the step set, the lowering or the emission order changes what an
 * `ip` means — never for a data-shape change, which bumps the affected section
 * version instead. A bump needs the step-op fingerprint golden updated and a
 * save fixture from the previous version
 * (docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling).
 */
export const IR_VERSION = "1";

/** A redirect table as saved: ordered `[folded old name, folded new name]` pairs (R-42). */
export type RedirectPairs = Array<[string, string]>;

/** The source dialect carried by a program reference (docs/spec/engine/rpgcode-dialects.md). */
export type ScriptDialect = "tk3" | "tk2";

/**
 * How a program was supplied (AD-7). `includes` lists, in order, the folded
 * references of the files `include()` added at run time (MOD-3); `redirects` is
 * the redirect table in force when it was compiled (R-42). Both are absent
 * when empty and `dialect` defaults to TK3.
 */
export type ProgramRef =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly sourceHash: string;
      readonly ir: string;
      readonly includes?: string[];
      readonly redirects?: RedirectPairs;
      readonly dialect?: ScriptDialect;
      /** Package that owns definitions compiled from this reference (PKG-8). */
      readonly owner?: string;
    }
  | {
      readonly kind: "inline";
      readonly text: string;
      readonly ir: string;
      readonly includes?: string[];
      readonly redirects?: RedirectPairs;
      readonly dialect?: ScriptDialect;
      /** Package that owns definitions compiled from this reference (PKG-8). */
      readonly owner?: string;
    };

/** A located note the loader raises while compiling: a clash, a shadowed built-in or an include cycle. */
export type ProgramNotice = {
  readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly data: PlainData;
};

/** A compiled program: its reference, Step IR, functions, classes and labels. */
export type Program = {
  readonly ref: ProgramRef;
  readonly ops: StepOp[];
  /** The one flat list of script functions (MOD-1): per name, one entry per parameter count, last added wins. */
  readonly functions: { readonly [name: string]: readonly FunctionInfo[] };
  readonly classes: { readonly [name: string]: CompiledClass };
  readonly labels: { readonly [name: string]: number };
  /** Every statement's op range, for `resumeNext()` (ERR-1). */
  readonly statements: readonly StatementRange[];
  /** Each loaded file's own definitions, by canonical asset key, for `file.func` calls (MOD-2). */
  readonly files: { readonly [key: string]: { readonly [name: string]: readonly FunctionInfo[] } };
  /** The folded reference of each file found while loading (`queue.prg`) to its asset key. */
  readonly fileKeys: { readonly [path: string]: string };
  /** Warnings and diagnostics raised while loading (MOD-1, MOD-3, R-35). */
  readonly notices: readonly ProgramNotice[];
  /** Each parsed file, main first then includes in load order. */
  readonly units: readonly ProgramUnit[];
};

/** What a compile may use beyond the ref: the source loader and the built-in name test. */
export type CompileContext = {
  readonly loader?: ProgramLoader;
  /** Whether `name` is a built-in, so a script function of that name is reported as shadowed (R-35). */
  readonly isBuiltin?: (name: string) => boolean;
  /**
   * The packages that export a script function of `name` with `argc` parameters, earliest first,
   * so a program or included function that wins over one is reported once (PKG-4; entry 19.21).
   * A package's own program is never asked: its functions are the exports.
   */
  readonly packageFunctionOwners?: (name: string, argc: number) => readonly string[];
};

/** The program-cache identity of `ref`: dialect, source, instruction version, includes, redirects and owner (MOD-3, R-42, PKG-8). */
export function programKey(ref: ProgramRef): string {
  const dialect = ref.dialect ?? "tk3";
  const includes = (ref.includes ?? []).join("\u0001");
  const redirects = (ref.redirects ?? []).map(([from, to]) => `${from}\u0002${to}`).join("\u0001");
  const source =
    ref.kind === "inline"
      ? `inline\u0000${dialect}\u0000${ref.ir}\u0000${ref.text}`
      : `file\u0000${dialect}\u0000${foldPath(ref.path)}\u0000${ref.sourceHash}\u0000${ref.ir}`;
  const metadata = `${includes}\u0000${redirects}`;
  return ref.owner === undefined ? `${source}\u0000${metadata}` : `${source}\u0000${metadata}\u0000owner\u0000${ref.owner}`;
}

/** `ref` carrying the redirect table `redirects` unless it already records one (R-42). */
export function withRedirects(ref: ProgramRef, redirects: ReadonlyArray<readonly [string, string]>): ProgramRef {
  if (redirects.length === 0 || ref.redirects !== undefined) return ref;
  return { ...ref, redirects: redirects.map(([from, to]): [string, string] => [from, to]) };
}
/** Tag a program reference with its owning package; the owner is part of cache identity (PKG-8). */
export function withOwner(ref: ProgramRef, owner: string): ProgramRef {
  if (owner === "") throw new ScriptError("program.owner", "a program owner must not be empty");
  return ref.owner === owner ? ref : { ...ref, owner };
}


/**
 * A file program reference for `name`: the source is read through `loader` to
 * hash it, so a changed file is a different program. A compiled file is refused (§9.1).
 */
export function fileProgramRef(
  loader: ProgramLoader,
  name: string,
  redirects: RedirectPairs = [],
): ProgramRef {
  const source = readProgram(loader, name);
  if (source === undefined) {
    throw new ScriptError("program.missing", `no program "${name}" is in the asset index`);
  }
  const ref: ProgramRef = {
    kind: "file",
    path: name,
    sourceHash: source.hash,
    ir: IR_VERSION,
  };
  return withRedirects(ref, redirects);
}

/**
 * The reference a thread restarts from: current source for a file program, the
 * saved text for an inline one, under the saved redirects, include list, dialect
 * and owner, always stamped with the current instruction version. A thread restart
 * (`restartThreadFromSource`), an older instruction version at load, and the
 * load-time check that the restart will compile all build it here, so they cannot
 * disagree.
 */
export function restartProgramRef(
  stale: ProgramRef,
  loader: ProgramLoader | undefined,
  vmRedirects: RedirectPairs,
): ProgramRef {
  if (stale.kind !== "file") {
    return {
      ...stale,
      ir: IR_VERSION,
      ...(stale.includes === undefined ? {} : { includes: [...stale.includes] }),
      ...(stale.dialect === undefined ? {} : { dialect: stale.dialect }),
    };
  }
  if (loader === undefined) {
    throw new ScriptError("program.file-unsupported", `cannot restart "${stale.path}" without a source loader`);
  }
  const fresh = fileProgramRef(loader, stale.path, stale.redirects ?? vmRedirects);
  return {
    ...fresh,
    ...(stale.includes === undefined ? {} : { includes: [...stale.includes] }),
    ...(stale.dialect === undefined ? {} : { dialect: stale.dialect }),
    ...(stale.owner === undefined ? {} : { owner: stale.owner }),
  };
}

/** One parsed source file in the order it was added to the program. */
/**
 * One parsed source file of a compiled program: the main file first, then the
 * files its includes reached in load order. The tables stay on `Program`; a
 * reader that needs the source-level facts (the include requests with their
 * explicit/implicit spelling, the text a span slices, an event name written as
 * a literal) reads them here rather than parsing the file again
 * (docs/spec/engine/rpgcode-tooling.md#tool-6).
 */
export type ProgramUnit = {
  readonly name: string;
  readonly key: string;
  readonly ast: Ast;
  /** Every include request the file made, literal `#include` and implicit `file.func`, in source order (MOD-2). */
  readonly requests: readonly IncludeRequest[];
  /** The decoded source text, so a span's text can be sliced without re-reading the host. */
  readonly text: string;
};

type Unit = ProgramUnit;

const INLINE_KEY = "<inline>";

/** Compile inline source text in the selected dialect (TK2 normalises into the shared AST). */
export function compileInline(text: string, file = "<inline>", dialect: ScriptDialect = "tk3"): Program {
  const ref: ProgramRef =
    dialect === "tk3"
      ? { kind: "inline", text, ir: IR_VERSION }
      : { kind: "inline", text, ir: IR_VERSION, dialect };
  return build(ref, {}, file);
}

/**
 * Compile `ref` into a `Program`. A file program needs `context.loader`; an
 * inline program may use one for its includes. Includes are resolved through
 * the asset resolver, expanded depth-first with a cycle guard, and lowered into
 * one flat array (MOD-1..3).
 */
export function compileProgram(ref: ProgramRef, context: CompileContext = {}): Program {
  if (ref.kind === "file" && context.loader === undefined) {
    throw new ScriptError(
      "program.file-unsupported",
      "a file program needs a source loader (an asset index, a root and a byte port)",
    );
  }
  return build(ref, context, "<inline>");
}

function build(ref: ProgramRef, context: CompileContext, inlineName: string): Program {
  const redirects = new Map<string, string>(ref.redirects ?? []);
  const notices: ProgramNotice[] = [];
  const units: Unit[] = [];
  const fileKeys: { [path: string]: string } = {};
  const seen = new Set<string>();
  const loader = context.loader;

  function parseUnit(text: string, name: string, key: string, located: boolean): Unit {
    try {
      const scanned = ref.dialect === "tk2" ? { tokens: [], includes: [] } : scan(text, true);
      const ast = ref.dialect === "tk2" ? parseTk2(text) : parse(scanned.tokens, { redirects });
      const requests = [...scanned.includes, ...ast.includes].sort((a, b) => a.line - b.line);
      return { name, key, ast, requests, text };
    } catch (error) {
      // The parser does not know its file; a loaded file's failures carry its name,
      // and the token span the parser stamped (docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention).
      if (located && error instanceof ScriptError && error.pos?.file === "") {
        throw new ScriptError(error.code, error.message, { ...error.pos, file: name });
      }
      throw error;
    }
  }

  function include(request: IncludeRequest, from: Unit, stack: readonly string[]): void {
    if (loader === undefined) return;
    const key = resolveProgram(loader, request.path);
    // A file missing at load time is ignored silently (R2-Q21).
    if (key === undefined) return;
    fileKeys[foldPath(request.path)] = key;
    if (stack.includes(key)) {
      // A file calling itself, or a file already being parsed, through `file.func` is an ordinary
      // qualified call; only a literal include that recurses is a cycle (MOD-3).
      if (request.implicit) return;
      const chain = [...stack, key].join(" -> ");
      notices.push({
        code: INCLUDE_CYCLE,
        file: from.name,
        line: request.line,
        message: `including "${request.path}" closes an include cycle (${chain}); the file counts as already included (MOD-3)`,
        data: { path: request.path, chain: [...stack, key] },
      });
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    const source = readProgram(loader, request.path);
    if (source === undefined) return;
    const child = parseUnit(source.text, source.key, source.key, true);
    units.push(child);
    for (const next of child.requests) include(next, child, [...stack, key]);
  }

  let main: Unit;
  if (ref.kind === "inline") {
    main = parseUnit(ref.text, inlineName, INLINE_KEY, false);
  } else {
    const source = loader === undefined ? undefined : readProgram(loader, ref.path);
    if (source === undefined) {
      throw new ScriptError("program.missing", `no program "${ref.path}" is in the asset index`);
    }
    // The saved instruction offsets belong to the source they were compiled from: a file that
    // changed since is not resumed (the restore-safe policy, docs/spec/engine/rpgcode-modules-and-objects.md R-42).
    if (source.hash !== ref.sourceHash) {
      throw new ScriptError(
        "restore.source-changed",
        `"${ref.path}" changed since it was compiled (source hash ${ref.sourceHash} saved, ${source.hash} now); restart it from source`,
      );
    }
    main = parseUnit(source.text, source.key, source.key, true);
    fileKeys[foldPath(ref.path)] = source.key;
  }
  units.push(main);
  seen.add(main.key);
  // Literal includes and implicit `file.func` includes apply when the file's parse ends.
  for (const request of main.requests) include(request, main, [main.key]);
  // Files `include()` added at run time come after the source's own (MOD-3). A saved list
  // names files that must still load: a missing or unreadable one is not skipped.
  for (const path of ref.includes ?? []) {
    const key = loader === undefined ? undefined : resolveProgram(loader, path);
    if (loader === undefined || key === undefined || loader.read(key) === undefined) {
      throw new ScriptError(
        "program.include-missing",
        `the run-time include "${path}" is missing or unreadable`,
      );
    }
    include({ path, line: 0, implicit: false }, main, [main.key]);
  }

  const classNames = new Set<string>();
  for (const unit of units) for (const cls of unit.ast.classes) classNames.add(cls.name);

  const ops: StepOp[] = [];
  const statements: StatementRange[] = [];
  const functions: { [name: string]: FunctionInfo[] } = {};
  const classes: { [name: string]: CompiledClass } = {};
  const files: { [key: string]: { readonly [name: string]: readonly FunctionInfo[] } } = {};
  const owners = new Map<string, string>();
  const classOwners = new Map<string, string>();
  let labels: { readonly [name: string]: number } = {};

  // Code is laid out main first, so the main file's labels start at op 0.
  const lowered: LowerResult[] = units.map((unit) => {
    const result = relocate(lower(unit.ast, unit.name, classNames), ops.length);
    for (const op of result.ops) ops.push(op);
    for (const range of result.statements) statements.push(range);
    return result;
  });
  labels = lowered[0]!.labels;

  // Definitions are added to the flat list in include order and the main file last, so the
  // main file's own definition wins after every include has been applied (MOD-1, R-41).
  const addOrder = [...units.keys()].slice(1).concat(0);
  const reported = new Set<string>();
  for (const at of addOrder) {
    const unit = units[at]!;
    const result = lowered[at]!;
    files[unit.key] = result.functions;
    for (const def of result.defs) {
      if (context.isBuiltin?.(def.name) === true) {
        notices.push({
          code: "command.shadowed",
          file: unit.name,
          line: def.line,
          message: `function "${def.name}" shadows the built-in of the same name; calls bind to the built-in (R-35)`,
          data: { name: def.name, file: unit.name },
        });
      }
      if (ref.owner === undefined && context.packageFunctionOwners !== undefined) {
        const signature = `${def.name}\u0000${def.argc}`;
        if (!reported.has(signature)) {
          reported.add(signature);
          for (const owner of context.packageFunctionOwners(def.name, def.argc)) {
            notices.push({
              code: "command.overridden",
              file: unit.name,
              line: def.line,
              message: `"${def.name}" with ${def.argc} parameter(s) is bound by both package "${owner}" and program "${unit.name}"; program "${unit.name}" wins the unqualified call (PKG-4)`,
              data: {
                name: def.name,
                argc: def.argc,
                kind: "package-function",
                previous: `package "${owner}"`,
                replacement: `program "${unit.name}"`,
                winner: `program "${unit.name}"`,
              },
            });
          }
        }
      }
    }
    for (const [name, list] of Object.entries(result.functions)) {
      const flat = Object.hasOwn(functions, name) ? functions[name]! : (functions[name] = []);
      for (const info of list) {
        const argc = info.params.length;
        const slot = flat.findIndex((existing) => existing.params.length === argc);
        const ownerKey = `${name}\u0000${argc}`;
        if (slot < 0) {
          flat.push(info);
        } else {
          const previous = owners.get(ownerKey) ?? "?";
          const def = result.defs.find((item) => item.name === name && item.argc === argc);
          notices.push({
            code: "command.overridden",
            file: unit.name,
            line: def?.line ?? 1,
            message: `"${name}" with ${argc} parameter(s) is defined by both "${previous}" and "${unit.name}"; "${unit.name}" wins (MOD-1)`,
            data: { name, kind: "script", previous, replacement: unit.name, argc },
          });
          flat[slot] = info;
        }
        owners.set(ownerKey, unit.name);
      }
    }
    for (const [name, cls] of Object.entries(result.classes)) {
      const previous = classOwners.get(name);
      if (previous !== undefined) {
        notices.push({
          code: "command.overridden",
          file: unit.name,
          line: unit.ast.classes.find((item) => item.name === name)?.line ?? 1,
          message: `class "${name}" is defined by both "${previous}" and "${unit.name}"; "${unit.name}" wins (MOD-1)`,
          data: { name, kind: "class", previous, replacement: unit.name },
        });
      }
      classes[name] = cls;
      classOwners.set(name, unit.name);
    }
  }

  return { ref, ops, functions, classes, labels, statements, files, fileKeys, notices, units };
}
