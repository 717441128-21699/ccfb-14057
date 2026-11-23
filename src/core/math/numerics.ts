/** 小型数值工具 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function median(sortedAsc: number[] | Float32Array): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

export function percentile(sortedAsc: number[] | Float32Array, p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  const idx = clamp(p, 0, 1) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sortedAsc[lo] : lerp(sortedAsc[lo], sortedAsc[hi], idx - lo);
}

/** 数组数值统计（忽略 null/NaN） */
export function stats(values: number[]): { mean: number; median: number; p95: number; max: number } {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return { mean: NaN, median: NaN, p95: NaN, max: NaN };
  const sum = clean.reduce((a, b) => a + b, 0);
  return {
    mean: sum / clean.length,
    median: median(clean),
    p95: percentile(clean, 0.95),
    max: clean[clean.length - 1],
  };
}

/**
 * 一维高斯核（归一化），半径 = ceil(3σ)。
 */
export function gaussianKernel(sigma: number): number[] {
  if (sigma <= 0) return [1];
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = new Array(2 * r + 1);
  let sum = 0;
  const s2 = 2 * sigma * sigma;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / s2);
    k[i + r] = w;
    sum += w;
  }
  return k.map((w) => w / sum);
}

/**
 * 对闭合环形序列做高斯平滑（首尾环绕）。
 */
export function smoothCircular(values: Float32Array, sigma: number): Float32Array {
  const n = values.length;
  if (n < 3 || sigma <= 0) return values.slice();
  const kernel = gaussianKernel(sigma);
  const r = kernel.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) {
      const j = (i + k + n * 100000) % n;
      acc += values[j] * kernel[k + r];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * 环形中值滤波：抑制孤立噪声但保留阶跃/尖角特征（倒角检测需要）。
 */
export function medianCircular(values: Float32Array, radius: number): Float32Array {
  const n = values.length;
  if (radius < 1 || n < 3) return values.slice();
  const out = new Float32Array(n);
  const win: number[] = new Array(2 * radius + 1);
  for (let i = 0; i < n; i++) {
    for (let k = -radius; k <= radius; k++) {
      win[k + radius] = values[(i + k + n * 100000) % n];
    }
    win.sort((a, b) => a - b);
    out[i] = win[radius];
  }
  return out;
}
