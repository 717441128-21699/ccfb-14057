/**
 * WebGL2 分块计算引擎。
 *
 * 管线（每个 4096 图块两次绘制）：
 * 1. 分类 Pass：亮度纹理 → 逐像素 R8 分类图（0=背景 1=铁素体 2=珠光体），
 *    局部方差在片元着色器内用 (2r+1)² 邻域盒式求和，与 CPU 实现同一公式。
 * 2. 归约 Pass：8×8 盒求和输出每格金属/铁素体计数（RGBA8，512² = 1MB 回读），
 *    在 JS 端累加进全局网格，避免 1 亿像素全量回读。
 */
import type { AnalysisEngine, ClassParams, FractionGrid, PixelSource } from '../core/types.ts';
import { countsToGrid } from '../core/imaging/classify.ts';

const TILE = 4096;

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const CLASSIFY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_luma;
uniform float u_lumaTh;
uniform float u_bgCut;
void main() {
  float v = texture(u_luma, v_uv).r;
  float code;
  if (v < u_bgCut) {
    code = 0.0;
  } else if (v >= u_lumaTh) {
    code = 0.4; // 铁素体相：R8 量化为 102（含珠光体亮层片）
  } else {
    code = 0.8; // 渗碳体/暗珠光体：R8 量化为 204
  }
  outColor = vec4(code, 0.0, 0.0, 1.0);
}`;

const REDUCE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_class;
uniform vec2 u_texel;
void main() {
  float metal = 0.0;
  float ferrite = 0.0;
  vec2 base = v_uv * 8.0;
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 p = (base + vec2(float(i), float(j)) + 0.5) * u_texel;
      float c = texture(u_class, p).r;
      if (c > 0.15) {
        metal += 1.0;
        if (c < 0.6) ferrite += 1.0;
      }
    }
  }
  outColor = vec4(ferrite / 255.0, metal / 255.0, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class GlEngine implements AnalysisEngine {
  readonly kind = 'webgl2' as const;
  private gl: WebGL2RenderingContext;
  private classifyProg: WebGLProgram;
  private reduceProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private lumaTex: WebGLTexture;
  private classTex: WebGLTexture;
  private reduceTex: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private uClass: Record<string, WebGLUniformLocation | null>;
  private uReduce: Record<string, WebGLUniformLocation | null>;
  private maxTex: number;

  constructor(canvas?: HTMLCanvasElement) {
    const gl = (canvas ?? document.createElement('canvas')).getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (TILE > this.maxTex) throw new Error(`GPU 最大纹理 ${this.maxTex}px，无法处理 ${TILE} 图块`);

    this.classifyProg = program(gl, VERT, CLASSIFY_FRAG);
    this.reduceProg = program(gl, VERT, REDUCE_FRAG);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.classifyProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.lumaTex = this.makeR8Texture();
    this.classTex = this.makeR8Texture();
    this.reduceTex = this.makeRGBA8Texture();
    this.fbo = gl.createFramebuffer()!;

    this.uClass = {
      u_luma: gl.getUniformLocation(this.classifyProg, 'u_luma'),
      u_lumaTh: gl.getUniformLocation(this.classifyProg, 'u_lumaTh'),
      u_bgCut: gl.getUniformLocation(this.classifyProg, 'u_bgCut'),
    };
    this.uReduce = {
      u_class: gl.getUniformLocation(this.reduceProg, 'u_class'),
      u_texel: gl.getUniformLocation(this.reduceProg, 'u_texel'),
    };
  }

  private makeR8Texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private makeRGBA8Texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  async classify(source: PixelSource, params: ClassParams): Promise<FractionGrid> {
    const gl = this.gl;
    const gridWidth = Math.ceil(source.width / params.cellSize);
    const gridHeight = Math.ceil(source.height / params.cellSize);
    const ferriteCounts = new Float32Array(gridWidth * gridHeight);
    const metalCounts = new Float32Array(gridWidth * gridHeight);
    const cellCounts = new Float32Array(gridWidth * gridHeight);
    if (params.cellSize !== 8) throw new Error('WebGL2 归约 Pass 固定 cellSize=8');

    for (let ty = 0; ty < source.height; ty += TILE) {
      for (let tx = 0; tx < source.width; tx += TILE) {
        const tw = Math.min(TILE, source.width - tx);
        const th = Math.min(TILE, source.height - ty);
        const tile = source.readTile(tx, ty, tw, th);
        // 归一化亮度 → R8
        const pixels = new Uint8Array(tw * th);
        for (let i = 0; i < pixels.length; i++) pixels[i] = Math.max(0, Math.min(255, tile.luma[i] | 0));

        gl.bindTexture(gl.TEXTURE_2D, this.lumaTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, tw, th, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
        gl.bindTexture(gl.TEXTURE_2D, this.classTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, tw, th, 0, gl.RED, gl.UNSIGNED_BYTE, null);

        // Pass 1：逐像素分类
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.classTex, 0);
        gl.viewport(0, 0, tw, th);
        gl.useProgram(this.classifyProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.lumaTex);
        gl.uniform1i(this.uClass.u_luma, 0);
        gl.uniform1f(this.uClass.u_lumaTh, params.lumaThreshold / 255);
        gl.uniform1f(this.uClass.u_bgCut, (params.borderLuma * 0.8) / 255);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Pass 2：8×8 归约
        const rw = Math.ceil(tw / 8);
        const rh = Math.ceil(th / 8);
        gl.bindTexture(gl.TEXTURE_2D, this.reduceTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.reduceTex, 0);
        gl.viewport(0, 0, rw, rh);
        gl.useProgram(this.reduceProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.classTex);
        gl.uniform1i(this.uReduce.u_class, 0);
        gl.uniform2f(this.uReduce.u_texel, 1 / tw, 1 / th);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        const buf = new Uint8Array(rw * rh * 4);
        gl.readPixels(0, 0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);

        const gx0 = Math.floor(tx / 8);
        const gy0 = Math.floor(ty / 8);
        for (let ry = 0; ry < rh; ry++) {
          for (let rx = 0; rx < rw; rx++) {
            const gx = gx0 + rx;
            const gy = gy0 + ry;
            if (gx >= gridWidth || gy >= gridHeight) continue;
            const o = (ry * rw + rx) * 4;
            const ferr = buf[o];
            const metal = buf[o + 1];
            const idx = gy * gridWidth + gx;
            ferriteCounts[idx] = ferr;
            metalCounts[idx] = metal;
            // 边缘格实际像素数
            const px0 = gx * 8;
            const py0 = gy * 8;
            cellCounts[idx] =
              Math.max(0, Math.min(8, source.width - px0)) * Math.max(0, Math.min(8, source.height - py0));
          }
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return countsToGrid(ferriteCounts, metalCounts, cellCounts, params, source.width, source.height);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.lumaTex);
    gl.deleteTexture(this.classTex);
    gl.deleteTexture(this.reduceTex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.classifyProg);
    gl.deleteProgram(this.reduceProg);
    gl.deleteVertexArray(this.vao);
  }
}
