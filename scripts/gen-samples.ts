/**
 * 合成金相测试图导出脚本：生成几种已知脱碳深度的 PNG，供人工/外部工具核对。
 * 用法：node --experimental-strip-types scripts/gen-samples.ts [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { SyntheticImageSource } from '../src/core/synthetic/renderer.ts';
import { makeShape } from '../src/core/synthetic/shape.ts';
import type { ShapeSpec } from '../src/core/synthetic/shape.ts';

const outDir = resolve(process.argv[2] ?? 'samples');
mkdirSync(outDir, { recursive: true });

const UM = 0.5;
const cases: Array<{ name: string; spec: ShapeSpec; core: number }> = [
  { name: 'circle-shallow', spec: { kind: 'circle', width: 2048, height: 2048, fullDepth: 80, totalDepth: 240, modulation: 0.15, modulationPeriods: 3, cornerRadius: 0 }, core: 0.12 },
  { name: 'circle-medium', spec: { kind: 'circle', width: 2048, height: 2048, fullDepth: 120, totalDepth: 400, modulation: 0.2, modulationPeriods: 4, cornerRadius: 0 }, core: 0.12 },
  { name: 'circle-deep', spec: { kind: 'circle', width: 2048, height: 2048, fullDepth: 180, totalDepth: 600, modulation: 0.2, modulationPeriods: 3, cornerRadius: 0 }, core: 0.1 },
  { name: 'wavy-edge', spec: { kind: 'wavy-circle', width: 2048, height: 2048, fullDepth: 100, totalDepth: 360, modulation: 0.1, modulationPeriods: 3, cornerRadius: 0 }, core: 0.12 },
  { name: 'rounded-rect', spec: { kind: 'rounded-rect', width: 2048, height: 2048, fullDepth: 100, totalDepth: 360, modulation: 0.1, modulationPeriods: 4, cornerRadius: 60 }, core: 0.12 },
];

for (const c of cases) {
  const shape = makeShape(c.spec);
  const source = new SyntheticImageSource(shape, { coreFerriteFraction: c.core, seed: 20240517 });
  const png = new PNG({ width: source.width, height: source.height });
  const tile = source.readTile(0, 0, source.width, source.height);
  for (let i = 0; i < tile.luma.length; i++) {
    const v = Math.max(0, Math.min(255, tile.luma[i] | 0));
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  const file = resolve(outDir, `${c.name}.png`);
  writeFileSync(file, PNG.sync.write(png));
  const trueMax = c.spec.totalDepth * (1 + c.spec.modulation) * UM;
  console.log(`${file}  真值最大总脱碳=${trueMax.toFixed(1)}µm  全脱碳=${(c.spec.fullDepth * UM).toFixed(1)}µm`);
}
