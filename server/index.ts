import './wasm'; // must come first: installs the file: fetch bridge

import { createReadStream } from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { buildEnabled, buildUnit } from './build';
import {
  findSymbolPair,
  getUnitDiff,
  parseConfigOverrides,
  sectionsOf,
} from './diff';
import { ApiError, badRequest } from './errors';
import { INSTRUCTIONS_JSON, INSTRUCTIONS_MARKDOWN } from './instructions';
import { OPENAPI } from './openapi';
import {
  findUnit,
  listUnits,
  loadProjectConfig,
  projectRoot,
  projectRootSource,
  resolveInProject,
} from './project';
import { renderHtml } from './render/html';
import { buildAsmRows, isFunction } from './render/rows';
import { renderText } from './render/text';
import { parseSearchMode, searchUnit } from './symbols';
import { display, objdiffVersion } from './wasm';
import { startWatching, watchStatus } from './watch';

const PORT = Number(process.env.PORT ?? 3001);

// ---------------------------------------------------------------- helpers

const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body, jsonReplacer, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
};

const sendText = (
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
) => {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const required = (params: URLSearchParams, name: string): string => {
  const value = params.get(name);
  if (!value) {
    throw badRequest(
      'MISSING_PARAMETER',
      `Missing required query parameter "${name}"`,
      'See GET /api/instructions for usage.',
    );
  }
  return value;
};

const numberParam = (params: URLSearchParams, name: string): number | null => {
  const raw = params.get(name);
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw badRequest(
      'INVALID_PARAMETER',
      `Query parameter "${name}" must be a number, got "${raw}"`,
    );
  }
  return value;
};

/** Load a unit's diff using any config overrides present in the query. */
const unitDiffFrom = (params: URLSearchParams) =>
  getUnitDiff(required(params, 'unit'), parseConfigOverrides(params));

const symbolPairFrom = async (params: URLSearchParams) =>
  findSymbolPair(await unitDiffFrom(params), required(params, 'symbol'));

const linksFor = (unit: string, symbol: string) => {
  const q = `unit=${encodeURIComponent(unit)}&symbol=${encodeURIComponent(symbol)}`;
  return {
    html: `/api/diff.html?${q}`,
    text: `/api/diff.txt?${q}`,
    json: `/api/diff.json?${q}`,
  };
};

// ---------------------------------------------------------------- routes

const handlers: Record<
  string,
  (params: URLSearchParams, res: ServerResponse) => Promise<void>
