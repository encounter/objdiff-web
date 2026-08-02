import type { SymbolPair } from '../diff';
import { type DiffRow, buildAsmRows, buildDataRows, isFunction } from './rows';

const COLUMN_WIDTH = 58;

/** Marker in the gutter between the two columns, mirroring the UI's colors. */
const marker = (row: DiffRow): string => {
  const kind = row.left?.diffKind ?? row.right?.diffKind ?? 'none';
  switch (kind) {
    case 'none':
      return ' ';
    case 'op-mismatch':
      return '!';
    case 'arg-mismatch':
      return '~';
    case 'replace':
      return '|';
    case 'insert':
      return '+';
    case 'delete':
      return '-';
    default:
      return '?';
  }
};

const pad = (text: string, width: number) =>
  text.length >= width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);

const spansText = (spans: { text: string }[] | undefined) =>
  spans
    ?.map((s) => s.text)
    .join('')
    .trimEnd() ?? '';

/**
 * Render a symbol diff as two plain-text columns.
 *
 * This is the cheapest representation for an agent to read: no markup, no
 * colors, and a single-character gutter marking how each row differs.
 */
export const renderText = (pair: SymbolPair): string => {
  const name =
    pair.left?.symbol.info.demangledName ||
    pair.left?.symbol.info.name ||
    pair.right?.symbol.info.demangledName ||
    pair.right?.symbol.info.name ||
    pair.name;
  const percent = pair.left?.symbol.matchPercent;

  const lines: string[] = [];
  lines.push(`symbol:  ${name}`);
  lines.push(`unit:    ${pair.unitDiff.unit.name}`);
  lines.push(
    `match:   ${percent != null ? `${percent.toFixed(2)}%` : 'n/a (no target symbol)'}`,
  );
  lines.push('');
  lines.push(`${pad('TARGET (expected)', COLUMN_WIDTH)}   BASE (current)`);
  lines.push(`${'-'.repeat(COLUMN_WIDTH)}   ${'-'.repeat(COLUMN_WIDTH)}`);

  if (isFunction(pair)) {
    const { rows, stats } = buildAsmRows(pair);
    for (const row of rows) {
      lines.push(
        `${pad(spansText(row.left?.spans), COLUMN_WIDTH)} ${marker(row)} ${spansText(row.right?.spans)}`.trimEnd(),
      );
    }
    lines.push('');
    lines.push(
      `${stats.total} rows: ${stats.matching} matching, ${stats.opMismatch} opcode mismatch, ` +
        `${stats.argMismatch} argument mismatch, ${stats.replaced} replaced, ` +
        `${stats.inserted} inserted, ${stats.deleted} deleted`,
    );
    lines.push(
      'gutter: ! opcode  ~ argument  | replaced  + inserted  - deleted',
    );
  } else {
    for (const row of buildDataRows(pair)) {
      const left = row.left
        ? `${row.left.address}${row.left.hex.map((s) => s.text).join('')} ${row.left.ascii.map((s) => s.text).join('')}`
        : '';
      const right = row.right
        ? `${row.right.address}${row.right.hex.map((s) => s.text).join('')} ${row.right.ascii.map((s) => s.text).join('')}`
        : '';
      const differs = row.left?.anyDiff || row.right?.anyDiff;
      lines.push(
        `${pad(left.trimEnd(), 70)} ${differs ? '|' : ' '} ${right.trimEnd()}`.trimEnd(),
      );
    }
  }

  return `${lines.join('\n')}\n`;
};
