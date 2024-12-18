import headerStyles from './Header.module.css';
import styles from './SymbolsView.module.css';

import {
  type DiffResult,
  type Symbol as DiffSymbol,
  type ObjectDiff,
  SymbolFlag,
} from '../shared/gen/diff_pb';
import { useAppStore, useExtensionStore, vscode } from './state';

const SymbolsList = ({ obj }: { obj: ObjectDiff }) => {
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);
  const items = [];
  let sectionIndex = 0;
  for (const section of obj.sections) {
    const sectionKey = `section-${sectionIndex++}`;
    let percentElem = null;
    if (section.match_percent != null) {
      let className = styles.percent0;
      if (section.match_percent === 100) {
        className = styles.percent100;
      } else if (section.match_percent >= 50) {
        className = styles.percent50;
      }
      percentElem = (
        <>
          {' ('}
          <span className={className}>
            {Math.floor(section.match_percent).toFixed(0)}%
          </span>
          {')'}
        </>
      );
    }
    items.push(
      <li key={sectionKey} className={styles.section}>
        {section.name} ({section.size.toString(16)}){percentElem}
      </li>,
    );
    for (const diff of section.symbols) {
      const symbol = diff.symbol as DiffSymbol;
      const flags = [];
      if (symbol.flags & SymbolFlag.SYMBOL_GLOBAL) {
        flags.push(
          <span key="g" className={styles.flagGlobal}>
            g
          </span>,
        );
      }
      if (symbol.flags & SymbolFlag.SYMBOL_WEAK) {
        flags.push(
          <span key="w" className={styles.flagWeak}>
            w
          </span>,
        );
      }
      if (symbol.flags & SymbolFlag.SYMBOL_LOCAL) {
        flags.push(
          <span key="l" className={styles.flagLocal}>
            l
          </span>,
        );
      }
      if (symbol.flags & SymbolFlag.SYMBOL_COMMON) {
        flags.push(
          <span key="c" className={styles.flagCommon}>
            c
          </span>,
        );
      }
      let flagsElem = null;
      if (flags.length > 0) {
        flagsElem = <>[{flags}] </>;
      }
      let percentElem = null;
      if (diff.match_percent != null) {
        let className = styles.percent0;
        if (diff.match_percent === 100) {
          className = styles.percent100;
        } else if (diff.match_percent >= 50) {
          className = styles.percent50;
        }
        percentElem = (
          <>
            {'('}
            <span className={className}>
              {Math.floor(diff.match_percent).toFixed(0)}%
            </span>
            {') '}
          </>
        );
      }
      items.push(
        <li
          key={`${sectionKey}-${symbol.name}`}
          className={styles.symbol}
          onClick={() => {
            setSelectedSymbol({
              symbol_name: symbol.name,
              section_name: section.name,
            });
          }}
          data-vscode-context={JSON.stringify({
            contextType: 'symbol',
            preventDefaultContextMenuItems: true,
            symbolName: symbol.name,
            symbolDemangledName: symbol.demangled_name,
          })}
        >
          {flagsElem}
          {percentElem}
          <span className={styles.symbolName}>
            {symbol.demangled_name || symbol.name}
          </span>
        </li>,
      );
    }
  }
  return <ul className={styles.symbolList}>{items}</ul>;
};

const SymbolsView = ({ diff }: { diff: DiffResult }) => {
  const buildRunning = useExtensionStore((state) => state.buildRunning);
  const currentFile = useExtensionStore((state) => state.currentFile);
  return (
    <>
      <div className={headerStyles.header}>
        <button
          onClick={() =>
            vscode.postMessage({ type: 'runTask', taskType: 'build' })
          }
          disabled={buildRunning}
        >
          Build
        </button>
        {buildRunning ? <span>Building...</span> : <span>{currentFile}</span>}
      </div>
      <div className={styles.symbols}>
        {diff.left && <SymbolsList obj={diff.left} />}
        {diff.right && <SymbolsList obj={diff.right} />}
      </div>
    </>
  );
};

export default SymbolsView;
