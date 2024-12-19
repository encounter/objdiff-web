import styles from './UnitsView.module.css';

import clsx from 'clsx';
import memoizeOne from 'memoize-one';
import { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeList,
  type ListChildComponentProps,
  areEqual,
} from 'react-window';
import type { ObjdiffConfiguration, Unit } from '../shared/config';
import headerStyles from './Header.module.css';
import { useAppStore, useExtensionStore, vscode } from './state';
import { useFontSize } from './util';

type ItemData = {
  itemCount: number;
  units: Unit[];
};

const UnitRow = memo(
  ({ index, style, data: { units } }: ListChildComponentProps<ItemData>) => {
    const unit = units[index];
    const classes = [styles.unitsRow];
    if (unit.metadata?.complete !== undefined) {
      if (unit.metadata.complete) {
        classes.push(styles.complete);
      } else {
        classes.push(styles.incomplete);
      }
    }
    return (
      <div
        className={clsx(classes)}
        style={style}
        onClick={() => {
          vscode.postMessage({ type: 'setCurrentUnit', unit });
        }}
      >
        {unit.name}
      </div>
    );
  },
  areEqual,
);

const createItemData = memoizeOne(
  (config: ObjdiffConfiguration | null): ItemData => {
    const itemCount = config?.units?.length ?? 0;
    return { itemCount, units: config?.units ?? [] };
  },
);

const UnitsView = () => {
  const config = useExtensionStore((state) => state.config);
  const setUnitsScrollOffset = useAppStore(
    (state) => state.setUnitsScrollOffset,
  );
  const initialScrollOffset = useMemo(
    () => useAppStore.getState().unitsScrollOffset,
    [],
  );
  const itemSize = useFontSize() * 1.33;
  const itemData = createItemData(config);
  return (
    <>
      <div className={headerStyles.header}>
        <button
          onClick={() =>
            vscode.postMessage({ type: 'setCurrentUnit', unit: 'source' })
          }
        >
          Current File
        </button>
        <button onClick={() => vscode.postMessage({ type: 'quickPickUnit' })}>
          Quick Pick
        </button>
        <small>
          {itemData.itemCount} unit{itemData.itemCount === 1 ? '' : 's'}
        </small>
      </div>
      <div className={styles.units}>
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
