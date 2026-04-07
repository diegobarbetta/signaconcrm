import type { FastifyPluginAsync } from "fastify";

import { requirePermission } from "../auth/require-permission.js";
import { getDashboardSummary } from "./dashboard.service.js";

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/summary",
    {
      preHandler: requirePermission("dashboard.read"),
      schema: {
        querystring: {
          type: "object",
          properties: {
            task_preview_limit: { type: "string" },
            demand_preview_limit: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as {
        task_preview_limit?: string;
        demand_preview_limit?: string;
      };

      let taskPreviewLimit = Number.parseInt(q.task_preview_limit ?? "0", 10);
      let demandPreviewLimit = Number.parseInt(q.demand_preview_limit ?? "0", 10);
      if (!Number.isFinite(taskPreviewLimit) || taskPreviewLimit < 0) {
        taskPreviewLimit = 0;
      }
      if (!Number.isFinite(demandPreviewLimit) || demandPreviewLimit < 0) {
        demandPreviewLimit = 0;
      }

      const summary = await getDashboardSummary(fastify.prisma, {
        taskPreviewLimit,
        demandPreviewLimit,
      });

      return reply.send(summary);
    },
  );
};
