import type { Prisma, PrismaClient } from "@prisma/client";

import type { DataScope } from "../../lib/data-scope.js";
import { parseMoneyInput } from "../../lib/money.js";

/** Pipeline comercial (criação manual e PATCH de estado). */
export const LEAD_PIPELINE_STATUSES = ["new", "contacted", "qualified", "lost"] as const;
export type LeadPipelineStatus = (typeof LEAD_PIPELINE_STATUSES)[number];

/** Estado após arquivar cliente (reversão a lead); não definível por PATCH directo. */
export const ARCHIVED_CLIENT_STATUS = "archived_client" as const;

/** Filtros de listagem: pipeline + arquivados. */
export const LEAD_FILTER_STATUSES = [
  ...LEAD_PIPELINE_STATUSES,
  ARCHIVED_CLIENT_STATUS,
] as const;
export type LeadFilterStatus = (typeof LEAD_FILTER_STATUSES)[number];

export function isPipelineLeadStatus(s: string): s is LeadPipelineStatus {
  return (LEAD_PIPELINE_STATUSES as readonly string[]).includes(s);
}

export function isAllowedLeadFilterStatus(s: string): s is LeadFilterStatus {
  return (LEAD_FILTER_STATUSES as readonly string[]).includes(s);
}

/** Listagem com escopo de dados (own: não atribuído ou atribuído ao utilizador). */
export function buildLeadListWhere(input: {
  dataScope: DataScope;
  currentUserId: string;
  status?: string;
  assignedUserId?: string;
  searchWa?: string;
}): Prisma.LeadWhereInput {
  const parts: Prisma.LeadWhereInput[] = [];

  parts.push({ client: { is: null } });

  if (input.dataScope === "own") {
    parts.push({
      OR: [
        { assignedUserId: null },
        { assignedUserId: input.currentUserId },
      ],
    });
  }

  if (input.status !== undefined && input.status.trim() !== "") {
    parts.push({ status: input.status.trim() });
  }

  if (input.assignedUserId !== undefined && input.assignedUserId.trim() !== "") {
    parts.push({ assignedUserId: input.assignedUserId.trim() });
  }

  const q = input.searchWa?.trim();
  if (q) {
    parts.push({
      OR: [
        { contact: { waId: { contains: q, mode: "insensitive" } } },
        { displayName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phoneSecondary: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        {
          noteEntries: {
            some: { body: { contains: q, mode: "insensitive" } },
          },
        },
      ],
    });
  }

  if (parts.length === 0) {
    return {};
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  return { AND: parts };
}

export async function updateLeadStatus(
  prisma: PrismaClient,
  leadId: string,
  toStatus: string,
  changedByUserId: string,
): Promise<
  | { ok: true; lead: { id: string; status: string } }
  | { ok: false; error: "not_found" | "invalid_status" | "unchanged" }
> {
  if (!isPipelineLeadStatus(toStatus)) {
    return { ok: false, error: "invalid_status" };
  }

  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  if (existing.status === toStatus) {
    return { ok: false, error: "unchanged" };
  }

  const fromStatus = existing.status;

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { status: toStatus },
    }),
    prisma.leadStatusEvent.create({
      data: {
        leadId,
        fromStatus,
        toStatus,
        changedByUserId,
      },
    }),
  ]);

  return {
    ok: true,
    lead: { id: leadId, status: toStatus },
  };
}

const QUALIFIED_FOR_CONVERSION = "qualified";

/** Normaliza wa_id: trim, remove espaços, opcional + e mantém dígitos. */
export function normalizeWaId(raw: string): string {
  const s = raw.trim().replace(/\s+/g, "");
  const digits = (s.startsWith("+") ? s.slice(1) : s).replace(/\D/g, "");
  return digits.length > 0 ? digits : s;
}

export type ManualLeadResultRow = {
  id: string;
  source: string;
  status: string;
  wa_id: string | null;
  display_name: string | null;
  city: string | null;
  email: string | null;
  phone_secondary: string | null;
  potential_value: number | null;
  assigned_user_id: string | null;
  created_at: string;
};

export async function createManualLead(
  prisma: PrismaClient,
  input: {
    waIdRaw?: string | null;
    source: string;
    status?: string;
    assignedUserId?: string | null;
    actorUserId: string;
    displayName?: string | null;
    city?: string | null;
    email?: string | null;
    phoneSecondary?: string | null;
    notes?: string | null;
    potentialValue?: string | number | null;
  },
): Promise<
  | { ok: true; lead: ManualLeadResultRow }
  | {
      ok: false;
      error:
        | "duplicate"
        | "invalid_status"
        | "invalid_wa"
        | "invalid_assignee"
        | "invalid_source"
        | "offline_requires_name"
        | "invalid_potential_value";
    }
