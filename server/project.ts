import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CONFIG_FILENAME,
  type ProjectConfig,
  type Unit,
  resolveProjectConfig,
} from '../shared/config';
import { readDesktopConfig } from './desktop-config';
import { ApiError } from './errors';

/**
 * Where the decomp project lives.
 *
 * Falls back to whatever the objdiff desktop app last had open, so this works
 * with no configuration on a machine that already uses objdiff.
 *
 * The env var is trimmed because `set VAR=value && cmd` on Windows captures the
 * space before the `&&` into the value, which breaks every path built from it.
 */
const resolveProjectRoot = (): { root: string; source: string } => {
  const fromEnv = process.env.OBJDIFF_PROJECT_ROOT?.trim();
  if (fromEnv) {
    return { root: path.resolve(fromEnv), source: 'OBJDIFF_PROJECT_ROOT' };
  }
  const desktop = readDesktopConfig();
  if (desktop) {
    return {
      root: path.resolve(desktop.projectDir),
      source: `objdiff desktop settings (${desktop.source})`,
    };
  }
  return { root: path.resolve('../prime'), source: 'default' };
};

const resolved = resolveProjectRoot();
export const projectRoot = resolved.root;
export const projectRootSource = resolved.source;

export type ResolvedUnit = {
  unit: Unit;
  name: string;
  targetPath: string | null;
  basePath: string | null;
};

type LoadedConfig = {
  config: ProjectConfig;
  mtimeMs: number;
};

let cached: LoadedConfig | null = null;

/**
 * Resolve a project-relative path, refusing anything that escapes the project
 * root. `path.relative` is used rather than a prefix check so that sibling
 * directories sharing a name prefix are rejected too.
 */
export const resolveInProject = (relative: string): string => {
  const resolved = path.resolve(projectRoot, relative);
  const rel = path.relative(projectRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ApiError(
      403,
      'PATH_OUTSIDE_PROJECT',
      `Path escapes the project root: ${relative}`,
      'Paths must be relative to OBJDIFF_PROJECT_ROOT.',
    );
  }
  return resolved;
};

/** Load and cache `objdiff.json`, reloading when the file changes on disk. */
export const loadProjectConfig = async (): Promise<ProjectConfig> => {
  const configPath = path.join(projectRoot, CONFIG_FILENAME);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(configPath)).mtimeMs;
  } catch {
    throw new ApiError(
      500,
      'NO_PROJECT_CONFIG',
      `No ${CONFIG_FILENAME} found at ${configPath}`,
      'Set OBJDIFF_PROJECT_ROOT to a directory containing objdiff.json.',
    );
  }
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.config;
  }
  let parsed: ProjectConfig;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (e) {
    throw new ApiError(
      500,
      'INVALID_PROJECT_CONFIG',
      `Failed to parse ${CONFIG_FILENAME}: ${e}`,
    );
  }
  const config = resolveProjectConfig(parsed);
  cached = { config, mtimeMs };
  return config;
};

const toResolved = (unit: Unit): ResolvedUnit => ({
  unit,
  name: unit.name || unit.path || '<unnamed>',
  targetPath: unit.target_path ?? null,
  basePath: unit.base_path ?? null,
});

export const listUnits = async (): Promise<ResolvedUnit[]> =>
  (await loadProjectConfig()).units?.map(toResolved) ?? [];

/**
 * Find a unit by name or by path. Matching is case-insensitive and treats
 * `/` and `\` as equivalent, since agents tend to pass whatever separator
 * their platform uses.
 */
export const findUnit = async (query: string): Promise<ResolvedUnit> => {
  const units = await listUnits();
  const normalize = (s: string) => s.toLowerCase().replace(/\\/g, '/');
  const wanted = normalize(query);
  const match =
    units.find((u) => normalize(u.name) === wanted) ??
    units.find((u) => u.unit.path && normalize(u.unit.path) === wanted) ??
    units.find(
      (u) =>
        u.unit.path &&
        normalize(u.unit.path).replace(/\.o$/, '') ===
          wanted.replace(/\.[co]$/, ''),
    );
  if (!match) {
    const sample = units.slice(0, 5).map((u) => u.name);
    throw new ApiError(
      404,
      'UNIT_NOT_FOUND',
      `No unit named "${query}"`,
      `Call GET /api/units to list them. First few: ${sample.join(', ') || '(none)'}`,
    );
  }
  return match;
};

export type UnitObjects = {
  target: Uint8Array | null;
  base: Uint8Array | null;
  /** Identity of the on-disk bytes, used as a cache key. */
  stamp: string;
};

const readObject = async (
  relative: string | null,
): Promise<{ data: Uint8Array | null; stamp: string }> => {
  if (!relative) {
    return { data: null, stamp: 'none' };
  }
  const abs = resolveInProject(relative);
  try {
    const info = await stat(abs);
    const data = await readFile(abs);
    return { data, stamp: `${info.mtimeMs}:${info.size}` };
  } catch {
    // A missing object is normal: it just means that side has not been built.
    return { data: null, stamp: 'missing' };
  }
};

export const readUnitObjects = async (
  unit: ResolvedUnit,
): Promise<UnitObjects> => {
  const [target, base] = await Promise.all([
    readObject(unit.targetPath),
    readObject(unit.basePath),
  ]);
  if (!target.data && !base.data) {
    throw new ApiError(
      404,
      'NO_OBJECTS',
      `Neither object exists for unit "${unit.name}"`,
      `Expected target at "${unit.targetPath}" and base at "${unit.basePath}", relative to ${projectRoot}. Build the project first.`,
    );
  }
  return {
    target: target.data,
    base: base.data,
    stamp: `${target.stamp}|${base.stamp}`,
  };
};
