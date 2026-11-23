import type {
  AnalysisEngine,
  AnalysisParams,
  ClassParams,
  DecarbReport,
  FractionGrid,
  PixelSource,
  Station,
} from './types.ts';
import { extractContour, resampleAndSmooth } from './geometry/contour.ts';
import { buildStations } from './geometry/boundary.ts';
import { stats, medianCircular, smoothCircular } from './math/numerics.ts';

export interface PipelineResult {
  report: DecarbReport;
  grid: FractionGrid;
}

class Timer {
  readonly marks: Record<string, number> = {};
  private t0 = performance.now();
  mark(name: string): void {
    const now = performance.now();
    this.marks[name] = +(now - this.t0).toFixed(2);
    this.t0 = now;
  }
}

/**
 * 沿轮廓弧长对深度序列做稳健离群抑制：
 * 用环形中值（窗口 5）得到局部参考，仅替换偏离参考超过 15µm 的站，
 * 非离群站保留原始测量值——既剔除像素级噪声跳变，又不抹平真实深度变化。
 */
function stabilizeDepthAlongArc(stations: Station[]): void {
  const n = stations.length;
  if (n < 10) return;
  for (const field of ['totalDepthUm', 'fullDepthUm'] as const) {
    const raw = new Float32Array(stations.map((s) => (!s.excluded && s[field] != null ? s[field]! : NaN)));
    const validIdx: number[] = [];
    raw.forEach((v, i) => { if (Number.isFinite(v)) validIdx.push(i); });
    if (validIdx.length < 8) continue;
    const filled = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(raw[i])) { filled[i] = raw[i]; continue; }
      let best = validIdx[0];
      let bd = Infinity;
      for (const j of validIdx) {
        const d = Math.min(Math.abs(i - j), n - Math.abs(i - j));
        if (d < bd) { bd = d; best = j; }
      }
      filled[i] = raw[best];
    }
    const med = medianCircular(filled, 5);
    const sm = smoothCircular(med, 1.2);
    stations.forEach((s, i) => {
      if (!s.excluded && s[field] != null) s[field] = sm[i];
    });
  }
}

function depthStats(stations: Station[], pick: (s: Station) => number | null) {
  const vals = stations.filter((s) => !s.excluded).map(pick).filter((v): v is number => v !== null);
  const s = stats(vals);
  return { maxUm: s.max, meanUm: s.mean, medianUm: s.median, p95Um: s.p95 };
}

/**
 * 完整分析管线。分类由可替换引擎执行（WebGL2/CPU），几何与判定为纯 TS。
 */
export async function runPipeline(
  source: PixelSource,
  imageName: string,
  classParams: ClassParams,
  analysisParams: AnalysisParams,
  engine: AnalysisEngine,
): Promise<PipelineResult> {
  const timer = new Timer();

  const grid = await engine.classify(source, classParams);
  timer.mark('classify');

  const rawLoop = extractContour(grid);
  if (rawLoop.length < 8) {
    throw new Error('未能识别试样边缘：请检查背景阈值或图像质量');
  }
  timer.mark('contour');

  const spacingPx = analysisParams.stationSpacingUm / analysisParams.umPerPixel;
  const sigmaPx = analysisParams.smoothSigmaUm / analysisParams.umPerPixel;
  const smooth = resampleAndSmooth(rawLoop, spacingPx, sigmaPx);
  const stations = buildStations(smooth, grid, analysisParams);
  stabilizeDepthAlongArc(stations);
  timer.mark('stations');

  const valid = stations.filter((s) => !s.excluded);
  const total = depthStats(stations, (s) => s.totalDepthUm);
  const full = depthStats(stations, (s) => s.fullDepthUm);

  let deepest: DecarbReport['deepest'] | null = null;
  for (const s of valid) {
    if (s.totalDepthUm === null) continue;
    if (!deepest || s.totalDepthUm > deepest.totalDepthUm) {
      deepest = {
        stationId: s.id,
        xPx: s.x,
        yPx: s.y,
        arcUm: s.arcUm,
        totalDepthUm: s.totalDepthUm,
        fullDepthUm: s.fullDepthUm,
      };
    }
  }
  if (!deepest) throw new Error('所有测量站均被排除，请放宽排除参数后重试');

  const perimeterUm = smooth.arcPx[smooth.arcPx.length - 1] * analysisParams.umPerPixel;
  timer.mark('report');

  const report: DecarbReport = {
    createdAt: new Date().toISOString(),
    imageName,
    imageWidth: source.width,
    imageHeight: source.height,
    umPerPixel: analysisParams.umPerPixel,
    perimeterUm,
    stationCount: stations.length,
    validCount: valid.length,
    excludedCount: stations.length - valid.length,
    total,
    full,
    deepest,
    stations,
    params: analysisParams,
    classParams,
    timingMs: timer.marks,
  };
  return { report, grid };
}
