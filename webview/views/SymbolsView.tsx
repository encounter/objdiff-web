import headerStyles from '../common/Header.module.css';
import styles from './SymbolsView.module.css';

import clsx from 'clsx';
import memoizeOne from 'memoize-one';
import { type diff, display } from 'objdiff-wasm';
import { memo, useCallback, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeList,
  type ListChildComponentProps,
  areEqual,
} from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import type { BuildStatus } from '../../shared/messages';
import { createContextMenu, renderContextItems } from '../common/ContextMenu';
import TooltipShared from '../common/TooltipShared';
import {
  type UnitScrollOffsets,
  runBuild,
  setCurrentUnit,
  useAppStore,
  useExtensionStore,
} from '../state';
import { percentClass, useFontSize } from '../util/util';

type Side = keyof UnitScrollOffsets;

type SymbolTooltipContent = {
  symbolRef: display.SectionDisplaySymbol;
  side: Side;
};

const { ContextMenuProvider, useContextMenu } =
  createContextMenu<SymbolTooltipContent>();

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
  side: Side;
  style?: React.CSSProperties;
}) => {
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);
  const onContextMenu = useContextMenu();
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
      data-tooltip-id="symbol-tooltip"
      data-tooltip-content={JSON.stringify(tooltipContent)}
      onContextMenu={(e) => {
        onContextMenu(e, tooltipContent);
      }}
    >
      {flagsElem}
      {percentElem}
      <span className={styles.symbolName}>
        {symbol.demangledName || symbol.name}
      </span>
    </div>
  );
};

type SectionData = display.SectionDisplay & { collapsed: boolean };

type ItemData = {
  status: BuildStatus | null;
  obj: diff.ObjectDiff | undefined;
  itemCount: number;
  sections: SectionData[];
  side: Side;
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
  status: BuildStatus | null,
  obj: diff.ObjectDiff | undefined,
  collapsedSections: Record<string, boolean>,
  search: string | null,
  side: Side,
  setSectionCollapsed: (section: string, collapsed: boolean) => void,
): ItemData => {
  if (!obj) {
    return {
      status,
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
    status,
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
  const {
    buildRunning,
    currentUnit,
    hasProjectConfig,
    leftStatus,
    rightStatus,
  } = useExtensionStore(
    useShallow((state) => ({
      buildRunning: state.buildRunning,
      currentUnit: state.currentUnit,
      hasProjectConfig: state.projectConfig != null,
      leftStatus: state.leftStatus,
      rightStatus: state.rightStatus,
    })),
  );
  const currentUnitName = currentUnit?.name || '';
  const {
    collapsedSections,
    search,
    setUnitSectionCollapsed,
    setUnitScrollOffset,
    setUnitSearch,
    setCurrentView,
  } = useAppStore(
    useShallow((state) => {
      const unit = state.getUnitState(currentUnitName);
      return {
        collapsedSections: unit.collapsedSections,
        search: unit.search,
        setUnitSectionCollapsed: state.setUnitSectionCollapsed,
        setUnitScrollOffset: state.setUnitScrollOffset,
        setUnitSearch: state.setUnitSearch,
        setCurrentView: state.setCurrentView,
      };
    }),
  );
  const initialScrollOffsets = useMemo(
    () => useAppStore.getState().getUnitState(currentUnitName).scrollOffsets,
    [currentUnitName],
  );
  const setLeftSectionCollapsed = useCallback(
    (section: string, collapsed: boolean) => {
      setUnitSectionCollapsed(currentUnitName, section, 'left', collapsed);
    },
    [currentUnitName, setUnitSectionCollapsed],
  );
  const setRightSectionCollapsed = useCallback(
    (section: string, collapsed: boolean) => {
      setUnitSectionCollapsed(currentUnitName, section, 'right', collapsed);
    },
    [currentUnitName, setUnitSectionCollapsed],
  );

  const renderList = (
    height: number,
    width: number,
    itemData: ItemData,
    side: Side,
  ) => {
    if (!itemData.obj) {
      if (!itemData.status || itemData.status.success) {
        return (
          <div className={clsx(styles.symbolList, styles.noObject)}>
            No object configured
          </div>
        );
      }
      return (
        <div className={clsx(styles.symbolList, styles.noObject)}>
          <pre>{itemData.status.cmdline}</pre>
          <pre>{itemData.status.stdout}</pre>
          <pre>{itemData.status.stderr}</pre>
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
    leftStatus,
    diff.left,
    collapsedSections.left,
    search,
    'left',
    setLeftSectionCollapsed,
  );
  const rightItemData = createItemDataRight(
    rightStatus,
    diff.right,
    collapsedSections.right,
    search,
    'right',
    setRightSectionCollapsed,
  );

  const setAllSections = (side: Side, value: boolean) => {
    if (side === 'left') {
      for (const section of leftItemData.sections) {
        setUnitSectionCollapsed(currentUnitName, section.id, 'left', value);
      }
    } else {
      for (const section of rightItemData.sections) {
        setUnitSectionCollapsed(currentUnitName, section.id, 'right', value);
      }
    }
  };

  const expandCollapse = (side: Side) => (
    <>
      <div className={headerStyles.spacer} />
      <button title="Collapse all" onClick={() => setAllSections(side, true)}>
        <span className="codicon codicon-chevron-up" />
      </button>
      <button title="Expand all" onClick={() => setAllSections(side, false)}>
        <span className="codicon codicon-chevron-down" />
      </button>
    </>
  );

  const unitNameRow = (
    <span className={clsx(headerStyles.label, headerStyles.emphasized)}>
      {currentUnitName}
    </span>
  );

  const filterRow = (
    <input
      type="text"
      placeholder="Filter symbols"
      value={search || ''}
      onChange={(e) => setUnitSearch(currentUnitName, e.target.value)}
    />
  );

  const settingsRow = (
    <button title="Settings" onClick={() => setCurrentView('settings')}>
      <span className="codicon codicon-settings-gear" />
    </button>
  );

  return (
    <>
      <div className={headerStyles.header}>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            {hasProjectConfig ? (
              <button
                title="Back"
                onClick={() => setCurrentUnit(null)}
                disabled={buildRunning}
              >
                <span className="codicon codicon-chevron-left" />
              </button>
            ) : null}
            <span className={headerStyles.label}>Target object</span>
          </div>
          <div className={headerStyles.row}>
            {currentUnitName ? unitNameRow : filterRow}
            {expandCollapse('left')}
          </div>
        </div>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            {hasProjectConfig && (
              <button
                title="Build"
                onClick={() => runBuild()}
                disabled={buildRunning}
              >
                <span className="codicon codicon-refresh" />
              </button>
            )}
            <span className={headerStyles.label}>Base object</span>
          </div>
          <div className={headerStyles.row}>
            {currentUnitName ? filterRow : settingsRow}
            {expandCollapse('right')}
          </div>
        </div>
      </div>
      <div className={styles.symbols}>
        <ContextMenuProvider
          render={({ data }, close) => {
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
            const items = display.symbolContext(obj, data.symbolRef);
            return renderContextItems(items, close);
          }}
        >
          <AutoSizer className={styles.symbols}>
            {({ height, width }) => (
              <>
                {renderList(height, width, leftItemData, 'left')}
                {renderList(height, width, rightItemData, 'right')}
              </>
            )}
          </AutoSizer>
        </ContextMenuProvider>
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
