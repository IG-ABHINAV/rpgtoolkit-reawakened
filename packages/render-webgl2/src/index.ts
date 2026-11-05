import {
  ellipsePixels,
  isoSourceOffset,
  linePixels,
  rectOutlinePixels,
  textInk,
  type RasterAsset,
} from "@tk-reawakened/core";
import type { AssetKey, DrawCommand, DrawListV2, HostDisplayGeometry, SurfaceId } from "@tk-reawakened/core";

export type TexturePixels = { readonly w: number; readonly h: number; readonly rgba: Uint8Array };
export type TextureProvider = (asset: AssetKey) => TexturePixels | null;
export type SurfaceProvider = (id: SurfaceId, rev: number) => TexturePixels | null;
export type FontProvider = (asset: AssetKey) => RasterAsset | undefined;
export type RenderStats = { readonly drawn: number; readonly deferred: number; readonly deferredByKind: { readonly [kind: string]: number }; readonly diagnostics: readonly string[] };
export type RenderOptions = { readonly textures: TextureProvider; readonly surfaces?: SurfaceProvider; readonly fonts?: FontProvider; readonly fallbackFont?: RasterAsset | undefined };
export interface Webgl2Renderer {
  render(list: DrawListV2, geometry: HostDisplayGeometry, options: RenderOptions): RenderStats;
  flush(): void;
  readonly canvas: { readonly width: number; readonly height: number };
  dispose(): void;
}

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };
type Uploaded = { readonly texture: WebGLTexture; readonly w: number; readonly h: number };
type Point = readonly [number, number, number];

