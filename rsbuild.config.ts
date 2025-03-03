import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { type RequestHandler, defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';
import { pluginTypedCSSModules } from '@rsbuild/plugin-typed-css-modules';

const devServer = process.env.DEV_SERVER === 'true';

export default defineConfig({
  // Disable HMR and live reload. Neither the extension nor the
  // webview can communicate with the rsbuild dev server.
  dev: {
    hmr: devServer,
    liveReload: devServer,
    setupMiddlewares: [
      (middlewares, _server) => {
        if (devServer) {
          middlewares.unshift(apiMiddleware);
        }
        return middlewares;
      },
    ],
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
        dataUriLimit: devServer ? undefined : 1000000000,
        inlineScripts: !devServer,
        inlineStyles: !devServer,
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
          fastRefresh: devServer,
        }),
        pluginTypedCSSModules(),
      ],
    },
  },
  // Ensure that we never split chunks. Both the extension and
  // the webview must be self-contained files.
  performance: {
    chunkSplit: {
      strategy: devServer ? undefined : 'all-in-one',
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
        asyncChunks: devServer,
      },
    },
  },
});

const PROJECT_ROOT = '../prime';

// Mock API middleware for development.
const apiMiddleware: RequestHandler = (req, res, next) => {
  if (!req.url || !req.headers.host || req.method !== 'GET') {
    return next();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url) {
    return next();
  }
  if (url.pathname === '/api/get') {
    const file = url.searchParams.get('path');
    if (file) {
      const filepath = path.join(PROJECT_ROOT, file);
      if (filepath.startsWith(PROJECT_ROOT)) {
        return sendFile(res, filepath, 'application/octet-stream');
      }
    }
  }
  return next();
};

// Send a file as a response.
function sendFile(
  res: ServerResponse,
  path: string,
  contentType: string,
): void {
  const stream = fs.createReadStream(path);
  stream.on('error', (err) => {
    if (res.headersSent) {
      throw err;
    }
    let statusCode = 500;
    if ((err as any).code === 'ENOENT') {
      statusCode = 404;
    }
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ error: err.message }));
  });
  stream.on('ready', () => {
    res.writeHead(200, {
      'Content-Type': contentType,
    });
  });
  stream.pipe(res);
}
