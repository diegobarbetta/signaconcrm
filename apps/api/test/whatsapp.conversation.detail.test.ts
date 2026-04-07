import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("WhatsApp conversation detail (Story 2.9)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let userId: string;
  let contactId: string;
  let conversationId: string;
  const email = "wa-detail@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_wa_detail_role" },
      create: { id: randomUUID(), name: "vitest_wa_detail_role", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "WA Detail",
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
        phoneNumberId: "pn-detail",
        unanswered: true,
        assignedUserId: userId,
        lastMessagePreview: "preview",
        lastActivityAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    });
    conversationId = conv.id;
  });

  afterAll(async () => {
    await prisma.whatsAppConversation.deleteMany({ where: { id: conversationId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it("GET /whatsapp/conversations/:id retorna metadados", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/whatsapp/conversations/${conversationId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { id: string; assigned_user_id: string | null };
    expect(body.id).toBe(conversationId);
    expect(body.assigned_user_id).toBe(userId);
  });

  it("404 quando conversa não existe", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/whatsapp/conversations/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "Conversa não encontrada" });
  });
});

