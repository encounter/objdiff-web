import './App.css';

import { SectionKind } from '../shared/gen/diff_pb';
import type {
  Symbol as DiffSymbol,
  ObjectDiff,
  SymbolDiff,
} from '../shared/gen/diff_pb';
import FunctionView from './FunctionView';
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
  const { diff } = useExtensionStore();
  const selectedSymbolRef = useAppStore((state) => state.selectedSymbol);
  const config = useExtensionStore((state) => state.config);

  if (diff) {
    const leftSymbol = findSymbol(diff.left, selectedSymbolRef);
    const rightSymbol = findSymbol(diff.right, selectedSymbolRef);
    if (leftSymbol || rightSymbol) {
      return <FunctionView left={leftSymbol} right={rightSymbol} />;
    }
    return <SymbolsView diff={diff} />;
  }

  return config ? (
    <UnitsView />
  ) : (
    <div className="content">
      <h1>objdiff</h1>
      <p>No configuration loaded.</p>
    </div>
  );
};

export default App;
