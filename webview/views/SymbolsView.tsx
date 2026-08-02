import styles from './SymbolsView.module.css';

import memoizeOne from 'memoize-one';
import { type diff, display } from 'objdiff-wasm';
import { memo, useCallback, useEffect, useMemo } from 'react';
import {
  FixedSizeList,
  type ListChildComponentProps,
  areEqual,
} from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import type { Unit } from '../../shared/config';
import type { MatchRange } from '../../shared/fuzzy';
import { createContextMenu } from '../common/ContextMenu';
import PercentBadge from '../common/PercentBadge';
import { createTooltip } from '../common/TooltipShared';
import type { DiffOutput } from '../diff';
import {
  type SearchOptions,
  type Side,
  type SymbolRefByName,
  defaultSearchOptions,
  useAppStore,
  useExtensionStore,
} from '../state';
import { createSymbolFilter, splitRanges } from '../util/symbolSearch';
import { useFontSize } from '../util/util';
import { type TreeData, TreeRow } from './TreeView';

export type SymbolTooltipContent = {
  symbolRef: display.SymbolRef;
  side: Side;
};

export const { Tooltip: SymbolTooltip, useTooltip: useSymbolTooltip } =
  createTooltip<SymbolTooltipContent>();

export const {
  ContextMenuProvider: SymbolContextMenuProvider,
  useContextMenu: useSymbolContextMenu,
} = createContextMenu<SymbolTooltipContent>();

const SectionRow = ({
  section,
}: {
  section: display.SectionDisplay;
}) => {
  return (
    <span className={styles.sectionRow}>
      <span className={styles.sectionName}>{section.name}</span>
      <span className={styles.sectionSize}>({section.size.toString(16)})</span>
      {section.matchPercent != null && (
        <PercentBadge percent={section.matchPercent} />
      )}
    </span>
  );
};

const SymbolRow = ({
  symbol,
  ranges,
}: {
  symbol: display.SymbolDisplay;
  ranges: MatchRange[];
}) => {
  const flags = [];
  if (symbol.info.flags.global) {
    flags.push(
      <span key="g" className={styles.flagGlobal}>
        g
      </span>,
    );
  }
  if (symbol.info.flags.weak) {
    flags.push(
      <span key="w" className={styles.flagWeak}>
        w
      </span>,
    );
  }
  if (symbol.info.flags.local) {
    flags.push(
      <span key="l" className={styles.flagLocal}>
        l
      </span>,
    );
  }
  if (symbol.info.flags.common) {
    flags.push(
      <span key="c" className={styles.flagCommon}>
        c
      </span>,
    );
  }
  if (symbol.info.flags.hidden) {
    flags.push(
      <span key="h" className={styles.flagHidden}>
        h
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
        <PercentBadge percent={symbol.matchPercent} />{' '}
      </>
    );
  }
  const name = symbol.info.demangledName || symbol.info.name;
  return (
    <>
      {flagsElem}
      {percentElem}
      <span className={styles.symbolName}>
        {ranges.length === 0
          ? name
          : splitRanges(name, ranges).map((part, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
                key={i}
                className={part.matched ? styles.searchMatch : undefined}
              >
                {part.text}
              </span>
            ))}
      </span>
    </>
  );
};

type SymbolData = {
  section: display.SectionDisplay;
  symbolRef: display.SymbolRef;
  selected: boolean;
  highlighted: boolean;
  ranges: MatchRange[];
};

/** How many symbols the filter kept, out of how many exist. */
export type SymbolCounts = { shown: number; total: number };

type ItemData = {
  obj: diff.ObjectDiff | undefined;
  otherObj?: diff.ObjectDiff | undefined;
  sections: display.SectionDisplay[];
  treeData: TreeData<display.SectionDisplay, SymbolData>;
  side: Side;
  isMapping: boolean;
  currentUnitName: string;
  counts: SymbolCounts;
  searchError: string | null;
  filterActive: boolean;
  setSectionCollapsed: (section: string, collapsed: boolean) => void;
  setHoverSymbols: (value: [number | null, number | null]) => void;
};

