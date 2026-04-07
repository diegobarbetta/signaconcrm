import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("PATCH /leads/:id/profile", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let tokenDenied: string;
  let leadId: string;
  const email = "lead-profile@test.local";
  const emailDenied = "lead-profile-denied@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const perm = await prisma.permission.upsert({
      where: { code: "leads.update_profile" },
      create: { id: randomUUID(), code: "leads.update_profile" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_lead_profile_ok" },
      create: { id: randomUUID(), name: "vitest_lead_profile_ok", dataScope: "all" },
      update: {},
    });
    const roleDenied = await prisma.role.upsert({
      where: { name: "vitest_lead_profile_denied" },
      create: { id: randomUUID(), name: "vitest_lead_profile_denied", dataScope: "all" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: perm.id }],
      skipDuplicates: true,
    });

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [email, emailDenied] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [email, emailDenied] } },
    });

    const hash = await argon2.hash(password);
    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "Profile Ok",
          email,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "Profile Denied",
          email: emailDenied,
          passwordHash: hash,
          roleId: roleDenied.id,
          status: "active",
        },
      ],
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    token = (JSON.parse(login.body) as { access_token: string }).access_token;

    const loginD = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailDenied, password },
    });
    tokenDenied = (JSON.parse(loginD.body) as { access_token: string }).access_token;

    const lead = await prisma.lead.create({
      data: {
        contactId: null,
        source: "manual",
        status: "new",
        displayName: "Antes",
      },
    });
    leadId = lead.id;
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [email, emailDenied] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [email, emailDenied] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("403 sem leads.update_profile", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/profile`,
      headers: { Authorization: `Bearer ${tokenDenied}` },
      payload: { city: "Lisboa" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 atualiza campos", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}/profile`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        display_name: "Depois",
        city: "Braga",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const row = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { displayName: true, city: true },
    });
    expect(row?.displayName).toBe("Depois");
    expect(row?.city).toBe("Braga");
  });
});
