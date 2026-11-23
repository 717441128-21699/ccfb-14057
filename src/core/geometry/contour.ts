import type { FractionGrid } from '../types.ts';
import { medianCircular, smoothCircular } from '../math/numerics.ts';

export interface ContourPoint {
  x: number;
  y: number;
}

/**
 * Marching Squares 在金属占比网格上提取试样边缘（阈值 0.5）。
 * 顶点 (c,r) 位于像素坐标 (c*cellSize, r*cellSize)，取周围 4 格的金属占比均值。
 * 返回最大环（试样外轮廓），方向统一为逆时针（内部在左侧）。
 */
export function extractContour(grid: FractionGrid): ContourPoint[] {
  const { gridWidth: gw, gridHeight: gh, cellSize, metal } = grid;

  const vertexMetal = new Float32Array((gw + 1) * (gh + 1));
  for (let r = 0; r <= gh; r++) {
    for (let c = 0; c <= gw; c++) {
      // 共享顶点 (c,r) 的 4 个格：左上(c-1,r-1)、右上(c,r-1)、左下(c-1,r)、右下(c,r)
      let sum = 0;
      let cnt = 0;
      for (let dr = -1; dr <= 0; dr++) {
        for (let dc = -1; dc <= 0; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < gh && cc >= 0 && cc < gw) {
            sum += metal[rr * gw + cc];
            cnt++;
          }
        }
      }
      vertexMetal[r * (gw + 1) + c] = cnt ? sum / cnt : 0;
    }
  }

  const LEVEL = 0.5;
  // 边段哈希：key -> 端点，用于把线段拼成环
  interface Seg {
    ax: number;
    ay: number;
    bx: number;
    by: number;
  }
  const segments: Seg[] = [];

  const interp = (va: number, vb: number, pa: [number, number], pb: [number, number]): [number, number] => {
    const t = (LEVEL - va) / (vb - va || 1e-9);
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  };

  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const i00 = r * (gw + 1) + c;
      const i10 = i00 + 1;
      const i01 = i00 + (gw + 1);
      const i11 = i01 + 1;
      const v00 = vertexMetal[i00];
      const v10 = vertexMetal[i10];
      const v01 = vertexMetal[i01];
      const v11 = vertexMetal[i11];
      const p00: [number, number] = [c * cellSize, r * cellSize];
      const p10: [number, number] = [(c + 1) * cellSize, r * cellSize];
      const p11: [number, number] = [(c + 1) * cellSize, (r + 1) * cellSize];
      const p01: [number, number] = [c * cellSize, (r + 1) * cellSize];

      const idx = (v00 > LEVEL ? 1 : 0) | (v10 > LEVEL ? 2 : 0) | (v11 > LEVEL ? 4 : 0) | (v01 > LEVEL ? 8 : 0);
      if (idx === 0 || idx === 15) continue;

      const push = (pa: [number, number], pb: [number, number]) => {
        const [ax, ay] = pa;
        const [bx, by] = pb;
        segments.push({ ax, ay, bx, by });
      };
      // 每条等值线段：低端值顶点 → 高端值顶点，保证方向一致
      const edgeB = interp(v00, v10, p00, p10);
      const edgeR = interp(v10, v11, p10, p11);
      const edgeT = interp(v01, v11, p01, p11);
      const edgeL = interp(v00, v01, p00, p01);

      switch (idx) {
        case 1: push(edgeB, edgeL); break;
        case 2: push(edgeR, edgeB); break;
        case 3: push(edgeR, edgeL); break;
        case 4: push(edgeT, edgeR); break;
        case 5: // 鞍点：按平均金属值消歧
          if ((v00 + v11) / 2 > LEVEL) { push(edgeB, edgeL); push(edgeT, edgeR); }
          else { push(edgeB, edgeR); push(edgeT, edgeL); }
          break;
        case 6: push(edgeT, edgeB); break;
        case 7: push(edgeT, edgeL); break;
        case 8: push(edgeL, edgeT); break;
        case 9: push(edgeB, edgeT); break;
        case 10: // 鞍点
          if ((v00 + v11) / 2 > LEVEL) { push(edgeR, edgeB); push(edgeL, edgeT); }
          else { push(edgeB, edgeT); push(edgeL, edgeR); }
          break;
        case 11: push(edgeR, edgeT); break;
        case 12: push(edgeL, edgeR); break;
        case 13: push(edgeB, edgeR); break;
        case 14: push(edgeL, edgeB); break;
      }
    }
  }

  if (segments.length === 0) return [];

  // 端点量化到网格子像素，做端点拼接
  const Q = 1024;
  const key = (x: number, y: number) => `${Math.round(x * Q / cellSize)},${Math.round(y * Q / cellSize)}`;
  const byStart = new Map<string, Seg[]>();
  for (const s of segments) {
    const k = key(s.ax, s.ay);
    const arr = byStart.get(k);
    if (arr) arr.push(s);
    else byStart.set(k, [s]);
  }

  const loops: ContourPoint[][] = [];
  const used = new Set<Seg>();
  for (const first of segments) {
    if (used.has(first)) continue;
    const loop: ContourPoint[] = [{ x: first.ax, y: first.ay }];
    let cur = first;
    used.add(cur);
    let guard = 0;
    for (;;) {
      loop.push({ x: cur.bx, y: cur.by });
      if (++guard > segments.length + 2) break;
      const nextArr = byStart.get(key(cur.bx, cur.by));
      const next = nextArr?.find((s) => !used.has(s));
      if (!next) break;
      cur = next;
      used.add(cur);
      if (cur === first) break;
    }
    if (loop.length >= 8) loops.push(loop);
  }

  if (loops.length === 0) return [];
  // 取包围面积最大的环作为试样外轮廓
  let best = loops[0];
  let bestArea = -Infinity;
  for (const loop of loops) {
    const a = signedArea(loop);
    if (Math.abs(a) > Math.abs(bestArea)) {
      bestArea = a;
      best = loop;
    }
  }
  // 统一为逆时针（signedArea > 0）
  if (signedArea(best) < 0) best.reverse();
  return best;
}

