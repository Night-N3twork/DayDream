import type { Plugin } from 'rolldown';
import { createBuildConfig, resolveSeed } from './build-config';

const VIRTUAL_ID = 'virtual:ddx-build-config';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Provide the build config to standalone Rolldown bundles (SW, extension bootstrap). */
export function rolldownBuildConfigPlugin(seed = resolveSeed()): Plugin {
  const config = createBuildConfig(seed);
  return {
    name: 'ddx-rolldown-build-config',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export default Object.freeze(${JSON.stringify(config)});`;
      }
      return null;
    },
  };
}
