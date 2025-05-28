import { diff } from 'objdiff-wasm';
import { useMemo } from 'react';
import type { ConfigProperties } from '../shared/config';
import type { BuildStatus } from '../shared/messages';
import { buildDiffConfig } from './state';

export type DiffInput = {
  leftStatus: BuildStatus | null;
  rightStatus: BuildStatus | null;
  leftObject: ArrayBuffer | null;
  rightObject: ArrayBuffer | null;
  configProperties: ConfigProperties;
  mappingConfig: diff.MappingConfig;
};

export type DiffOutput = {
  leftStatus: BuildStatus | null;
  rightStatus: BuildStatus | null;
  diff: diff.DiffResult | null;
  lastBuilt: number | null;
  isMapping: boolean;
};

export const useDiff = ({
  leftStatus,
  rightStatus,
  leftObject,
  rightObject,
  configProperties,
  mappingConfig,
}: DiffInput) =>
  useMemo(() => {
    const start = performance.now();
    const diffConfig = buildDiffConfig(configProperties);
    let left: diff.Object | undefined;
    let right: diff.Object | undefined;
    try {
      left =
        leftObject?.byteLength && leftStatus?.success
          ? diff.Object.parse(new Uint8Array(leftObject), diffConfig)
          : undefined;
    } catch (e) {
      leftStatus = {
        success: false,
        cmdline: leftStatus?.cmdline ?? '',
        stdout: '',
        stderr: `Failed to parse left object: ${e}`,
      };
    }
    try {
      right =
        rightObject?.byteLength && rightStatus?.success
          ? diff.Object.parse(new Uint8Array(rightObject), diffConfig)
          : undefined;
    } catch (e) {
      rightStatus = {
        success: false,
        cmdline: rightStatus?.cmdline ?? '',
        stdout: '',
        stderr: `Failed to parse right object: ${e}`,
      };
    }
    const result = diff.runDiff(left, right, diffConfig, mappingConfig);
    const end = performance.now();
    console.debug('Diff time:', end - start, 'ms');
    return {
      leftStatus,
      rightStatus,
      diff: result,
      lastBuilt: Date.now(),
      isMapping:
        mappingConfig.selectingLeft != null ||
        mappingConfig.selectingRight != null,
    };
  }, [
    leftStatus,
    rightStatus,
    leftObject,
    rightObject,
    configProperties,
    mappingConfig,
  ]);
