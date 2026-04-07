import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("RBAC / escopo (Story 1.5)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminToken: string;
  let peerToken: string;
  const adminEmail = "rbac-admin@test.local";
  const peerEmail = "rbac-peer@test.local";
  const password = "RbacSuitePass123!";

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

    const hash = await argon2.hash(password);
    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "RBAC Admin",
          email: adminEmail,
          passwordHash: hash,
          roleId: roleAdmin.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "RBAC Peer",
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
      where: { user: { email: { in: [adminEmail, peerEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, peerEmail] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("GET /rbac/me — devolve permissões e data_scope", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/rbac/me",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      role: string;
      data_scope: string;
      permissions: string[];
    };
    expect(body.role).toBe("admin");
    expect(body.data_scope).toBe("all");
    expect(body.permissions).toContain("users.manage");
    expect(body.permissions).toContain("rbac.smoke");
    expect(body.permissions).toContain("audit.read");
  });

  it("GET /rbac/smoke — 200 com permissão rbac.smoke", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/rbac/smoke",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("GET /rbac/smoke — 403 sem permissão", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/rbac/smoke",
      headers: { authorization: `Bearer ${peerToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "Acesso negado" });
  });
});
