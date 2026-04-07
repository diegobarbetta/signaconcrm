import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("WhatsApp conversation history ordering (Story 2.5)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let contactId: string;
  let conversationId: string;
  const email = "wa-history-order@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_wa_history_order" },
      create: { id: randomUUID(), name: "vitest_wa_history_order", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "WA History",
        email,
        passwordHash: await argon2.hash(password),
        roleId: role.id,
        status: "active",
      },
    });

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
        phoneNumberId: "pn-1",
        unanswered: true,
      },
    });
    conversationId = conv.id;

    // m1: sem providerTimestamp (fallback para receivedAt)
    await prisma.whatsAppMessage.create({
      data: {
        providerMessageId: `wamid-${randomUUID()}`,
        waId: contact.waId,
        phoneNumberId: "pn-1",
        contactId,
        conversationId,
        messageType: "text",
        textBody: "m1-no-provider-ts",
        providerTimestamp: null,
        receivedAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    });

    // m2: com providerTimestamp anterior ao receivedAt do m1
    await prisma.whatsAppMessage.create({
      data: {
        providerMessageId: `wamid-${randomUUID()}`,
        waId: contact.waId,
        phoneNumberId: "pn-1",
        contactId,
        conversationId,
        messageType: "text",
        textBody: "m2-provider-early",
        providerTimestamp: new Date("2026-01-01T09:00:00.000Z"),
        receivedAt: new Date("2026-01-01T10:05:00.000Z"),
      },
    });

    // m3: com providerTimestamp posterior
    await prisma.whatsAppMessage.create({
      data: {
        providerMessageId: `wamid-${randomUUID()}`,
        waId: contact.waId,
        phoneNumberId: "pn-1",
        contactId,
        conversationId,
        messageType: "text",
        textBody: "m3-provider-late",
        providerTimestamp: new Date("2026-01-01T11:00:00.000Z"),
        receivedAt: new Date("2026-01-01T11:05:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.whatsAppMessage.deleteMany({ where: { conversationId } });
    await prisma.whatsAppConversation.deleteMany({ where: { id: conversationId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it("ordena por provider_timestamp quando existe e usa received_at como fallback", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/whatsapp/conversations/${conversationId}/messages?limit=50&offset=0&order=asc`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body) as Array<{ textBody: string }>;

    const bodies = rows.map((r) => r.textBody);
    // m1 não tem provider_timestamp, então entra no timeline via received_at (entre 09:00 e 11:00).
    expect(bodies).toEqual(["m2-provider-early", "m1-no-provider-ts", "m3-provider-late"]);
  });
});

