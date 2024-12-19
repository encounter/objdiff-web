import * as picomatch from 'picomatch';
import * as vscode from 'vscode';
import {
  type ObjdiffConfiguration,
  type Unit,
  resolveConfig,
} from '../shared/config';
import type { InboundMessage, OutboundMessage } from '../shared/messages';

const CONFIG_FILENAME = 'objdiff.json';

export class ObjdiffWorkspace extends vscode.Disposable {
  public config?: ObjdiffConfiguration;
  public configWatcher: vscode.FileSystemWatcher;
  public currentUnit?: Unit;
  public workspaceWatcher?: vscode.FileSystemWatcher;
  public onDidChangeConfig: vscode.Event<ObjdiffConfiguration | undefined>;
  public onDidChangeCurrentUnit: vscode.Event<Unit | undefined>;

  private subscriptions: vscode.Disposable[] = [];
  private wwSubscriptions: vscode.Disposable[] = [];
  // private currentTask?: () => void;
  private pathMatcher?: picomatch.Matcher;
  private didChangeConfigEmitter = new vscode.EventEmitter<
    ObjdiffConfiguration | undefined
  >();
  private didChangeCurrentUnitEmitter = new vscode.EventEmitter<
    Unit | undefined
  >();

  constructor(
    public readonly chan: vscode.LogOutputChannel,
    public readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly storageUri: vscode.Uri,
    public deferredCurrentUnit?: string,
  ) {
    super(() => {
      this.disposeImpl();
    });
    this.onDidChangeConfig = this.didChangeConfigEmitter.event;
    this.onDidChangeCurrentUnit = this.didChangeCurrentUnitEmitter.event;

    this.configWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, CONFIG_FILENAME),
    );
    this.configWatcher.onDidCreate(this.loadConfig, this, this.subscriptions);
    this.configWatcher.onDidChange(this.loadConfig, this, this.subscriptions);
    this.configWatcher.onDidDelete(this.loadConfig, this, this.subscriptions);
    this.loadConfig();
    chan.info(`Initialized workspace: ${this.workspaceFolder.uri.toString()}`);
    // this.subscriptions.push(
    //   vscode.workspace.onDidOpenTextDocument((e) => {
    //     if (
    //       e.uri.scheme === 'file' &&
    //       e.uri.fsPath.startsWith(this.rootUri.fsPath)
    //     ) {
    //       const relPath = e.uri.fsPath.slice(this.rootUri.fsPath.length + 1);
    //       this.chan.info('Opened document in workspace:', relPath);
    //     }
    //   }, this),
    // );
  }

  // biome-ignore lint/suspicious/noExplicitAny: pass through message args
  showError(message: string, ...args: any[]) {
    this.chan.error(message, ...args);
    vscode.window
      .showErrorMessage(`objdiff: ${message}`, {
        title: 'Show log',
      })
      .then((item) => {
        if (item) {
          this.chan.show();
        }
      });
  }

  // biome-ignore lint/suspicious/noExplicitAny: pass through message args
  showWarning(message: string, ...args: any[]) {
    this.chan.warn(message, ...args);
    vscode.window.showWarningMessage(`objdiff: ${message}`);
  }

  async loadConfig() {
    const configUri = vscode.Uri.joinPath(
      this.workspaceFolder.uri,
      CONFIG_FILENAME,
    );
    try {
      const stat = await vscode.workspace.fs.stat(configUri);
      if (stat.type !== vscode.FileType.File) {
        this.showError('Config path is not a file', configUri.toString());
        return;
      }
    } catch (reason) {
      if (reason instanceof vscode.FileSystemError) {
        if (reason.code === 'FileNotFound') {
          this.chan.warn('Config file not found', configUri.toString());
          this.config = undefined;
          this.onConfigChange();
          return;
        }
      }
      this.showError(
        'Failed to stat config file',
        configUri.toString(),
        reason,
      );
      return;
    }
    try {
      const data = await vscode.workspace.fs.readFile(configUri);
      this.config = JSON.parse(new TextDecoder().decode(data));
    } catch (reason) {
      this.showError(
        'Failed to load config file',
        configUri.toString(),
        reason,
      );
      return;
    }
    this.onConfigChange();
  }

  private onConfigChange() {
    this.chan.info('Loaded new config');
    if (this.config) {
      this.config = resolveConfig(this.config);
    }
    const watchPatterns = this.config?.watch_patterns || [];
    if (watchPatterns.length) {
      this.pathMatcher = picomatch(watchPatterns, {
        basename: true,
        strictSlashes: true,
      });
    } else {
      this.pathMatcher = undefined;
    }
    this.chan.info('Watch patterns:', watchPatterns);
    if (this.workspaceWatcher) {
      for (const sub of this.wwSubscriptions) {
        sub.dispose();
      }
      this.wwSubscriptions = [];
      this.workspaceWatcher.dispose();
      this.workspaceWatcher = undefined;
    }
    if (this.pathMatcher) {
      this.workspaceWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.workspaceFolder.uri, '*/**'),
      );
      this.workspaceWatcher.onDidChange(
        this.onWorkspaceFileChange,
        this,
        this.wwSubscriptions,
      );
      this.workspaceWatcher.onDidCreate(
        this.onWorkspaceFileChange,
        this,
        this.wwSubscriptions,
      );
      this.workspaceWatcher.onDidDelete(
        this.onWorkspaceFileChange,
        this,
        this.wwSubscriptions,
      );
    }
    this.didChangeConfigEmitter.fire(this.config);
    if (this.config && this.deferredCurrentUnit) {
      this.currentUnit = this.config.units?.find(
        (unit) => unit.name === this.deferredCurrentUnit,
      );
      this.deferredCurrentUnit = undefined;
    }
    if (this.config && this.currentUnit) {
      this.tryBuild();
    }
  }

  private onWorkspaceFileChange(uri: vscode.Uri) {
    if (!uri.fsPath.startsWith(this.workspaceFolder.uri.fsPath)) {
      return;
    }
    const relPath = uri.fsPath.slice(
      this.workspaceFolder.uri.fsPath.length + 1,
    );
    if (!this.pathMatcher || !this.pathMatcher(relPath)) {
      return;
    }
    this.chan.info('Workspace file changed', uri.toString());
    if (this.config && this.currentUnit) {
      this.tryBuild();
    }
  }

  setCurrentUnit(unit: Unit | undefined) {
    this.currentUnit = unit;
    this.didChangeCurrentUnitEmitter.fire(this.currentUnit);
    if (this.config && this.currentUnit) {
      this.tryBuild();
    }
  }

  tryUpdateCurrentUnit() {
    if (!this.config) {
      return false;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      this.showWarning('No active editor');
      return false;
    }
    if (activeEditor.document.uri.scheme !== 'file') {
      this.showWarning('Active editor not a file');
      return false;
    }
    const fsPath = activeEditor.document.uri.fsPath;
    if (!fsPath.startsWith(this.workspaceFolder.uri.fsPath)) {
      this.showWarning('Active editor not in workspace', fsPath);
      return false;
    }
    const relPath = fsPath.slice(this.workspaceFolder.uri.fsPath.length + 1);
    const unit = this.config.units?.find(
      (unit) => unit.metadata?.source_path === relPath,
    );
    if (!unit) {
      this.showWarning(`No unit found for ${relPath}`);
      return false;
    }
    this.currentUnit = unit;
    this.didChangeCurrentUnitEmitter.fire(this.currentUnit);
    this.tryBuild();
    return true;
  }

  tryBuild() {
    if (!this.config) {
      this.showWarning('No configuration loaded');
      return;
    }
    if (!this.currentUnit) {
      this.showWarning('No unit selected');
      return;
    }
    const targetPath =
      this.currentUnit.target_path &&
      vscode.Uri.joinPath(
        this.workspaceFolder.uri,
        this.currentUnit.target_path,
      );
    const basePath =
      this.currentUnit.base_path &&
      vscode.Uri.joinPath(this.workspaceFolder.uri, this.currentUnit.base_path);
    this.chan.info('Diffing', targetPath?.toString(), basePath?.toString());
    if (!targetPath || !basePath) {
      this.showWarning('No target or base path');
      return;
    }
    const buildCmd = this.config.custom_make || 'make';
    const buildArgs = this.config.custom_args || [];
    const outputUri = vscode.Uri.joinPath(this.storageUri, 'diff.binpb');
    const args = [];
    if (this.currentUnit.target_path && this.config.build_target) {
      if (args.length) {
        args.push('&&');
      }
      args.push(buildCmd, ...buildArgs, this.currentUnit.target_path);
    }
    if (
      this.currentUnit.base_path &&
      (this.config.build_base || this.config.build_base === undefined)
    ) {
      if (args.length) {
        args.push('&&');
      }
      args.push(buildCmd, ...buildArgs, this.currentUnit.base_path);
    }
    if (args.length) {
      args.push('&&');
    }
    const binaryPath = vscode.workspace
      .getConfiguration('objdiff')
      .get('binaryPath') as string;
    if (!binaryPath) {
      vscode.window
        .showWarningMessage('objdiff.binaryPath not set', {
          title: 'Open settings',
        })
        .then((item) => {
          if (item) {
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'objdiff.binaryPath',
            );
          }
        });
      return;
    }
    args.push(
      binaryPath,
      'diff',
      '-1',
      targetPath.fsPath,
      '-2',
      basePath.fsPath,
      '--format',
      'proto',
      '-o',
      outputUri.fsPath,
    );
    const startTime = performance.now();
    const task = new vscode.Task(
      {
        type: 'objdiff',
        taskType: 'build',
        startTime,
      },
      this.workspaceFolder,
      'objdiff',
      'objdiff',
      new vscode.ShellExecution(args[0], args.slice(1)),
    );
    task.presentationOptions.reveal = vscode.TaskRevealKind.Silent;
    vscode.tasks.executeTask(task).then(
      ({ task, terminate: _ }) => {
        const curTime = performance.now();
        this.chan.info(
          'Diff task started in',
          curTime - task.definition.startTime,
        );
      },
      (reason) => {
        this.showError('Failed to start diff task', reason);
      },
    );
  }

  private disposeImpl() {
    this.chan.info('Disposing workspace');
    this.configWatcher.dispose();
    for (const sub of this.wwSubscriptions) {
      sub.dispose();
    }
    this.wwSubscriptions = [];
    this.workspaceWatcher?.dispose();
    this.workspaceWatcher = undefined;
    for (const sub of this.subscriptions) {
      sub.dispose();
    }
    this.subscriptions = [];
  }
}

