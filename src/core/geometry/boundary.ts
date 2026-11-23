import type { AnalysisParams, FractionGrid, ProfilePoint, Station } from '../types.ts';
import type { SmoothContour } from './contour.ts';
import { sampleGrid } from '../imaging/grid.ts';

/**
 * 法向剖面：从轮廓点沿内法线按半格步长采样。
 * 深度硬终点（任一触发即停）：
 * 1) 穿出试样：进入金属后又连续遇背景（到达对侧边缘）；
 * 2) 对侧脱碳污染：确认心部平台后铁素体比持续二次升高；
 * 3) depthCapUm / maxDepthUm 上限。
 */
function sampleProfile(
  grid: FractionGrid,
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  params: AnalysisParams,
  depthCapUm = Infinity,
): ProfilePoint[] {
  const stepPx = Math.max(1, grid.cellSize / 2);
  const effectiveMaxUm = Math.min(params.maxDepthUm, depthCapUm);
  const maxSteps = Math.ceil(effectiveMaxUm / params.umPerPixel / stepPx);
  const out: ProfilePoint[] = [];
  let enteredMetal = false;
  let exitBgRun = 0;
  // 心部定位：追踪滑动最低值，其后铁素体比持续回升即判进入对侧脱碳层
  let minFerrite = 1;
  let minIndex = -1;
  let riseCount = 0;
  for (let i = 0; i <= maxSteps; i++) {
    const dPx = i * stepPx;
    const metal = sampleGrid(grid, 'metal', x0 + nx * dPx, y0 + ny * dPx);
    const ferrite = sampleGrid(grid, 'ferrite', x0 + nx * dPx, y0 + ny * dPx);
    out.push({ depthUm: dPx * params.umPerPixel, ferrite, metal });

    if (metal >= 0.5) {
      enteredMetal = true;
      exitBgRun = 0;
      // 仍在下降或创新低 → 更新最低点（要求已深入材料，跳过前缘混合区）
      if (i >= 6 && ferrite <= minFerrite + 0.02) {
        minFerrite = Math.min(minFerrite, ferrite);
        minIndex = i;
        riseCount = 0;
      } else if (minIndex >= 0 && ferrite > minFerrite + Math.max(0.12, minFerrite * 0.8)) {
        // 越过最低点后持续显著回升 → 对侧脱碳层
        riseCount++;
        if (riseCount >= 4) {
          out.length = Math.max(0, out.length - 3);
          break;
        }
      } else {
        riseCount = 0;
      }
    } else if (enteredMetal) {
      exitBgRun++;
      if (exitBgRun >= 6) {
        out.length = Math.max(0, out.length - 5);
        break;
      }
    }
  }
  return out;
}

/** 去掉剖面前缘金属不足的混合/背景点，并把深度零点平移到首个有效金属点 */
function trimLeadingBackground(profile: ProfilePoint[]): ProfilePoint[] {
  const firstMetal = profile.findIndex((p) => p.metal >= 0.5);
  if (firstMetal <= 0) return profile;
  const d0 = profile[firstMetal].depthUm;
  return profile.slice(firstMetal).map((p) => ({ ...p, depthUm: p.depthUm - d0 }));
}

/** 去掉剖面尾部穿出试样的背景段 */
function trimTrailingBackground(profile: ProfilePoint[]): ProfilePoint[] {
  let lastMetal = profile.length - 1;
  while (lastMetal >= 0 && profile[lastMetal].metal < 0.5) lastMetal--;
  return lastMetal < profile.length - 1 ? profile.slice(0, lastMetal + 1) : profile;
}

/** 对剖面铁素体/金属比做轻量滑动平均（窗口 5 点 ≈ 10µm），抑制网格采样抖动 */
function smoothProfile(profile: ProfilePoint[]): ProfilePoint[] {
  if (profile.length < 7) return profile;
  const R = 2;
  return profile.map((p, i) => {
    let sf = 0, sm = 0, n = 0;
    for (let k = -R; k <= R; k++) {
      const j = i + k;
      if (j >= 0 && j < profile.length) {
        sf += profile[j].ferrite;
        sm += profile[j].metal;
        n++;
      }
    }
    return { depthUm: p.depthUm, ferrite: sf / n, metal: sm / n };
  });
}

