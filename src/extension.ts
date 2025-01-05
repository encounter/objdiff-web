import * as vscode from 'vscode';
import type { Unit } from '../shared/config';
import type { InboundMessage, OutboundMessage } from '../shared/messages';
import { Workspace } from './workspace';

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
  const sendMessage = (message: InboundMessage) => {
    for (const view of webviews) {
      view.webview.postMessage(message);
    }
  };

  let workspace: Workspace | undefined;
  if (vscode.workspace.workspaceFolders?.[0]) {
    const deferredCurrentUnit =
      context.workspaceState.get<string>('currentUnit');
    workspace = new Workspace(
      chan,
      vscode.workspace.workspaceFolders[0],
      storageUri,
      deferredCurrentUnit,
    );
    workspace.onDidChangeProjectConfig(
      (config) => {
        sendMessage({
          type: 'state',
          projectConfig: config || null,
        });
      },
      undefined,
      context.subscriptions,
    );
    workspace.onDidChangeCurrentUnit(
      (unit) => {
        context.workspaceState.update('currentUnit', unit?.name);
        if (!unit) {
          sendMessage({
            type: 'state',
            data: null,
            currentUnit: null,
          });
        }
      },
      undefined,
      context.subscriptions,
    );
    workspace.onDidChangeData(
      (data) => {
        sendMessage({
          type: 'state',
          data: data?.buffer || null,
          currentUnit: workspace?.currentUnit || null,
        });
      },
      undefined,
      context.subscriptions,
    );
    workspace.onDidChangeBuildRunning(
      (buildRunning) => {
        sendMessage({
          type: 'state',
          buildRunning,
        });
      },
      undefined,
      context.subscriptions,
    );
    workspace.onDidChangeConfigProperties(
      (configProperties) => {
        sendMessage({
          type: 'state',
          configProperties,
        });
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
      const config = workspace.projectConfig;
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
  context.subscriptions.push(
    vscode.commands.registerCommand('objdiff.settings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `@ext:${context.extension.id}`,
      );
    }),
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
        view.webview.options = {
          localResourceRoots: [context.extensionUri],
          enableScripts: true,
        };
        view.webview.html = html;
        const subscriptions: vscode.Disposable[] = [];
        view.webview.postMessage({
          type: 'state',
          buildRunning: workspace?.buildRunning || false,
          configProperties: workspace?.configProperties || {},
          currentUnit: workspace?.currentUnit || null,
          data: workspace?.cachedData?.buffer || null,
          projectConfig: workspace?.projectConfig || null,
        } as InboundMessage);
        view.webview.onDidReceiveMessage(
          (untypedMessage) => {
            const message = untypedMessage as OutboundMessage;
            if (message.type === 'ready') {
              view.webview.postMessage({
                type: 'state',
                buildRunning: workspace?.buildRunning || false,
                configProperties: workspace?.configProperties || {},
                currentUnit: workspace?.currentUnit || null,
                data: workspace?.cachedData?.buffer || null,
                projectConfig: workspace?.projectConfig || null,
              } as InboundMessage);
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
            } else if (message.type === 'setConfigProperty') {
              vscode.workspace
                .getConfiguration('objdiff')
                .update(
                  message.id,
                  message.value,
                  vscode.ConfigurationTarget.Global,
                );
            } else if (message.type === 'openSettings') {
              vscode.commands.executeCommand('objdiff.settings');
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
