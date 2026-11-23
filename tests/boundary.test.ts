import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectBoundaries, estimateCoreBaseline } from '../src/core/geometry/boundary.ts';
import { defaultAnalysisParams } from '../src/core/types.ts';
import type { ProfilePoint } from '../src/core/types.ts';

function profileFromFractions(fractions: number[], stepUm: number): ProfilePoint[] {
  return fractions.map((f, i) => ({ depthUm: i * stepUm, ferrite: f, metal: 1 }));
}

describe('GB/T 224 boundary detection', () => {
  test('full decarb zone then transition then core', () => {
    // 0..100µm 纯铁素体，100..300µm 线性过渡，300µm 后心部 15%
    const fr: number[] = [];
    for (let d = 0; d <= 500; d += 4) {
      if (d <= 100) fr.push(1);
      else if (d >= 300) fr.push(0.15);
      else fr.push(1 + (0.15 - 1) * ((d - 100) / 200));
    }
    const params = { ...defaultAnalysisParams(0.5), minRunUm: 12 };
    const r = detectBoundaries(profileFromFractions(fr, 4), params);
    assert.ok(r.fullDepthUm !== null);
    // 5 点滑动平均会展宽理想硬阶跃，放宽到 25µm（真实金相为渐变，不受此影响）
    assert.ok(Math.abs((r.fullDepthUm ?? 0) - 100) < 25, `full=${r.fullDepthUm}`);
    assert.ok(r.totalDepthUm !== null);
    assert.ok(Math.abs((r.totalDepthUm ?? 0) - 300) < 30, `total=${r.totalDepthUm}`);
    assert.ok(r.fullDepthUm! < r.totalDepthUm!);
  });

  test('no ferrite surface means zero full decarb depth', () => {
    const fr: number[] = [];
    for (let d = 0; d <= 400; d += 4) fr.push(0.15);
    const r = detectBoundaries(profileFromFractions(fr, 4), defaultAnalysisParams(0.5));
    // 全程心部水平：全脱碳与总脱碳都应在表面附近（≤ 一个持续长度）
    assert.ok((r.fullDepthUm ?? 999) <= 12);
    assert.ok((r.totalDepthUm ?? 999) <= 12);
  });

  test('single-point noise does not create a boundary (run-length gate)', () => {
    const fr: number[] = [];
    for (let d = 0; d <= 400; d += 4) {
      fr.push(d === 120 ? 0.16 : 1); // 单点掉到心部水平
    }
    const r = detectBoundaries(profileFromFractions(fr, 4), defaultAnalysisParams(0.5));
    // 单点持续长度不足，不应在 120µm 处判边界
    assert.ok(r.fullDepthUm === null || r.fullDepthUm > 200);
  });

  test('baseline estimate finds the lowest stable plateau', () => {
    // 表面高铁素体 → 心部低平台 0.2
    const p = profileFromFractions(Array.from({ length: 100 }, (_, i) => (i > 70 ? 0.2 : 1)), 5);
    const bl = estimateCoreBaseline(p);
    assert.ok(Math.abs(bl - 0.2) < 0.05, `baseline=${bl}`);
  });

  test('baseline robust to far-side re-rise contamination', () => {
    // 心部 0.15 平台后模拟对侧脱碳层回升
    const fr: number[] = [];
    for (let d = 0; d <= 600; d += 4) {
      if (d < 200) fr.push(1 - 0.85 * (d / 200));
      else if (d < 400) fr.push(0.15);
      else fr.push(Math.min(1, 0.15 + (d - 400) / 200));
    }
    const bl = estimateCoreBaseline(profileFromFractions(fr, 4));
    assert.ok(Math.abs(bl - 0.15) < 0.06, `baseline=${bl}`);
  });
});
