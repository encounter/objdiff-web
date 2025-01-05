import * as picomatch from 'picomatch';
import * as vscode from 'vscode';
import {
  CONFIG_FILENAME,
  type ConfigProperties,
  type ConfigPropertyValue,
  type ProjectConfig,
  type Unit,
  getModifiedConfigProperties,
  resolveProjectConfig,
} from '../shared/config';

export class Workspace extends vscode.Disposable {
  public buildRunning = false;
  public cachedData: Uint8Array | null = null;
  public configProperties: ConfigProperties = {};
  public currentUnit?: Unit;
  public projectConfig?: ProjectConfig;
  public projectConfigWatcher: vscode.FileSystemWatcher;
  public workspaceWatcher?: vscode.FileSystemWatcher;
  public onDidChangeProjectConfig: vscode.Event<ProjectConfig | undefined>;
  public onDidChangeConfigProperties: vscode.Event<ConfigProperties>;
  public onDidChangeCurrentUnit: vscode.Event<Unit | undefined>;
  public onDidChangeBuildRunning: vscode.Event<boolean>;
  public onDidChangeData: vscode.Event<Uint8Array | null>;

  private subscriptions: vscode.Disposable[] = [];
  private wwSubscriptions: vscode.Disposable[] = [];
  private pathMatcher?: picomatch.Matcher;

  private didChangeBuildRunningEmitter = new vscode.EventEmitter<boolean>();
  private didChangeConfigPropertiesEmitter =
    new vscode.EventEmitter<ConfigProperties>();
  private didChangeCurrentUnitEmitter = new vscode.EventEmitter<
    Unit | undefined
  >();
  private didChangeDataEmitter = new vscode.EventEmitter<Uint8Array | null>();
  private didChangeProjectConfigEmitter = new vscode.EventEmitter<
    ProjectConfig | undefined
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
    this.onDidChangeBuildRunning = this.didChangeBuildRunningEmitter.event;
    this.onDidChangeConfigProperties =
      this.didChangeConfigPropertiesEmitter.event;
    this.onDidChangeCurrentUnit = this.didChangeCurrentUnitEmitter.event;
    this.onDidChangeData = this.didChangeDataEmitter.event;
    this.onDidChangeProjectConfig = this.didChangeProjectConfigEmitter.event;

    vscode.tasks.onDidEndTaskProcess(
      this.onDidEndTaskProcess,
      this,
      this.subscriptions,
    );
    vscode.workspace.onDidChangeConfiguration(
      this.onDidChangeConfiguration,
      this,
      this.subscriptions,
    );
    this.loadConfigProperties();