function signedArea(loop: ContourPoint[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export interface SmoothContour {
  points: ContourPoint[];
  /** 指向材料内部的单位法向量（逆时针轮廓 = 左法线） */
  normals: { x: number; y: number }[];
  /** 曲率 1/像素 */
  curvature: Float32Array;
  /** 累计弧长（像素） */
  arcPx: Float32Array;
}

/**
 * 对闭合轮廓按固定弧长重采样，再做环形高斯平滑，并计算内法线与曲率。
 * 位置/法线用 positionSigma（轻平滑，跟随真实边缘），
 * 曲率用 curvatureSigma（重平滑，抑制离散噪声，恒定曲率的圆不受影响）。
 */
export function resampleAndSmooth(
  loop: ContourPoint[],
  spacingPx: number,
  positionSigmaPx: number,
  _curvatureSigmaPx = positionSigmaPx * 3,
): SmoothContour {
  const n0 = loop.length;
  // 累计弧长
  const cum = new Float32Array(n0 + 1);
  for (let i = 1; i <= n0; i++) {
    const a = loop[i - 1];
    const b = i === n0 ? loop[0] : loop[i];
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[n0];
  const count = Math.max(16, Math.floor(total / spacingPx));
  const pts: ContourPoint[] = new Array(count);
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const d = (i / count) * total;
    while (seg < n0 - 1 && cum[seg + 1] < d) seg++;
    const d0 = cum[seg];
    const d1 = cum[seg + 1];
    const t = (d - d0) / (d1 - d0 || 1e-9);
    const a = loop[seg];
    const b = seg + 1 === n0 ? loop[0] : loop[seg + 1];
    pts[i] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  const xs = smoothCircular(Float32Array.from(pts, (p) => p.x), positionSigmaPx / spacingPx);
  const ys = smoothCircular(Float32Array.from(pts, (p) => p.y), positionSigmaPx / spacingPx);
  const points: ContourPoint[] = Array.from({ length: count }, (_, i) => ({ x: xs[i], y: ys[i] }));

  const normals = new Array<{ x: number; y: number }>(count);
  const rawCurvature = new Float32Array(count);
  const arcPx = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1e-9;
    // 逆时针 → 左法线 = (-ty, tx)
    normals[i] = { x: -ty / len, y: tx / len };

    const pp = points[(i - 2 + count) % count];
    const nn = points[(i + 2) % count];
    const dx1 = points[i].x - pp.x;
    const dy1 = points[i].y - pp.y;
    const dx2 = nn.x - points[i].x;
    const dy2 = nn.y - points[i].y;
    const l1 = Math.hypot(dx1, dy1) || 1e-9;
    const l2 = Math.hypot(dx2, dy2) || 1e-9;
    const cross = (dx1 * dy2 - dy1 * dx2) / (l1 * l2);
    const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
    // 离散曲率 ≈ 转角 / 平均弦长
    rawCurvature[i] = Math.atan2(cross, dot) / ((l1 + l2) / 2);
    arcPx[i] = (i / count) * total;
  }
  // 曲率用环形中值滤波：抑制网格离散噪声，同时保留倒角处的低半径尖角
  const curvature = medianCircular(rawCurvature, Math.max(2, Math.round(6 / spacingPx)));
  return { points, normals, curvature, arcPx };
}
