import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("POST /leads criação manual (Story 8.1)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenAdmin: string;
  let tokenNoPerm: string;
  const emailAdmin = "lead-manual-admin@test.local";
  const emailDenied = "lead-manual-denied@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const roleAdmin = await prisma.role.upsert({
      where: { name: "vitest_lead_manual_admin" },
      create: {
        id: randomUUID(),
        name: "vitest_lead_manual_admin",
        dataScope: "all",
      },
      update: {},
    });

    const perm = await prisma.permission.upsert({
      where: { code: "leads.create_manual" },
      create: { id: randomUUID(), code: "leads.create_manual" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleAdmin.id, permissionId: perm.id }],
      skipDuplicates: true,
    });

    const roleDenied = await prisma.role.upsert({
      where: { name: "vitest_lead_manual_denied" },
      create: {
        id: randomUUID(),
        name: "vitest_lead_manual_denied",
        dataScope: "all",
      },
      update: {},
    });

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailAdmin, emailDenied] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailAdmin, emailDenied] } },
    });

    const hash = await argon2.hash(password);
    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "Manual Admin",
          email: emailAdmin,
          passwordHash: hash,
          roleId: roleAdmin.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "Manual Denied",
          email: emailDenied,
          passwordHash: hash,
          roleId: roleDenied.id,
          status: "active",
        },
      ],
    });

    const loginA = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailAdmin, password },
    });
    tokenAdmin = (JSON.parse(loginA.body) as { access_token: string }).access_token;

    const loginD = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailDenied, password },
    });
    tokenNoPerm = (JSON.parse(loginD.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailAdmin, emailDenied] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailAdmin, emailDenied] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("201 cria lead, contacto e conversa placeholder", async () => {
    const wa = `55${Date.now().toString().slice(-10)}`;
    const res = await app.inject({
      method: "POST",
      url: "/leads",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      payload: {
        wa_id: wa,
        source: "manual_test",
        status: "new",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string; wa_id: string; source: string };
    expect(body.wa_id).toBe(wa);
    expect(body.source).toBe("manual_test");

    await prisma.lead.deleteMany({ where: { id: body.id } });
    const contact = await prisma.whatsAppContact.findUnique({
      where: { waId: wa },
    });
    if (contact) {
      await prisma.whatsAppConversation.deleteMany({ where: { contactId: contact.id } });
      await prisma.whatsAppContact.delete({ where: { id: contact.id } });
    }
  });

  it("409 se lead já existe para o contacto", async () => {
    const wa = `55${(Date.now() + 1).toString().slice(-10)}`;
    const first = await app.inject({
      method: "POST",
      url: "/leads",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      payload: { wa_id: wa, source: "a" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/leads",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      payload: { wa_id: wa, source: "b" },
    });
    expect(second.statusCode).toBe(409);

    const body = JSON.parse(first.body) as { id: string };
    await prisma.lead.deleteMany({ where: { id: body.id } });
    const contact = await prisma.whatsAppContact.findUnique({
      where: { waId: wa },
    });
    if (contact) {
      await prisma.whatsAppConversation.deleteMany({ where: { contactId: contact.id } });
      await prisma.whatsAppContact.delete({ where: { id: contact.id } });
    }
  });

  it("403 sem permissão leads.create_manual", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leads",
      headers: { Authorization: `Bearer ${tokenNoPerm}` },
      payload: {
        wa_id: "5511999999999",
        source: "x",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 lead offline sem display_name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leads",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      payload: {
        source: "telefone",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("201 lead offline com perfil e notas (sem wa_id)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leads",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      payload: {
        source: "import",
        display_name: "Maria Silva",
        city: "Porto",
        email: "maria@example.com",
        phone_secondary: "+351910000000",
        notes: "Pediu contacto na feira",
        potential_value: 2750.5,
        status: "new",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      id: string;
      wa_id: string | null;
      display_name: string | null;
      city: string | null;
      email: string | null;
      phone_secondary: string | null;
      potential_value: number | null;
    };
    expect(body.wa_id).toBeNull();
    expect(body.display_name).toBe("Maria Silva");
    expect(body.city).toBe("Porto");
    expect(body.email).toBe("maria@example.com");
    expect(body.phone_secondary).toBe("+351910000000");
    expect(body.potential_value).toBe(2750.5);

    const noteRows = await prisma.leadNote.findMany({
      where: { leadId: body.id },
    });
    expect(noteRows.length).toBe(1);
    expect(noteRows[0]?.body).toBe("Pediu contacto na feira");

    await prisma.leadNote.deleteMany({ where: { leadId: body.id } });
    await prisma.lead.deleteMany({ where: { id: body.id } });
  });
});
