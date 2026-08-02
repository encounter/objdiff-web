/**
 * Node.js loader for objdiff-wasm.
 *
 * objdiff-wasm is transpiled by jco with `--no-nodejs-compat`, so it loads its
 * core module with `fetch(new URL('./objdiff.core.wasm', import.meta.url))`.
 * Node's fetch rejects `file:` URLs, so we bridge them to the filesystem here.
 *
 * This module must be imported before anything that touches objdiff-wasm.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const nativeFetch = globalThis.fetch;

const toUrl = (input: RequestInfo | URL): URL | null => {
  try {
    if (input instanceof URL) {
      return input;
    }
    if (typeof input === 'string') {
      return new URL(input);
    }
    return new URL(input.url);
  } catch {
    return null;
  }
};

globalThis.fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = toUrl(input);
  if (url?.protocol === 'file:') {
    const body = await readFile(fileURLToPath(url));
    return new Response(body, {
      headers: { 'content-type': 'application/wasm' },
    });
  }
  return nativeFetch(input, init);
};

const objdiff = await import('objdiff-wasm');

objdiff.init(
  (process.env.OBJDIFF_LOG_LEVEL as Parameters<typeof objdiff.init>[0]) ??
    'warn',
);

export const { diff, display, version } = objdiff;
export const objdiffVersion = objdiff.version();
