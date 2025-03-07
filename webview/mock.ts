import {
  type ConfigProperties,
  type ProjectConfig,
  type Unit,
  resolveProjectConfig,
} from '../shared/config';
import type {
  InboundMessage,
  OutboundMessage,
  StateMessage,
} from '../shared/messages';
import type { AppStateSerialized, MyWebviewApi } from './state';

let state: AppStateSerialized | undefined = {
  leftSymbol: null,
  rightSymbol: null,
  unitsScrollOffset: 0,
  unitStates: {},
  highlight: JSON.stringify({
    left: null,
    right: null,
  }),
  currentView: 'main',
  collapsedUnits: {},
};

const serializedState = localStorage.getItem('state');
if (serializedState) {
  state = JSON.parse(serializedState);
}

function sendMessage(data: InboundMessage) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

let resolvedProjectConfig: ProjectConfig | null = null;

async function fetchFile(path: string): Promise<Response> {
  const search = new URLSearchParams();
  search.set('path', path);
  const response = await fetch(`/api/get?${search.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
  }
  return response;
}

let lastUnit: Unit | null = null;

const serializedLastUnit = localStorage.getItem('lastUnit');
if (serializedLastUnit) {
  lastUnit = JSON.parse(serializedLastUnit);
}

let configProperties: ConfigProperties = {};

const serializedConfigProperties = localStorage.getItem('configProperties');
if (serializedConfigProperties) {
  configProperties = JSON.parse(serializedConfigProperties);
}

async function handleMessage(msg: OutboundMessage): Promise<void> {
  switch (msg.type) {
    case 'ready': {
      const response = await fetchFile('objdiff.json');
      const projectConfig = await response.json();
      resolvedProjectConfig = resolveProjectConfig(projectConfig);
      const out: StateMessage = {
        type: 'state',
        buildRunning: false,
        configProperties,
        currentUnit: null,
        leftObject: null,
        rightObject: null,
        projectConfig: resolvedProjectConfig,
      };
      if (lastUnit) {
        out.leftObject = await fetchFile(lastUnit.target_path ?? '').then((r) =>
          r.arrayBuffer(),
        );
        out.rightObject = await fetchFile(lastUnit.base_path ?? '').then((r) =>
          r.arrayBuffer(),
        );
      }
      sendMessage(out);
      break;
    }
    case 'runTask': {
      sendMessage({ type: 'state', buildRunning: true });
      const out: StateMessage = {
        type: 'state',
        buildRunning: false,
        leftObject: null,
        rightObject: null,
      };
      if (lastUnit) {
        out.leftObject = await fetchFile(lastUnit.target_path ?? '').then((r) =>
          r.arrayBuffer(),
        );
        out.rightObject = await fetchFile(lastUnit.base_path ?? '').then((r) =>
          r.arrayBuffer(),
        );
      }
      sendMessage(out);
      break;
    }
    case 'setCurrentUnit': {
      let unit: Unit | null = null;
      if (msg.unit === 'source') {
        unit = resolvedProjectConfig?.units?.[0] ?? null;
      } else if (msg.unit) {
        unit = msg.unit;
      }
      const out: StateMessage = {
        type: 'state',
        buildRunning: false,
        currentUnit: unit,
        leftObject: null,
        rightObject: null,
      };
      if (unit) {
        sendMessage({ type: 'state', buildRunning: true });
        out.leftObject = await fetchFile(unit.target_path ?? '').then((r) =>
          r.arrayBuffer(),
        );
        out.rightObject = await fetchFile(unit.base_path ?? '').then((r) =>
          r.arrayBuffer(),
        );
      }
      lastUnit = unit;
      localStorage.setItem('lastUnit', JSON.stringify(unit));
      sendMessage(out);
      break;
    }
    case 'setConfigProperty': {
      if (msg.value === undefined) {
        configProperties = { ...configProperties };
        delete configProperties[msg.id];
      } else {
        configProperties = { ...configProperties, [msg.id]: msg.value };
      }
      localStorage.setItem(
        'configProperties',
        JSON.stringify(configProperties),
      );
      sendMessage({ type: 'state', configProperties });
      break;
    }
    default: {
      console.warn('Unhandled message', msg);
    }
  }
}

export const mockVsCode: MyWebviewApi<AppStateSerialized> = {
  postMessage: (msg) => {
    if (window.parent === window || msg.type === 'setConfigProperty') {
      handleMessage(msg);
    } else {
      window.parent.postMessage(msg, '*');
    }
  },
  getState: () => state,
  setState: (newState) => {
    state = newState;
    localStorage.setItem('state', JSON.stringify(newState));
    return newState;
  },
};
