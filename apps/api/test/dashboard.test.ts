import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { utcDayBounds } from "../src/modules/tasks/tasks.service.js";

const prisma = new PrismaClient();

describe("Dashboard summary (Epic 7)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokenOk: string;
  let tokenNo: string;
  const emailOk = "dashboard-ok@test.local";
  const emailNo = "dashboard-noperm@test.local";
  const password = "SecretPass123!";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    app = await buildApp({ logger: false });

    const pDash = await prisma.permission.upsert({
      where: { code: "dashboard.read" },
      create: { id: randomUUID(), code: "dashboard.read" },
      update: {},
    });

    const roleOk = await prisma.role.upsert({
      where: { name: "vitest_dashboard_ok" },
      create: { id: randomUUID(), name: "vitest_dashboard_ok", dataScope: "all" },
      update: {},
    });
    const roleNo = await prisma.role.upsert({
      where: { name: "vitest_dashboard_no" },
      create: { id: randomUUID(), name: "vitest_dashboard_no", dataScope: "all" },
      update: {},
    });

    await prisma.rolePermission.createMany({
      data: [{ roleId: roleOk.id, permissionId: pDash.id }],
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
          name: "DashOk",
          email: emailOk,
          passwordHash: hash,
          roleId: roleOk.id,
          status: "active",
        },
        {
          id: randomUUID(),
          name: "DashNo",
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
    tokenOk = (JSON.parse(loginOk.body) as { access_token: string }).access_token;

    const loginNo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailNo, password },
    });
    tokenNo = (JSON.parse(loginNo.body) as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({
      where: { title: { startsWith: "Vitest dash " } },
    });
    await prisma.demand.deleteMany({
      where: { title: { startsWith: "Vitest dash " } },
    });
    await prisma.lead.deleteMany({
      where: { source: "vitest_dashboard" },
    });
    await prisma.whatsAppContact.deleteMany({
      where: { waId: { startsWith: "vitest-dash-" } },
    });
    await prisma.userSession.deleteMany({
      where: { user: { email: { in: [emailOk, emailNo] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailOk, emailNo] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("403 GET /dashboard/summary sem dashboard.read", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: { authorization: `Bearer ${tokenNo}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 agregados + previews opcionais", async () => {
    const wa = `vitest-dash-${randomUUID()}`;
    const contact = await prisma.whatsAppContact.create({
      data: { waId: wa },
    });
    await prisma.lead.create({
      data: {
        contactId: contact.id,
        source: "vitest_dashboard",
        status: "contacted",
        potentialValue: 2500,
      },
    });

    const clientContact = await prisma.whatsAppContact.create({
      data: { waId: `vitest-dash-client-${randomUUID()}` },
    });
    const clientLead = await prisma.lead.create({
      data: {
        contactId: clientContact.id,
        source: "vitest_dashboard",
        status: "qualified",
        potentialValue: 5000,
      },
    });
    const client = await prisma.client.create({
      data: {
        leadId: clientLead.id,
        contactId: clientContact.id,
        generatedValue: 4100,
      },
    });
    await prisma.clientService.create({
      data: {
        clientId: client.id,
        name: "Retainer",
        status: "active",
        amount: 4100,
      },
    });

    const now = new Date();
    const { start, end } = utcDayBounds(now);
    const past = new Date(now.getTime() - 86400_000 * 2);
    const futureFar = new Date(end.getTime() + 86400_000 * 3);

    await prisma.task.createMany({
      data: [
        {
          id: randomUUID(),
          title: "Vitest dash task overdue",
          status: "open",
          dueAt: past,
        },
        {
          id: randomUUID(),
          title: "Vitest dash task today",
          status: "open",
          dueAt: new Date(start.getTime() + 60_000),
        },
        {
          id: randomUUID(),
          title: "Vitest dash task up",
          status: "open",
          dueAt: futureFar,
        },
      ],
    });

    await prisma.demand.createMany({
      data: [
        {
          id: randomUUID(),
          title: "Vitest dash demand overdue",
          dueAt: past,
          status: "open",
        },
        {
          id: randomUUID(),
          title: "Vitest dash demand ok",
          dueAt: futureFar,
          status: "in_progress",
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/dashboard/summary?task_preview_limit=2&demand_preview_limit=1",
      headers: { authorization: `Bearer ${tokenOk}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      leads_by_status: Record<string, number>;
      lead_value: {
        total_potential: number;
        avg_days_in_status: Record<string, number>;
      };
      clients: { total_generated_value: number };
      tasks: { overdue: number; today: number; upcoming: number; open_total: number };
      demands: { overdue: number; by_status: Record<string, number> };
      tasks_overdue_preview: { title: string }[];
      demands_overdue_preview: { title: string }[];
      generated_at: string;
    };

    expect(body.generated_at).toBeTruthy();
    expect(body.leads_by_status.contacted).toBeGreaterThanOrEqual(1);
    expect(body.lead_value.total_potential).toBeGreaterThanOrEqual(2500);
    expect(body.lead_value.avg_days_in_status.contacted).toBeTypeOf("number");
    expect(body.clients.total_generated_value).toBeGreaterThanOrEqual(4100);
    expect(body.tasks.overdue).toBeGreaterThanOrEqual(1);
    expect(body.tasks.today).toBeGreaterThanOrEqual(1);
    expect(body.tasks.upcoming).toBeGreaterThanOrEqual(1);
    expect(body.tasks.open_total).toBeGreaterThanOrEqual(3);
    expect(body.demands.overdue).toBeGreaterThanOrEqual(1);
    expect(body.demands.by_status.open).toBeGreaterThanOrEqual(1);
    expect(body.tasks_overdue_preview.length).toBeLessThanOrEqual(2);
    expect(body.demands_overdue_preview.length).toBe(1);
    expect(body.demands_overdue_preview[0].title).toBe("Vitest dash demand overdue");
  });
});
