import memoizeOne from 'memoize-one';
import { memo, useMemo, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeList,
  type ListChildComponentProps,
  areEqual,
} from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import type { ProjectConfig, Unit } from '../../shared/config';
import { fuzzyMatch } from '../../shared/fuzzy';
import headerStyles from '../common/Header.module.css';
import SearchBar from '../common/SearchBar';
import SymbolSearchResults from '../common/SymbolSearchResults';
import {
  type SearchOptions,
  defaultSearchOptions,
  quickPickUnit,
  setCurrentUnit,
  useAppStore,
  useExtensionStore,
} from '../state';
import { useFontSize } from '../util/util';
import { type SimpleTreeData, TreeRow, buildSimpleTree } from './TreeView';
import styles from './UnitsView.module.css';

const UnitRow = memo((props: ListChildComponentProps<SimpleTreeData<Unit>>) => {
  const setCollapsedUnit = useAppStore((state) => state.setCollapsedUnit);
  return (
    <TreeRow
      {...props}
      getClasses={(item) => {
        if (
          item.type === 'leaf' &&
          item.data.metadata?.complete !== undefined
        ) {
          if (item.data.metadata.complete) {
            return [styles.complete];
          }
          return [styles.incomplete];
        }
        return [];
      }}
      onLeafClick={(item) => {
        setCurrentUnit(item.data);
      }}
      setBranchCollapsed={setCollapsedUnit}
      render={(item) => {
        return (
          <span className={item.type === 'leaf' ? styles.unitLabel : undefined}>
            {item.data.label}
          </span>
        );
      }}
    />
  );
}, areEqual);

const createItemData = memoizeOne(
  (
    config: ProjectConfig | null,
    collapsedUnits: Record<string, boolean>,
    highlightedPath: string | null,
    setHighlightedPath: (id: string | null) => void,
    search: string | null,
    options: SearchOptions,
  ): SimpleTreeData<Unit> & { total: number; error: string | null } => {
    const all = config?.units ?? [];
    const { units, error } = filterUnits(all, search, options);
    return {
      ...buildSimpleTree(
        units,
        (unit) => unit.name || '',
        // Collapsed folders would hide matches, so expand everything while
        // a filter is active.
        search ? {} : collapsedUnits,
        highlightedPath,
        setHighlightedPath,
      ),
      total: all.length,
      error,
    };
  },
);

/** Filter the unit list by path, using the same matching modes as symbols. */
const filterUnits = (
  units: Unit[],
  search: string | null,
  options: SearchOptions,
): { units: Unit[]; error: string | null } => {
  if (!search) {
    return { units, error: null };
  }
  if (options.mode === 'regex') {
    let regex: RegExp;
    try {
      regex = new RegExp(search, options.caseSensitive ? '' : 'i');
    } catch (e) {
      return {
        units,
        error:
          e instanceof Error
            ? e.message.replace(/^Invalid regular expression:\s*/, '')
            : String(e),
      };
    }
    return {
      units: units.filter((u) => regex.test(u.name || '')),
      error: null,
    };
  }
  if (options.mode === 'substring') {
    const needle = options.caseSensitive ? search : search.toLowerCase();
    return {
      units: units.filter((u) => {
        const name = options.caseSensitive
          ? u.name || ''
          : (u.name || '').toLowerCase();
        return name.includes(needle);
      }),
      error: null,
    };
  }
  // Fuzzy, but anchored: either the query appears literally somewhere in the
  // path, or it fuzzy-matches the file name itself. Fuzzy-matching the whole
  // path would drag in every file whose directory happens to contain the
  // query's letters in order — searching "vehicle.cpp" would return
  // "vehicles/heli.cpp" and bury the file actually being looked for.
  const needle = search.toLowerCase();
  const keep = units.filter((unit) => {
    const name = (unit.name || '').toLowerCase();
    if (name.includes(needle)) {
      return true;
    }
    const basename = name.slice(name.lastIndexOf('/') + 1);
    return fuzzyMatch(search, basename) != null;
  });
  return { units: keep, error: null };
};

const UnitsView = () => {
  const config = useExtensionStore((state) => state.projectConfig);
  const {
    collapsedUnits,
    search,
    searchOptions,
    setCurrentView,
    setUnitsScrollOffset,
    setUnitsSearch,
    setUnitsSearchOptions,
  } = useAppStore(
    useShallow((state) => ({
      collapsedUnits: state.collapsedUnits,
      search: state.unitsSearch,
      searchOptions: state.unitsSearchOptions ?? defaultSearchOptions,
      setCurrentView: state.setCurrentView,
      setUnitsScrollOffset: state.setUnitsScrollOffset,
      setUnitsSearch: state.setUnitsSearch,
      setUnitsSearchOptions: state.setUnitsSearchOptions,
    })),
  );
  const initialScrollOffset = useMemo(
    () => useAppStore.getState().unitsScrollOffset,
    [],
  );
  const itemSize = useFontSize() * 1.33;
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const itemData = createItemData(
    config,
    collapsedUnits,
    highlightedPath,
    setHighlightedPath,
    search,
    searchOptions,
  );
  return (
    <>
      <div className={headerStyles.header}>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            <button onClick={() => setCurrentUnit('source')}>
              Current File
            </button>
            <button onClick={() => quickPickUnit()}>Quick Pick</button>
            <button title="Settings" onClick={() => setCurrentView('settings')}>
              <span className="codicon codicon-settings-gear" />
            </button>
          </div>
          <div className={headerStyles.row}>
            <SearchBar
              search={search}
              options={searchOptions}
              resultCount={itemData.leafCount}
              totalCount={itemData.total}
              error={itemData.error}
              onSearchChange={setUnitsSearch}
              onOptionsChange={setUnitsSearchOptions}
              placeholder="Filter files"
              noun="units"
              showPercentFilter={false}
              hint={null}
            />
          </div>
        </div>
      </div>
      <div className={styles.units}>
        {itemData.nodes.length === 0 ? (
          <div className={styles.emptyState}>
            <span>
              No file matches <code>{search}</code>
            </span>
            <button type="button" onClick={() => setUnitsSearch(null)}>
              Clear filter
            </button>
          </div>
        ) : (
          <AutoSizer key={search ?? ''}>
            {({ height, width }) => (
              <FixedSizeList
                height={height}
                itemCount={itemData.nodes.length}
                itemSize={itemSize}
                width={width}
                itemData={itemData}
                overscanCount={20}
                onScroll={(e) => {
                  setUnitsScrollOffset(e.scrollOffset);
                }}
                initialScrollOffset={initialScrollOffset}
              >
                {UnitRow}
              </FixedSizeList>
            )}
          </AutoSizer>
        )}
      </div>
      {search && (
        <SymbolSearchResults query={search} units={config?.units ?? []} />
      )}
    </>
  );
};

export default UnitsView;
