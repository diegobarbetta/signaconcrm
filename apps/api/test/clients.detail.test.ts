import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("GET /clients/:id (Story 4.2)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNo: string;
  let clientId: string;
  let leadId: string;
  let contactId: string;
  let serviceIdA: string;
  const emailOk = "clients-detail-ok@test.local";
  const emailNo = "clients-detail-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const pRead = await prisma.permission.upsert({
      where: { code: "clients.read" },
      create: { id: randomUUID(), code: "clients.read" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_clients_detail_ok" },
      create: { id: randomUUID(), name: "vitest_clients_detail_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_clients_detail_no" },
      create: { id: randomUUID(), name: "vitest_clients_detail_no", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: pRead.id }],
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
          name: "Dok",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "Dno",
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

    const contact = await prisma.whatsAppContact.create({
      data: { waId: `wa-detail-${randomUUID()}` },
    });
    const lead = await prisma.lead.create({
      data: { contactId: contact.id, source: "whatsapp", status: "qualified" },
    });
    leadId = lead.id;
    contactId = contact.id;
    const client = await prisma.client.create({
      data: { leadId: lead.id, contactId: contact.id, generatedValue: 8900 },
    });
    clientId = client.id;

    const sa = await prisma.clientService.create({
      data: {
        clientId: client.id,
        name: "Suporte mensal",
        status: "active",
        amount: 4500,
      },
    });
    serviceIdA = sa.id;
    await prisma.clientService.create({
      data: {
        clientId: client.id,
        name: "Onboarding",
        status: "ended",
        amount: 1200,
      },
    });
  });

  afterAll(async () => {
    await prisma.clientService.deleteMany({ where: { clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("403 sem clients.read", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientId}`,
      headers: { authorization: `Bearer ${tokenNo}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("retorna detalhe com serviços ordenados", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientId}`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      id: string;
      wa_id: string;
      reference_value: number | null;
      real_value: number;
      services: Array<{ id: string; name: string; status: string; amount: number }>;
    };
    expect(body.id).toBe(clientId);
    expect(body.wa_id).toContain("wa-detail-");
    expect(body.reference_value).toBe(8900);
    expect(body.real_value).toBe(4500);
    expect(body.services.length).toBe(2);
    expect(body.services[0].id).toBe(serviceIdA);
    expect(body.services[0].amount).toBe(4500);
    expect(body.services.map((s) => s.name)).toEqual(["Suporte mensal", "Onboarding"]);
  });

  it("404 quando não existe", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${randomUUID()}`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "Cliente não encontrado" });
  });
});
