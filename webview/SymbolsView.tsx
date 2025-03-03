import headerStyles from './Header.module.css';
import styles from './SymbolsView.module.css';

import clsx from 'clsx';
import memoizeOne from 'memoize-one';
import { type diff, display } from 'objdiff-wasm';
import { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeList,
  type ListChildComponentProps,
  areEqual,
} from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import TooltipShared from './TooltipShared';
import {
  type UnitScrollOffsets,
  runBuild,
  setCurrentUnit,
  useAppStore,
  useExtensionStore,
} from './state';
import { percentClass, useFontSize } from './util';

const SectionRow = ({
  section,
  style,
  onClick,
}: {
  section: SectionData;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}) => {
  let percentElem = null;
  if (section.matchPercent != null) {
    percentElem = (
      <>
        {' ('}
        <span className={percentClass(section.matchPercent)}>
          {Math.floor(section.matchPercent).toFixed(0)}%
        </span>
        {')'}
      </>
    );
  }
  return (
    <div
      className={clsx(styles.symbolListRow, styles.section, {
        [styles.collapsed]: section.collapsed,
      })}
      style={style}
      onClick={onClick}
    >
      {section.name} ({section.size.toString(16)}){percentElem}
    </div>
  );
};

const SymbolRow = ({
  obj,
  section,
  symbolRef,
  side,
  style,
}: {
  obj: diff.ObjectDiff;
  section: SectionData;
  symbolRef: display.SectionDisplaySymbol;
  side: keyof UnitScrollOffsets;
  style?: React.CSSProperties;
}) => {
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);
  const symbol = display.displaySymbol(obj, symbolRef);
  const flags = [];
  if (symbol.flags.global) {
    flags.push(
      <span key="g" className={styles.flagGlobal}>
        g
      </span>,
    );
  }
  if (symbol.flags.weak) {
    flags.push(
      <span key="w" className={styles.flagWeak}>
        w
      </span>,
    );
  }
  if (symbol.flags.local) {
    flags.push(
      <span key="l" className={styles.flagLocal}>
        l
      </span>,
    );
  }
  if (symbol.flags.common) {
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
  if (symbol.matchPercent != null) {
    percentElem = (
      <>
        {'('}
        <span className={percentClass(symbol.matchPercent)}>
          {Math.floor(symbol.matchPercent).toFixed(0)}%
        </span>
        {') '}
      </>
    );
  }
  const tooltipContent: SymbolTooltipContent = {
    symbolRef,
    side,
  };
  return (
    <div
      className={clsx(styles.symbolListRow, styles.symbol)}
      style={style}
      onClick={() => {
        setSelectedSymbol(
          {
            symbolName: symbol.name,
            sectionName: section.name,
          },
          {
            symbolName: symbol.name,
            sectionName: section.name,
          },
        );
      }}
      data-vscode-context={JSON.stringify({
        contextType: 'symbol',
        preventDefaultContextMenuItems: true,
        symbolName: symbol.name,
        symbolDemangledName: symbol.demangledName,
      })}
      data-tooltip-id="symbol-tooltip"
      data-tooltip-content={JSON.stringify(tooltipContent)}
    >
      {flagsElem}
      {percentElem}
      <span className={styles.symbolName}>
        {symbol.demangledName || symbol.name}
      </span>
    </div>
  );
};

type SymbolTooltipContent = {
  symbolRef: display.SectionDisplaySymbol;
  side: keyof UnitScrollOffsets;
};

type SectionData = display.SectionDisplay & { collapsed: boolean };

type ItemData = {
  obj: diff.ObjectDiff | undefined;
  itemCount: number;
  sections: SectionData[];
  side: keyof UnitScrollOffsets;
  setSectionCollapsed: (section: string, collapsed: boolean) => void;
};

