import { create } from 'zustand/react';
import type {
  ConfigProperties,
  ConfigPropertyValue,
  ProjectConfig,
  Unit,
} from '../shared/config';
import { DiffResult } from '../shared/gen/diff_pb';
import type { SetCurrentUnitMessage } from '../shared/messages';
import type { InboundMessage, OutboundMessage } from '../shared/messages';
import {
  type HighlightState,
  deserializeHighlightState,
  serializeHighlightState,
} from './highlight';
import { mockVsCode } from './mock';

export type SymbolRefByName = {
  symbol_name: string;
  section_name: string | null;
};

export type UnitScrollOffsets = {
  left: number;
  right: number;
};
export type UnitCollapsedSections = {
  left: Record<string, boolean>;
  right: Record<string, boolean>;
};

export type UnitState = {
  scrollOffsets: UnitScrollOffsets;
  symbolScrollOffsets: Record<string, number>;
  collapsedSections: UnitCollapsedSections;
  search: string | null;
};
const defaultUnitState: UnitState = {
  scrollOffsets: { left: 0, right: 0 },
  symbolScrollOffsets: {},
  collapsedSections: {
    left: {},
    right: {},
  },
  search: null,
};

export type CurrentView = 'main' | 'settings';
export interface AppState {
  selectedSymbol: SymbolRefByName | null;
  unitsScrollOffset: number;
  unitStates: Record<string, UnitState>;
  highlight: HighlightState;
  currentView: CurrentView;
  collapsedUnits: Record<string, boolean>;

  getUnitState(unit: string): UnitState;
  setSelectedSymbol: (selectedSymbol: SymbolRefByName | null) => void;
  setSymbolScrollOffset: (
    unit: string,
    symbolName: string,
    offset: number,
  ) => void;
  setUnitScrollOffset: (
    unit: string,
    side: keyof UnitScrollOffsets,
    offset: number,
  ) => void;
  setUnitSectionCollapsed: (
    unit: string,
    section: string,
    side: keyof UnitCollapsedSections,
    collapsed: boolean,
  ) => void;
  setUnitSearch: (unit: string, search: string | null) => void;
  setUnitsScrollOffset: (offset: number) => void;
  setHighlight: (highlight: HighlightState) => void;
  setCurrentView: (view: CurrentView) => void;
  setCollapsedUnit: (unit: string, collapsed: boolean) => void;
}
export const useAppStore = create<AppState>((set) => {
  const setUnitState = (
    unit: string,
    updater: (state: UnitState) => UnitState,
  ) =>
    set((state) => {
      const existing = state.unitStates[unit] ?? defaultUnitState;
      return {
        unitStates: {
          ...state.unitStates,
          [unit]: updater(existing),
        },
      };
    });

  return {
    selectedSymbol: null,
    unitsScrollOffset: 0,
    unitStates: {},
    highlight: {
      left: null,
      right: null,
    },
    currentView: 'main',
    collapsedUnits: {},

    getUnitState(unit) {
      return this.unitStates[unit] ?? defaultUnitState;
    },
    setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
    setSymbolScrollOffset: (unit, symbolName, offset) =>
      setUnitState(unit, (state) => ({
        ...state,
        symbolScrollOffsets: {
          ...state.symbolScrollOffsets,
          [symbolName]: offset,
        },
      })),
    setUnitScrollOffset: (unit, side, offset) =>
      setUnitState(unit, (state) => ({
        ...state,
        scrollOffsets: {
          ...state.scrollOffsets,
          [side]: offset,
        },
      })),
    setUnitSectionCollapsed: (unit, section, side, collapsed) =>
      setUnitState(unit, (state) => ({
        ...state,
        collapsedSections: {
          ...state.collapsedSections,
          [side]: {
            ...state.collapsedSections[side],
            [section]: collapsed,
          },
        },
      })),
    setUnitSearch: (unit, search) =>
      setUnitState(unit, (state) => ({
        ...state,
        search,
      })),
    setUnitsScrollOffset: (offset) => set({ unitsScrollOffset: offset }),
    setHighlight: (highlight: HighlightState) => set({ highlight }),
    setCurrentView: (currentView) => set({ currentView }),
    setCollapsedUnit: (unit, collapsed) =>
      set((state) => ({
        collapsedUnits: {
          ...state.collapsedUnits,
          [unit]: collapsed,
        },
      })),
  };
});

