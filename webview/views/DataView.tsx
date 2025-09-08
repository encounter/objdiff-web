import styles from './DataView.module.css';

import { type diff, display } from 'objdiff-wasm';
import { memo, useCallback, useMemo } from 'react';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps, ListOnScrollProps } from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import { createContextMenu } from '../common/ContextMenu';
import { createTooltip } from '../common/TooltipShared';
import { useAppStore, useExtensionStore } from '../state';
import { useFontSize } from '../util/util';

const BYTES_PER_ROW = 16;

export type DataTooltipContent = {
  column: number;
  row: number;
};

export const { Tooltip: DataTooltip, useTooltip: useDataTooltip } =
  createTooltip<DataTooltipContent>();

export const {
  ContextMenuProvider: DataContextMenuProvider,
  useContextMenu: useDataContextMenu,
} = createContextMenu<DataTooltipContent>();

const DataRow = ({
  obj,
  symbol,
  row,
  column,
}: {
  obj: diff.ObjectDiff | undefined;
  symbol: display.SymbolDisplay | null;
  row: number;
  column: number;
}) => {
  const onContextMenu = useDataContextMenu();
  const tooltipContent: DataTooltipContent = useMemo(
    () => ({
      column,
      row,
    }),
    [column, row],
  );
  const tooltipProps = useDataTooltip(tooltipContent);
  const onContextMenuMemo = useCallback(
    (e: React.MouseEvent<HTMLElement>) => onContextMenu(e, tooltipContent),
    [onContextMenu, tooltipContent],
  );

  if (!obj || !symbol) {
    return null;
  }

  const dataRow = display.displayDataRow(obj, symbol.info.id, row);
  const out: React.ReactNode[] = [];

  // Display address
  out.push(
    <span key="addr" className={styles.address}>
      {dataRow.address.toString(16).padStart(8, '0')}:
    </span>,
  );

  // Display hex bytes
  let byteIndex = 0;
  const hexBytes: React.ReactNode[] = [];
  const asciiChars: React.ReactNode[] = [];

  for (const diff of dataRow.segments) {
    let className: string | undefined;
    switch (diff.kind) {
      case 'none':
        break;
      case 'replace':
        className = styles.replace;
        break;
      case 'delete':
        className = styles.delete;
        break;
      case 'insert':
        className = styles.insert;
        break;
    }

    // Check for relocations that overlap with this diff segment
    const diffStartAddr = dataRow.address + BigInt(byteIndex);
    const diffEndAddr = diffStartAddr + BigInt(diff.size);
    const relocsForDiff = dataRow.relocations.filter((r) => {
      const relocStart = r.address;
      const relocEnd = r.address + BigInt(r.size);
      // Check if relocation overlaps with this diff segment
      return relocStart < diffEndAddr && relocEnd > diffStartAddr;
    });

    if (diff.data.length === 0) {
      // Empty data (deletion on other side - show as blank spaces)
      for (let i = 0; i < diff.size; i++) {
        hexBytes.push(<span key={`hex-${byteIndex}`}>{'   '}</span>);
        asciiChars.push(<span key={`ascii-${byteIndex}`}> </span>);
        byteIndex++;
        if (byteIndex % 8 === 0 && byteIndex < BYTES_PER_ROW) {
          hexBytes.push(<span key={`space-${byteIndex}`}> </span>);
        }
      }
    } else {
      // Display actual bytes
      for (let i = 0; i < diff.data.length; i++) {
        const byte = diff.data[i];
        const currentAddress = dataRow.address + BigInt(byteIndex);
        const reloc = relocsForDiff.find(
          (r) =>
            r.address <= currentAddress &&
            currentAddress < r.address + BigInt(r.size),
        );

        let byteClassName = className;
        let byteText = byte.toString(16).padStart(2, '0');

        if (reloc) {
          if (byte === 0) {
            byteText = '??';
          }
          if (reloc.kind !== 'none') {
            switch (reloc.kind) {
              case 'replace':
                byteClassName = styles.replace;
                break;
              case 'delete':
                byteClassName = styles.delete;
                break;
              case 'insert':
                byteClassName = styles.insert;
                break;
            }
          }
        }

        hexBytes.push(
          <span key={`hex-${byteIndex}`} className={byteClassName}>
            {byteText}{' '}
          </span>,
        );

        // ASCII representation
        const c = String.fromCharCode(byte);
        const asciiChar =
          c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '.';
        asciiChars.push(
          <span key={`ascii-${byteIndex}`} className={className}>
            {asciiChar}
          </span>,
        );

        byteIndex++;
        if (byteIndex % 8 === 0 && byteIndex < BYTES_PER_ROW) {
          hexBytes.push(<span key={`space-${byteIndex}`}> </span>);
        }
      }
    }
  }

  // Pad to full row width if needed
  while (byteIndex < BYTES_PER_ROW) {
    hexBytes.push(<span key={`hex-${byteIndex}`}>{'   '}</span>);
    asciiChars.push(<span key={`ascii-${byteIndex}`}> </span>);
    byteIndex++;
    if (byteIndex % 8 === 0 && byteIndex < BYTES_PER_ROW) {
      hexBytes.push(<span key={`space-${byteIndex}`}> </span>);
    }
  }

  out.push(
    <span key="hex" className={styles.hexBytes}>
      {hexBytes}
    </span>,
  );
  out.push(
    <span key="sep" className={styles.separator}>
      {' '}
    </span>,
  );
  out.push(
    <span key="ascii" className={styles.asciiChars}>
      {asciiChars}
    </span>,
  );

  return (
    <div
      className={styles.dataRow}
      onContextMenu={onContextMenuMemo}
      {...tooltipProps}
    >
      {out}
    </div>
  );
};

