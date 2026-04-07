import type { FastifyPluginAsync } from "fastify";

import { requireAuth, requirePermission } from "../auth/require-permission.js";

export const rbacRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const u = request.authUser!;
      return reply.send({
        id: u.id,
        email: u.email,
        role: u.role,
        data_scope: u.dataScope,
        permissions: u.permissions,
      });
    },
  );

  fastify.get(
    "/smoke",
    { preHandler: requirePermission("rbac.smoke") },
    async (_request, reply) => {
      return reply.send({ ok: true });
    },
  );
};
