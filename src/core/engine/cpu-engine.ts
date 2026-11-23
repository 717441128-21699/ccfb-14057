import type { AnalysisEngine, ClassParams, FractionGrid, PixelSource } from '../types.ts';
import { classifyTileIntoGrid, countsToGrid } from '../imaging/classify.ts';

const TILE = 4096;

/**
 * 纯 CPU 分类引擎：分块逐像素亮度分相 + 网格面积比统计。
 * 与 WebGL2 引擎实现同一分类规则，用于 Node 精度测试与无 GPU 环境回退。
 */
export class CpuEngine implements AnalysisEngine {
  readonly kind = 'cpu' as const;
  readonly tileSize = TILE;

  async classify(source: PixelSource, params: ClassParams): Promise<FractionGrid> {
    const gridWidth = Math.ceil(source.width / params.cellSize);
    const gridHeight = Math.ceil(source.height / params.cellSize);
    const ferriteCounts = new Float32Array(gridWidth * gridHeight);
    const metalCounts = new Float32Array(gridWidth * gridHeight);
    const cellCounts = new Float32Array(gridWidth * gridHeight);

    for (let ty = 0; ty < source.height; ty += TILE) {
      for (let tx = 0; tx < source.width; tx += TILE) {
        const writeW = Math.min(TILE, source.width - tx);
        const writeH = Math.min(TILE, source.height - ty);
        const tile = source.readTile(tx, ty, writeW, writeH);

        classifyTileIntoGrid(
          tile.luma,
          tile.width,
          tile.height,
          0,
          0,
          writeW,
          writeH,
          tx,
          ty,
          0,
          params,
          ferriteCounts,
          metalCounts,
          cellCounts,
          gridWidth,
        );
        // 让出事件循环，避免阻塞 UI
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return countsToGrid(ferriteCounts, metalCounts, cellCounts, params, source.width, source.height);
  }

  dispose(): void {}
}
