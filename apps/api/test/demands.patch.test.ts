import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("Demands patch + vínculos (Stories 5.3 / 5.4)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenUpdate: string;
  let tokenNo: string;
  let userId: string;
  let demandId: string;
  let leadIdA: string;
  let clientIdB: string;
  let contactIdA: string;
  let contactIdB: string;
  let leadIdB: string;

  const emailOk = "demands-patch-ok@test.local";
  const emailNo = "demands-patch-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const pUpdate = await prisma.permission.upsert({
      where: { code: "demands.update" },
      create: { id: randomUUID(), code: "demands.update" },
      update: {},
    });
    const pRead = await prisma.permission.upsert({
      where: { code: "demands.read" },
      create: { id: randomUUID(), code: "demands.read" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_demands_patch_ok" },
      create: { id: randomUUID(), name: "vitest_demands_patch_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_demands_patch_no" },
      create: { id: randomUUID(), name: "vitest_demands_patch_no", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [
        { roleId: roleOk.id, permissionId: pUpdate.id },
        { roleId: roleOk.id, permissionId: pRead.id },
      ],
      skipDuplicates: true,
    });

    const hash = await argon2.hash(password);
    userId = randomUUID();

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo] } },
    });

    await prisma.user.createMany({
      data: [
        {
          id: userId,
          name: "PatchOk",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "PatchNo",
          email: emailNo,
          passwordHash: hash,
          roleId: roleNo.id,
          status: "active",
        },
      ],
    });

    const cA = await prisma.whatsAppContact.create({
      data: { waId: `wa-patch-a-${randomUUID()}` },
    });
    const cB = await prisma.whatsAppContact.create({
      data: { waId: `wa-patch-b-${randomUUID()}` },
    });
    contactIdA = cA.id;
    contactIdB = cB.id;

    const leadA = await prisma.lead.create({
      data: { contactId: cA.id, source: "manual", status: "new" },
    });
    const leadB = await prisma.lead.create({
      data: { contactId: cB.id, source: "manual", status: "qualified" },
    });
    leadIdA = leadA.id;
    leadIdB = leadB.id;

    const clientB = await prisma.client.create({
      data: { leadId: leadB.id, contactId: cB.id },
    });
    clientIdB = clientB.id;

    const due = new Date("2026-08-01T12:00:00.000Z");
    const d = await prisma.demand.create({
      data: {
        title: "Vitest patch demand",
        dueAt: due,
        status: "open",
      },
    });
    demandId = d.id;

    const loginOk = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailOk, password },
    });
    tokenUpdate = (JSON.parse(loginOk.body) as { access_token: string }).access_token;

    const loginNo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailNo, password },
    });
    tokenNo = (JSON.parse(loginNo.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityType: "demand", entityId: demandId },
    });
    await prisma.demand.deleteMany({
      where: { id: demandId },
    });
    await prisma.client.deleteMany({ where: { id: clientIdB } });
    await prisma.lead.deleteMany({
      where: { id: { in: [leadIdA, leadIdB] } },
    });
    await prisma.whatsAppContact.deleteMany({
      where: { id: { in: [contactIdA, contactIdB] } },
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

  it("403 PATCH sem demands.update", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/demands/${demandId}`,
      headers: { authorization: `Bearer ${tokenNo}` },
      payload: { status: "done" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 PATCH lead inexistente", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/demands/${demandId}`,
      headers: { authorization: `Bearer ${tokenUpdate}` },
      payload: { lead_id: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 PATCH lead_id e client_id simultâneos", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/demands/${demandId}`,
      headers: { authorization: `Bearer ${tokenUpdate}` },
      payload: { lead_id: leadIdA, client_id: clientIdB },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH atualiza status, due_at e responsável", async () => {
    const newDue = new Date("2026-09-15T10:30:00.000Z");
    const res = await app.inject({
      method: "PATCH",
      url: `/demands/${demandId}`,
      headers: { authorization: `Bearer ${tokenUpdate}` },
      payload: {
        status: "in_progress",
        due_at: newDue.toISOString(),
        assigned_user_id: userId,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      status: string;
      due_at: string;
      assigned_user_id: string | null;
    };
    expect(body.status).toBe("in_progress");
    expect(body.due_at).toBe(newDue.toISOString());
    expect(body.assigned_user_id).toBe(userId);
  });

  it("PATCH vincula lead e GET filtra por lead_id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/demands/${demandId}`,
      headers: { authorization: `Bearer ${tokenUpdate}` },
      payload: { lead_id: leadIdA },
    });
    expect(res.statusCode).toBe(200);
    const row = JSON.parse(res.body) as { lead_id: string | null; client_id: string | null };
    expect(row.lead_id).toBe(leadIdA);
    expect(row.client_id).toBeNull();

    const list = await app.inject({
      method: "GET",
      url: `/demands?lead_id=${leadIdA}`,
      headers: { authorization: `Bearer ${tokenUpdate}` },
    });
    expect(list.statusCode).toBe(200);
    const data = JSON.parse(list.body) as { items: { id: string }[] };
    expect(data.items.some((i) => i.id === demandId)).toBe(true);
  });

  it("PATCH vincula cliente (troca lead por client) e GET filtra por client_id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/demands/${demandId}`,
      headers: { authorization: `Bearer ${tokenUpdate}` },
      payload: { client_id: clientIdB },
    });
    expect(res.statusCode).toBe(200);
    const row = JSON.parse(res.body) as { lead_id: string | null; client_id: string | null };
    expect(row.client_id).toBe(clientIdB);
    expect(row.lead_id).toBeNull();

    const list = await app.inject({
      method: "GET",
      url: `/demands?client_id=${clientIdB}`,
      headers: { authorization: `Bearer ${tokenUpdate}` },
    });
    expect(list.statusCode).toBe(200);
    const data = JSON.parse(list.body) as { items: { id: string }[] };
    expect(data.items.some((i) => i.id === demandId)).toBe(true);
  });
});
