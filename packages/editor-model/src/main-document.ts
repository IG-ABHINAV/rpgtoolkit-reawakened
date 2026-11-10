import { BinaryReader, readMainFile, writeMainFile, type FormatError, type MainFile } from "@tk-reawakened/core";
import type { FileSystemService, PlatformError } from "@tk-reawakened/platform-services";
import type { DocumentIdentity } from "./identity.ts";

/**
 * The `.gam` document of ADR 0022 D2: a binary document is **bytes plus a serialisable command stack**. The bytes are
 * what the file held when it was opened; the commands are plain data, so the current model is always the opened model
 * with the applied commands replayed over it. The model is the one `readMainFile` returns, so the minor version and the
 * unknown residue it keeps (AD-18) are carried untouched, and `writeMainFile` puts every datum the commands did not
 * touch back byte for byte.
 */

/** The one edit the tracer offers: set the game title (`docs/spec/formats/main-file.md#layout`, row 7, `gameTitle`). */
export interface SetGameTitleCommand {
  readonly type: "set-game-title";
  readonly title: string;
}

/** Every command a main-file document accepts. Plain data, so a stack of them can be stored and replayed. */
export type MainCommand = SetGameTitleCommand;

/** An accepted command with the id the host undoes it by (AD-19) and the words an undo menu shows. */
export interface EditRecord {
  readonly editId: string;
  readonly label: string;
  readonly command: MainCommand;
}

/** Why a document can be viewed but never edited (ADR 0022 D2.1). */
export interface ReadOnlyReason {
  readonly code: "no-same-version-writer";
  readonly message: string;
}

/** What a failed save reports: it names the document and says why (ADR 0022 D3.3). */
export interface SaveFailure {
  /** The document's project-relative path. */
  readonly document: string;
  /** `write`: the host refused the bytes; `format`: the model could not be encoded; `read-only`: no writer exists. */
  readonly kind: "write" | "format" | "read-only";
  /** The host's error code when `kind` is `write`. */
  readonly code: PlatformError["code"] | null;
  /** One sentence naming the document and the cause, safe to show. */
  readonly message: string;
}

/** An immutable view of the document at one moment. A new object is made for every change; an unchanged document returns the same object. */
export interface MainDocumentSnapshot {
  readonly identity: DocumentIdentity;
  /** The minor version the file was opened at and is saved at (AD-18). */
  readonly minor: number;
  /** The game title as the model holds it now, saved or not. */
  readonly gameTitle: string;
  /** True when the applied commands differ from what was last saved (ADR 0022 D3.2). */
  readonly dirty: boolean;
  /** Non-null when the document can only be viewed (D2.1). */
  readonly readOnly: ReadOnlyReason | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The applied commands, oldest first. The last one's `editId` is the one the host undoes (AD-19). */
  readonly edits: readonly EditRecord[];
  readonly saving: boolean;
  /** The last save's failure, kept until a later save starts; the edits it could not write stay in the model (D3.3). */
  readonly saveError: SaveFailure | null;
}

/** Why a command was refused. A refused command changes nothing (ADR 0022 D3.1). */
export interface Rejection {
  readonly reason: "read-only" | "invalid";
  readonly message: string;
}

export type ApplyResult =
  | { readonly ok: true; readonly editId: string }
  | { readonly ok: false; readonly rejection: Rejection };

export type HistoryResult =
  | { readonly ok: true; readonly editId: string }
  | { readonly ok: false; readonly reason: "nothing-to-undo" | "nothing-to-redo" | "stale-edit" | "read-only" };

export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly failure: SaveFailure };

/** The document a view binds to: `getSnapshot()` and `subscribe()` (ADR 0025 decision 4), and the commands. */
export interface MainDocument {
  readonly identity: DocumentIdentity;
  getSnapshot(): MainDocumentSnapshot;
  /** Call `listener` after every change to the snapshot; the returned function removes it. */
  subscribe(listener: () => void): () => void;
  /** Accept `command` whole or refuse it whole. */
  apply(command: MainCommand): ApplyResult;
  /** Undo the latest applied edit. With `editId`, only that edit, and only while it is still the latest (AD-19). */
  undo(editId?: string): HistoryResult;
  /** Redo the latest undone edit. With `editId`, only that edit. */
  redo(editId?: string): HistoryResult;
  /**
   * Write the current model through the host and mark the document clean only when the host reports the bytes written
   * (ADR 0022 D3.3). Edits made while the write is in flight stay dirty. Saves run one after another.
   */
  save(): Promise<SaveResult>;
}

/** The slice of `platform-services` `fs` a document needs. */
export type DocumentStorage = Pick<FileSystemService, "read" | "write">;

