import styles from './FunctionView.module.css';
import headerStyles from './Header.module.css';

import clsx from 'clsx';
import memoizeOne from 'memoize-one';
import { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps } from 'react-window';
import { DiffKind } from '../shared/gen/diff_pb';
import type {
  Symbol as DiffSymbol,
  InstructionDiff,
  SymbolDiff,
} from '../shared/gen/diff_pb';
import { displayDiff } from './diff';
import { useAppStore, useExtensionStore, vscode } from './state';
import { percentClass, useFontSize } from './util';

const AsmCell = ({
  insDiff,
  symbol,
}: {
  insDiff: InstructionDiff | undefined;
  symbol: DiffSymbol | undefined;
}) => {
  if (!insDiff || !symbol) {
    return <div className={styles.instructionCell} />;
  }

  const out: React.ReactNode[] = [];
  let index = 0;
  displayDiff(insDiff, symbol.address, (t) => {
    let className: string | undefined;
    if (t.diff_index != null) {
      className = styles[`rotation${t.diff_index % 9}`];
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
        className = styles[`rotation${t.index % 9}`];
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
          // [styles.highlighted]: highlighter?.value === text,
        })}
        onClick={(e) => {
          if (isToken) {
            // highlighter?.select(text);
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
};

const AsmRow = memo(
  ({
    index,
    style,
    data: { left, right },
  }: ListChildComponentProps<ItemData>) => {
    const leftIns = left?.instructions[index];
    const rightIns = right?.instructions[index];
    return (
      <div className={styles.instructionRow} style={style}>
        <AsmCell insDiff={leftIns} symbol={left?.symbol} />
        <AsmCell insDiff={rightIns} symbol={right?.symbol} />
      </div>
    );
  },
  areEqual,
);

const createItemData = memoizeOne(
  (left: SymbolDiff | null, right: SymbolDiff | null): ItemData => {
    const itemCount = Math.max(
      left?.instructions.length || 0,
      right?.instructions.length || 0,
    );
    return { itemCount, left, right };
  },
);

const FunctionView = ({
  left,
  right,
}: { left: SymbolDiff | null; right: SymbolDiff | null }) => {
  const buildRunning = useExtensionStore((state) => state.buildRunning);
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);
  const setSymbolScrollOffset = useAppStore(
    (state) => state.setSymbolScrollOffset,
  );

  const symbolName = left?.symbol?.name || right?.symbol?.name || '';
  const initialScrollOffset = useMemo(
    () => useAppStore.getState().symbolScrollOffsets[symbolName] || 0,
    [symbolName],
  );

  const itemSize = useFontSize() * 1.33;
  const itemData = createItemData(left, right);
  const demangledName =
    left?.symbol?.demangled_name || right?.symbol?.demangled_name || symbolName;
  const matchPercent = right?.match_percent || 0;
  return (
    <>
      <div className={headerStyles.header}>
        <button onClick={() => setSelectedSymbol(null)}>Back</button>
        <button
          onClick={() =>
            vscode.postMessage({ type: 'runTask', taskType: 'build' })
          }
          disabled={buildRunning}
        >
          Build
        </button>
        <span className={percentClass(matchPercent)}>
          {Math.floor(matchPercent).toFixed(0)}%
        </span>
        <span title={demangledName}>{demangledName}</span>
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
                setSymbolScrollOffset(symbolName, e.scrollOffset);
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
