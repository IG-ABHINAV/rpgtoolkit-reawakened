/**
 * `tkr-native-rename`: the command-line front end of the native document rename tool.
 *
 * It reads a folder, plans the rename with the pure planner of `native-data`, and either prints
 * the plan (`--dry-run`) or applies it all or not at all (see `apply.ts`). Exit codes: 0 done (or
 * the dry run would go ahead), 1 refused and nothing was written, 2 usage error, 3 the folder
 * could not be read, 4 an operation failed and every change was undone, 5 an operation failed and
 * some change could not be undone.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { collectDocuments } from "@tk-reawakened/native-data-cli";
import { planRename, REGISTRY, validateRenameConfig, type RenameConfig, type RenamePair, type RenamePlan, type RenameRefusal } from "@tk-reawakened/native-data";
import { applyPlan, checkApplicable, type ApplyOptions, type ApplyOutcome } from "./apply.ts";

export const RESULT_SCHEMA = "tkr-native-rename/1";

export type CliResult = {
  readonly exitCode: 0 | 1 | 2 | 3 | 4 | 5;
  readonly stdout: string;
  readonly stderr: string;
};

const REGISTERED = REGISTRY.map((entry) => entry.extension).join(", ");

export const HELP = `tkr-native-rename: rename or move native documents without breaking a link

In plain words: a native document is named by where it lives, so moving or renaming
one changes its name, and every document that mentions the old name has to change
with it. This command does both in one step. It moves the file, rewrites each
mention of the old name in your other native documents (a plugin document's owner,
an owner's list of plugin documents, and any other field you name), and does it all
or not at all: if anything cannot be done, no file in the project has changed.
Edits touch only the line that holds the old name; comments and every other line
stay exactly as they were. It refuses, with the reason, a new name that is not a
valid ID, a new extension that names another kind of document, a name that already
belongs to a document, and a project that the checker (tkr-native-check) does not
find clean to begin with: run the checker and fix what it reports first.

Exactly: reads the native documents under FOLDER (files whose names end in a native
document extension: ${REGISTERED}) as UTF-8 YAML. Each OLD=NEW pair gives the ID of a
document (its path below FOLDER with the extension, "/" between parts, compared
with only A to Z folded) and its new ID, which is also its new path. Several pairs
are one transaction, judged on the project as it would be after all of them, so an
owner and its plugin documents can move together and two documents can swap names.
A document that holds the old ID in a link field or a --ref-field has that one scalar
replaced in place (a quoted value keeps its quotes). Plugin documents do not move
with their owner: name them in the same command. A new name that differs only in case
(Guard.tkract to guard.tkract) works on a case-insensitive file system. Other files,
legacy files included, are never read or touched.

The change is written to temporary names next to the targets and renamed into place;
if any step fails the steps already done are undone. A power cut in the middle of the
renames cannot be ruled out on every file system; originals are then left beside their
places as .NAME.tkr-rename-TOKEN-N.bak. Folders left empty by a move are left in place.

Usage:
  tkr-native-rename --owner-field NAME --plugins-field NAME [options] FOLDER OLD=NEW [OLD=NEW ...]

Required (the spec leaves the link field names open, so they are not assumed):
  --owner-field NAME    top-level field of a plugin document naming its owner's ID
  --plugins-field NAME  top-level field of an owner listing its plugin documents' IDs

Options:
  --ref-field NAME      another top-level field holding an ID or a list of IDs to keep
                        up to date; repeat for several
  --ext .EXT            read files with this extension as documents instead; repeat for
                        several (default: ${REGISTERED})
  --dry-run             print what would change and write nothing
  --json                print one JSON result instead of lines of text
  --help                print this text

An ID that contains "=" cannot be written in the OLD=NEW form.
Exit codes: 0 done, 1 refused (nothing written), 2 usage error, 3 folder not readable,
4 failed and every change undone, 5 failed and some change could not be undone.
`;

type Parsed =
  | {
      readonly ok: true;
      readonly folder: string;
      readonly pairs: readonly RenamePair[];
      readonly config: RenameConfig;
      readonly dryRun: boolean;
      readonly json: boolean;
    }
  | { readonly ok: false; readonly help: boolean; readonly message: string };

const VALUE_OPTIONS: readonly string[] = ["--owner-field", "--plugins-field", "--ref-field", "--ext"];

function parse(argv: readonly string[]): Parsed {
  let ownerField: string | undefined;
  let pluginsField: string | undefined;
  const referenceFields: string[] = [];
  const extensions: string[] = [];
  let dryRun = false;
  let json = false;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") return { ok: false, help: true, message: "" };
    if (argument === "--json") json = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (VALUE_OPTIONS.includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, help: false, message: `${argument} needs a value` };
      index += 1;
      if (argument === "--owner-field") ownerField = value;
      else if (argument === "--plugins-field") pluginsField = value;
      else if (argument === "--ref-field") referenceFields.push(value);
      else extensions.push(value);
    } else if (argument.startsWith("-")) return { ok: false, help: false, message: `unknown option ${argument}` };
    else positional.push(argument);
  }
  if (ownerField === undefined || pluginsField === undefined) {
    return { ok: false, help: false, message: "--owner-field and --plugins-field are required: the link field names are not decided by the spec" };
  }
  const [folder, ...renames] = positional;
  if (folder === undefined) return { ok: false, help: false, message: "give the folder to rename in" };
  if (renames.length === 0) return { ok: false, help: false, message: "give at least one rename, written OLD=NEW" };
  const pairs: RenamePair[] = [];
  for (const rename of renames) {
    const at = rename.indexOf("=");
    if (at <= 0 || at === rename.length - 1) return { ok: false, help: false, message: `${JSON.stringify(rename)} is not a rename: write OLD=NEW` };
    pairs.push({ from: rename.slice(0, at), to: rename.slice(at + 1) });
  }
  const config: RenameConfig = {
    ownerField,
    pluginsField,
    ...(extensions.length === 0 ? {} : { documentExtensions: extensions }),
    ...(referenceFields.length === 0 ? {} : { referenceFields }),
  };
  try {
    validateRenameConfig(config);
  } catch (error) {
    return { ok: false, help: false, message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, folder, pairs, config, dryRun, json };
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function changedLines(plan: RenamePlan): number {
  return plan.edits.reduce((total, edit) => total + edit.changes.length, 0);
}

function planLines(plan: RenamePlan): string[] {
  const moved = new Map(plan.moves.map((move) => [move.from, move.to]));
  const lines: string[] = [];
  for (const move of plan.moves) lines.push(`move ${move.from} -> ${move.to}`);
  for (const edit of plan.edits) {
    const to = moved.get(edit.path);
    lines.push(`edit ${edit.path}${to === undefined ? "" : ` (moved to ${to})`}`);
    for (const change of edit.changes) lines.push(`  line ${change.line}:`, `    - ${change.before}`, `    + ${change.after}`);
  }
  return lines;
}

function summary(plan: RenamePlan, done: boolean): string {
  const text = `${count(plan.moves.length, "document")} moved, ${count(plan.edits.length, "document")} edited (${count(changedLines(plan), "line")} changed)`;
  return done ? `done: ${text}` : `would change: ${text}`;
}

function jsonPlan(plan: RenamePlan): unknown {
  return {
    moves: plan.moves,
    edits: plan.edits.map((edit) => ({ path: edit.path, changes: edit.changes })),
  };
}

function finish(exitCode: CliResult["exitCode"], json: boolean, result: Record<string, unknown>, text: { stdout?: readonly string[]; stderr?: readonly string[] }): CliResult {
  if (json) return { exitCode, stdout: `${JSON.stringify({ schema: RESULT_SCHEMA, ...result }, null, 2)}\n`, stderr: "" };
  const join = (lines: readonly string[] | undefined): string => (lines === undefined || lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  return { exitCode, stdout: join(text.stdout), stderr: join(text.stderr) };
}

function refusedResult(json: boolean, refusals: readonly RenameRefusal[]): CliResult {
  return finish(1, json, { result: "refused", refusals, plan: null }, {
    stderr: [...refusals.map((refusal) => `tkr-native-rename: cannot rename: ${refusal.message}`), "nothing was changed"],
  });
}

function outcomeResult(json: boolean, plan: RenamePlan, outcome: ApplyOutcome): CliResult {
  switch (outcome.status) {
    case "applied": {
      const leftovers = outcome.leftovers.length === 0 ? [] : [`these set-aside originals could not be deleted and can be: ${outcome.leftovers.join(", ")}`];
      return finish(0, json, { result: "applied", plan: jsonPlan(plan), leftovers: outcome.leftovers }, { stdout: [...planLines(plan), summary(plan, true), ...leftovers] });
    }
    case "refused":
      return finish(1, json, { result: "refused", refusals: outcome.reasons.map((message) => ({ code: "not-applicable", message })), plan: jsonPlan(plan) }, {
        stderr: [...outcome.reasons.map((reason) => `tkr-native-rename: cannot rename: ${reason}`), "nothing was changed"],
      });
    case "restored":
      return finish(4, json, { result: "restored", error: outcome.error, plan: jsonPlan(plan) }, {
        stderr: [`tkr-native-rename: the rename failed: ${outcome.error}`, "every change was undone: no file in the project has changed"],
      });
    case "unrestored":
      return finish(5, json, { result: "unrestored", error: outcome.error, problems: outcome.problems, plan: jsonPlan(plan) }, {
        stderr: [
          `tkr-native-rename: the rename failed: ${outcome.error}`,
          "some changes could not be undone, so the project may be partly changed:",
          ...outcome.problems.map((problem) => `  ${problem}`),
          "the originals of edited documents wait beside their places as .NAME.tkr-rename-TOKEN-N.bak",
        ],
      });
  }
}

export function runCli(argv: readonly string[], options: ApplyOptions = {}): CliResult {
  const parsed = parse(argv);
  if (!parsed.ok) {
    if (parsed.help) return { exitCode: 0, stdout: HELP, stderr: "" };
    return { exitCode: 2, stdout: "", stderr: `tkr-native-rename: ${parsed.message}\n\n${HELP}` };
  }
  const root = resolve(parsed.folder);
  try {
    if (!statSync(root).isDirectory()) throw new Error("not a folder");
  } catch (error) {
    return { exitCode: 3, stdout: "", stderr: `tkr-native-rename: cannot read the folder ${parsed.folder}: ${error instanceof Error ? error.message : String(error)}\n` };
  }
  let documents;
  try {
    documents = collectDocuments(root, parsed.config.documentExtensions);
  } catch (error) {
    return { exitCode: 3, stdout: "", stderr: `tkr-native-rename: cannot read ${parsed.folder}: ${error instanceof Error ? error.message : String(error)}\n` };
  }
  const planned = planRename(documents, parsed.pairs, parsed.config);
  if (!planned.ok) return refusedResult(parsed.json, planned.refusals);
  const { plan } = planned;
  if (parsed.dryRun) {
    const reasons = checkApplicable(root, documents, plan, options);
    if (reasons.length > 0) return outcomeResult(parsed.json, plan, { status: "refused", reasons });
    return finish(0, parsed.json, { result: "dry-run", plan: jsonPlan(plan) }, {
      stdout: ["dry run: nothing is written", ...planLines(plan), summary(plan, false)],
    });
  }
  return outcomeResult(parsed.json, plan, applyPlan(root, documents, plan, options));
}
