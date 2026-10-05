// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { loadConfigFromFile } from 'vite';
import { minify } from 'terser';

it('preserves the embedded extension chrome.debugger namespace through production chunk processing', async () => {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, 'vite.config.ts');
  const config = loaded!.config;
  const bootstrap = readFileSync('src/core/helium/bootstrap/dist/helium-bootstrap.js', 'utf8');
  const source = `debugger; globalThis.bootstrap = ${JSON.stringify(bootstrap)};`;
  // maxWorkers is Vite's worker-pool setting, not a Terser parser option.
  const { maxWorkers: _maxWorkers, ...terserOptions } = (config.build as any).terserOptions;
  const result = await minify(source, terserOptions);
  const chunk = { type: 'chunk', code: result.code! };
  for (const plugin of (config.plugins as any[]).flat(Infinity)) {
    if (plugin?.name === 'strip-console-and-debugger' && typeof plugin.generateBundle === 'function') {
      await plugin.generateBundle({}, { 'main.js': chunk });
    }
  }
  const context: any = vm.createContext({});
  vm.runInContext(chunk.code, context);
  expect(context.bootstrap).toContain('this.debugger=');
  expect(() => new vm.Script(context.bootstrap)).not.toThrow();
  expect(chunk.code.startsWith('debugger;')).toBe(false);
});
