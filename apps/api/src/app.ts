import cors from "@fastify/cors";
import Fastify, { type FastifyError } from "fastify";

import { authLoginRoutes } from "./modules/auth/login.routes.js";
import { rolesRoutes } from "./modules/roles/roles.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { rbacRoutes } from "./modules/rbac/rbac.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { clientsRoutes } from "./modules/clients/clients.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { demandsRoutes } from "./modules/demands/demands.routes.js";
import { leadsRoutes } from "./modules/leads/leads.routes.js";
import { tasksRoutes } from "./modules/tasks/tasks.routes.js";
import { whatsappWebhookRoutes } from "./modules/whatsapp/webhook.routes.js";
import { whatsappConversationsRoutes } from "./modules/whatsapp/conversations.routes.js";
import { whatsappMetricsRoutes } from "./modules/whatsapp/metrics.routes.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { prismaPlugin } from "./plugins/prisma.js";

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
const isProd = process.env.NODE_ENV === "production";

export type BuildAppOptions = {
  logger?: boolean;
};

export async function buildApp(options?: BuildAppOptions) {
  const jwt = process.env.JWT_SECRET;
  if (!jwt || jwt.length < 32) {
    throw new Error(
      "JWT_SECRET deve estar definido com pelo menos 32 caracteres (ver .env.example).",
    );
  }

  const logger = options?.logger ?? true;
  const app = Fastify({ logger });

  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  await app.register(metricsPlugin);
  await app.register(prismaPlugin);
  await app.register(authLoginRoutes, { prefix: "/auth" });
  await app.register(usersRoutes, { prefix: "/users" });
  await app.register(rolesRoutes, { prefix: "/roles" });
  await app.register(leadsRoutes, { prefix: "/leads" });
  await app.register(clientsRoutes, { prefix: "/clients" });
  await app.register(demandsRoutes, { prefix: "/demands" });
  await app.register(tasksRoutes, { prefix: "/tasks" });
  await app.register(dashboardRoutes, { prefix: "/dashboard" });
  await app.register(rbacRoutes, { prefix: "/rbac" });
  await app.register(auditRoutes, { prefix: "/audit" });
  await app.register(whatsappWebhookRoutes, { prefix: "/whatsapp" });
  await app.register(whatsappConversationsRoutes, { prefix: "/whatsapp" });
  await app.register(whatsappMetricsRoutes, { prefix: "/whatsapp" });

  app.get("/health", async () => ({
    ok: true as const,
    service: "signacon-api",
  }));

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (isProd) {
      reply.status(statusCode).send({
        error: "Erro interno",
        statusCode,
      });
      return;
    }
    reply.status(statusCode).send({
      error: error.message,
      statusCode,
      stack: error.stack,
    });
  });

  return app;
}
