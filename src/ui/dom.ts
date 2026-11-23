/** 极简 DOM 构建工具（无框架） */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | null | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function fmtUm(v: number | null | undefined, digits = 1): string {
  return v == null || Number.isNaN(v) ? '—' : `${v.toFixed(digits)} µm`;
}

export function fmtMm(v: number | null | undefined, digits = 3): string {
  return v == null || Number.isNaN(v) ? '—' : `${(v / 1000).toFixed(digits)} mm`;
}

export function download(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
