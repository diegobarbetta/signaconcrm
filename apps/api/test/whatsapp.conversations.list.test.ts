import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("WhatsApp conversations list (Story 2.8)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let userId: string;
  let contactId: string;
  let convMineId: string;
  let convOtherId: string;
  const email = "wa-list@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const role = await prisma.role.upsert({
      where: { name: "vitest_wa_list_role" },
      create: { id: randomUUID(), name: "vitest_wa_list_role", dataScope: "own" },
      update: { dataScope: "own" },
    });

    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "WA List",
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

    const convMine = await prisma.whatsAppConversation.create({
      data: {
        contactId,
        phoneNumberId: "pn-list-1",
        unanswered: true,
        assignedUserId: userId,
        lastMessagePreview: "mine",
        lastActivityAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    });
    convMineId = convMine.id;

    const convOther = await prisma.whatsAppConversation.create({
      data: {
        contactId,
        phoneNumberId: "pn-list-2",
        unanswered: false,
        assignedUserId: null,
        lastMessagePreview: "other",
        lastActivityAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    });
    convOtherId = convOther.id;
  });

  afterAll(async () => {
    await prisma.whatsAppMessage.deleteMany({
      where: { conversationId: { in: [convMineId, convOtherId] } },
    });
    await prisma.whatsAppConversation.deleteMany({
      where: { id: { in: [convMineId, convOtherId] } },
    });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it("lista ordenado por last_activity_at desc", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/whatsapp/conversations?limit=50&offset=0",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body) as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(convMineId);
    expect(ids).toContain(convOtherId);
    // convMine tem lastActivityAt mais recente que convOther → deve aparecer antes na lista global (desc).
    expect(ids.indexOf(convMineId)).toBeLessThan(ids.indexOf(convOtherId));
  });

  it("filtra por unanswered=1", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/whatsapp/conversations?unanswered=1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body) as Array<{ id: string; unanswered: boolean }>;
    expect(rows.some((r) => r.id === convMineId)).toBe(true);
    expect(rows.some((r) => r.id === convOtherId)).toBe(false);
    expect(rows.every((r) => r.unanswered === true)).toBe(true);
  });

  it("filtra por mine=1 (assigned_user_id = eu)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/whatsapp/conversations?mine=1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body) as Array<{
      id: string;
      assigned_user_id: string | null;
    }>;
    expect(rows.some((r) => r.id === convMineId)).toBe(true);
    expect(rows.some((r) => r.id === convOtherId)).toBe(false);
    expect(rows.every((r) => r.assigned_user_id === userId)).toBe(true);
  });
});

