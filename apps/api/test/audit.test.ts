import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("Auditoria (Story 1.6)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminToken: string;
  const adminEmail = "audit-admin@test.local";
  const password = "AuditSuitePass123!";

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
      where: { user: { email: adminEmail } },
    });
    await prisma.user.deleteMany({
      where: { email: adminEmail },
    });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Audit admin",
        email: adminEmail,
        passwordHash: await argon2.hash(password),
        roleId: roleAdmin.id,
        status: "active",
      },
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: adminEmail, password },
    });
    adminToken = (JSON.parse(login.body) as { access_token: string })
      .access_token;
  });

  afterAll(async () => {
    const adminUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });
    if (adminUser) {
      await prisma.auditLog.deleteMany({
        where: { userId: adminUser.id },
      });
    }
    await prisma.userSession.deleteMany({
      where: { user: { email: adminEmail } },
    });
    await prisma.user.deleteMany({
      where: { email: adminEmail },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("login regista auth.login em audit_log", async () => {
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    const rows = await prisma.auditLog.findMany({
      where: { userId: adminUser.id, action: "auth.login" },
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("GET /audit/logs — 200 com audit.read e lista eventos", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/audit/logs?limit=10",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body) as { action: string; metadata: unknown }[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    const loginEntry = list.find((e) => e.action === "auth.login");
    expect(loginEntry).toBeDefined();
    if (loginEntry?.metadata && typeof loginEntry.metadata === "object") {
      expect(loginEntry.metadata).not.toHaveProperty("email");
    }
  });

  it("GET /audit/logs — 403 sem permissão audit.read", async () => {
    const roleAt = await prisma.role.upsert({
      where: { name: "atendimento" },
      create: { id: randomUUID(), name: "atendimento", dataScope: "own" },
      update: {},
    });
    await prisma.user.deleteMany({ where: { email: "audit-peer@test.local" } });
    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Peer",
        email: "audit-peer@test.local",
        passwordHash: await argon2.hash(password),
        roleId: roleAt.id,
        status: "active",
      },
    });
    const loginPeer = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "audit-peer@test.local", password },
    });
    const peerToken = (JSON.parse(loginPeer.body) as { access_token: string })
      .access_token;

    const res = await app.inject({
      method: "GET",
      url: "/audit/logs",
      headers: { authorization: `Bearer ${peerToken}` },
    });
    expect(res.statusCode).toBe(403);

    await prisma.userSession.deleteMany({
      where: { user: { email: "audit-peer@test.local" } },
    });
    await prisma.user.deleteMany({
      where: { email: "audit-peer@test.local" },
    });
  });
});
