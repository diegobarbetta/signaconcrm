import type { Prisma, PrismaClient } from "@prisma/client";

/** Estados alinhados ao filtro «vencidas» (status ≠ done). */
export const DEMAND_STATUSES = ["open", "in_progress", "done"] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export function isValidDemandStatus(value: string): value is DemandStatus {
  return (DEMAND_STATUSES as readonly string[]).includes(value);
}

/** Aceita ISO 8601; rejeita ausente ou inválido. */
export function parseDueAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

export const demandListSelect = {
  id: true,
  title: true,
  description: true,
  dueAt: true,
  status: true,
  assignedUserId: true,
  leadId: true,
  clientId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type DemandRow = Prisma.DemandGetPayload<{
  select: typeof demandListSelect;
}>;

export type ListDemandsFilters = {
  status?: DemandStatus;
  overdueOnly?: boolean;
  assignedUserId?: string | null;
  leadId?: string | null;
  clientId?: string | null;
  limit: number;
  offset: number;
};

function buildDemandWhere(filters: ListDemandsFilters): Prisma.DemandWhereInput {
  const parts: Prisma.DemandWhereInput[] = [];
  if (filters.status) {
    parts.push({ status: filters.status });
  }
  if (filters.assignedUserId) {
    parts.push({ assignedUserId: filters.assignedUserId });
  }
  if (filters.leadId) {
    parts.push({ leadId: filters.leadId });
  }
  if (filters.clientId) {
    parts.push({ clientId: filters.clientId });
  }
  if (filters.overdueOnly) {
    parts.push({ dueAt: { lt: new Date() } });
    parts.push({ status: { not: "done" } });
  }
  if (parts.length === 0) {
    return {};
  }
  return { AND: parts };
}

export async function listDemands(
  prisma: PrismaClient,
  filters: ListDemandsFilters,
) {
  const where = buildDemandWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.demand.count({ where }),
    prisma.demand.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: filters.limit,
      skip: filters.offset,
      select: demandListSelect,
    }),
  ]);
  return { total, rows };
}

export async function createDemand(
  prisma: PrismaClient,
  input: {
    title: string;
    description?: string | null;
    dueAt: Date;
    status: DemandStatus;
    assignedUserId?: string | null;
    leadId?: string | null;
    clientId?: string | null;
  },
) {
  const hasLead =
    input.leadId !== undefined &&
    input.leadId !== null &&
    String(input.leadId).length > 0;
  const hasClient =
    input.clientId !== undefined &&
    input.clientId !== null &&
    String(input.clientId).length > 0;
  if (hasLead && hasClient) {
    throw new Error("lead_and_client_exclusive");
  }

  return prisma.demand.create({
    data: {
      title: input.title.trim(),
      description:
        input.description === undefined || input.description === null
          ? null
          : String(input.description).trim() || null,
      dueAt: input.dueAt,
      status: input.status,
      assignedUserId: input.assignedUserId ?? null,
      leadId: hasLead ? input.leadId! : null,
      clientId: hasClient ? input.clientId! : null,
    },
    select: demandListSelect,
  });
}

export type PatchDemandInput = {
  status?: DemandStatus;
  dueAt?: Date;
  assignedUserId?: string | null;
  /** Define vínculo com lead; limpa client_id na BD. */
  leadId?: string | null;
  /** Define vínculo com cliente; limpa lead_id na BD. */
  clientId?: string | null;
};

/**
 * Aplica patch parcial. Regras: não pode definir lead e cliente não-nulos em simultâneo
 * (o chamador deve passar só um lado por pedido ou explicitar null para limpar).
 */
export async function patchDemand(
  prisma: PrismaClient,
  demandId: string,
  patch: PatchDemandInput,
) {
  const data: Prisma.DemandUncheckedUpdateInput = {};

  if (patch.status !== undefined) {
    data.status = patch.status;
  }
  if (patch.dueAt !== undefined) {
    data.dueAt = patch.dueAt;
  }
  if (patch.assignedUserId !== undefined) {
    data.assignedUserId = patch.assignedUserId;
  }

  if (patch.leadId !== undefined) {
    data.leadId = patch.leadId;
    if (patch.leadId !== null && patch.clientId === undefined) {
      data.clientId = null;
    }
  }
  if (patch.clientId !== undefined) {
    data.clientId = patch.clientId;
    if (patch.clientId !== null && patch.leadId === undefined) {
      data.leadId = null;
    }
  }

  return prisma.demand.update({
    where: { id: demandId },
    data,
    select: demandListSelect,
  });
}

export async function deleteDemand(
  prisma: PrismaClient,
  demandId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const existing = await prisma.demand.findUnique({
    where: { id: demandId },
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, error: "not_found" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.deleteMany({
      where: { demandId },
    });
    await tx.demand.delete({
      where: { id: demandId },
    });
  });

  return { ok: true };
}
