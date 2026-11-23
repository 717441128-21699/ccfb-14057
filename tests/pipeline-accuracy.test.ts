import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CpuEngine } from '../src/core/engine/cpu-engine.ts';
import { SyntheticImageSource } from '../src/core/synthetic/renderer.ts';
import { makeShape } from '../src/core/synthetic/shape.ts';
import type { ShapeSpec } from '../src/core/synthetic/shape.ts';
import { runPipeline } from '../src/core/pipeline.ts';
import { sampleTrueDepths, evaluateAccuracy } from '../src/core/synthetic/ground-truth.ts';
import { defaultAnalysisParams, defaultClassParams } from '../src/core/types.ts';

const UM = 0.5;
const TOL_UM = 20; // GB/T 224 人工对照允许差 0.02mm

async function runCase(spec: ShapeSpec, coreFerrite = 0.12, seed = 20240517) {
  const shape = makeShape(spec);
  const source = new SyntheticImageSource(shape, { coreFerriteFraction: coreFerrite, seed });
  const engine = new CpuEngine();
  const { report } = await runPipeline(
    source,
    'synthetic',
    defaultClassParams(),
    defaultAnalysisParams(UM),
    engine,
  );
  const truth = sampleTrueDepths(shape, 720, UM);
  const acc = evaluateAccuracy(report.stations, shape, truth);
  engine.dispose();
  return { report, acc, shape };
}

describe('端到端精度：总脱碳深度 vs 合成真值（允差 20µm）', () => {
  const depths = [
    // 截面半径约 840px=420µm，总脱碳须显著小于半径以保留心部平台
    { name: '浅脱碳 120µm', full: 80, total: 240 },
    { name: '中脱碳 200µm', full: 120, total: 400 },
    { name: '较深脱碳 300µm', full: 180, total: 600 },
    { name: '极浅脱碳 60µm', full: 30, total: 120 },
  ];

  for (const d of depths) {
    test(`圆形截面 · ${d.name}`, async () => {
      const spec: ShapeSpec = {
        kind: 'circle', width: 2048, height: 2048,
        fullDepth: d.full, totalDepth: d.total,
        modulation: 0.2, modulationPeriods: 3, cornerRadius: 0,
      };
      const { acc, report } = await runCase(spec);
      assert.ok(acc.compared > 300, `有效站过少: ${acc.compared}`);
      assert.ok(
        acc.maxAbsErrorUm <= TOL_UM,
        `最大误差 ${acc.maxAbsErrorUm.toFixed(1)}µm 超过 20µm（均值 ${acc.meanAbsErrorUm.toFixed(1)}）`,
      );
      assert.ok(acc.overToleranceRatio === 0, '存在超差站点');
      assert.ok(report.excludedCount === 0, '光滑圆截面不应排除站点');
    });
  }

  test('波浪边缘：法向跟随旋转，误差仍在 20µm 内', async () => {
    const spec: ShapeSpec = {
      kind: 'wavy-circle', width: 2048, height: 2048,
      fullDepth: 100, totalDepth: 360,
      modulation: 0.1, modulationPeriods: 3, cornerRadius: 0,
    };
    const { acc } = await runCase(spec);
    assert.ok(acc.maxAbsErrorUm <= TOL_UM, `波浪边最大误差 ${acc.maxAbsErrorUm.toFixed(1)}µm`);
  });

  test('带倒角矩形：小半径圆角站点被排除，直边站点精度合格', async () => {
    const spec: ShapeSpec = {
      kind: 'rounded-rect', width: 2048, height: 2048,
      fullDepth: 100, totalDepth: 360,
      modulation: 0.1, modulationPeriods: 4, cornerRadius: 60, // 30µm 圆角，低于 80µm 阈值
    };
    const { acc, report } = await runCase(spec);
    assert.ok(report.excludedCount > 20, '倒角站点应被排除');
    assert.ok(acc.compared > 200, '直边有效站应保留');
    assert.ok(acc.maxAbsErrorUm <= TOL_UM, `直边最大误差 ${acc.maxAbsErrorUm.toFixed(1)}µm`);
  });

  test('最深点定位与真值最大深度一致', async () => {
    const spec: ShapeSpec = {
      kind: 'circle', width: 2048, height: 2048,
      fullDepth: 120, totalDepth: 400,
      modulation: 0.25, modulationPeriods: 5, cornerRadius: 0,
    };
    const { report } = await runCase(spec);
    const trueMax = spec.totalDepth * (1 + spec.modulation) * UM;
    assert.ok(Math.abs(report.deepest.totalDepthUm - trueMax) <= TOL_UM,
      `最深点 ${report.deepest.totalDepthUm.toFixed(1)} vs 真值 ${trueMax.toFixed(1)}`);
  });

  test('不同心部铁素体基线（10% / 25%）均合格', async () => {
    const spec: ShapeSpec = {
      kind: 'circle', width: 2048, height: 2048,
      fullDepth: 120, totalDepth: 400,
      modulation: 0.15, modulationPeriods: 4, cornerRadius: 0,
    };
    for (const base of [0.1, 0.25]) {
      const { acc } = await runCase(spec, base, base === 0.1 ? 111 : 222);
      assert.ok(acc.maxAbsErrorUm <= TOL_UM, `基线 ${base} 误差 ${acc.maxAbsErrorUm.toFixed(1)}µm`);
    }
  });
});