    this.projectConfigWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, CONFIG_FILENAME),
    );
    this.projectConfigWatcher.onDidCreate(
      this.loadProjectConfig,
      this,
      this.subscriptions,
    );
    this.projectConfigWatcher.onDidChange(
      this.loadProjectConfig,
      this,
      this.subscriptions,
    );
    this.projectConfigWatcher.onDidDelete(
      this.loadProjectConfig,
      this,
      this.subscriptions,
    );
    this.loadProjectConfig();

    chan.info(`Initialized workspace: ${this.workspaceFolder.uri.toString()}`);
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

  async loadProjectConfig() {
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
          this.projectConfig = undefined;
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
      this.projectConfig = JSON.parse(new TextDecoder().decode(data));
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
    if (this.projectConfig) {
      this.projectConfig = resolveProjectConfig(this.projectConfig);
    }
    const watchPatterns = this.projectConfig?.watch_patterns || [];
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
    this.didChangeProjectConfigEmitter.fire(this.projectConfig);
    if (this.projectConfig && this.deferredCurrentUnit) {
      this.currentUnit = this.projectConfig.units?.find(
        (unit) => unit.name === this.deferredCurrentUnit,
      );
      this.deferredCurrentUnit = undefined;
    }
    if (this.projectConfig && this.currentUnit) {
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
    if (this.projectConfig && this.currentUnit) {
      this.tryBuild();
    }
  }

  setCurrentUnit(unit: Unit | undefined) {
    this.currentUnit = unit;
    this.didChangeCurrentUnitEmitter.fire(this.currentUnit);
    if (this.projectConfig && this.currentUnit) {
      this.tryBuild();
    }
  }

  tryUpdateCurrentUnit() {
    if (!this.projectConfig) {
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
    const unit = this.projectConfig.units?.find(
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
    if (this.buildRunning) {
      return;
    }
    if (!this.projectConfig) {
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
    if (!targetPath && !basePath) {
      this.showWarning('No target or base path');
      return;
    }
    const buildCmd = this.projectConfig.custom_make || 'make';
    const buildArgs = this.projectConfig.custom_args || [];
    const hash = cyrb53(this.workspaceFolder.uri.toString());
    const outputUri = vscode.Uri.joinPath(
      this.storageUri,
      `diff_${hash}.binpb`,
    );
    const args = [];
    if (this.currentUnit.target_path && this.projectConfig.build_target) {
      if (args.length) {
        args.push('&&');
      }
      args.push(buildCmd, ...buildArgs, this.currentUnit.target_path);
    }
    if (
      this.currentUnit.base_path &&
      (this.projectConfig.build_base ||
        this.projectConfig.build_base === undefined)
    ) {
      if (args.length) {
        args.push('&&');
      }
      args.push(buildCmd, ...buildArgs, this.currentUnit.base_path);
    }
    if (args.length) {
      args.push('&&');
    }
    const binaryPath = this.configProperties.binaryPath as string | undefined;
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
    args.push(binaryPath, 'diff');
    if (targetPath) {
      args.push('-1', targetPath.fsPath);
    }
    if (basePath) {
      args.push('-2', basePath.fsPath);
    }
    args.push('--format', 'proto', '-o', outputUri.fsPath);
    const configProperties = getModifiedConfigProperties(this.configProperties);
    for (const key in configProperties) {
      args.push('-c', `${key}=${configProperties[key]}`);
    }
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
    this.buildRunning = true;
    this.didChangeBuildRunningEmitter.fire(true);
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

  private async onDidEndTaskProcess(e: vscode.TaskProcessEndEvent) {
    if (e.execution.task.definition.type !== 'objdiff') {
      return;
    }
    try {
      const endTime = performance.now();
      this.chan.info(
        'Task ended',
        e.exitCode,
        endTime - e.execution.task.definition.startTime,
      );
      const proc = e.execution.task.execution as vscode.ProcessExecution;
      const outputFile = proc.args[proc.args.indexOf('-o') + 1];
      const outputUri = vscode.Uri.file(outputFile);
      if (e.exitCode === 0) {
        const data = await vscode.workspace.fs.readFile(outputUri);
        this.chan.info(
          'Read output file',
          outputFile,
          'with size',
          data.byteLength,
        );
        this.cachedData = data;
        this.didChangeDataEmitter.fire(data);
      } else {
        this.showError(`Build failed with code ${e.exitCode}`);
      }
      let exists = false;
      try {
        const stat = await vscode.workspace.fs.stat(outputUri);
        exists = stat.type === vscode.FileType.File;
      } catch (reason) {
        if (
          reason instanceof vscode.FileSystemError &&
          reason.code !== 'FileNotFound'
        ) {
          throw reason;
        }
      }
      if (exists) {
        await vscode.workspace.fs.delete(outputUri);
      }
    } catch (reason) {
      this.showError('Failed to process build result', reason);
    } finally {
      this.buildRunning = false;
      this.didChangeBuildRunningEmitter.fire(false);
    }
  }

  private async onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent) {
    if (!e.affectsConfiguration('objdiff')) {
      return;
    }
    this.loadConfigProperties();
    this.chan.info('Configuration changed');
  }

  private loadConfigProperties(): Record<string, ConfigPropertyValue> {
    const config = vscode.workspace.getConfiguration('objdiff');
    const properties: Record<string, ConfigPropertyValue> = {};
    for (const key in config) {
      const value = config.get(key);
      if (typeof value === 'object') {
        for (const subkey in value) {
          properties[`${key}.${subkey}`] = (
            value as Record<string, ConfigPropertyValue>
          )[subkey];
        }
      } else {
        properties[key] = value as ConfigPropertyValue;
      }
    }
    this.configProperties = properties;
    this.didChangeConfigPropertiesEmitter.fire(properties);
    if (this.projectConfig && this.currentUnit) {
      this.tryBuild();
    }
    return properties;
  }

  private disposeImpl() {
    this.chan.info('Disposing workspace');
    this.projectConfigWatcher.dispose();
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

/**
 * cyrb53 (c) 2018 bryc (github.com/bryc)
 * License: Public domain (or MIT if needed). Attribution appreciated.
 * A fast and simple 53-bit string hash function with decent collision resistance.
 * Largely inspired by MurmurHash2/3, but with a focus on speed/simplicity.
 */
function cyrb53(str: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}
