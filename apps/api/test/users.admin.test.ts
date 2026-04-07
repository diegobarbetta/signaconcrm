import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("Gestão de utilizadores (admin)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminToken: string;
  let peerToken: string;
  const adminEmail = "users-admin-suite@test.local";
  const peerEmail = "users-peer-suite@test.local";
  const password = "AdminSuitePass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL em falta.");
    }

    app = await buildApp({ logger: false });

    const roleAdmin = await prisma.role.upsert({
      where: { name: "admin" },
      create: { id: randomUUID(), name: "admin", dataScope: "all" },
      update: { dataScope: "all" },
    });
    const roleAtendimento = await prisma.role.upsert({
      where: { name: "atendimento" },
      create: { id: randomUUID(), name: "atendimento", dataScope: "own" },
      update: { dataScope: "own" },
    });

    const pManage = await prisma.permission.upsert({
      where: { code: "users.manage" },
      create: { id: randomUUID(), code: "users.manage" },
      update: {},
    });
    const pSmoke = await prisma.permission.upsert({
      where: { code: "rbac.smoke" },
      create: { id: randomUUID(), code: "rbac.smoke" },
      update: {},
    });
    const pAudit = await prisma.permission.upsert({
      where: { code: "audit.read" },
      create: { id: randomUUID(), code: "audit.read" },
      update: {},
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: roleAdmin.id, permissionId: pManage.id },
        { roleId: roleAdmin.id, permissionId: pSmoke.id },
        { roleId: roleAdmin.id, permissionId: pAudit.id },
      ],
      skipDuplicates: true,
    });

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [adminEmail, peerEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, peerEmail] } },
    });
    await prisma.user.deleteMany({
      where: { email: "new-from-post@test.local" },
    });

    const hash = await argon2.hash(password);
    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "Admin suite",
          email: adminEmail,
          passwordHash: hash,
          roleId: roleAdmin.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "Peer suite",
          email: peerEmail,
          passwordHash: hash,
          roleId: roleAtendimento.id,
          status: "active",
        },
      ],
    });

    const loginAdmin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: adminEmail, password },
    });
    adminToken = (JSON.parse(loginAdmin.body) as { access_token: string })
      .access_token;

    const loginPeer = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: peerEmail, password },
    });
    peerToken = (JSON.parse(loginPeer.body) as { access_token: string })
      .access_token;
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({
      where: { user: { email: "new-from-post@test.local" } },
    });
    await prisma.user.deleteMany({
      where: { email: "new-from-post@test.local" },
    });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [adminEmail, peerEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, peerEmail] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("GET /users — admin lista utilizadores sem password_hash", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body) as Record<string, unknown>[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    for (const u of list) {
      expect(u).not.toHaveProperty("password_hash");
      expect(u).not.toHaveProperty("passwordHash");
      expect(u).toHaveProperty("role");
    }
  });

  it("GET /users — não admin recebe 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { authorization: `Bearer ${peerToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "Acesso negado" });
  });

  it("GET /users — sem token recebe 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users",
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /users cria utilizador e PATCH desativa — login falha", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/users",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "Criado por teste",
        email: "new-from-post@test.local",
        password: "AnotherPass123!",
        role: "atendimento",
      },
    });
    expect(create.statusCode).toBe(201);
    const created = JSON.parse(create.body) as { id: string; email: string };
    expect(created.email).toBe("new-from-post@test.local");

    const patch = await app.inject({
      method: "PATCH",
      url: `/users/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: "disabled" },
    });
    expect(patch.statusCode).toBe(200);
    const updated = JSON.parse(patch.body) as { status: string };
    expect(updated.status).toBe("disabled");

    const loginFail = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "new-from-post@test.local",
        password: "AnotherPass123!",
      },
    });
    expect(loginFail.statusCode).toBe(401);
  });
});
