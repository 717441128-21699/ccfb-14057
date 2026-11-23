import { store } from './state.ts';
import { runPipeline } from '../core/pipeline.ts';

/** 运行完整管线并写入全局状态，返回是否成功 */
export async function runFullAnalysis(): Promise<boolean> {
  const st = store.get();
  if (!st.sample || !st.engine) {
    store.set({ error: '请先在试样页加载试样并初始化引擎' });
    return false;
  }
  store.set({ running: true, error: null });
  store.log('启动完整分析管线…');
  try {
    const t0 = performance.now();
    const { report, grid } = await runPipeline(
      st.sample.source,
      st.sample.name,
      st.classParams,
      st.analysisParams,
      st.engine,
    );
    report.timingMs.total = +(performance.now() - t0).toFixed(1);
    store.log(
      `分析完成：总用时 ${report.timingMs.total}ms，` +
      `有效站 ${report.validCount}/${report.stationCount}，` +
      `最深总脱碳 ${report.deepest.totalDepthUm.toFixed(1)}µm`,
    );
    store.set({ report, grid, running: false });
    return true;
  } catch (err) {
    store.set({ running: false, error: (err as Error).message });
    store.log('分析失败：' + (err as Error).message);
    return false;
  }
}
