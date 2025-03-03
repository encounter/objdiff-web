import * as picomatch from 'picomatch';
import { Shescape } from 'shescape';
import * as vscode from 'vscode';
import {
  CONFIG_FILENAME,
  type ConfigProperties,
  type ConfigPropertyValue,
  type ProjectConfig,
  type Unit,
  resolveProjectConfig,
} from '../shared/config';
import {
  DirectTaskExecutor,
  type Task,
  type TaskResult,
  VscodeTaskExecutor,
} from './util';

export type BuildData = {
  leftObject: Uint8Array | null;
  rightObject: Uint8Array | null;
};

export class Workspace extends vscode.Disposable {
  public buildRunning = false;
  public cachedData: BuildData | null = null;
  public configProperties: ConfigProperties = {};
  public currentUnit?: Unit;
  public projectConfig?: ProjectConfig;
  public projectConfigWatcher: vscode.FileSystemWatcher;
  public workspaceWatcher?: vscode.FileSystemWatcher;
  public onDidChangeProjectConfig: vscode.Event<ProjectConfig | undefined>;
  public onDidChangeConfigProperties: vscode.Event<ConfigProperties>;
  public onDidChangeCurrentUnit: vscode.Event<Unit | undefined>;
  public onDidChangeBuildRunning: vscode.Event<boolean>;
  public onDidChangeData: vscode.Event<BuildData | null>;

  private subscriptions: vscode.Disposable[] = [];
  private wwSubscriptions: vscode.Disposable[] = [];
  private pathMatcher?: picomatch.Matcher;

  private buildTaskExecutor: VscodeTaskExecutor;
  private directTaskExecutor: DirectTaskExecutor;

  private didChangeBuildRunningEmitter = new vscode.EventEmitter<boolean>();
  private didChangeConfigPropertiesEmitter =
    new vscode.EventEmitter<ConfigProperties>();
  private didChangeCurrentUnitEmitter = new vscode.EventEmitter<
    Unit | undefined
  >();
  private didChangeDataEmitter = new vscode.EventEmitter<BuildData | null>();
  private didChangeProjectConfigEmitter = new vscode.EventEmitter<
    ProjectConfig | undefined
  >();

  constructor(
    public readonly chan: vscode.LogOutputChannel,
    public readonly workspaceFolder: vscode.WorkspaceFolder,
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

    this.buildTaskExecutor = new VscodeTaskExecutor(workspaceFolder);
    this.directTaskExecutor = new DirectTaskExecutor(workspaceFolder);

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

  async tryBuild() {
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
    if (!targetPath && !basePath) {
      this.showWarning('No target or base path');
      return;
    }

    this.buildRunning = true;
    this.didChangeBuildRunningEmitter.fire(true);
    try {
      const buildCmd = this.projectConfig.custom_make || 'make';
      const buildArgs = this.projectConfig.custom_args || [];

      // Build target object
      if (this.currentUnit.target_path && this.projectConfig.build_target) {
        const result = await this.runTask({
          type: 'objdiff',
          command: buildCmd,
          args: [...buildArgs, this.currentUnit.target_path],
        });
        if (result.code !== 0) {
          this.showError(`Target build failed with code ${result.code}`);
          return;
        }
      }

      // Build base object
      if (
        this.currentUnit.base_path &&
        (this.projectConfig.build_base ||
          this.projectConfig.build_base === undefined)
      ) {
        const result = await this.runTask({
          type: 'objdiff',
          command: buildCmd,
          args: [...buildArgs, this.currentUnit.base_path],
        });
        if (result.code !== 0) {
          this.showError(`Base build failed with code ${result.code}`);
          return;
        }
      }

      // Read target object
      let targetData: Uint8Array | null = null;
      if (targetPath) {
        targetData = await vscode.workspace.fs.readFile(targetPath);
      }

      // Read base object
      let baseData: Uint8Array | null = null;
      if (basePath) {
        baseData = await vscode.workspace.fs.readFile(basePath);
      }

      this.cachedData = { leftObject: targetData, rightObject: baseData };
      this.didChangeDataEmitter.fire(this.cachedData);
    } catch (reason) {
      this.showError('Failed to execute build', reason);
    } finally {
      this.buildRunning = false;
      this.didChangeBuildRunningEmitter.fire(false);
    }
  }

  private async runTask(task: Task): Promise<TaskResult> {
    this.logTask(task);
    const result = await this.directTaskExecutor.run(task);
    this.logTaskResult(task, result);
    return result;
  }

  private logTask(task: Task) {
    const command = new Shescape({ flagProtection: false, shell: true })
      .quoteAll([task.command, ...task.args])
      .join(' ');
    this.chan.info('Executing', command);
  }

  private logTaskResult(task: Task, result: TaskResult) {
    if (result.code === 0) {
      const endTime = performance.now();
      const elapsed = (endTime - result.startTime).toFixed(0);
      this.chan.info(`Command ${task.command} succeeded in ${elapsed}ms`);
      return;
    }
    this.chan.error(
      [
        `Command ${task.command} failed with code ${result.code}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
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
    this.buildTaskExecutor.dispose();
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
