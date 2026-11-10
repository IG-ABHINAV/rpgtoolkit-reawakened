/**
 * The error and result shapes of platform-services (AD-20: "Errors are `PlatformError { code, message }`").
 *
 * A host call never throws for a failure the user can meet (a missing file, a refused write, a handle that went away):
 * it returns `{ ok: false, error }`, the way the format readers do (AD-18). The `message` names what failed in plain
 * words and is safe to show; it never carries a credential or a host-native path (ADR 0022 D1.1: the host-native URI is
 * an implementation detail behind this package).
 */

/** Why a platform call failed. A host maps its own errors onto these; it adds none (AD-20: hosts expose one surface). */
export type PlatformErrorCode =
  /** The path or entry does not exist. */
  | "not-found"
  /** The destination exists and the call does not replace it (`rename`). */
  | "already-exists"
  /** A file was named where a folder is needed. */
  | "not-a-directory"
  /** A folder was named where a file is needed. */
  | "is-a-directory"
  /** The host refused the operation (a read-only project, a revoked handle, a locked file). */
  | "permission-denied"
  /** The host cannot do this here (for example a watch in a browser without file observers). */
  | "unavailable"
  /** The path is not a project-relative `/`-separated path (see `FileSystemService`). */
  | "invalid-path"
  /** Any other failure of the underlying storage. */
  | "io-error";

/** `PlatformError { code, message }` of AD-20. */
export interface PlatformError {
  readonly code: PlatformErrorCode;
  readonly message: string;
}

/** The outcome of a platform call: a value, or a `PlatformError`. */
export type PlatformResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PlatformError };

/** A successful platform result. */
export function platformOk<T>(value: T): PlatformResult<T> {
  return { ok: true, value };
}

/** A failed platform result. */
export function platformError(code: PlatformErrorCode, message: string): PlatformResult<never> {
  return { ok: false, error: { code, message } };
}

/** Something a caller must release: a watch, a listener (ADR 0022 D3.7: a view's disposal removes what it added). */
export interface Disposable {
  dispose(): void;
}
