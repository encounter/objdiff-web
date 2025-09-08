import headerStyles from '../common/Header.module.css';
import styles from './DiffView.module.css';

import clsx from 'clsx';
import { type diff, display } from 'objdiff-wasm';
import { useCallback, useMemo, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useShallow } from 'zustand/react/shallow';
import type { BuildStatus } from '../../shared/messages';
import {
  type ContextMenuRender,
  renderContextItems,
} from '../common/ContextMenu';
import type { TooltipCallback } from '../common/TooltipShared';
import type { DiffOutput } from '../diff';
import {
  type Side,
  type SymbolRefByName,
  buildDiffConfig,
  runBuild,
  setCurrentUnit,
  useAppStore,
  useExtensionStore,
} from '../state';
import { percentClass } from '../util/util';
import {
  DataContextMenuProvider,
  DataList,
  DataTooltip,
  type DataTooltipContent,
} from './DataView';
import {
  InstructionContextMenuProvider,
  InstructionList,
  InstructionTooltip,
  type InstructionTooltipContent,
} from './FunctionView';
import {
  SymbolContextMenuProvider,
  SymbolList,
  SymbolTooltip,
  type SymbolTooltipContent,
} from './SymbolsView';

type ColumnViewBuildStatus = {
  type: 'buildStatus';
  status: BuildStatus;
};

type ColumnViewAsm = {
  type: 'asm';
  obj: diff.ObjectDiff;
  symbol: display.SymbolDisplay;
};

type ColumnViewData = {
  type: 'data';
  obj: diff.ObjectDiff;
  symbol: display.SymbolDisplay;
};

type ColumnViewSymbols = {
  type: 'symbols';
  mappingSymbol: number | null;
};

type ColumnViewNone = {
  type: 'none';
};

type ColumnView =
  | ColumnViewNone
  | ColumnViewBuildStatus
  | ColumnViewAsm
  | ColumnViewData
  | ColumnViewSymbols;

export const resolveSymbol = (
  obj: diff.ObjectDiff | undefined,
  symbolRef: SymbolRefByName | null,
): display.SymbolDisplay | null => {
  if (!symbolRef || !obj) {
    return null;
  }
  const leftSymbol = obj?.findSymbol(
    symbolRef.symbolName,
    symbolRef.sectionName ?? undefined,
  );
  if (leftSymbol === undefined) {
    return null;
  }
  return display.displaySymbol(obj, leftSymbol.id);
};

