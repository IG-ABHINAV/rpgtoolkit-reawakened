// The DOM-free, framework-free document model of the editor (AD-19, ADR 0022 D2). It imports `core` for the format
// readers and writers and `platform-services` for the file system door, and nothing else (G2).
export { createDocumentIdentity, type DocumentIdentity } from "./identity.ts";
export {
  createMainDocument,
  openMainDocument,
  type ApplyResult,
  type DocumentStorage,
  type EditRecord,
  type HistoryResult,
  type MainCommand,
  type MainDocument,
  type MainDocumentSnapshot,
  type OpenError,
  type OpenResult,
  type ReadOnlyReason,
  type Rejection,
  type SaveFailure,
  type SaveResult,
  type SetGameTitleCommand,
} from "./main-document.ts";
