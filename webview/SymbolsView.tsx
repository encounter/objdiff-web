import headerStyles from './Header.module.css';
import styles from './SymbolsView.module.css';

import clsx from 'clsx';
import 'core-js/features/regexp/escape';
import memoizeOne from 'memoize-one';
import { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeList,
  type ListChildComponentProps,
  areEqual,
} from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import {
  type DiffResult,
  type Symbol as DiffSymbol,
  type ObjectDiff,
  type SectionDiff,
  type SymbolDiff,
  SymbolFlag,
} from '../shared/gen/diff_pb';
import {
  UnitScrollOffsets,
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

type SectionData = SectionDiff & { id: string; collapsed: boolean };

type ItemData = {
  exists: boolean;
  itemCount: number;
  sections: SectionData[];
  setSectionCollapsed: (section: string, collapsed: boolean) => void;
};

const searchMatches = (
  searchRegex: RegExp | null,
  symbolDiff: SymbolDiff,
): boolean => {
  if (!searchRegex) {
    return true;
  }
  const symbol = symbolDiff.symbol as DiffSymbol;
  return (
    searchRegex.test(symbol.name) ||
    (symbol.demangled_name && searchRegex.test(symbol.demangled_name)) ||
    false
  );
};

const SymbolListRow = memo(
  ({
    index,
    style,
    data: { sections, setSectionCollapsed },
  }: ListChildComponentProps<ItemData>) => {
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
        const symbolDiff = section.symbols[index - currentIndex];
        return <SymbolRow section={section} diff={symbolDiff} style={style} />;
      }
      currentIndex += section.symbols.length;
    }
    return null;
  },
  areEqual,
);

const createItemDataFn = (
  obj: ObjectDiff | undefined,
  collapsedSections: Record<string, boolean>,
  search: string | null,
  setSectionCollapsed: (section: string, collapsed: boolean) => void,
): ItemData => {
  if (!obj) {
    return {
      exists: false,
      itemCount: 0,
      sections: [],
      setSectionCollapsed,
    };
  }
  let itemCount = 0;
  const sections: SectionData[] = [];
  const sectionCounts = new Map<string, number>();
  let searchRegex: RegExp | null = null;
  if (search) {
    try {
      searchRegex = new RegExp(search, 'i');
    } catch (e) {
      // Invalid regex, use it as a plain text search
      searchRegex = new RegExp(RegExp.escape(search), 'i');
    }
  }
  for (const section of obj.sections) {
    itemCount++;
    const count = sectionCounts.get(section.name) || 0;
    sectionCounts.set(section.name, count + 1);
    const id = `${section.name}-${count}`;
    const symbols = section.symbols.filter((s) =>
      searchMatches(searchRegex, s),
    );
    if (searchRegex !== null && symbols.length === 0) {
      continue;
    }
    if (collapsedSections[id]) {
      sections.push({
        ...section,
        symbols: [],
        id,
        collapsed: true,
      });
      continue;
    }
    itemCount += symbols.length;
    sections.push({
      ...section,
      symbols,
      id,
      collapsed: false,
    });
  }
  return {
    exists: true,
    itemCount,
    sections,
    setSectionCollapsed,
  };
};
const createItemDataLeft = memoizeOne(createItemDataFn);
const createItemDataRight = memoizeOne(createItemDataFn);

const SymbolsView = ({ diff }: { diff: DiffResult }) => {
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
    if (!itemData.exists) {
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
        height={height}
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
    setLeftSectionCollapsed,
  );
  const rightItemData = createItemDataRight(
    diff.right,
    collapsedSections.right,
    search,
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
    </>
  );
};

export default SymbolsView;
