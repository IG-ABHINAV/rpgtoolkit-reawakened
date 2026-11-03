/**
 * The rule-based linter (docs/spec/engine/rpgcode-tooling.md#tool-3 and the
 * epic's Done-when 6). Every rule reads the TOOL-6 index and the gate-checked
 * catalogue - never a fresh walk of the source - and produces the one TOOL-3
 * diagnostic shape with a stable `<area>/<rule>` id.
 *
 * A project configures rules in one file: a per-rule severity (`off` disables)
 * and an ignore list. Configuring nothing yields the defaults, and nothing is
 * silently suppressed - the summary names the disabled rules and counts the
 * ignored findings.
 */

import { commandDocumentation, foldAscii, HOST_METHOD_NAMES, type ResolvedPlugin } from "@tk-reawakened/core";
import { legacyFixes } from "./fixes.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { rangeOf } from "./diagnostics.ts";
import type { IndexDocument, IndexProgram, IndexPos } from "./index-document.ts";

export type RuleId =
  | "lint/unknown-command"
  | "lint/command-arity"
  | "lint/shadowed-builtin"
  | "lint/unresolved-include"
  | "dialect/sigil"
  | "dialect/return-method"
  | "dialect/obsolete-control"
  | "dialect/unquoted-command-argument";

export type LintSeverity = "error" | "warning" | "info" | "hint";

export type RuleDefinition = {
  readonly id: RuleId;
  readonly defaultSeverity: LintSeverity;
  /** One line a game author can act on. */
  readonly rationale: string;
  /** Whether the linter can also rewrite the source for this rule. */
  readonly fix: boolean;
};

/** The rule table. A rule never changes meaning without a major change to the index/spec. */
export const RULES: readonly RuleDefinition[] = [
  {
    id: "lint/unknown-command",
    defaultSeverity: "error",
    rationale: "A call names no script function, class, label or registered command, so it fails at run time.",
    fix: false,
  },
  {
    id: "lint/command-arity",
    defaultSeverity: "warning",
    rationale: "A call passes fewer required or more parameters than the registered command takes.",
    fix: false,
  },
  {
    id: "lint/shadowed-builtin",
    defaultSeverity: "warning",
    rationale: "A script definition reuses a registered command's name, so the command wins at the call site (R-35).",
    fix: false,
  },
  {
    id: "lint/unresolved-include",
    defaultSeverity: "warning",
    rationale: "An include names a file the asset index does not serve, so its definitions are missing.",
    fix: false,
  },
  {
    id: "dialect/sigil",
    defaultSeverity: "warning",
    rationale: "The legacy `!`/`$` sigil is ignored by the lexer; deleting it makes the program plain (docs/spec/engine/rpgcode-dialects.md:57-69).",
    fix: true,
  },
  {
    id: "dialect/return-method",
    defaultSeverity: "warning",
    rationale: "`#ReturnMethod(x)` is the pre-3.1 spelling of `return x`.",
    fix: true,
  },
  {
    id: "dialect/obsolete-control",
    defaultSeverity: "warning",
    rationale: "`#Dos`, `#Windows`, `#Gone`, `#Over`, `#Reset` and `#Win` are obsolete engine controls with no meaning in 3.1.",
    fix: true,
  },
  {
    id: "dialect/unquoted-command-argument",
    defaultSeverity: "warning",
    rationale: "A `#Command` line with an unquoted argument is the Toolkit 2.x spelling; 3.1 reads `command(\"text\")`.",
    fix: true,
  },
];

/** One ignore entry: a rule, a file, a line or any combination; absent fields match anything. */
export type LintIgnore = {
  readonly rule?: string;
  readonly file?: string;
  readonly line?: number;
};

/** The one per-project config file (`tkr-lint.json`). */
export type LintConfig = {
  readonly severity?: { readonly [rule: string]: LintSeverity | "off" };
  readonly ignore?: readonly LintIgnore[];
};

export type LintSummary = {
  readonly diagnostics: number;
  /** Rules the config turned off, so a reader knows the run is narrower than the table. */
  readonly disabledRules: readonly string[];
  /** Findings an ignore entry matched and removed. */
  readonly ignoredRanges: number;
};

export type LintResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly summary: LintSummary;
};

export type LintOptions = {
  readonly plugins: readonly ResolvedPlugin[];
  readonly config?: LintConfig;
  /** Each program's source text, keyed by its name; the dialect rules run where it is supplied. */
  readonly sources?: { readonly [name: string]: string };
  /**
   * Whether the run has an asset index behind it. Only then can an unserved
   * include be told from a file the project ships elsewhere, so the rule is off
   * without one (the CLI passes true; a stock baseline over sources without their
   * game tree passes false).
   */
  readonly resolveIncludes?: boolean;
};

const SEVERITIES = new Set<string>(["error", "warning", "info", "hint", "off"]);

/**
 * Validate a parsed config file. Returns the config, or the problems that make
 * it unusable - an unknown rule id or severity is a problem, never ignored,
 * because a typo in a rule name would otherwise silently disable a rule.
 */
