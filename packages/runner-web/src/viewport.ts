/** Fit a logical frame with AD-33's integer-first letterboxing, shrinking fractionally only below 1×. */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  available: { readonly width: number; readonly height: number },
): number {
  const ratio = Math.min(available.width / width, available.height / height);
  const scale = ratio >= 1 ? Math.floor(ratio) : ratio;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  return scale;
}
