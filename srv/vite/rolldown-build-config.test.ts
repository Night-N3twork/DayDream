// @vitest-environment node
import vm from 'node:vm';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'rolldown';
import { rolldownBuildConfigPlugin } from './rolldown-build-config';

let tempDir = '';
afterEach(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

it('embeds a runtime build config in standalone rolldown IIFEs', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ddx-build-config-'));
  const input = join(tempDir, 'entry.js');
  await writeFile(input, `import config from 'virtual:ddx-build-config'; globalThis.result = config.cover.identity.product;`);
  const result = await build({
    input,
    platform: 'browser',
    plugins: [rolldownBuildConfigPlugin('bootstrap-test-seed')],
    output: { format: 'iife' },
  });
  const code = result.output.find(item => item.type === 'chunk')?.code;
  expect(code).toBeTruthy();
  const context: any = vm.createContext({});
  vm.runInContext(code!, context);
  expect(context.result).toBe('Workspace');
});