> = {
  '/api/health': async (_params, res) => {
    let unitCount: number | null = null;
    let configError: string | null = null;
    try {
      unitCount = (await listUnits()).length;
    } catch (e) {
      configError = e instanceof ApiError ? e.message : String(e);
    }
    sendJson(res, 200, {
      ok: configError == null,
      objdiffVersion,
      projectRoot,
      projectRootSource,
      unitCount,
      configError,
      buildEnabled,
      watch: watchStatus(),
      instructions: '/api/instructions',
    });
  },

  '/api/instructions': async (params, res) => {
    if (params.get('format') === 'json') {
      sendJson(res, 200, INSTRUCTIONS_JSON);
      return;
    }
    sendText(res, 200, INSTRUCTIONS_MARKDOWN, 'text/markdown; charset=utf-8');
  },

  '/api/openapi.json': async (_params, res) => {
    sendJson(res, 200, OPENAPI);
  },

  '/api/units': async (_params, res) => {
    const units = await listUnits();
    sendJson(res, 200, {
      projectRoot,
      count: units.length,
      units: units.map((u) => ({
        name: u.name,
        path: u.unit.path ?? null,
        targetPath: u.targetPath,
        basePath: u.basePath,
        complete: u.unit.metadata?.complete ?? null,
        sourcePath: u.unit.metadata?.source_path ?? null,
      })),
    });
  },

  '/api/unit': async (params, res) => {
    const unitDiff = await unitDiffFrom(params);
    const obj = unitDiff.result.left ?? unitDiff.result.right;
    const sections = sectionsOf(obj).map((section) => ({
      name: section.name,
      kind: section.kind,
      size: Number(section.size),
      matchPercent: section.matchPercent ?? null,
      symbolCount: section.symbols.length,
      symbols: obj
        ? Array.from(section.symbols).map((ref) => {
            const symbol = display.displaySymbol(obj, ref);
            return {
              name: symbol.info.name,
              demangledName: symbol.info.demangledName ?? null,
              kind: symbol.info.kind,
              size: Number(symbol.info.size),
              matchPercent: symbol.matchPercent ?? null,
            };
          })
        : [],
    }));

    // Size-weighted average across code sections, matching how objdiff
    // reports overall progress.
    let weighted = 0;
    let totalSize = 0;
    for (const section of sections) {
      if (section.matchPercent != null && section.size > 0) {
        weighted += section.matchPercent * section.size;
        totalSize += section.size;
      }
    }

    sendJson(res, 200, {
      unit: unitDiff.unit.name,
      targetPath: unitDiff.unit.targetPath,
      basePath: unitDiff.unit.basePath,
      targetError: unitDiff.targetError,
      baseError: unitDiff.baseError,
      matchPercent: totalSize > 0 ? weighted / totalSize : null,
      sections,
    });
  },

  '/api/symbols': async (params, res) => {
    const query = params.get('q') ?? '';
    const options = {
      query,
      mode: parseSearchMode(params.get('mode')),
      caseSensitive: params.get('caseSensitive') === 'true',
      section: params.get('section'),
      minPercent: numberParam(params, 'minPercent'),
      maxPercent: numberParam(params, 'maxPercent'),
    };
    const limit = numberParam(params, 'limit') ?? 50;
    const offset = numberParam(params, 'offset') ?? 0;
    const configOverrides = parseConfigOverrides(params);

    const unitParam = params.get('unit');
    let results: Awaited<ReturnType<typeof searchUnit>> = [];
    const skipped: { unit: string; error: string }[] = [];

    if (!unitParam || unitParam === '*') {
      // Project-wide search: every unit has to be parsed and diffed.
      for (const unit of await listUnits()) {
        try {
          results = results.concat(
            searchUnit(await getUnitDiff(unit.name, configOverrides), options),
          );
        } catch (e) {
          skipped.push({
            unit: unit.name,
            error: e instanceof ApiError ? e.message : String(e),
          });
        }
      }
      if (options.mode === 'fuzzy' && query) {
        results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }
    } else {
      results = searchUnit(
        await getUnitDiff(unitParam, configOverrides),
        options,
      );
    }

    sendJson(res, 200, {
      query,
      mode: options.mode,
      scope: !unitParam || unitParam === '*' ? 'project' : unitParam,
      total: results.length,
      offset,
      limit,
      results: results.slice(offset, offset + limit),
      ...(skipped.length ? { skipped } : {}),
    });
  },

  '/api/match': async (params, res) => {
    const pair = await symbolPairFrom(params);
    const info = pair.left?.symbol.info ?? pair.right?.symbol.info;
    const percent = pair.left?.symbol.matchPercent ?? null;
    const stats = isFunction(pair) ? buildAsmRows(pair).stats : null;

    sendJson(res, 200, {
      unit: pair.unitDiff.unit.name,
      symbol: info?.name ?? pair.name,
      demangledName: info?.demangledName ?? null,
      section: pair.left?.section.name ?? pair.right?.section.name ?? null,
      kind: info?.kind ?? 'unknown',
      matchPercent: percent,
      isMatch: percent != null && percent >= 100,
      target: {
        found: pair.left != null,
        rowCount: pair.left?.symbol.rowCount ?? 0,
        size: pair.left ? Number(pair.left.symbol.info.size) : null,
        address: pair.left
          ? `0x${pair.left.symbol.info.address.toString(16)}`
          : null,
      },
      base: {
        found: pair.right != null,
        rowCount: pair.right?.symbol.rowCount ?? 0,
        size: pair.right ? Number(pair.right.symbol.info.size) : null,
        address: pair.right
          ? `0x${pair.right.symbol.info.address.toString(16)}`
          : null,
      },
      instructions: stats,
      warnings: [pair.unitDiff.targetError, pair.unitDiff.baseError].filter(
        (w) => w != null,
      ),
      links: linksFor(pair.unitDiff.unit.name, info?.name ?? pair.name),
    });
  },

  '/api/diff.html': async (params, res) => {
    const pair = await symbolPairFrom(params);
    const themeRaw = params.get('theme') ?? 'auto';
    if (themeRaw !== 'auto' && themeRaw !== 'light' && themeRaw !== 'dark') {
      throw badRequest(
        'INVALID_PARAMETER',
        `Query parameter "theme" must be auto, light or dark, got "${themeRaw}"`,
      );
    }
    sendText(
      res,
      200,
      renderHtml(pair, {
        theme: themeRaw,
        embed: params.get('embed') === '1' || params.get('embed') === 'true',
      }),
      'text/html; charset=utf-8',
    );
  },

  '/api/diff.txt': async (params, res) => {
    sendText(res, 200, renderText(await symbolPairFrom(params)));
  },

  '/api/diff.json': async (params, res) => {
    const pair = await symbolPairFrom(params);
    if (!isFunction(pair)) {
      throw badRequest(
        'NOT_A_FUNCTION',
        `Symbol "${pair.name}" is not a function`,
        'Use /api/diff.html or /api/diff.txt for data symbols.',
      );
    }
    const { rows, stats } = buildAsmRows(pair);
    const side = (s: (typeof rows)[number]['left']) =>
      s
        ? {
            text: s.spans
              .map((span) => span.text)
              .join('')
              .trimEnd(),
            diffKind: s.diffKind,
          }
        : null;
    sendJson(res, 200, {
      unit: pair.unitDiff.unit.name,
      symbol: pair.left?.symbol.info.name ?? pair.name,
      matchPercent: pair.left?.symbol.matchPercent ?? null,
      instructions: stats,
      rows: rows.map((row) => ({
        index: row.index,
        left: side(row.left),
        right: side(row.right),
      })),
    });
  },
};