/**
 * 稳健心部基线估计。
 * 心部是整条剖面的最低稳定平台：滑动窗口找均值最低且平稳（极差 ≤ 0.14）的窗口。
 * 窗口随剖面长度自适应，平台较短时用小窗口；找不到则回退到低分位数。
 */
export function estimateCoreBaseline(profile: ProfilePoint[], _tol = 0.08): number {
  const vals = profile.filter((p) => p.metal >= 0.5).map((p) => p.ferrite);
  if (vals.length < 8) return 0;
  const WINDOW = Math.max(5, Math.min(10, Math.floor(vals.length / 6)));
  let bestStart = -1;
  let bestMean = 1;
  for (let i = 0; i + WINDOW <= vals.length; i++) {
    const win = vals.slice(i, i + WINDOW);
    const mean = win.reduce((a, b) => a + b, 0) / WINDOW;
    const spread = Math.max(...win) - Math.min(...win);
    if (spread <= 0.14 && mean < bestMean) {
      bestMean = mean;
      bestStart = i;
    }
  }
  if (bestStart < 0) {
    const sorted = [...vals].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.2)];
  }
  const win = vals.slice(bestStart, bestStart + WINDOW).sort((a, b) => a - b);
  return win[WINDOW >> 1];
}

/** 在 i、i-1 两点间按值线性插值求阈值穿越深度；阈值落在区间外时夹紧到段端点 */
function interpCross(p: ProfilePoint[], i: number, threshold: number, value: (x: ProfilePoint) => number): number {
  if (i <= 0) return p[0].depthUm;
  const a = value(p[i - 1]);
  const b = value(p[i]);
  const denom = b - a;
  if (Math.abs(denom) < 1e-6) return p[i].depthUm;
  const t = (threshold - a) / denom;
  const tc = Math.max(0, Math.min(1, t));
  return p[i - 1].depthUm + tc * (p[i].depthUm - p[i - 1].depthUm);
}

/** 首次持续满足谓词的深度；minRunUm 为所需持续长度，未找到返回 null */
function firstSustained(
  profile: ProfilePoint[],
  predicate: (p: ProfilePoint) => boolean,
  minRunUm: number,
): number | null {
  let runStart = -1;
  for (let i = 0; i < profile.length; i++) {
    if (predicate(profile[i])) {
      if (runStart < 0) runStart = i;
      if (profile[i].depthUm - profile[runStart].depthUm >= minRunUm) {
        return profile[runStart].depthUm;
      }
    } else {
      runStart = -1;
    }
  }
  return null;
}

export interface BoundaryResult {
  fullDepthUm: number | null;
  totalDepthUm: number | null;
  coreBaseline: number;
}

/**
 * GB/T 224 边界判定（基线由外部统一给定或自动估计）：
 * - 全脱碳层：铁素体比首次持续低于 1-fullFerriteTol 之处（珠光体持续出现）。
 * - 总脱碳层：铁素体比首次持续回到心部基线 ± coreTolAbs 带内之处。
 */
export function detectBoundaries(rawProfile: ProfilePoint[], params: AnalysisParams): BoundaryResult {
  const profile = smoothProfile(trimTrailingBackground(trimLeadingBackground(rawProfile)));
  const coreBaseline = params.coreFerriteFraction ?? estimateCoreBaseline(profile, params.coreTolAbs);
  const fullThreshold = 1 - params.fullFerriteTol;
  // 有效容差：绝对容差与基线相对容差（25%）取大，适应高/低心部基线
  const tol = Math.max(params.coreTolAbs, coreBaseline * 0.25);
  const metal = (p: ProfilePoint) => p.metal >= 0.5;

  const fullIdxDepth = firstSustained(
    profile,
    (p) => metal(p) && p.ferrite < fullThreshold,
    params.minRunUm,
  );
  let fullDepthUm: number | null = fullIdxDepth;
  if (fullIdxDepth !== null) {
    const i = profile.findIndex((p) => p.depthUm >= fullIdxDepth!);
    fullDepthUm = interpCross(profile, Math.max(1, i), fullThreshold, (p) => p.ferrite);
  }

  const totalIdxDepth = firstSustained(
    profile,
    (p) =>
      metal(p) &&
      p.ferrite >= coreBaseline - tol &&
      p.ferrite <= coreBaseline + tol,
    params.minRunUm,
  );
  let totalDepthUm: number | null = totalIdxDepth;
  if (totalIdxDepth !== null) {
    const i = profile.findIndex((p) => p.depthUm >= totalIdxDepth!);
    // 插值到基线本身（而非容差带上沿），消除系统性欠测偏差
    totalDepthUm = interpCross(profile, Math.max(1, i), coreBaseline, (p) => p.ferrite);
  }

  if (fullDepthUm !== null && totalDepthUm !== null && fullDepthUm > totalDepthUm) {
    fullDepthUm = null;
  }
  return { fullDepthUm, totalDepthUm, coreBaseline };
}

