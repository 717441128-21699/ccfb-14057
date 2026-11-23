import type {
  AnalysisEngine,
  AnalysisParams,
  ClassParams,
  DecarbReport,
  FractionGrid,
  PixelSource,
} from '../core/types.ts';
import { defaultAnalysisParams, defaultClassParams } from '../core/types.ts';

export interface SampleInfo {
  name: string;
  source: PixelSource;
  umPerPixel: number;
  /** 合成图附带的真值信息 */
  synthetic?: {
    shapeKind: string;
    trueMaxTotalUm: number;
    trueMaxFullUm: number;
  };
}

export interface AppState {
  sample: SampleInfo | null;
  engine: AnalysisEngine | null;
  classParams: ClassParams;
  analysisParams: AnalysisParams;
  grid: FractionGrid | null;
  report: DecarbReport | null;
  running: boolean;
  error: string | null;
  logs: string[];
}

type Listener = (state: AppState) => void;

class Store {
  private state: AppState = {
    sample: null,
    engine: null,
    classParams: defaultClassParams(),
    analysisParams: defaultAnalysisParams(),
    grid: null,
    report: null,
    running: false,
    error: null,
    logs: [],
  };
  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  patchClass(patch: Partial<ClassParams>): void {
    this.set({ classParams: { ...this.state.classParams, ...patch } });
  }

  patchAnalysis(patch: Partial<AnalysisParams>): void {
    const analysisParams = { ...this.state.analysisParams, ...patch };
    this.set({ analysisParams });
  }

  log(msg: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this.set({ logs: [...this.state.logs.slice(-199), line] });
  }
}

export const store = new Store();