/** POST-only routes. Kept separate so a plain GET can never trigger them. */
const postHandlers: Record<
  string,
  (params: URLSearchParams, res: ServerResponse) => Promise<void>
> = {
  '/api/build': async (params, res) => {
    const unit = await findUnit(required(params, 'unit'));
    const steps = await buildUnit(unit);
    const failed = steps.find((s) => s.exitCode !== 0);
    // MSVC writes diagnostics to stdout, so pull the error lines from both
    // streams rather than assuming stderr.
    const diagnostics = failed
      ? `${failed.stdout}\n${failed.stderr}`
          .split('\n')
          .filter((l) => /\b(error|fatal error|warning)\b/i.test(l))
          .slice(0, 20)
          .join('\n')
      : '';
    sendJson(res, failed ? 422 : 200, {
      unit: unit.name,
      ok: !failed,
      steps,
      ...(failed
        ? {
            error: {
              code: 'BUILD_FAILED',
              message: `Building the ${failed.side} object exited with code ${failed.exitCode}`,
              hint:
                diagnostics ||
                'No diagnostic lines matched; read steps[].stdout and steps[].stderr in full.',
              diagnostics,
            },
          }
        : {
            next: `/api/match?unit=${encodeURIComponent(unit.name)}&symbol=…`,
          }),
    });
  },
};

/**
 * Serve a raw file from the project, used by the web UI to fetch objdiff.json
 * and the object files themselves.
 */
const serveFile = (params: URLSearchParams, res: ServerResponse) => {
  const file = required(params, 'path');
  const stream = createReadStream(resolveInProject(file));
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, err.code === 'ENOENT' ? 404 : 500, {
      error: {
        code: err.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'FILE_READ_ERROR',
        message: err.message,
      },
    });
  });
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  });
  stream.pipe(res);
};

// ---------------------------------------------------------------- server

const handle = async (req: IncomingMessage, res: ServerResponse) => {
  // Allow agents and the dev server to call this from another origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`,
  );
  const { pathname, searchParams } = url;

  if (req.method === 'POST') {
    const postHandler = postHandlers[pathname];
    if (!postHandler) {
      sendJson(res, 404, {
        error: {
          code: 'NOT_FOUND',
          message: `No such POST endpoint: ${pathname}`,
          hint: `POST endpoints: ${Object.keys(postHandlers).join(', ')}. Everything else is GET.`,
        },
      });
      return;
    }
    await postHandler(searchParams, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: `${req.method} is not supported`,
        hint: 'Everything is GET except POST /api/build.',
      },
    });
    return;
  }

  if (pathname === '/llms.txt') {
    sendText(res, 200, INSTRUCTIONS_MARKDOWN, 'text/markdown; charset=utf-8');
    return;
  }
  if (pathname === '/api/get') {
    serveFile(searchParams, res);
    return;
  }
  if (pathname === '/' || pathname === '/api') {
    sendJson(res, 200, {
      name: 'objdiff-web API',
      objdiffVersion,
      instructions: '/api/instructions',
      openapi: '/api/openapi.json',
      endpoints: Object.keys(handlers),
      postEndpoints: Object.keys(postHandlers),
      buildEnabled,
    });
    return;
  }

  const handler = handlers[pathname];
  if (!handler) {
    sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: `No such endpoint: ${pathname}`,
        hint: 'GET /api/instructions lists every endpoint.',
      },
    });
    return;
  }
  await handler(searchParams, res);
};

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (e instanceof ApiError) {
      sendJson(res, e.status, e.toJSON());
      return;
    }
    console.error('Unhandled error:', e);
    sendJson(res, 500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: e instanceof Error ? e.message : String(e),
      },
    });
  });
});

server.listen(PORT, () => {
  console.log(`objdiff API listening on http://localhost:${PORT}`);
  console.log(`  objdiff-wasm ${objdiffVersion}`);
  console.log(`  project root: ${projectRoot}  (from ${projectRootSource})`);
  console.log(`  agent docs:   http://localhost:${PORT}/api/instructions`);
  console.log(
    `  build:        ${buildEnabled ? 'enabled (POST /api/build)' : 'disabled (set OBJDIFF_ALLOW_BUILD=1)'}`,
  );
  // Surface a bad project root immediately rather than on the first request.
  loadProjectConfig()
    .then(() => startWatching())
    .catch((e) => {
      console.warn(`  warning: ${e instanceof Error ? e.message : e}`);
    });
});
