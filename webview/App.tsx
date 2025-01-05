import './App.css';

import { useShallow } from 'zustand/react/shallow';
import { SectionKind } from '../shared/gen/diff_pb';
import type {
  Symbol as DiffSymbol,
  ObjectDiff,
  SymbolDiff,
} from '../shared/gen/diff_pb';
import FunctionView from './FunctionView';
import SettingsView from './SettingsView';
import SymbolsView from './SymbolsView';
import UnitsView from './UnitsView';
import { useAppStore, useExtensionStore } from './state';
import type { SymbolRefByName } from './state';

const findSymbol = (
  obj: ObjectDiff | undefined,
  symbolRef: SymbolRefByName | null,
): SymbolDiff | null => {
  if (!obj || !symbolRef) {
    return null;
  }
  for (const section of obj.sections) {
    if (section.name === symbolRef.section_name) {
      if (section.kind === SectionKind.SECTION_TEXT) {
        for (const diff of section.symbols) {
          const symbol = diff.symbol as DiffSymbol;
          if (symbol.name === symbolRef.symbol_name) {
            return diff;
          }
        }
      }
    }
  }
  return null;
};

const App = () => {
  const { buildRunning, diff, config, ready } = useExtensionStore(
    useShallow((state) => ({
      buildRunning: state.buildRunning,
      diff: state.diff,
      config: state.projectConfig,
      ready: state.ready,
    })),
  );
  const { selectedSymbolRef, currentView } = useAppStore(
    useShallow((state) => ({
      selectedSymbolRef: state.selectedSymbol,
      currentView: state.currentView,
    })),
  );

  if (!ready) {
    // Uses panel background color to avoid flashing
    return <div className="loading-root" />;
  }

  if (diff) {
    const leftSymbol = findSymbol(diff.left, selectedSymbolRef);
    const rightSymbol = findSymbol(diff.right, selectedSymbolRef);
    if (leftSymbol || rightSymbol) {
      return <FunctionView left={leftSymbol} right={rightSymbol} />;
    }
    return <SymbolsView diff={diff} />;
  }

  switch (currentView) {
    case 'main':
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
