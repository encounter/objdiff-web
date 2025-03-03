import type {
  ConfigProperties,
  ConfigPropertyValue,
  ProjectConfig,
  Unit,
} from './config';

export type WebviewProps = {
  extensionVersion: string;
  resourceRoot: string;
};

export type BuildStatus = {
  success: boolean;
  cmdline: string;
  stdout: string;
  stderr: string;
};

export type StateMessage = {
  type: 'state';
  buildRunning?: boolean;
  configProperties?: ConfigProperties;
  currentUnit?: Unit | null;
  leftStatus?: BuildStatus | null;
  rightStatus?: BuildStatus | null;
  leftObject?: ArrayBuffer | null;
  rightObject?: ArrayBuffer | null;
  projectConfig?: ProjectConfig | null;
};

// extension -> webview
export type InboundMessage = StateMessage;

export type ReadyMessage = {
  type: 'ready';
};

export type LineRangesMessage = {
  type: 'lineRanges';
  data: Array<{ start: number; end: number }>;
};

export type RunTaskMessage = {
  type: 'runTask';
  taskType: string;
};

export type SetCurrentUnitMessage = {
  type: 'setCurrentUnit';
  unit: Unit | 'source' | null;
};

export type QuickPickUnitMessage = {
  type: 'quickPickUnit';
};

export type SetConfigPropertyMessage = {
  type: 'setConfigProperty';
  id: string;
  value: ConfigPropertyValue | undefined;
};

export type OpenSettingsMessage = {
  type: 'openSettings';
};

// webview -> extension
export type OutboundMessage =
  | LineRangesMessage
  | OpenSettingsMessage
  | QuickPickUnitMessage
  | ReadyMessage
  | RunTaskMessage
  | SetConfigPropertyMessage
  | SetCurrentUnitMessage;
