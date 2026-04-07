import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sha256Hex } from "../src/modules/auth/login.service.js";

const prisma = new PrismaClient();

describe("POST /auth/refresh", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL em falta — copia .env.example para .env e corre migrations.",
      );
    }

    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_refresh_role" },
      create: { id: randomUUID(), name: "vitest_refresh_role", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({
      where: {
        user: { email: "refresh-user@test.local" },
      },
    });
    await prisma.user.deleteMany({
      where: { email: "refresh-user@test.local" },
    });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Refresh Test",
        email: "refresh-user@test.local",
        passwordHash: await argon2.hash("SecretPass123!"),
        roleId: role.id,
        status: "active",
      },
    });
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({
      where: { user: { email: "refresh-user@test.local" } },
    });
    await prisma.user.deleteMany({
      where: { email: "refresh-user@test.local" },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("emite novo par de tokens e revoga o refresh usado", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "refresh-user@test.local",
        password: "SecretPass123!",
      },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = JSON.parse(login.body) as { refresh_token: string };
    const firstRefresh = loginBody.refresh_token;

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: firstRefresh },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(body.token_type).toBe("Bearer");
    expect(body.refresh_token).not.toBe(firstRefresh);
    expect(body.access_token.length).toBeGreaterThan(20);

    const oldHash = sha256Hex(firstRefresh);
    const oldSession = await prisma.userSession.findFirst({
      where: { refreshTokenHash: oldHash },
    });
    expect(oldSession?.revokedAt).not.toBeNull();

    const second = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: firstRefresh },
    });
    expect(second.statusCode).toBe(401);
    expect(JSON.parse(second.body)).toEqual({ error: "Sessão inválida" });

    const third = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: body.refresh_token },
    });
    expect(third.statusCode).toBe(200);
  });

  it("401 quando o refresh está expirado", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "refresh-user@test.local",
        password: "SecretPass123!",
      },
    });
    const { refresh_token: rt } = JSON.parse(login.body) as {
      refresh_token: string;
    };
    const h = sha256Hex(rt);

    await prisma.userSession.updateMany({
      where: { refreshTokenHash: h },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: rt },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Sessão inválida" });
  });

  it("401 quando o token é inválido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: "token-inexistente-base64url" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Sessão inválida" });
  });
});
