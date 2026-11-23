import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CpuEngine } from '../src/core/engine/cpu-engine.ts';
import { SyntheticImageSource } from '../src/core/synthetic/renderer.ts';
import { makeShape } from '../src/core/synthetic/shape.ts';
import { defaultClassParams, type PixelSource, type FractionGrid } from '../src/core/types.ts';
import { classifyTileIntoGrid, countsToGrid } from '../src/core/imaging/classify.ts';

/** 不分块的参考实现，验证分块接缝无重复/遗漏 */
function classifyWhole(source: PixelSource): FractionGrid {
  const p = defaultClassParams();
  const tile = source.readTile(0, 0, source.width, source.height);
  const gw = Math.ceil(source.width / p.cellSize);
  const gh = Math.ceil(source.height / p.cellSize);
  const f = new Float32Array(gw * gh);
  const m = new Float32Array(gw * gh);
  const c = new Float32Array(gw * gh);
  classifyTileIntoGrid(tile.luma, tile.width, tile.height, 0, 0, tile.width, tile.height,
    0, 0, p.varianceRadius, p, f, m, c, gw);
  return countsToGrid(f, m, c, p, source.width, source.height);
}

describe('分块分类：接缝一致性', () => {
  test('4096 分块与整图结果逐格一致', async () => {
    const shape = makeShape({
      kind: 'circle', width: 1200, height: 900,
      fullDepth: 100, totalDepth: 300, modulation: 0.1, modulationPeriods: 2, cornerRadius: 0,
    });
    const source = new SyntheticImageSource(shape, { coreFerriteFraction: 0.12, seed: 5 });
    const engine = new CpuEngine();
    const tiled = await engine.classify(source, defaultClassParams());
    const whole = classifyWhole(source);
    assert.equal(tiled.gridWidth, whole.gridWidth);
    let maxDiff = 0;
    for (let i = 0; i < tiled.metal.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(tiled.metal[i] - whole.metal[i]));
    }
    assert.ok(maxDiff < 1e-6, `金属占比最大差异 ${maxDiff}`);
    engine.dispose();
  });
});
