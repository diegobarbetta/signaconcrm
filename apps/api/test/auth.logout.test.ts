import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("POST /auth/logout", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL em falta — copia .env.example para .env e corre migrations.",
      );
    }

    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_logout_role" },
      create: { id: randomUUID(), name: "vitest_logout_role", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({
      where: { user: { email: "logout-user@test.local" } },
    });
    await prisma.user.deleteMany({
      where: { email: "logout-user@test.local" },
    });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Logout Test",
        email: "logout-user@test.local",
        passwordHash: await argon2.hash("SecretPass123!"),
        roleId: role.id,
        status: "active",
      },
    });
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({
      where: { user: { email: "logout-user@test.local" } },
    });
    await prisma.user.deleteMany({
      where: { email: "logout-user@test.local" },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("revoga a sessão e o refresh deixa de funcionar", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "logout-user@test.local",
        password: "SecretPass123!",
      },
    });
    expect(login.statusCode).toBe(200);
    const { refresh_token: rt } = JSON.parse(login.body) as {
      refresh_token: string;
    };

    const out = await app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refresh_token: rt },
    });
    expect(out.statusCode).toBe(204);
    expect(out.body).toBe("");

    const refresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: rt },
    });
    expect(refresh.statusCode).toBe(401);
    expect(JSON.parse(refresh.body)).toEqual({ error: "Sessão inválida" });
  });

  it("401 quando o refresh já não é válido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refresh_token: "token-invalido" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Sessão inválida" });
  });
});
