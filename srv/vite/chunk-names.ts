import { createHash } from 'node:crypto';
import type { BuildConfig } from './build-config';
import { ARTIFACT_WORDS } from './build-config';

const POOL = ['main', 'vendor', 'runtime', 'client', 'polyfills', 'app', 'common', 'shared', 'core', 'utils', 'store'];

export function createChunkNaming(config: BuildConfig, seed: string) {
  const shuffled = [...POOL];
  const rng = createHash('sha256').update(`${seed}:pool`).digest();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const target = rng[i % rng.length]! % (i + 1);
    [shuffled[i], shuffled[target]] = [shuffled[target]!, shuffled[i]!];
  }
  const assigned = new Map<string, string>();
  const nameFor = (key: string) => {
    if (!assigned.has(key)) {
      assigned.set(key, shuffled[assigned.size % shuffled.length]!);
    }
    return assigned.get(key)!;
  };

  const safeHash = (source: string) => {
    for (let salt = 0; ; salt++) {
      const hash = createHash('sha256')
        .update(salt === 0 ? source : `${source}#${salt}`)
        .digest('base64url')
        .slice(0, 8);
      if (!ARTIFACT_WORDS.some(word => hash.toLowerCase().includes(word))) return hash;
    }
  };

  return {
    entryFileNames: (chunk: any) => `chunks/${nameFor(chunk.name)}-[hash].js`,
    chunkFileNames: (chunk: any) => `chunks/${nameFor(chunk.name)}-[hash].js`,
    assetFileNames: (asset: any) => {
      if (asset.name?.endsWith('.woff2') || asset.name?.endsWith('.ttf')) return `assets/${asset.name}`;
      const ext = asset.name?.split('.').pop() ?? 'bin';
      return `assets/[hash].${ext}`;
    },
    manualChunks: (id: string) => {
      if (!id.includes('node_modules')) return;
      if (id.includes('@mercuryworkshop/libcurl-transport')) return 'runtime';
      if (id.includes('@mercuryworkshop/epoxy-transport')) return 'polyfills';
      if (
        id.includes('@mercuryworkshop/scramjet') ||
        id.includes('@mercuryworkshop/wisp-js') ||
        id.includes('@mercuryworkshop/proxy-transports')
      ) return 'core';
      if (id.includes('node_modules/chii') || id.includes('node_modules/chobitsu')) return 'utils';
      if (id.includes('node_modules/eruda')) return 'store';
      if (id.includes('@dnd-kit')) return 'client';
      if (id.includes('@nightnetwork')) return 'app';
      if (id.includes('node_modules/react') || id.includes('node_modules/scheduler') || id.includes('node_modules/react-dom')) return 'main';
      if (id.includes('node_modules/lucide')) return 'shared';
      return 'common';
    },
    safeHash,
  };
}
