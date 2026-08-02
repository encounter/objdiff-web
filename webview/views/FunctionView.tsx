import styles from './FunctionView.module.css';

import clsx from 'clsx';
import { type diff, display } from 'objdiff-wasm';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps, ListOnScrollProps } from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import {
  type AsmSpan,
  instructionRowToSpans,
  isDiffRow,
} from '../../shared/render/asm';
import { createContextMenu } from '../common/ContextMenu';
import { createTooltip } from '../common/TooltipShared';
import { buildDiffConfig, useAppStore, useExtensionStore } from '../state';
import {
  type HighlightState,
  highlightColumn,
  highlightMatches,
  updateHighlight,
} from '../util/highlight';
import { useFontSize } from '../util/util';

const ROTATION_CLASSES = [
  styles.rotation0,
  styles.rotation1,
  styles.rotation2,
  styles.rotation3,
  styles.rotation4,
  styles.rotation5,
  styles.rotation6,
  styles.rotation7,
  styles.rotation8,
];

const COLOR_CLASSES: Record<AsmSpan['color'], string | undefined> = {
  normal: undefined,
  dim: styles.segmentDim,
  bright: styles.segmentBright,
  replace: styles.segmentReplace,
  'data-flow': styles.segmentDataFlow,
  delete: styles.segmentDelete,
  insert: styles.segmentInsert,
  rotating: undefined,
};

const colorClass = (span: AsmSpan): string | undefined =>
  span.color === 'rotating'
    ? ROTATION_CLASSES[span.rotation ?? 0]
    : COLOR_CLASSES[span.color];

export type InstructionTooltipContent = {
  column: number;
  row: number;
};

export const {
  Tooltip: InstructionTooltip,
  useTooltip: useInstructionTooltip,
} = createTooltip<InstructionTooltipContent>();

export const {
  ContextMenuProvider: InstructionContextMenuProvider,
  useContextMenu: useInstructionContextMenu,
} = createContextMenu<InstructionTooltipContent>();

const AsmCell = ({
  obj,
  config,
  symbol,
  row,
  column,
  highlight: highlightState,
  setHighlight,
  listRef,
}: {
  obj: diff.ObjectDiff | undefined;
  config: diff.DiffConfig;
  symbol: display.SymbolRef | null;
  row: number;
  column: number;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
  listRef: React.RefObject<FixedSizeList<ItemData>>;
}) => {
  const onContextMenu = useInstructionContextMenu();
  const tooltipContent: InstructionTooltipContent = useMemo(
    () => ({
      column,
      row,
    }),
    [column, row],
  );
  const tooltipProps = useInstructionTooltip(tooltipContent);
  const onContextMenuMemo = useCallback(
    (e: React.MouseEvent<HTMLElement>) => onContextMenu(e, tooltipContent),
    [onContextMenu, tooltipContent],
  );

  if (!obj || !symbol) {
    return null;
  }

  const highlight = highlightColumn(highlightState, column);

  const insRow = display.displayInstructionRow(obj, symbol, row, config);
  const out = instructionRowToSpans(insRow).map((span, index) => {
    const t = span.token;
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional
        key={index}
        className={clsx(colorClass(span), {
          [styles.highlightable]: t != null,
          [styles.highlighted]: t != null && highlightMatches(highlight, t),
        })}
        onClick={(e) => {
          if (t == null) {
            return;
          }
          if (t.tag === 'branch-arrow') {
            listRef.current?.scrollToItem(t.val, 'center');
          } else {
            setHighlight(updateHighlight(highlightState, t, column));
            e.stopPropagation();
          }
        }}
      >
        {span.text}
      </span>
    );
  });

  const classes = [styles.instructionCell];
  if (isDiffRow(insRow.diffKind)) {
    classes.push(styles.diffAny);
  }
  if (!out.length) {
    return <div className={clsx(classes)} />;
  }

  return (
    <div
      className={clsx(classes)}
      onContextMenu={onContextMenuMemo}
      {...tooltipProps}
    >
      {out}
    </div>
  );
};

type ItemData = {
  itemCount: number;
  symbolName: string;
  result: diff.DiffResult;
  config: diff.DiffConfig;
  matchPercent?: number;
  leftSymbol: display.SymbolDisplay | null;
  rightSymbol: display.SymbolDisplay | null;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
  listRef: React.RefObject<FixedSizeList<ItemData>>;
  splitRatio: number;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  onColMouseDown: (side: 'left' | 'right') => void;
};

