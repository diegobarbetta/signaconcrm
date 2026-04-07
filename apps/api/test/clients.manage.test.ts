import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("Clients manage + services (Stories 4.3 / 4.4)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenManage: string;
  let tokenNo: string;
  let clientId: string;
  let serviceId: string;
  const waUnique = `5599${Date.now().toString().slice(-8)}`;
  const emailOk = "clients-manage-ok@test.local";
  const emailNo = "clients-manage-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const pRead = await prisma.permission.upsert({
      where: { code: "clients.read" },
      create: { id: randomUUID(), code: "clients.read" },
      update: {},
    });
    const pManage = await prisma.permission.upsert({
      where: { code: "clients.manage" },
      create: { id: randomUUID(), code: "clients.manage" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_clients_manage_ok" },
      create: { id: randomUUID(), name: "vitest_clients_manage_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_clients_manage_no" },
      create: { id: randomUUID(), name: "vitest_clients_manage_no", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [
        { roleId: roleOk.id, permissionId: pRead.id },
        { roleId: roleOk.id, permissionId: pManage.id },
      ],
      skipDuplicates: true,
    });

    const hash = await argon2.hash(password);
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo] } },
    });

    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "Mok",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "Mno",
          email: emailNo,
          passwordHash: hash,
          roleId: roleNo.id,
          status: "active",
        },
      ],
    });

    const loginOk = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailOk, password },
    });
    tokenManage = (JSON.parse(loginOk.body) as { access_token: string }).access_token;

    const loginNo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailNo, password },
    });
    tokenNo = (JSON.parse(loginNo.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    const auditIds = [clientId, serviceId].filter(Boolean) as string[];
    if (auditIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: auditIds } },
      });
    }
    if (clientId) {
      await prisma.clientService.deleteMany({ where: { clientId } });
      await prisma.client.deleteMany({ where: { id: clientId } });
    }
    await prisma.lead.deleteMany({
      where: { contact: { waId: waUnique } },
    });
    await prisma.whatsAppContact.deleteMany({
      where: { waId: waUnique },
    });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("403 POST /clients sem clients.manage", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: { authorization: `Bearer ${tokenNo}` },
      payload: { wa_id: waUnique },
    });
    expect(res.statusCode).toBe(403);
  });

  it("201 POST /clients cria cliente (lead manual + contact)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: { authorization: `Bearer ${tokenManage}` },
      payload: {
        wa_id: waUnique,
        display_name: "Cliente Teste",
        notes: "nota",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string; lead_id: string };
    expect(body.id).toBeTruthy();
    clientId = body.id;
  });

  it("409 POST /clients duplicado (mesmo wa_id)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: { authorization: `Bearer ${tokenManage}` },
      payload: { wa_id: waUnique },
    });
    expect(res.statusCode).toBe(409);
  });

  it("PATCH /clients/:id atualiza display_name", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/clients/${clientId}`,
      headers: { authorization: `Bearer ${tokenManage}` },
      payload: { display_name: "Atualizado" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).display_name).toBe("Atualizado");
  });

  it("400 POST serviço com status inválido", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/clients/${clientId}/services`,
      headers: { authorization: `Bearer ${tokenManage}` },
      payload: { name: "S1", status: "invalid", amount: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("201 POST serviço e PATCH atualiza", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/clients/${clientId}/services`,
      headers: { authorization: `Bearer ${tokenManage}` },
      payload: { name: "  Suporte  ", status: "active", amount: 2500 },
    });
    expect(create.statusCode).toBe(201);
    const c = JSON.parse(create.body) as { id: string; name: string; amount: number };
    serviceId = c.id;
    expect(c.name).toBe("Suporte");
    expect(c.amount).toBe(2500);

    const patch = await app.inject({
      method: "PATCH",
      url: `/clients/${clientId}/services/${serviceId}`,
      headers: { authorization: `Bearer ${tokenManage}` },
      payload: { status: "paused", amount: 3100 },
    });
    expect(patch.statusCode).toBe(200);
    const body = JSON.parse(patch.body) as { status: string; amount: number };
    expect(body.status).toBe("paused");
    expect(body.amount).toBe(3100);
  });
});
