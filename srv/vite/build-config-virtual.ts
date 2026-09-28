import type { Plugin } from 'vite';
import type { BuildConfig } from './build-config';

const VIRTUAL_ID = 'virtual:ddx-build-config';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

export function buildConfigVirtualPlugin(config: BuildConfig): Plugin {
  return {
    name: 'ddx-build-config-virtual',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return `export default Object.freeze(${JSON.stringify(config)});`;
      }
    },
  };
}
