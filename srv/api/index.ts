import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { plusAPI } from "./plus";
import { beaconRoute } from "./beacon";
import { createBuildConfig, resolveSeed } from "../vite/build-config";

const __beaconConfig = createBuildConfig(resolveSeed());
const __beaconPath = `${__beaconConfig.workspace}${__beaconConfig.cover.route}/${__beaconConfig.routes.assets}/${__beaconConfig.rpc.token}/beacon`;

async function APIRouter(app: FastifyInstance) {
  beaconRoute(app, __beaconPath);

  // search suggestions
  app.get(
    "/api/results/:query",
    async (
      request: FastifyRequest<{
        Params: { query: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { query } = request.params;

      try {
        const response = await fetch(
          `http://api.duckduckgo.com/ac?q=${query}&format=json`,
        );
        const data = await response.json();
        return reply.send(data);
      } catch (error) {
        console.error("Error fetching search results:", error);
        return reply.status(500).send("Failed to fetch search results");
      }
    },
  );

  // Server only route that the frontend can reference for detection of static shit
  app.get(
    "/api/detect",
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply
        .status(200)
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-cache, no-store, must-revalidate")
        .send({ server: true });
    },
  );

  plusAPI(app);
}

export { APIRouter };
export default APIRouter;
