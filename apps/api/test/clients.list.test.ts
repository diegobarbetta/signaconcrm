import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("GET /clients (Story 4.1)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNo: string;
  let clientIdA: string;
  let clientIdB: string;
  const waA = `5511${Date.now().toString().slice(-8)}01`;
  const waB = `5521${Date.now().toString().slice(-8)}02`;
  const emailOk = "clients-list-ok@test.local";
  const emailNo = "clients-list-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const p = await prisma.permission.upsert({
      where: { code: "clients.read" },
      create: { id: randomUUID(), code: "clients.read" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_clients_read_ok" },
      create: { id: randomUUID(), name: "vitest_clients_read_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_clients_read_no" },
      create: { id: randomUUID(), name: "vitest_clients_read_no", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: p.id }],
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
          name: "CROk",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "CRNo",
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
    tokenOk = (JSON.parse(loginOk.body) as { access_token: string }).access_token;

    const loginNo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailNo, password },
    });
    tokenNo = (JSON.parse(loginNo.body) as { access_token: string }).access_token;

    const ca = await prisma.whatsAppContact.create({ data: { waId: waA } });
    const cb = await prisma.whatsAppContact.create({ data: { waId: waB } });

    const la = await prisma.lead.create({
      data: { contactId: ca.id, source: "whatsapp", status: "qualified" },
    });
    const lb = await prisma.lead.create({
      data: { contactId: cb.id, source: "whatsapp", status: "qualified" },
    });

    const cla = await prisma.client.create({
      data: { leadId: la.id, contactId: ca.id, generatedValue: 1200 },
    });
    const clb = await prisma.client.create({
      data: { leadId: lb.id, contactId: cb.id, generatedValue: 3400 },
    });
    await prisma.clientService.create({
      data: { clientId: cla.id, name: "Plano A", status: "active", amount: 1200 },
    });
    await prisma.clientService.create({
      data: { clientId: clb.id, name: "Plano B", status: "paused", amount: 3400 },
    });
    clientIdA = cla.id;
    clientIdB = clb.id;
  });

  afterAll(async () => {
    const clientIds = [clientIdA, clientIdB].filter(Boolean);
    if (clientIds.length > 0) {
      await prisma.client.deleteMany({
        where: { id: { in: clientIds } },
      });
    }
    await prisma.lead.deleteMany({
      where: {
        contact: {
          waId: { in: [waA, waB] },
        },
      },
    });
    await prisma.whatsAppContact.deleteMany({
      where: { waId: { in: [waA, waB] } },
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

  it("403 sem permissão clients.read", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/clients",
      headers: { authorization: `Bearer ${tokenNo}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lista paginada com total", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/clients?limit=10&offset=0",
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: Array<{
        id: string;
        wa_id: string;
        reference_value: number | null;
        real_value: number;
      }>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(clientIdA);
    expect(ids).toContain(clientIdB);
    expect(body.items.find((item) => item.id === clientIdA)?.reference_value).toBe(1200);
    expect(body.items.find((item) => item.id === clientIdA)?.real_value).toBe(1200);
  });

  it("filtra por q (wa_id)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients?q=${waA.slice(0, 7)}`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.map((i) => i.id)).toContain(clientIdA);
    expect(body.items.map((i) => i.id)).not.toContain(clientIdB);
  });
});
