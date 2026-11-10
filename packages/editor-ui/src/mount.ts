import type { MainDocument } from "@tk-reawakened/editor-model";
import type { PlatformServices } from "@tk-reawakened/platform-services";
import { createElement, render } from "preact";
import { SettingsView } from "./settings-view.tsx";

/** What a host gives a view when it mounts it (ADR 0025 decision 4). */
export interface ViewContext {
  /** The document the view shows and edits. The view never owns it: disposing the view leaves it, and its undo stack, as it was (ADR 0022 D3.7). */
  readonly document: MainDocument;
  /** The host door; the view uses only `document.edited` (AD-19, AD-20). */
  readonly services: Pick<PlatformServices, "document">;
}

/** The handle a host keeps to a mounted view. */
export interface ViewHandle {
  /** Remove the view from the page and everything it subscribed to. Calling it again does nothing. */
  dispose(): void;
}

/** Render the settings view into `el`. */
export function mount(el: HTMLElement, ctx: ViewContext): ViewHandle {
  render(createElement(SettingsView, { doc: ctx.document, onEdited: (event) => ctx.services.document.edited(event) }), el);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, el);
    },
  };
}
