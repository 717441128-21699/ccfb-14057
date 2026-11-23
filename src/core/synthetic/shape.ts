/**
 * 合成试样的有符号距离场（SDF）与真值脱碳深度。
 * d < 0 在试样内部；法向沿 ∇d 指向内部 = -∇d。
 */

export interface ShapeSpec {
  kind: 'circle' | 'rounded-rect' | 'wavy-circle';
  width: number;
  height: number;
  /** 名义全脱碳/总脱碳深度（像素），可被角度调制 */
  fullDepth: number;
  totalDepth: number;
  /** 深度沿周向的余弦调制幅度（比例），如 0.25 表示 ±25% */
  modulation: number;
  modulationPeriods: number;
  /** 圆角矩形倒角/圆角半径（像素），用于验证曲率排除 */
  cornerRadius: number;
}

export interface Shape extends ShapeSpec {
  sdf(x: number, y: number): number;
  /** 归一化内法线（指向材料内部） */
  inwardNormal(x: number, y: number): { x: number; y: number };
  /** 周向角 0..2π（用于深度调制与真值查询） */
  angleAt(x: number, y: number): number;
  /** 指定角度处的真值全脱碳/总脱碳深度（像素） */
  trueFullDepthAt(angle: number): number;
  trueTotalDepthAt(angle: number): number;
}

const TWO_PI = Math.PI * 2;

export function makeShape(spec: ShapeSpec): Shape {
  const cx = spec.width / 2;
  const cy = spec.height / 2;

  const depthScale = (angle: number): number =>
    1 + spec.modulation * Math.cos(spec.modulationPeriods * angle);

  if (spec.kind === 'circle' || spec.kind === 'wavy-circle') {
    const baseR = Math.min(cx, cy) * 0.82;
    const waveAmp = spec.kind === 'wavy-circle' ? baseR * 0.04 : 0;
    const waveN = 6;
    const radiusAt = (angle: number) => baseR + waveAmp * Math.sin(waveN * angle);

    return {
      ...spec,
      sdf(x, y) {
        const dx = x - cx;
        const dy = y - cy;
        const a = Math.atan2(dy, dx);
        return Math.hypot(dx, dy) - radiusAt(a);
      },
      inwardNormal(x, y) {
        if (waveAmp === 0) {
          const a = Math.atan2(y - cy, x - cx);
          return { x: -Math.cos(a), y: -Math.sin(a) };
        }
        // 波浪边缘：用 SDF 数值梯度求真实法线（含切向分量）
        const e = 0.5;
        const gx = this.sdf(x + e, y) - this.sdf(x - e, y);
        const gy = this.sdf(x, y + e) - this.sdf(x, y - e);
        const len = Math.hypot(gx, gy) || 1;
        return { x: -gx / len, y: -gy / len };
      },
      angleAt(x, y) {
        return (Math.atan2(y - cy, x - cx) + TWO_PI) % TWO_PI;
      },
      trueFullDepthAt(angle) {
        return spec.fullDepth * depthScale(angle);
      },
      trueTotalDepthAt(angle) {
        return spec.totalDepth * depthScale(angle);
      },
    };
  }

  // 圆角矩形（带倒角）：标准 box SDF
  const halfW = cx * 0.82;
  const halfH = cy * 0.82;
  const r = spec.cornerRadius;
  return {
    ...spec,
    sdf(x, y) {
      const qx = Math.abs(x - cx) - (halfW - r);
      const qy = Math.abs(y - cy) - (halfH - r);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
    },
    inwardNormal(x, y) {
      const e = 0.5;
      const gx = this.sdf(x + e, y) - this.sdf(x - e, y);
      const gy = this.sdf(x, y + e) - this.sdf(x, y - e);
      const len = Math.hypot(gx, gy) || 1;
      return { x: -gx / len, y: -gy / len };
    },
    angleAt(x, y) {
      return (Math.atan2(y - cy, x - cx) + TWO_PI) % TWO_PI;
    },
    trueFullDepthAt(angle) {
      return spec.fullDepth * depthScale(angle);
    },
    trueTotalDepthAt(angle) {
      return spec.totalDepth * depthScale(angle);
    },
  };
}