> {
  const source = input.source.trim();
  if (source.length < 1 || source.length > 64) {
    return { ok: false, error: "invalid_source" };
  }

  const status = (input.status?.trim() ?? "new") as string;
  if (!isPipelineLeadStatus(status)) {
    return { ok: false, error: "invalid_status" };
  }

  let assignedUserId: string | null | undefined = input.assignedUserId ?? undefined;
  if (assignedUserId === "") {
    assignedUserId = null;
  }
  if (assignedUserId) {
    const u = await prisma.user.findUnique({
      where: { id: assignedUserId },
      select: { status: true },
    });
    if (!u || u.status !== "active") {
      return { ok: false, error: "invalid_assignee" };
    }
  }

  const trimmedName = input.displayName?.trim() ?? "";
  const city = input.city?.trim() || null;
  const email = input.email?.trim() || null;
  const phoneSecondary = input.phoneSecondary?.trim() || null;
  const notes = input.notes?.trim() || null;
  const potentialValueResult = parseMoneyInput(input.potentialValue);
  if (!potentialValueResult.ok) {
    return { ok: false, error: "invalid_potential_value" };
  }
  const potentialValue = potentialValueResult.value ?? null;

  const waRaw = input.waIdRaw?.trim();
  const useWhatsapp = Boolean(waRaw && waRaw.length > 0);

  if (!useWhatsapp) {
    if (trimmedName.length < 2 || trimmedName.length > 255) {
      return { ok: false, error: "offline_requires_name" };
    }

    const lead = await prisma.$transaction(async (tx) => {
      const l = await tx.lead.create({
        data: {
          contactId: null,
          source,
          status,
          assignedUserId: assignedUserId ?? null,
          displayName: trimmedName,
          city,
          email,
          phoneSecondary,
          potentialValue,
        },
      });
      if (notes) {
        await tx.leadNote.create({
          data: {
            leadId: l.id,
            body: notes,
            createdByUserId: input.actorUserId,
          },
        });
      }
      await tx.leadStatusEvent.create({
        data: {
          leadId: l.id,
          fromStatus: null,
          toStatus: status,
          changedByUserId: input.actorUserId,
        },
      });
      return l;
    });

    return {
      ok: true,
      lead: {
        id: lead.id,
        source: lead.source,
        status: lead.status,
        wa_id: null,
        display_name: lead.displayName ?? null,
        city: lead.city ?? null,
        email: lead.email ?? null,
        phone_secondary: lead.phoneSecondary ?? null,
        potential_value: lead.potentialValue ? Number(lead.potentialValue) : null,
        assigned_user_id: lead.assignedUserId ?? null,
        created_at: lead.createdAt.toISOString(),
      },
    };
  }

  const waId = normalizeWaId(waRaw!);
  if (waId.length < 5 || waId.length > 32) {
    return { ok: false, error: "invalid_wa" };
  }

  const phoneNumberId =
    process.env.MANUAL_LEAD_PHONE_NUMBER_ID?.trim() || "manual";

  const preContact = await prisma.whatsAppContact.findUnique({
    where: { waId },
    include: { lead: { select: { id: true } } },
  });
  if (preContact?.lead) {
    return { ok: false, error: "duplicate" };
  }

  const lead = await prisma.$transaction(async (tx) => {
    const contact = await tx.whatsAppContact.upsert({
      where: { waId },
      create: { waId },
      update: {},
    });

    const existingLead = await tx.lead.findUnique({
      where: { contactId: contact.id },
      select: { id: true },
    });
    if (existingLead) {
      return null;
    }

    await tx.whatsAppConversation.upsert({
      where: {
        contactId_phoneNumberId: {
          contactId: contact.id,
          phoneNumberId,
        },
      },
      create: {
        contactId: contact.id,
        phoneNumberId,
        unanswered: true,
        lastActivityAt: new Date(),
      },
      update: {},
    });

    const created = await tx.lead.create({
      data: {
        contactId: contact.id,
        source,
        status,
        assignedUserId: assignedUserId ?? null,
        displayName: trimmedName || null,
        city,
        email,
        phoneSecondary,
        potentialValue,
      },
      include: { contact: { select: { waId: true } } },
    });

    if (notes) {
      await tx.leadNote.create({
        data: {
          leadId: created.id,
          body: notes,
          createdByUserId: input.actorUserId,
        },
      });
    }

    await tx.leadStatusEvent.create({
      data: {
        leadId: created.id,
        fromStatus: null,
        toStatus: status,
        changedByUserId: input.actorUserId,
      },
    });

    return created;
  });

  if (!lead) {
    return { ok: false, error: "duplicate" };
  }

  return {
    ok: true,
    lead: {
      id: lead.id,
      source: lead.source,
      status: lead.status,
      wa_id: lead.contact?.waId ?? null,
      display_name: lead.displayName ?? null,
      city: lead.city ?? null,
      email: lead.email ?? null,
      phone_secondary: lead.phoneSecondary ?? null,
      potential_value: lead.potentialValue ? Number(lead.potentialValue) : null,
      assigned_user_id: lead.assignedUserId ?? null,
      created_at: lead.createdAt.toISOString(),
    },
  };
}

