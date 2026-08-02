import {
  type ConfigProperties,
  type ProjectConfig,
  type Unit,
  resolveProjectConfig,
} from '../shared/config';
import type {
  BuildStatus,
  InboundMessage,
  OutboundMessage,
  StateMessage,
} from '../shared/messages';
// Type-only: state.ts imports this module, so a value import here would create
// a circular dependency and leave the initial state undefined at load time.
import type { AppStateSerialized, MyWebviewApi } from './state';

let state: AppStateSerialized | undefined = {
  leftSymbol: null,
  rightSymbol: null,
  unitsScrollOffset: 0,
  unitsSearch: null,
  unitsSearchOptions: {
    mode: 'fuzzy',
    caseSensitive: false,
    percentFilter: 'all',
  },
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
  if (!path) {
    return Promise.resolve(
      new Response(null, { status: 404, statusText: 'Not Found' }),
    );
  }
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

/**
 * Ask the API server to rebuild a unit.
 *
 * A browser can't run the project's build itself, so the Build button forwards
 * to `POST /api/build`. Returns a failed BuildStatus to display, or null when
 * the build succeeded or the server has no build support.
 */
async function runBuild(unit: Unit): Promise<BuildStatus | null> {
  const name = unit.name || unit.path;
  if (!name) {
    return null;
  }
  let response: Response;
  try {
    response = await fetch(`/api/build?unit=${encodeURIComponent(name)}`, {
      method: 'POST',
    });
  } catch (e) {
    return {
      success: false,
      cmdline: '',
      stdout: '',
      stderr: `Could not reach the API server to build: ${e}\n\nRun both together with: pnpm dev`,
    };
  }
  if (response.status === 404) {
    // No API server behind /api — the dev mock only serves files.
    return null;
  }
  let body: {
    ok?: boolean;
    steps?: {
      command: string;
      args: string[];
      exitCode: number;
      stdout: string;
      stderr: string;
    }[];
    error?: {
      code: string;
      message: string;
      hint?: string;
      diagnostics?: string;
    };
  };
  try {
    body = await response.json();
  } catch {
    return {
      success: false,
      cmdline: '',
      stdout: '',
      stderr: `Build request failed: ${response.status} ${response.statusText}`,
    };
  }
  if (body.ok) {
    return null;
  }
  // MSVC writes its diagnostics to stdout, so prefer the server's extracted
  // lines and fall back to whichever stream actually has content.
  const failed =
    body.steps?.find((s) => s.exitCode !== 0) ??
    body.steps?.find((s) => s.stderr || s.stdout) ??
    body.steps?.[0];
  return {
    success: false,
    cmdline: failed ? [failed.command, ...failed.args].join(' ') : '',
    stdout: failed?.stdout ?? '',
    stderr:
      body.error?.diagnostics ||
      failed?.stderr ||
      [body.error?.message, body.error?.hint].filter(Boolean).join('\n') ||
      'Build failed',
  };
}

async function fetchUnitFiles(unit: Unit, out: StateMessage): Promise<void> {
  const leftPromise = fetchFile(unit.target_path ?? '')
    .then((r) => r.arrayBuffer())
    .then(
      (o) => {
        out.leftObject = o;
        out.leftStatus = {
          success: true,
          cmdline: '',
          stdout: '',
          stderr: '',
        };
      },
      (e) => {
        out.leftObject = null;
        out.leftStatus = {
          success: false,
          cmdline: '',
          stdout: '',
          stderr: `Failed to fetch object: ${e}`,
        };
      },
    );
  const rightPromise = fetchFile(unit.base_path ?? '')
    .then((r) => r.arrayBuffer())
    .then(
      (o) => {
        out.rightObject = o;
        out.rightStatus = {
          success: true,
          cmdline: '',
          stdout: '',
          stderr: '',
        };
      },
      (e) => {
        out.rightObject = null;
        out.rightStatus = {
          success: false,
          cmdline: '',
          stdout: '',
          stderr: `Failed to fetch object: ${e}`,
        };
      },
    );
  await Promise.all([leftPromise, rightPromise]);
}

async function handleMessage(msg: OutboundMessage): Promise<void> {
  switch (msg.type) {
    case 'ready': {
      let projectConfig: ProjectConfig;
      try {
        projectConfig = await (await fetchFile('objdiff.json')).json();
      } catch (e) {
        // Still mark the app as ready: an unhandled rejection here used to
        // leave the UI stuck on a blank screen with no explanation.
        sendMessage({
          type: 'state',
          buildRunning: false,
          configProperties,
          currentUnit: null,
          leftStatus: null,
          rightStatus: null,
          leftObject: null,
          rightObject: null,
          projectConfig: null,
          configError: `${e instanceof Error ? e.message : e}`,
        });
        return;
      }
      resolvedProjectConfig = resolveProjectConfig(projectConfig);
      const out: StateMessage = {
        type: 'state',
        buildRunning: false,
        configProperties,
        currentUnit: null,
        leftStatus: null,
        rightStatus: null,
        leftObject: null,
        rightObject: null,
        projectConfig: resolvedProjectConfig,
      };
      if (lastUnit) {
        await fetchUnitFiles(lastUnit, out);
        if (!out.leftStatus?.success || !out.rightStatus?.success) {
          // Only build on startup when something is actually missing, and show
          // the UI first — a build takes seconds and would otherwise leave the
          // page blank for all of it.
          sendMessage({ ...out, buildRunning: true });
          const buildStatus = await runBuild(lastUnit);
          await fetchUnitFiles(lastUnit, out);
          if (buildStatus) {
            if (!out.leftStatus?.success) {
              out.leftStatus = buildStatus;
            }
            if (!out.rightStatus?.success) {
              out.rightStatus = buildStatus;
            }
          }
        }
      }
      sendMessage(out);
      break;
    }
    case 'runTask': {
      sendMessage({ type: 'state', buildRunning: true });
      const out: StateMessage = {
        type: 'state',
        buildRunning: false,
        leftStatus: null,
        rightStatus: null,
        leftObject: null,
        rightObject: null,
      };
      if (lastUnit) {
        const buildStatus = await runBuild(lastUnit);
        await fetchUnitFiles(lastUnit, out);
        // Surface a failed build in the column that couldn't be produced,
        // rather than showing a bare "object not found".
        if (buildStatus) {
          if (!out.leftStatus?.success) {
            out.leftStatus = buildStatus;
          }
          if (!out.rightStatus?.success) {
            out.rightStatus = buildStatus;
          }
        }
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
        leftStatus: null,
        rightStatus: null,
        leftObject: null,
        rightObject: null,
      };
      if (unit) {
        sendMessage({ type: 'state', buildRunning: true });
        // Build on selection, the same as the desktop app: an object that has
        // never been compiled would otherwise just read as "not found".
        const buildStatus = await runBuild(unit);
        await fetchUnitFiles(unit, out);
        if (buildStatus) {
          if (!out.leftStatus?.success) {
            out.leftStatus = buildStatus;
          }
          if (!out.rightStatus?.success) {
            out.rightStatus = buildStatus;
          }
        }
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
