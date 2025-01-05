import { type ProjectConfig, resolveProjectConfig } from '../shared/config';
import type { InboundMessage, OutboundMessage } from '../shared/messages';
import type { AppStateSerialized, MyWebviewApi } from './state';

let state: AppStateSerialized | undefined = {
  selectedSymbol: null,
  unitsScrollOffset: 0,
  unitStates: {},
  highlight: JSON.stringify({
    left: null,
    right: null,
  }),
  currentView: 'main',
  collapsedUnits: {},
};

function sendMessage(data: InboundMessage) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let resolvedProjectConfig: ProjectConfig | null = null;

async function handleMessage(msg: OutboundMessage): Promise<void> {
  switch (msg.type) {
    case 'ready': {
      const response = await fetch('/api/project');
      const projectConfig = await response.json();
      resolvedProjectConfig = resolveProjectConfig(projectConfig);
      sendMessage({
        type: 'state',
        buildRunning: false,
        configProperties: {},
        currentUnit: null,
        data: null,
        projectConfig: resolvedProjectConfig,
      });
      break;
    }
    case 'runTask':
      sendMessage({ type: 'state', buildRunning: true });
      await delay(1000);
      sendMessage({ type: 'state', buildRunning: false });
      break;
    case 'setCurrentUnit': {
      let data: ArrayBuffer | null = null;
      if (msg.unit) {
        sendMessage({ type: 'state', buildRunning: true });
        await delay(1000);
        const response = await fetch('/api/diff');
        data = await response.arrayBuffer();
      }
      if (msg.unit === 'source') {
        sendMessage({
          type: 'state',
          buildRunning: false,
          currentUnit: resolvedProjectConfig?.units?.[0] ?? null,
          data,
        });
      } else {
        sendMessage({
          type: 'state',
          buildRunning: false,
          currentUnit: msg.unit,
          data,
        });
      }
      break;
    }
    default:
      console.warn('Unhandled message', msg);
  }
}

export const mockVsCode: MyWebviewApi<AppStateSerialized> = {
  postMessage: (msg) => {
    handleMessage(msg);
  },
  getState: () => state,
  setState: (newState) => {
    state = newState;
    return newState;
  },
};
