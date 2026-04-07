import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("PATCH /leads/:id/assignee (Story 3.4)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNoPerm: string;
  let leadId: string;
  let contactId: string;
  let assigneeId: string;
  const emailOk = "lead-assign-ok@test.local";
  const emailNo = "lead-assign-noperm@test.local";
  const emailAssignee = "lead-assign-target@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const p = await prisma.permission.upsert({
      where: { code: "leads.assign" },
      create: { id: randomUUID(), code: "leads.assign" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_lead_assign_ok" },
      create: { id: randomUUID(), name: "vitest_lead_assign_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_lead_assign_no" },
      create: { id: randomUUID(), name: "vitest_lead_assign_no", dataScope: "own" },
      update: {},
    });
    const roleTarget = await prisma.role.upsert({
      where: { name: "vitest_lead_assign_target" },
      create: { id: randomUUID(), name: "vitest_lead_assign_target", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: p.id }],
      skipDuplicates: true,
    });

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo, emailAssignee] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo, emailAssignee] } },
    });

    const hash = await argon2.hash(password);
    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Actor",
        email: emailOk,
        passwordHash: hash,
        roleId: roleOk.id,
        status: "active",
      },
    });
    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "NoPerm",
        email: emailNo,
        passwordHash: hash,
        roleId: roleNo.id,
        status: "active",
      },
    });
    const target = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Assignee",
        email: emailAssignee,
        passwordHash: hash,
        roleId: roleTarget.id,
        status: "active",
      },
    });
    assigneeId = target.id;

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
    await prisma.auditLog.deleteMany({
      where: { action: "lead.assign", entityId: leadId },
    });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo, emailAssignee] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo, emailAssignee] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("403 sem permissão leads.assign", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/assignee`,
      headers: { authorization: `Bearer ${tokenNoPerm}` },
      payload: { assigned_user_id: assigneeId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 atribui responsável e GET reflete assigned_user_id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/assignee`,
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: { assigned_user_id: assigneeId },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      assigned_user_id: assigneeId,
    });

    const get = await app.inject({
      method: "GET",
      url: `/leads/${leadId}`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(get.statusCode).toBe(200);
    const body = JSON.parse(get.body) as { assigned_user_id: string | null };
    expect(body.assigned_user_id).toBe(assigneeId);
  });

  it("404 quando lead não existe", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${randomUUID()}/assignee`,
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: { assigned_user_id: assigneeId },
    });
    expect(res.statusCode).toBe(404);
  });
});
