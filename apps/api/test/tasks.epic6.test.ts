import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { utcDayBounds } from "../src/modules/tasks/tasks.service.js";

const prisma = new PrismaClient();

describe("Tasks Epic 6 (criar, listar buckets, concluir)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenAll: string;
  let userId: string;
  let convId: string;
  let contactId: string;
  let leadId: string;
  let demandId: string;

  const email = "tasks-epic6@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    delete process.env.TASK_DONE_SETS_CONVERSATION_ANSWERED;
    app = await buildApp({ logger: false });

    for (const code of ["tasks.create", "tasks.read", "tasks.update"] as const) {
      await prisma.permission.upsert({
        where: { code },
        create: { id: randomUUID(), code },
        update: {},
      });
    }
    const pCreate = await prisma.permission.findUniqueOrThrow({
      where: { code: "tasks.create" },
    });
    const pRead = await prisma.permission.findUniqueOrThrow({
      where: { code: "tasks.read" },
    });
    const pUpdate = await prisma.permission.findUniqueOrThrow({
      where: { code: "tasks.update" },
    });

    const role = await prisma.role.upsert({
      where: { name: "vitest_tasks_epic6" },
      create: { id: randomUUID(), name: "vitest_tasks_epic6", dataScope: "own" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [
        { roleId: role.id, permissionId: pCreate.id },
        { roleId: role.id, permissionId: pRead.id },
        { roleId: role.id, permissionId: pUpdate.id },
      ],
      skipDuplicates: true,
    });

    const hash = await argon2.hash(password);
    userId = randomUUID();

    await prisma.userSession.deleteMany({
      where: { user: { email } },
    });
    await prisma.user.deleteMany({ where: { email } });

    await prisma.user.create({
      data: {
        id: userId,
        name: "TaskUser",
        email,
        passwordHash: hash,
        roleId: role.id,
        status: "active",
      },
    });

    const contact = await prisma.whatsAppContact.create({
      data: { waId: `wa-task-${randomUUID()}` },
    });
    contactId = contact.id;
    const lead = await prisma.lead.create({
      data: { contactId: contact.id, source: "manual", status: "new" },
    });
    leadId = lead.id;
    const conv = await prisma.whatsAppConversation.create({
      data: {
        contactId: contact.id,
        phoneNumberId: "pn-task-epic6",
        unanswered: true,
      },
    });
    convId = conv.id;

    const demand = await prisma.demand.create({
      data: {
        title: "Vitest demand for task",
        dueAt: new Date("2026-12-01T12:00:00.000Z"),
        status: "open",
      },
    });
    demandId = demand.id;

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    tokenAll = (JSON.parse(login.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({
      where: { title: { startsWith: "Vitest task " } },
    });
    await prisma.client.deleteMany({ where: { leadId } });
    await prisma.demand.deleteMany({ where: { id: demandId } });
    await prisma.whatsAppConversation.deleteMany({ where: { id: convId } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.whatsAppContact.deleteMany({ where: { id: contactId } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it("201 POST /tasks manual com vínculos", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: { authorization: `Bearer ${tokenAll}` },
      payload: {
        title: "Vitest task manual",
        status: "open",
        due_at: new Date("2026-10-01T15:00:00.000Z").toISOString(),
        assigned_user_id: userId,
        conversation_id: convId,
        lead_id: leadId,
        demand_id: demandId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { source: string | null; assigned_user_id: string | null };
    expect(body.source).toBe("manual");
    expect(body.assigned_user_id).toBe(userId);
  });

  it("GET /tasks?mine=true lista o responsável", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/tasks?mine=true",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body) as { items: { title: string }[]; total: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.items.some((i) => i.title === "Vitest task manual")).toBe(true);
  });

  it("GET /tasks?mine=true&status= filtra open | done", async () => {
    const doneId = randomUUID();
    await prisma.task.create({
      data: {
        id: doneId,
        title: "Vitest task status filter done",
        status: "done",
        assignedUserId: userId,
        completedAt: new Date(),
      },
    });

    const resDone = await app.inject({
      method: "GET",
      url: "/tasks?mine=true&status=done&include_done=true",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    expect(resDone.statusCode).toBe(200);
    const dataDone = JSON.parse(resDone.body) as {
      items: { title: string; status: string }[];
    };
    expect(dataDone.items.every((i) => i.status === "done")).toBe(true);
    expect(dataDone.items.some((i) => i.title === "Vitest task status filter done")).toBe(true);

    const resOpen = await app.inject({
      method: "GET",
      url: "/tasks?mine=true&status=open&include_done=true",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    expect(resOpen.statusCode).toBe(200);
    const dataOpen = JSON.parse(resOpen.body) as {
      items: { title: string; status: string }[];
    };
    expect(dataOpen.items.every((i) => i.status === "open")).toBe(true);
    expect(dataOpen.items.some((i) => i.title === "Vitest task manual")).toBe(true);

    const bad = await app.inject({
      method: "GET",
      url: "/tasks?mine=true&status=invalid",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    expect(bad.statusCode).toBe(400);

    await prisma.task.delete({ where: { id: doneId } });
  });

  it("GET /tasks inclui lead_client_id quando o lead foi convertido em Client", async () => {
    const client = await prisma.client.create({
      data: {
        id: randomUUID(),
        leadId: leadId,
        contactId: contactId,
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/tasks?mine=true",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body) as {
      items: { title: string; lead_client_id: string | null }[];
    };
    const manual = data.items.find((i) => i.title === "Vitest task manual");
    expect(manual?.lead_client_id).toBe(client.id);

    await prisma.client.delete({ where: { id: client.id } });
  });

  it("buckets overdue / today / upcoming", async () => {
    const now = new Date();
    const { start, end } = utcDayBounds(now);
    const past = new Date(now.getTime() - 86400_000 * 3);
    const futureFar = new Date(end.getTime() + 86400_000 * 5);

    await prisma.task.createMany({
      data: [
        {
          id: randomUUID(),
          title: "Vitest task overdue",
          status: "open",
          dueAt: past,
        },
        {
          id: randomUUID(),
          title: "Vitest task today",
          status: "open",
          dueAt: new Date(start.getTime() + 3600_000),
        },
        {
          id: randomUUID(),
          title: "Vitest task upcoming",
          status: "open",
          dueAt: futureFar,
        },
      ],
    });

    const overdue = await app.inject({
      method: "GET",
      url: "/tasks?bucket=overdue",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    expect(overdue.statusCode).toBe(200);
    const o = JSON.parse(overdue.body) as { items: { title: string }[] };
    expect(o.items.some((i) => i.title === "Vitest task overdue")).toBe(true);
    expect(o.items.some((i) => i.title === "Vitest task upcoming")).toBe(false);

    const today = await app.inject({
      method: "GET",
      url: "/tasks?bucket=today",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    const t = JSON.parse(today.body) as { items: { title: string }[] };
    expect(t.items.some((i) => i.title === "Vitest task today")).toBe(true);

    const upcoming = await app.inject({
      method: "GET",
      url: "/tasks?bucket=upcoming",
      headers: { authorization: `Bearer ${tokenAll}` },
    });
    const u = JSON.parse(upcoming.body) as { items: { title: string }[] };
    expect(u.items.some((i) => i.title === "Vitest task upcoming")).toBe(true);

    await prisma.task.deleteMany({
      where: { title: { startsWith: "Vitest task over" } },
    });
    await prisma.task.deleteMany({
      where: { title: { startsWith: "Vitest task tod" } },
    });
    await prisma.task.deleteMany({
      where: { title: { startsWith: "Vitest task upc" } },
    });
  });

  it("PATCH /tasks/:id marca done e define completed_at", async () => {
    const t = await prisma.task.create({
      data: {
        title: "Vitest task to complete",
        status: "open",
        dueAt: new Date("2026-11-01T12:00:00.000Z"),
      },
      select: { id: true },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/tasks/${t.id}`,
      headers: { authorization: `Bearer ${tokenAll}` },
      payload: { status: "done" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string; completed_at: string | null };
    expect(body.status).toBe("done");
    expect(body.completed_at).toBeTruthy();

    await prisma.task.delete({ where: { id: t.id } });
  });

  it("Story 6.5: PATCH done marca conversa respondida se TASK_DONE_SETS_CONVERSATION_ANSWERED=true", async () => {
    const c = await prisma.whatsAppContact.create({
      data: { waId: `wa-65-${randomUUID()}` },
    });
    const conv = await prisma.whatsAppConversation.create({
      data: {
        contactId: c.id,
        phoneNumberId: "pn-65",
        unanswered: true,
      },
    });
    const task = await prisma.task.create({
      data: {
        title: "Vitest 6.5 task",
        status: "open",
        conversationId: conv.id,
        source: "manual",
      },
      select: { id: true },
    });

    process.env.TASK_DONE_SETS_CONVERSATION_ANSWERED = "true";
    const res = await app.inject({
      method: "PATCH",
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${tokenAll}` },
      payload: { status: "done" },
    });
    delete process.env.TASK_DONE_SETS_CONVERSATION_ANSWERED;

    expect(res.statusCode).toBe(200);

    const convAfter = await prisma.whatsAppConversation.findUnique({
      where: { id: conv.id },
      select: { unanswered: true },
    });
    expect(convAfter?.unanswered).toBe(false);

    await prisma.task.deleteMany({ where: { id: task.id } });
    await prisma.whatsAppConversation.deleteMany({ where: { id: conv.id } });
    await prisma.whatsAppContact.deleteMany({ where: { id: c.id } });
  });
});
