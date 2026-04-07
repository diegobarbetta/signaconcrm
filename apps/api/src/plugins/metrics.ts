import fp from "fastify-plugin";

import { createInMemoryMetrics } from "../lib/metrics.js";

export const metricsPlugin = fp(async (fastify) => {
  fastify.decorate("metrics", createInMemoryMetrics());
});

