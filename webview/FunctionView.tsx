import styles from './FunctionView.module.css';
import headerStyles from './Header.module.css';

import clsx from 'clsx';
import memoizeOne from 'memoize-one';
import { type diff, display } from 'objdiff-wasm';
import { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps } from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import TooltipShared from './TooltipShared';
import {
  type HighlightState,
  highlightColumn,
  highlightMatches,
  updateHighlight,
} from './highlight';
import {
  buildDiffConfig,
  runBuild,
  useAppStore,
  useExtensionStore,
} from './state';
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
  obj,
  config,
  symbol,
  row,
  column,
  highlight: highlightState,
  setHighlight,
}: {
  obj: diff.ObjectDiff | undefined;
  config: diff.DiffConfig;
  symbol: display.SectionDisplaySymbol | null;
  row: number;
  column: number;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
}) => {
  if (!obj || !symbol) {
    return <div className={styles.instructionCell} />;
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

  const tooltipContent: InstructionTooltipContent = { column, row };
  return (
    <div
      className={clsx(classes)}
      data-tooltip-id="instruction-tooltip"
      data-tooltip-content={JSON.stringify(tooltipContent)}
    >
      {out}
    </div>
  );
};

type InstructionTooltipContent = {
  column: number;
  row: number;
};

type ItemData = {
  itemCount: number;
  symbolName: string;
  result: diff.DiffResult;
  config: diff.DiffConfig;
  matchPercent?: number;
  left: display.SectionDisplaySymbol | null;
  leftSymbol: display.SymbolDisplay | null;
  right: display.SectionDisplaySymbol | null;
  rightSymbol: display.SymbolDisplay | null;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
};

const AsmRow = memo(
  ({
    index,
    style,
    data: { result, config, left, right, highlight, setHighlight },
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
          symbol={left}
          row={index}
          column={0}
          highlight={highlight}
          setHighlight={setHighlight}
        />
        <AsmCell
          obj={result.right}
          config={config}
          symbol={right}
          row={index}
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
    result: diff.DiffResult,
    left: display.SectionDisplaySymbol | null,
    right: display.SectionDisplaySymbol | null,
    highlight: HighlightState,
    setHighlight: (highlight: HighlightState) => void,
  ): ItemData => {
    const leftSymbol = left ? display.displaySymbol(result.left!, left) : null;
    const rightSymbol = right
      ? display.displaySymbol(result.right!, right)
      : null;
    const itemCount = Math.max(
      leftSymbol?.rowCount || 0,
      rightSymbol?.rowCount || 0,
    );
    const symbolName = leftSymbol?.name || rightSymbol?.name || '';
    const config = buildDiffConfig(null);
    return {
      itemCount,
      symbolName,
      result,
      config,
      left,
      leftSymbol,
      right,
      rightSymbol,
      highlight,
      setHighlight,
    };
  },
);

const SymbolLabel = ({
  symbol,
}: {
  symbol: display.SymbolDisplay | null;
}) => {
  if (!symbol) {
    return (
      <span className={clsx(headerStyles.label, headerStyles.missing)}>
        Missing
      </span>
    );
  }
  const displayName = symbol.demangledName || symbol.name;
  return (
    <span
      className={clsx(headerStyles.label, headerStyles.emphasized)}
      title={displayName}
    >
      {displayName}
    </span>
  );
};

const FunctionView = ({
  diff,
  left,
  right,
}: {
  diff: diff.DiffResult;
  left: display.SectionDisplaySymbol | null;
  right: display.SectionDisplaySymbol | null;
}) => {
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

  const itemData = createItemData(diff, left, right, highlight, setHighlight);
  const initialScrollOffset = useMemo(
    () =>
      useAppStore.getState().getUnitState(currentUnitName).symbolScrollOffsets[
        itemData.symbolName
      ] || 0,
    [currentUnitName, itemData.symbolName],
  );

  const itemSize = useFontSize() * 1.33;
  return (
    <>
      <div className={headerStyles.header}>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            <button title="Back" onClick={() => setSelectedSymbol(null, null)}>
              <span className="codicon codicon-chevron-left" />
            </button>
          </div>
          <div className={headerStyles.row}>
            <SymbolLabel symbol={itemData.leftSymbol} />
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
            {itemData.matchPercent !== undefined && (
              <>
                <span
                  className={clsx(
                    headerStyles.label,
                    percentClass(itemData.matchPercent),
                  )}
                >
                  {Math.floor(itemData.matchPercent).toFixed(0)}%
                </span>
                {' | '}
              </>
            )}
            <SymbolLabel symbol={itemData.rightSymbol} />
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
                  itemData.symbolName,
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
      <TooltipShared
        id="instruction-tooltip"
        callback={(content) => {
          const data: InstructionTooltipContent = JSON.parse(content);
          let obj: diff.ObjectDiff | undefined;
          let symbol: display.SectionDisplaySymbol | undefined;
          switch (data.column) {
            case 0:
              obj = diff.left;
              symbol = itemData.left ?? undefined;
              break;
            case 1:
              obj = diff.right;
              symbol = itemData.right ?? undefined;
              break;
            default:
              break;
          }
          if (!obj || !symbol) {
            return null;
          }
          return display.instructionHover(
            obj,
            symbol,
            data.row,
            itemData.config,
          );
        }}
      />
    </>
  );
};

export default FunctionView;
