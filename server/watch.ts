import { watch } from 'node:fs';
import path from 'node:path';

import picomatch from 'picomatch';

import { type BuildStep, buildEnabled, buildUnit } from './build';
import { lastRequestedUnit } from './diff';
import { findUnit, loadProjectConfig, projectRoot } from './project';

/**
 * Rebuild automatically when source files change, mirroring the "Rebuild on
 * changes" option in the objdiff desktop app.
 *
 * On by default; set `OBJDIFF_WATCH=0` to turn it off. Pointless without
 * building, so it follows that switch too.
 */
export const watchEnabled = process.env.OBJDIFF_WATCH !== '0' && buildEnabled;

const DEBOUNCE_MS = Number(process.env.OBJDIFF_WATCH_DEBOUNCE_MS ?? 300);

export type WatchStatus = {
  enabled: boolean;
  watching: string | null;
  lastTrigger: { file: string; at: string } | null;
  lastBuild: {
    unit: string;
    ok: boolean;
    at: string;
    steps: BuildStep[];
    error?: string;
  } | null;
};

const status: WatchStatus = {
  enabled: watchEnabled,
  watching: null,
  lastTrigger: null,
  lastBuild: null,
};

export const watchStatus = (): WatchStatus => status;

let timer: ReturnType<typeof setTimeout> | undefined;
let building = false;
let pending = false;

const rebuild = async () => {
  // The API has no "current file", so the most recently queried unit stands in
  // for it — the same unit the caller is iterating on.
  const unitName = lastRequestedUnit();
  if (!unitName) {
    return;
  }
  if (building) {
    pending = true;
    return;
  }
  building = true;
  try {
    const unit = await findUnit(unitName);
    const steps = await buildUnit(unit);
    const failed = steps.find((s) => s.exitCode !== 0);
    status.lastBuild = {
      unit: unit.name,
      ok: !failed,
      at: new Date().toISOString(),
      steps,
    };
    console.log(
      failed
        ? `watch: rebuilt ${unit.name} — FAILED (${failed.side}, code ${failed.exitCode})`
        : `watch: rebuilt ${unit.name}`,
    );
  } catch (e) {
    status.lastBuild = {
      unit: unitName,
      ok: false,
      at: new Date().toISOString(),
      steps: [],
      error: e instanceof Error ? e.message : String(e),
    };
    console.warn(`watch: rebuild of ${unitName} failed:`, e);
  } finally {
    building = false;
    if (pending) {
      pending = false;
      void rebuild();
    }
  }
};

/** Start watching the project's source files. Safe to call when disabled. */
export const startWatching = async (): Promise<void> => {
  if (!watchEnabled) {
    return;
  }
  const config = await loadProjectConfig();
  const patterns = config.watch_patterns ?? [];
  if (patterns.length === 0) {
    console.warn('watch: objdiff.json has no watch_patterns; not watching');
    return;
  }
  // Patterns are bare globs like `*.c`, so match against the basename as well
  // as the project-relative path.
  const isMatch = picomatch(patterns, { dot: true });

  try {
    watch(projectRoot, { recursive: true }, (_event, filename) => {
      if (!filename) {
        return;
      }
      const relative = filename.toString().replace(/\\/g, '/');
      if (!isMatch(relative) && !isMatch(path.basename(relative))) {
        return;
      }
      status.lastTrigger = { file: relative, at: new Date().toISOString() };
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), DEBOUNCE_MS);
    });
  } catch (e) {
    console.warn(`watch: could not watch ${projectRoot}:`, e);
    return;
  }

  status.watching = projectRoot;
  console.log(
    `  watching:     ${projectRoot} (${patterns.length} patterns, ${DEBOUNCE_MS}ms debounce)`,
  );
};
