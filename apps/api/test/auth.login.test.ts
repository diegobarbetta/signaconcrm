import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("POST /auth/login", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL em falta — copia .env.example para .env e corre migrations.",
      );
    }

    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_login_role" },
      create: { id: randomUUID(), name: "vitest_login_role", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({
      where: {
        user: {
          email: {
            in: ["login-ok@test.local", "login-disabled@test.local"],
          },
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["login-ok@test.local", "login-disabled@test.local"] },
      },
    });

    const hash = await argon2.hash("SecretPass123!");

    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "OK",
          email: "login-ok@test.local",
          passwordHash: hash,
          roleId: role.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "Dis",
          email: "login-disabled@test.local",
          passwordHash: hash,
          roleId: role.id,
          status: "disabled",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({
      where: {
        user: {
          email: {
            in: ["login-ok@test.local", "login-disabled@test.local"],
          },
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["login-ok@test.local", "login-disabled@test.local"] },
      },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("retorna tokens e cria sessão quando credenciais estão corretas", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "login-ok@test.local",
        password: "SecretPass123!",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token.length).toBeGreaterThan(20);
    expect(body.refresh_token.length).toBeGreaterThan(20);
    expect(typeof body.expires_in).toBe("number");

    const sessions = await prisma.userSession.findMany({
      where: { user: { email: "login-ok@test.local" } },
    });
    expect(sessions.length).toBe(1);
    expect(sessions[0].revokedAt).toBeNull();
    expect(sessions[0].refreshTokenHash).not.toContain(body.refresh_token);
  });

  it("401 genérico quando a senha está errada", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "login-ok@test.local",
        password: "wrong-password",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Credenciais inválidas" });
  });

  it("401 genérico quando o email não existe", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "nope@test.local",
        password: "SecretPass123!",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Credenciais inválidas" });
  });

  it("401 genérico quando o utilizador está disabled", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "login-disabled@test.local",
        password: "SecretPass123!",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Credenciais inválidas" });
  });
});
