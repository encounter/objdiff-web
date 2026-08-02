// Runs the API server and the web dev server together.
//
// The web dev server proxies /api to the API server, so the UI and the API
// share an origin and the Build button can reach POST /api/build.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPort = process.env.OBJDIFF_API_PORT ?? '3001';
const webPort = process.env.PORT ?? '3000';

// The project root is resolved by the servers themselves: OBJDIFF_PROJECT_ROOT
// if set, otherwise whatever project the objdiff desktop app last had open.

const children = [];

const start = (name, color, command, args, env) => {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        out.write(`${prefix}${line}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    // If either half dies the pair is useless, so bring the other down too.
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
};

let shuttingDown = false;
const shutdown = (code) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('api', '36', 'npx', ['tsx', 'watch', 'server/index.ts'], {
  PORT: apiPort,
});
start('web', '35', 'npx', ['rsbuild', 'dev', '--port', webPort], {
  OBJDIFF_API_PROXY: '1',
  OBJDIFF_API_PORT: apiPort,
  PORT: webPort,
});

console.log(`\x1b[35m[web]\x1b[0m  http://localhost:${webPort}`);
console.log(`\x1b[36m[api]\x1b[0m  http://localhost:${apiPort}`);