const DataRowMemo = memo(DataRow);

// Row renderer for combined view
const CombinedRowRenderer = memo(
  ({
    index,
    style,
    data,
  }: ListChildComponentProps<{
    leftObj: diff.ObjectDiff | undefined;
    leftSymbol: display.SymbolDisplay | null;
    rightObj: diff.ObjectDiff | undefined;
    rightSymbol: display.SymbolDisplay | null;
  }>) => {
    const { leftObj, leftSymbol, rightObj, rightSymbol } = data;
    return (
      <div style={style} className={styles.combinedRow}>
        <div style={{ width: '50%' }}>
          <DataRowMemo
            obj={leftObj}
            symbol={leftSymbol}
            row={index}
            column={0}
          />
        </div>
        <div style={{ width: '50%' }}>
          <DataRowMemo
            obj={rightObj}
            symbol={rightSymbol}
            row={index}
            column={1}
          />
        </div>
      </div>
    );
  },
  areEqual,
);

export const DataList = ({
  height,
  width,
  diff,
  leftSymbol,
  rightSymbol,
}: {
  height: number;
  width: number;
  diff: diff.DiffResult;
  leftSymbol: display.SymbolDisplay | null;
  rightSymbol: display.SymbolDisplay | null;
}) => {
  const { currentUnit } = useExtensionStore(
    useShallow((state) => ({
      currentUnit: state.currentUnit,
    })),
  );
  const { setSymbolScrollOffset } = useAppStore(
    useShallow((state) => ({
      setSymbolScrollOffset: state.setSymbolScrollOffset,
    })),
  );
  const fontSize = useFontSize();

  const leftCount = leftSymbol?.rowCount ?? 0;
  const rightCount = rightSymbol?.rowCount ?? 0;
  const rowCount = Math.max(leftCount, rightCount);

  // Get symbol name for scroll persistence
  const symbolName = useMemo(() => {
    if (leftSymbol && diff.left) {
      return leftSymbol.info.name;
    }
    if (rightSymbol && diff.right) {
      return rightSymbol.info.name;
    }
    return '';
  }, [diff, leftSymbol, rightSymbol]);

  const itemData = useMemo(
    () => ({
      leftObj: diff.left,
      leftSymbol,
      rightObj: diff.right,
      rightSymbol,
    }),
    [diff, leftSymbol, rightSymbol],
  );

  const currentUnitName = currentUnit?.name || '';

  // Get initial scroll offset
  const initialScrollOffset = useMemo(
    () =>
      useAppStore.getState().getUnitState(currentUnitName).symbolScrollOffsets[
        symbolName
      ] || 0,
    [currentUnitName, symbolName],
  );

  // Handle scroll events to persist position
  const onScrollMemo = useCallback(
    (e: ListOnScrollProps) => {
      setSymbolScrollOffset(currentUnitName, symbolName, e.scrollOffset);
    },
    [currentUnitName, symbolName, setSymbolScrollOffset],
  );

  if ((!diff.left || !leftSymbol) && (!diff.right || !rightSymbol)) {
    return null;
  }

  return (
    <FixedSizeList
      height={height}
      width={width}
      itemCount={rowCount}
      itemSize={fontSize * 1.5}
      itemData={itemData}
      onScroll={onScrollMemo}
      initialScrollOffset={initialScrollOffset}
    >
      {CombinedRowRenderer}
    </FixedSizeList>
  );
};

export default DataList;
