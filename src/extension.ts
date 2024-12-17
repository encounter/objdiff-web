import * as picomatch from 'picomatch';
import * as vscode from 'vscode';
import { DEFAULT_WATCH_PATTERNS, type ObjdiffConfiguration } from './config';

const CONFIG_FILENAME = 'objdiff.json';

export class ObjdiffWorkspace extends vscode.Disposable {
  public config?: ObjdiffConfiguration;
  public configWatcher: vscode.FileSystemWatcher;
  public workspaceWatcher?: vscode.FileSystemWatcher;

  private subscriptions: vscode.Disposable[] = [];
  private wwSubscriptions: vscode.Disposable[] = [];
  private currentDiff?: vscode.Uri;
  // private currentTask?: () => void;
  private pathMatcher?: picomatch.Matcher;

  constructor(
    public readonly chan: vscode.LogOutputChannel,
    public readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly storageUri: vscode.Uri,
  ) {
    super(() => {
      this.disposeImpl();
    });
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

  onConfigChange() {
    this.chan.info('Loaded new config');
    const watchPatterns = this.config?.watch_patterns || DEFAULT_WATCH_PATTERNS;
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
    this.tryDiff();
  }

  onWorkspaceFileChange(uri: vscode.Uri) {
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
    this.tryDiff();
  }

  tryDiff() {
    if (!this.config) {
      return;
    }
    if (!this.currentDiff) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        this.chan.warn('No active editor');
        return;
      }
      if (activeEditor.document.uri.scheme !== 'file') {
        this.chan.warn('Active editor not a file');
        return;
      }
      this.currentDiff = activeEditor.document.uri;
    }
    const fsPath = this.currentDiff.fsPath;
    if (!fsPath.startsWith(this.workspaceFolder.uri.fsPath)) {
      this.chan.warn('Active editor not in workspace');
      return;
    }
    const relPath = fsPath.slice(this.workspaceFolder.uri.fsPath.length + 1);
    const obj = (this.config.units || this.config.objects)?.find(
      (obj) => obj.metadata?.source_path === relPath,
    );
    if (!obj) {
      this.chan.warn('No object found for', relPath);
      return;
    }
    const targetPath =
      obj.target_path &&
      vscode.Uri.joinPath(this.workspaceFolder.uri, obj.target_path);
    const basePath =
      obj.base_path &&
      vscode.Uri.joinPath(this.workspaceFolder.uri, obj.base_path);
    this.chan.info('Diffing', targetPath?.toString(), basePath?.toString());
    if (!targetPath || !basePath) {
      this.chan.warn('Missing target or base path');
      return;
    }
    const buildCmd = this.config.custom_make || 'make';
    const buildArgs = this.config.custom_args || [];
    const outputUri = vscode.Uri.joinPath(this.storageUri, 'diff.binpb');
    const args = [];
    if (obj.target_path && this.config.build_target) {
      if (args.length) {
        args.push('&&');
      }
      args.push(buildCmd, ...buildArgs, obj.target_path);
    }
    if (
      obj.base_path &&
      (this.config.build_base || this.config.build_base === undefined)
    ) {
      if (args.length) {
        args.push('&&');
      }
      args.push(buildCmd, ...buildArgs, obj.base_path);
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
    vscode.window.showErrorMessage('objdiff requires a file storage URI');
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

  let workspace: ObjdiffWorkspace | undefined;
  if (vscode.workspace.workspaceFolders?.[0]) {
    workspace = new ObjdiffWorkspace(
      chan,
      vscode.workspace.workspaceFolders[0],
      storageUri,
    );
    context.subscriptions.push(workspace);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('objdiff.build', () => {
      if (workspace) {
        workspace.tryDiff();
      }
    }),
  );

  const webviews: vscode.Webview[] = [];

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

  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess(async (e) => {
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
          //   const diff = diff_pb.DiffResult.fromBinary(data);
          //   treeDataProvider.update(diff);
          // vscode.window.showInformationMessage('Diff complete');
          // console.log('webviews', webviews);
          for (const webview of webviews) {
            webview.postMessage({
              type: 'diff',
              data: data.buffer,
            });
          }
        } catch (reason) {
          chan.error('Failed to read output file', reason);
        }
      } else {
        workspace?.showError(`Build failed with code ${e.exitCode}`);
      }
      vscode.workspace.fs.delete(outputUri).then(
        () => {},
        (reason) => {
          chan.error('Failed to delete output file', reason);
        },
      );
    }),
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
        context.subscriptions.push(
          view.webview.onDidReceiveMessage((message) => {
            if (message.type === 'ready') {
              chan.info('Webview ready');
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
            }
          }),
        );
        context.subscriptions.push(
          view.onDidDispose(() => {
            const idx = webviews.indexOf(view.webview);
            if (idx >= 0) {
              webviews.splice(idx, 1);
            }
          }),
        );
        webviews.push(view.webview);
      },
    }),
  );
}

export function deactivate() {}
