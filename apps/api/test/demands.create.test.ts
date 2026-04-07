import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("Demands create (Story 5.1)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNo: string;
  let assigneeId: string;
  const emailOk = "demands-create-ok@test.local";
  const emailNo = "demands-create-noperm@test.local";
  const emailAssignee = "demands-create-assignee@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const pCreate = await prisma.permission.upsert({
      where: { code: "demands.create" },
      create: { id: randomUUID(), code: "demands.create" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_demands_create_ok" },
      create: { id: randomUUID(), name: "vitest_demands_create_ok", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_demands_create_no" },
      create: { id: randomUUID(), name: "vitest_demands_create_no", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: pCreate.id }],
      skipDuplicates: true,
    });

    const hash = await argon2.hash(password);
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo, emailAssignee] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo, emailAssignee] } },
    });

    assigneeId = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: randomUUID(),
          name: "Dok",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "Dno",
          email: emailNo,
          passwordHash: hash,
          roleId: roleNo.id,
          status: "active",
        },
        {
          id: assigneeId,
          name: "Assignee",
          email: emailAssignee,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
      ],
    });

    const loginOk = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailOk, password },
    });
    tokenOk = (JSON.parse(loginOk.body) as { access_token: string }).access_token;

    const loginNo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailNo, password },
    });
    tokenNo = (JSON.parse(loginNo.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityType: "demand" },
    });
    await prisma.demand.deleteMany({
      where: {
        title: { startsWith: "Vitest demand" },
      },
    });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo, emailAssignee] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo, emailAssignee] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("403 POST /demands sem demands.create", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/demands",
      headers: { authorization: `Bearer ${tokenNo}` },
      payload: {
        title: "X",
        due_at: new Date().toISOString(),
        status: "open",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 sem due_at válido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/demands",
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: {
        title: "Vitest demand invalid due",
        due_at: "não-iso",
        status: "open",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 status não permitido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/demands",
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: {
        title: "Vitest demand bad status",
        due_at: new Date().toISOString(),
        status: "cancelled",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 responsável inexistente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/demands",
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: {
        title: "Vitest demand bad assignee",
        due_at: new Date().toISOString(),
        status: "open",
        assigned_user_id: randomUUID(),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("201 cria demanda com open e opcional assignee", async () => {
    const due = new Date("2026-06-01T15:00:00.000Z");
    const res = await app.inject({
      method: "POST",
      url: "/demands",
      headers: { authorization: `Bearer ${tokenOk}` },
      payload: {
        title: "Vitest demand full",
        description: "desc",
        due_at: due.toISOString(),
        status: "in_progress",
        assigned_user_id: assigneeId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      id: string;
      title: string;
      description: string | null;
      due_at: string;
      status: string;
      assigned_user_id: string | null;
    };
    expect(body.title).toBe("Vitest demand full");
    expect(body.status).toBe("in_progress");
    expect(body.due_at).toBe(due.toISOString());
    expect(body.assigned_user_id).toBe(assigneeId);
    expect(body.description).toBe("desc");

    await prisma.demand.delete({ where: { id: body.id } });
  });
});