export type ExtensionState = {
  buildRunning: boolean;
  configProperties: ConfigProperties;
  currentUnit: Unit | null;
  diff: DiffResult | null;
  lastBuilt: number | null;
  projectConfig: ProjectConfig | null;
  ready: boolean;
};
export const useExtensionStore = create<ExtensionState>(() => ({
  buildRunning: false,
  configProperties: {},
  currentUnit: null,
  currentView: 'main',
  diff: null,
  lastBuilt: null,
  projectConfig: null,
  ready: false,
}));

// Copy of vscode.WebviewApi with concrete message types
export interface MyWebviewApi<StateType> {
  postMessage(message: OutboundMessage): void;
  getState(): StateType | undefined;
  setState<T extends StateType | undefined>(newState: T): T;
}

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
export type JSONCompatible<T> = {
  [P in keyof T as T[P] extends JSONValue ? P : never]: JSONCompatible<T[P]>;
};
export type AppStateSerialized = JSONCompatible<AppState> & {
  highlight: ReturnType<typeof serializeHighlightState>;
};
let vsCode: MyWebviewApi<AppStateSerialized>;
let inVsCode = false;
if (typeof acquireVsCodeApi === 'function') {
  vsCode = acquireVsCodeApi<AppStateSerialized>();
  inVsCode = true;
} else {
  vsCode = mockVsCode;
}
const storedState = vsCode.getState();
if (storedState) {
  useAppStore.setState({
    ...storedState,
    highlight: deserializeHighlightState(storedState.highlight),
  });
}
let timeoutId: ReturnType<typeof setTimeout> | undefined;
useAppStore.subscribe((state) => {
  // Debounce state updates
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  timeoutId = setTimeout(() => {
    const serialized: Partial<AppStateSerialized> = {};
    for (const key in state) {
      const k = key as keyof AppState;
      if (k === 'highlight') {
        serialized.highlight = serializeHighlightState(state.highlight);
      } else if (
        k !== 'getUnitState' &&
        k !== 'setSelectedSymbol' &&
        k !== 'setSymbolScrollOffset' &&
        k !== 'setUnitScrollOffset' &&
        k !== 'setUnitSectionCollapsed' &&
        k !== 'setUnitSearch' &&
        k !== 'setUnitsScrollOffset' &&
        k !== 'setHighlight' &&
        k !== 'setCurrentView' &&
        k !== 'setCollapsedUnit'
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: ignore
        serialized[k] = state[k] as any;
      }
    }
    vsCode.setState(serialized as AppStateSerialized);
    timeoutId = undefined;
  }, 100);
});
vsCode.postMessage({ type: 'ready' });
export { vsCode as vscode };

export function runBuild(): void {
  vsCode.postMessage({ type: 'runTask', taskType: 'build' });
}

export function setCurrentUnit(unit: SetCurrentUnitMessage['unit']): void {
  vsCode.postMessage({ type: 'setCurrentUnit', unit });
}

export function setConfigProperty(
  id: string,
  value: ConfigPropertyValue | undefined,
): void {
  vsCode.postMessage({ type: 'setConfigProperty', id, value });
}

export function quickPickUnit(): void {
  vsCode.postMessage({ type: 'quickPickUnit' });
}

export function openSettings(): void {
  vsCode.postMessage({ type: 'openSettings' });
}

window.addEventListener('message', (event) => {
  const message = event.data as InboundMessage;
  if (message.type === 'state') {
    let diff: DiffResult | null | undefined;
    if (message.data !== undefined) {
      if (message.data) {
        const start = performance.now();
        diff = DiffResult.fromBinary(new Uint8Array(message.data));
        const end = performance.now();
        console.debug('Diff deserialization time:', end - start, 'ms');
      } else {
        diff = null;
      }
    }
    const newState: Partial<ExtensionState> = {
      ...message,
      diff,
      ready: true,
    };
    if (diff) {
      newState.lastBuilt = Date.now();
    }
    for (const k in newState) {
      const key = k as keyof typeof newState;
      if (newState[key] === undefined) {
        delete newState[key];
      }
    }
    useExtensionStore.setState(newState);
  } else if (inVsCode) {
    console.error('Unknown message', message);
  }
});

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