const AsmRow = memo(
  ({
    index,
    style,
    data: {
      result,
      config,
      leftSymbol,
      rightSymbol,
      highlight,
      setHighlight,
      listRef,
      splitRatio,
      onDividerMouseDown,
      onColMouseDown,
    },
  }: ListChildComponentProps<ItemData>) => {
    return (
      <div
        className={styles.instructionRow}
        style={style}
        onClick={() => {
          // Clear highlight on background click
          setHighlight({ left: null, right: null });
        }}
        onMouseDown={(e) => {
          // Prevent double click text selection
          if (e.detail > 1) {
            e.preventDefault();
          }
        }}
      >
        <div
          className={styles.colLeft}
          style={{ flex: `0 0 ${splitRatio * 100}%` }}
          onMouseDown={() => onColMouseDown('left')}
        >
          <AsmCell
            obj={result.left}
            config={config}
            symbol={leftSymbol?.info.id ?? null}
            row={index}
            column={0}
            highlight={highlight}
            setHighlight={setHighlight}
            listRef={listRef}
          />
        </div>
        <div className={styles.divider} onMouseDown={onDividerMouseDown} />
        <div
          className={styles.colRight}
          style={{ flex: '1 1 0' }}
          onMouseDown={() => onColMouseDown('right')}
        >
          <AsmCell
            obj={result.right}
            config={config}
            symbol={rightSymbol?.info.id ?? null}
            row={index}
            column={1}
            highlight={highlight}
            setHighlight={setHighlight}
            listRef={listRef}
          />
        </div>
      </div>
    );
  },
  areEqual,
);

export const InstructionList = ({
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
  const listRef = useRef<FixedSizeList<ItemData>>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;

  const cleanupSelectingRef = useRef<(() => void) | null>(null);

  const onColMouseDown = useCallback((side: 'left' | 'right') => {
    const container = containerRef.current;
    if (!container) return;
    // Remove any previous cleanup listener before setting new one
    cleanupSelectingRef.current?.();
    container.dataset.selecting = side;
    const onNextMouseDown = () => {
      delete container.dataset.selecting;
      document.removeEventListener('mousedown', onNextMouseDown, true);
      cleanupSelectingRef.current = null;
    };
    cleanupSelectingRef.current = () => {
      document.removeEventListener('mousedown', onNextMouseDown, true);
    };
    // Use capture so we clean up before the new column's onMouseDown runs
    document.addEventListener('mousedown', onNextMouseDown, true);
  }, []);

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startRatio = splitRatioRef.current;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMouseMove = (ev: MouseEvent) => {
        const newRatio = Math.max(
          0.15,
          Math.min(0.85, startRatio + (ev.clientX - startX) / width),
        );
        setSplitRatio(newRatio);
      };
      const onMouseUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width],
  );

  const { configProperties, currentUnit } = useExtensionStore(
    useShallow((state) => ({
      configProperties: state.configProperties,
      currentUnit: state.currentUnit,
    })),
  );
  const { highlight, setSymbolScrollOffset, setHighlight } = useAppStore(
    useShallow((state) => ({
      highlight: state.highlight,
      setSymbolScrollOffset: state.setSymbolScrollOffset,
      setHighlight: state.setHighlight,
    })),
  );
  const itemData = useMemo(() => {
    const itemCount = Math.max(
      leftSymbol?.rowCount || 0,
      rightSymbol?.rowCount || 0,
    );
    const symbolName = leftSymbol?.info.name || rightSymbol?.info.name || '';
    const config = buildDiffConfig(configProperties);
    const matchPercent = leftSymbol?.matchPercent;
    return {
      itemCount,
      symbolName,
      result: diff,
      config,
      matchPercent,
      leftSymbol,
      rightSymbol,
      highlight,
      setHighlight,
      listRef,
      splitRatio,
      onDividerMouseDown,
      onColMouseDown,
    };
  }, [
    diff,
    leftSymbol,
    rightSymbol,
    configProperties,
    highlight,
    setHighlight,
    splitRatio,
    onDividerMouseDown,
    onColMouseDown,
  ]);
  const currentUnitName = currentUnit?.name || '';
  const initialScrollOffset = useMemo(
    () =>
      useAppStore.getState().getUnitState(currentUnitName).symbolScrollOffsets[
        itemData.symbolName
      ] || 0,
    [currentUnitName, itemData.symbolName],
  );
  const itemSize = useFontSize() * 1.33;
  const onScrollMemo = useCallback(
    (e: ListOnScrollProps) => {
      setSymbolScrollOffset(
        currentUnitName,
        itemData.symbolName,
        e.scrollOffset,
      );
    },
    [currentUnitName, itemData.symbolName, setSymbolScrollOffset],
  );
  return (
    <div ref={containerRef} className={styles.instructionList}>
      <FixedSizeList
        ref={listRef}
        height={height}
        itemCount={itemData.itemCount}
        itemSize={itemSize}
        width={width}
        itemData={itemData}
        overscanCount={20}
        onScroll={onScrollMemo}
        initialScrollOffset={initialScrollOffset}
      >
        {AsmRow}
      </FixedSizeList>
    </div>
  );
};
