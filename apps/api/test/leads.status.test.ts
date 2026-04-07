import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("PATCH /leads/:id/status (Story 3.3)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNoPerm: string;
  let leadId: string;
  let contactId: string;
  let userOkId: string;
  const emailOk = "lead-status-ok@test.local";
  const emailNo = "lead-status-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const p = await prisma.permission.upsert({
      where: { code: "leads.update_status" },
      create: { id: randomUUID(), code: "leads.update_status" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_lead_status_ok" },
      create: { id: randomUUID(), name: "vitest_lead_status_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_lead_status_no" },
      create: { id: randomUUID(), name: "vitest_lead_status_no", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: p.id }],
      skipDuplicates: true,
    });

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo] } },
    });

    const uOk = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "OK",
        email: emailOk,
        passwordHash: await argon2.hash(password),
        roleId: roleOk.id,
        status: "active",
      },
    });
    userOkId = uOk.id;

    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "No",
        email: emailNo,
        passwordHash: await argon2.hash(password),
        roleId: roleNo.id,
        status: "active",
      },
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
    tokenNoPerm = (JSON.parse(loginNo.body) as { access_token: string }).access_token;

    const contact = await prisma.whatsAppContact.create({
      data: { waId: `wa-${randomUUID()}` },
    });
    contactId = contact.id;

    const lead = await prisma.lead.create({
      data: { contactId, source: "whatsapp", status: "new" },
    });
    leadId = lead.id;
  });

  afterAll(async () => {
    await prisma.leadStatusEvent.deleteMany({ where: { leadId } });
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

  it("403 sem permissão leads.update_status", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/status`,
      headers: { authorization: `Bearer ${tokenNoPerm}` },
      payload: { status: "qualified" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 para status inválido", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/status`,
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: { status: "invalido" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Status inválido" });
  });

  it("200 atualiza lead e cria lead_status_events", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/status`,
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: { status: "qualified" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: leadId, status: "qualified" });

    const events = await prisma.leadStatusEvent.findMany({
      where: { leadId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.length).toBe(1);
    expect(events[0].fromStatus).toBe("new");
    expect(events[0].toStatus).toBe("qualified");
    expect(events[0].changedByUserId).toBe(userOkId);
  });

  it("400 quando status não muda", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/status`,
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: { status: "qualified" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Status inalterado" });
  });

  it("GET /leads/:id inclui status_events em ordem cronológica", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/leads/${leadId}`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      status: string;
      status_events: Array<{ from_status: string | null; to_status: string }>;
    };
    expect(body.status).toBe("qualified");
    expect(body.status_events.length).toBe(1);
    expect(body.status_events[0].from_status).toBe("new");
    expect(body.status_events[0].to_status).toBe("qualified");
  });
});
