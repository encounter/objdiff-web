import type { AsmSpan } from '../../shared/render/asm';
import type { DataSpan } from '../../shared/render/data';
import type { SymbolPair } from '../diff';
import {
  type DiffRow,
  type InstructionStats,
  buildAsmRows,
  buildDataRows,
  isFunction,
} from './rows';

export type HtmlOptions = {
  /** `auto` follows the viewer's OS preference. */
  theme: 'auto' | 'light' | 'dark';
  /** When true, emit only the fragment — no <html>, <head> or <body>. */
  embed: boolean;
};

export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );

const percentBucket = (percent: number): string => {
  if (percent >= 100) {
    return 'p100';
  }
  if (percent >= 50) {
    return 'p50';
  }
  return 'p0';
};

const spanClass = (span: AsmSpan): string =>
  span.color === 'rotating'
    ? `rot${span.rotation ?? 0}`
    : span.color === 'normal'
      ? ''
      : `c-${span.color}`;

const renderAsmSpans = (spans: AsmSpan[] | undefined): string => {
  if (!spans) {
    return '';
  }
  return spans
    .map((span) => {
      const cls = spanClass(span);
      const text = escapeHtml(span.text);
      return cls ? `<span class="${cls}">${text}</span>` : text;
    })
    .join('');
};

const renderDataSpans = (spans: DataSpan[]): string =>
  spans
    .map((span) =>
      span.kind === 'none'
        ? escapeHtml(span.text)
        : `<span class="c-${span.kind}">${escapeHtml(span.text)}</span>`,
    )
    .join('');

