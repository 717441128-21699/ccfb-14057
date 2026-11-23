import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractContour, resampleAndSmooth } from '../src/core/geometry/contour.ts';
import type { FractionGrid } from '../src/core/types.ts';

/** 构造一个圆形金属占比网格 */
function circleGrid(cx: number, cy: number, r: number, gw: number, gh: number, cell = 8): FractionGrid {
  const metal = new Float32Array(gw * gh);
  const ferrite = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const px = x * cell + cell / 2;
      const py = y * cell + cell / 2;
      if (Math.hypot(px - cx, py - cy) <= r) {
        metal[y * gw + x] = 1;
        ferrite[y * gw + x] = 0.2;
      }
    }
  }
  return { gridWidth: gw, gridHeight: gh, cellSize: cell, imageWidth: gw * cell, imageHeight: gh * cell, ferrite, metal };
}

describe('contour', () => {
  test('extracts a closed contour around a circle', () => {
    const grid = circleGrid(400, 400, 300, 100, 100);
    const loop = extractContour(grid);
    assert.ok(loop.length > 50);
    // 所有轮廓点应在半径 300 附近（± 1.5 格）
    for (const p of loop) {
      const d = Math.hypot(p.x - 400, p.y - 400);
      assert.ok(Math.abs(d - 300) < 14, `radius off: ${d}`);
    }
  });

  test('smoothed contour has inward normals and consistent curvature sign', () => {
    const grid = circleGrid(400, 400, 300, 100, 100);
    const loop = extractContour(grid);
    const sm = resampleAndSmooth(loop, 5, 20);
    assert.equal(sm.points.length, sm.normals.length);
    // 圆的曲率为正（逆时针、曲率中心在内部），法向指向圆心
    let inwardOk = 0;
    for (let i = 0; i < sm.points.length; i++) {
      const p = sm.points[i];
      const toCenterX = (400 - p.x) / 300;
      const toCenterY = (400 - p.y) / 300;
      const dot = sm.normals[i].x * toCenterX + sm.normals[i].y * toCenterY;
      if (dot > 0.9) inwardOk++;
      assert.ok(sm.curvature[i] > 0, 'circle curvature should be positive');
    }
    assert.ok(inwardOk / sm.points.length > 0.95);
  });

  test('radius from curvature matches geometric radius', () => {
    const grid = circleGrid(400, 400, 300, 100, 100);
    const loop = extractContour(grid);
    const sm = resampleAndSmooth(loop, 5, 20);
    // 用平均曲率反推半径（直接对 1/κ 取均值会被近零曲率点放大）
    const meanCurv = sm.curvature.reduce((a, b) => a + b, 0) / sm.curvature.length;
    const radius = 1 / meanCurv;
    assert.ok(Math.abs(radius - 300) / 300 < 0.05, `radius ${radius}`);
  });
});
