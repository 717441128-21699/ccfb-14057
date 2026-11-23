import { h } from './dom.ts';
import { store } from './state.ts';
import { renderSamplePage } from '../pages/sample-page.ts';
import { renderEdgePage } from '../pages/edge-page.ts';
import { renderDepthPage } from '../pages/depth-page.ts';
import { renderReportPage } from '../pages/report-page.ts';

const NAV = [
  { hash: '#/sample', label: '① 试样', render: renderSamplePage },
  { hash: '#/edge', label: '② 边缘识别', render: renderEdgePage },
  { hash: '#/depth', label: '③ 深度分布', render: renderDepthPage },
  { hash: '#/report', label: '④ 报告', render: renderReportPage },
] as const;

export function startApp(): void {
  const app = document.getElementById('app')!;
  const content = h('div', { class: 'page-content' });
  const navEl = h(
    'nav',
    { class: 'top-nav' },
    h('div', { class: 'brand' }, '脱碳层图像分析'),
    ...NAV.map((item) =>
      h('a', {
        class: 'nav-link',
        href: item.hash,
        'data-hash': item.hash,
      }, item.label),
    ),
    h('div', { class: 'engine-badge', id: 'engine-badge' }, '引擎：—'),
  );
  app.append(navEl, content);

  const route = (): void => {
    const hash = location.hash || '#/sample';
    const item = NAV.find((n) => n.hash === hash) ?? NAV[0];
    document.querySelectorAll<HTMLElement>('.nav-link').forEach((a) => {
      a.classList.toggle('active', a.dataset.hash === item.hash);
    });
    content.replaceChildren();
    item.render(content);
  };
  window.addEventListener('hashchange', route);

  store.subscribe((s) => {
    const badge = document.getElementById('engine-badge');
    if (badge) badge.textContent = `引擎：${s.engine?.kind ?? '—'}`;
  });

  route();
}
