import type { FastifyPluginAsync } from "fastify";

import { requirePermission } from "../auth/require-permission.js";
import { listAuditLogs } from "./audit.service.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export const auditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/logs",
    {
      preHandler: requirePermission("audit.read"),
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as { limit?: string; offset?: string };
      let limit = Number.parseInt(q.limit ?? String(DEFAULT_LIMIT), 10);
      let offset = Number.parseInt(q.offset ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1) {
        limit = DEFAULT_LIMIT;
      }
      if (limit > MAX_LIMIT) {
        limit = MAX_LIMIT;
      }
      if (!Number.isFinite(offset) || offset < 0) {
        offset = 0;
      }

      const entries = await listAuditLogs(fastify.prisma, { limit, offset });
      return reply.send(entries);
    },
  );
};
