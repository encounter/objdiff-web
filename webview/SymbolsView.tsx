import headerStyles from './Header.module.css';
import styles from './SymbolsView.module.css';

import clsx from 'clsx';
import memoizeOne from 'memoize-one';
import { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeList,
  type ListChildComponentProps,
  areEqual,
} from 'react-window';
import {
  type DiffResult,
  type Symbol as DiffSymbol,
  type ObjectDiff,
  type SectionDiff,
  type SymbolDiff,
  SymbolFlag,
} from '../shared/gen/diff_pb';
import { useAppStore, useExtensionStore, vscode } from './state';
import { percentClass, useFontSize } from './util';

const SectionRow = ({
  section,
  style,
}: { section: SectionDiff; style?: React.CSSProperties }) => {
  let percentElem = null;
  if (section.match_percent != null) {
    percentElem = (
      <>
        {' ('}
        <span className={percentClass(section.match_percent)}>
          {Math.floor(section.match_percent).toFixed(0)}%
        </span>
        {')'}
      </>
    );
  }
  return (
    <div className={clsx(styles.symbolListRow, styles.section)} style={style}>
      {section.name} ({section.size.toString(16)}){percentElem}
    </div>
  );
};

const SymbolRow = ({
  section,
  diff,
  style,
}: { section: SectionDiff; diff: SymbolDiff; style?: React.CSSProperties }) => {
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);
  const symbol = diff.symbol as DiffSymbol;
  const flags = [];
  if (symbol.flags & SymbolFlag.SYMBOL_GLOBAL) {
    flags.push(
      <span key="g" className={styles.flagGlobal}>
        g
      </span>,
    );
  }
  if (symbol.flags & SymbolFlag.SYMBOL_WEAK) {
    flags.push(
      <span key="w" className={styles.flagWeak}>
        w
      </span>,
    );
  }
  if (symbol.flags & SymbolFlag.SYMBOL_LOCAL) {
    flags.push(
      <span key="l" className={styles.flagLocal}>
        l
      </span>,
    );
  }
  if (symbol.flags & SymbolFlag.SYMBOL_COMMON) {
    flags.push(
      <span key="c" className={styles.flagCommon}>
        c
      </span>,
    );
  }
  let flagsElem = null;
  if (flags.length > 0) {
    flagsElem = <>[{flags}] </>;
  }
  let percentElem = null;
  if (diff.match_percent != null) {
    percentElem = (
      <>
        {'('}
        <span className={percentClass(diff.match_percent)}>
          {Math.floor(diff.match_percent).toFixed(0)}%
        </span>
        {') '}
      </>
    );
  }
  return (
    <div
      className={clsx(styles.symbolListRow, styles.symbol)}
      style={style}
      onClick={() => {
        setSelectedSymbol({
          symbol_name: symbol.name,
          section_name: section.name,
        });
      }}
      data-vscode-context={JSON.stringify({
        contextType: 'symbol',
        preventDefaultContextMenuItems: true,
        symbolName: symbol.name,
        symbolDemangledName: symbol.demangled_name,
      })}
    >
      {flagsElem}
      {percentElem}
      <span className={styles.symbolName}>
        {symbol.demangled_name || symbol.name}
      </span>
    </div>
  );
};

type ItemData = {
  itemCount: number;
  sections: SectionDiff[];
};

const SymbolListRow = memo(
  ({ index, style, data: { sections } }: ListChildComponentProps<ItemData>) => {
    let currentIndex = 0;
    for (const section of sections) {
      if (currentIndex === index) {
        return <SectionRow section={section} style={style} />;
      }
      currentIndex++;
      if (index < currentIndex + section.symbols.length) {
        return (
          <SymbolRow
            section={section}
            diff={section.symbols[index - currentIndex]}
            style={style}
          />
        );
      }
      currentIndex += section.symbols.length;
    }
    return null;
  },
  areEqual,
);

const createItemDataFn = (obj: ObjectDiff | undefined): ItemData => {
  if (!obj) {
    return { itemCount: 0, sections: [] };
  }
  let itemCount = 0;
  for (const section of obj.sections) {
    itemCount += section.symbols.length + 1;
  }
  return { itemCount, sections: obj.sections };
};
const createItemDataLeft = memoizeOne(createItemDataFn);
const createItemDataRight = memoizeOne(createItemDataFn);

const SymbolsView = ({ diff }: { diff: DiffResult }) => {
  const buildRunning = useExtensionStore((state) => state.buildRunning);
  const currentUnit = useExtensionStore((state) => state.currentUnit);

  const currentUnitName = currentUnit?.name || '';
  const setFileScrollOffset = useAppStore((state) => state.setFileScrollOffset);
  const { left: leftInitialScrollOffset, right: rightInitialScrollOffset } =
    useMemo(
      () =>
        (currentUnitName &&
          useAppStore.getState().fileScrollOffsets[currentUnitName]) || {
          left: 0,
          right: 0,
        },
      [currentUnitName],
    );

  const itemSize = useFontSize() * 1.33;
  const leftItemData = createItemDataLeft(diff.left);
  const rightItemData = createItemDataRight(diff.right);
  return (
    <>
      <div className={headerStyles.header}>
        <button
          onClick={() =>
            vscode.postMessage({ type: 'setCurrentUnit', unit: null })
          }
          disabled={buildRunning}
        >
          Back
        </button>
        <button
          onClick={() =>
            vscode.postMessage({ type: 'runTask', taskType: 'build' })
          }
          disabled={buildRunning}
        >
          Build
        </button>
        {buildRunning ? (
          <span>Building...</span>
        ) : (
          <span>{currentUnitName}</span>
        )}
      </div>
      <div className={styles.symbols}>
        <AutoSizer className={styles.symbols}>
          {({ height, width }) => (
            <>
              <FixedSizeList
                key={`left-${currentUnitName}`}
                className={styles.symbolList}
                height={height}
                itemCount={leftItemData.itemCount}
                itemSize={itemSize}
                width={width / 2}
                itemData={leftItemData}
                overscanCount={20}
                onScroll={(e) => {
                  if (currentUnitName) {
                    setFileScrollOffset(
                      currentUnitName,
                      'left',
                      e.scrollOffset,
                    );
                  }
                }}
                initialScrollOffset={leftInitialScrollOffset}
              >
                {SymbolListRow}
              </FixedSizeList>
              <FixedSizeList
                key={`right-${currentUnitName}`}
                className={styles.symbolList}
                height={height}
                itemCount={rightItemData.itemCount}
                itemSize={itemSize}
                width={width / 2}
                itemData={rightItemData}
                overscanCount={20}
                onScroll={(e) => {
                  if (currentUnitName) {
                    setFileScrollOffset(
                      currentUnitName,
                      'right',
                      e.scrollOffset,
                    );
                  }
                }}
                initialScrollOffset={rightInitialScrollOffset}
              >
                {SymbolListRow}
              </FixedSizeList>
            </>
          )}
        </AutoSizer>
      </div>
    </>
  );
};

export default SymbolsView;
