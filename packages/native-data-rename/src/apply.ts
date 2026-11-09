/**
 * The executor of a rename plan: the only place in the rename tool that writes
 * (docs/spec/formats/native-contracts.md#rename).
 *
 * The plan comes from the pure planner in `native-data`. It names the files to move and the
 * documents whose text changes. This module applies it all or not at all, in four phases:
 *
 *  1. Inspect, writing nothing. Every file the plan touches is read again and must be what the
 *     plan was made from; every target must be free and its folders usable. Any problem refuses
 *     the rename here, before a single file has changed.
 *  2. Stage. The new folders, and the new text of every edited document under a temporary name
 *     next to its final place, are created. No existing name has changed yet. This is the phase
 *     that needs free space, and it cannot hurt: it only adds temporary names.
 *  3. Commit, by renames alone. Every original is renamed aside, then every new file is renamed
 *     into place (a moved document that is not edited is its own original, renamed to its new
 *     path). Each step is recorded, and a failure undoes the recorded steps in reverse order. The
 *     commit needs no free space, and "move everything aside first" is what makes a swap of two
 *     names, a chain and a case-only rename (`Guard.tkract` to `guard.tkract`, one file to a
 *     case-insensitive file system) work: the old name is always free before the new one is taken.
 *  4. Clean up: the set-aside originals of the edited documents are deleted.
 *
 * The guarantee, and its limits, are in the spec's Rename section. In short: a failure of any
 * operation before phase 4 leaves every file as it was, byte for byte, with no temporary names
 * left; the undo itself can fail, and then the result says exactly which steps it could not undo;
 * a process killed or a power cut during phase 3 can leave the project half changed, with the
 * originals still on disk next to their places under the name `.NAME.tkr-rename-TOKEN-N.bak`.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DocumentInput, RenamePlan } from "@tk-reawakened/native-data";

/** What the executor needs to know about an existing path. */
export type FileInfo = {
  readonly kind: "file" | "directory" | "other";
  /** With `ino`, the identity of the file: two names of one file share it. */
  readonly dev: bigint;
  readonly ino: bigint;
  /** The permission bits. */
  readonly mode: number;
};

/**
 * Every file system operation the executor uses. It is a seam so that a test can make any one
 * of them fail; nothing else in this package touches the file system, except the folder walk
 * `collectDocuments`, which only reads.
 */
export type RenameFs = {
  /** `null` when nothing is at the path; a symbolic link is `other`, never followed. */
  info(path: string): FileInfo | null;
  read(path: string): Uint8Array;
  /** Create a new file that must not exist yet, with exactly these permission bits. A failure leaves no file behind. */
  create(path: string, bytes: Uint8Array, mode: number): void;
  /** Rename, replacing whatever is at `to`: the caller has checked that nothing is. */
  rename(from: string, to: string): void;
  remove(path: string): void;
  makeFolder(path: string): void;
  removeFolder(path: string): void;
};