export function activate(context: vscode.ExtensionContext) {
  const chan = vscode.window.createOutputChannel('objdiff', { log: true });
  const storageUri = context.storageUri;
  if (!storageUri || storageUri.scheme !== 'file') {
    chan.warn('objdiff requires a file storage URI');
    return;
  }
  vscode.workspace.fs.createDirectory(storageUri).then(
    () => {
      chan.info('Storage directory created', storageUri.toString());
    },
    (reason) => {
      chan.error(
        'Failed to create storage directory',
        storageUri.toString(),
        reason,
      );
    },
  );
  // const storageDir = storageUri.fsPath;
  // chan.info('Storage directory: ' + storageDir);

  const webviews: {
    webview: vscode.Webview;
    subscriptions: vscode.Disposable[];
  }[] = [];

  let workspace: ObjdiffWorkspace | undefined;
  if (vscode.workspace.workspaceFolders?.[0]) {
    const deferredCurrentUnit =
      context.workspaceState.get<string>('currentUnit');
    workspace = new ObjdiffWorkspace(
      chan,
      vscode.workspace.workspaceFolders[0],
      storageUri,
      deferredCurrentUnit,
    );
    workspace.onDidChangeConfig(
      (config) => {
        for (const view of webviews) {
          view.webview.postMessage({
            type: 'state',
            config: config || null,
          } as InboundMessage);
        }
      },
      undefined,
      context.subscriptions,
    );
    workspace.onDidChangeCurrentUnit(
      (unit) => {
        context.workspaceState.update('currentUnit', unit?.name);
        if (!unit) {
          for (const view of webviews) {
            view.webview.postMessage({
              type: 'diff',
              data: null,
              currentUnit: null,
            } as InboundMessage);
          }
        }
      },
      undefined,
      context.subscriptions,
    );
    context.subscriptions.push(workspace);
  }
  chan.info('Workspace folders', vscode.workspace.workspaceFolders);
  vscode.workspace.onDidChangeWorkspaceFolders(
    (e) => {
      chan.info('Workspace folders changed', e);
    },
    undefined,
    context.subscriptions,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('objdiff.build', () => {
      if (!workspace) {
        vscode.window.showWarningMessage('objdiff: No workspace loaded');
        return;
      }
      workspace.tryBuild();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('objdiff.chooseUnit', () => {
      if (!workspace) {
        vscode.window.showWarningMessage('objdiff: No workspace loaded');
        return;
      }
      const config = workspace.config;
      if (!config) {
        vscode.window.showWarningMessage('objdiff: No configuration loaded');
        return;
      }
      const items = (config.units || [])
        .filter((unit) => !unit.metadata?.auto_generated)
        .map((unit) => {
          const label = unit.name as string;
          let description: string | undefined;
          if (unit.metadata?.complete !== undefined) {
            if (unit.metadata.complete) {
              description = '$(pass-filled)';
            } else {
              description = '$(circle-large-outline)';
            }
          }
          return {
            label,
            description,
            picked: unit.name === workspace.currentUnit?.name,
            unit,
          } as vscode.QuickPickItem & { unit: Unit };
        });
      vscode.window
        .showQuickPick(items, {
          title: 'objdiff: Choose Unit',
          placeHolder: 'Unit name',
        })
        .then((item) => {
          if (item) {
            chan.info('Selected unit', item.label);
            workspace.setCurrentUnit(item.unit);
          }
        });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('objdiff.clearUnit', () => {
      if (!workspace) {
        vscode.window.showWarningMessage('objdiff: No workspace loaded');
        return;
      }
      workspace.setCurrentUnit(undefined);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('objdiff.chooseCurrentFile', () => {
      if (!workspace) {
        vscode.window.showWarningMessage('objdiff: No workspace loaded');
        return;
      }
      if (!workspace.tryUpdateCurrentUnit()) {
        vscode.window.showWarningMessage(
          'objdiff: No unit found for source file',
        );
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('objdiff.copySymbolName', (opts) => {
      chan.info('Copy command', opts);
      vscode.env.clipboard.writeText(opts.symbolName);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'objdiff.copySymbolDemangledName',
      (opts) => {
        chan.info('Copy demangled command', opts);
        vscode.env.clipboard.writeText(opts.symbolDemangledName);
      },
    ),
  );

  const backgroundColors = [
    'rgba(255, 0, 255, 0.3)',
    'rgba(0, 255, 255, 0.3)',
    'rgba(0, 212, 0, 0.3)',
    'rgba(255, 0, 0, 0.3)',
    'rgba(103, 106, 255, 0.3)',
    'rgba(255, 182, 193, 0.3)',
    'rgba(224, 255, 255, 0.3)',
    'rgba(144, 238, 144, 0.3)',
    'rgba(128, 128, 128, 0.3)',
  ];
  const decorationTypes = backgroundColors.map((color) => {
    return vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: color,
    });
  });

  vscode.tasks.onDidStartTask(
    (e) => {
      if (e.execution.task.definition.type !== 'objdiff') {
        return;
      }
      for (const view of webviews) {
        view.webview.postMessage({
          type: 'task',
          taskType: e.execution.task.definition.taskType,
          running: true,
        } as InboundMessage);
      }
    },
    undefined,
    context.subscriptions,
  );
  vscode.tasks.onDidEndTask(
    (e) => {
      if (e.execution.task.definition.type !== 'objdiff') {
        return;
      }
      for (const view of webviews) {
        view.webview.postMessage({
          type: 'task',
          taskType: e.execution.task.definition.taskType,
          running: false,
        } as InboundMessage);
      }
    },
    undefined,
    context.subscriptions,
  );

  let cachedData: Uint8Array | null = null;
  vscode.tasks.onDidEndTaskProcess(
    async (e) => {
      if (e.execution.task.definition.type !== 'objdiff') {
        return;
      }
      const endTime = performance.now();
      chan.info(
        'Task ended',
        e.exitCode,
        endTime - e.execution.task.definition.startTime,
      );
      const proc = e.execution.task.execution as vscode.ProcessExecution;
      const outputFile = proc.args[proc.args.indexOf('-o') + 1];
      const outputUri = vscode.Uri.file(outputFile);
      if (e.exitCode === 0) {
        try {
          const data = await vscode.workspace.fs.readFile(outputUri);
          chan.info(
            'Read output file',
            outputFile,
            'with size',
            data.byteLength,
          );
          for (const view of webviews) {
            view.webview.postMessage({
              type: 'diff',
              data: data.buffer,
              currentUnit: workspace?.currentUnit || null,
            } as InboundMessage);
          }
          cachedData = data;
        } catch (reason) {
          workspace?.showError('Failed to read output file', reason);
        }
      } else {
        workspace?.showError(`Build failed with code ${e.exitCode}`);
      }
      vscode.workspace.fs.delete(outputUri).then(
        () => {},
        (reason) => {
          workspace?.showError('Failed to delete output file', reason);
        },
      );
    },
    undefined,
    context.subscriptions,
  );

  const textDecoder = new TextDecoder();
  const webviewRoot = vscode.Uri.joinPath(
    context.extensionUri,
    'dist',
    'webview',
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('objdiff', {
      async resolveWebviewView(view, _resolve, _token) {
        let html = textDecoder.decode(
          await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(webviewRoot, 'index.html'),
          ),
        );
        // For development, allow static assets (production will be inlined)
        html = html.replaceAll(/"\/static\/(.*?)"/g, (_, p) => {
          const assetUri = vscode.Uri.joinPath(webviewRoot, 'static', p);
          return `"${view.webview.asWebviewUri(assetUri)}"`;
        });
        // chan.info(html);
        view.webview.options = {
          localResourceRoots: [context.extensionUri],
          enableScripts: true,
        };
        view.webview.html = html;
        const subscriptions: vscode.Disposable[] = [];
        view.webview.onDidReceiveMessage(
          (untypedMessage) => {
            const message = untypedMessage as OutboundMessage;
            if (message.type === 'ready') {
              chan.info('Webview ready');
              view.webview.postMessage({
                type: 'state',
                config: workspace?.config || null,
              } as InboundMessage);
              if (cachedData) {
                chan.info('Sending cached diff to webview');
                view.webview.postMessage({
                  type: 'diff',
                  data: cachedData.buffer,
                  currentUnit: workspace?.currentUnit || null,
                } as InboundMessage);
              }
            } else if (message.type === 'lineRanges') {
              for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document.uri.scheme !== 'file') {
                  continue;
                }
                chan.info(
                  'Adding decorations to editor',
                  editor.document.uri.toString(),
                );
                let idx = 0;
                for (const range of message.data) {
                  editor.setDecorations(decorationTypes[idx], [
                    new vscode.Range(range.start, 0, range.end, 0),
                  ]);
                  idx = (idx + 1) % decorationTypes.length;
                }
              }
            } else if (message.type === 'runTask') {
              if (message.taskType === 'build') {
                workspace?.tryBuild();
              } else {
                chan.warn('Unknown task type', message.taskType);
              }
            } else if (message.type === 'setCurrentUnit') {
              if (!workspace) {
                vscode.window.showWarningMessage(
                  'objdiff: No workspace loaded',
                );
                return;
              }
              if (message.unit === 'source') {
                workspace.tryUpdateCurrentUnit();
              } else {
                workspace.setCurrentUnit(message.unit || undefined);
              }
            } else if (message.type === 'quickPickUnit') {
              vscode.commands.executeCommand('objdiff.chooseUnit');
            } else {
              chan.warn('Unknown message', message);
            }
          },
          undefined,
          subscriptions,
        );
        view.onDidDispose(
          () => {
            for (const sub of subscriptions) {
              sub.dispose();
            }
            for (let i = 0; i < webviews.length; i++) {
              if (webviews[i].webview === view.webview) {
                webviews.splice(i, 1);
                break;
              }
            }
          },
          undefined,
          context.subscriptions,
        );
        webviews.push({
          webview: view.webview,
          subscriptions,
        });
      },
    }),
  );
}

export function deactivate() {}
