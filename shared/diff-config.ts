import type { diff } from 'objdiff-wasm';
import { type ConfigProperties, getModifiedConfigProperties } from './config';

/**
 * Apply the user's config properties to a WASM DiffConfig.
 *
 * Only properties that differ from their default are sent across, which keeps
 * the config object small.
 *
 * This module deliberately imports objdiff-wasm as a *type* only: the webview
 * and the API server each load the WASM themselves, and the server has to
 * install a `fetch` bridge before that happens.
 */
export const applyConfigProperties = (
  config: diff.DiffConfig,
  configProperties: ConfigProperties,
): diff.DiffConfig => {
  const props = getModifiedConfigProperties(configProperties);
  for (const key in props) {
    if (props[key] != null) {
      config.setProperty(key, props[key].toString());
    }
  }
  return config;
};