export const nodeFs: RenameFs = {
  info(path) {
    try {
      const stat = lstatSync(path, { bigint: true });
      return {
        kind: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
        dev: stat.dev,
        ino: stat.ino,
        mode: Number(stat.mode & 0o7777n),
      };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  },
  read: (path) => readFileSync(path),
  create(path, bytes, mode) {
    const descriptor = openSync(path, "wx", mode);
    try {
      let written = 0;
      while (written < bytes.length) written += writeSync(descriptor, bytes, written);
      closeSync(descriptor);
      chmodSync(path, mode);
    } catch (error) {
      try {
        closeSync(descriptor);
      } catch {
        // Already closed above, or closing failed too: the file is removed either way.
      }
      unlinkSync(path);
      throw error;
    }
  },
  rename: renameSync,
  remove: unlinkSync,
  makeFolder: (path) => mkdirSync(path),
  removeFolder: rmdirSync,
};

export type ApplyOptions = {
  /** Default: the real file system. */
  readonly fs?: RenameFs;
  /** Makes the temporary names. Default: random. A test sets it to know them. */
  readonly token?: string;
};

export type ApplyOutcome =
  /** Done. `leftovers` are the set-aside originals that could not be deleted; the rename is complete without them. */
  | { readonly status: "applied"; readonly moved: number; readonly edited: number; readonly leftovers: readonly string[] }
  /** Nothing was written: the inspection found these reasons. */
  | { readonly status: "refused"; readonly reasons: readonly string[] }
  /** An operation failed and every change was undone: the project is as it was. */
  | { readonly status: "restored"; readonly error: string }
  /** An operation failed and these steps could not be undone: the project may be partly changed. */
  | { readonly status: "unrestored"; readonly error: string; readonly problems: readonly string[] };

type Step = {
  readonly index: number;
  /** Project-relative, `/` separated. */
  readonly source: string;
  readonly target: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  /** Where the original waits during the commit. */
  readonly asidePath: string;
  /** The edited document's new content, staged here; `null` for a move with no edit. */
  readonly stagedPath: string | null;
  readonly bytes: Uint8Array | null;
  readonly mode: number;
};

type Inspected = { readonly ok: true; readonly steps: readonly Step[]; readonly folders: readonly string[] } | { readonly ok: false; readonly reasons: readonly string[] };

const BOM = [0xef, 0xbb, 0xbf] as const;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const identity = (info: FileInfo): string => `${info.dev}:${info.ino}`;

/**
 * Phase 1: read-only. The plan was made from `documents`; every file it touches must still hold
 * exactly that text, every target must be free (or be a file the plan moves away), and every
 * folder on the way must be a real folder or not exist yet.
 */
function inspect(root: string, documents: readonly DocumentInput[], plan: RenamePlan, fs: RenameFs, token: string): Inspected {
  const reasons: string[] = [];
  try {
    const snapshot = new Map(documents.map((input) => [input.path, "text" in input ? input.text : null]));
    const edits = new Map(plan.edits.map((edit) => [edit.path, edit]));
    const moves = new Map(plan.moves.map((move) => [move.from, move.to]));
    const sources = [...new Set([...moves.keys(), ...edits.keys()])].sort();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const encoder = new TextEncoder();

    const steps: Step[] = [];
    const moving = new Set<string>();
    for (const [index, source] of sources.entries()) {
      const sourcePath = join(root, source);
      const info = fs.info(sourcePath);
      if (info === null || info.kind !== "file") {
        reasons.push(`${source} is no longer a file, so the rename was not applied`);
        continue;
      }
      const original = fs.read(sourcePath);
      let current: string | null;
      try {
        current = decoder.decode(original);
      } catch {
        current = null;
      }
      if (current === null || current !== snapshot.get(source)) {
        reasons.push(`${source} changed after it was read, so the rename was not applied`);
        continue;
      }
      moving.add(identity(info));
      const edit = edits.get(source);
      const target = moves.get(source) ?? source;
      const targetPath = join(root, target);
      const encoded = edit === undefined ? null : encoder.encode(edit.after);
      // The planner works on decoded text, which has no byte order mark; a document that had one keeps it.
      const hasBom = BOM.every((byte, at) => original[at] === byte);
      steps.push({
        index,
        source,
        target,
        sourcePath,
        targetPath,
        asidePath: join(dirname(sourcePath), `.${basename(sourcePath)}.tkr-rename-${token}-${index}.bak`),
        stagedPath: encoded === null ? null : join(dirname(targetPath), `.${basename(targetPath)}.tkr-rename-${token}-${index}.new`),
        bytes: encoded === null ? null : hasBom ? Uint8Array.from([...BOM, ...encoded]) : encoded,
        mode: info.mode,
      });
    }

    const folders = new Set<string>();
    for (const step of steps) {
      if (fs.info(step.asidePath) !== null) reasons.push(`${basename(step.asidePath)} already exists next to ${step.source}, so the rename was not applied`);
      if (step.target === step.source) continue;
      const parts = step.target.split("/");
      let blocked = false;
      for (let depth = 1; depth < parts.length; depth += 1) {
        const folder = parts.slice(0, depth).join("/");
        const info = fs.info(join(root, folder));
        if (info === null) {
          // This folder and every one below it are new.
          for (let deeper = depth; deeper < parts.length; deeper += 1) folders.add(parts.slice(0, deeper).join("/"));
          break;
        }
        if (info.kind !== "directory") {
          reasons.push(`${folder} is not a folder, so ${step.source} cannot be moved to ${step.target}`);
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const existing = fs.info(step.targetPath);
      if (existing !== null && !moving.has(identity(existing))) {
        reasons.push(`${step.target} already exists, so ${step.source} cannot be moved there`);
      }
    }
    if (reasons.length > 0) return { ok: false, reasons };
    const ordered = [...folders].sort((left, right) => left.split("/").length - right.split("/").length || (left < right ? -1 : 1));
    return { ok: true, steps, folders: ordered };
  } catch (error) {
    return { ok: false, reasons: [...reasons, `the project could not be examined: ${messageOf(error)}`] };
  }
}

/**
 * Everything the rename would refuse on, found without writing: the plan's files and targets are
 * checked against the file system as they are now. Empty means the apply would start.
 */
export function checkApplicable(root: string, documents: readonly DocumentInput[], plan: RenamePlan, options: ApplyOptions = {}): readonly string[] {
  const inspected = inspect(root, documents, plan, options.fs ?? nodeFs, options.token ?? "check");
  return inspected.ok ? [] : inspected.reasons;
}

type Undo = { readonly describe: string; readonly run: () => void };

/**
 * Apply a plan, all or nothing. `documents` are the texts the plan was made from; a file that no
 * longer holds its text is refused, so a plan is never applied over a change it did not see.
 */
export function applyPlan(root: string, documents: readonly DocumentInput[], plan: RenamePlan, options: ApplyOptions = {}): ApplyOutcome {
  const fs = options.fs ?? nodeFs;
  const token = options.token ?? randomBytes(6).toString("hex");
  const inspected = inspect(root, documents, plan, fs, token);
  if (!inspected.ok) return { status: "refused", reasons: inspected.reasons };
  const { steps, folders } = inspected;

  const journal: Undo[] = [];
  const ensureAbsent = (path: string, name: string): void => {
    if (fs.info(path) !== null) throw new Error(`${name} appeared while the rename was running, so it was not replaced`);
  };
  try {
    // Phase 2: stage. Only new names are made.
    for (const folder of folders) {
      const path = join(root, folder);
      fs.makeFolder(path);
      journal.push({ describe: `remove the folder ${folder}`, run: () => fs.removeFolder(path) });
    }
    for (const step of steps) {
      if (step.stagedPath === null || step.bytes === null) continue;
      const staged = step.stagedPath;
      fs.create(staged, step.bytes, step.mode);
      journal.push({ describe: `delete the staged file ${basename(staged)}`, run: () => fs.remove(staged) });
    }
    // Phase 3: commit, by renames. Every original steps aside, then every new file takes its place.
    for (const step of steps) {
      ensureAbsent(step.asidePath, basename(step.asidePath));
      fs.rename(step.sourcePath, step.asidePath);
      journal.push({ describe: `put ${step.source} back`, run: () => fs.rename(step.asidePath, step.sourcePath) });
    }
    for (const step of steps) {
      ensureAbsent(step.targetPath, step.target);
      if (step.stagedPath === null) {
        fs.rename(step.asidePath, step.targetPath);
        journal.push({ describe: `move ${step.target} back aside`, run: () => fs.rename(step.targetPath, step.asidePath) });
      } else {
        const staged = step.stagedPath;
        fs.rename(staged, step.targetPath);
        journal.push({ describe: `take ${step.target} out again`, run: () => fs.rename(step.targetPath, staged) });
      }
    }
  } catch (error) {
    const problems: string[] = [];
    for (const undo of journal.reverse()) {
      try {
        undo.run();
      } catch (undoError) {
        problems.push(`could not ${undo.describe}: ${messageOf(undoError)}`);
      }
    }
    return problems.length === 0 ? { status: "restored", error: messageOf(error) } : { status: "unrestored", error: messageOf(error), problems };
  }

  // Phase 4: the rename is complete; what is left is the originals of the edited documents.
  const leftovers: string[] = [];
  for (const step of steps) {
    if (step.stagedPath === null) continue;
    try {
      fs.remove(step.asidePath);
    } catch {
      leftovers.push(join(dirname(step.source), basename(step.asidePath)).replaceAll("\\", "/"));
    }
  }
  return { status: "applied", moved: plan.moves.length, edited: plan.edits.length, leftovers };
}