export function readLintConfig(value: unknown): { readonly ok: true; readonly config: LintConfig } | { readonly ok: false; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, problems: ["the lint config must be a JSON object"] };
  }
  const record = value as Record<string, unknown>;
  const known = new Set<string>(RULES.map((rule) => rule.id));
  const severity = record.severity;
  if (severity !== undefined) {
    if (severity === null || typeof severity !== "object" || Array.isArray(severity)) {
      problems.push("severity must be an object of rule id to error|warning|info|hint|off");
    } else {
      for (const [rule, level] of Object.entries(severity)) {
        if (!known.has(rule)) problems.push(`severity names the unknown rule ${JSON.stringify(rule)}`);
        if (typeof level !== "string" || !SEVERITIES.has(level)) {
          problems.push(`severity for ${rule} must be error, warning, info, hint or off`);
        }
      }
    }
  }
  const ignore = record.ignore;
  if (ignore !== undefined) {
    if (!Array.isArray(ignore)) {
      problems.push("ignore must be an array");
    } else {
      ignore.forEach((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          problems.push(`ignore[${index}] must be an object`);
          return;
        }
        const item = entry as Record<string, unknown>;
        if (item.rule !== undefined && (typeof item.rule !== "string" || !known.has(item.rule))) {
          problems.push(`ignore[${index}].rule names an unknown rule`);
        }
        if (item.file !== undefined && typeof item.file !== "string") problems.push(`ignore[${index}].file must be a string`);
        if (item.line !== undefined && (typeof item.line !== "number" || !Number.isInteger(item.line))) {
          problems.push(`ignore[${index}].line must be an integer`);
        }
      });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      ...(severity === undefined ? {} : { severity: severity as { readonly [rule: string]: LintSeverity | "off" } }),
      ...(ignore === undefined ? {} : { ignore: ignore as readonly LintIgnore[] }),
    },
  };
}

type Catalogue = {
  /** Folded name to its canonical documentation entry. */
  readonly byName: Map<string, ReturnType<typeof commandDocumentation>[number]>;
};

function catalogueOf(plugins: readonly ResolvedPlugin[]): Catalogue {
  const byName = new Map<string, ReturnType<typeof commandDocumentation>[number]>();
  for (const entry of commandDocumentation(plugins)) {
    const folded = foldAscii(entry.name);
    const existing = byName.get(folded);
    if (existing === undefined || existing.canonicalName !== folded) byName.set(folded, entry);
  }
  return { byName };
}

function rangeOfSite(pos: IndexPos): { start: { line: number; column: number }; end: { line: number; column: number } } {
  return rangeOf({ file: pos.file, line: pos.line, ...(pos.col === undefined ? {} : { col: pos.col }), ...(pos.endCol === undefined ? {} : { endCol: pos.endCol }) }, "");
}

function diagnostic(rule: RuleDefinition, severity: LintSeverity, pos: IndexPos, message: string): Diagnostic {
  return { code: rule.id, severity, range: rangeOfSite(pos), message, rule: rule.id };
}

/** The registered arity bounds of a command: required parameters, and the most it accepts. */
function arityOf(entry: ReturnType<typeof commandDocumentation>[number]): { readonly min: number; readonly max: number } {
  const variadic = entry.params.some((param) => param.variadic);
  return {
    min: entry.params.filter((param) => !param.optional && !param.variadic).length,
    max: variadic ? Number.POSITIVE_INFINITY : entry.params.length,
  };
}

