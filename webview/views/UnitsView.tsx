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
import headerStyles from '../common/Header.module.css';
import {
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
  ): SimpleTreeData<Unit> => {
    return buildSimpleTree(
      config?.units ?? [],
      (unit) => unit.name || '',
      collapsedUnits,
      highlightedPath,
      setHighlightedPath,
    );
  },
);

const UnitsView = () => {
  const config = useExtensionStore((state) => state.projectConfig);
  const { collapsedUnits, setCurrentView, setUnitsScrollOffset } = useAppStore(
    useShallow((state) => ({
      collapsedUnits: state.collapsedUnits,
      setCurrentView: state.setCurrentView,
      setUnitsScrollOffset: state.setUnitsScrollOffset,
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
            <span className={headerStyles.label}>
              {itemData.leafCount} unit{itemData.leafCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>
      <div className={styles.units}>
        <AutoSizer>
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
      </div>
    </>
  );
};

export default UnitsView;
