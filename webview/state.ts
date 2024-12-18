import { create } from 'zustand';
import { DiffResult } from '../shared/gen/diff_pb';
import type { InboundMessage, OutboundMessage } from '../shared/messages';

export type SymbolRefByName = {
  symbol_name: string;
  section_name: string | null;
};

export interface AppState {
  selectedSymbol: SymbolRefByName | null;
  symbolScrollOffsets: Record<string, number>;
  setSelectedSymbol: (selectedSymbol: SymbolRefByName | null) => void;
  setSymbolScrollOffset: (symbolName: string, offset: number) => void;
}
export const useAppStore = create<AppState>((set) => ({
  selectedSymbol: null,
  symbolScrollOffsets: {},
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
  setSymbolScrollOffset: (symbolName, offset) =>
    set((state) => ({
      symbolScrollOffsets: {
        ...state.symbolScrollOffsets,
        [symbolName]: offset,
      },
    })),
}));

export type ExtensionState = {
  diff: DiffResult | null;
  buildRunning: boolean;
  configLoaded: boolean;
  currentFile: string | null;
};
export const useExtensionStore = create<ExtensionState>(() => ({
  diff: null,
  buildRunning: false,
  configLoaded: false,
  currentFile: null,
}));

// Copy of vscode.WebviewApi with concrete message types
export interface MyWebviewApi<StateType> {
  postMessage(message: OutboundMessage): void;
  getState(): StateType | undefined;
  setState<T extends StateType | undefined>(newState: T): T;
}

let vscode: MyWebviewApi<AppState>;
if (typeof acquireVsCodeApi === 'function') {
  vscode = acquireVsCodeApi<AppState>();
} else {
  let state: AppState | undefined;
  vscode = {
    postMessage: () => {},
    getState: () => state,
    setState: (newState) => {
      state = newState;
      return newState;
    },
  };
}
const storedState = vscode.getState();
if (storedState) {
  useAppStore.setState(storedState);
}
let timeoutId: ReturnType<typeof setTimeout> | undefined;
useAppStore.subscribe((state) => {
  // Debounce state updates
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  timeoutId = setTimeout(() => {
    vscode.setState(state);
    timeoutId = undefined;
  }, 100);
});
vscode.postMessage({ type: 'ready' });
export { vscode };

window.addEventListener('message', (event) => {
  const message = event.data as InboundMessage;
  if (message.type === 'diff') {
    const start = performance.now();
    const diff = DiffResult.fromBinary(new Uint8Array(message.data));
    const end = performance.now();
    console.debug('Diff deserialization time:', end - start, 'ms');

    // const lineRanges = [];
    // for (const section of diff.right?.sections || []) {
    //   for (const diff of section.symbols) {
    //     let currentRange: { start: number; end: number } | null = null;
    //     for (const ins of diff.instructions) {
    //       let lineNumber = ins.instruction?.line_number;
    //       if (lineNumber == null) {
    //         continue;
    //       }
    //       lineNumber = lineNumber - 1;
    //       if (ins.diff_kind !== DiffKind.DIFF_NONE) {
    //         if (currentRange !== null) {
    //           currentRange.end = lineNumber;
    //         } else {
    //           currentRange = {
    //             start: lineNumber,
    //             end: lineNumber,
    //           };
    //         }
    //       } else if (currentRange !== null && lineNumber > currentRange.end) {
    //         lineRanges.push(currentRange);
    //         currentRange = null;
    //       }
    //     }
    //     if (currentRange !== null) {
    //       lineRanges.push(currentRange);
    //     }
    //   }
    // }
    // console.log('lineRanges', lineRanges);
    // vscode.postMessage({ type: 'lineRanges', data: lineRanges });

    useExtensionStore.setState({ diff });
  } else if (message.type === 'task') {
    if (message.taskType === 'build') {
      useExtensionStore.setState({ buildRunning: message.running });
    } else {
      console.error('Unknown task type', message.taskType);
    }
  } else if (message.type === 'state') {
    useExtensionStore.setState({
      configLoaded: message.configLoaded,
      currentFile: message.currentFile,
    });
  } else {
    console.error('Unknown message', message);
  }
});