const DiffView = ({
  result,
  leftSymbolRef,
  rightSymbolRef,
}: {
  result: DiffOutput;
  leftSymbolRef: SymbolRefByName | null;
  rightSymbolRef: SymbolRefByName | null;
}) => {
  const { configProperties } = useExtensionStore(
    useShallow((state) => ({
      configProperties: state.configProperties,
    })),
  );
  const leftSymbol = useMemo(
    () => resolveSymbol(result.diff?.left, leftSymbolRef),
    [result.diff?.left, leftSymbolRef],
  );
  const rightSymbol = useMemo(
    () => resolveSymbol(result.diff?.right, rightSymbolRef),
    [result.diff?.right, rightSymbolRef],
  );
  // Already memoized
  const diffConfig = buildDiffConfig(configProperties);

  let leftColumnView: ColumnView = {
    type: 'symbols',
    mappingSymbol: null,
  };
  let rightColumnView: ColumnView = {
    type: 'symbols',
    mappingSymbol: null,
  };

  const leftSuccess = result.leftStatus?.success ?? false;
  const rightSuccess = result.rightStatus?.success ?? false;
  if (!leftSuccess) {
    if (result.leftStatus) {
      leftColumnView = {
        type: 'buildStatus',
        status: result.leftStatus,
      };
    } else {
      leftColumnView = {
        type: 'none',
      };
    }
  }
  if (!rightSuccess) {
    if (result.rightStatus) {
      rightColumnView = {
        type: 'buildStatus',
        status: result.rightStatus,
      };
    } else {
      rightColumnView = {
        type: 'none',
      };
    }
  }

  let leftColumnType: ColumnView['type'] | null = null;
  let rightColumnType: ColumnView['type'] | null = null;
  if (leftSymbol && leftSuccess) {
    switch (leftSymbol.info.sectionKind) {
      case 'code':
        leftColumnType = 'asm';
        break;
      case 'data':
        leftColumnType = 'data';
        break;
      default:
        break;
    }
  }
  if (rightSymbol && rightSuccess) {
    switch (rightSymbol.info.sectionKind) {
      case 'code':
        rightColumnType = 'asm';
        break;
      case 'data':
        rightColumnType = 'data';
        break;
      default:
        break;
    }
  }

  if (leftSymbol && leftColumnType && rightSymbol && rightColumnType) {
    // Joint view
    leftColumnView = {
      type: leftColumnType,
      obj: result.diff!.left!,
      symbol: leftSymbol,
    };
    rightColumnView = {
      type: rightColumnType,
      obj: result.diff!.right!,
      symbol: rightSymbol,
    };
  } else if (leftSymbol && leftColumnType) {
    // Left view only
    leftColumnView = {
      type: leftColumnType,
      obj: result.diff!.left!,
      symbol: leftSymbol,
    };
    if (rightSuccess) {
      // Mapping view
      rightColumnView = {
        type: 'symbols',
        mappingSymbol: leftSymbol.info.id,
      };
    }
  } else if (rightSymbol && rightColumnType) {
    // Right view only
    rightColumnView = {
      type: rightColumnType,
      obj: result.diff!.right!,
      symbol: rightSymbol,
    };
    if (leftSuccess) {
      // Mapping view
      leftColumnView = {
        type: 'symbols',
        mappingSymbol: rightSymbol.info.id,
      };
    }
  }

  const symbolContextMenuRender: ContextMenuRender<SymbolTooltipContent> =
    useCallback(
      ({ data }, close) => {
        let obj: diff.ObjectDiff | undefined;
        switch (data.side) {
          case 'left':
            obj = result.diff?.left;
            break;
          case 'right':
            obj = result.diff?.right;
            break;
          default:
            break;
        }
        if (!obj) {
          return null;
        }
        const items = display.symbolContext(obj, data.symbolRef);
        return renderContextItems(items, close);
      },
      [result.diff],
    );

  const symbolTooltipCallback: TooltipCallback<SymbolTooltipContent> =
    useCallback(
      (data) => {
        let obj: diff.ObjectDiff | undefined;
        switch (data.side) {
          case 'left':
            obj = result.diff?.left;
            break;
          case 'right':
            obj = result.diff?.right;
            break;
          default:
            break;
        }
        if (!obj) {
          return null;
        }
        return display.symbolHover(obj, data.symbolRef);
      },
      [result.diff],
    );

  const instructionContextMenuRender: ContextMenuRender<InstructionTooltipContent> =
    useCallback(
      ({ data }, close) => {
        let obj: diff.ObjectDiff | undefined;
        let symbol: number | undefined;
        switch (data.column) {
          case 0:
            obj = result.diff?.left;
            symbol = leftSymbol?.info.id;
            break;
          case 1:
            obj = result.diff?.right;
            symbol = rightSymbol?.info.id;
            break;
          default:
            break;
        }
        if (!obj || symbol === undefined) {
          return null;
        }
        const items = display.instructionContext(
          obj,
          symbol,
          data.row,
          diffConfig,
        );
        return renderContextItems(items, close);
      },
      [result.diff, leftSymbol, rightSymbol, diffConfig],
    );

  const dataContextMenuRender: ContextMenuRender<DataTooltipContent> =
    useCallback(
      ({ data }, close) => {
        let obj: diff.ObjectDiff | undefined;
        let symbol: number | undefined;
        switch (data.column) {
          case 0:
            obj = result.diff?.left;
            symbol = leftSymbol?.info.id;
            break;
          case 1:
            obj = result.diff?.right;
            symbol = rightSymbol?.info.id;
            break;
          default:
            break;
        }
        if (!obj || symbol === undefined) {
          return null;
        }
        const items = display.dataContext(obj, symbol, data.row);
        return renderContextItems(items, close);
      },
      [result.diff, leftSymbol, rightSymbol],
    );

  const instructionTooltipCallback: TooltipCallback<InstructionTooltipContent> =
    useCallback(
      (data) => {
        let obj: diff.ObjectDiff | undefined;
        let symbol: number | undefined;
        switch (data.column) {
          case 0:
            obj = result.diff?.left;
            symbol = leftSymbol?.info.id;
            break;
          case 1:
            obj = result.diff?.right;
            symbol = rightSymbol?.info.id;
            break;
          default:
            break;
        }
        if (!obj || symbol === undefined) {
          return null;
        }
        return display.instructionHover(obj, symbol, data.row, diffConfig);
      },
      [result.diff, leftSymbol, rightSymbol, diffConfig],
    );

  const dataTooltipCallback: TooltipCallback<DataTooltipContent> = useCallback(
    (data) => {
      let obj: diff.ObjectDiff | undefined;
      let symbol: number | undefined;
      switch (data.column) {
        case 0:
          obj = result.diff?.left;
          symbol = leftSymbol?.info.id;
          break;
        case 1:
          obj = result.diff?.right;
          symbol = rightSymbol?.info.id;
          break;
        default:
          break;
      }
      if (!obj || symbol === undefined) {
        return null;
      }
      return display.dataHover(obj, symbol, data.row);
    },
    [result.diff, leftSymbol, rightSymbol],
  );

  const [showMappedSymbols, setShowMappedSymbols] = useState<boolean>(false);

  return (
    <>
      <DiffViewHeader
        result={result}
        leftSymbolRef={leftSymbolRef}
        rightSymbolRef={rightSymbolRef}
        leftColumnView={leftColumnView}
        rightColumnView={rightColumnView}
        showMappedSymbols={showMappedSymbols}
        setShowMappedSymbols={setShowMappedSymbols}
      />
      <div className={styles.content}>
        <SymbolContextMenuProvider render={symbolContextMenuRender}>
          <InstructionContextMenuProvider render={instructionContextMenuRender}>
            <DataContextMenuProvider render={dataContextMenuRender}>
              <AutoSizer className={styles.content}>
                {({ height, width }) => (
                  <DiffViewContent
                    result={result}
                    height={height}
                    width={width}
                    leftColumnView={leftColumnView}
                    rightColumnView={rightColumnView}
                    showMappedSymbols={showMappedSymbols}
                    showHiddenSymbols={false} // TODO
                  />
                )}
              </AutoSizer>
            </DataContextMenuProvider>
          </InstructionContextMenuProvider>
        </SymbolContextMenuProvider>
      </div>
      <SymbolTooltip
        place="bottom"
        delayShow={500}
        callback={symbolTooltipCallback}
      />
      <InstructionTooltip
        place="bottom"
        delayShow={500}
        callback={instructionTooltipCallback}
      />
      <DataTooltip
        place="bottom"
        delayShow={500}
        callback={dataTooltipCallback}
      />
    </>
  );
};

