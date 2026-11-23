import { h } from '../ui/dom.ts';
import { store } from '../ui/state.ts';
import { Viewer } from '../ui/viewer.ts';
import { lineChart } from '../ui/chart.ts';
import { runFullAnalysis } from '../ui/analysis-service.ts';
import { fmtUm } from '../ui/dom.ts';
import type { Station } from '../core/types.ts';

export function renderDepthPage(root: HTMLElement): void {
  const s = store.get();
  const viewer = new Viewer();
  const chartCanvas = h('canvas') as HTMLCanvasElement;
  const profileCanvas = h('canvas') as HTMLCanvasElement;
  const statBox = h('div', {});
  const selectedBox = h('div', { class: 'muted' }, '点击图上站点查看该站法向剖面');

  const fieldSel = h('select', {},
    h('option', { value: 'total' }, '总脱碳层深度'),
    h('option', { value: 'full' }, '全脱碳层深度'),
  ) as HTMLSelectElement;
  fieldSel.addEventListener('change', () => {
    viewer.setOptions({ depthField: fieldSel.value as 'total' | 'full' });
    drawCharts();
  });

  function drawCharts(): void {
    const report = store.get().report;
    if (!report) return;
    const valid = report.stations.filter((x) => !x.excluded);
    const series = [
      {
        name: '总脱碳',
        color: '#ff8a5c',
        points: valid.map((x) => ({ x: x.arcUm, y: x.totalDepthUm ?? 0 })),
      },
      {
        name: '全脱碳',
        color: '#5aa0ff',
        points: valid.map((x) => ({ x: x.arcUm, y: x.fullDepthUm ?? 0 })),
      },
    ];
    lineChart(chartCanvas, series, { xLabel: '弧长位置 (µm)', yLabel: '深度 (µm)', height: 240 });

    const d = report.deepest;
    statBox.replaceChildren(
      h('div', { class: 'kpi-grid' },
        kpi('最深点总脱碳', fmtUm(d.totalDepthUm)),
        kpi('平均总脱碳', fmtUm(report.total.meanUm)),
        kpi('中位数', fmtUm(report.total.medianUm)),
        kpi('P95', fmtUm(report.total.p95Um)),
        kpi('最深点全脱碳', fmtUm(d.fullDepthUm)),
        kpi('平均全脱碳', fmtUm(report.full.meanUm)),
        kpi('有效/总站点', `${report.validCount}/${report.stationCount}`),
        kpi('周长', `${(report.perimeterUm / 1000).toFixed(2)} mm`),
      ),
    );
  }

  function kpi(label: string, value: string): HTMLElement {
    return h('div', { class: 'kpi' }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label));
  }

  function showProfile(st: Station): void {
    const baselineNote = h('div', { class: 'muted' });
    const ap = store.get().analysisParams;
    lineChart(profileCanvas, [
      {
        name: '铁素体面积比',
        color: '#38e1c6',
        points: st.profile.map((p) => ({ x: p.depthUm, y: p.ferrite })),
      },
      {
        name: '金属占比',
        color: '#8d99a9',
        dashed: true,
        points: st.profile.map((p) => ({ x: p.depthUm, y: p.metal })),
      },
    ], { xLabel: '法向深度 (µm)', yLabel: '面积比', height: 200 });
    baselineNote.textContent =
      `站点 #${st.id}｜弧长 ${st.arcUm.toFixed(0)}µm｜曲率半径 ${st.radiusUm.toFixed(0)}µm` +
      (st.excluded ? `｜已排除：${st.excludeReason}` : '') +
      `｜全脱碳 ${fmtUm(st.fullDepthUm)}｜总脱碳 ${fmtUm(st.totalDepthUm)}` +
      `｜判定带 基线±${ap.coreTolAbs}`;
    selectedBox.replaceChildren(baselineNote);
  }

  viewer.setOptions({
    depthField: fieldSel.value as 'total' | 'full',
    onSelect: (id) => {
      const st = store.get().report?.stations.find((x) => x.id === id);
      if (st) showProfile(st);
    },
  });

  const runBtn = h('button', {
    class: 'row',
    onclick: async () => {
      const ok = await runFullAnalysis();
      if (ok) {
        const st = store.get();
        viewer.setData(st.sample!.source, st.grid, st.report!.stations);
        drawCharts();
        const deepestStation = st.report!.stations.find((x) => x.id === st.report!.deepest.stationId);
        if (deepestStation) showProfile(deepestStation);
      }
    },
  }, '运行完整分析');

  const panel = h('div', { class: 'panel' },
    h('h2', {}, '深度分布'),
    h('label', { class: 'field' }, h('span', {}, '深度着色字段'), fieldSel),
    runBtn,
    statBox,
    h('h3', {}, '沿整圈深度曲线'),
    h('div', { class: 'chart-wrap' }, chartCanvas),
    h('h3', {}, '站点法向剖面'),
    h('div', { class: 'chart-wrap' }, profileCanvas),
    selectedBox,
  );

  const viewerHost = h('div', { style: 'height:100%;min-height:560px' });
  viewerHost.append(viewer.el);
  root.append(h('div', { class: 'layout' }, panel, viewerHost));

  if (s.report && s.grid && s.sample) {
    viewer.setData(s.sample.source, s.grid, s.report.stations);
    drawCharts();
    const deepestStation = s.report.stations.find((x) => x.id === s.report!.deepest.stationId);
    if (deepestStation) showProfile(deepestStation);
  }
}
