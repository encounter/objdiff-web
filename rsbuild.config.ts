import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

export default defineConfig({
  // Disable HMR and live reload. Neither the extension nor the
  // webview can communicate with the rsbuild dev server.
  dev: {
    hmr: false,
    liveReload: false,
  },
  environments: {
    extension: {
      source: {
        entry: {
          extension: './src/extension.ts',
        },
      },
      output: {
        target: 'node',
        distPath: {
          root: 'dist',
        },
        externals: ['vscode'],
      },
    },
    webview: {
      source: {
        entry: {
          index: './webview/index.tsx',
        },
      },
      output: {
        target: 'web',
        distPath: {
          root: 'dist/webview',
        },
        // VS Code webviews don't have easy access to resources,
        // (especially if the extension is running on web) so we
        // simply inline everything into the HTML.
        inlineScripts: true,
        inlineStyles: true,
        legalComments: 'none',
      },
      // <script defer> doesn't work with inline scripts,
      // so we need to move the scripts to the body.
      html: {
        inject: 'body',
        scriptLoading: 'blocking',
        title: 'objdiff',
      },
      plugins: [
        pluginReact({
          fastRefresh: false,
        }),
      ],
    },
  },
  // Ensure that we never split chunks. Both the extension and
  // the webview must be self-contained files.
  performance: {
    chunkSplit: {
      strategy: 'all-in-one',
    },
  },
  // Enable async TypeScript type checking.
  plugins: [pluginTypeCheck()],
  // We can't use async chunks for aforementioned reasons.
  // Disabling them ensures that all code is bundled together
  // even if dynamic imports are used.
  tools: {
    rspack: {
      output: {
        asyncChunks: false,
      },
    },
  },
});
