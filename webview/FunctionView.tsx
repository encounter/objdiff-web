import styles from './FunctionView.module.css';

import clsx from 'clsx';
import memoize from 'memoize-one';
import { memo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps } from 'react-window';
import { DiffKind } from '../gen/diff_pb';
import type {
  Symbol as DiffSymbol,
  FunctionDiff,
  InstructionDiff,
} from '../gen/diff_pb';
import { displayDiff } from './diff';
import { useFontSize } from './util';

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
  return <div className={styles.instructionCell}>{out}</div>;
};

type ItemData = {
  itemCount: number;
  left: FunctionDiff | null;
  right: FunctionDiff | null;
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
      <div key={index} className={styles.instructionRow} style={style}>
        <AsmCell insDiff={leftIns} symbol={left?.symbol} />
        <AsmCell insDiff={rightIns} symbol={right?.symbol} />
      </div>
    );
  },
  areEqual,
);

const createItemData = memoize(
  (left: FunctionDiff | null, right: FunctionDiff | null) => {
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
}: { left: FunctionDiff | null; right: FunctionDiff | null }) => {
  const itemSize = useFontSize() * 1.33;
  const itemData = createItemData(left, right);
  return (
    <AutoSizer>
      {({ height, width }) => (
        <FixedSizeList
          className={styles.instructionList}
          height={height}
          itemCount={itemData.itemCount}
          itemSize={itemSize}
          width={width}
          itemData={itemData}
          overscanCount={20}
        >
          {AsmRow}
        </FixedSizeList>
      )}
    </AutoSizer>
  );
};

export default FunctionView;