/**
 * 由平滑轮廓构建测量站并执行排除、剖面与边界判定。
 * 两遍处理：先采全部剖面并估计各站心部基线，汇总为全局稳健基线
 * （心部组织是材料常数，全局中位数抑制单站噪声/截断造成的基线抖动），
 * 再用统一基线回判各站边界。
 */
export function buildStations(
  contour: SmoothContour,
  grid: FractionGrid,
  params: AnalysisParams,
): Station[] {
  const { points, normals, curvature, arcPx } = contour;
  const n = points.length;
  const stations: Station[] = new Array(n);
  const profiles: (ProfilePoint[] | null)[] = new Array(n);
  const localBaselines: number[] = [];

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const radiusPx = Math.abs(curvature[i]) > 1e-12 ? 1 / Math.abs(curvature[i]) : Infinity;
    const radiusUm = radiusPx * params.umPerPixel;

    let excluded = false;
    let reason: string | null = null;

    const nearFrame =
      p.x < params.edgeMarginPx ||
      p.y < params.edgeMarginPx ||
      grid.imageWidth - p.x < params.edgeMarginPx ||
      grid.imageHeight - p.y < params.edgeMarginPx;
    if (nearFrame) {
      excluded = true;
      reason = '距图框过近';
    } else if (Number.isFinite(radiusUm) && radiusUm < params.minRadiusUm) {
      excluded = true;
      reason = `曲率半径 ${radiusUm.toFixed(0)}µm < 阈值 ${params.minRadiusUm}µm（倒角/抛光圆角）`;
    }

    const depthCapUm = Number.isFinite(radiusUm) ? radiusUm * 0.98 : Infinity;
    const profile = sampleProfile(grid, p.x, p.y, normals[i].x, normals[i].y, params, depthCapUm);
    if (!excluded) {
      const head = profile.slice(0, 4);
      const metalPts = head.filter((pp) => pp.metal >= 0.5).length;
      if (metalPts < 2) {
        excluded = true;
        reason = '边缘站点金属占比异常';
      }
    }
    if (!excluded) {
      profiles[i] = profile;
      const bl = estimateCoreBaseline(profile, params.coreTolAbs);
      if (bl > 0) localBaselines.push(bl);
    }

    stations[i] = {
      id: i,
      x: p.x,
      y: p.y,
      nx: normals[i].x,
      ny: normals[i].y,
      arcUm: arcPx[i] * params.umPerPixel,
      curvature: curvature[i],
      radiusUm,
      umPerPixel: params.umPerPixel,
      excluded,
      excludeReason: reason,
      fullDepthUm: null,
      totalDepthUm: null,
      profile,
    };
  }

  localBaselines.sort((a, b) => a - b);
  const globalBaseline = params.coreFerriteFraction
    ?? (localBaselines.length ? localBaselines[localBaselines.length >> 1] : 0);
  const effectiveParams = { ...params, coreFerriteFraction: globalBaseline };

  for (let i = 0; i < n; i++) {
    const profile = profiles[i];
    if (!profile) continue;
    const boundaries = detectBoundaries(profile, effectiveParams);
    stations[i].fullDepthUm = boundaries.fullDepthUm;
    stations[i].totalDepthUm = boundaries.totalDepthUm;
  }
  return stations;
}
