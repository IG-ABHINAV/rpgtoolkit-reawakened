import type { MainDocument, MainDocumentSnapshot } from "@tk-reawakened/editor-model";
import { useEffect, useState } from "preact/hooks";

/**
 * Bind a component to a document through `getSnapshot()` and `subscribe()` only (ADR 0025 decision 4). The listener is
 * removed when the component unmounts or the document changes, so a disposed view leaves nothing subscribed (ADR 0022 D3.7).
 */
export function useDocumentSnapshot(doc: MainDocument): MainDocumentSnapshot {
  const [snapshot, setSnapshot] = useState(doc.getSnapshot());
  useEffect(() => {
    // A change between the render and this effect would otherwise be missed.
    setSnapshot(doc.getSnapshot());
    return doc.subscribe(() => setSnapshot(doc.getSnapshot()));
  }, [doc]);
  return snapshot;
}
