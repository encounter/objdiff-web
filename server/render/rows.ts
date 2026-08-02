import type { display } from 'objdiff-wasm';

import { type AsmSpan, instructionRowToSpans } from '../../shared/render/asm';
import { type DataRow, dataRowToSpans } from '../../shared/render/data';
import type { SymbolPair } from '../diff';
import { display as displayApi } from '../wasm';

export type AsmSide = {
  spans: AsmSpan[];
  diffKind: display.InstructionDiffKind;
} | null;

export type DiffRow = {
  index: number;
  left: AsmSide;
  right: AsmSide;
};

export type DataDiffRow = {
  index: number;
  left: DataRow | null;
  right: DataRow | null;
};

/** Counts of instruction rows by how they differ, for the match summary. */
export type InstructionStats = {
  total: number;
  matching: number;
  opMismatch: number;
  argMismatch: number;
  replaced: number;
  inserted: number;
  deleted: number;
};

const emptyStats = (): InstructionStats => ({
  total: 0,
  matching: 0,
  opMismatch: 0,
  argMismatch: 0,
  replaced: 0,
  inserted: 0,
  deleted: 0,
});

const tally = (stats: InstructionStats, kind: display.InstructionDiffKind) => {
  stats.total++;
  switch (kind) {
    case 'none':
      stats.matching++;
      break;
    case 'op-mismatch':
      stats.opMismatch++;
      break;
    case 'arg-mismatch':
      stats.argMismatch++;
      break;
    case 'replace':
      stats.replaced++;
      break;
    case 'insert':
      stats.inserted++;
      break;
    case 'delete':
      stats.deleted++;
      break;
  }
};

export const isFunction = (pair: SymbolPair): boolean =>
  (pair.left?.symbol.info.kind ?? pair.right?.symbol.info.kind) === 'function';

/** Lay out every instruction row of a symbol on both sides. */
export const buildAsmRows = (
  pair: SymbolPair,
): { rows: DiffRow[]; stats: InstructionStats } => {
  const { result, config } = pair.unitDiff;
  const rowCount = Math.max(
    pair.left?.symbol.rowCount ?? 0,
    pair.right?.symbol.rowCount ?? 0,
  );
  const rows: DiffRow[] = [];
  const stats = emptyStats();

  for (let index = 0; index < rowCount; index++) {
    let left: AsmSide = null;
    let right: AsmSide = null;
    if (result.left && pair.left && index < pair.left.symbol.rowCount) {
      const row = displayApi.displayInstructionRow(
        result.left,
        pair.left.symbol.info.id,
        index,
        config,
      );
      left = { spans: instructionRowToSpans(row), diffKind: row.diffKind };
      tally(stats, row.diffKind);
    }
    if (result.right && pair.right && index < pair.right.symbol.rowCount) {
      const row = displayApi.displayInstructionRow(
        result.right,
        pair.right.symbol.info.id,
        index,
        config,
      );
      right = { spans: instructionRowToSpans(row), diffKind: row.diffKind };
      if (!left) {
        // Rows that exist only on the base side still count towards the total.
        tally(stats, row.diffKind);
      }
    }
    rows.push({ index, left, right });
  }
  return { rows, stats };
};

/** Lay out every row of a data symbol on both sides. */
export const buildDataRows = (pair: SymbolPair): DataDiffRow[] => {
  const { result } = pair.unitDiff;
  const rowCount = Math.max(
    pair.left?.symbol.rowCount ?? 0,
    pair.right?.symbol.rowCount ?? 0,
  );
  const rows: DataDiffRow[] = [];
  for (let index = 0; index < rowCount; index++) {
    rows.push({
      index,
      left:
        result.left && pair.left && index < pair.left.symbol.rowCount
          ? dataRowToSpans(
              displayApi.displayDataRow(
                result.left,
                pair.left.symbol.info.id,
                index,
              ),
            )
          : null,
      right:
        result.right && pair.right && index < pair.right.symbol.rowCount
          ? dataRowToSpans(
              displayApi.displayDataRow(
                result.right,
                pair.right.symbol.info.id,
                index,
              ),
            )
          : null,
    });
  }
  return rows;
};
