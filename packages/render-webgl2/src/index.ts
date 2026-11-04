/**
 * The WebGL2 draw-list replayer (AD-3, AD-4, AD-27, AD-33; guard-rail G4).
 *
 * A renderer receives a `DrawList` and produces pixels. It owns no loop, no game state and no game logic, and every
 * cache it keeps can be flushed between frames without changing a pixel (G4 rule 3). What it carries is AD-3's pixel
 * pipeline — colour-key exclusion on the untinted source, the R-15 tint remap, `clamp(src + tint, 0, 255)`, and the
 * three blends — and the geometry decisions the core shares with it through `core/raster`'s leaves:
 * `linePixels`/`rectOutlinePixels`/`ellipsePixels` for the one-pixel shapes, `isoSourceOffset` for the `.iso`
 * projection, and `textInk` for a text run's covered pixels and their coverage.
 *
 * The agreement bound with the reference rasteriser is D-7: exact on key, tint and blend choice, at most one unit per
 * channel on blend arithmetic. Glyph coverage is blend arithmetic; the browser lane reports its worst channel.
 *
 * Presentation (AD-33) is a viewport decision, never a game-state one: the draw list is always drawn at its logical
 * resolution, and `letterbox` scales that viewport by an integer factor with black bars, while `expand` shows the
 * logical area at 1:1 and leaves the rest of the canvas black.
 */

import {
  ellipsePixels,
  isoSourceOffset,
  linePixels,
  rectOutlinePixels,
  textInk,
  type RasterAsset,
} from "@tk-reawakened/core";
import type { AssetKey, DrawList, SurfaceId, TextCommand } from "@tk-reawakened/core";

/** Decoded straight RGBA pixels, the shape `core/formats/image` produces and `surfacePixels` returns. */
export type TexturePixels = {
  readonly w: number;
  readonly h: number;
  readonly rgba: Uint8Array;
};

/** Where the renderer gets an asset's decoded pixels; `null` means the host cannot supply it. */
export type TextureProvider = (asset: AssetKey) => TexturePixels | null;
/** Where the renderer gets a surface's pixels at a revision (AD-27); `null` for an unknown or stale revision. */
export type SurfaceProvider = (id: SurfaceId, rev: number) => TexturePixels | null;
/** Where the renderer gets a font asset (`LegacyFont`, `TrueTypeFont` or TrueType bytes) for a text command. */
export type FontProvider = (asset: AssetKey) => RasterAsset | undefined;

export type RenderStats = {
  readonly drawn: number;
  readonly deferred: number;
  readonly deferredByKind: { readonly [kind: string]: number };
  readonly diagnostics: readonly string[];
};

/** The two AD-33 modes. `scale` is an integer factor; a fraction would break pixel-perfect letterboxing. */
export type Presentation =
  | { readonly mode: "letterbox"; readonly scale?: number }
  | { readonly mode: "expand"; readonly width: number; readonly height: number };

export type RenderOptions = {
  readonly textures: TextureProvider;
  readonly surfaces?: SurfaceProvider;
  readonly fonts?: FontProvider;
  /**
   * The bitmap font a text command draws in when the host carries no font of the family it names (AD-15): the engine
   * substitutes `DEFAULT_FONT_ASSET` before it rasterises, so a replayer that did not would present a different frame.
   */
  readonly fallbackFont?: RasterAsset | undefined;
};

export interface Webgl2Renderer {
  /** Replay one frame; a second call is a new frame and keeps the caches. */
  render(list: DrawList, options: RenderOptions): RenderStats;
  /** Flush every cache; the next frame must produce identical pixels (G4 rule 3). */
  flush(): void;
  /** The physical canvas size the current presentation decided. */
  readonly canvas: { readonly width: number; readonly height: number };
  dispose(): void;
}

type Uploaded = { readonly texture: WebGLTexture; readonly w: number; readonly h: number };

