import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).$scramjet;
  delete (window as any).devtools;
});

describe.each(['/app/', '/nested/app/', '/'])('agent paths under %s', (base) => {
  it.each(['nyx', 'devtools'])('fetches and injects the %s agent using the shell base', async (kind) => {
    vi.stubGlobal('__ddxBase', base);
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(url);
      return new Response('window.agentLoaded = true;');
    });
    let onPost: ((context: any) => void) | undefined;
    // Only the external Scramjet hook boundary is doubled; loading and
    // executing the agent goes through the real installer.
    (window as any).$scramjet = { Plugin: class {
      tap(_hook: unknown, callback: (context: any) => void) { onPost = callback; }
    } };
    (window as any).devtools = { isEnabledForTab: () => true };
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-tab-id', 'tab-1');
    document.body.appendChild(iframe);
    const target = iframe.contentWindow!;
    const controller = { frames: [{ element: iframe, url: 'https://example.org/', hooks: { init: { post: {} } } }] };
    let cleanup = () => {};
    try {
      if (kind === 'nyx') {
        const module = await import('../src/apis/nyxBridge/hookInstaller');
        cleanup = module._resetNyxBridgeHook;
        module.installNyxBridgeHook({ controller, allowlist: [], onAgentMessage: () => {} });
      } else {
        const { installDevToolsHook } = await import('../src/apis/devtools/hookInstaller');
        installDevToolsHook(controller, { registerProxiedWindow: () => {} } as any);
      }
      onPost!({ window: target, isTopLevel: true });
      await vi.waitFor(() => expect((target as any).agentLoaded).toBe(true));
      expect(requests).toEqual([`${location.origin}${base}assets/${kind === 'nyx' ? 'nyx-bridge' : 'devtools'}-agent.js`]);
    } finally { cleanup(); iframe.remove(); }
  });
});
