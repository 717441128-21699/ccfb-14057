import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { smoothCircular, gaussianKernel, percentile } from '../src/core/math/numerics.ts';

describe('numerics', () => {
  test('gaussian kernel normalized and symmetric', () => {
    const k = gaussianKernel(2);
    const sum = k.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-12);
    for (let i = 0; i < k.length / 2; i++) {
      assert.ok(Math.abs(k[i] - k[k.length - 1 - i]) < 1e-15);
    }
  });

  test('circular smoothing preserves constant signal and length', () => {
    const a = new Float32Array(100).fill(7);
    const b = smoothCircular(a, 3);
    assert.equal(b.length, 100);
    assert.ok(b.every((v) => Math.abs(v - 7) < 1e-12));
  });

  test('percentile interpolation', () => {
    const a = [0, 10, 20, 30, 40];
    assert.equal(percentile(a, 0), 0);
    assert.equal(percentile(a, 1), 40);
    assert.ok(Math.abs(percentile(a, 0.5) - 20) < 1e-12);
  });
});
