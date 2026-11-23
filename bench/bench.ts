/**
 * 浏览器端性能基准：10000×10000 合成截面图，端到端 ≤ 10s 验收。
 * 同时在同一图上跑小尺寸精度自检（合成真值对照，误差 ≤ 20µm）。
 */
import { GlEngine } from '../src/gl/gl-engine.ts';
import { SyntheticImageSource } from '../src/core/synthetic/renderer.ts';
import { makeShape } from '../src/core/synthetic/shape.ts';
import { runPipeline } from '../src/core/pipeline.ts';
import { defaultAnalysisParams, defaultClassParams } from '../src/core/types.ts';
import { sampleTrueDepths, evaluateAccuracy } from '../src/core/synthetic/ground-truth.ts';

const out = document.getElementById('out')!;
const log = (msg: string) => {
  out.textContent += `\n${msg}`;
};

document.getElementById('run')!.addEventListener('click', () => void run());

async function run(): Promise<void> {
  out.textContent = '';
  const umPerPixel = 0.5;
  const engine = new GlEngine(document.getElementById('glcanvas') as HTMLCanvasElement);
  log(`引擎：${engine.kind}`);

  // ---- 性能：1 亿像素 ----
  const bigShape = makeShape({
    kind: 'circle', width: 10000, height: 10000,
    fullDepth: 240, totalDepth: 700, modulation: 0.2, modulationPeriods: 4, cornerRadius: 0,
  });
  const bigSource = new SyntheticImageSource(bigShape, { coreFerriteFraction: 0.12, seed: 777 });
  log(`测试图：${bigSource.width}×${bigSource.height} = ${(bigSource.width * bigSource.height / 1e8).toFixed(2)} 亿像素`);

  // 预热（编译着色器、分配纹理）
  await engine.classify(
    new SyntheticImageSource(
      makeShape({ kind: 'circle', width: 512, height: 512, fullDepth: 40, totalDepth: 120, modulation: 0, modulationPeriods: 1, cornerRadius: 0 }),
      { coreFerriteFraction: 0.12, seed: 1 },
    ),
    defaultClassParams(),
  );

  const t0 = performance.now();
  const { report } = await runPipeline(
    bigSource, 'synthetic-100mp',
    defaultClassParams(),
    defaultAnalysisParams(umPerPixel),
    engine,
  );
  const elapsed = performance.now() - t0;
  log(`端到端用时：${elapsed.toFixed(0)} ms（分类 ${report.timingMs.classify} ms / 轮廓 ${report.timingMs.contour} ms / 站点 ${report.timingMs.stations} ms）`);
  log(`有效站 ${report.validCount}/${report.stationCount}，最深总脱碳 ${report.deepest.totalDepthUm.toFixed(1)}µm`);
  log(elapsed <= 10000 ? '✅ 性能验收通过（≤10s）' : '❌ 性能验收失败（>10s）');

  // ---- 精度：2048 合成图，真值对照 ----
  log('\n— 精度自检（2048px 合成圆，多深度）—');
  const cases = [
    { full: 80, total: 240 },
    { full: 160, total: 500 },
    { full: 300, total: 900 },
  ];
  for (const c of cases) {
    const shape = makeShape({
      kind: 'circle', width: 2048, height: 2048,
      fullDepth: c.full, totalDepth: c.total, modulation: 0.15, modulationPeriods: 3, cornerRadius: 0,
    });
    const src = new SyntheticImageSource(shape, { coreFerriteFraction: 0.12, seed: 99 });
    const { report: r } = await runPipeline(src, 'acc', defaultClassParams(), defaultAnalysisParams(umPerPixel), engine);
    const truth = sampleTrueDepths(shape, 720, umPerPixel);
    const acc = evaluateAccuracy(r.stations, shape, truth);
    const ok = acc.maxAbsErrorUm <= 20;
    log(`真值总脱碳 ${c.total * umPerPixel}µm：最大误差 ${acc.maxAbsErrorUm.toFixed(1)}µm，` +
      `平均 ${acc.meanAbsErrorUm.toFixed(1)}µm，超差站 ${(acc.overToleranceRatio * 100).toFixed(1)}% ` +
      (ok ? '✅' : '❌'));
  }
  engine.dispose();
}
