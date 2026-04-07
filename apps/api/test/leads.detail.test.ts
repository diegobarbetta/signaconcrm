import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("GET /leads/:id (Story 3.2)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let leadId: string;
  let conversationId: string;
  let contactId: string;
  const email = "lead-detail@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_lead_detail_role" },
      create: { id: randomUUID(), name: "vitest_lead_detail_role", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Lead Detail",
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

    const lead = await prisma.lead.create({
      data: { contactId, source: "whatsapp", status: "new", potentialValue: 1800 },
    });
    leadId = lead.id;

    const conv = await prisma.whatsAppConversation.create({
      data: {
        contactId,
        phoneNumberId: "pn-lead-detail",
        unanswered: true,
        lastMessagePreview: "oi",
        lastActivityAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    });
    conversationId = conv.id;
  });

  afterAll(async () => {
    await prisma.whatsAppMessage.deleteMany({ where: { conversationId } });
    await prisma.whatsAppConversation.deleteMany({ where: { id: conversationId } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it("retorna lead + wa_id + conversas", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/leads/${leadId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      id: string;
      wa_id: string;
      potential_value: number;
      current_status_days: number;
      conversations: Array<{ id: string }>;
      status_events: unknown[];
    };
    expect(body.id).toBe(leadId);
    expect(typeof body.wa_id).toBe("string");
    expect(body.potential_value).toBe(1800);
    expect(body.current_status_days).toBeTypeOf("number");
    expect(body.conversations.map((c) => c.id)).toEqual([conversationId]);
    expect(Array.isArray(body.status_events)).toBe(true);
  });

  it("404 quando não existe", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/leads/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "Lead não encontrado" });
  });
});
