import type { FractionGrid } from '../types.ts';

/**
 * 在面积比网格上做双线性采样，坐标为全分辨率像素。
 * 网格中心点位于 (cellSize/2 + c*cellSize)。
 */
export function sampleGrid(grid: FractionGrid, field: 'ferrite' | 'metal', px: number, py: number): number {
  const data = field === 'ferrite' ? grid.ferrite : grid.metal;
  const { cellSize, gridWidth, gridHeight } = grid;
  // 格点中心坐标 → 格索引浮点
  const fx = px / cellSize - 0.5;
  const fy = py / cellSize - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const at = (cx: number, cy: number): number => {
    const cxm = Math.max(0, Math.min(gridWidth - 1, cx));
    const cym = Math.max(0, Math.min(gridHeight - 1, cy));
    return data[cym * gridWidth + cxm];
  };

  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}
