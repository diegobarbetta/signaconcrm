import type { PrismaClient } from "@prisma/client";

import type { AuthUser } from "../modules/auth/require-permission.js";
import type { InMemoryMetrics } from "../lib/metrics.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    metrics: InMemoryMetrics;
  }

  interface FastifyRequest {
    authUser?: AuthUser;
    rawBody?: Buffer;
  }
}
