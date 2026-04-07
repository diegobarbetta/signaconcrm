import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";

export const prismaPlugin = fp(async (fastify) => {
  const prisma = new PrismaClient();
  fastify.decorate("prisma", prisma);
  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
