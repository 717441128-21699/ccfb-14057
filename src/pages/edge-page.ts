import { h } from '../ui/dom.ts';
import { store } from '../ui/state.ts';
import { Viewer } from '../ui/viewer.ts';
import { extractContour, resampleAndSmooth } from '../core/geometry/contour.ts';
import { buildStations } from '../core/geometry/boundary.ts';
import { otsuThreshold, lumaHistogram } from '../core/imaging/classify.ts';
import type { Station } from '../core/types.ts';

function rangeField(label: string, value: number, min: number, max: number, step: number, unit: string,
  onInput: (v: number) => void): HTMLElement {
  const out = h('input', { type: 'number', value: String(value), style: 'width:88px' }) as HTMLInputElement;
  const slider = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  const sync = (v: number) => {
    slider.value = String(v);
    out.value = String(v);
    onInput(v);
  };
  slider.addEventListener('input', () => sync(Number(slider.value)));
  out.addEventListener('change', () => sync(Number(out.value)));
  return h('label', { class: 'field' },
    h('span', {}, label, h('b', {}, `${value}${unit}`)),
    slider, out,
  );
}

export function renderEdgePage(root: HTMLElement): void {
  const s = store.get();
  const viewer = new Viewer();
  const logBox = h('div', { class: 'log-box' }) as HTMLElement;

  const refreshLog = () => { logBox.textContent = store.get().logs.join('\n'); logBox.scrollTop = logBox.scrollHeight; };
  const unsub = store.subscribe((st) => {
    refreshLog();
    if (st.grid) viewer.setData(st.sample!.source, st.grid, st.report?.stations ?? currentStations);
  });

  let currentStations: Station[] = [];

  const controls = h('div', {});
  const rebuildControls = (): void => {
    const cp = store.get().classParams;
    const ap = store.get().analysisParams;
    controls.replaceChildren(
      h('h3', {}, '像素分类参数'),
      rangeField('铁素体亮度阈值', cp.lumaThreshold, 80, 220, 1, '', (v) => store.patchClass({ lumaThreshold: v })),
      rangeField('背景亮度参考', cp.borderLuma, 20, 120, 2, '', (v) => store.patchClass({ borderLuma: v })),
      h('div', { class: 'muted', style: 'margin-bottom:8px' },
        '亮于阈值的金属像素计为铁素体相（含珠光体亮层片），暗像素为渗碳体/暗珠光体'),
      h('button', {
        class: 'secondary row', onclick: () => {
          const src = store.get().sample?.source;
          if (!src) return;
          const th = otsuThreshold(lumaHistogram(src, 8));
          store.patchClass({ lumaThreshold: th });
          store.log(`Otsu 自动亮度阈值 = ${th}`);
          rebuildControls();
        },
      }, 'Otsu 自动亮度阈值'),
      h('h3', {}, '边缘与排除参数'),
      rangeField('布站间距', ap.stationSpacingUm, 2, 20, 1, ' µm', (v) => store.patchAnalysis({ stationSpacingUm: v })),
      rangeField('平滑 σ', ap.smoothSigmaUm, 5, 60, 1, ' µm', (v) => store.patchAnalysis({ smoothSigmaUm: v })),
      rangeField('最小曲率半径', ap.minRadiusUm, 20, 300, 5, ' µm', (v) => store.patchAnalysis({ minRadiusUm: v })),
      rangeField('图框安全边距', ap.edgeMarginPx, 4, 80, 2, ' px', (v) => store.patchAnalysis({ edgeMarginPx: v })),
    );
  };
  rebuildControls();

  const showNormals = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const showExcluded = h('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
  showNormals.addEventListener('change', () => viewer.setOptions({ showNormals: showNormals.checked }));
  showExcluded.addEventListener('change', () => viewer.setOptions({ showExcluded: showExcluded.checked }));

  const statusLine = h('div', { class: 'muted', style: 'margin:10px 0' }, '尚未运行分类');

  async function runClassify(): Promise<void> {
    const st = store.get();
    if (!st.sample || !st.engine) return;
    store.set({ running: true, error: null });
    store.log(`开始分类：${st.sample.name}（${st.engine.kind}）`);
    try {
      const t0 = performance.now();
      const grid = await st.engine.classify(st.sample.source, st.classParams);
      const ms = performance.now() - t0;
      store.log(`分类完成，用时 ${ms.toFixed(0)} ms，网格 ${grid.gridWidth}×${grid.gridHeight}`);
      const loop = extractContour(grid);
      store.log(`边缘提取：轮廓 ${loop.length} 个顶点`);
      const ap = st.analysisParams;
      const smooth = resampleAndSmooth(loop, ap.stationSpacingUm / ap.umPerPixel, ap.smoothSigmaUm / ap.umPerPixel);
      currentStations = buildStations(smooth, grid, ap);
      const excluded = currentStations.filter((x) => x.excluded).length;
      const reasons = new Map<string, number>();
      for (const x of currentStations.filter((x) => x.excluded)) reasons.set(x.excludeReason!, (reasons.get(x.excludeReason!) ?? 0) + 1);
      statusLine.innerHTML = '';
      statusLine.append(
        h('div', {}, `测量站 ${currentStations.length} 个，排除 ${excluded} 个，有效 ${currentStations.length - excluded} 个`),
        ...[...reasons.entries()].map(([r, n]) => h('div', { class: 'muted' }, `· ${r}：${n} 站`)),
      );
      store.set({ grid, running: false });
      viewer.setData(st.sample.source, grid, currentStations);
    } catch (err) {
      store.set({ running: false, error: (err as Error).message });
      store.log('分类失败：' + (err as Error).message);
    }
  }

  const panel = h('div', { class: 'panel' },
    h('h2', {}, '边缘识别'),
    controls,
    h('h3', {}, '显示'),
    h('label', { class: 'checkbox-row' }, showNormals, '内法线'),
    h('label', { class: 'checkbox-row' }, showExcluded, '显示被排除站点（红）'),
    h('button', {
      class: 'row', onclick: () => void runClassify(),
    }, '运行边缘识别'),
    statusLine,
    h('h3', {}, '运行日志'),
    logBox,
  );

  const viewerHost = h('div', { style: 'height:100%;min-height:520px' });
  viewerHost.append(viewer.el);
  root.append(h('div', { class: 'layout' }, panel, viewerHost));
  if (s.grid && s.sample) viewer.setData(s.sample.source, s.grid, s.report?.stations ?? []);
  refreshLog();
  void unsub;
}