const rowClass = (row: DiffRow): string => {
  const kind = row.left?.diffKind ?? row.right?.diffKind ?? 'none';
  return kind === 'none' ? 'row' : 'row diff';
};

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: light-dark(#ffffff, #1f1f1f);
  --panel: light-dark(#f8f8f8, #181818);
  --fg: light-dark(#3b3b3b, #cccccc);
  --bright: light-dark(#000000, #ffffff);
  --muted: light-dark(rgba(97,97,97,.65), rgba(204,204,204,.55));
  --border: light-dark(#e5e5e5, #2b2b2b);
  --green: light-dark(#00a300, #3fb950);
  --red: light-dark(#c80a00, #f85149);
  --blue: light-dark(#006d90, #add8e6);
  --data-flow: light-dark(#8250df, #c586c0);
  --row-diff: light-dark(rgba(0,0,0,.035), rgba(255,255,255,.04));
  --ui: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--ui); font-size: 13px; }
.objdiff { display: flex; flex-direction: column; min-height: 100vh; }
header.hdr {
  position: sticky; top: 0; z-index: 2;
  background: var(--panel); border-bottom: 1px solid var(--border);
  padding: 14px 18px; display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
}
.title { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1 1 auto; }
.sym { font-family: var(--mono); font-size: 15px; color: var(--bright); font-weight: 600;
       overflow-wrap: anywhere; }
.sub { color: var(--muted); font-size: 12px; }
.badge { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex: 0 0 auto; }
.pct { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.pct.p100 { color: var(--green); }
.pct.p50 { color: var(--blue); }
.pct.p0 { color: var(--red); }
.bar { width: 190px; height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
.bar > i { display: block; height: 100%; border-radius: 3px; }
.bar.p100 > i { background: var(--green); }
.bar.p50 > i { background: var(--blue); }
.bar.p0 > i { background: var(--red); }
.cols { display: flex; border-bottom: 1px solid var(--border); background: var(--panel);
        position: sticky; top: 0; }
.cols > div { flex: 1 1 0; padding: 6px 12px; font-size: 11px; letter-spacing: .06em;
              text-transform: uppercase; color: var(--muted); }
.cols > div + div { border-left: 1px solid var(--border); }
.body { flex: 1 1 auto; overflow-x: auto; }
.rows { font-family: var(--mono); font-size: 12px; line-height: 1.45; min-width: min-content; }
.row { display: flex; white-space: pre; }
.row:hover { background: light-dark(rgba(0,0,0,.05), rgba(255,255,255,.07)); }
.row.diff { background: var(--row-diff); }
.row > .n { flex: 0 0 auto; width: 4.5ch; text-align: right; padding-right: 10px;
            color: var(--muted); user-select: none; }
.row > .cell { flex: 1 1 0; padding: 0 12px; overflow: hidden; }
.row > .cell + .cell { border-left: 1px solid var(--border); }
.c-dim { color: var(--muted); }
.c-bright { color: var(--bright); }
.c-replace { color: var(--blue); }
.c-delete { color: var(--red); }
.c-insert { color: var(--green); }
.c-data-flow { color: var(--data-flow); }
.rot0 { color: light-dark(rgb(205,82,82), magenta); }
.rot1 { color: light-dark(rgb(205,164,82), cyan); }
.rot2 { color: light-dark(rgb(164,205,82), rgb(0,212,0)); }
.rot3 { color: light-dark(rgb(82,205,82), red); }
.rot4 { color: light-dark(rgb(82,205,164), rgb(103,106,255)); }
.rot5 { color: light-dark(rgb(82,164,205), lightpink); }
.rot6 { color: light-dark(rgb(82,82,205), lightcyan); }
.rot7 { color: light-dark(rgb(164,82,205), lightgreen); }
.rot8 { color: light-dark(rgb(205,82,164), grey); }
footer.legend {
  position: sticky; bottom: 0; background: var(--panel); border-top: 1px solid var(--border);
  padding: 8px 18px; display: flex; flex-wrap: wrap; gap: 16px; font-size: 11px; color: var(--muted);
}
footer.legend b { font-weight: 600; color: var(--fg); }
.stat { white-space: nowrap; }
.warn { padding: 10px 18px; color: var(--red); font-size: 12px; }
`;

const renderStats = (stats: InstructionStats): string =>
  [
    `<span class="stat"><b>${stats.total}</b> rows</span>`,
    `<span class="stat"><b>${stats.matching}</b> matching</span>`,
    `<span class="stat"><b>${stats.opMismatch}</b> opcode mismatch</span>`,
    `<span class="stat"><b>${stats.argMismatch}</b> argument mismatch</span>`,
    `<span class="stat"><b>${stats.replaced}</b> replaced</span>`,
    `<span class="stat"><b>${stats.inserted}</b> inserted</span>`,
    `<span class="stat"><b>${stats.deleted}</b> deleted</span>`,
  ].join('');

/** Render a symbol diff as a self-contained HTML page (or fragment). */
export const renderHtml = (pair: SymbolPair, options: HtmlOptions): string => {
  const info = pair.left?.symbol.info ?? pair.right?.symbol.info;
  const name = info?.demangledName || info?.name || pair.name;
  const percent = pair.left?.symbol.matchPercent;
  const bucket = percent != null ? percentBucket(percent) : 'p0';
  const section = pair.left?.section.name ?? pair.right?.section.name ?? '';

  let rowsHtml: string;
  let legend: string;

  if (isFunction(pair)) {
    const { rows, stats } = buildAsmRows(pair);
    rowsHtml = rows
      .map(
        (row) =>
          `<div class="${rowClass(row)}"><span class="n">${row.index + 1}</span>` +
          `<span class="cell">${renderAsmSpans(row.left?.spans)}</span>` +
          `<span class="cell">${renderAsmSpans(row.right?.spans)}</span></div>`,
      )
      .join('');
    legend = renderStats(stats);
  } else {
    const rows = buildDataRows(pair);
    const cell = (row: (typeof rows)[number]['left']) =>
      row
        ? `${escapeHtml(row.address)}${renderDataSpans(row.hex)} ${renderDataSpans(row.ascii)}`
        : '';
    rowsHtml = rows
      .map(
        (row) =>
          `<div class="row${row.left?.anyDiff || row.right?.anyDiff ? ' diff' : ''}">` +
          `<span class="n">${row.index + 1}</span>` +
          `<span class="cell">${cell(row.left)}</span>` +
          `<span class="cell">${cell(row.right)}</span></div>`,
      )
      .join('');
    legend = `<span class="stat"><b>${rows.length}</b> rows</span>`;
  }

  const warnings = [pair.unitDiff.targetError, pair.unitDiff.baseError]
    .filter((w): w is string => w != null)
    .map((w) => `<div class="warn">⚠ ${escapeHtml(w)}</div>`)
    .join('');

  const badge =
    percent != null
      ? `<span class="pct ${bucket}">${percent.toFixed(2)}%</span><span class="bar ${bucket}"><i style="width:${Math.min(100, Math.max(0, percent)).toFixed(2)}%"></i></span>`
      : '<span class="pct p0">n/a</span><span class="sub">no target symbol</span>';

  const fragment = [
    '<div class="objdiff">',
    '<header class="hdr">',
    '<div class="title">',
    `<span class="sym">${escapeHtml(name)}</span>`,
    `<span class="sub">${escapeHtml(pair.unitDiff.unit.name)}${section ? ` · ${escapeHtml(section)}` : ''}</span>`,
    '</div>',
    `<div class="badge">${badge}</div>`,
    '</header>',
    warnings,
    '<div class="cols"><div>Target (expected)</div><div>Base (current)</div></div>',
    `<div class="body"><div class="rows">${rowsHtml}</div></div>`,
    `<footer class="legend">${legend}</footer>`,
    '</div>',
  ].join('');

  if (options.embed) {
    return `<style>${STYLES}</style>${fragment}`;
  }

  const themeAttr =
    options.theme === 'auto' ? '' : ` data-theme="${options.theme}"`;
  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — objdiff</title>
<style>${STYLES}</style>
</head>
<body>${fragment}</body>
</html>
`;
};
