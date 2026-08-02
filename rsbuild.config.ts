import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import {
  type RequestHandler,
  type RsbuildConfig,
  defineConfig,
} from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';
import { pluginTypedCSSModules } from '@rsbuild/plugin-typed-css-modules';
import { readDesktopConfig } from './server/desktop-config';

// Standalone web configuration.
const webConfig: RsbuildConfig = {
  source: {
    entry: {
      index: './webview/index.tsx',
    },
  },
  html: {
    scriptLoading: 'module',
    title: 'objdiff',
  },
  plugins: [pluginReact(), pluginTypeCheck(), pluginTypedCSSModules()],
  dev: {
    setupMiddlewares: [
      (middlewares, _server) => {
        middlewares.unshift(apiMiddleware);
        return middlewares;
      },
    ],
  },
  // Opt in with OBJDIFF_API_PROXY=1 to forward /api to the standalone server
  // (`pnpm api:dev`) so the web UI and the API share an origin. Off by default:
  // the proxy would otherwise swallow /api/get and fail when the API server
  // isn't running, and the mock middleware below already serves the web UI.
  ...(process.env.OBJDIFF_API_PROXY
    ? {
        server: {
          proxy: {
            '/api': {
              target: `http://localhost:${process.env.OBJDIFF_API_PORT ?? 3001}`,
              changeOrigin: true,
            },
          },
        },
      }
    : {}),
};

// VS Code extension configuration.
const extensionConfig: RsbuildConfig = {
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
        legalComments: 'none',
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
        dataUriLimit: 1000000000,
        inlineScripts: true,
        inlineStyles: true,
        legalComments: 'none',
      },
      html: {
        scriptLoading: 'module',
        title: 'objdiff',
      },
      plugins: [
        pluginReact({
          fastRefresh: false,
        }),
        pluginTypedCSSModules(),
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
  // Disable HMR and live reload. Neither the extension nor the
  // webview can communicate with the rsbuild dev server.
  dev: {
    hmr: false,
    liveReload: false,
  },
  // Disable copying the public directory. This is only useful
  // for the web configuration.
  server: {
    publicDir: {
      copyOnBuild: false,
    },
  },
};

const buildType = process.env.BUILD_TYPE;
let config: RsbuildConfig;
if (buildType === 'extension') {
  config = extensionConfig;
} else {
  config = webConfig;
}
export default defineConfig(config);

// Root of the decomp project served to the web UI during development.
// Point OBJDIFF_PROJECT_ROOT at your own project to try it out.
// Same resolution as the API server: the env var (trimmed, because
// `set VAR=value && cmd` on Windows captures the trailing space), then whatever
// project the objdiff desktop app last had open, then ../prime.
const PROJECT_ROOT = path.resolve(
  process.env.OBJDIFF_PROJECT_ROOT?.trim() ||
    readDesktopConfig()?.projectDir ||
    '../prime',
);

// Mock API middleware for development.
const apiMiddleware: RequestHandler = (req, res, next) => {
  // Permit cross-origin embedding for decomp.me.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

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
      const filepath = path.resolve(PROJECT_ROOT, file);
      // Compare via path.relative so that a sibling directory sharing a name
      // prefix (e.g. ../prime-secrets) can't be read.
      const rel = path.relative(PROJECT_ROOT, filepath);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
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
