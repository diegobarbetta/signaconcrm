import type { FastifyPluginAsync } from "fastify";

import { requireAdmin } from "../auth/require-admin.js";
import { requireAnyPermission } from "../auth/require-permission.js";
import { createUser, listUsers, updateUser } from "./users.service.js";

const uuidParam = {
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern:
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    },
  },
} as const;

export const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    { preHandler: requireAdmin },
    async (_request, reply) => {
      const users = await listUsers(fastify.prisma);
      return reply.send(users);
    },
  );

  /** Lista mínima de utilizadores ativos para atribuição (lead/conversa). */
  fastify.get(
    "/for-assignment",
    {
      preHandler: requireAnyPermission(
        "users.manage",
        "leads.assign",
        "whatsapp.conversations.assign",
      ),
    },
    async (_request, reply) => {
      const rows = await fastify.prisma.user.findMany({
        where: { status: "active" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      });
      return reply.send(rows);
    },
  );

  fastify.post(
    "/",
    {
      preHandler: requireAdmin,
      schema: {
        body: {
          type: "object",
          required: ["name", "email", "password", "role"],
          properties: {
            name: { type: "string", minLength: 1 },
            email: { type: "string", minLength: 3 },
            password: { type: "string", minLength: 8 },
            role: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        name: string;
        email: string;
        password: string;
        role: string;
      };

      const result = await createUser(fastify.prisma, body, {
        actorUserId: request.authUser!.id,
      });

      if (result.ok) {
        return reply.code(201).send(result.user);
      }
      if (result.error === "validation") {
        return reply.code(400).send({ error: result.message });
      }
      return reply.code(409).send({ error: result.message });
    },
  );

  fastify.patch(
    "/:id",
    {
      preHandler: requireAdmin,
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            role: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["active", "disabled"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { role?: string; status?: string };

      const result = await updateUser(fastify.prisma, id, body, {
        actorUserId: request.authUser!.id,
      });

      if (result.ok) {
        return reply.send(result.user);
      }
      if (result.error === "not_found") {
        return reply.code(404).send({ error: "Utilizador não encontrado" });
      }
      return reply.code(400).send({ error: result.message });
    },
  );
};
