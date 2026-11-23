import type { PixelSource, PixelTile } from '../core/types.ts';

/** 内存型像素源（测试/合成预览复用） */
export class MemoryLumaSource implements PixelSource {
  readonly width: number;
  readonly height: number;
  private readonly luma: Float32Array;

  constructor(luma: Float32Array, width: number, height: number) {
    if (luma.length !== width * height) throw new Error('亮度数组尺寸不匹配');
    this.luma = luma;
    this.width = width;
    this.height = height;
  }

  readTile(x: number, y: number, w: number, h: number): PixelTile {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    const tw = x1 - x0;
    const th = y1 - y0;
    const out = new Float32Array(tw * th);
    for (let row = 0; row < th; row++) {
      const srcOff = (y0 + row) * this.width + x0;
      out.set(this.luma.subarray(srcOff, srcOff + tw), row * tw);
    }
    return { x: x0, y: y0, width: tw, height: th, luma: out };
  }
}
