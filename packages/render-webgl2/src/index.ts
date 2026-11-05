import { rasterizePresentation, type RasterAsset } from "@tk-reawakened/core";
import type {
  AssetKey,
  DrawCommand,
  DrawListV2,
  HostDisplayGeometry,
  SurfaceId,
} from "@tk-reawakened/core";


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

export type RenderOptions = {
  readonly textures: TextureProvider;
  readonly surfaces?: SurfaceProvider;
  readonly fonts?: FontProvider;
  readonly fallbackFont?: RasterAsset | undefined;
};

export interface Webgl2Renderer {
  /** Replay both strict-v2 planes with the logged host geometry. */
  render(list: DrawListV2, geometry: HostDisplayGeometry, options: RenderOptions): RenderStats;
  /** Release resources retained by the renderer. */
  flush(): void;
  /** Physical content size of the last rendered frame. */
  readonly canvas: { readonly width: number; readonly height: number };
  dispose(): void;
}

type Program = { readonly program: WebGLProgram; readonly texture: WebGLTexture; readonly sampler: WebGLUniformLocation; readonly height: WebGLUniformLocation };

const VERTEX = `#version 300 es
void main() {
  vec2 p = gl_VertexID == 0 ? vec2(-1.0, -1.0) : (gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0));
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uImage;
uniform int uHeight;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  p.y = uHeight - 1 - p.y;
  outColor = texelFetch(uImage, p, 0);
}`;

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (shader === null) throw new Error("render-webgl2: could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "no log";
    gl.deleteShader(shader);
    throw new Error(`render-webgl2: shader did not compile: ${message}`);
  }
  return shader;
}

function referencedTextures(list: DrawListV2): Set<AssetKey> {
  const assets = new Set<AssetKey>();
  const collect = (commands: readonly DrawCommand[]): void => {
    for (const command of commands) {
      if (command.kind === "blit" && "asset" in command.source) assets.add(command.source.asset);
    }
  };
  collect(list.commands);
  collect(list.marginCommands);
  return assets;
}

function referencedFonts(list: DrawListV2): Set<AssetKey> {
  const fonts = new Set<AssetKey>();
  const collect = (commands: readonly DrawCommand[]): void => {
    for (const command of commands) {
      if (command.kind === "text") fonts.add(command.font.asset);
    }
  };
  collect(list.commands);
  collect(list.marginCommands);
  return fonts;
}
class RevisionSurfaceMap extends Map<SurfaceId, TexturePixels> {
  private readonly byRevision = new Map<SurfaceId, Map<number, TexturePixels | null>>();

  override get(surface: SurfaceId, revision?: number): TexturePixels | undefined {
    if (revision === undefined) return super.get(surface);
    return this.byRevision.get(surface)?.get(revision) ?? undefined;
  }

  hasRevision(surface: SurfaceId, revision: number): boolean {
    return this.byRevision.get(surface)?.has(revision) ?? false;
  }

  setRevision(surface: SurfaceId, revision: number, pixels: TexturePixels | null): void {
    let revisions = this.byRevision.get(surface);
    if (revisions === undefined) {
      revisions = new Map<number, TexturePixels | null>();
      this.byRevision.set(surface, revisions);
    }
    revisions.set(revision, pixels);
  }
}

/**
 * Create a WebGL2 presentation renderer. The core reference raster is authoritative for AD-4
 * pixel arithmetic; WebGL2 presents its straight-RGBA result without changing any byte. This
 * keeps G4 parity exact, including fractional per-axis presentation and safe whole-cell clipping.
 */
export function createWebgl2Renderer(gl: WebGL2RenderingContext): Webgl2Renderer {
  const program = gl.createProgram();
  if (program === null) throw new Error("render-webgl2: could not create a program");
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "no log";
    gl.deleteProgram(program);
    throw new Error(`render-webgl2: program did not link: ${message}`);
  }
  const sampler = gl.getUniformLocation(program, "uImage");
  const height = gl.getUniformLocation(program, "uHeight");
  if (sampler === null || height === null) {
    gl.deleteProgram(program);
    throw new Error("render-webgl2: missing presentation uniform");
  }
  const texture = gl.createTexture();
  if (texture === null) {
    gl.deleteProgram(program);
    throw new Error("render-webgl2: could not create presentation texture");
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const gpu: Program = { program, texture, sampler, height };
  let size = { width: 0, height: 0 };
  let disposed = false;

  return {
    get canvas() { return size; },
    render(list, geometry, options): RenderStats {
      if (disposed) throw new Error("render-webgl2: renderer was disposed");
      const assetMap = new Map<AssetKey, RasterAsset>();
      for (const asset of referencedTextures(list)) {
        const pixels = options.textures(asset);
        if (pixels !== null) assetMap.set(asset, pixels);
      }
      for (const asset of referencedFonts(list)) {
        const font = options.fonts?.(asset) ?? options.fallbackFont;
        if (font !== undefined) assetMap.set(asset, font);
      }
      const surfaceMap = new RevisionSurfaceMap();
      const resolveSurfaces = (commands: readonly DrawCommand[]): void => {
        for (const command of commands) {
          if (command.kind !== "blit" || !("surface" in command.source)) continue;
          const { surface, rev } = command.source;
          if (!surfaceMap.hasRevision(surface, rev)) {
            surfaceMap.setRevision(surface, rev, options.surfaces?.(surface, rev) ?? null);
          }
        }
      };
      resolveSurfaces(list.commands);
      resolveSurfaces(list.marginCommands);
      const result = rasterizePresentation(list, geometry, assetMap, surfaceMap);

      if (gl.canvas.width !== result.width || gl.canvas.height !== result.height) {
        gl.canvas.width = result.width;
        gl.canvas.height = result.height;
      }
      size = { width: result.width, height: result.height };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, result.width, result.height);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(gpu.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gpu.texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, result.width, result.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, result.rgba);
      gl.uniform1i(gpu.sampler, 0);
      gl.uniform1i(gpu.height, result.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const count = list.commands.length + list.marginCommands.length;
      return result.error === null
        ? { drawn: count, deferred: 0, deferredByKind: {}, diagnostics: [] }
        : { drawn: 0, deferred: 1, deferredByKind: { raster: 1 }, diagnostics: [result.error] };
    },
    flush(): void {
      if (disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, gpu.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    },
    dispose(): void {
      if (disposed) return;
      gl.deleteTexture(gpu.texture);
      gl.deleteProgram(gpu.program);
      disposed = true;
    },
  };
}
