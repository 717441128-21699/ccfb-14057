import type { ClassParams, FractionGrid, PixelSource } from '../types.ts';

/**
 * Otsu 法自动亮度阈值（基于亮度直方图）。
 */
export function otsuThreshold(histogram: Uint32Array): number {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return 150;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 150;
  for (let i = 0; i < 256; i++) {
    wB += histogram[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = i;
    }
  }
  return threshold;
}

/** 对整张图（降采样预览）统计亮度直方图，供自动阈值使用 */
export function lumaHistogram(source: PixelSource, step = 4): Uint32Array {
  const hist = new Uint32Array(256);
  const tile = source.readTile(0, 0, source.width, source.height);
  for (let y = 0; y < tile.height; y += step) {
    for (let x = 0; x < tile.width; x += step) {
      hist[Math.max(0, Math.min(255, tile.luma[y * tile.width + x] | 0))]++;
    }
  }
  return hist;
}

/**
 * 纯函数：对一块亮度图逐像素分类，并把铁素体/金属计数累加进全局网格。
 *
 * 分类规则（与 GLSL 实现严格一致）：
 * - 局部方差用 (2r+1) 窗口的盒式滤波 E[I]、E[I²] 求 Var = E[I²]-E[I]²
 * - 背景：亮度 < borderLuma * 0.8
 * - 铁素体相：金属内亮度 ≥ lumaThreshold（含珠光体中的亮铁素体层片，
 *   这是 GB/T 224 铁素体面积比的物理含义；方差只描述层片组织，不用于分相）
 * - 渗碳体/暗珠光体：金属内的暗像素
 *
 * 图块可带 overlap；只处理写区域 [writeX, writeX+writeW) × [writeY, writeY+writeH)
 * （图块局部坐标）。
 */
export function classifyTileIntoGrid(
  luma: Float32Array,
  tileW: number,
  tileH: number,
  writeX: number,
  writeY: number,
  writeW: number,
  writeH: number,
  originX: number,
  originY: number,
  radius: number,
  params: ClassParams,
  ferriteCounts: Float32Array,
  metalCounts: Float32Array,
  cellCounts: Float32Array,
  gridWidth: number,
): void {
  const stride = tileW;
  const bgCut = params.borderLuma * 0.8;
  const cell = params.cellSize;
  void tileH;
  void radius; // 亮度分相不需要局部窗口；保留参数以兼容旧调用与 GL 引擎接口
  for (let ly = writeY; ly < writeY + writeH; ly++) {
    let idx =
      Math.floor((originY + ly) / cell) * gridWidth +
      Math.floor((originX + writeX) / cell);
    let colInCell = (originX + writeX) % cell;
    const rowBase = ly * stride;
    for (let lx = writeX; lx < writeX + writeW; lx++) {
      const v = luma[rowBase + lx];
      // 每像素都计入格总数（含背景），保证金属面积比分母正确
      cellCounts[idx]++;
      if (v >= bgCut) {
        metalCounts[idx]++;
        // 亮度分相：亮像素（铁素体晶粒与珠光体亮层片）计为铁素体相
        if (v >= params.lumaThreshold) ferriteCounts[idx]++;
      }
      if (++colInCell >= cell) {
        colInCell = 0;
        idx++;
      }
    }
  }
}

/** 计数网格 → 面积比网格 */
export function countsToGrid(
  ferriteCounts: Float32Array,
  metalCounts: Float32Array,
  cellCounts: Float32Array,
  params: ClassParams,
  sourceWidth: number,
  sourceHeight: number,
): FractionGrid {
  const gridWidth = Math.ceil(sourceWidth / params.cellSize);
  const gridHeight = Math.ceil(sourceHeight / params.cellSize);
  const ferrite = new Float32Array(gridWidth * gridHeight);
  const metal = new Float32Array(gridWidth * gridHeight);
  for (let i = 0; i < ferrite.length; i++) {
    const total = cellCounts[i] || 1;
    ferrite[i] = ferriteCounts[i] / metalCounts[i] || 0;
    metal[i] = metalCounts[i] / total;
  }
  return { gridWidth, gridHeight, cellSize: params.cellSize, imageWidth: sourceWidth, imageHeight: sourceHeight, ferrite, metal };
}