export type OpenError =
  /** The host could not read the file. */
  | { readonly kind: "read"; readonly document: string; readonly error: PlatformError }
  /** The bytes are not a main file this reader accepts (the reader's located error, AD-18); the document is not opened at all. */
  | { readonly kind: "format"; readonly document: string; readonly error: FormatError };

export type OpenResult =
  | { readonly ok: true; readonly document: MainDocument }
  | { readonly ok: false; readonly error: OpenError };

/** Read the file at `identity.path` through `storage` and open it. */
export async function openMainDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<OpenResult> {
  const read = await storage.read(identity.path);
  if (!read.ok) return { ok: false, error: { kind: "read", document: identity.path, error: read.error } };
  return createMainDocument(storage, identity, read.value);
}

/**
 * Open a document over bytes already in hand. The bytes are read with `readMainFile`; a file it refuses is not opened.
 * A file it reads is then written back once, in memory: if the writer does not give the same bytes — a text-era main
 * file, which has no binary writer, or any layout the writer would change — the document opens **read-only** with the
 * reason, because a read-write open needs a same-version writer and the editor never converts on open (ADR 0022 D2.1).
 */
export function createMainDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): OpenResult {
  const opened = bytes.slice();
  const read = readMainFile(new BinaryReader(opened, identity.path));
  if (!read.ok) return { ok: false, error: { kind: "format", document: identity.path, error: read.error } };
  return { ok: true, document: new MainDocumentImpl(storage, identity, read.value, readOnlyReason(read.value, opened)) };
}

/** `null` when the writer reproduces `bytes` exactly, which is what a same-version writer means for this file. */
function readOnlyReason(model: MainFile, bytes: Uint8Array): ReadOnlyReason | null {
  const written = writeMainFile(model);
  if (!written.ok) {
    return {
      code: "no-same-version-writer",
      message: `This main file (minor ${model.minor}) has no writer that keeps its version: ${written.error.message}`,
    };
  }
  const first = firstDifference(written.value, bytes);
  if (first === null) return null;
  return {
    code: "no-same-version-writer",
    message: `The writer does not reproduce this main file (minor ${model.minor}) byte for byte; the first difference is at offset ${first}.`,
  };
}

function firstDifference(a: Uint8Array, b: Uint8Array): number | null {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) if (a[index] !== b[index]) return index;
  return a.length === b.length ? null : shared;
}

/** Apply one command to a model. Pure: the same model and command give the same result. */
function applyCommand(model: MainFile, command: MainCommand): MainFile {
  return { ...model, gameTitle: command.title };
}

function labelOf(command: MainCommand): string {
  return `Set game title to "${command.title}"`;
}

class MainDocumentImpl implements MainDocument {
  readonly identity: DocumentIdentity;
  readonly #storage: DocumentStorage;
  readonly #base: MainFile;
  readonly #readOnly: ReadOnlyReason | null;
  readonly #listeners = new Set<() => void>();
  /** Every command ever accepted and not discarded: `#applied` of them are in force, the rest can be redone. */
  #stack: EditRecord[] = [];
  #applied = 0;
  /** How many commands were in force when the file was last written, or `null` when that state can no longer be reached. */
  #savedAt: number | null = 0;
  #nextId = 1;
  #model: MainFile;
  /** Saves asked for and not yet finished. */
  #pending = 0;
  #saveError: SaveFailure | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #snapshot: MainDocumentSnapshot;

  constructor(storage: DocumentStorage, identity: DocumentIdentity, model: MainFile, readOnly: ReadOnlyReason | null) {
    this.identity = identity;
    this.#storage = storage;
    this.#base = model;
    this.#model = model;
    this.#readOnly = readOnly;
    this.#snapshot = this.#makeSnapshot();
  }