const SymbolListRow = memo(
  ({
    index,
    style,
    data: {
      obj,
      otherObj,
      treeData,
      side,
      isMapping,
      currentUnitName,
      setSectionCollapsed,
      setHoverSymbols,
    },
  }: ListChildComponentProps<ItemData>) => {
    const { setSelectedSymbol, setUnitMapping } = useAppStore(
      useShallow((state) => ({
        setSelectedSymbol: state.setSelectedSymbol,
        setUnitMapping: state.setUnitMapping,
      })),
    );
    const onContextMenu = useSymbolContextMenu();
    if (!obj) {
      return null;
    }
    const node = treeData.nodes[index];
    if (node.type === 'leaf') {
      const { symbolRef, section, selected, highlighted, ranges } = node.data;
      const symbol = display.displaySymbol(obj, symbolRef);
      const tooltipContent: SymbolTooltipContent = {
        symbolRef,
        side,
      };
      const tooltipProps = useSymbolTooltip(tooltipContent);
      return (
        <TreeRow
          index={index}
          style={style}
          data={treeData}
          render={() => <SymbolRow symbol={symbol} ranges={ranges} />}
          getClasses={() => {
            const classes = [];
            if (selected) {
              classes.push(styles.selected);
            }
            if (highlighted) {
              classes.push(styles.highlighted);
            }
            return classes;
          }}
          onLeafClick={() => {
            const symbolRefByName: SymbolRefByName = {
              symbolName: symbol.info.name,
              sectionName: section.name,
            };
            let otherSymbolRefByName: SymbolRefByName | null = null;
            if (symbol.targetSymbol !== undefined && otherObj) {
              const targetSymbol = otherObj.getSymbol(symbol.targetSymbol);
              if (targetSymbol) {
                otherSymbolRefByName = {
                  symbolName: targetSymbol.name,
                  sectionName: targetSymbol.sectionName ?? null,
                };
              }
            }
            if (isMapping) {
              if (side === 'left') {
                setUnitMapping(
                  currentUnitName,
                  symbolRefByName.symbolName,
                  otherSymbolRefByName?.symbolName,
                );
              } else {
                setUnitMapping(
                  currentUnitName,
                  otherSymbolRefByName?.symbolName,
                  symbolRefByName.symbolName,
                );
              }
            }
            if (side === 'left') {
              setSelectedSymbol(symbolRefByName, otherSymbolRefByName);
            } else {
              setSelectedSymbol(otherSymbolRefByName, symbolRefByName);
            }
          }}
          onHover={() => {
            const targetSymbol = symbol.targetSymbol ?? null;
            if (side === 'left') {
              setHoverSymbols([symbolRef, targetSymbol]);
            } else {
              setHoverSymbols([targetSymbol, symbolRef]);
            }
          }}
          rowProps={{
            ...tooltipProps,
            onContextMenu: (e) => onContextMenu(e, tooltipContent),
          }}
        />
      );
    }
    return (
      <TreeRow
        index={index}
        style={style}
        data={treeData}
        render={() => <SectionRow section={node.data} />}
        setBranchCollapsed={setSectionCollapsed}
        onHover={() => setHoverSymbols([null, null])}
      />
    );
  },
  areEqual,
);

const createItemDataFn = (
  obj: diff.ObjectDiff | undefined,
  otherObj: diff.ObjectDiff | undefined,
  collapsedSections: Record<string, boolean>,
  search: string | null,
  searchOptions: SearchOptions,
  side: Side,
  isMapping: boolean,
  setSectionCollapsed: (section: string, collapsed: boolean) => void,
  highlightedPath: string | null,
  setHighlightedPath: (id: string | null) => void,
  hoverSymbol: number | null,
  setHoverSymbols: (value: [number | null, number | null]) => void,
  mappingSymbol: number | null,
  currentUnit: Unit | null,
  showMappedSymbols: boolean,
  showHiddenSymbols: boolean,
  diffLabel: string | null,
): ItemData => {
  const currentUnitName = currentUnit?.name || '';
  const filter = createSymbolFilter(search, searchOptions);
  if (!obj) {
    return {
      obj,
      otherObj,
      sections: [],
      treeData: {
        leafCount: 0,
        nodes: [],
        highlightedPath,
        setHighlightedPath,
      },
      side,
      isMapping,
      currentUnitName,
      counts: { shown: 0, total: 0 },
      searchError: filter.error,
      filterActive: filter.active,
      setSectionCollapsed,
      setHoverSymbols,
    };
  }
  const reverseFnOrder =
    currentUnit?.metadata?.reverse_fn_order ??
    currentUnit?.reverse_fn_order ??
    false;
  // Filtering happens in TypeScript rather than via the WASM's `regex` filter:
  // that way fuzzy and plain-text modes, percentage filters and match
  // highlighting all share one implementation, and a malformed regex shows an
  // error instead of silently matching nothing.
  const sections = display.displaySections(
    obj,
    {
      mapping: mappingSymbol ?? undefined,
    },
    {
      showHiddenSymbols,
      showMappedSymbols,
      reverseFnOrder,
    },
  );
  const treeData: ItemData['treeData'] = {
    leafCount: 0,
    nodes: [],
    highlightedPath,
    setHighlightedPath,
  };
  const counts: SymbolCounts = { shown: 0, total: 0 };

  for (const section of sections) {
    const matches: { symbolRef: number; ranges: MatchRange[]; name: string }[] =
      [];
    for (const symbolRef of section.symbols) {
      counts.total++;
      const symbol = display.displaySymbol(obj, symbolRef);
      const match = filter.match(symbol);
      if (!match) {
        continue;
      }
      counts.shown++;
      matches.push({
        symbolRef,
        ranges: match.ranges,
        name: symbol.info.name,
      });
    }
    if (filter.active && matches.length === 0) {
      continue;
    }
    treeData.leafCount += matches.length;
    const collapsed = collapsedSections[section.id];
    treeData.nodes.push({
      type: 'branch',
      id: section.id,
      indent: 0,
      path: [],
      data: section,
      collapsed,
    });
    if (!collapsed) {
      for (const { symbolRef, ranges, name } of matches) {
        treeData.nodes.push({
          type: 'leaf',
          id: `symbol-${symbolRef}`,
          indent: 1,
          path: [section.id],
          data: {
            section,
            symbolRef,
            selected: hoverSymbol === symbolRef,
            highlighted: diffLabel !== null && diffLabel === name,
            ranges,
          },
        });
      }
    }
  }
  return {
    obj,
    otherObj,
    sections,
    treeData,
    side,
    isMapping,
    currentUnitName,
    counts,
    searchError: filter.error,
    filterActive: filter.active,
    setSectionCollapsed,
    setHoverSymbols,
  };
};
const createItemDataLeft = memoizeOne(createItemDataFn);
const createItemDataRight = memoizeOne(createItemDataFn);

