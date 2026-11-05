/** Host capability and measured display inputs (docs/spec/engine/host-capabilities-and-viewports.md#state-and-input-records). */
export type HostFeatures = {
  readonly touch?: boolean;
  readonly pointer?: "fine" | "coarse" | "none";
  readonly keyboard?: boolean;
  readonly gamepad?: boolean;
  readonly haptics?: boolean;
  readonly orientation?: "landscape" | "portrait" | null;
};

export type NormalizedHostFeatures = {
  readonly touch: boolean;
  readonly pointer: "fine" | "coarse" | "none";
  readonly keyboard: boolean;
  readonly gamepad: boolean;
  readonly haptics: boolean;
  readonly orientation: "landscape" | "portrait" | null;
};

export type HostDisplayGeometry = {
  readonly content: { readonly width: number; readonly height: number };
  readonly game: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly safeArea: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
};
