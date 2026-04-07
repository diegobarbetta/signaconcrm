import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

describe("Demands list filters (Story 5.2)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenRead: string;
  let tokenNo: string;
  let userA: string;
  let userB: string;
  let idOpenOverdue: string;
  let idOpenFuture: string;
  let idDonePast: string;
  let idInProgressB: string;

  const emailRead = "demands-list-read@test.local";
  const emailNo = "demands-list-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const pRead = await prisma.permission.upsert({
      where: { code: "demands.read" },
      create: { id: randomUUID(), code: "demands.read" },
      update: {},
    });

    const roleRead = await prisma.role.upsert({
      where: { name: "vitest_demands_list_read" },
      create: { id: randomUUID(), name: "vitest_demands_list_read", dataScope: "own" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_demands_list_no" },
      create: { id: randomUUID(), name: "vitest_demands_list_no", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleRead.id, permissionId: pRead.id }],
      skipDuplicates: true,
    });

    const hash = await argon2.hash(password);
    userA = randomUUID();
    userB = randomUUID();

    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailRead, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailRead, emailNo] } },
    });

    await prisma.user.createMany({
      data: [
        {
          id: userA,
          name: "UA",
          email: emailRead,
          passwordHash: hash,
          roleId: roleRead.id,
          status: "active",
        },
        {
          id: userB,
          name: "UB",
          email: emailNo,
          passwordHash: hash,
          roleId: roleNo.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "UAssignA",
          email: "demands-list-assign-a@test.local",
          passwordHash: hash,
          roleId: roleRead.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "UAssignB",
          email: "demands-list-assign-b@test.local",
          passwordHash: hash,
          roleId: roleRead.id,
          status: "active",
        },
      ],
    });

    const assignA = await prisma.user.findFirstOrThrow({
      where: { email: "demands-list-assign-a@test.local" },
    });
    const assignB = await prisma.user.findFirstOrThrow({
      where: { email: "demands-list-assign-b@test.local" },
    });

    const past = new Date(Date.now() - 86400_000 * 2);
    const future = new Date(Date.now() + 86400_000 * 30);

    const rows = await prisma.demand.createMany({
      data: [
        {
          id: randomUUID(),
          title: "Vitest list open overdue",
          dueAt: past,
          status: "open",
          assignedUserId: assignA.id,
        },
        {
          id: randomUUID(),
          title: "Vitest list open future",
          dueAt: future,
          status: "open",
          assignedUserId: assignA.id,
        },
        {
          id: randomUUID(),
          title: "Vitest list done past",
          dueAt: past,
          status: "done",
          assignedUserId: assignB.id,
        },
        {
          id: randomUUID(),
          title: "Vitest list in_progress B",
          dueAt: future,
          status: "in_progress",
          assignedUserId: assignB.id,
        },
      ],
    });
    expect(rows.count).toBe(4);

    const list = await prisma.demand.findMany({
      where: { title: { startsWith: "Vitest list " } },
      select: { id: true, title: true },
    });
    idOpenOverdue = list.find((x) => x.title === "Vitest list open overdue")!.id;
    idOpenFuture = list.find((x) => x.title === "Vitest list open future")!.id;
    idDonePast = list.find((x) => x.title === "Vitest list done past")!.id;
    idInProgressB = list.find((x) => x.title === "Vitest list in_progress B")!.id;

    const loginRead = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailRead, password },
    });
    tokenRead = (JSON.parse(loginRead.body) as { access_token: string }).access_token;

    const loginNo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailNo, password },
    });
    tokenNo = (JSON.parse(loginNo.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await prisma.demand.deleteMany({
      where: { title: { startsWith: "Vitest list " } },
    });
    await prisma.userSession.deleteMany({
      where: {
        user: {
          email: {
            in: [
              emailRead,
              emailNo,
              "demands-list-assign-a@test.local",
              "demands-list-assign-b@test.local",
            ],
          },
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            emailRead,
            emailNo,
            "demands-list-assign-a@test.local",
            "demands-list-assign-b@test.local",
          ],
        },
      },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("403 GET /demands sem demands.read", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/demands",
      headers: { authorization: `Bearer ${tokenNo}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 status de filtro inválido", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/demands?status=foo",
      headers: { authorization: `Bearer ${tokenRead}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("filtra por status=open", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/demands?status=open",
      headers: { authorization: `Bearer ${tokenRead}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: { id: string }[];
      total: number;
    };
    const ids = new Set(body.items.map((i) => i.id));
    expect(ids.has(idOpenOverdue)).toBe(true);
    expect(ids.has(idOpenFuture)).toBe(true);
    expect(ids.has(idDonePast)).toBe(false);
    expect(ids.has(idInProgressB)).toBe(false);
  });

  it("filtra vencidas: due_at < now e status ≠ done", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/demands?overdue=true",
      headers: { authorization: `Bearer ${tokenRead}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: { id: string }[];
    };
    const ids = new Set(body.items.map((i) => i.id));
    expect(ids.has(idOpenOverdue)).toBe(true);
    expect(ids.has(idDonePast)).toBe(false);
    expect(ids.has(idOpenFuture)).toBe(false);
  });

  it("filtra por responsável", async () => {
    const assignB = await prisma.user.findFirstOrThrow({
      where: { email: "demands-list-assign-b@test.local" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/demands?assigned_user_id=${assignB.id}`,
      headers: { authorization: `Bearer ${tokenRead}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: { id: string; assigned_user_id: string | null }[];
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(2);
    for (const it of body.items) {
      expect(it.assigned_user_id).toBe(assignB.id);
    }
    const ids = new Set(body.items.map((i) => i.id));
    expect(ids.has(idInProgressB)).toBe(true);
    expect(ids.has(idDonePast)).toBe(true);
    expect(ids.has(idOpenOverdue)).toBe(false);
  });
});
