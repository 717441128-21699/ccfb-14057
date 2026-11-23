import type { Shape } from './shape.ts';
import type { Station } from '../types.ts';

export interface TrueDepth {
  angle: number;
  fullDepthPx: number;
  totalDepthPx: number;
  fullDepthUm: number;
  totalDepthUm: number;
}

/** 沿整圈等角度采样真值深度 */
export function sampleTrueDepths(shape: Shape, count: number, umPerPixel: number): TrueDepth[] {
  const out: TrueDepth[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const fullPx = shape.trueFullDepthAt(angle);
    const totalPx = shape.trueTotalDepthAt(angle);
    out.push({
      angle,
      fullDepthPx: fullPx,
      totalDepthPx: totalPx,
      fullDepthUm: fullPx * umPerPixel,
      totalDepthUm: totalPx * umPerPixel,
    });
  }
  return out;
}

export interface AccuracyResult {
  /** 参与对比的有效站数 */
  compared: number;
  /** 总脱碳深度绝对误差（µm） */
  maxAbsErrorUm: number;
  meanAbsErrorUm: number;
  /** 全脱碳深度误差 */
  maxFullErrorUm: number;
  meanFullErrorUm: number;
  /** 超差站点（>20µm = 0.02mm）比例 */
  overToleranceRatio: number;
  perStation: Array<{
    stationId: number;
    angle: number;
    measuredTotalUm: number | null;
    trueTotalUm: number;
    absErrorUm: number;
  }>;
}

/**
 * 将测量站按角度与真值配对（找角度最近的真值样本），计算 GB/T 224 对照误差。
 */
export function evaluateAccuracy(
  stations: Station[],
  shape: Shape,
  trueDepths: TrueDepth[],
): AccuracyResult {
  const per: AccuracyResult['perStation'] = [];
  let maxAbs = 0;
  let sumAbs = 0;
  let maxFull = 0;
  let sumFull = 0;
  let fullCompared = 0;
  let over = 0;

  for (const s of stations) {
    if (s.excluded) continue;
    const angle = shape.angleAt(s.x, s.y);
    let best = trueDepths[0];
    let bestDelta = Infinity;
    for (const t of trueDepths) {
      let d = Math.abs(t.angle - angle);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < bestDelta) {
        bestDelta = d;
        best = t;
      }
    }
    if (s.totalDepthUm === null) continue;
    const err = Math.abs(s.totalDepthUm - best.totalDepthUm);
    maxAbs = Math.max(maxAbs, err);
    sumAbs += err;
    if (err > 20) over++;
    per.push({
      stationId: s.id,
      angle,
      measuredTotalUm: s.totalDepthUm,
      trueTotalUm: best.totalDepthUm,
      absErrorUm: err,
    });
    if (s.fullDepthUm !== null) {
      const ferr = Math.abs(s.fullDepthUm - best.fullDepthUm);
      maxFull = Math.max(maxFull, ferr);
      sumFull += ferr;
      fullCompared++;
    }
  }

  const compared = per.length;
  return {
    compared,
    maxAbsErrorUm: maxAbs,
    meanAbsErrorUm: compared ? sumAbs / compared : NaN,
    maxFullErrorUm: maxFull,
    meanFullErrorUm: fullCompared ? sumFull / fullCompared : NaN,
    overToleranceRatio: compared ? over / compared : NaN,
    perStation: per,
  };
}
