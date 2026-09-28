import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const GA_ENDPOINT = "https://www.google-analytics.com/mp/collect";
const MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID ?? "";
const API_SECRET = process.env.GA_API_SECRET ?? "";

type BeaconBody = {
  client_id?: string;
  events?: Array<{ name: string; params?: Record<string, unknown> }>;
};

export function beaconRoute(app: FastifyInstance, path: string) {
  app.post<{ Body: BeaconBody }>(
    path,
    async (
      request: FastifyRequest<{ Body: BeaconBody }>,
      reply: FastifyReply,
    ) => {
      // Always 204 to keep beacons opaque and non-cacheable to observers.
      reply.header("Cache-Control", "no-store, max-age=0");

      if (!MEASUREMENT_ID || !API_SECRET) {
        // Analytics not configured — accept + drop.
        return reply.code(204).send();
      }
      if (
        !request.body ||
        !Array.isArray(request.body.events) ||
        !request.body.client_id
      ) {
        return reply.code(204).send();
      }
      try {
        // Fire and forget — telemetry must never delay the client response.
        void fetch(
          `${GA_ENDPOINT}?measurement_id=${encodeURIComponent(
            MEASUREMENT_ID,
          )}&api_secret=${encodeURIComponent(API_SECRET)}`,
          {
            method: "POST",
            body: JSON.stringify(request.body),
            headers: { "Content-Type": "application/json" },
          },
        ).catch(() => {
          /* swallow */
        });
      } catch {
        /* swallow — telemetry must never break app */
      }
      return reply.code(204).send();
    },
  );
}
