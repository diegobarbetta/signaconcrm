import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("DELETE /leads/:id", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNo: string;
  const emailOk = "lead-delete-ok@test.local";
  const emailNo = "lead-delete-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const p = await prisma.permission.upsert({
      where: { code: "leads.delete" },
      create: { id: randomUUID(), code: "leads.delete" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_lead_delete_ok" },
      create: { id: randomUUID(), name: "vitest_lead_delete_ok", dataScope: "all" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_lead_delete_no" },
      create: { id: randomUUID(), name: "vitest_lead_delete_no", dataScope: "all" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: p.id }],
      skipDuplicates: true,
    });

    const hash = await argon2.hash(password);
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo] } },
    });

    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "DelOk",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "DelNo",
          email: emailNo,
          passwordHash: hash,
          roleId: roleNo.id,
          status: "active",
        },
      ],
    });

    const loginOk = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailOk, password },
    });
    tokenOk = (loginOk.json() as { access_token: string }).access_token;

    const loginNo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailNo, password },
    });
    tokenNo = (loginNo.json() as { access_token: string }).access_token;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it("204 remove lead", async () => {
    const lead = await prisma.lead.create({
      data: { source: "vitest", status: "new" },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/leads/${lead.id}`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(204);

    const gone = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(gone).toBeNull();
  });

  it("404 lead inexistente", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/leads/${randomUUID()}`,
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("403 sem leads.delete", async () => {
    const l = await prisma.lead.create({
      data: { source: "vitest", status: "new" },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/leads/${l.id}`,
      headers: { authorization: `Bearer ${tokenNo}` },
    });
    expect(res.statusCode).toBe(403);
    await prisma.lead.delete({ where: { id: l.id } });
  });
});
