import './App.css';

import type { diff } from 'objdiff-wasm';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDiff } from './diff';
import { useAppStore, useExtensionStore } from './state';
import DiffView from './views/DiffView';
import SettingsView from './views/SettingsView';
import UnitsView from './views/UnitsView';

const App = () => {
  const {
    buildRunning,
    configProperties,
    currentUnit,
    leftStatus,
    rightStatus,
    leftObject,
    rightObject,
    config,
    ready,
  } = useExtensionStore(
    useShallow((state) => ({
      buildRunning: state.buildRunning,
      configProperties: state.configProperties,
      currentUnit: state.currentUnit,
      leftStatus: state.leftStatus,
      rightStatus: state.rightStatus,
      leftObject: state.leftObject,
      rightObject: state.rightObject,
      config: state.projectConfig,
      ready: state.ready,
    })),
  );
  const { leftSymbolRef, rightSymbolRef, currentView, mappings } = useAppStore(
    useShallow((state) => {
      const unitState = state.getUnitState(currentUnit?.name ?? '');
      return {
        leftSymbolRef: state.leftSymbol,
        rightSymbolRef: state.rightSymbol,
        currentView: state.currentView,
        mappings: unitState?.mappings,
      };
    }),
  );
  const mappingConfig = useMemo(() => {
    const result: diff.MappingConfig = {
      mappings: mappings == null ? [] : Object.entries(mappings),
      selectingLeft: undefined,
      selectingRight: undefined,
    };
    if (leftSymbolRef && !rightSymbolRef) {
      result.selectingRight = leftSymbolRef.symbolName;
      result.mappings = result.mappings.filter(
        ([left, _]) => left !== leftSymbolRef.symbolName,
      );
    }
    if (!leftSymbolRef && rightSymbolRef) {
      result.selectingLeft = rightSymbolRef.symbolName;
      result.mappings = result.mappings.filter(
        ([_, right]) => right !== rightSymbolRef.symbolName,
      );
    }
    return result;
  }, [leftSymbolRef, rightSymbolRef, mappings]);
  const result = useDiff({
    leftStatus,
    rightStatus,
    leftObject,
    rightObject,
    configProperties,
    mappingConfig,
  });

  if (!ready) {
    // Uses panel background color to avoid flashing
    return <div className="loading-root" />;
  }

  switch (currentView) {
    case 'main':
      if (
        result.leftStatus ||
        result.rightStatus ||
        result.diff.left ||
        result.diff.right
      ) {
        return (
          <DiffView
            result={result}
            leftSymbolRef={leftSymbolRef}
            rightSymbolRef={rightSymbolRef}
          />
        );
      }

      if (buildRunning) {
        return (
          <div className="content">
            <p>Building...</p>
          </div>
        );
      }
      return config ? (
        <UnitsView />
      ) : (
        <div className="content">
          <h1>objdiff</h1>
          <p>No configuration loaded.</p>
        </div>
      );
    case 'settings':
      return <SettingsView />;
    default:
      return null;
  }
};

export default App;
