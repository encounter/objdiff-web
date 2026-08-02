import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Read the project directory the objdiff desktop app last had open.
 *
 * The desktop app stores its settings in `app.ron`: a JSON object whose
 * `app_config` value is a RON string. Only `project_dir` is needed here, so
 * rather than pulling in a RON parser the field is extracted directly.
 *
 * This is what makes `pnpm dev` work with no configuration — the same way
 * opening objdiff.exe just works.
 */

const candidatePaths = (): string[] => {
  const home = os.homedir();
  const paths: string[] = [];
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    paths.push(path.join(appData, 'objdiff', 'data', 'app.ron'));
  } else if (process.platform === 'darwin') {
    paths.push(
      path.join(
        home,
        'Library',
        'Application Support',
        'objdiff',
        'data',
        'app.ron',
      ),
      path.join(
        home,
        'Library',
        'Application Support',
        'rs.objdiff',
        'data',
        'app.ron',
      ),
    );
  } else {
    const dataHome =
      process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
    paths.push(path.join(dataHome, 'objdiff', 'data', 'app.ron'));
  }
  return paths;
};

/** Unescape a RON string literal (only backslash escapes appear in paths). */
const unescapeRon = (value: string): string =>
  value.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));

export type DesktopConfig = {
  source: string;
  projectDir: string;
  recentProjects: string[];
};

export const readDesktopConfig = (): DesktopConfig | null => {
  for (const file of candidatePaths()) {
    if (!existsSync(file)) {
      continue;
    }
    let appConfig: string;
    try {
      // The outer container is JSON-ish but written with a trailing comma,
      // which JSON.parse rejects.
      const text = readFileSync(file, 'utf8').replace(/,(\s*[}\]])/g, '$1');
      const outer = JSON.parse(text);
      appConfig = outer.app_config;
      if (typeof appConfig !== 'string') {
        continue;
      }
    } catch {
      continue;
    }

    const projectDir = appConfig.match(
      /project_dir:Some\("((?:[^"\\]|\\.)*)"\)/,
    )?.[1];
    if (!projectDir) {
      continue;
    }

    const recent = appConfig.match(/recent_projects:\[([^\]]*)\]/)?.[1] ?? '';
    const recentProjects = [...recent.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
      (m) => unescapeRon(m[1]),
    );

    return {
      source: file,
      projectDir: unescapeRon(projectDir),
      recentProjects,
    };
  }
  return null;
};
