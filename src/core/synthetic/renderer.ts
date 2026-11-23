import type { PixelSource, PixelTile } from '../types.ts';
import { Rng } from '../math/rng.ts';
import type { Shape } from './shape.ts';

export interface SyntheticOptions {
  /** 珠光体心部铁素体面积比（弹簧钢通常 0.05~0.25） */
  coreFerriteFraction: number;
  seed: number;
}

/**
 * 合成金相图源：按需分块生成，不一次性持有整张 1 亿像素图像。
 *
 * 微观结构（统计意义上复现真实金相）：
 * - 全脱碳区：纯铁素体，高亮、低局部方差
 * - 部分脱碳区：铁素体占比从 100% 线性过渡到心部比例
 * - 珠光体：暗基体 + 方向性亮暗层片（高局部方差）
 * - 背景：暗镶嵌料 + 粗颗粒噪声
 */
export class SyntheticImageSource implements PixelSource {
  readonly width: number;
  readonly height: number;
  private readonly shape: Shape;
  private readonly opts: SyntheticOptions;

  constructor(shape: Shape, opts: SyntheticOptions) {
    this.shape = shape;
    this.opts = opts;
    this.width = shape.width;
    this.height = shape.height;
  }

  readTile(x: number, y: number, w: number, h: number): PixelTile {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    const tw = x1 - x0;
    const th = y1 - y0;
    const luma = new Float32Array(tw * th);

    for (let ly = 0; ly < th; ly++) {
      for (let lx = 0; lx < tw; lx++) {
        const gx = x0 + lx;
        const gy = y0 + ly;
        // 每个像素独立 RNG（由全局坐标+种子派生），保证分块读取结果与整图一致且噪声空间独立
        const rng = new Rng((this.opts.seed ^ Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0);
        const d = this.shape.sdf(gx, gy);
        let v: number;
        if (d >= 0) {
          // 背景：暗树脂 + 散粒颗粒噪声
          v = 34 + rng.gaussian() * 9;
        } else {
          const depth = -d;
          const angle = this.shape.angleAt(gx, gy);
          const full = this.shape.trueFullDepthAt(angle);
          const total = this.shape.trueTotalDepthAt(angle);
          let ferriteProb: number;
          if (depth <= full) {
            ferriteProb = 1;
          } else if (depth >= total) {
            ferriteProb = this.opts.coreFerriteFraction;
          } else {
            const t = (depth - full) / Math.max(1, total - full);
            ferriteProb = 1 + (this.opts.coreFerriteFraction - 1) * t;
          }

          if (rng.next() < ferriteProb) {
            // 铁素体晶粒：高亮、轻微晶内起伏
            v = 188 + rng.gaussian() * 7;
          } else {
            // 珠光体层片：空间频率 ~1/3 px⁻¹ 的方向性条纹 + 噪声
            const orient = Math.sin(gx * 0.73 + gy * 1.31) * 0.5;
            const lamella = Math.sin(gx * 2.1 + gy * 3.4 + orient * 4) > 0 ? 1 : 0;
            v = lamella ? 118 + rng.gaussian() * 10 : 62 + rng.gaussian() * 8;
          }
          // 照明缓变
          v += 8 * (gx / this.width - 0.5) + 6 * (gy / this.height - 0.5);
        }
        luma[ly * tw + lx] = Math.max(0, Math.min(255, v));
      }
    }
    return { x: x0, y: y0, width: tw, height: th, luma };
  }
}
