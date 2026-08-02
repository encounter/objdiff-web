import { execFile } from 'node:child_process';

import { ApiError } from './errors';
import { type ResolvedUnit, loadProjectConfig, projectRoot } from './project';

/**
 * Whether building is allowed at all.
 *
 * On by default, matching the desktop app. Set `OBJDIFF_ALLOW_BUILD=0` to turn
 * it off — worth doing if this port is ever reachable by anything other than
 * you, since the build command comes from objdiff.json and runs as a real
 * process.
 */
export const buildEnabled = process.env.OBJDIFF_ALLOW_BUILD !== '0';

const TIMEOUT_MS = Number(process.env.OBJDIFF_BUILD_TIMEOUT_MS ?? 120_000);

export type BuildStep = {
  side: 'target' | 'base';
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const run = (
  side: 'target' | 'base',
  command: string,
  args: string[],
): Promise<BuildStep> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    execFile(
      command,
      args,
      { cwd: projectRoot, encoding: 'utf8', timeout: TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error && !stdout && !stderr) {
          reject(
            new ApiError(
              500,
              'BUILD_SPAWN_FAILED',
              `Could not run "${command}": ${error.message}`,
              `Check custom_make/custom_args in objdiff.json. The command runs with cwd=${projectRoot}.`,
            ),
          );
          return;
        }
        resolve({
          side,
          command,
          args,
          exitCode:
            error && typeof error.code === 'number'
              ? error.code
              : error
                ? -1
                : 0,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        });
      },
    );
  });

/**
 * Build a unit's objects using the project's own build command, exactly as the
 * desktop app and the VS Code extension do: `[custom_make] [custom_args] <path>`.
 *
 * Only paths that already appear in objdiff.json are ever passed through, so a
 * caller cannot inject a command or an arbitrary path.
 */
export const buildUnit = (unit: ResolvedUnit): Promise<BuildStep[]> => {
  if (!buildEnabled) {
    return Promise.reject(
      new ApiError(
        403,
        'BUILD_DISABLED',
        'Building is disabled on this server',
        'Start the server with OBJDIFF_ALLOW_BUILD=1 to enable it. It runs the command from objdiff.json as a real process.',
      ),
    );
  }
  // Builds are serialized process-wide. Two compilers writing the same target
  // at once fight over the shared PDB — MSVC fails with C1033 — and the watcher
  // and an explicit /api/build request can easily overlap.
  const result = queue.then(() => buildUnitLocked(unit));
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

let queue: Promise<void> = Promise.resolve();

const buildUnitLocked = async (unit: ResolvedUnit): Promise<BuildStep[]> => {
  const config = await loadProjectConfig();
  const command = config.custom_make || 'make';
  const args = config.custom_args ?? [];

  const steps: BuildStep[] = [];
  if (unit.targetPath && config.build_target) {
    steps.push(await run('target', command, [...args, unit.targetPath]));
  }
  if (unit.basePath && config.build_base !== false) {
    steps.push(await run('base', command, [...args, unit.basePath]));
  }
  if (steps.length === 0) {
    throw new ApiError(
      400,
      'NOTHING_TO_BUILD',
      `Unit "${unit.name}" has no buildable object`,
      'build_target and build_base are both disabled, or the unit has no paths.',
    );
  }
  return steps;
};