const DiffViewHeader = ({
  result,
  leftSymbolRef,
  rightSymbolRef,
  leftColumnView,
  rightColumnView,
  showMappedSymbols,
  setShowMappedSymbols,
}: {
  result: DiffOutput;
  leftSymbolRef: SymbolRefByName | null;
  rightSymbolRef: SymbolRefByName | null;
  leftColumnView: ColumnView;
  rightColumnView: ColumnView;
  showMappedSymbols: boolean;
  setShowMappedSymbols: (value: boolean) => void;
}) => {
  const { buildRunning, currentUnit, hasProjectConfig } = useExtensionStore(
    useShallow((state) => ({
      buildRunning: state.buildRunning,
      currentUnit: state.currentUnit,
      hasProjectConfig: state.projectConfig != null,
    })),
  );
  const currentUnitName = currentUnit?.name || '';
  const {
    search,
    setUnitSectionCollapsed,
    setUnitSearch,
    setCurrentView,
    setSelectedSymbol,
    setUnitMapping,
  } = useAppStore(
    useShallow((state) => {
      const unit = state.getUnitState(currentUnitName);
      return {
        search: unit.search,
        setUnitSectionCollapsed: state.setUnitSectionCollapsed,
        setUnitSearch: state.setUnitSearch,
        setCurrentView: state.setCurrentView,
        setSelectedSymbol: state.setSelectedSymbol,
        setUnitMapping: state.setUnitMapping,
      };
    }),
  );

  const onBackClick = useCallback(() => {
    if (leftSymbolRef || rightSymbolRef) {
      setSelectedSymbol(null, null);
    } else if (hasProjectConfig) {
      setCurrentUnit(null);
    }
  }, [leftSymbolRef, rightSymbolRef, setSelectedSymbol, hasProjectConfig]);

  const setAllSections = (side: Side, value: boolean) => {
    if (side === 'left') {
      if (result.diff?.left) {
        const displaySections = display.displaySections(
          result.diff.left,
          {
            mapping: undefined,
            regex: undefined,
          },
          {
            showHiddenSymbols: false,
            showMappedSymbols: false,
            reverseFnOrder: false,
          },
        );
        for (const section of displaySections) {
          setUnitSectionCollapsed(currentUnitName, section.id, 'left', value);
        }
      }
    } else if (result.diff?.right) {
      const displaySections = display.displaySections(
        result.diff.right,
        {
          mapping: undefined,
          regex: undefined,
        },
        {
          showHiddenSymbols: false,
          showMappedSymbols: false,
          reverseFnOrder: false,
        },
      );
      for (const section of displaySections) {
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

  const onSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setUnitSearch(currentUnitName, e.target.value),
    [currentUnitName, setUnitSearch],
  );

  const onSettingsClick = useCallback(() => {
    setCurrentView('settings');
  }, [setCurrentView]);

  const changeBase = useCallback(() => {
    setUnitMapping(currentUnitName, leftSymbolRef?.symbolName, null);
    setSelectedSymbol(leftSymbolRef, null);
  }, [currentUnitName, leftSymbolRef, setUnitMapping, setSelectedSymbol]);

  const changeTarget = useCallback(() => {
    setUnitMapping(currentUnitName, null, rightSymbolRef?.symbolName);
    setSelectedSymbol(null, rightSymbolRef);
  }, [currentUnitName, rightSymbolRef, setUnitMapping, setSelectedSymbol]);

  const onShowMappedSymbolsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setShowMappedSymbols(e.target.checked),
    [setShowMappedSymbols],
  );

  const showMappedSymbolsInput = (
    <div className={headerStyles.input}>
      <input
        id="showMappedSymbols"
        type="checkbox"
        checked={showMappedSymbols}
        onChange={onShowMappedSymbolsChange}
      />
      <label htmlFor="showMappedSymbols">Show mapped symbols</label>
    </div>
  );

  const filterRow = (
    <input
      type="text"
      placeholder="Filter symbols"
      value={search || ''}
      onChange={onSearchChange}
    />
  );

  if (
    leftColumnView.type !== 'asm' &&
    rightColumnView.type !== 'asm' &&
    leftColumnView.type !== 'data' &&
    rightColumnView.type !== 'data'
  ) {
    const unitNameRow = (
      <span className={clsx(headerStyles.label, headerStyles.emphasized)}>
        {currentUnitName}
      </span>
    );

    const settingsRow = (
      <button title="Settings" onClick={onSettingsClick}>
        <span className="codicon codicon-settings-gear" />
      </button>
    );

    return (
      <div className={headerStyles.header}>
        <div className={headerStyles.column}>
          <div className={headerStyles.row}>
            {hasProjectConfig ? (
              <button
                title="Back"
                onClick={onBackClick}
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
              <button title="Build" onClick={runBuild} disabled={buildRunning}>
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
    );
  }

  const matchPercent =
    leftColumnView.type === 'asm' || leftColumnView.type === 'data'
      ? leftColumnView.symbol.matchPercent
      : undefined;

  return (
    <div className={headerStyles.header}>
      <div className={headerStyles.column}>
        <div className={headerStyles.row}>
          <button title="Back" onClick={onBackClick}>
            <span className="codicon codicon-chevron-left" />
          </button>
        </div>
        <div className={headerStyles.row}>
          <SymbolLabel
            view={leftColumnView}
            side="left"
            isMapping={result.isMapping}
            currentUnitName={currentUnitName}
          />
        </div>
        <div className={headerStyles.row}>
          {result.isMapping ? (
            showMappedSymbolsInput
          ) : (
            <button onClick={changeTarget}>Change target</button>
          )}
        </div>
      </div>
      <div className={headerStyles.column}>
        <div className={headerStyles.row}>
          {hasProjectConfig && (
            <button title="Build" onClick={runBuild} disabled={buildRunning}>
              <span className="codicon codicon-refresh" />
            </button>
          )}
          {result.lastBuilt && (
            <span className={headerStyles.label}>
              Last built:{' '}
              {new Date(result.lastBuilt).toLocaleTimeString('en-US')}
            </span>
          )}
        </div>
        <div className={headerStyles.row}>
          {matchPercent !== undefined && (
            <>
              <span
                className={clsx(headerStyles.label, percentClass(matchPercent))}
              >
                {Math.floor(matchPercent).toFixed(0)}%
              </span>
              {' | '}
            </>
          )}
          <SymbolLabel
            view={rightColumnView}
            side="right"
            isMapping={result.isMapping}
            currentUnitName={currentUnitName}
          />
        </div>
        <div className={headerStyles.row}>
          {result.isMapping ? (
            filterRow
          ) : (
            <button onClick={changeBase}>Change base</button>
          )}
        </div>
      </div>
    </div>
  );
};

const SymbolLabel = ({
  view,
  side,
  isMapping,
  currentUnitName,
}: {
  view: ColumnView;
  side: Side;
  isMapping: boolean;
  currentUnitName: string;
}) => {
  switch (view.type) {
    case 'asm':
    case 'data': {
      const displayName =
        view.symbol.info.demangledName || view.symbol.info.name;
      return (
        <span
          className={clsx(headerStyles.label, headerStyles.emphasized)}
          title={displayName}
        >
          {displayName}
        </span>
      );
    }
    case 'buildStatus':
      return (
        <span className={clsx(headerStyles.label, headerStyles.missing)}>
          Build failed
        </span>
      );
    case 'symbols': {
      if (isMapping) {
        switch (side) {
          case 'left':
            return (
              <span className={clsx(headerStyles.label, headerStyles.missing)}>
                Choose target symbol
              </span>
            );
          case 'right':
            return (
              <span className={clsx(headerStyles.label, headerStyles.missing)}>
                Choose base symbol
              </span>
            );
        }
      }
      return (
        <span
          className={clsx(headerStyles.label, headerStyles.emphasized)}
          title={currentUnitName}
        >
          {currentUnitName}
        </span>
      );
    }
    default:
      return (
        <span className={clsx(headerStyles.label, headerStyles.missing)}>
          Missing
        </span>
      );
  }
};

const DiffViewContent = ({
  result,
  height,
  width,
  leftColumnView,
  rightColumnView,
  showMappedSymbols,
  showHiddenSymbols,
}: {
  result: DiffOutput;
  height: number;
  width: number;
  leftColumnView: ColumnView;
  rightColumnView: ColumnView;
  showMappedSymbols: boolean;
  showHiddenSymbols: boolean;
}) => {
  // Shared symbols view state
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const [hoverSymbols, setHoverSymbols] = useState<
    [number | null, number | null]
  >([null, null]);

  if (leftColumnView.type === 'asm' && rightColumnView.type === 'asm') {
    // Render joint function view
    return (
      <InstructionList
        height={height}
        width={width}
        diff={result.diff!}
        leftSymbol={leftColumnView.symbol}
        rightSymbol={rightColumnView.symbol}
      />
    );
  }

  if (leftColumnView.type === 'data' && rightColumnView.type === 'data') {
    // Render joint data view
    return (
      <DataList
        height={height}
        width={width}
        diff={result.diff!}
        leftSymbol={leftColumnView.symbol}
        rightSymbol={rightColumnView.symbol}
      />
    );
  }

  let leftColumn = null;
  let rightColumn = null;
  if (leftColumnView.type === 'symbols') {
    leftColumn = (
      <SymbolList
        height={height}
        width={width / 2}
        side="left"
        result={result}
        mappingSymbol={leftColumnView.mappingSymbol}
        showMappedSymbols={showMappedSymbols}
        showHiddenSymbols={showHiddenSymbols}
        highlightedPath={highlightedPath}
        setHighlightedPath={setHighlightedPath}
        hoverSymbols={hoverSymbols}
        setHoverSymbols={setHoverSymbols}
      />
    );
  } else if (leftColumnView.type === 'asm') {
    leftColumn = (
      <InstructionList
        height={height}
        width={width / 2}
        diff={result.diff!}
        leftSymbol={leftColumnView.symbol}
        rightSymbol={null}
      />
    );
  } else if (leftColumnView.type === 'data') {
    leftColumn = (
      <DataList
        height={height}
        width={width / 2}
        diff={result.diff!}
        leftSymbol={leftColumnView.symbol}
        rightSymbol={null}
      />
    );
  } else if (leftColumnView.type === 'buildStatus') {
    leftColumn = (
      <BuildStatusView
        height={height}
        width={width / 2}
        status={leftColumnView.status}
      />
    );
  } else if (leftColumnView.type === 'none') {
    leftColumn = <NoObjectView height={height} width={width / 2} />;
  }

  if (rightColumnView.type === 'symbols') {
    rightColumn = (
      <SymbolList
        height={height}
        width={width / 2}
        side="right"
        result={result}
        mappingSymbol={rightColumnView.mappingSymbol}
        showMappedSymbols={showMappedSymbols}
        showHiddenSymbols={showHiddenSymbols}
        highlightedPath={highlightedPath}
        setHighlightedPath={setHighlightedPath}
        hoverSymbols={hoverSymbols}
        setHoverSymbols={setHoverSymbols}
      />
    );
  } else if (rightColumnView.type === 'asm') {
    rightColumn = (
      <InstructionList
        height={height}
        width={width / 2}
        diff={result.diff!}
        leftSymbol={null}
        rightSymbol={rightColumnView.symbol}
      />
    );
  } else if (rightColumnView.type === 'data') {
    rightColumn = (
      <DataList
        height={height}
        width={width / 2}
        diff={result.diff!}
        leftSymbol={null}
        rightSymbol={rightColumnView.symbol}
      />
    );
  } else if (rightColumnView.type === 'buildStatus') {
    rightColumn = (
      <BuildStatusView
        height={height}
        width={width / 2}
        status={rightColumnView.status}
      />
    );
  } else if (rightColumnView.type === 'none') {
    rightColumn = <NoObjectView height={height} width={width / 2} />;
  }

  return (
    <>
      {leftColumn}
      {rightColumn}
    </>
  );
};

const NoObjectView = ({
  height,
  width,
}: {
  height: number;
  width: number;
}) => (
  <div
    className={clsx(styles.column, styles.noObject)}
    style={{ height, width }}
  >
    No object configured
  </div>
);

const BuildStatusView = ({
  status,
  height,
  width,
}: {
  status: BuildStatus;
  height: number;
  width: number;
}) => (
  <div
    className={clsx(styles.column, styles.noObject)}
    style={{ height, width }}
  >
    <pre>{status.cmdline}</pre>
    <pre>{status.stdout}</pre>
    <pre>{status.stderr}</pre>
  </div>
);

export default DiffView;
