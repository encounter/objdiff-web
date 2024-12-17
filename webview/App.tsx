import './App.css';

import { SectionKind } from '../gen/diff_pb';
import type {
  Symbol as DiffSymbol,
  FunctionDiff,
  ObjectDiff,
} from '../gen/diff_pb';
import FunctionView from './FunctionView';
import SymbolsView from './SymbolsView';
import { useAppStore, useDiffStore } from './state';
import type { SymbolRefByName } from './state';

const findSymbol = (
  obj: ObjectDiff | undefined,
  symbolRef: SymbolRefByName | null,
): FunctionDiff | null => {
  if (!obj || !symbolRef) {
    return null;
  }
  for (const section of obj.sections) {
    if (section.name === symbolRef.section_name) {
      if (section.kind === SectionKind.SECTION_TEXT) {
        for (const fn of section.functions) {
          const symbol = fn.symbol as DiffSymbol;
          if (symbol.name === symbolRef.symbol_name) {
            return fn;
          }
        }
      }
    }
  }
  return null;
};

const App = () => {
  const { diff } = useDiffStore();
  const selectedSymbolRef = useAppStore((state) => state.selectedSymbol);

  if (diff) {
    const object = diff.left || diff.right || { sections: [] };
    const leftSymbol = findSymbol(diff.left, selectedSymbolRef);
    const rightSymbol = findSymbol(diff.right, selectedSymbolRef);
    if (leftSymbol || rightSymbol) {
      return <FunctionView left={leftSymbol} right={rightSymbol} />;
    }
    return <SymbolsView obj={object} />;
  }

  return (
    <div className="content">
      <h1>objdiff</h1>
      <p>Coming soon to a VS Code near you.</p>
    </div>
  );
};

export default App;
