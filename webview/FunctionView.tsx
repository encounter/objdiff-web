import styles from './FunctionView.module.css';
import headerStyles from './Header.module.css';

import clsx from 'clsx';
import memoizeOne from 'memoize-one';
import { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps } from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import { DiffKind } from '../shared/gen/diff_pb';
import type {
  Symbol as DiffSymbol,
  InstructionDiff,
  SymbolDiff,
} from '../shared/gen/diff_pb';
import { displayDiff } from './diff';
import {
  type HighlightState,
  highlightColumn,
  highlightMatches,
  updateHighlight,
} from './highlight';
import { runBuild, useAppStore, useExtensionStore } from './state';
import { percentClass, useFontSize } from './util';

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

const AsmCell = ({
  insDiff,
  symbol,
  column,
  highlight: highlightState,
  setHighlight,
}: {
  insDiff: InstructionDiff | undefined;
  symbol: DiffSymbol | undefined;
  column: number;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
}) => {
  if (!insDiff || !symbol) {
    return <div className={styles.instructionCell} />;
  }

  const highlight = highlightColumn(highlightState, column);
  const out: React.ReactNode[] = [];
  let index = 0;
  displayDiff(insDiff, symbol.address, (t) => {
    let className: string | undefined;
    if (t.diff_index != null) {
      className = ROTATION_CLASSES[t.diff_index % ROTATION_CLASSES.length];
    }
    let text = '';
    let postText = ''; // unhighlightable text after the token
    let padTo = 0;
    let isToken = false;
    switch (t.type) {
      case 'basic':
        text = t.text;
        break;
      case 'basic_color':
        text = t.text;
        className = ROTATION_CLASSES[t.index % ROTATION_CLASSES.length];
        break;
      case 'line':
        text = (t.line_number || 0).toString(10);
        className = styles.lineNumber;
        padTo = 5;
        break;
      case 'address':
        text = (t.address || 0).toString(16);
        postText = ':';
        padTo = 5;
        isToken = true;
        break;
      case 'opcode':
        text = t.mnemonic;
        padTo = 8;
        isToken = true;
        if (insDiff.diff_kind === DiffKind.DIFF_OP_MISMATCH) {
          className = styles.diff_change;
        }
        break;
      case 'argument': {
        const value = t.value.value;
        switch (value.oneofKind) {
          case 'signed':
            if (value.signed < 0) {
              text = `-0x${(-value.signed).toString(16)}`;
            } else {
              text = `0x${value.signed.toString(16)}`;
            }
            break;
          case 'unsigned':
            text = `0x${value.unsigned.toString(16)}`;
            break;
          case 'opaque':
            text = value.opaque;
            break;
        }
        isToken = true;
        break;
      }
      case 'branch_dest':
        text = (t.address || 0).toString(16);
        isToken = true;
        break;
      case 'symbol': {
        const symbol = t.target.symbol as DiffSymbol;
        text = symbol.demangled_name || symbol.name;
        if (t.diff_index == null) {
          className = styles.symbol;
        }
        isToken = true;
        break;
      }
      case 'spacing':
        text = ' '.repeat(t.count);
        break;
      default:
        console.warn('Unknown text type', t);
        return null;
    }
    out.push(
      <span
        key={index}
        className={clsx(className, {
          [styles.highlightable]: isToken,
          [styles.highlighted]: highlightMatches(highlight, t),
        })}
        onClick={(e) => {
          if (isToken) {
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
      out.push(<span key={index}>{postText}</span>);
      index++;
    }
    if (padTo > text.length + postText.length) {
      const spacing = ' '.repeat(padTo - text.length - postText.length);
      out.push(<span key={index}>{spacing}</span>);
      index++;
    }
  });

  const classes = [styles.instructionCell];
  if (insDiff.diff_kind) {
    classes.push(styles.diff_any);
  }
  switch (insDiff.diff_kind) {
    case DiffKind.DIFF_DELETE:
      classes.push(styles.diff_remove);
      break;
    case DiffKind.DIFF_INSERT:
      classes.push(styles.diff_add);
      break;
    case DiffKind.DIFF_REPLACE:
      classes.push(styles.diff_change);
      break;
  }

  return <div className={clsx(classes)}>{out}</div>;
};

type ItemData = {
  itemCount: number;
  left: SymbolDiff | null;
  right: SymbolDiff | null;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
};

const AsmRow = memo(
  ({
    index,
    style,
    data: { left, right, highlight, setHighlight },
  }: ListChildComponentProps<ItemData>) => {
    const leftIns = left?.instructions[index];
    const rightIns = right?.instructions[index];
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
          insDiff={leftIns}
          symbol={left?.symbol}
          column={0}
          highlight={highlight}
          setHighlight={setHighlight}
        />
        <AsmCell
          insDiff={rightIns}
          symbol={right?.symbol}
          column={1}
          highlight={highlight}
          setHighlight={setHighlight}
        />
      </div>
    );
  },
  areEqual,
);

const createItemData = memoizeOne(
  (
    left: SymbolDiff | null,
    right: SymbolDiff | null,
    highlight: HighlightState,
    setHighlight: (highlight: HighlightState) => void,
  ): ItemData => {
    const itemCount = Math.max(
      left?.instructions.length || 0,
      right?.instructions.length || 0,
    );
    return { itemCount, left, right, highlight, setHighlight };
  },
);

const SymbolLabel = ({
  symbol,
}: {
  symbol: SymbolDiff | null;
}) => {
  if (!symbol) {
    return (
      <span className={clsx(headerStyles.label, headerStyles.missing)}>
        Missing
      </span>
    );
  }
  const demangledName = symbol.symbol?.demangled_name || symbol.symbol?.name;
  return (
    <span
      className={clsx(headerStyles.label, headerStyles.emphasized)}
      title={demangledName}
    >
      {demangledName}
    </span>
  );
};

const FunctionView = ({
  left,
  right,
}: { left: SymbolDiff | null; right: SymbolDiff | null }) => {
  const { buildRunning, currentUnit, lastBuilt } = useExtensionStore(
    useShallow((state) => ({
      buildRunning: state.buildRunning,
      currentUnit: state.currentUnit,
      lastBuilt: state.lastBuilt,
    })),
  );
  const currentUnitName = currentUnit?.name || '';
  const { highlight, setSelectedSymbol, setSymbolScrollOffset, setHighlight } =
    useAppStore(
      useShallow((state) => ({
        highlight: state.highlight,
        setSelectedSymbol: state.setSelectedSymbol,
        setSymbolScrollOffset: state.setSymbolScrollOffset,
        setHighlight: state.setHighlight,
      })),
    );

  const symbolName = left?.symbol?.name || right?.symbol?.name || '';
  const initialScrollOffset = useMemo(
    () =>
      useAppStore.getState().getUnitState(currentUnitName).symbolScrollOffsets[
        symbolName
      ] || 0,
    [currentUnitName, symbolName],
  );

  const itemSize = useFontSize() * 1.33;
  const itemData = createItemData(left, right, highlight, setHighlight);
  const matchPercent = right?.match_percent;
  return (
    <>
      <div className={headerStyles.header}>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            <button title="Back" onClick={() => setSelectedSymbol(null)}>
              <span className="codicon codicon-chevron-left" />
            </button>
          </div>
          <div className={headerStyles.row}>
            <SymbolLabel symbol={left} />
          </div>
        </div>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            <button
              title="Build"
              onClick={() => runBuild()}
              disabled={buildRunning}
            >
              <span className="codicon codicon-refresh" />
            </button>
            {lastBuilt && (
              <span className={headerStyles.label}>
                Last built: {new Date(lastBuilt).toLocaleTimeString('en-US')}
              </span>
            )}
          </div>
          <div className={headerStyles.row}>
            {matchPercent !== undefined && (
              <>
                <span
                  className={clsx(
                    headerStyles.label,
                    percentClass(matchPercent),
                  )}
                >
                  {Math.floor(matchPercent).toFixed(0)}%
                </span>
                {' | '}
              </>
            )}
            <SymbolLabel symbol={right} />
          </div>
        </div>
      </div>
      <div className={styles.instructionList}>
        <AutoSizer>
          {({ height, width }) => (
            <FixedSizeList
              height={height}
              itemCount={itemData.itemCount}
              itemSize={itemSize}
              width={width}
              itemData={itemData}
              overscanCount={20}
              onScroll={(e) => {
                setSymbolScrollOffset(
                  currentUnitName,
                  symbolName,
                  e.scrollOffset,
                );
              }}
              initialScrollOffset={initialScrollOffset}
            >
              {AsmRow}
            </FixedSizeList>
          )}
        </AutoSizer>
      </div>
    </>
  );
};

export default FunctionView;
