import type { FractionGrid, Station } from '../core/types.ts';
import type { PixelSource } from '../core/types.ts';
import { h } from './dom.ts';

export interface OverlayOptions {
  showContour: boolean;
  showNormals: boolean;
  showStations: boolean;
  showExcluded: boolean;
  /** 深度着色，null 表示只画边缘 */
  depthField: 'total' | 'full' | null;
  selectedId: number | null;
  onSelect?: (id: number | null) => void;
}

/**
 * 金相图 + 分析结果叠加查看器。
 * 底层用网格面积比着色（数据量小，适合上亿像素图像的快速预览），
 * 上层画轮廓、站点、法向剖面与深度色带。
 */
export class Viewer {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private source: PixelSource | null = null;
  private grid: FractionGrid | null = null;
  private stations: Station[] = [];
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private opts: OverlayOptions = {
    showContour: true,
    showNormals: false,
    showStations: true,
    showExcluded: true,
    depthField: 'total',
    selectedId: null,
  };

  constructor() {
    this.canvas = h('canvas', { class: 'viewer-canvas' }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const wrap = h('div', { class: 'viewer-wrap' }, this.canvas);
    this.el = wrap;
    this.bindInteraction();
  }

  private bindInteraction(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.tx = mx - (mx - this.tx) * factor;
      this.ty = my - (my - this.ty) * factor;
      this.scale *= factor;
      this.render();
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.tx += e.clientX - lastX;
      this.ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.render();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    });
    this.canvas.addEventListener('click', (e) => {
      if (!this.opts.onSelect || this.stations.length === 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left - this.tx) / this.scale;
      const py = (e.clientY - rect.top - this.ty) / this.scale;
      let best: Station | null = null;
      let bestD = 12 / this.scale;
      for (const s of this.stations) {
        const d = Math.hypot(s.x - px, s.y - py);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      this.opts.selectedId = best ? best.id : null;
      this.opts.onSelect(this.opts.selectedId);
      this.render();
    });
  }

  setData(source: PixelSource | null, grid: FractionGrid | null, stations: Station[]): void {
    this.source = source;
    this.grid = grid;
    this.stations = stations;
    this.fit();
  }

  setOptions(patch: Partial<OverlayOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.render();
  }

  fit(): void {
    if (!this.source) return;
    const parent = this.el.parentElement;
    const pw = parent?.clientWidth ?? 800;
    const ph = parent?.clientHeight ?? 600;
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.scale = Math.min(pw / this.source.width, ph / this.source.height);
    this.tx = (pw - this.source.width * this.scale) / 2;
    this.ty = (ph - this.source.height * this.scale) / 2;
    this.render();
  }

  private depthColor(s: Station): string {
    const v = this.opts.depthField === 'full' ? s.fullDepthUm : s.totalDepthUm;
    if (v == null) return '#888';
    const max = 400;
    const t = Math.min(1, v / max);
    // 绿 → 黄 → 红
    const hue = 120 * (1 - t);
    return `hsl(${hue}, 85%, 50%)`;
  }

  render(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = '#11141a';
    ctx.fillRect(0, 0, w, h);
    if (!this.source) return;
    ctx.save();
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.scale, this.scale);

    if (this.grid) this.drawGrid();
    if (this.opts.depthField) this.drawDepthRibbons();
    if (this.opts.showContour) this.drawContour();
    if (this.opts.showNormals) this.drawNormals();
    if (this.opts.showStations) this.drawStations();
    ctx.restore();
  }

  private drawGrid(): void {
    const g = this.grid!;
    const img = this.ctx.createImageData(g.gridWidth, g.gridHeight);
    for (let i = 0; i < g.ferrite.length; i++) {
      const metal = g.metal[i];
      const o = i * 4;
      if (metal < 0.05) {
        img.data[o] = 24; img.data[o + 1] = 26; img.data[o + 2] = 32; img.data[o + 3] = 255;
      } else {
        const f = g.ferrite[i];
        img.data[o] = 60 + f * 170;
        img.data[o + 1] = 55 + f * 150;
        img.data[o + 2] = 70 + (1 - f) * 90;
        img.data[o + 3] = 255;
      }
    }
    // 先放大到临时 canvas 再按世界坐标贴回
    const tmp = document.createElement('canvas');
    tmp.width = g.gridWidth;
    tmp.height = g.gridHeight;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(tmp, 0, 0, g.imageWidth, g.imageHeight);
  }

  private pathFromStations(filter?: (s: Station) => boolean): void {
    const pts = this.stations.filter((s) => (filter ? filter(s) : true));
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  private drawContour(): void {
    const ctx = this.ctx;
    ctx.lineWidth = 2 / this.scale;
    this.pathFromStations();
    ctx.strokeStyle = '#38e1c6';
    ctx.stroke();
  }

  private drawDepthRibbons(): void {
    const ctx = this.ctx;
    for (const s of this.stations) {
      if (s.excluded) continue;
      const v = this.opts.depthField === 'full' ? s.fullDepthUm : s.totalDepthUm;
      if (v == null) continue;
      const lenPx = v / s.umPerPixel;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.nx * lenPx, s.y + s.ny * lenPx);
      ctx.strokeStyle = this.depthColor(s);
      ctx.lineWidth = 3 / this.scale;
      ctx.stroke();
    }
  }

  private drawNormals(): void {
    const ctx = this.ctx;
    for (const s of this.stations) {
      if (s.excluded && !this.opts.showExcluded) continue;
      const len = 60 / s.umPerPixel;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.nx * len, s.y + s.ny * len);
      ctx.strokeStyle = s.excluded ? 'rgba(255,90,90,.5)' : 'rgba(120,180,255,.7)';
      ctx.lineWidth = 1 / this.scale;
      ctx.stroke();
    }
  }

  private drawStations(): void {
    const ctx = this.ctx;
    for (const s of this.stations) {
      if (s.excluded && !this.opts.showExcluded) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3 / this.scale, 0, Math.PI * 2);
      if (s.excluded) ctx.fillStyle = '#ff5a5a';
      else if (s.id === this.opts.selectedId) ctx.fillStyle = '#ffffff';
      else ctx.fillStyle = this.opts.depthField ? this.depthColor(s) : '#38e1c6';
      ctx.fill();
    }
  }
}
