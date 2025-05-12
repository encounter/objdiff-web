import styles from './UnitsView.module.css';

import clsx from 'clsx';
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

type DirectoryItem = {
  type: 'directory';
  indent: number;
  label: string;
  id: string;
  collapsed: boolean;
  path: string[];
};

type UnitItem = {
  type: 'unit';
  indent: number;
  label: string;
  id: string;
  unit: Unit;
  path: string[];
};

type Item = DirectoryItem | UnitItem;

type ItemData = {
  unitsCount: number;
  items: Item[];
  highlightedPath: string | null;
  setHighlightedPath: (id: string | null) => void;
};

const UnitRow = memo(
  ({
    index,
    style,
    data: { items, highlightedPath, setHighlightedPath },
  }: ListChildComponentProps<ItemData>) => {
    const setCollapsedUnit = useAppStore((state) => state.setCollapsedUnit);
    const item = items[index];
    const classes = [styles.row];
    if (item.type === 'unit') {
      classes.push(styles.unit);
      if (item.unit.metadata?.complete !== undefined) {
        if (item.unit.metadata.complete) {
          classes.push(styles.complete);
        } else {
          classes.push(styles.incomplete);
        }
      }
    } else {
      // classes.push(styles.directory);
      if (item.collapsed) {
        classes.push(styles.collapsed);
      }
    }
    const indentItems = [];
    for (let i = 0; i < item.indent; i++) {
      indentItems.push(
        <span
          key={i}
          className={clsx(
            styles.indent,
            item.path[i] === highlightedPath && styles.indentHighlighted,
          )}
        />,
      );
    }
    if (item.type === 'directory') {
      indentItems.push(
        <span
          key="toggle"
          className={clsx(
            styles.toggle,
            'codicon',
            item.collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down',
          )}
        />,
      );
    }
    return (
      <div
        className={clsx(classes)}
        style={style}
        onClick={() => {
          if (item.type === 'unit') {
            setCurrentUnit(item.unit);
          } else {
            const collapsed = !item.collapsed;
            setCollapsedUnit(item.id, collapsed);
            setHighlightedPath(
              collapsed ? item.path[item.path.length - 1] : item.id,
            );
          }
        }}
        onMouseEnter={() => {
          setHighlightedPath(
            item.type === 'unit' || item.collapsed
              ? item.path[item.path.length - 1]
              : item.id,
          );
        }}
      >
        {indentItems}
        <span className={styles.label}>{item.label}</span>
      </div>
    );
  },
  areEqual,
);

type TreeItem = DirectoryItem & { children: (TreeItem | UnitItem)[] };

function pushTreeItems(item: TreeItem | UnitItem, out: Item[]) {
  if (item.type === 'directory') {
    out.push(item);
    if (!item.collapsed) {
      for (const child of item.children) {
        pushTreeItems(child, out);
      }
    }
  } else if (item.type === 'unit') {
    out.push(item);
  }
}

const buildPath = (split: string[]) => {
  const path = [];
  for (let i = 0; i < split.length - 1; i++) {
    path.push(split.slice(0, i + 1).join('/'));
  }
  return path;
};

const createItemData = memoizeOne(
  (
    config: ProjectConfig | null,
    collapsedUnits: Record<string, boolean>,
    highlightedPath: string | null,
    setHighlightedPath: (id: string | null) => void,
  ): ItemData => {
    const units = config?.units ?? [];
    const map = new Map<string, TreeItem>();
    const rootItems = [];
    for (const unit of units) {
      const path = unit.name || '';
      const split = path.split('/');
      let parent: TreeItem | null = null;
      for (let i = 0; i < split.length - 1; i++) {
        const name = split[i];
        const dirPath = split.slice(0, i + 1);
        const key = dirPath.join('/');
        let item = map.get(key);
        if (!item) {
          item = {
            type: 'directory',
            indent: i,
            label: name,
            id: key,
            collapsed: !!collapsedUnits[key],
            children: [],
            path: buildPath(dirPath),
          };
          if (parent) {
            parent.children.push(item);
          } else {
            rootItems.push(item);
          }
          map.set(key, item);
        }
        parent = item;
      }
      const unitItem: UnitItem = {
        type: 'unit',
        indent: split.length - 1,
        label: split[split.length - 1],
        id: path,
        unit,
        path: buildPath(split),
      };
      if (parent) {
        parent.children.push(unitItem);
      } else {
        rootItems.push(unitItem);
      }
    }
    const items: Item[] = [];
    for (const item of rootItems) {
      pushTreeItems(item, items);
    }
    return {
      unitsCount: units.length,
      items,
      highlightedPath,
      setHighlightedPath,
    };
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
              {itemData.unitsCount} unit{itemData.unitsCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>
      <div className={styles.units}>
        <AutoSizer>
          {({ height, width }) => (
            <FixedSizeList
              height={height}
              itemCount={itemData.items.length}
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
