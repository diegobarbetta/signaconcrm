import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("WhatsApp conversation assignee (Story 2.7)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenAllowed: string;
  let tokenDenied: string;
  let allowedUserId: string;
  let conversationId: string;
  let contactId: string;
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const pAssign = await prisma.permission.upsert({
      where: { code: "whatsapp.conversations.assign" },
      create: { id: randomUUID(), code: "whatsapp.conversations.assign" },
      update: {},
    });

    const roleAllowed = await prisma.role.upsert({
      where: { name: "vitest_wa_assign_allowed" },
      create: { id: randomUUID(), name: "vitest_wa_assign_allowed", dataScope: "own" },
      update: { dataScope: "own" },
    });
    const roleDenied = await prisma.role.upsert({
      where: { name: "vitest_wa_assign_denied" },
      create: { id: randomUUID(), name: "vitest_wa_assign_denied", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleAllowed.id, permissionId: pAssign.id }],
      skipDuplicates: true,
    });

    const emailAllowed = "wa-assign-allowed@test.local";
    const emailDenied = "wa-assign-denied@test.local";

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailAllowed, emailDenied] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailAllowed, emailDenied] } },
    });

    const hash = await argon2.hash(password);
    const allowed = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Allowed",
        email: emailAllowed,
        passwordHash: hash,
        roleId: roleAllowed.id,
        status: "active",
      },
    });
    allowedUserId = allowed.id;

    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Denied",
        email: emailDenied,
        passwordHash: hash,
        roleId: roleDenied.id,
        status: "active",
      },
    });

    const loginAllowed = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailAllowed, password },
    });
    tokenAllowed = (JSON.parse(loginAllowed.body) as { access_token: string })
      .access_token;

    const loginDenied = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailDenied, password },
    });
    tokenDenied = (JSON.parse(loginDenied.body) as { access_token: string }).access_token;

    const contact = await prisma.whatsAppContact.create({
      data: { waId: `wa-${randomUUID()}` },
    });
    contactId = contact.id;

    const conv = await prisma.whatsAppConversation.create({
      data: {
        contactId,
        phoneNumberId: "pn-assign",
        unanswered: true,
      },
    });
    conversationId = conv.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: "whatsapp.conversation.assign", entityId: conversationId },
    });
    await prisma.whatsAppConversation.deleteMany({ where: { id: conversationId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({
      where: { user: { email: { contains: "wa-assign-" } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: "wa-assign-" } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("200 com permissão e define assigned_user_id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/whatsapp/conversations/${conversationId}/assignee`,
      headers: { authorization: `Bearer ${tokenAllowed}` },
      payload: { assigned_user_id: allowedUserId },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conv.assignedUserId).toBe(allowedUserId);
  });

  it("403 sem permissão whatsapp.conversations.assign", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/whatsapp/conversations/${conversationId}/assignee`,
      headers: { authorization: `Bearer ${tokenDenied}` },
      payload: { assigned_user_id: allowedUserId },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "Acesso negado" });
  });

  it("404 quando a conversa não existe", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/whatsapp/conversations/${randomUUID()}/assignee`,
      headers: { authorization: `Bearer ${tokenAllowed}` },
      payload: { assigned_user_id: allowedUserId },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "Conversa não encontrada" });
  });
});

