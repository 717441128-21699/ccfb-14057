import { h } from '../ui/dom.ts';
import { store } from '../ui/state.ts';
import { ImageBitmapSource } from '../ui/image-source.ts';
import { SyntheticImageSource } from '../core/synthetic/renderer.ts';
import { makeShape } from '../core/synthetic/shape.ts';
import { GlEngine } from '../gl/gl-engine.ts';
import { CpuEngine } from '../core/engine/cpu-engine.ts';
import { defaultAnalysisParams } from '../core/types.ts';
import type { ShapeSpec } from '../core/synthetic/shape.ts';

const PRESETS: Array<{ label: string; spec: ShapeSpec; coreFerrite: number }> = [
  {
    label: '浅脱碳 · 圆截面试样（全 40µm / 总 120µm）',
    spec: {
      kind: 'circle', width: 2048, height: 2048,
      fullDepth: 80, totalDepth: 240, modulation: 0.15, modulationPeriods: 3, cornerRadius: 0,
    },
    coreFerrite: 0.12,
  },
  {
    label: '中等脱碳 · 圆截面试样（全 80µm / 总 250µm）',
    spec: {
      kind: 'circle', width: 2048, height: 2048,
      fullDepth: 160, totalDepth: 500, modulation: 0.2, modulationPeriods: 4, cornerRadius: 0,
    },
    coreFerrite: 0.15,
  },
  {
    label: '深脱碳 · 圆截面试样（全 150µm / 总 450µm）',
    spec: {
      kind: 'circle', width: 2048, height: 2048,
      fullDepth: 300, totalDepth: 900, modulation: 0.25, modulationPeriods: 5, cornerRadius: 0,
    },
    coreFerrite: 0.1,
  },
  {
    label: '波浪边缘（非直线，验证法向跟随）',
    spec: {
      kind: 'wavy-circle', width: 2048, height: 2048,
      fullDepth: 120, totalDepth: 420, modulation: 0.2, modulationPeriods: 6, cornerRadius: 0,
    },
    coreFerrite: 0.12,
  },
  {
    label: '带倒角矩形（验证圆角/倒角排除）',
    spec: {
      kind: 'rounded-rect', width: 2048, height: 2048,
      fullDepth: 120, totalDepth: 420, modulation: 0.15, modulationPeriods: 4, cornerRadius: 60,
    },
    coreFerrite: 0.12,
  },
];

