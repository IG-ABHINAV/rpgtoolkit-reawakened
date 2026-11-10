import type { FileSystemService } from "./fs.ts";
import type { PlatformResult } from "./result.ts";

/**
 * What a host can and cannot do (AD-20: "Each host declares a `capabilities` set"). `editor-ui` degrades by capability
 * instead of testing which host it runs in.
 */
export type Capability =
  /** The OS can open project files in this editor (T-82). */
  | "fileAssociation"
  /** The host can write into the project folder; without it, saving means a download (ADR 0022 D5.2). */
  | "folderWrite"
  /** `fs.watch` works (ADR 0022 D3.5). */
  | "fileWatch"
  /** The host gives a project handle that survives a restart; without it the project is a session copy (ADR 0022 D1.4). */
  | "stableProjectHandle"
  /** The host has source control to show (ADR 0022 D13.1). */
  | "scm";

/** The set of capabilities a host declares. */
export type Capabilities = ReadonlySet<Capability>;

/** One project the host has open or remembers. `id` is the project handle of ADR 0022 D1.1 and is opaque. */
export interface ProjectHandle {
  readonly id: string;
  /** What to call the project in the interface, for example its folder name. */
  readonly name: string;
}

/** The `project` surface of AD-20: `open`, `recent`. */
export interface ProjectService {
  /** Let the user choose a project and make it the one `fs` works in. A cancelled choice is `unavailable`. */
  open(): Promise<PlatformResult<ProjectHandle>>;
  /** The projects the host remembers, most recent first. */
  recent(): Promise<PlatformResult<readonly ProjectHandle[]>>;
}

/** A value an editor setting can hold (ADR 0022 D6.2: boolean, number, string, and lists of those). */
export type SettingValue = boolean | number | string | readonly SettingValue[];

/** The layers a host stores (ADR 0022 D6.3). The effective value is worked out above this surface, in shared code. */
export type SettingsLayer = "user" | "project";

/** The `settings` surface of AD-20: where each layer's own values are kept. Authored game data never goes here (D6.1). */
export interface SettingsService {
  /** The value stored in `layer` for the setting `id`, or `null` when that layer holds none. */
  get(layer: SettingsLayer, id: string): Promise<PlatformResult<SettingValue | null>>;
  /** Store `value` in `layer`; `null` removes the layer's value (a reset, D6.3). */
  set(layer: SettingsLayer, id: string, value: SettingValue | null): Promise<PlatformResult<void>>;
}

/** The `document.edited { editId, label }` message of AD-19, sent for each accepted edit command. */
export interface DocumentEdited {
  /** The document's identity key (ADR 0022 D1). */
  readonly document: string;
  readonly editId: string;
  /** What the edit did, in words for an undo menu. */
  readonly label: string;
}

/** The `document` surface of AD-20 (AD-19): how an editor view tells the host about an edit. Hosts then call `undo(editId)`. */
export interface DocumentService {
  edited(event: DocumentEdited): void;
}

/**
 * The part of AD-20 that story 11.17 needs: `capabilities`, `fs`, `project`, `settings` and `document`.
 *
 * AD-20 also lists `run`, `export`, `dialogs`, `clipboard`, `language.connect()` and `shell.openExternal`. They are not
 * declared yet: AD-20 names their methods but not their parameters, and the entries that first use them (11.3 dialogs,
 * 11.9 run, 11.14 export, the program editor's language client) fix those shapes against a real caller. A host that
 * implements this interface is not asked for them until then.
 */
export interface PlatformServices {
  readonly capabilities: Capabilities;
  readonly fs: FileSystemService;
  readonly project: ProjectService;
  readonly settings: SettingsService;
  readonly document: DocumentService;
}