  getSnapshot(): MainDocumentSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  apply(command: MainCommand): ApplyResult {
    if (this.#readOnly !== null) {
      return { ok: false, rejection: { reason: "read-only", message: this.#readOnly.message } };
    }
    const next = applyCommand(this.#model, command);
    const refusal = refusalOf(next, command);
    if (refusal !== null) return { ok: false, rejection: refusal };
    const record: EditRecord = { editId: `edit-${this.#nextId}`, label: labelOf(command), command };
    this.#nextId += 1;
    // A new command discards what could have been redone; a saved state inside the discarded part can never be reached again.
    this.#stack = [...this.#stack.slice(0, this.#applied), record];
    if (this.#savedAt !== null && this.#savedAt > this.#applied) this.#savedAt = null;
    this.#applied += 1;
    this.#model = next;
    this.#publish();
    return { ok: true, editId: record.editId };
  }

  undo(editId?: string): HistoryResult {
    if (this.#readOnly !== null) return { ok: false, reason: "read-only" };
    const latest = this.#stack[this.#applied - 1];
    if (latest === undefined) return { ok: false, reason: "nothing-to-undo" };
    if (editId !== undefined && editId !== latest.editId) return { ok: false, reason: "stale-edit" };
    this.#applied -= 1;
    this.#model = this.#replay();
    this.#publish();
    return { ok: true, editId: latest.editId };
  }

  redo(editId?: string): HistoryResult {
    if (this.#readOnly !== null) return { ok: false, reason: "read-only" };
    const next = this.#stack[this.#applied];
    if (next === undefined) return { ok: false, reason: "nothing-to-redo" };
    if (editId !== undefined && editId !== next.editId) return { ok: false, reason: "stale-edit" };
    this.#applied += 1;
    this.#model = this.#replay();
    this.#publish();
    return { ok: true, editId: next.editId };
  }

  save(): Promise<SaveResult> {
    const path = this.identity.path;
    if (this.#readOnly !== null) {
      return Promise.resolve(
        this.#failNow({ document: path, kind: "read-only", code: null, message: `${path} is read-only: ${this.#readOnly.message}` }),
      );
    }
    // The revision this save writes is fixed now, when it is asked for: the commands in force, identified by the last
    // one's id, and the bytes they make. Edits made after this call are not part of it and stay dirty (ADR 0022 D3.3).
    const revision = this.#applied;
    const head = this.#stack[revision - 1]?.editId ?? null;
    const encoded = writeMainFile(this.#model);
    if (!encoded.ok) {
      return Promise.resolve(
        this.#failNow({ document: path, kind: "format", code: null, message: `Could not save ${path}: ${encoded.error.message}` }),
      );
    }
    const bytes = encoded.value;
    this.#pending += 1;
    this.#publish();
    const run = this.#queue.then(() => this.#write(path, bytes, revision, head));
    this.#queue = run;
    return run;
  }

  async #write(path: string, bytes: Uint8Array, revision: number, head: string | null): Promise<SaveResult> {
    try {
      if (this.#savedAt === revision && this.#isRevision(revision, head)) return { ok: true };
      this.#saveError = null;
      const written = await this.#storage.write(path, bytes);
      if (!written.ok) {
        return this.#fail({
          document: path,
          kind: "write",
          code: written.error.code,
          message: `Could not save ${path}: ${written.error.message}`,
        });
      }
      // Clean only if that revision is still part of the history: an edit made during the write stays dirty, and an
      // undo followed by a different edit during the write means the written state is gone from the history.
      this.#savedAt = this.#isRevision(revision, head) ? revision : null;
      return { ok: true };
    } finally {
      this.#pending -= 1;
      this.#publish();
    }
  }

  /** Whether the commands that were in force at `revision` are still the first `revision` commands of the stack. */
  #isRevision(revision: number, head: string | null): boolean {
    return this.#stack.length >= revision && (this.#stack[revision - 1]?.editId ?? null) === head;
  }

  /** Record a failure that will be published with the rest of the save's outcome. */
  #fail(failure: SaveFailure): SaveResult {
    this.#saveError = failure;
    return { ok: false, failure };
  }

  /** Record a failure of a save that never reached the host, and tell the listeners. */
  #failNow(failure: SaveFailure): SaveResult {
    const result = this.#fail(failure);
    this.#publish();
    return result;
  }

  #replay(): MainFile {
    let model = this.#base;
    for (let index = 0; index < this.#applied; index += 1) {
      const record = this.#stack[index];
      if (record !== undefined) model = applyCommand(model, record.command);
    }
    return model;
  }

  #makeSnapshot(): MainDocumentSnapshot {
    return {
      identity: this.identity,
      minor: this.#model.minor,
      gameTitle: this.#model.gameTitle,
      dirty: this.#savedAt !== this.#applied,
      readOnly: this.#readOnly,
      canUndo: this.#readOnly === null && this.#applied > 0,
      canRedo: this.#readOnly === null && this.#applied < this.#stack.length,
      edits: this.#stack.slice(0, this.#applied),
      saving: this.#pending > 0,
      saveError: this.#saveError,
    };
  }

  #publish(): void {
    this.#snapshot = this.#makeSnapshot();
    for (const listener of [...this.#listeners]) listener();
  }
}

/**
 * Refuse a command whose result the writer could not store or the reader would not give back: the model is encoded and
 * read again, and the title must come back as it went in (a character with no Windows-1252 byte, or a NUL that would end
 * the stored string early, fails here, whole, before the document changes).
 */
function refusalOf(next: MainFile, command: MainCommand): Rejection | null {
  const written = writeMainFile(next);
  if (!written.ok) return { reason: "invalid", message: written.error.message };
  const reread = readMainFile(new BinaryReader(written.value));
  if (!reread.ok || reread.value.gameTitle !== command.title) {
    return { reason: "invalid", message: "The game title cannot be stored in the file exactly as typed." };
  }
  return null;
}