function rulesFor(program: IndexProgram, catalogue: Catalogue, resolveIncludes: boolean): Diagnostic[] {
  const found: Diagnostic[] = [];
  const unknown = RULES[0]!;
  const arity = RULES[1]!;
  const shadowed = RULES[2]!;
  const unresolved = RULES[3]!;
  const declared = new Set<string>([...program.functions.map((fn) => foldAscii(fn.name)), ...program.classes.map((cls) => foldAscii(cls.name)), ...program.labels.map((label) => foldAscii(label.name))]);
  // A plain-name call may invoke a *variable* that holds a callable (FUN-8): the
  // lowering emits a load of that name before the call, so a name read anywhere in
  // the program is resolved at run time and is not an unknown command.
  const callableVariables = new Set(program.references.filter((site) => site.kind === "read" && site.name !== null).map((site) => foldAscii(site.name!)));
  // A parameter is called as a callable without a load, so the index states the
  // parameter names; a call to one is not an unknown command.
  for (const param of program.parameters) callableVariables.add(foldAscii(param));
  // A host object's methods are call targets that are not registered commands (`context.inventory.use`, `fighter.damage`).
  const hostMethods = new Set<string>();
  for (const name of HOST_METHOD_NAMES) {
    callableVariables.add(foldAscii(name));
    hostMethods.add(foldAscii(name));
  }

  for (const call of program.calls) {
    if (call.file !== null) continue;
    const name = foldAscii(call.name);
    if (declared.has(name) || catalogue.byName.has(name) || callableVariables.has(name)) continue;
    // A bare identifier statement lowers to a zero-argument call; a missing name is
    // the only fact the index has, so the rule states exactly that.
    found.push(diagnostic(unknown, unknown.defaultSeverity, call.pos, `\`${call.written ?? call.name}\` is not a script function, class, label or registered command`));
  }

  for (const call of program.calls) {
    if (call.file !== null) continue;
    // A name that is also a host method (`context.inventory.replace`) may be that method rather than the command of
    // the same name, so its arity is not the catalogue's to state.
    if (hostMethods.has(foldAscii(call.name))) continue;
    const entry = catalogue.byName.get(foldAscii(call.name));
    if (entry === undefined) continue;
    const bounds = arityOf(entry);
    if (call.arity >= bounds.min && call.arity <= bounds.max) continue;
    const expected = bounds.max === Number.POSITIVE_INFINITY ? `${bounds.min} or more` : bounds.min === bounds.max ? `${bounds.min}` : `${bounds.min} to ${bounds.max}`;
    found.push(diagnostic(arity, arity.defaultSeverity, call.pos, `\`${entry.canonicalName}\` takes ${expected} parameter(s); this call passes ${call.arity}`));
  }

  for (const fn of program.functions) {
    const entry = catalogue.byName.get(foldAscii(fn.name));
    if (entry === undefined) continue;
    found.push(diagnostic(shadowed, shadowed.defaultSeverity, { file: fn.file, line: fn.line, ...(fn.col === undefined ? {} : { col: fn.col }), ...(fn.endCol === undefined ? {} : { endCol: fn.endCol }) }, `\`${fn.name}\` shadows the registered command \`${entry.canonicalName}\`; calls bind to the command (R-35)`));
  }

  if (resolveIncludes) for (const include of program.includes) {
    if (include.key !== undefined) continue;
    found.push(diagnostic(unresolved, unresolved.defaultSeverity, { file: include.file, line: include.line, ...(include.col === undefined ? {} : { col: include.col }), ...(include.endCol === undefined ? {} : { endCol: include.endCol }) }, `nothing serves \`${include.path}\`, so its definitions are missing`));
  }

  return found;
}

/**
 * The dialect rules (docs/spec/engine/rpgcode-dialects.md:57-69) over one
 * program's text. `legacyFixes` already re-parsed each rewrite and proved it
 * lowers identically, so a diagnostic here carries an edit that is safe to
 * apply; a row without a preserving rewrite is deliberately not offered.
 */
function dialectDiagnostics(source: string): Diagnostic[] {
  return legacyFixes(source).map((fix) => {
    const [first] = fix.edits;
    if (first === undefined) throw new Error(`${fix.rule} produced no edit`);
    return {
      code: fix.rule,
      severity: "warning",
      range: first.range,
      message: fix.title,
      rule: fix.rule,
      fix: [...fix.edits],
    };
  });
}

function ignored(diagnostic: Diagnostic, file: string, config: LintConfig): boolean {
  return (config.ignore ?? []).some((entry) => {
    if (entry.rule !== undefined && entry.rule !== diagnostic.rule) return false;
    if (entry.file !== undefined && foldAscii(entry.file) !== foldAscii(file)) return false;
    if (entry.line !== undefined && entry.line !== diagnostic.range.start.line) return false;
    return true;
  });
}

/**
 * Lint every program of an index. Severity comes from the config's override or
 * the rule's default; a rule set to `off` is not run and is named in the summary;
 * an ignore entry removes a finding and is counted.
 */
export function lint(document: IndexDocument, options: LintOptions): LintResult {
  const catalogue = catalogueOf(options.plugins);
  const config = options.config ?? {};
  const disabled: string[] = [];
  const enabled: RuleDefinition[] = [];
  for (const rule of RULES) {
    const override = config.severity?.[rule.id];
    if (override === "off") disabled.push(rule.id);
    else enabled.push(rule);
  }
  const severityOf = (rule: RuleDefinition): LintSeverity => {
    const override = config.severity?.[rule.id];
    return override === undefined || override === "off" ? rule.defaultSeverity : override;
  };
  const diagnostics: Diagnostic[] = [];
  let ignoredRanges = 0;
  for (const program of document.programs) {
    for (const found of rulesFor(program, catalogue, options.resolveIncludes === true)) {
      if (!enabled.some((rule) => rule.id === found.rule)) continue;
      const rule = RULES.find((item) => item.id === found.rule)!;
      if (ignored(found, program.name, config)) {
        ignoredRanges += 1;
        continue;
      }
      diagnostics.push({ ...found, severity: severityOf(rule) });
    }
    const source = options.sources?.[program.name];
    if (source === undefined) continue;
    for (const found of dialectDiagnostics(source)) {
      if (!enabled.some((rule) => rule.id === found.rule)) continue;
      const rule = RULES.find((item) => item.id === found.rule)!;
      if (ignored(found, program.name, config)) {
        ignoredRanges += 1;
        continue;
      }
      diagnostics.push({ ...found, severity: severityOf(rule) });
    }
  }
  return {
    diagnostics,
    summary: { diagnostics: diagnostics.length, disabledRules: disabled, ignoredRanges },
  };
}
