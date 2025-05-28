import { diff } from 'objdiff-wasm';
import { subscribeWithSelector } from 'zustand/middleware';
import { create } from 'zustand/react';
import { shallow } from 'zustand/shallow';
import {
  type ConfigProperties,
  type ConfigPropertyValue,
  type ProjectConfig,
  type Unit,
  getModifiedConfigProperties,
} from '../shared/config';
import type { BuildStatus, SetCurrentUnitMessage } from '../shared/messages';
import type { InboundMessage, OutboundMessage } from '../shared/messages';
import { mockVsCode } from './mock';
import {
  type HighlightState,
  deserializeHighlightState,
  serializeHighlightState,
} from './util/highlight';

// Callbacks for hot module replacement (HMR)
const subscriptions: (() => void)[] = [];
if (module.hot) {
  module.hot.addDisposeHandler(() => {
    for (const d of subscriptions) {
      d();
    }
  });
}

export type SymbolRefByName = {
  symbolName: string;
  sectionName: string | null;
};

export type Side = 'left' | 'right';
export type UnitScrollOffsets = { [key in Side]: number };
export type UnitCollapsedSections = { [key in Side]: Record<string, boolean> };

export type UnitState = {
  scrollOffsets: UnitScrollOffsets;
  symbolScrollOffsets: Record<string, number>;
  collapsedSections: UnitCollapsedSections;
  search: string | null;
  mappings: Record<string, string>;
};
const defaultUnitState: UnitState = {
  scrollOffsets: { left: 0, right: 0 },
  symbolScrollOffsets: {},
  collapsedSections: {
    left: {},
    right: {},
  },
  search: null,
  mappings: {},
};

export type CurrentView = 'main' | 'settings';
export interface AppState {
  leftSymbol: SymbolRefByName | null;
  rightSymbol: SymbolRefByName | null;
  unitsScrollOffset: number;
  unitStates: Record<string, UnitState>;
  highlight: HighlightState;
  currentView: CurrentView;
  collapsedUnits: Record<string, boolean>;

  getUnitState(unit: string | null | undefined): UnitState;
  setSelectedSymbol: (
    leftSymbol: SymbolRefByName | null,
    rightSymbol: SymbolRefByName | null,
  ) => void;
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
  setUnitMapping: (
    unit: string,
    left: string | null | undefined,
    right: string | null | undefined,
  ) => void;
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
    leftSymbol: null,
    rightSymbol: null,
    unitsScrollOffset: 0,
    unitStates: {},
    highlight: {
      left: null,
      right: null,
    },
    currentView: 'main',
    collapsedUnits: {},

    getUnitState(unit) {
      return unit == null
        ? defaultUnitState
        : (this.unitStates[unit] ?? defaultUnitState);
    },
    setSelectedSymbol: (leftSymbol, rightSymbol) =>
      set({ leftSymbol, rightSymbol }),
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
    setUnitMapping: (unit, left, right) =>
      setUnitState(unit, (state) => {
        const newMappings = Object.fromEntries(
          Object.entries(state.mappings || {}).filter(
            ([k, v]) =>
              (left == null || k !== left) && (right == null || v !== right),
          ),
        );
        if (left != null && right != null && left !== right) {
          // Only add new mapping if both sides are defined and different
          newMappings[left] = right;
        }
        return {
          ...state,
          mappings: newMappings,
        };
      }),
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
  leftStatus: BuildStatus | null;
  rightStatus: BuildStatus | null;
  leftObject: ArrayBuffer | null;
  rightObject: ArrayBuffer | null;
  projectConfig: ProjectConfig | null;
  diffLabel: string | null;
  ready: boolean;
};
export const useExtensionStore = create(
  subscribeWithSelector<ExtensionState>((set) => ({
    buildRunning: false,
    configProperties: {},
    currentUnit: null,
    currentView: 'main',
    leftStatus: null,
    rightStatus: null,
    leftObject: null,
    rightObject: null,
    projectConfig: null,
    diffLabel: null,
    ready: false,
  })),
);

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
export let inVsCode = false;
if (typeof acquireVsCodeApi === 'function') {
  vsCode = acquireVsCodeApi<AppStateSerialized>();
  inVsCode = true;
} else {
  vsCode = mockVsCode;
}
export { vsCode as vscode };

// Restore serialized state
const storedState = vsCode.getState();
if (storedState) {
  useAppStore.setState({
    ...storedState,
    highlight: deserializeHighlightState(storedState.highlight),
  });
}

// Serialize state on changes
let timeoutId: ReturnType<typeof setTimeout> | undefined;
subscriptions.push(
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
          k !== 'setCollapsedUnit' &&
          k !== 'setUnitMapping'
        ) {
          serialized[k] = state[k] as any;
        }
      }
      vsCode.setState(serialized as AppStateSerialized);
      timeoutId = undefined;
    }, 100);
  }),
);
subscriptions.push(() => {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = undefined;
  }
});

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

export function buildDiffConfig(
  configProperties: ConfigProperties | null | undefined,
): diff.DiffConfig {
  const config = new diff.DiffConfig();
  const props = getModifiedConfigProperties(
    configProperties ?? useExtensionStore.getState().configProperties,
  );
  for (const key in props) {
    if (props[key] != null) {
      config.setProperty(key, props[key].toString());
    }
  }
  return config;
}

const handleMessage = (event: MessageEvent) => {
  const message = event.data as InboundMessage;
  if (message.type === 'state') {
    console.log('Received state message', message);
    const newState: Partial<ExtensionState> = {
      ...message,
      ready: true,
    };
    // Backwards compatibility for decomp.me
    if (message.leftObject && !message.leftStatus) {
      newState.leftStatus = {
        success: true,
        cmdline: '',
        stdout: '',
        stderr: '',
      };
    }
    if (message.rightObject && !message.rightStatus) {
      newState.rightStatus = {
        success: true,
        cmdline: '',
        stdout: '',
        stderr: '',
      };
    }
    for (const k in newState) {
      const key = k as keyof typeof newState;
      if (newState[key] === undefined) {
        delete newState[key];
      }
    }
    useExtensionStore.setState(newState);
  } else if (message.type === 'theme') {
    if (message.isDark) {
      document.body.classList.remove('decomp-me-light');
      document.body.classList.add('decomp-me-dark');
    } else {
      document.body.classList.remove('decomp-me-dark');
      document.body.classList.add('decomp-me-light');
    }
    document.body.style.setProperty('--background', message.colors.background);
    if (message.codeFont) {
      document.body.style.setProperty(
        '--code-font-family',
        `${message.codeFont}, monospace`,
      );
    } else {
      document.body.style.removeProperty('--code-font-family');
    }
    if (message.codeFontSize) {
      document.body.style.setProperty(
        '--code-font-size',
        `${message.codeFontSize}px`,
      );
    } else {
      document.body.style.removeProperty('--code-font-size');
    }
    if (message.fontLigatures != null) {
      document.body.style.setProperty(
        '--code-font-variant-ligatures',
        message.fontLigatures ? 'contextual' : 'no-contextual',
      );
    }
  } else if (inVsCode) {
    console.error('Unknown message', message);
  }
};
window.addEventListener('message', handleMessage);
subscriptions.push(() => window.removeEventListener('message', handleMessage));

vsCode.postMessage({ type: 'ready' });