export const SymbolList = ({
  height,
  width,
  side,
  result,
  mappingSymbol,
  showMappedSymbols,
  showHiddenSymbols,
  highlightedPath,
  setHighlightedPath,
  hoverSymbols,
  setHoverSymbols,
  onCounts,
  fullWidth = false,
}: {
  height: number;
  width: number;
  side: Side;
  result: DiffOutput;
  mappingSymbol: number | null;
  showMappedSymbols: boolean;
  showHiddenSymbols: boolean;
  highlightedPath: string | null;
  setHighlightedPath: (id: string | null) => void;
  hoverSymbols: [number | null, number | null];
  setHoverSymbols: (value: [number | null, number | null]) => void;
  onCounts?: (side: Side, counts: SymbolCounts, error: string | null) => void;
  /** Use the full given width instead of half of it (sidebar rather than column). */
  fullWidth?: boolean;
}) => {
  const { currentUnit, diffLabel } = useExtensionStore(
    useShallow((state) => ({
      currentUnit: state.currentUnit,
      diffLabel: state.diffLabel,
    })),
  );
  const currentUnitName = currentUnit?.name || '';
  const {
    collapsedSections,
    search,
    searchOptions,
    setUnitSectionCollapsed,
    setUnitScrollOffset,
  } = useAppStore(
    useShallow((state) => {
      const unit = state.getUnitState(currentUnitName);
      return {
        collapsedSections: unit.collapsedSections,
        search: unit.search,
        searchOptions: unit.searchOptions ?? defaultSearchOptions,
        setUnitSectionCollapsed: state.setUnitSectionCollapsed,
        setUnitScrollOffset: state.setUnitScrollOffset,
      };
    }),
  );
  const initialScrollOffsets = useMemo(
    () => useAppStore.getState().getUnitState(currentUnitName).scrollOffsets,
    [currentUnitName],
  );

  const setSectionCollapsed = useCallback(
    (section: string, collapsed: boolean) => {
      setUnitSectionCollapsed(currentUnitName, section, side, collapsed);
    },
    [currentUnitName, setUnitSectionCollapsed, side],
  );

  const itemData = (side === 'left' ? createItemDataLeft : createItemDataRight)(
    side === 'left' ? result.diff?.left : result.diff?.right,
    side === 'left' ? result.diff?.right : result.diff?.left,
    collapsedSections[side],
    search,
    searchOptions,
    side,
    result.isMapping,
    setSectionCollapsed,
    highlightedPath,
    setHighlightedPath,
    side === 'left' ? hoverSymbols[0] : hoverSymbols[1],
    setHoverSymbols,
    mappingSymbol,
    currentUnit,
    showMappedSymbols,
    showHiddenSymbols,
    diffLabel,
  );
  const itemSize = useFontSize() * 1.33;

  // Report filter results up to the header, which owns the search bar.
  const { counts, searchError } = itemData;
  useEffect(() => {
    onCounts?.(side, counts, searchError);
  }, [onCounts, side, counts, searchError]);

  const { setUnitSearch, setUnitSearchOptions } = useAppStore(
    useShallow((state) => ({
      setUnitSearch: state.setUnitSearch,
      setUnitSearchOptions: state.setUnitSearchOptions,
    })),
  );

  if (itemData.obj && itemData.treeData.nodes.length === 0) {
    return (
      <div
        className={styles.emptyState}
        style={{ width: fullWidth ? width : width / 2, height }}
      >
        <span className={styles.title}>
          {itemData.filterActive
            ? 'No symbols match the current filter'
            : 'This object has no symbols'}
        </span>
        {search ? (
          <span>
            Nothing matched <code>{search}</code>
          </span>
        ) : null}
        {itemData.filterActive && (
          <button
            type="button"
            onClick={() => {
              setUnitSearch(currentUnitName, null);
              setUnitSearchOptions(currentUnitName, { percentFilter: 'all' });
            }}
          >
            Clear filter
          </button>
        )}
      </div>
    );
  }

  return (
    <FixedSizeList
      key={`${side}-${currentUnitName}`}
      className={styles.symbolList}
      height={height - 1}
      itemCount={itemData.treeData.nodes.length}
      itemSize={itemSize}
      width={fullWidth ? width : width / 2}
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
