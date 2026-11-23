import type { PixelSource, PixelTile } from '../core/types.ts';

/**
 * 基于解码位图的像素源。
 * 用离屏 canvas 按块读取亮度，避免整张 1 亿像素位图同时驻留 JS 堆。
 */
export class ImageBitmapSource implements PixelSource {
  readonly width: number;
  readonly height: number;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private canvas: OffscreenCanvas | HTMLCanvasElement;

  private constructor(bitmap: ImageBitmap | HTMLImageElement) {
    this.width = bitmap.width as number;
    this.height = bitmap.height as number;
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(this.width, this.height);
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
    this.ctx = ctx;
  }

  static async fromFile(file: File | Blob): Promise<ImageBitmapSource> {
    const bmp = await createImageBitmap(file);
    return new ImageBitmapSource(bmp);
  }

  readTile(x: number, y: number, w: number, h: number): PixelTile {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    const tw = x1 - x0;
    const th = y1 - y0;
    const img = this.ctx.getImageData(x0, y0, tw, th);
    const luma = new Float32Array(tw * th);
    const d = img.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      // Rec. 601 亮度
      luma[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return { x: x0, y: y0, width: tw, height: th, luma };
  }
}
