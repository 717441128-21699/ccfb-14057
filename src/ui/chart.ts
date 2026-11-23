/** 轻量折线图（纯 Canvas，无依赖），支持双序列与悬停 */
export interface LineSeries {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

export function lineChart(canvas: HTMLCanvasElement, series: LineSeries[], opts: {
  xLabel: string;
  yLabel: string;
  height?: number;
}): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 800;
  const cssH = opts.height ?? 260;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 38;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (allX.length === 0) return;
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMin = 0;
  const yMax = Math.max(50, Math.max(...allY) * 1.1);

  ctx.fillStyle = '#171c26';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = '#2a3342';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8d99a9';
  ctx.font = '11px system-ui';

  // y 网格
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const y = padT + (h * i) / yTicks;
    const val = yMax - ((yMax - yMin) * i) / yTicks;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + w, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(0), 8, y + 4);
  }
  // x 刻度
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const x = padL + (w * i) / xTicks;
    const val = xMin + ((xMax - xMin) * i) / xTicks;
    ctx.fillText(val.toFixed(0), x - 12, cssH - 14);
  }
  ctx.fillText(opts.yLabel, 8, 12);
  ctx.fillText(opts.xLabel, cssW / 2 - 30, cssH - 2);

  const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * w;
  const sy = (y: number) => padT + h - ((y - yMin) / (yMax - yMin || 1)) * h;

  for (const s of series) {
    if (s.points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    s.points.forEach((p, i) => {
      const px = sx(p.x);
      const py = sy(p.y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 图例
  let lx = padL + 8;
  ctx.font = '12px system-ui';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, padT + 4, 14, 3);
    ctx.fillStyle = '#dfe5ee';
    ctx.fillText(s.name, lx + 18, padT + 9);
    lx += ctx.measureText(s.name).width + 34;
  }
}
