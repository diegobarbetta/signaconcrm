import type { PrismaClient } from "@prisma/client";

import { diffDays, roundDays } from "../../lib/lead-time.js";
import { moneyToNumber } from "../../lib/money.js";
import { shouldCountServiceTowardsRealValue } from "../clients/clients.service.js";
import { utcDayBounds } from "../tasks/tasks.service.js";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type DashboardSummaryOptions = {
  taskPreviewLimit: number;
  demandPreviewLimit: number;
};

function taskWhereOverdue() {
  const now = new Date();
  return {
    status: "open" as const,
    /** NULL excluído: em SQL `due_at < now` não aplica a NULL. */
    dueAt: { lt: now },
  };
}

function taskWhereToday() {
  const now = new Date();
  const { start, end } = utcDayBounds(now);
  return {
    status: "open" as const,
    dueAt: { gte: start, lte: end },
  };
}

function taskWhereUpcoming() {
  const now = new Date();
  const { end } = utcDayBounds(now);
  return {
    status: "open" as const,
    dueAt: { gt: end },
  };
}

function demandWhereOverdue() {
  const now = new Date();
  return {
    status: { not: "done" },
    dueAt: { lt: now },
  };
}

export async function getDashboardSummary(
  prisma: PrismaClient,
  options: DashboardSummaryOptions,
) {
  const now = new Date();

  const [
    leadGroups,
    leadValueRows,
    clientValueRows,
    leadStatusRows,
    taskOverdue,
    taskToday,
    taskUpcoming,
    taskOpenTotal,
    demandOverdue,
    demandGroups,
  ] = await Promise.all([
    prisma.lead.groupBy({
      where: {
        client: { is: null },
      },
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { client: { is: null } },
      select: { status: true, potentialValue: true },
    }),
    prisma.client.findMany({
      select: {
        services: {
          select: {
            status: true,
            amount: true,
          },
        },
      },
    }),
    prisma.lead.findMany({
      where: { client: { is: null } },
      select: {
        createdAt: true,
        statusEvents: {
          orderBy: { createdAt: "asc" },
          select: { toStatus: true, createdAt: true },
        },
      },
    }),
    prisma.task.count({ where: taskWhereOverdue() }),
    prisma.task.count({ where: taskWhereToday() }),
    prisma.task.count({ where: taskWhereUpcoming() }),
    prisma.task.count({ where: { status: "open" } }),
    prisma.demand.count({ where: demandWhereOverdue() }),
    prisma.demand.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const leads_by_status: Record<string, number> = {};
  for (const row of leadGroups) {
    leads_by_status[row.status] = row._count._all;
  }

  const demands_by_status: Record<string, number> = {};
  for (const row of demandGroups) {
    demands_by_status[row.status] = row._count._all;
  }

  const lead_value_by_status: Record<string, number> = {};
  let total_lead_potential_value = 0;
  for (const row of leadValueRows) {
    const amount = moneyToNumber(row.potentialValue) ?? 0;
    total_lead_potential_value += amount;
    lead_value_by_status[row.status] = roundMoney(
      (lead_value_by_status[row.status] ?? 0) + amount,
    );
  }

  let total_client_generated_value = 0;
  let clients_with_generated_value = 0;
  for (const row of clientValueRows) {
    const amount = row.services.reduce((sum, service) => {
      if (!shouldCountServiceTowardsRealValue(service.status)) {
        return sum;
      }
      return sum + (moneyToNumber(service.amount) ?? 0);
    }, 0);
    total_client_generated_value += amount;
    clients_with_generated_value += 1;
  }

  const lead_status_days_totals: Record<string, { total: number; count: number }> =
    {};
  for (const lead of leadStatusRows) {
    const timeline = lead.statusEvents;
    if (timeline.length === 0) {
      const days = diffDays(lead.createdAt, now);
      const bucket = lead_status_days_totals.new ?? { total: 0, count: 0 };
      bucket.total += days;
      bucket.count += 1;
      lead_status_days_totals.new = bucket;
      continue;
    }

    for (let index = 0; index < timeline.length; index += 1) {
      const current = timeline[index]!;
      const next = timeline[index + 1];
      const endAt = next?.createdAt ?? now;
      const bucket = lead_status_days_totals[current.toStatus] ?? {
        total: 0,
        count: 0,
      };
      bucket.total += diffDays(current.createdAt, endAt);
      bucket.count += 1;
      lead_status_days_totals[current.toStatus] = bucket;
    }
  }

  const avg_days_in_status: Record<string, number> = {};
  for (const [status, totals] of Object.entries(lead_status_days_totals)) {
    avg_days_in_status[status] = roundDays(totals.total / totals.count);
  }

  const task_preview_limit = Math.min(
    50,
    Math.max(0, options.taskPreviewLimit),
  );
  const demand_preview_limit = Math.min(
    50,
    Math.max(0, options.demandPreviewLimit),
  );

  const [tasks_overdue_preview, demands_overdue_preview] = await Promise.all([
    task_preview_limit > 0
      ? prisma.task.findMany({
          where: taskWhereOverdue(),
          orderBy: { dueAt: "asc" },
          take: task_preview_limit,
          select: {
            id: true,
            title: true,
            dueAt: true,
            assignedUserId: true,
          },
        })
      : Promise.resolve([]),
    demand_preview_limit > 0
      ? prisma.demand.findMany({
          where: demandWhereOverdue(),
          orderBy: { dueAt: "asc" },
          take: demand_preview_limit,
          select: {
            id: true,
            title: true,
            dueAt: true,
            status: true,
            assignedUserId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    generated_at: now.toISOString(),
    leads_by_status,
    lead_value: {
      total_potential: roundMoney(total_lead_potential_value),
      by_status: lead_value_by_status,
      avg_days_in_status,
    },
    clients: {
      total_generated_value: roundMoney(total_client_generated_value),
      avg_generated_value:
        clients_with_generated_value > 0
          ? roundMoney(total_client_generated_value / clients_with_generated_value)
          : 0,
    },
    tasks: {
      overdue: taskOverdue,
      today: taskToday,
      upcoming: taskUpcoming,
      open_total: taskOpenTotal,
    },
    demands: {
      overdue: demandOverdue,
      by_status: demands_by_status,
    },
    tasks_overdue_preview: tasks_overdue_preview.map((t) => ({
      id: t.id,
      title: t.title,
      due_at: t.dueAt!.toISOString(),
      assigned_user_id: t.assignedUserId,
    })),
    demands_overdue_preview: demands_overdue_preview.map((d) => ({
      id: d.id,
      title: d.title,
      due_at: d.dueAt.toISOString(),
      status: d.status,
      assigned_user_id: d.assignedUserId,
    })),
  };
}
