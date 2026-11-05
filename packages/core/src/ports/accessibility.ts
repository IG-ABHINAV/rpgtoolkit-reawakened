/** Plain-data accessibility output built from the same deterministic UI state as the draw list. */
export type AccessibilityRole =
  | "surface" | "menu" | "menuitem" | "dialog" | "message" | "button"
  | "list" | "listitem" | "text" | "label" | "status" | "image" | "heading";

export type AccessibilityNode = {
  readonly id: string;
  readonly role: AccessibilityRole;
  readonly label: string;
  readonly value: string | null;
  readonly state: { readonly disabled: boolean; readonly selected: boolean; readonly checked: boolean | null };
  readonly focused: boolean;
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly children: readonly AccessibilityNode[];
};