export async function addLeadNote(
  prisma: PrismaClient,
  leadId: string,
  body: string,
  createdByUserId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "empty" }> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: "empty" };
  }
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true },
  });
  if (!lead) {
    return { ok: false, error: "not_found" };
  }
  await prisma.leadNote.create({
    data: {
      leadId,
      body: trimmed,
      createdByUserId,
    },
  });
  return { ok: true };
}

export async function updateLeadProfile(
  prisma: PrismaClient,
  leadId: string,
  input: {
    displayName?: string | null;
    city?: string | null;
    email?: string | null;
    phoneSecondary?: string | null;
    potentialValue?: string | number | null;
  },
): Promise<
  | { ok: false; error: "not_found" | "invalid_potential_value" }
  | { ok: true }
> {
  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, error: "not_found" };
  }

  const data: Prisma.LeadUpdateInput = {};
  if (input.displayName !== undefined) {
    data.displayName = input.displayName?.trim() || null;
  }
  if (input.city !== undefined) {
    data.city = input.city?.trim() || null;
  }
  if (input.email !== undefined) {
    data.email = input.email?.trim() || null;
  }
  if (input.phoneSecondary !== undefined) {
    data.phoneSecondary = input.phoneSecondary?.trim() || null;
  }
  if (input.potentialValue !== undefined) {
    const parsed = parseMoneyInput(input.potentialValue);
    if (!parsed.ok) {
      return { ok: false, error: "invalid_potential_value" };
    }
    data.potentialValue = parsed.value ?? null;
  }

  await prisma.lead.update({
    where: { id: leadId },
    data,
  });
  return { ok: true };
}

export async function convertQualifiedLeadToClient(
  prisma: PrismaClient,
  leadId: string,
): Promise<
  | { ok: true; client: { id: string; lead_id: string }; created: boolean }
  | { ok: false; error: "not_found" | "not_qualified" }
> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      status: true,
      contactId: true,
      displayName: true,
    },
  });
  if (!lead) {
    return { ok: false, error: "not_found" };
  }
  if (lead.status !== QUALIFIED_FOR_CONVERSION) {
    return { ok: false, error: "not_qualified" };
  }

  const existing = await prisma.client.findUnique({
    where: { leadId: lead.id },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: true,
      client: { id: existing.id, lead_id: lead.id },
      created: false,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    let contactId = lead.contactId;
    if (!contactId) {
      const syntheticWa = `offline-${lead.id.replace(/-/g, "")}`;
      const contact = await tx.whatsAppContact.create({
        data: { waId: syntheticWa },
      });
      await tx.lead.update({
        where: { id: lead.id },
        data: { contactId: contact.id },
      });
      contactId = contact.id;
    }

    const client = await tx.client.create({
      data: {
        leadId: lead.id,
        contactId,
        displayName: lead.displayName ?? undefined,
        generatedValue: lead.potentialValue ?? undefined,
      },
      select: { id: true },
    });

    await tx.demand.updateMany({
      where: { leadId: lead.id },
      data: {
        leadId: null,
        clientId: client.id,
      },
    });

    await tx.task.updateMany({
      where: { leadId: lead.id },
      data: {
        leadId: null,
        clientId: client.id,
      },
    });

    return client;
  });

  return {
    ok: true,
    client: { id: created.id, lead_id: lead.id },
    created: true,
  };
}

/**
 * Elimina o lead e registos em cascade (notas, eventos, cliente e serviços).
 * Demandas/tarefas com FK ao lead ficam com lead_id a null (SetNull).
 */
export async function deleteLeadAndRelations(
  prisma: PrismaClient,
  leadId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      client: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!existing) {
    return { ok: false, error: "not_found" };
  }

  await prisma.$transaction(async (tx) => {
    const relatedDemandIds = (
      await tx.demand.findMany({
        where: {
          OR: [
            { leadId },
            ...(existing.client ? [{ clientId: existing.client.id }] : []),
          ],
        },
        select: { id: true },
      })
    ).map((row) => row.id);

    await tx.task.deleteMany({
      where: {
        OR: [
          { leadId },
          ...(existing.client ? [{ clientId: existing.client.id }] : []),
          ...(relatedDemandIds.length > 0
            ? [{ demandId: { in: relatedDemandIds } }]
            : []),
        ],
      },
    });

    if (relatedDemandIds.length > 0) {
      await tx.demand.deleteMany({
        where: { id: { in: relatedDemandIds } },
      });
    }

    await tx.lead.delete({ where: { id: leadId } });
  });

  return { ok: true };
}

export async function deleteLead(
  prisma: PrismaClient,
  leadId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  return deleteLeadAndRelations(prisma, leadId);
}
