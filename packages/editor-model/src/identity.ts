import { foldPath, toSlashes } from "@tk-reawakened/core";

/**
 * The identity of a document (ADR 0022 D1): the **project handle** the host supplied and the **project-relative path**
 * with `/` separators, compared **ASCII-folded**. The host-native location behind the handle is never visible here.
 */
export interface DocumentIdentity {
  /** The host's project handle (`ProjectHandle.id`). */
  readonly projectId: string;
  /** The project-relative path with `/` separators, with its case kept for the file system. */
  readonly path: string;
  /**
   * Equal for two identities exactly when they name the same document: the handle and the ASCII-folded path, each
   * length-prefixed so no handle can be re-split into a path (the shape `derivePackageIdentity` uses for the same
   * reason). A path that folds to an existing document's key opens that document (D1.2).
   */
  readonly key: string;
}

/** The identity of the document at `path` in the project `projectId`; `\` in `path` is read as `/` (D1.1). */
export function createDocumentIdentity(projectId: string, path: string): DocumentIdentity {
  const slashed = toSlashes(path);
  const folded = foldPath(slashed);
  return { projectId, path: slashed, key: `${projectId.length}:${projectId}:${folded.length}:${folded}` };
}
