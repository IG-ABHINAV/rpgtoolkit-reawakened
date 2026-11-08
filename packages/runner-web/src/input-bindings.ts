/** Interactive player bindings; Space keeps its literal key name for wait/get and cursor maps. */
export const INTERACTIVE_INPUT_BINDINGS = {
  keys: {
    Enter: "ENTER",
    Escape: "ESC",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    KeyW: "up",
    KeyS: "down",
    KeyA: "left",
    KeyD: "right",
    Space: " ",
  },
};

/** Keep ordinary script key names while identifying the configured physical menu key. */
export function interactiveMenuBinding(menuKey: number): {
  readonly bindings: typeof INTERACTIVE_INPUT_BINDINGS;
  readonly menuKey: { readonly action: string; readonly code: string };
} {
  const key = menuKey === 0 ? 13 : menuKey;
  const character = String.fromCharCode(key).toUpperCase();
  const code = key === 13 ? "Enter" : key === 27 ? "Escape" : key === 32 ? "Space" :
    /^[A-Z]$/.test(character) ? `Key${character}` : character;
  const action = INTERACTIVE_INPUT_BINDINGS.keys[code as keyof typeof INTERACTIVE_INPUT_BINDINGS.keys] ?? character;
  return { bindings: { keys: { ...INTERACTIVE_INPUT_BINDINGS.keys, [code]: action } }, menuKey: { action, code } };
}
