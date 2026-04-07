import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("GET /leads lista + escopo own", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOwn: string;
  let userOwnId: string;
  let leadUnassigned: string;
  let leadMine: string;
  let leadOther: string;
  const emailOwn = "leads-list-own@test.local";
  const emailOther = "leads-list-other@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const roleOwn = await prisma.role.upsert({
      where: { name: "vitest_leads_list_own" },
      create: { id: randomUUID(), name: "vitest_leads_list_own", dataScope: "own" },
      update: { dataScope: "own" },
    });

    const hash = await argon2.hash(password);
    userOwnId = randomUUID();
    const otherUserId = randomUUID();

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOwn, emailOther] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOwn, emailOther] } },
    });

    await prisma.user.createMany({
      data: [
        {
          id: userOwnId,
          name: "ListOwn",
          email: emailOwn,
          passwordHash: hash,
          roleId: roleOwn.id,
          status: "active",
        },
        {
          id: otherUserId,
          name: "ListOther",
          email: emailOther,
          passwordHash: hash,
          roleId: roleOwn.id,
          status: "active",
        },
      ],
    });

    const c1 = await prisma.whatsAppContact.create({
      data: { waId: `wa-ll-${randomUUID()}` },
    });
    const c2 = await prisma.whatsAppContact.create({
      data: { waId: `wa-ll-${randomUUID()}` },
    });
    const c3 = await prisma.whatsAppContact.create({
      data: { waId: `wa-ll-${randomUUID()}` },
    });

    const l1 = await prisma.lead.create({
      data: { contactId: c1.id, source: "manual", status: "new" },
    });
    leadUnassigned = l1.id;

    const l2 = await prisma.lead.create({
      data: {
        contactId: c2.id,
        source: "manual",
        status: "contacted",
        assignedUserId: userOwnId,
      },
    });
    leadMine = l2.id;

    const l3 = await prisma.lead.create({
      data: {
        contactId: c3.id,
        source: "manual",
        status: "new",
        assignedUserId: otherUserId,
      },
    });
    leadOther = l3.id;

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailOwn, password },
    });
    tokenOwn = (JSON.parse(login.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({
      where: { id: { in: [leadUnassigned, leadMine, leadOther] } },
    });
    await prisma.whatsAppContact.deleteMany({
      where: { waId: { startsWith: "wa-ll-" } },
    });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOwn, emailOther] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOwn, emailOther] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("400 status de filtro inválido", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/leads?status=invalid",
      headers: { authorization: `Bearer ${tokenOwn}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 own: vê não atribuído e o seu; não vê só do outro", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/leads?limit=100",
      headers: { authorization: `Bearer ${tokenOwn}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: { id: string }[];
      total: number;
    };
    const ids = new Set(body.items.map((i) => i.id));
    expect(ids.has(leadUnassigned)).toBe(true);
    expect(ids.has(leadMine)).toBe(true);
    expect(ids.has(leadOther)).toBe(false);
  });

  it("200 filtro status=contacted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/leads?status=contacted",
      headers: { authorization: `Bearer ${tokenOwn}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: { id: string; status: string }[] };
    expect(body.items.every((i) => i.status === "contacted")).toBe(true);
    expect(body.items.some((i) => i.id === leadMine)).toBe(true);
  });
});