export function renderSamplePage(root: HTMLElement): void {
  const s = store.get();
  const umInput = h('input', { type: 'number', value: String(s.analysisParams.umPerPixel), step: '0.05', min: '0.01' }) as HTMLInputElement;
  const engineSel = h('select', {},
    h('option', { value: 'webgl2' }, 'WebGL2（GPU 分块）'),
    h('option', { value: 'cpu' }, 'CPU 回退（积分图）'),
  ) as HTMLSelectElement;
  engineSel.value = s.engine?.kind ?? 'webgl2';

  const presetSel = h('select', {}, ...PRESETS.map((p, i) => h('option', { value: String(i) }, p.label))) as HTMLSelectElement;
  const sizeInput = h('input', { type: 'number', value: '2048', min: '512', step: '512' }) as HTMLInputElement;

  const drop = h('div', { class: 'file-drop' },
    '拖入金相截面图（PNG/JPG，支持超大图分块读取），或点击选择文件',
  );
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement;
  drop.append(fileInput);
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void loadFile(f);
  });

  async function loadFile(f: File): Promise<void> {
    try {
      store.set({ running: true, error: null });
      store.log(`导入图像 ${f.name}（${(f.size / 1048576).toFixed(1)} MB）`);
      const source = await ImageBitmapSource.fromFile(f);
      const um = parseFloat(umInput.value) || 0.5;
      store.set({
        sample: { name: f.name, source, umPerPixel: um },
        analysisParams: { ...store.get().analysisParams, umPerPixel: um },
        grid: null, report: null, running: false,
      });
      store.log(`解码完成：${source.width} × ${source.height} px，标定 ${um} µm/px`);
    } catch (err) {
      store.set({ running: false, error: (err as Error).message });
    }
  }

  function makeEngine(): void {
    const old = store.get().engine;
    old?.dispose();
    const eng = engineSel.value === 'cpu' ? new CpuEngine() : new GlEngine();
    store.set({ engine: eng });
    store.log(`计算引擎：${eng.kind}`);
  }

  function genSynthetic(): void {
    const preset = PRESETS[Number(presetSel.value)];
    const size = Math.max(512, Number(sizeInput.value) || 2048);
    const um = parseFloat(umInput.value) || 0.5;
    const spec: ShapeSpec = { ...preset.spec, width: size, height: size };
    const shape = makeShape(spec);
    const source = new SyntheticImageSource(shape, { coreFerriteFraction: preset.coreFerrite, seed: 12345 });
    const trueMaxTotal = spec.totalDepth * (1 + spec.modulation) * um;
    const trueMaxFull = spec.fullDepth * (1 + spec.modulation) * um;
    store.set({
      sample: {
        name: `合成-${preset.label.split(' ')[0]}-${size}px`,
        source, umPerPixel: um,
        synthetic: { shapeKind: spec.kind, trueMaxTotalUm: trueMaxTotal, trueMaxFullUm: trueMaxFull },
      },
      analysisParams: { ...defaultAnalysisParams(um), umPerPixel: um },
      grid: null, report: null,
    });
    store.log(`生成合成图 ${size}×${size}，真值最大总脱碳 ${trueMaxTotal.toFixed(1)}µm`);
  }

  makeEngine();

  const panel = h('div', { class: 'panel' },
    h('h2', {}, '试样与标定'),
    h('h3', {}, '计算引擎'),
    engineSel,
    h('button', {
      class: 'secondary row', onclick: makeEngine,
    }, '重新初始化引擎'),
    h('h3', {}, '像素标定（µm/px）'),
    umInput,
    h('div', { class: 'muted' }, '由物镜倍率与相机像元尺寸计算，或用测微标尺标定'),
    h('h3', {}, '导入真实图像'),
    drop,
    h('h3', {}, '合成测试图'),
    presetSel,
    h('label', { class: 'field' }, h('span', {}, '边长（像素）'), sizeInput),
    h('button', { class: 'row', onclick: genSynthetic }, '生成合成试样'),
    h('h3', {}, '当前试样'),
    sampleInfo(),
  );

  const right = h('div', { class: 'panel' }, instructions());
  root.append(h('div', { class: 'layout narrow' }, panel, right));
}

function sampleInfo(): HTMLElement {
  const s = store.get();
  if (!s.sample) return h('div', { class: 'muted' }, '尚未加载试样');
  return h('div', {},
    h('div', {}, `名称：${s.sample.name}`),
    h('div', {}, `尺寸：${s.sample.source.width} × ${s.sample.source.height} px`),
    h('div', {}, `标定：${s.sample.umPerPixel} µm/px`),
    s.sample.synthetic
      ? h('div', { class: 'muted' }, `真值：最大总脱碳 ${s.sample.synthetic.trueMaxTotalUm.toFixed(1)}µm`)
      : h('div', { class: 'muted' }, '真实图像（无真值）'),
  );
}

function instructions(): HTMLElement {
  return h('div', {},
    h('h2', {}, '检验流程（GB/T 224-2019 钢的脱碳层深度测定）'),
    h('p', { class: 'muted' }, '本工具以金相法自动测量全脱碳层与总脱碳层深度：'),
    h('ol', {},
      h('li', {}, '① 试样页：导入截面图或生成带真值的合成图，确认像素标定与计算引擎'),
      h('li', {}, '② 边缘识别页：GPU 逐像素分类铁素体/珠光体，提取试样边缘并沿整圈布站，自动排除倒角与抛光圆角'),
      h('li', {}, '③ 深度分布页：沿各站内法线采样面积比，判定全脱碳/总脱碳边界，输出整圈深度曲线与最深点'),
      h('li', {}, '④ 报告页：汇总统计、超差判定，导出 JSON/CSV/PDF 可打印报告'),
    ),
    h('h3', {}, '判定原理'),
    h('p', { class: 'muted' },
      '全脱碳层 = 边缘到珠光体首次持续出现的距离；总脱碳层 = 边缘到铁素体面积比恢复心部基线的距离。',
      '边缘为曲线时剖面沿局部内法线方向，曲率半径低于阈值的站点（倒角/抛光圆角）按标准要求排除。',
    ),
    h('h3', {}, '精度指标'),
    h('p', { class: 'muted' },
      '总脱碳层深度与人工金相法测量值偏差 ≤ 0.02 mm（20 µm）；1 亿像素图像端到端处理 ≤ 10 s（bench 页实测）。',
    ),
  );
}
