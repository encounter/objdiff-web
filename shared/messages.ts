import type { ObjdiffConfiguration, Unit } from './config';

export type DiffMessage = {
  type: 'diff';
  data: ArrayBuffer | null;
  currentUnit: Unit | null;
};

export type TaskMessage = {
  type: 'task';
  taskType: string;
  running: boolean;
};

export type StateMessage = {
  type: 'state';
  config: ObjdiffConfiguration | null;
};

// extension -> webview
export type InboundMessage = DiffMessage | TaskMessage | StateMessage;

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

// webview -> extension
export type OutboundMessage =
  | ReadyMessage
  | LineRangesMessage
  | RunTaskMessage
  | SetCurrentUnitMessage
  | QuickPickUnitMessage;
