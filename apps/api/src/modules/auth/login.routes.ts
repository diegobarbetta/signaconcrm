import type { FastifyPluginAsync } from "fastify";

import {
  loginWithPassword,
  logoutWithRefreshToken,
  refreshWithRefreshToken,
} from "./login.service.js";

export const authLoginRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const result = await loginWithPassword(fastify.prisma, body.email, body.password);

      if ("error" in result) {
        return reply.code(401).send({ error: result.error });
      }

      return result;
    },
  );

  fastify.post(
    "/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refresh_token"],
          properties: {
            refresh_token: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { refresh_token: string };
      const result = await refreshWithRefreshToken(
        fastify.prisma,
        body.refresh_token,
      );

      if ("error" in result) {
        return reply.code(401).send({ error: result.error });
      }

      return result;
    },
  );

  fastify.post(
    "/logout",
    {
      schema: {
        body: {
          type: "object",
          required: ["refresh_token"],
          properties: {
            refresh_token: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { refresh_token: string };
      const result = await logoutWithRefreshToken(
        fastify.prisma,
        body.refresh_token,
      );

      if ("error" in result) {
        return reply.code(401).send({ error: result.error });
      }

      return reply.code(204).send();
    },
  );
};
