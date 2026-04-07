import type { Prisma, PrismaClient } from "@prisma/client";

export const TASK_STATUSES = ["open", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isValidTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function parseDueAtOptional(value: unknown): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

/** Limites do dia corrente em UTC (Epic 6.2 — bucket «hoje»). */
export function utcDayBounds(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
  return { start, end };
}

export type TaskBucket = "overdue" | "today" | "upcoming";

export type ListTasksFilters = {
  bucket?: TaskBucket;
  /** GET ?status= — ignorado quando `bucket` está definido. */
  taskStatus?: TaskStatus;
  /** Filtro explícito por responsável da task (ex.: query assigned_user_id). */
  assignedUserId?: string | null;
  /**
   * Modo «minhas» (GET ?mine=true): responsável da task = utilizador OU
   * task sem responsável mas o lead associado tem o mesmo responsável (tarefas de follow-up / automáticas).
   */
  mineUserId?: string;
  leadId?: string | null;
  clientId?: string | null;
  includeDone: boolean;
  limit: number;
  offset: number;
};

function buildTaskWhere(filters: ListTasksFilters): Prisma.TaskWhereInput {
  const parts: Prisma.TaskWhereInput[] = [];

  /** Buckets (Epic 6.2) aplicam-se só a pendentes; `include_done` ignora-se com bucket. */
  if (filters.bucket) {
    parts.push({ status: "open" });
  } else if (filters.taskStatus) {
    parts.push({ status: filters.taskStatus });
  } else if (!filters.includeDone) {
    parts.push({ status: "open" });
  }

  if (filters.mineUserId) {
    const uid = filters.mineUserId;
    parts.push({
      OR: [
        { assignedUserId: uid },
        {
          AND: [
            { assignedUserId: null },
            { lead: { is: { assignedUserId: uid } } },
          ],
        },
      ],
    });
  } else if (filters.assignedUserId) {
    parts.push({ assignedUserId: filters.assignedUserId });
  }

  if (filters.leadId) {
    parts.push({ leadId: filters.leadId });
  }
  if (filters.clientId) {
    parts.push({ clientId: filters.clientId });
  }

  const now = new Date();

  if (filters.bucket === "overdue") {
    parts.push({ dueAt: { not: null } });
    parts.push({ dueAt: { lt: now } });
  } else if (filters.bucket === "today") {
    const { start, end } = utcDayBounds(now);
    parts.push({ dueAt: { not: null } });
    parts.push({ dueAt: { gte: start, lte: end } });
  } else if (filters.bucket === "upcoming") {
    const { end } = utcDayBounds(now);
    parts.push({ dueAt: { not: null } });
    parts.push({ dueAt: { gt: end } });
  }

  if (parts.length === 0) {
    return {};
  }
  return { AND: parts };
}

export const taskListSelect = {
  id: true,
  title: true,
  status: true,
  dueAt: true,
  completedAt: true,
  assignedUserId: true,
  conversationId: true,
  leadId: true,
  clientId: true,
  demandId: true,
  source: true,
  sourceMessageId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Lista/API: demanda + lead.client para etiqueta Cliente (prioridade) vs Lead no web. */
export const taskListSelectWithDemand = {
  ...taskListSelect,
  demand: {
    select: {
      leadId: true,
      clientId: true,
    },
  },
  lead: {
    select: {
      client: { select: { id: true } },
    },
  },
} as const;

export type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;
export type TaskRowWithDemand = Prisma.TaskGetPayload<{
  select: typeof taskListSelectWithDemand;
}>;

export async function listTasks(prisma: PrismaClient, filters: ListTasksFilters) {
  const where = buildTaskWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: filters.limit,
      skip: filters.offset,
      select: taskListSelectWithDemand,
    }),
  ]);
  return { total, rows };
}

export async function createManualTask(
  prisma: PrismaClient,
  input: {
    title: string;
    status: TaskStatus;
    dueAt?: Date | null;
    assignedUserId?: string | null;
    conversationId?: string | null;
    leadId?: string | null;
    clientId?: string | null;
    demandId?: string | null;
  },
) {
  return prisma.task.create({
    data: {
      title: input.title.trim(),
      status: input.status,
      dueAt: input.dueAt ?? null,
      assignedUserId: input.assignedUserId ?? null,
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      clientId: input.clientId ?? null,
      demandId: input.demandId ?? null,
      source: "manual",
    },
    select: taskListSelectWithDemand,
  });
}

/** Story 6.4 — idempotente por `source_message_id` único. */
export async function createFollowUpTaskForInboundMessage(
  tx: Prisma.TransactionClient,
  input: {
    messageId: string;
    conversationId: string;
    leadId: string;
  },
) {
  return tx.task.create({
    data: {
      title: "Follow-up: nova mensagem",
      status: "open",
      conversationId: input.conversationId,
      leadId: input.leadId,
      source: "inbound_message",
      sourceMessageId: input.messageId,
    },
    select: { id: true },
  });
}

export async function setTaskStatus(
  prisma: PrismaClient,
  id: string,
  status: TaskStatus,
) {
  const completedAt = status === "done" ? new Date() : null;
  return prisma.task.update({
    where: { id },
    data: {
      status,
      completedAt,
    },
    select: taskListSelectWithDemand,
  });
}

export async function deleteTask(
  prisma: PrismaClient,
  id: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const existing = await prisma.task.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, error: "not_found" };
  }

  await prisma.task.delete({ where: { id } });
  return { ok: true };
}
