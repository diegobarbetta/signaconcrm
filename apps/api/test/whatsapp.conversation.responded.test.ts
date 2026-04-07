import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("WhatsApp conversation responded (Story 2.6)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let userId: string;
  let conversationId: string;
  let contactId: string;
  const email = "wa-responded@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_wa_role" },
      create: { id: randomUUID(), name: "vitest_wa_role", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "WA",
        email,
        passwordHash: await argon2.hash(password),
        roleId: role.id,
        status: "active",
      },
    });
    userId = user.id;

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    token = (JSON.parse(login.body) as { access_token: string }).access_token;

    const contact = await prisma.whatsAppContact.create({
      data: { waId: `wa-${randomUUID()}` },
    });
    contactId = contact.id;

    const conv = await prisma.whatsAppConversation.create({
      data: {
        contactId,
        phoneNumberId: "pn-respond",
        unanswered: true,
      },
    });
    conversationId = conv.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: "whatsapp.conversation.mark_responded", userId },
    });
    await prisma.whatsAppConversation.deleteMany({ where: { id: conversationId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it("marca conversa como respondida (unanswered=false) e cria audit log", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/whatsapp/conversations/${conversationId}/responded`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conv.unanswered).toBe(false);

    const audits = await prisma.auditLog.findMany({
      where: { action: "whatsapp.conversation.mark_responded", entityId: conversationId },
    });
    expect(audits.length).toBe(1);
  });

  it("404 quando a conversa não existe", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/whatsapp/conversations/${randomUUID()}/responded`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "Conversa não encontrada" });
  });

  it("PATCH /conversations/:id/unanswered alterna sem resposta / respondida (Kanban)", async () => {
    const r1 = await app.inject({
      method: "PATCH",
      url: `/whatsapp/conversations/${conversationId}/unanswered`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { unanswered: true },
    });
    expect(r1.statusCode).toBe(200);
    let conv = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conv.unanswered).toBe(true);

    const r2 = await app.inject({
      method: "PATCH",
      url: `/whatsapp/conversations/${conversationId}/unanswered`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { unanswered: false },
    });
    expect(r2.statusCode).toBe(200);
    conv = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conv.unanswered).toBe(false);
  });
});

