// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIRouter } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('analytics tag proxy', () => {
  it('serves the fixed Google tag without forwarding caller-controlled URLs or cookies', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('window.tagLoaded = true;'));
    vi.stubGlobal('fetch', upstream);
    const app = Fastify();
    await APIRouter(app);
    try {
      const response = await app.inject({ url: '/api/tag.js?url=https://example.com&id=G-OTHER', headers: { cookie: 'session=private' } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/javascript');
      expect(response.body).toBe('window.tagLoaded = true;');
      expect(upstream).toHaveBeenCalledWith('https://www.googletagmanager.com/gtag/js?id=G-BMERY7ZH6Z', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
      expect(upstream.mock.calls[0][1].headers).toBeUndefined();
    } finally { await app.close(); }
  });

  it.each(['reject', 'http-error'])('returns non-cacheable 502 on upstream %s', async (failure) => {
    vi.stubGlobal('fetch', failure === 'reject'
      ? vi.fn().mockRejectedValue(new Error('offline'))
      : vi.fn().mockResolvedValue(new Response('upstream error', { status: 503 })));
    const app = Fastify();
    await APIRouter(app);
    try {
      const response = await app.inject('/api/tag.js');
      expect(response.statusCode).toBe(502);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain('upstream error');
    } finally { await app.close(); }
  });
});
