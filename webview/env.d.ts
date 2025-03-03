/// <reference types="@rsbuild/core/types" />
/// <reference types="@types/vscode-webview" />

interface Window {
  webviewProps?: import('../shared/messages').WebviewProps;
}