const VERTEX = `#version 300 es
in vec2 aUnit;
in vec4 aRect;
in float aCoverage;
uniform vec4 uRect;
uniform float uCoverage;
uniform vec2 uViewport;
uniform int uInstanced;
out vec2 vLocal;
out float vCoverage;
void main() {
  vec4 rect = uInstanced == 1 ? aRect : uRect;
  vec2 px = rect.xy + aUnit * rect.zw;
  vec2 clip = (px / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = aUnit;
  vCoverage = uInstanced == 1 ? aCoverage : uCoverage;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vCoverage;
out vec4 outColor;
uniform sampler2D uTex;
uniform int uMode;
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uAlpha;
uniform int uKeyOn;
uniform vec3 uKey;
uniform int uKeyTintOn;
uniform vec3 uKeyTint;
uniform ivec2 uSrcOrigin;
uniform ivec2 uSrcSize;
uniform ivec2 uDstSize;
void main() {
  if (uMode == 0 || uMode == 2) {
    // Nearest, with the reference rasteriser's mapping: source = src.origin + floor(dest * src / dst).
    ivec2 at = ivec2(int(floor(vLocal.x * float(uDstSize.x) + 0.0001)), int(floor(vLocal.y * float(uDstSize.y) + 0.0001)));
    ivec2 texel = ivec2(uSrcOrigin.x + at.x * uSrcSize.x / uDstSize.x, uSrcOrigin.y + at.y * uSrcSize.y / uDstSize.y);
    vec4 texelValue = texelFetch(uTex, texel, 0);
    if (texelValue.a == 0.0) discard;
    // The authored stage: a composed picture's cell shade is part of its pixels, so the key is tested after it
    // (docs/spec/engine/runners.md#blit-pipeline). The R-15 remap belongs to this stage's own non-zero tint.
    vec3 src = texelValue.rgb * 255.0;
    if (uKeyTintOn == 1) {
      src = vec3(
        src.r == 255.0 ? 245.0 : (src.r == 0.0 ? 10.0 : src.r),
        src.g == 255.0 ? 245.0 : (src.g == 0.0 ? 10.0 : src.g),
        src.b == 255.0 ? 245.0 : (src.b == 0.0 ? 10.0 : src.b));
      src = clamp(src + uKeyTint, 0.0, 255.0);
    }
    // An 8-bit texel divided by 255 rarely multiplies back to the same integer in float (220/255*255 is
    // 220.000002…), so compare within half a step: that recovers the byte the reference rasteriser compares.
    if (uKeyOn == 1 && all(lessThan(abs(src - uKey), vec3(0.5)))) discard;
    // R-15: with a non-zero tint, pure white becomes 245 and pure black 10 before the tint is added (tiles.md#shading).
    if (uTint.r != 0.0 || uTint.g != 0.0 || uTint.b != 0.0) {
      src = vec3(
        src.r == 255.0 ? 245.0 : (src.r == 0.0 ? 10.0 : src.r),
        src.g == 255.0 ? 245.0 : (src.g == 0.0 ? 10.0 : src.g),
        src.b == 255.0 ? 245.0 : (src.b == 0.0 ? 10.0 : src.b));
    }
    vec3 c = clamp(src + uTint, 0.0, 255.0) / 255.0;
    // A normal blit copies the texture's own alpha; a blend is weighted by the command's alpha, never the texture's (AD-3).
    outColor = vec4(c, uMode == 0 ? texelValue.a : uAlpha);
    return;
  }
  if (uMode == 3) {
    // Text ink: the command's colour weighted by the glyph's coverage (AD-15). Coverage 255 is a plain write.
    outColor = vec4(uColor, vCoverage);
    return;
  }
  outColor = vec4(uColor, uAlpha);
}`;

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (shader === null) throw new Error("render-webgl2: could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "no log";
    gl.deleteShader(shader);
    throw new Error(`render-webgl2: shader did not compile: ${log}`);
  }
  return shader;
}

/**
 * Crop a tileset strip down to one tile. A strip of a large `.tst` can be wider than `MAX_TEXTURE_SIZE`, and an
 * incomplete texture samples as black — a wrong pixel with no trace — so a tiled blit uploads only the tile it names.
 */
export function cropTile(pixels: TexturePixels, tileWidth: number, tile: number): TexturePixels {
  const origin = (tile - 1) * tileWidth;
  const width = Math.min(tileWidth, Math.max(0, pixels.w - origin));
  const rgba = new Uint8Array(width * pixels.h * 4);
  for (let y = 0; y < pixels.h; y += 1) {
    const from = (y * pixels.w + origin) * 4;
    rgba.set(pixels.rgba.subarray(from, from + width * 4), y * width * 4);
  }
  return { w: width, h: pixels.h, rgba };
}

