import { h, fmtUm, download } from '../ui/dom.ts';
import { store } from '../ui/state.ts';
import { runFullAnalysis } from '../ui/analysis-service.ts';
import type { DecarbReport } from '../core/types.ts';

function stationsCsv(report: DecarbReport): string {
  const head = 'station_id,arc_um,x_px,y_px,radius_um,excluded,reason,full_depth_um,total_depth_um';
  const rows = report.stations.map((s) =>
    [s.id, s.arcUm.toFixed(2), s.x.toFixed(1), s.y.toFixed(1), s.radiusUm.toFixed(1),
      s.excluded ? 1 : 0, `"${s.excludeReason ?? ''}"`,
      s.fullDepthUm?.toFixed(2) ?? '', s.totalDepthUm?.toFixed(2) ?? ''].join(','),
  );
  return [head, ...rows].join('\n');
}

function printReport(): void {
  window.print();
}

export function renderReportPage(root: HTMLElement): void {
  const s = store.get();
  const panel = h('div', { class: 'panel' },
    h('h2', {}, '报告与导出'),
    h('button', {
      class: 'row', onclick: async () => {
        if (await runFullAnalysis()) renderReportPage(root);
      },
    }, '重新运行分析并刷新报告'),
    h('button', {
      class: 'secondary row', onclick: () => {
        const r = store.get().report;
        if (r) download(`${r.imageName}-report.json`, JSON.stringify(r, null, 2), 'application/json');
      },
    }, '导出 JSON（含全部站点剖面）'),
    h('button', {
      class: 'secondary row', onclick: () => {
        const r = store.get().report;
        if (r) download(`${r.imageName}-stations.csv`, stationsCsv(r), 'text/csv');
      },
    }, '导出站点 CSV'),
    h('button', { class: 'secondary row', onclick: printReport }, '打印 / 另存 PDF'),
    h('h3', {}, '判定依据'),
    h('p', { class: 'muted' },
      '依据 GB/T 224-2019《钢的脱碳层深度测定法》金相法：全脱碳层为全铁素体组织区，',
      '总脱碳层为全脱碳层 + 部分脱碳层（铁素体比例较心部明显增加的区域）。',
      '倒角、抛光圆角等曲率异常位置按标准不参与评定。'),
  );

  const body = h('div', { class: 'panel' });
  if (!s.report) {
    body.append(h('div', { class: 'muted' }, '尚无分析结果，请先在“深度分布”页运行分析。'));
  } else {
    body.append(reportContent(s.report));
  }
  root.append(h('div', { class: 'layout narrow' }, panel, body));
}

function reportContent(r: DecarbReport): HTMLElement {
  const synth = store.get().sample?.synthetic;
  const tolPass = r.total.maxUm <= 600; // 示例工艺限值，实际由工艺卡片给定
  return h('div', {},
    h('h2', {}, '脱碳层深度检验报告'),
    h('table', {},
      h('tbody', {},
        row('试样/图像', r.imageName),
        row('图像尺寸', `${r.imageWidth} × ${r.imageHeight} px`),
        row('像素标定', `${r.umPerPixel} µm/px`),
        row('检验时间', new Date(r.createdAt).toLocaleString()),
        row('计算引擎', store.get().engine?.kind ?? '—'),
        row('测量站数', `${r.validCount} 有效 / ${r.stationCount} 总计（排除 ${r.excludedCount}）`),
        row('轮廓周长', `${(r.perimeterUm / 1000).toFixed(3)} mm`),
      ),
    ),
    h('h3', {}, '总脱碳层深度统计'),
    h('div', { class: 'kpi-grid' },
      kpi('最深点', fmtMm(r.total.maxUm), 4),
      kpi('平均值', fmtMm(r.total.meanUm), 4),
      kpi('中位数', fmtMm(r.total.medianUm), 4),
      kpi('P95', fmtMm(r.total.p95Um), 4),
    ),
    h('h3', {}, '全脱碳层深度统计'),
    h('div', { class: 'kpi-grid' },
      kpi('最深点', fmtMm(r.full.maxUm), 4),
      kpi('平均值', fmtMm(r.full.meanUm), 4),
      kpi('中位数', fmtMm(r.full.medianUm), 4),
      kpi('P95', fmtMm(r.full.p95Um), 4),
    ),
    h('h3', {}, '最深点位置'),
    h('table', {}, h('tbody', {},
      row('站点编号', `#${r.deepest.stationId}`),
      row('像素坐标', `(${r.deepest.xPx.toFixed(1)}, ${r.deepest.yPx.toFixed(1)})`),
      row('弧长位置', `${r.deepest.arcUm.toFixed(1)} µm`),
      row('总脱碳深度', fmtUm(r.deepest.totalDepthUm)),
      row('全脱碳深度', fmtUm(r.deepest.fullDepthUm)),
    )),
    synth
      ? h('h3', {}, '合成图真值对照',
        h('table', {}, h('tbody', {},
          row('真值最大总脱碳', fmtUm(synth.trueMaxTotalUm)),
          row('实测最大总脱碳', fmtUm(r.total.maxUm)),
          row('最大偏差', fmtUm(Math.abs(r.total.maxUm - synth.trueMaxTotalUm))),
          h('tr', {}, h('td', {}, '0.02mm 精度判据'),
            h('td', {}, h('span', {
              class: `badge ${Math.abs(r.total.maxUm - synth.trueMaxTotalUm) <= 20 ? 'ok' : 'bad'}`,
            }, Math.abs(r.total.maxUm - synth.trueMaxTotalUm) <= 20 ? '通过（≤20µm）' : '不通过'))),
        )))
      : null,
    h('h3', {}, '工艺限值评定（示例：总脱碳 ≤ 0.60mm）'),
    h('p', {}, h('span', { class: `badge ${tolPass ? 'ok' : 'bad'}` },
      tolPass ? '合格' : '不合格')),
    h('h3', {}, '计算耗时'),
    h('table', {}, h('tbody', {}, ...Object.entries(r.timingMs).map(([k, v]) => row(k, `${v} ms`)))),
  );
}

function row(k: string, v: string): HTMLElement {
  return h('tr', {}, h('td', {}, k), h('td', {}, v));
}
function kpi(label: string, value: string, _span?: number): HTMLElement {
  return h('div', { class: 'kpi' }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label));
}
function fmtMm(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? '—' : `${(v / 1000).toFixed(4)} mm`;
}
