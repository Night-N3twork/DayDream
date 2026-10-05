import type { FastifyInstance } from 'fastify';

// Fixed upstream: this endpoint must never become an arbitrary URL proxy.
const TAG_URL = 'https://www.googletagmanager.com/gtag/js?id=G-BMERY7ZH6Z';

export function analyticsTagRoute(app: FastifyInstance) {
  app.get('/api/tag.js', async (_request, reply) => {
    try {
      const response = await fetch(TAG_URL, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Tag upstream unavailable');
      const script = await response.text();
      return reply
        .header('Cache-Control', 'public, max-age=300')
        .type('application/javascript; charset=utf-8')
        .send(script);
    } catch {
      return reply.header('Cache-Control', 'no-store').code(502).send();
    }
  });
}