/** Where a blit samples from: the texture cell, its cache key and, for a persistent surface, the revision. */
export type BlitOrigin = {
  /** The column in the upload the blit starts at: a tiled asset's upload is cropped to its tile, so this is `src.x`. */
  readonly x: number;
  readonly y: number;
  readonly cacheKey: string;
  readonly asset: AssetKey | null;
  readonly surface: number | null;
  readonly rev: number;
  /** The tile's width for a tiled asset, `null` for a whole-image or surface upload. */
  readonly tileWidth: number | null;
  /** The 1-based tile, or `null`. */
  readonly tile: number | null;
};

/** The texture column one blit samples from: a tileset is a strip whose tile `n` starts at `(n-1)*32` (or 64). */
function sourceOrigin(command: Extract<DrawList["commands"][number], { kind: "blit" }>): BlitOrigin {
  if ("asset" in command.source) {
    const tile = command.source.tile;
    const tileWidth = command.source.asset.endsWith(".iso") ? 64 : 32;
    return {
      x: command.src.x,
      y: command.src.y,
      cacheKey: tile === null ? `asset:${command.source.asset}` : `asset:${command.source.asset}#${tile}`,
      asset: command.source.asset,
      surface: null,
      rev: 0,
      tileWidth: tile === null ? null : tileWidth,
      tile,
    };
  }
  return {
    x: command.src.x,
    y: command.src.y,
    cacheKey: `surface:${command.source.surface}:${command.source.rev}`,
    asset: null,
    surface: command.source.surface,
    rev: command.source.rev,
    tileWidth: null,
    tile: null,
  };
}