const SymbolListRow = memo(
  ({
    index,
    style,
    data: { obj, sections, side, setSectionCollapsed },
  }: ListChildComponentProps<ItemData>) => {
    if (!obj) {
      return null;
    }
    let currentIndex = 0;
    for (const section of sections) {
      if (currentIndex === index) {
        return (
          <SectionRow
            section={section}
            style={style}
            onClick={() => setSectionCollapsed(section.id, !section.collapsed)}
          />
        );
      }
      currentIndex++;
      if (section.collapsed) {
        continue;
      }
      if (index < currentIndex + section.symbols.length) {
        const symbolRef = section.symbols[index - currentIndex];
        return (
          <SymbolRow
            obj={obj}
            section={section}
            symbolRef={symbolRef}
            side={side}
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

const createItemDataFn = (
  obj: diff.ObjectDiff | undefined,
  collapsedSections: Record<string, boolean>,
  search: string | null,
  side: keyof UnitScrollOffsets,
  setSectionCollapsed: (section: string, collapsed: boolean) => void,
): ItemData => {
  if (!obj) {
    return {
      obj,
      itemCount: 0,
      sections: [],
      side,
      setSectionCollapsed,
    };
  }
  const displaySections = display.displaySections(
    obj,
    {
      mapping: undefined,
      regex: search ?? undefined,
    },
    {
      showHiddenSymbols: false,
      showMappedSymbols: false,
      reverseFnOrder: false,
    },
  );
  let itemCount = 0;
  const sections: SectionData[] = [];
  for (const section of displaySections) {
    itemCount++;
    if (search !== null && section.symbols.length === 0) {
      continue;
    }
    if (collapsedSections[section.id]) {
      sections.push({
        ...section,
        symbols: [],
        collapsed: true,
      });
      continue;
    }
    itemCount += section.symbols.length;
    sections.push({
      ...section,
      collapsed: false,
    });
  }
  return {
    obj,
    itemCount,
    sections,
    side,
    setSectionCollapsed,
  };
};
const createItemDataLeft = memoizeOne(createItemDataFn);
const createItemDataRight = memoizeOne(createItemDataFn);

const SymbolsView = ({ diff }: { diff: diff.DiffResult }) => {
  const { buildRunning, currentUnit } = useExtensionStore(
    useShallow((state) => ({
      buildRunning: state.buildRunning,
      currentUnit: state.currentUnit,
    })),
  );
  const currentUnitName = currentUnit?.name || '';
  const {
    collapsedSections,
    search,
    setUnitSectionCollapsed,
    setUnitScrollOffset,
    setUnitSearch,
  } = useAppStore(
    useShallow((state) => {
      const unit = state.getUnitState(currentUnitName);
      return {
        collapsedSections: unit.collapsedSections,
        search: unit.search,
        setUnitSectionCollapsed: state.setUnitSectionCollapsed,
        setUnitScrollOffset: state.setUnitScrollOffset,
        setUnitSearch: state.setUnitSearch,
      };
    }),
  );
  const initialScrollOffsets = useMemo(
    () => useAppStore.getState().getUnitState(currentUnitName).scrollOffsets,
    [currentUnitName],
  );
  const setLeftSectionCollapsed = useMemo(
    () => (section: string, collapsed: boolean) => {
      setUnitSectionCollapsed(currentUnitName, section, 'left', collapsed);
    },
    [currentUnitName, setUnitSectionCollapsed],
  );
  const setRightSectionCollapsed = useMemo(
    () => (section: string, collapsed: boolean) => {
      setUnitSectionCollapsed(currentUnitName, section, 'right', collapsed);
    },
    [currentUnitName, setUnitSectionCollapsed],
  );

  const renderList = (
    height: number,
    width: number,
    itemData: ItemData,
    side: keyof UnitScrollOffsets,
  ) => {
    if (!itemData.obj) {
      return (
        <div className={clsx(styles.symbolList, styles.noObject)}>
          No object configured
        </div>
      );
    }
    return (
      <FixedSizeList
        key={`${side}-${currentUnitName}`}
        className={styles.symbolList}
        height={height - 1}
        itemCount={itemData.itemCount}
        itemSize={itemSize}
        width={width / 2}
        itemData={itemData}
        overscanCount={20}
        onScroll={(e) => {
          if (currentUnitName) {
            setUnitScrollOffset(currentUnitName, side, e.scrollOffset);
          }
        }}
        initialScrollOffset={initialScrollOffsets[side]}
      >
        {SymbolListRow}
      </FixedSizeList>
    );
  };

  const itemSize = useFontSize() * 1.33;
  const leftItemData = createItemDataLeft(
    diff.left,
    collapsedSections.left,
    search,
    'left',
    setLeftSectionCollapsed,
  );
  const rightItemData = createItemDataRight(
    diff.right,
    collapsedSections.right,
    search,
    'right',
    setRightSectionCollapsed,
  );
  return (
    <>
      <div className={headerStyles.header}>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            <button
              title="Back"
              onClick={() => setCurrentUnit(null)}
              disabled={buildRunning}
            >
              <span className="codicon codicon-chevron-left" />
            </button>
            <span className={headerStyles.label}>Target object</span>
          </div>
          <div className={headerStyles.row}>
            <span className={clsx(headerStyles.label, headerStyles.emphasized)}>
              {currentUnitName}
            </span>
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
            <span className={headerStyles.label}>Base object</span>
          </div>
          <div className={headerStyles.row}>
            <input
              type="text"
              placeholder="Filter symbols"
              value={search || ''}
              onChange={(e) => {
                const value = e.target.value;
                setUnitSearch(currentUnitName, value);
              }}
            />
          </div>
        </div>
      </div>
      <div className={styles.symbols}>
        <AutoSizer className={styles.symbols}>
          {({ height, width }) => (
            <>
              {renderList(height, width, leftItemData, 'left')}
              {renderList(height, width, rightItemData, 'right')}
            </>
          )}
        </AutoSizer>
      </div>
      <TooltipShared
        id="symbol-tooltip"
        callback={(content) => {
          const data: SymbolTooltipContent = JSON.parse(content);
          let obj: diff.ObjectDiff | undefined;
          switch (data.side) {
            case 'left':
              obj = diff.left;
              break;
            case 'right':
              obj = diff.right;
              break;
            default:
              break;
          }
          if (!obj) {
            return null;
          }
          return display.symbolHover(obj, data.symbolRef);
        }}
      />
    </>
  );
};

export default SymbolsView;
