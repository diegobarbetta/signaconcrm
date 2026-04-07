import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("POST /leads/:id/convert (Story 3.5)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNo: string;
  let leadQualifiedId: string;
  let leadNewId: string;
  let contactA: string;
  let contactB: string;
  const emailOk = "lead-convert-ok@test.local";
  const emailNo = "lead-convert-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const p = await prisma.permission.upsert({
      where: { code: "leads.convert" },
      create: { id: randomUUID(), code: "leads.convert" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_lead_convert_ok" },
      create: { id: randomUUID(), name: "vitest_lead_convert_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_lead_convert_no" },
      create: { id: randomUUID(), name: "vitest_lead_convert_no", dataScope: "own" },
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
          name: "ConvOk",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "ConvNo",
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

    const ca = await prisma.whatsAppContact.create({
      data: { waId: `wa-${randomUUID()}` },
    });
    const cb = await prisma.whatsAppContact.create({
      data: { waId: `wa-${randomUUID()}` },
    });
    contactA = ca.id;
    contactB = cb.id;

    const lq = await prisma.lead.create({
      data: { contactId: contactA, source: "whatsapp", status: "qualified" },
    });
    leadQualifiedId = lq.id;

    const ln = await prisma.lead.create({
      data: { contactId: contactB, source: "whatsapp", status: "new" },
    });
    leadNewId = ln.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: "lead.convert_to_client", entityId: leadQualifiedId },
    });
    await prisma.client.deleteMany({ where: { leadId: leadQualifiedId } });
    await prisma.lead.deleteMany({ where: { id: { in: [leadQualifiedId, leadNewId] } } });
    await prisma.whatsAppContact.deleteMany({
      where: { id: { in: [contactA, contactB] } },
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

  it("403 sem permissão leads.convert", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/leads/${leadQualifiedId}/convert`,
      headers: { authorization: `Bearer ${tokenNo}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 quando lead não está qualificado", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/leads/${leadNewId}/convert`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "Apenas leads em estado qualificado podem ser convertidos",
    });
  });

  it("cria cliente na primeira conversão e idempotência na segunda", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/leads/${leadQualifiedId}/convert`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(first.statusCode).toBe(200);
    const body1 = JSON.parse(first.body) as {
      client_id: string;
      created: boolean;
    };
    expect(body1.created).toBe(true);
    expect(body1.client_id.length).toBeGreaterThan(10);

    const second = await app.inject({
      method: "POST",
      url: `/leads/${leadQualifiedId}/convert`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(second.statusCode).toBe(200);
    const body2 = JSON.parse(second.body) as {
      client_id: string;
      created: boolean;
    };
    expect(body2.created).toBe(false);
    expect(body2.client_id).toBe(body1.client_id);

    const rows = await prisma.client.findMany({ where: { leadId: leadQualifiedId } });
    expect(rows.length).toBe(1);
  });

  it("404 quando lead não existe", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/leads/${randomUUID()}/convert`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("converte lead qualificado offline (sem contactId) criando contacto sintético", async () => {
    const offline = await prisma.lead.create({
      data: {
        contactId: null,
        source: "feira",
        status: "qualified",
        displayName: "Cliente Offline",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/leads/${offline.id}/convert`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { client_id: string; created: boolean };
    expect(body.created).toBe(true);

    const leadAfter = await prisma.lead.findUnique({
      where: { id: offline.id },
      select: { contactId: true },
    });
    expect(leadAfter?.contactId).not.toBeNull();

    const client = await prisma.client.findFirst({
      where: { leadId: offline.id },
      select: { displayName: true, contactId: true },
    });
    expect(client?.displayName).toBe("Cliente Offline");
    expect(client?.contactId).toBe(leadAfter?.contactId);

    await prisma.auditLog.deleteMany({
      where: { entityId: offline.id, action: "lead.convert_to_client" },
    });
    const cid = leadAfter!.contactId!;
    await prisma.client.deleteMany({ where: { leadId: offline.id } });
    await prisma.lead.delete({ where: { id: offline.id } });
    await prisma.whatsAppContact.delete({ where: { id: cid } });
  });
});
