import * as vscode from 'vscode';

export type Task = {
  type: string;
  command: string;
  args: string[];
};

export interface TaskExecutor {
  run(task: Task): Promise<TaskResult>;
}

export interface TaskResult {
  code: number;
  stdout?: string;
  stderr?: string;
  startTime: number;
}

interface RunningTask {
  execution: vscode.TaskExecution;
  resolve: (result: TaskResult) => void;
  reject: (reason?: any) => void;
  startTime: number;
}

export class VscodeTaskExecutor implements TaskExecutor, vscode.Disposable {
  private runningTasks: RunningTask[] = [];
  private disposables: vscode.Disposable[] = [];
  private taskId = 0;

  constructor(private workspaceFolder: vscode.WorkspaceFolder) {
    vscode.tasks.onDidEndTaskProcess(
      (e) => {
        if (e.execution.task.definition.type !== 'objdiff') {
          return;
        }
        const index = this.runningTasks.findIndex(
          (task) =>
            task.execution.task.definition.id ===
            e.execution.task.definition.id,
        );
        if (index !== -1) {
          const task = this.runningTasks[index];
          this.runningTasks.splice(index, 1);
          task.resolve({
            code: e.exitCode ?? -1,
            startTime: task.startTime,
          });
        }
      },
      null,
      this.disposables,
    );
  }

  async run(task: Task): Promise<TaskResult> {
    const { type, command, args } = task;
    const startTime = performance.now();
    const vscodeTask = new vscode.Task(
      {
        type: 'objdiff',
        taskType: type,
        id: this.taskId++,
      },
      this.workspaceFolder,
      'objdiff',
      'objdiff',
      new vscode.ShellExecution(command, args),
    );
    vscodeTask.presentationOptions.reveal = vscode.TaskRevealKind.Silent;
    const execution = await vscode.tasks.executeTask(vscodeTask);
    return new Promise((resolve, reject) => {
      this.runningTasks.push({
        execution,
        resolve,
        reject,
        startTime,
      });
    });
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

export class DirectTaskExecutor implements TaskExecutor {
  constructor(private workspaceFolder: vscode.WorkspaceFolder) {}

  async run(task: Task): Promise<TaskResult> {
    const { command, args } = task;
    const startTime = performance.now();
    return new Promise((resolve, reject) => {
      const { execFile } = require('node:child_process');
      execFile(
        command,
        args,
        {
          cwd: this.workspaceFolder.uri.fsPath,
          encoding: 'utf8',
        },
        (error: any, stdout: string, stderr: string) => {
          if (error) {
            if (stdout || stderr) {
              resolve({
                code: error.code ?? -1,
                stdout,
                stderr,
                startTime,
              });
            } else {
              reject(error);
            }
          } else {
            resolve({
              code: 0,
              stdout,
              stderr,
              startTime,
            });
          }
        },
      );
    });
  }
}
