import type { DocumentEdited } from "@tk-reawakened/platform-services";
import type { MainDocument } from "@tk-reawakened/editor-model";
import { useEffect, useId, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

export interface SettingsViewProps {
  readonly doc: MainDocument;
  /** Told about each accepted edit: the `document.edited` message of AD-19. */
  readonly onEdited: (event: DocumentEdited) => void;
}

/**
 * The game settings view; its one field is the game title (`docs/spec/formats/main-file.md#layout`, `gameTitle`).
 * The field edits a draft; leaving the field or pressing Enter commits it as one command. The text shown is the
 * document's, so an edit stays visible after a failed save, and what the document refuses is reported beside the field.
 * Only classes and ARIA attributes are used, never a `style` attribute (ADR 0025 decision 6).
 */
export function SettingsView({ doc, onEdited }: SettingsViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const ids = useId();
  const titleId = `${ids}-title`;
  const stateId = `${ids}-state`;
  const errorId = `${ids}-error`;
  const readOnly = snapshot.readOnly !== null;

  // A title the document changed under the draft (an undo) replaces what was being typed.
  useEffect(() => {
    setDraft(null);
    setRefusal(null);
  }, [snapshot.gameTitle]);

  const commit = (): void => {
    if (draft === null || draft === snapshot.gameTitle) {
      setDraft(null);
      return;
    }
    const result = doc.apply({ type: "set-game-title", title: draft });
    if (result.ok) {
      setDraft(null);
      setRefusal(null);
      const edit = doc.getSnapshot().edits.at(-1);
      onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Set game title" });
    } else {
      setRefusal(result.rejection.message);
    }
  };

  const failure = snapshot.saveError;

  return (
    <section class="tkr-settings" aria-label="Game settings">
      <h2 class="tkr-settings-heading">Game settings</h2>
      {snapshot.readOnly === null ? null : (
        <p class="tkr-settings-readonly" role="note">
          Read only: {snapshot.readOnly.message}
        </p>
      )}
      <div class="tkr-settings-row">
        <label for={titleId}>Game title</label>
        <input
          id={titleId}
          type="text"
          value={draft ?? snapshot.gameTitle}
          readOnly={readOnly}
          aria-describedby={`${stateId}${refusal === null ? "" : ` ${errorId}`}`}
          aria-invalid={refusal === null ? undefined : true}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </div>
      {refusal === null ? null : (
        <p id={errorId} class="tkr-settings-error" role="alert">
          The title was not changed: {refusal}
        </p>
      )}
      <p id={stateId} class="tkr-settings-state" role="status">
        {snapshot.saving ? "Saving…" : snapshot.dirty ? "Unsaved changes" : "All changes saved"}
      </p>
      <button
        type="button"
        class="tkr-settings-save"
        disabled={readOnly || snapshot.saving || (!snapshot.dirty && draft === null)}
        onClick={() => {
          commit();
          void doc.save();
        }}
      >
        Save
      </button>
      {failure === null ? null : (
        <p class="tkr-settings-error" role="alert">
          {failure.message}
        </p>
      )}
    </section>
  );
}
