export type DiffMessage = {
  type: 'diff';
  data: ArrayBuffer;
};

export type TaskMessage = {
  type: 'task';
  taskType: string;
  running: boolean;
};

export type StateMessage = {
  type: 'state';
  configLoaded: boolean;
  currentFile: string | null;
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

// webview -> extension
export type OutboundMessage = ReadyMessage | LineRangesMessage | RunTaskMessage;