/** The physical canvas a presentation decides, the viewport inside it, and where that viewport starts. */
export type PresentationFrame = {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

/**
 * AD-33's two modes as geometry: `letterbox` scales the logical frame by an integer factor and centres it in the
 * canvas; `expand` shows it at 1:1 and leaves the rest of the canvas black. Pure, so a test can pin both without a GPU.
 */
export function presentationFrame(presentation: Presentation, logical: { readonly width: number; readonly height: number }): PresentationFrame {
  const scale = presentation.mode === "letterbox" ? Math.max(1, Math.floor(presentation.scale ?? 1)) : 1;
  const width = presentation.mode === "letterbox" ? logical.width * scale : Math.max(presentation.width, logical.width);
  const height = presentation.mode === "letterbox" ? logical.height * scale : Math.max(presentation.height, logical.height);
  const scaledWidth = logical.width * scale;
  const scaledHeight = logical.height * scale;
  return {
    canvas: { width, height },
    viewport: {
      x: Math.floor((width - scaledWidth) / 2),
      y: Math.floor((height - scaledHeight) / 2),
      width: scaledWidth,
      height: scaledHeight,
    },
  };
}

/**
 * Create the replayer for one WebGL2 context. The context must be created with `premultipliedAlpha: false` so a
 * `normal` blit copies the texture's straight RGBA exactly, as `core/raster` does.
 */
export function createWebgl2Renderer(gl: WebGL2RenderingContext, presentation: Presentation = { mode: "letterbox", scale: 1 }): Webgl2Renderer {
  const program = gl.createProgram();
  if (program === null) throw new Error("render-webgl2: could not create a program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`render-webgl2: program did not link: ${gl.getProgramInfoLog(program) ?? "no log"}`);
  }
  const uniform = (name: string): WebGLUniformLocation => {
    const location = gl.getUniformLocation(program, name);
    if (location === null) throw new Error(`render-webgl2: missing uniform ${name}`);
    return location;
  };
  const uRect = uniform("uRect");
  const uCoverage = uniform("uCoverage");
  const uInstanced = uniform("uInstanced");
  const uViewport = uniform("uViewport");
  const uMode = uniform("uMode");
  const uSrcOrigin = uniform("uSrcOrigin");
  const uSrcSize = uniform("uSrcSize");
  const uDstSize = uniform("uDstSize");
  const uColor = uniform("uColor");
  const uTint = uniform("uTint");
  const uAlpha = uniform("uAlpha");
  const uKeyOn = uniform("uKeyOn");
  const uKey = uniform("uKey");
  const uKeyTintOn = uniform("uKeyTintOn");
  const uKeyTint = uniform("uKeyTint");
  const uTex = uniform("uTex");

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  const aUnit = gl.getAttribLocation(program, "aUnit");
  const aRect = gl.getAttribLocation(program, "aRect");
  const aCoverage = gl.getAttribLocation(program, "aCoverage");

  // One instance per one-pixel quad: `x, y, w, h, coverage` — the shapes and text ink arrive as pixels, not as boxes.
  const pixels = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pixels);
  gl.bufferData(gl.ARRAY_BUFFER, Float32Array.of(0, 0, 1, 1, 1), gl.DYNAMIC_DRAW);

  /** Uploaded textures by cache key; a flush drops them all (G4 rule 3). */
  let uploaded = new Map<string, Uploaded>();
  let disposed = false;
  let canvas = { width: 0, height: 0 };

  function upload(cacheKey: string, source: TexturePixels): Uploaded {
    const existing = uploaded.get(cacheKey);
    if (existing !== undefined) return existing;
    const texture = gl.createTexture();
    if (texture === null) throw new Error("render-webgl2: could not create a texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source.w, source.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.rgba);
    const result: Uploaded = { texture, w: source.w, h: source.h };
    uploaded.set(cacheKey, result);
    return result;
  }

  /** Scratch targets for `pushTarget`/`popTarget`: frame-scoped, cleared at push (AD-27). */
  const scratchStack: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = [];

  function bindEnclosingTarget(): void {
    const parent = scratchStack.at(-1);
    if (parent === undefined) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    else gl.bindFramebuffer(gl.FRAMEBUFFER, parent.framebuffer);
    gl.viewport(0, 0, viewportWidth, viewportHeight);
  }

  // The viewport the frame is drawn into, in physical pixels, inside the canvas's black surround (AD-33).
  let viewportWidth = 0;
  let viewportHeight = 0;

  /** AD-3's blend state for one command; the destination alpha stays the CPU's. */
  function setBlend(mode: "normal" | "translucent" | "additive" | "coverage"): void {
    if (mode === "normal") {
      gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO);
      return;
    }
    if (mode === "coverage") {
      // Glyph ink accumulates its coverage into the destination alpha, as the reference's `da + cov*(255-da)` does.
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return;
    }
    gl.blendFuncSeparate(gl.SRC_ALPHA, mode === "additive" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  }

  /** A quad in logical pixels; `source` is the texel rectangle it samples, in the texture's own pixels. */
  type Source = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  function drawQuad(rect: { x: number; y: number; w: number; h: number }, source?: Source): void {
    gl.uniform1i(uInstanced, 0);
    gl.uniform4f(uRect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform2i(uDstSize, rect.w, rect.h);
    if (source === undefined) gl.uniform2i(uSrcSize, 0, 0);
    else {
      gl.uniform2i(uSrcOrigin, source.x, source.y);
      gl.uniform2i(uSrcSize, source.w, source.h);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Draw a set of one-pixel quads in one instanced call. `coverage` may be `null` for solid ink, in which case the
   * shader reads `uCoverage`'s `1`.
   */
  function drawPixels(points: readonly (readonly [number, number, number])[]): void {
    if (points.length === 0) return;
    const data = new Float32Array(points.length * 5);
    for (let index = 0; index < points.length; index += 1) {
      const [x, y, coverage] = points[index]!;
      data[index * 5] = x;
      data[index * 5 + 1] = y;
      data[index * 5 + 2] = 1;
      data[index * 5 + 3] = 1;
      data[index * 5 + 4] = coverage;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pixels);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aRect);
    gl.vertexAttribPointer(aRect, 4, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(aRect, 1);
    gl.enableVertexAttribArray(aCoverage);
    gl.vertexAttribPointer(aCoverage, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(aCoverage, 1);
    gl.uniform1i(uInstanced, 1);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, points.length);
    gl.vertexAttribDivisor(aRect, 0);
    gl.vertexAttribDivisor(aCoverage, 0);
    gl.disableVertexAttribArray(aRect);
    gl.disableVertexAttribArray(aCoverage);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  }

  /**
   * The blit path, shared by the whole-quad case and by the `.iso` projection's per-destination-pixel case. Returns
   * `false` when the source could not be supplied, so the caller can count it deferred.
   */
  function bindBlitSource(
    command: Extract<DrawList["commands"][number], { kind: "blit" }>,
    options: RenderOptions,
  ): { readonly ok: true; readonly origin: BlitOrigin } | { readonly ok: false; readonly why: string } {
    const origin = sourceOrigin(command);
    let sourcePixels: TexturePixels | null = null;
    if (origin.asset !== null) sourcePixels = options.textures(origin.asset);
    else if (options.surfaces !== undefined && origin.surface !== null) {
      sourcePixels = options.surfaces(origin.surface as SurfaceId, origin.rev);
    } else {
      return { ok: false, why: "webgl2.no-source: a surface blit with no surface provider" };
    }
    if (sourcePixels === null) {
      return { ok: false, why: `webgl2.missing-texture: ${origin.asset ?? `surface ${String(origin.surface)}`}` };
    }
    const toUpload = origin.tile !== null && origin.tileWidth !== null
      ? cropTile(sourcePixels, origin.tileWidth, origin.tile)
      : sourcePixels;
    const texture = upload(origin.cacheKey, toUpload);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.uniform3f(uTint, command.tint.r, command.tint.g, command.tint.b);
    const keyTint = command.keyTint;
    if (keyTint === undefined || (keyTint.r === 0 && keyTint.g === 0 && keyTint.b === 0)) {
      gl.uniform1i(uKeyTintOn, 0);
    } else {
      gl.uniform1i(uKeyTintOn, 1);
      gl.uniform3f(uKeyTint, keyTint.r, keyTint.g, keyTint.b);
    }
    if (command.key === null) gl.uniform1i(uKeyOn, 0);
    else {
      gl.uniform1i(uKeyOn, 1);
      gl.uniform3f(uKey, command.key.r, command.key.g, command.key.b);
    }
    gl.uniform1f(uAlpha, command.alpha / 255);
    gl.uniform1i(uMode, command.blend === "normal" ? 0 : 2);
    setBlend(command.blend);
    return { ok: true, origin };
  }

  /**
   * Draw one text command's ink. `false` means the host could not supply a font the core can draw, which the caller
   * counts as deferred: drawing nothing would be a silent wrong pixel.
   */
  function drawText(command: TextCommand, options: RenderOptions): boolean {
    const ink = textInk(command, options.fonts?.(command.font.asset) ?? options.fallbackFont);
    if (ink === null) return false;
    gl.uniform1i(uMode, 3);
    gl.uniform1i(uKeyOn, 0);
    gl.uniform3f(uColor, command.rgb.r / 255, command.rgb.g / 255, command.rgb.b / 255);
    gl.uniform1f(uAlpha, 1);
    setBlend("coverage");
    drawPixels(ink.map(({ x, y, coverage }) => [x, y, coverage / 255] as const));
    return true;
  }

  return {
    get canvas(): { readonly width: number; readonly height: number } {
      return canvas;
    },
    render(list: DrawList, options: RenderOptions): RenderStats {
      if (disposed) throw new Error("render-webgl2: renderer was disposed");
      let drawn = 0;
      let deferred = 0;
      const deferredByKind: { [kind: string]: number } = {};
      const diagnostics: string[] = [];
      const defer = (kind: string, why: string): void => {
        deferred += 1;
        deferredByKind[kind] = (deferredByKind[kind] ?? 0) + 1;
        if (!diagnostics.includes(why)) diagnostics.push(why);
      };

      // AD-33 presentation: the draw list is logical; the viewport is the physical area it occupies.
      const frame = presentationFrame(presentation, list);
      if (gl.canvas.width !== frame.canvas.width || gl.canvas.height !== frame.canvas.height) {
        gl.canvas.width = frame.canvas.width;
        gl.canvas.height = frame.canvas.height;
      }
      canvas = { width: frame.canvas.width, height: frame.canvas.height };
      const offsetX = frame.viewport.x;
      const offsetY = frame.viewport.y;
      viewportWidth = frame.viewport.width;
      viewportHeight = frame.viewport.height;

      gl.viewport(offsetX, offsetY, viewportWidth, viewportHeight);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aUnit);
      gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uViewport, list.width, list.height);
      gl.uniform1f(uCoverage, 1);
      gl.uniform1i(uTex, 0);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // A fresh frame is a zeroed RGBA buffer, exactly as `core/raster` allocates one: transparent black, not opaque.
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const setColour = (rgb: { r: number; g: number; b: number }, coverage: number): void => {
        gl.uniform1i(uMode, coverage === 255 ? 1 : 3);
        gl.uniform1i(uKeyOn, 0);
        gl.uniform3f(uColor, rgb.r / 255, rgb.g / 255, rgb.b / 255);
        gl.uniform1f(uAlpha, 1);
        setBlend(coverage === 255 ? "normal" : "coverage");
      };

      /** Plot the reference's pixel set for a solid shape, one instanced call. */
      const drawSolidPixels = (points: readonly (readonly [number, number])[], rgb: { r: number; g: number; b: number }): void => {
        setColour(rgb, 255);
        drawPixels(points.map(([x, y]) => [x, y, 1] as const));
      };

      for (const command of list.commands) {
        switch (command.kind) {
          case "fill": {
            setColour(command.rgb, 255);
            drawQuad({ x: 0, y: 0, w: list.width, h: list.height });
            drawn += 1;
            break;
          }
          case "rect": {
            if (command.filled) {
              setColour(command.rgb, 255);
              drawQuad(command.rect);
            } else {
              drawSolidPixels(rectOutlinePixels(command.rect), command.rgb);
            }
            drawn += 1;
            break;
          }
          case "line": {
            drawSolidPixels(linePixels(command.x1, command.y1, command.x2, command.y2), command.rgb);
            drawn += 1;
            break;
          }
          case "ellipse": {
            drawSolidPixels(ellipsePixels(command.rect, command.filled), command.rgb);
            drawn += 1;
            break;
          }
          case "blit": {
            const bound = bindBlitSource(command, options);
            if (!bound.ok) {
              defer("blit", bound.why);
              break;
            }
            if (!command.iso2d) {
              drawQuad(command.dst, { x: bound.origin.x, y: bound.origin.y, w: command.src.w, h: command.src.h });
              drawn += 1;
              break;
            }
            // The `.iso` projection is a diamond, not a rectangle: each covered destination pixel samples the source
            // at `isoSourceOffset`'s cell, so one 1×1 quad per pixel keeps the reference's exact mapping.
            const isoPoints: (readonly [number, number, number])[] = [];
            for (let y = 0; y < command.dst.h; y += 1) {
              for (let x = 0; x < command.dst.w; x += 1) {
                const unit = isoSourceOffset(x, y);
                if (unit === null) continue;
                const sourceX = command.src.x + unit[0] * command.src.w / 32;
                const sourceY = command.src.y + unit[1] * command.src.h / 32;
                gl.uniform2i(uSrcOrigin, bound.origin.x + Math.floor(sourceX), bound.origin.y + Math.floor(sourceY));
                gl.uniform2i(uSrcSize, 1, 1);
                gl.uniform4f(uRect, command.dst.x + x, command.dst.y + y, 1, 1);
                gl.uniform2i(uDstSize, 1, 1);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                isoPoints.push([command.dst.x + x, command.dst.y + y, 1]);
              }
            }
            if (isoPoints.length > 0) drawn += 1;
            else defer("blit", "webgl2.iso-empty: the .iso diamond covers no destination pixel");
            break;
          }
          case "text": {
            if (!drawText(command, options)) {
              defer("text", `webgl2.missing-font: ${command.font.asset}`);
              break;
            }
            drawn += 1;
            break;
          }
          case "pushTarget": {
            const texture = gl.createTexture();
            const framebuffer = gl.createFramebuffer();
            if (texture === null || framebuffer === null) throw new Error("render-webgl2: could not create a scratch target");
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, viewportWidth, viewportHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.viewport(0, 0, viewportWidth, viewportHeight);
            scratchStack.push({ texture, framebuffer });
            drawn += 1;
            break;
          }
          case "popTarget": {
            // The reference pops the target stack and nothing else: a scratch never reaches the screen by itself.
            const top = scratchStack.pop();
            if (top === undefined) {
              defer("popTarget", "webgl2.unbalanced-pop: popTarget without pushTarget");
              break;
            }
            gl.deleteFramebuffer(top.framebuffer);
            gl.deleteTexture(top.texture);
            bindEnclosingTarget();
            drawn += 1;
            break;
          }
          default: {
            const _never: never = command;
            throw new TypeError(`render-webgl2: unknown draw command ${JSON.stringify(_never)}`);
          }
        }
      }
      for (const entry of scratchStack.splice(0)) {
        gl.deleteFramebuffer(entry.framebuffer);
        gl.deleteTexture(entry.texture);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(offsetX, offsetY, viewportWidth, viewportHeight);
      gl.disable(gl.BLEND);
      return { drawn, deferred, deferredByKind, diagnostics };
    },
    flush(): void {
      for (const entry of uploaded.values()) gl.deleteTexture(entry.texture);
      uploaded = new Map();
    },
    dispose(): void {
      if (disposed) return;
      for (const entry of uploaded.values()) gl.deleteTexture(entry.texture);
      uploaded = new Map();
      gl.deleteBuffer(quad);
      gl.deleteBuffer(pixels);
      gl.deleteProgram(program);
      disposed = true;
    },
  };

}
