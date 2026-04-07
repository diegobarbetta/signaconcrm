import type { FastifyPluginAsync } from "fastify";

import { requireAdmin } from "../auth/require-admin.js";

export const rolesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    { preHandler: requireAdmin },
    async (_request, reply) => {
      const rows = await fastify.prisma.role.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, dataScope: true },
      });
      return reply.send(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          data_scope: r.dataScope,
        })),
      );
    },
  );
};
