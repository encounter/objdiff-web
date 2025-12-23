import styles from './FunctionView.module.css';

import clsx from 'clsx';
import { type diff, display } from 'objdiff-wasm';
import { memo, useCallback, useMemo, useRef } from 'react';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps, ListOnScrollProps } from 'react-window';
import { useShallow } from 'zustand/react/shallow';
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
  const out: React.ReactNode[] = [];

  const insRow = display.displayInstructionRow(obj, symbol, row, config);
  let index = 0;
  for (const segment of insRow.segments) {
    let className: string | undefined;
    switch (segment.color.tag) {
      case 'normal':
        break;
      case 'dim':
        className = styles.segmentDim;
        break;
      case 'bright':
        className = styles.segmentBright;
        break;
      case 'replace':
        className = styles.segmentReplace;
        break;
      case 'delete':
        className = styles.segmentDelete;
        break;
      case 'insert':
        className = styles.segmentInsert;
        break;
      case 'rotating':
        className =
          ROTATION_CLASSES[segment.color.val % ROTATION_CLASSES.length];
        break;
      default:
        console.warn('Unknown color type', segment.color);
        break;
    }
    const t = segment.text;
    let text = '';
    let postText = ''; // unhighlightable text after the token
    let isToken = false;
    switch (t.tag) {
      case 'basic':
        text = t.val;
        break;
      case 'line':
        text = t.val.toString(10);
        break;
      case 'address':
        text = t.val.toString(16);
        postText = ':';
        isToken = true;
        break;
      case 'opcode':
        text = t.val.mnemonic;
        isToken = true;
        break;
      case 'signed':
        if (t.val < 0) {
          text = `-0x${(-t.val).toString(16)}`;
        } else {
          text = `0x${t.val.toString(16)}`;
        }
        isToken = true;
        break;
      case 'unsigned':
        text = `0x${t.val.toString(16)}`;
        isToken = true;
        break;
      case 'opaque':
        text = t.val;
        isToken = true;
        break;
      case 'branch-dest':
        text = t.val.toString(16);
        isToken = true;
        break;
      case 'branch-arrow':
        text = ' ~> ';
        isToken = true;
        break;
      case 'symbol':
        text = t.val.demangledName || t.val.name;
        isToken = true;
        break;
      case 'addend':
        if (t.val < 0) {
          text = `-0x${(-t.val).toString(16)}`;
        } else {
          text = `+0x${t.val.toString(16)}`;
        }
        break;
      case 'spacing':
        text = ' '.repeat(t.val);
        break;
      case 'eol':
        continue;
      default:
        console.warn('Unknown text type', t);
        break;
    }
    out.push(
      <span
        key={index}
        className={clsx(className, {
          [styles.highlightable]: isToken,
          [styles.highlighted]: highlightMatches(highlight, t),
        })}
        onClick={(e) => {
          if (t.tag === 'branch-arrow') {
            listRef.current?.scrollToItem(t.val, 'center');
          } else if (isToken) {
            setHighlight(updateHighlight(highlightState, t, column));
            e.stopPropagation();
          }
        }}
      >
        {text}
      </span>,
    );
    index++;
    if (postText) {
      out.push(
        <span key={index} className={className}>
          {postText}
        </span>,
      );
      index++;
    }
    if (segment.padTo > text.length + postText.length) {
      const spacing = ' '.repeat(segment.padTo - text.length - postText.length);
      out.push(<span key={index}>{spacing}</span>);
      index++;
    }
  }

  const classes = [styles.instructionCell];
  if (insRow.diffKind !== 'none') {
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
    };
  }, [
    diff,
    leftSymbol,
    rightSymbol,
    configProperties,
    highlight,
    setHighlight,
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
  );
};
