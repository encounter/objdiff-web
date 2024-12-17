import type { WebviewApi } from 'vscode-webview';
import { create } from 'zustand';
import { DiffKind, DiffResult } from '../gen/diff_pb';

export type SymbolRefByName = {
  symbol_name: string;
  section_name: string | null;
};

export interface AppState {
  selectedSymbol: SymbolRefByName | null;
  setSelectedSymbol: (selectedSymbol: SymbolRefByName | null) => void;
}
export const useAppStore = create<AppState>((set) => ({
  selectedSymbol: null,
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
}));

export type DiffState = {
  diff?: DiffResult;
};
export const useDiffStore = create<DiffState>(() => ({}));

let vscode: WebviewApi<DiffState>;
if (typeof acquireVsCodeApi === 'function') {
  vscode = acquireVsCodeApi<DiffState>();
} else {
  let state: DiffState | undefined;
  vscode = {
    postMessage: () => {},
    getState: () => state,
    setState: (newState) => {
      state = newState;
      return newState;
    },
  };
}
vscode.postMessage({ type: 'ready' });

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message && typeof message === 'object') {
    console.log('Received message', message);
    if (message.type === 'diff') {
      const diff = DiffResult.fromBinary(new Uint8Array(message.data));

      const lineRanges = [];
      for (const section of diff.right?.sections || []) {
        for (const fn of section.functions) {
          let currentRange: { start: number; end: number } | null = null;
          for (const ins of fn.instructions) {
            let lineNumber = ins.instruction?.line_number;
            if (lineNumber == null) {
              continue;
            }
            lineNumber = lineNumber - 1;
            if (ins.diff_kind !== DiffKind.DIFF_NONE) {
              if (currentRange !== null) {
                currentRange.end = lineNumber;
              } else {
                currentRange = {
                  start: lineNumber,
                  end: lineNumber,
                };
              }
            } else if (currentRange !== null && lineNumber > currentRange.end) {
              lineRanges.push(currentRange);
              currentRange = null;
            }
          }
          if (currentRange !== null) {
            lineRanges.push(currentRange);
          }
        }
      }
      console.log('lineRanges', lineRanges);
      vscode.postMessage({ type: 'lineRanges', data: lineRanges });

      useDiffStore.setState({ diff });
    }
  }
});
