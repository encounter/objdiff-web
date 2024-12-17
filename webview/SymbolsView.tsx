import styles from './SymbolsView.module.css';

import { SectionKind } from '../gen/diff_pb';
import type { Symbol as DiffSymbol, ObjectDiff } from '../gen/diff_pb';
import { useAppStore } from './state';

const SymbolsView = ({ obj }: { obj: ObjectDiff }) => {
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);

  const items = [];
  for (const section of obj.sections) {
    items.push(
      <li key={section.name} className={styles.section}>
        {section.name}
      </li>,
    );
    if (section.kind === SectionKind.SECTION_TEXT) {
      for (const fn of section.functions) {
        const symbol = fn.symbol as DiffSymbol;
        items.push(
          <li
            key={symbol.name}
            className={styles.symbol}
            onClick={() => {
              setSelectedSymbol({
                symbol_name: symbol.name,
                section_name: section.name,
              });
            }}
          >
            {symbol.name}
          </li>,
        );
      }
    } else {
      // TODO
    }
  }
  return <ul className={styles.symbolList}>{items}</ul>;
};

export default SymbolsView;
