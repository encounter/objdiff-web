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
    configError,
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
      configError: state.configError,
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
      if (config) {
        return <UnitsView />;
      }
      return (
        <div className="content">
          <h1>objdiff</h1>
          {configError ? (
            <>
              <p>Couldn't load the project configuration.</p>
              <pre className="error">{configError}</pre>
              <p>
                The dev server looks for <code>objdiff.json</code> in{' '}
                <code>OBJDIFF_PROJECT_ROOT</code> (defaults to{' '}
                <code>../prime</code>). Point it at your decomp project and
                restart:
              </p>
              <pre>OBJDIFF_PROJECT_ROOT=/path/to/project pnpm web:dev</pre>
            </>
          ) : (
            <p>No configuration loaded.</p>
          )}
        </div>
      );
    case 'settings':
      return <SettingsView />;
    default:
      return null;
  }
};

export default App;
