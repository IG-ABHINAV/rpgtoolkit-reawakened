// The editor's views (ADR 0025). A view is handed to a host as `mount(el, ctx) -> { dispose }`; the host owns the
// element and the document, the view owns only what it renders into `el`.
export { mount, type ViewContext, type ViewHandle } from "./mount.ts";
