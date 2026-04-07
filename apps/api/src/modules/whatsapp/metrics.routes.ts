import type { FastifyPluginAsync } from "fastify";

import { requirePermission } from "../auth/require-permission.js";

export const whatsappMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/metrics",
    {
      preHandler: requirePermission("whatsapp.metrics.read"),
    },
    async (_request, reply) => {
      return reply.send(fastify.metrics.summary());
    },
  );
};