const VERTEX = `#version 300 es
in vec2 aUnit; in vec4 aRect; in float aCoverage;
uniform vec4 uRect; uniform vec2 uViewport; uniform int uInstanced;
out vec2 vLocal; out float vCoverage;
void main(){ vec4 r=uInstanced==1?aRect:uRect; vec2 p=r.xy+aUnit*r.zw; vec2 c=(p/uViewport)*2.0-1.0; gl_Position=vec4(c.x,-c.y,0.0,1.0); vLocal=aUnit; vCoverage=uInstanced==1?aCoverage:1.0; }`;
const FRAGMENT = `#version 300 es
precision highp float; precision highp int;
in vec2 vLocal; in float vCoverage; out vec4 outColor;
uniform sampler2D uTex; uniform int uMode; uniform vec3 uColor; uniform vec3 uTint;
uniform int uKeyOn; uniform vec3 uKey; uniform ivec2 uSrcOrigin; uniform ivec2 uSrcSize; uniform ivec2 uDstSize;
void main(){
 if(uMode==0||uMode==2){ ivec2 at=ivec2(int(floor(vLocal.x*float(uDstSize.x)+0.0001)),int(floor(vLocal.y*float(uDstSize.y)+0.0001))); ivec2 t=uSrcOrigin+at*uSrcSize/uDstSize; vec4 s=texelFetch(uTex,t,0); if(s.a==0.0)discard; vec3 c=s.rgb*255.0; if(uKeyOn==1&&all(lessThan(abs(c-uKey),vec3(0.5))))discard; if(any(notEqual(uTint,vec3(0.0)))) c=vec3(c.r==255.0?245.0:(c.r==0.0?10.0:c.r),c.g==255.0?245.0:(c.g==0.0?10.0:c.g),c.b==255.0?245.0:(c.b==0.0?10.0:c.b)); outColor=vec4(clamp(c+uTint,0.0,255.0)/255.0,uMode==0?s.a:1.0); return; }
 if(uMode==3){outColor=vec4(uColor,vCoverage);return;} outColor=vec4(uColor,1.0);
}`;
const PRESENT_VERTEX = `#version 300 es
void main(){vec2 p=gl_VertexID==0?vec2(-1.,-1.):(gl_VertexID==1?vec2(3.,-1.):vec2(-1.,3.));gl_Position=vec4(p,0.,1.);}`;
const PRESENT_FRAGMENT = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uGamePlane; uniform sampler2D uMarginPlane;
uniform vec2 uContent; uniform vec4 uGame; uniform vec4 uSafe; uniform ivec2 uLogical; uniform ivec4 uBounds; uniform ivec2 uMarginSize;
out vec4 outColor;
void main(){
 vec2 center=vec2(gl_FragCoord.x,ceil(uContent.y)-gl_FragCoord.y);
 if(center.x>=uContent.x||center.y>=uContent.y){outColor=vec4(0.);return;}
 vec2 scale=uGame.zw/vec2(uLogical); ivec2 p=ivec2(floor((center-uGame.xy)/scale));
 bool game=center.x>=uGame.x&&center.x<uGame.x+uGame.z&&center.y>=uGame.y&&center.y<uGame.y+uGame.w;
 if(game&&all(greaterThanEqual(p,ivec2(0)))&&all(lessThan(p,uLogical))){outColor=texelFetch(uGamePlane,ivec2(p.x,uLogical.y-1-p.y),0);return;}
 bool safe=center.x>=uSafe.x&&center.y>=uSafe.y&&center.x<uContent.x-uSafe.z&&center.y<uContent.y-uSafe.w;
 vec2 cell0=uGame.xy+vec2(p)*scale; vec2 cell1=uGame.xy+(vec2(p)+vec2(1.))*scale;
 bool eligible=safe&&!(all(greaterThanEqual(p,ivec2(0)))&&all(lessThan(p,uLogical)))&&p.x>=-uBounds.x&&p.x<uLogical.x+uBounds.y&&p.y>=-uBounds.z&&p.y<uLogical.y+uBounds.w&&all(greaterThanEqual(cell0,vec2(0.)))&&all(lessThanEqual(cell1,uContent))&&cell0.x>=uSafe.x&&cell0.y>=uSafe.y&&cell1.x<=uContent.x-uSafe.z&&cell1.y<=uContent.y-uSafe.w;
 if(eligible){ivec2 m=p+uBounds.xz;outColor=texelFetch(uMarginPlane,ivec2(m.x,uMarginSize.y-1-m.y),0);return;} outColor=vec4(0.);
}`;
function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (shader === null) throw new Error("render-webgl2: could not create shader");
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader) ?? "no log"; gl.deleteShader(shader); throw new Error(`render-webgl2: shader compilation failed: ${message}`); }
  return shader;
}
function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram(); if (program === null) throw new Error("render-webgl2: could not create program");
  const vertex = compile(gl, gl.VERTEX_SHADER, vs); const fragment = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const message = gl.getProgramInfoLog(program) ?? "no log"; gl.deleteProgram(program); throw new Error(`render-webgl2: program link failed: ${message}`); }
  return program;
}
function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const value = gl.getUniformLocation(program, name); if (value === null) throw new Error(`render-webgl2: missing uniform ${name}`); return value;
}
function cropTile(pixels: TexturePixels, width: number, tile: number): TexturePixels {
  const x = (tile - 1) * width; const w = Math.min(width, Math.max(0, pixels.w - x)); const rgba = new Uint8Array(w * pixels.h * 4);
  for (let y = 0; y < pixels.h; y += 1) rgba.set(pixels.rgba.subarray((y * pixels.w + x) * 4, (y * pixels.w + x + w) * 4), y * w * 4);
  return { w, h: pixels.h, rgba };
}
function marginBounds(list: DrawListV2, geometry: HostDisplayGeometry) {
  const { content, game, safeArea } = geometry; const right = content.width - safeArea.right; const bottom = content.height - safeArea.bottom;
  const empty = right <= safeArea.left || bottom <= safeArea.top; const sx = game.width / list.width; const sy = game.height / list.height;
  const left = empty ? 0 : Math.floor(Math.max(0, game.x - safeArea.left) / sx);
  const r = empty ? 0 : Math.floor(Math.max(0, right - game.x - game.width) / sx);
  const top = empty ? 0 : Math.floor(Math.max(0, game.y - safeArea.top) / sy);
  const b = empty ? 0 : Math.floor(Math.max(0, bottom - game.y - game.height) / sy);
  return { left, right: r, top, bottom: b, width: list.width + left + r, height: list.height + top + b, empty };
}

/** Create a WebGL2 renderer that replays commands directly into reusable logical-plane FBOs. */
export function createWebgl2Renderer(gl: WebGL2RenderingContext): Webgl2Renderer {
  const replayProgram = makeProgram(gl, VERTEX, FRAGMENT); const presentProgram = makeProgram(gl, PRESENT_VERTEX, PRESENT_FRAGMENT);
  const loc = (name: string) => uniform(gl, replayProgram, name);
  const replay = { rect: loc("uRect"), viewport: loc("uViewport"), instanced: loc("uInstanced"), mode: loc("uMode"), color: loc("uColor"), tint: loc("uTint"), keyOn: loc("uKeyOn"), key: loc("uKey"), srcOrigin: loc("uSrcOrigin"), srcSize: loc("uSrcSize"), dstSize: loc("uDstSize"), tex: loc("uTex") };
  const present = { game: uniform(gl, presentProgram, "uGamePlane"), margin: uniform(gl, presentProgram, "uMarginPlane"), content: uniform(gl, presentProgram, "uContent"), gameRect: uniform(gl, presentProgram, "uGame"), safe: uniform(gl, presentProgram, "uSafe"), logical: uniform(gl, presentProgram, "uLogical"), bounds: uniform(gl, presentProgram, "uBounds"), marginSize: uniform(gl, presentProgram, "uMarginSize") };
  const quad = gl.createBuffer(); const pointBuffer = gl.createBuffer();
  if (quad === null || pointBuffer === null) throw new Error("render-webgl2: could not create geometry buffers");
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]), gl.STATIC_DRAW);
  const unit = gl.getAttribLocation(replayProgram, "aUnit"); const rectAttrib = gl.getAttribLocation(replayProgram, "aRect"); const coverageAttrib = gl.getAttribLocation(replayProgram, "aCoverage");
  const uploads = new Map<string, Uploaded>(); const targets: Target[] = []; const scratch: Target[][] = [[], []]; let size = { width: 0, height: 0 }; let disposed = false;
  function targetAt(pool: Target[], index: number, width: number, height: number): Target {
    let target = pool[index];
    if (target !== undefined && target.width === width && target.height === height) return target;
    if (target !== undefined) { gl.deleteFramebuffer(target.framebuffer); gl.deleteTexture(target.texture); }
    const texture = gl.createTexture(); const framebuffer = gl.createFramebuffer(); if (texture === null || framebuffer === null) throw new Error("render-webgl2: unable to allocate plane framebuffer");
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    target = { texture, framebuffer, width, height }; pool[index] = target; return target;
  }
  function upload(key: string, pixels: TexturePixels): Uploaded {
    const existing = uploads.get(key); if (existing !== undefined) return existing;
    const texture = gl.createTexture(); if (texture === null) throw new Error("render-webgl2: unable to allocate source texture");
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pixels.w, pixels.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.rgba);
    const result = { texture, w: pixels.w, h: pixels.h }; uploads.set(key, result); return result;
  }
  function blend(mode: "normal" | "translucent" | "additive" | "coverage", alpha = 1): void {
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    if (mode === "normal") { gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO); return; }
    if (mode === "coverage") { gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); return; }
    gl.blendColor(0, 0, 0, alpha);
    gl.blendFuncSeparate(gl.CONSTANT_ALPHA, mode === "additive" ? gl.ONE : gl.ONE_MINUS_CONSTANT_ALPHA, gl.ONE, gl.ZERO);
  }
  function drawQuad(r: { x: number; y: number; w: number; h: number }, source?: { x: number; y: number; w: number; h: number }): void {
    gl.uniform1i(replay.instanced, 0); gl.uniform4f(replay.rect, r.x, r.y, r.w, r.h); gl.uniform2i(replay.dstSize, r.w, r.h);
    if (source === undefined) gl.uniform2i(replay.srcSize, 0, 0); else { gl.uniform2i(replay.srcOrigin, source.x, source.y); gl.uniform2i(replay.srcSize, source.w, source.h); }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function drawPixels(points: readonly Point[]): void {
    if (points.length === 0) return; const data = new Float32Array(points.length * 5);
    for (let i = 0; i < points.length; i += 1) { const [x,y,c] = points[i]!; data.set([x,y,1,1,c],i*5); }
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(rectAttrib); gl.vertexAttribPointer(rectAttrib,4,gl.FLOAT,false,20,0); gl.vertexAttribDivisor(rectAttrib,1); gl.enableVertexAttribArray(coverageAttrib); gl.vertexAttribPointer(coverageAttrib,1,gl.FLOAT,false,20,16); gl.vertexAttribDivisor(coverageAttrib,1); gl.uniform1i(replay.instanced,1); gl.drawArraysInstanced(gl.TRIANGLES,0,6,points.length); gl.vertexAttribDivisor(rectAttrib,0); gl.vertexAttribDivisor(coverageAttrib,0); gl.disableVertexAttribArray(rectAttrib); gl.disableVertexAttribArray(coverageAttrib);
  }
  const surfacePixels = new Map<string, TexturePixels | null>();
  const usedSurfaceUploads = new Set<string>();
  function drawCommands(commands: readonly DrawCommand[], dimensions: { width: number; height: number }, offset: { x: number; y: number }, root: Target, scratchPool: Target[], options: RenderOptions, defer: (kind: string, reason: string) => void): { drawn: number; deferred: number } {
    const stack: Target[] = []; let drawn = 0; let deferred = 0;
    gl.useProgram(replayProgram); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null); gl.bindBuffer(gl.ARRAY_BUFFER,quad); gl.enableVertexAttribArray(unit); gl.vertexAttribPointer(unit,2,gl.FLOAT,false,0,0); gl.uniform1i(replay.tex,0); gl.uniform1i(replay.instanced,0); gl.enable(gl.BLEND);
    const bind = (target: Target) => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,null); gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer); gl.viewport(0,0,target.width,target.height); gl.uniform2f(replay.viewport,target.width,target.height); };
    bind(root); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    const color = (rgb: {r:number;g:number;b:number}, coverage=255) => { gl.uniform1i(replay.mode,coverage===255?1:3); gl.uniform1i(replay.keyOn,0); gl.uniform3f(replay.color,rgb.r/255,rgb.g/255,rgb.b/255); blend(coverage===255?"normal":"coverage"); };
    for (const command of commands) {
      gl.uniform1i(replay.instanced, 0);
      const offsetRect = (r: {x:number;y:number;w:number;h:number}) => ({...r,x:r.x+offset.x,y:r.y+offset.y});
      switch(command.kind){
        case "fill": color(command.rgb); drawQuad({x:0,y:0,w:dimensions.width,h:dimensions.height}); drawn++; break;
        case "rect": if(command.filled){color(command.rgb);drawQuad(offsetRect(command.rect));}else{color(command.rgb);drawPixels(rectOutlinePixels(offsetRect(command.rect)).map(([x,y])=>[x,y,1] as const));} drawn++; break;
        case "line": color(command.rgb);drawPixels(linePixels(command.x1+offset.x,command.y1+offset.y,command.x2+offset.x,command.y2+offset.y).map(([x,y])=>[x,y,1] as const));drawn++;break;
        case "ellipse": color(command.rgb);drawPixels(ellipsePixels(offsetRect(command.rect),command.filled).map(([x,y])=>[x,y,1] as const));drawn++;break;
        case "blit": {
          let pixels: TexturePixels|null; let key: string; let originX=command.src.x; let originY=command.src.y;
          if("asset" in command.source){const asset=command.source.asset;key=`asset:${asset}${command.source.tile===null?"":`#${command.source.tile}`}`;pixels=options.textures(asset);if(pixels!==null&&command.source.tile!==null){const w=asset.endsWith(".iso")?64:32;pixels=cropTile(pixels,w,command.source.tile);}}
          else {const {surface,rev}=command.source;key=`surface:${surface}:${rev}`;const cacheKey=`${surface}:${rev}`;if(!surfacePixels.has(cacheKey))surfacePixels.set(cacheKey,options.surfaces?.(surface,rev)??null);pixels=surfacePixels.get(cacheKey)??null;}
          if(pixels===null){const reason="asset" in command.source?`webgl2.missing-texture: ${command.source.asset}`:options.surfaces===undefined?"webgl2.no-source: a surface blit with no surface provider":`webgl2.missing-texture: surface ${String(command.source.surface)}`;defer("blit",reason);deferred++;break;}
          if("surface" in command.source) usedSurfaceUploads.add(key);
          const source=upload(key,pixels);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source.texture);gl.uniform3f(replay.tint,command.tint.r,command.tint.g,command.tint.b);if(command.key===null)gl.uniform1i(replay.keyOn,0);else{gl.uniform1i(replay.keyOn,1);gl.uniform3f(replay.key,command.key.r,command.key.g,command.key.b);}gl.uniform1i(replay.mode,command.blend==="normal"?0:2);blend(command.blend,command.alpha/255);
          if(!command.iso2d){drawQuad(offsetRect(command.dst),{x:originX,y:originY,w:command.src.w,h:command.src.h});drawn++;break;}
          let count=0;for(let y=0;y<command.dst.h;y++)for(let x=0;x<command.dst.w;x++){const unitOffset=isoSourceOffset(x,y);if(unitOffset===null)continue;gl.uniform2i(replay.srcOrigin,originX+Math.floor(unitOffset[0]*command.src.w/32),originY+Math.floor(unitOffset[1]*command.src.h/32));gl.uniform2i(replay.srcSize,1,1);gl.uniform2i(replay.dstSize,1,1);gl.uniform4f(replay.rect,command.dst.x+offset.x+x,command.dst.y+offset.y+y,1,1);gl.drawArrays(gl.TRIANGLES,0,6);count++;}if(count)drawn++;else{defer("blit","webgl2.iso-empty: the .iso diamond covers no destination pixel");deferred++;}break;
        }
        case "text": {const ink=textInk(command,options.fonts?.(command.font.asset)??options.fallbackFont);if(ink===null){defer("text",`webgl2.missing-font: ${command.font.asset}`);deferred++;break;}gl.uniform1i(replay.mode,3);gl.uniform1i(replay.keyOn,0);gl.uniform3f(replay.color,command.rgb.r/255,command.rgb.g/255,command.rgb.b/255);blend("coverage");drawPixels(ink.map(({x,y,coverage})=>[x+offset.x,y+offset.y,coverage/255] as const));drawn++;break;}
        case "pushTarget": {const target=targetAt(scratchPool,stack.length,dimensions.width,dimensions.height);stack.push(target);bind(target);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);drawn++;break;}
        case "popTarget": {const top=stack.pop();if(top===undefined){defer("popTarget","webgl2.unbalanced-pop: popTarget without pushTarget");deferred++;break;}bind(stack.at(-1)??root);drawn++;break;}
      }
    }
    if(stack.length!==0){defer("pushTarget","webgl2.unclosed-push: pushTarget without matching popTarget");deferred++;}
    return {drawn,deferred};
  }
  function disposeTargets(pool: Target[]) { for(const target of pool){gl.deleteFramebuffer(target.framebuffer);gl.deleteTexture(target.texture);} pool.length=0; }
  return {
    get canvas(){return size;},
    render(list,geometry,options){
      if(disposed)throw new Error("render-webgl2: renderer was disposed");
      const contentW=Math.ceil(geometry.content.width),contentH=Math.ceil(geometry.content.height);if(gl.canvas.width!==contentW||gl.canvas.height!==contentH){gl.canvas.width=contentW;gl.canvas.height=contentH;}size={width:contentW,height:contentH};
      const bounds=marginBounds(list,geometry);const roots=[targetAt(targets,0,list.width,list.height),targetAt(targets,1,bounds.width,bounds.height)];
      surfacePixels.clear();
      usedSurfaceUploads.clear();
      const diagnostics:string[]=[];const byKind:{[kind:string]:number}={};const defer=(kind:string,why:string)=>{byKind[kind]=(byKind[kind]??0)+1;if(!diagnostics.includes(why))diagnostics.push(why);};
      const a=drawCommands(list.commands,{width:list.width,height:list.height},{x:0,y:0},roots[0]!,scratch[0]!,options,defer);
      const b=drawCommands(list.marginCommands,{width:bounds.width,height:bounds.height},{x:bounds.left,y:bounds.top},roots[1]!,scratch[1]!,options,defer);
      for(const [key,value] of uploads) if(key.startsWith("surface:")&&!usedSurfaceUploads.has(key)){gl.deleteTexture(value.texture);uploads.delete(key);}
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,contentW,contentH);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(presentProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,roots[0]!.texture);gl.uniform1i(present.game,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,roots[1]!.texture);gl.uniform1i(present.margin,1);gl.uniform2f(present.content,geometry.content.width,geometry.content.height);gl.uniform4f(present.gameRect,geometry.game.x,geometry.game.y,geometry.game.width,geometry.game.height);gl.uniform4f(present.safe,geometry.safeArea.left,geometry.safeArea.top,geometry.safeArea.right,geometry.safeArea.bottom);gl.uniform2i(present.logical,list.width,list.height);gl.uniform4i(present.bounds,bounds.left,bounds.right,bounds.top,bounds.bottom);gl.uniform2i(present.marginSize,bounds.width,bounds.height);gl.drawArrays(gl.TRIANGLES,0,3);
      return {drawn:a.drawn+b.drawn,deferred:a.deferred+b.deferred,deferredByKind:byKind,diagnostics};
    },
    flush(){if(disposed)return;for(const value of uploads.values())gl.deleteTexture(value.texture);uploads.clear();surfacePixels.clear();},
    dispose(){if(disposed)return;this.flush();disposeTargets(targets);for(const pool of scratch)disposeTargets(pool);gl.deleteBuffer(quad);gl.deleteBuffer(pointBuffer);gl.deleteProgram(replayProgram);gl.deleteProgram(presentProgram);disposed=true;},
  };
}
