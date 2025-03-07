import './App.css';

import type { diff, display } from 'objdiff-wasm';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, useExtensionStore } from './state';
import type { SymbolRefByName } from './state';
import FunctionView from './views/FunctionView';
import SettingsView from './views/SettingsView';
import SymbolsView from './views/SymbolsView';
import UnitsView from './views/UnitsView';

const findSymbol = (
  obj: diff.ObjectDiff | undefined,
  symbolRef: SymbolRefByName | null,
): display.SectionDisplaySymbol | null => {
  if (!obj || !symbolRef) {
    return null;
  }
  const idx = obj.findSymbol(
    symbolRef.symbolName,
    symbolRef.sectionName ?? undefined,
  );
  if (idx !== undefined) {
    return {
      symbol: idx,
      isMappingSymbol: false,
    };
  }
  return null;
};

const App = () => {
  const { buildRunning, result, config, ready } = useExtensionStore(
    useShallow((state) => ({
      buildRunning: state.buildRunning,
      result: state.result,
      config: state.projectConfig,
      ready: state.ready,
    })),
  );
  const { leftSymbolRef, rightSymbolRef, currentView } = useAppStore(
    useShallow((state) => ({
      leftSymbolRef: state.leftSymbol,
      rightSymbolRef: state.rightSymbol,
      currentView: state.currentView,
    })),
  );

  if (!ready) {
    // Uses panel background color to avoid flashing
    return <div className="loading-root" />;
  }

  switch (currentView) {
    case 'main':
      if (result) {
        const leftSymbol = findSymbol(result.left, leftSymbolRef);
        const rightSymbol = findSymbol(result.right, rightSymbolRef);
        if (leftSymbol || rightSymbol) {
          return (
            <FunctionView diff={result} left={leftSymbol} right={rightSymbol} />
          );
        }
        return <SymbolsView diff={result} />;
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
