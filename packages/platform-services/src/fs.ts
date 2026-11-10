import type { Disposable, PlatformResult } from "./result.ts";

/**
 * The `fs` surface of AD-20: `list`, `read`, `write`, `stat`, `delete`, `rename`, `watch`.
 *
 * Every path is **project-relative with `/` separators**, with no leading `/`, no `.` or `..` segment and no empty
 * segment; `""` names the project root, and only `list`, `stat` and `watch` accept it. This is the identity form of
 * ADR 0022 D1.1 before it is ASCII-folded for comparison. A host that is handed anything else answers `invalid-path`.
 * The project is the one the host's `project` service last opened; the host-native location behind it is not visible
 * here (ADR 0022 D1.1).
 */
export interface FileSystemService {
  /** The entries directly inside the folder `path`, in no promised order. */
  list(path: string): Promise<PlatformResult<readonly DirectoryEntry[]>>;
  /** The whole file as bytes. */
  read(path: string): Promise<PlatformResult<Uint8Array>>;
  /**
   * Replace the file's content with `bytes`, creating the file (and any missing folder) when it does not exist. The
   * result is `ok` only when the host reports the bytes durably written (ADR 0022 D3.3); a failed write leaves the
   * previous content in place or reports it did not.
   */
  write(path: string, bytes: Uint8Array): Promise<PlatformResult<void>>;
  /** The kind, size and modification time of a file or folder. */
  stat(path: string): Promise<PlatformResult<FileStat>>;
  /** Remove a file, or a folder and everything in it. */
  delete(path: string): Promise<PlatformResult<void>>;
  /** Move a file or folder to a path that does not exist yet. */
  rename(from: string, to: string): Promise<PlatformResult<void>>;
  /**
   * Call `onChange` for each change below `path` until the returned handle is disposed. A host that cannot observe
   * files answers `unavailable` and does not list `fileWatch` among its capabilities (ADR 0022 D3.5).
   */
  watch(path: string, onChange: (change: FileChange) => void): Promise<PlatformResult<Disposable>>;
}

/** What a path names. */
export type FileKind = "file" | "directory";

/** One child of a folder. */
export interface DirectoryEntry {
  /** The final path segment, as stored (case kept). */
  readonly name: string;
  readonly kind: FileKind;
}

/** What `stat` reports. */
export interface FileStat {
  readonly kind: FileKind;
  /** The size in bytes; `0` for a folder. */
  readonly size: number;
  /** The last modification, in milliseconds since the epoch of the host's clock. */
  readonly modifiedMs: number;
}

/** One observed change. */
export interface FileChange {
  readonly kind: "created" | "changed" | "deleted";
  /** The project-relative path of the file or folder that changed, as the host stores it. */
  readonly path: string;
}
