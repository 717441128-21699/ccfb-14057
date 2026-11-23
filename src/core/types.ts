/**
 * 全局领域类型：像素源、分类参数、网格、轮廓站点与报告。
 * 坐标约定：全分辨率像素坐标 (x,y)，原点在左上角，y 向下。
 */

/** 一块亮度图块（CPU/合成源按块产出，避免 1 亿像素一次性驻留） */
export interface PixelTile {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 长度 width*height，亮度 0..255 */
  luma: Float32Array;
}

/** 超大图像的分块像素源 */
export interface PixelSource {
  readonly width: number;
  readonly height: number;
  /** 越界部分由实现负责 clamp/填背景 */
  readTile(x: number, y: number, w: number, h: number): PixelTile;
}

/** 铁素体/珠光体分类参数 */
export interface ClassParams {
  /** 亮度阈值：亮于此且局部方差低 → 铁素体 */
  lumaThreshold: number;
  /** 局部方差阈值：高于此 → 珠光体（层片纹理） */
  varianceThreshold: number;
  /** 背景（镶嵌料/树脂）亮度参考，低于 borderLuma*判定系数视为试样外 */
  borderLuma: number;
  /** 下采样网格边长（全分辨率像素） */
  cellSize: number;
  /** 局部方差窗口半径（像素），2 表示 5x5 */
  varianceRadius: number;
}

/** 分析/判定参数（长度均为 µm） */
export interface AnalysisParams {
  /** 标定：每像素对应微米数 */
  umPerPixel: number;
  /** 轮廓布站间距 µm */
  stationSpacingUm: number;
  /** 轮廓高斯平滑 σ µm */
  smoothSigmaUm: number;
  /** 最小允许曲率半径 µm，低于此判为倒角/抛光圆角并排除 */
  minRadiusUm: number;
  /** 距图框小于此像素数的站点排除 */
  edgeMarginPx: number;
  /** 全脱碳判定：铁素体比高于 1-该值 视为纯铁素体区 */
  fullFerriteTol: number;
  /** 心部铁素体基线；null 表示由剖面深尾自动估计 */
  coreFerriteFraction: number | null;
  /** 总脱碳判定：回到基线 ± 该绝对容差 */
  coreTolAbs: number;
  /** 判定所需持续长度 µm（抗噪声） */
  minRunUm: number;
  /** 法向剖面最大探测深度 µm */
  maxDepthUm: number;
}

/** 下采样面积比网格 */
export interface FractionGrid {
  /** 网格列/行数 */
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  imageWidth: number;
  imageHeight: number;
  /** 每格铁素体占金属面积比 0..1 */
  ferrite: Float32Array;
  /** 每格金属（非背景）占比 0..1 */
  metal: Float32Array;
}

/** 沿轮廓的一个测量站 */
export interface Station {
  id: number;
  /** 轮廓点（全分辨率像素） */
  x: number;
  y: number;
  /** 指向材料内部的单位法向量 */
  nx: number;
  ny: number;
  /** 沿轮廓的弧长位置 µm */
  arcUm: number;
  /** 曲率 1/像素（带符号） */
  curvature: number;
  /** 曲率半径 µm */
  radiusUm: number;
  /** 标定 µm/px，便于 UI 直接换算深度色带长度 */
  umPerPixel: number;
  excluded: boolean;
  excludeReason: string | null;
  /** 全脱碳层深度 µm（边缘到珠光体首次持续出现） */
  fullDepthUm: number | null;
  /** 总脱碳层深度 µm（边缘到铁素体比恢复心部基线） */
  totalDepthUm: number | null;
  /** 法向剖面采样（调试/点击查看用） */
  profile: ProfilePoint[];
}

export interface ProfilePoint {
  depthUm: number;
  ferrite: number;
  metal: number;
}

export interface DepthStat {
  maxUm: number;
  meanUm: number;
  medianUm: number;
  p95Um: number;
}

export interface DecarbReport {
  createdAt: string;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  umPerPixel: number;
  perimeterUm: number;
  stationCount: number;
  validCount: number;
  excludedCount: number;
  total: DepthStat;
  full: DepthStat;
  deepest: {
    stationId: number;
    xPx: number;
    yPx: number;
    arcUm: number;
    totalDepthUm: number;
    fullDepthUm: number | null;
  };
  stations: Station[];
  params: AnalysisParams;
  classParams: ClassParams;
  timingMs: Record<string, number>;
}

/** 分类引擎接口（WebGL2 / CPU 两个实现） */
export interface AnalysisEngine {
  readonly kind: 'webgl2' | 'cpu';
  classify(source: PixelSource, params: ClassParams): Promise<FractionGrid>;
  dispose(): void;
}

export function defaultClassParams(): ClassParams {
  return {
    lumaThreshold: 150,
    varianceThreshold: 90,
    borderLuma: 60,
    cellSize: 8,
    varianceRadius: 2,
  };
}

export function defaultAnalysisParams(umPerPixel = 0.5): AnalysisParams {
  return {
    umPerPixel,
    stationSpacingUm: 5,
    smoothSigmaUm: 5,
    minRadiusUm: 80,
    edgeMarginPx: 24,
    fullFerriteTol: 0.08,
    coreFerriteFraction: null,
    coreTolAbs: 0.04,
    minRunUm: 8,
    maxDepthUm: 1000,
  };
}
