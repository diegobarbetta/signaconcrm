import type { Prisma, PrismaClient } from "@prisma/client";

import {
  ARCHIVED_CLIENT_STATUS,
  deleteLeadAndRelations,
} from "../leads/leads.service.js";

export const SERVICE_STATUSES = ["active", "paused", "ended"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export function isAllowedServiceStatus(s: string): s is ServiceStatus {
  return (SERVICE_STATUSES as readonly string[]).includes(s);
}

export function shouldCountServiceTowardsRealValue(status: string): boolean {
  return status === "active" || status === "paused";
}

export async function createClientForWaId(
  prisma: PrismaClient,
  input: {
    waId: string;
    displayName?: string | null;
    notes?: string | null;
    generatedValue?: Prisma.Decimal | null;
  },
): Promise<
  | { ok: true; client: { id: string; lead_id: string } }
  | { ok: false; error: "already_exists" }
> {
  const waId = input.waId.trim();
  if (!waId) {
    throw new Error("wa_id obrigatório");
  }

  return prisma.$transaction(async (tx) => {
    const contact = await tx.whatsAppContact.upsert({
      where: { waId },
      create: { waId },
      update: {},
    });

    const leadWithClient = await tx.lead.findUnique({
      where: { contactId: contact.id },
      include: { client: true },
    });

    if (leadWithClient?.client) {
      return { ok: false as const, error: "already_exists" as const };
    }

    let leadId: string;
    if (leadWithClient) {
      leadId = leadWithClient.id;
    } else {
      const lead = await tx.lead.create({
        data: {
          contactId: contact.id,
          source: "manual",
          status: "new",
        },
      });
      leadId = lead.id;
    }

    const client = await tx.client.create({
      data: {
        leadId,
        contactId: contact.id,
        displayName: input.displayName ?? undefined,
        notes: input.notes ?? undefined,
        generatedValue: input.generatedValue ?? undefined,
      },
      select: { id: true, leadId: true },
    });

    return { ok: true as const, client: { id: client.id, lead_id: client.leadId } };
  });
}

const ARCHIVE_REASON_MIN_LEN = 10;

/**
 * Remove o registo de cliente, reatribui demandas ao lead, grava nota e define estado archived_client.
 */
export async function archiveClientRevertToLead(
  prisma: PrismaClient,
  input: {
    clientId: string;
    reason: string;
    actorUserId: string;
  },
): Promise<
  | { ok: true; lead_id: string; status: string }
  | { ok: false; error: "not_found" | "reason_too_short" }
> {
  const reason = input.reason.trim();
  if (reason.length < ARCHIVE_REASON_MIN_LEN) {
    return { ok: false, error: "reason_too_short" };
  }

  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, leadId: true },
  });
  if (!client) {
    return { ok: false, error: "not_found" };
  }

  const leadId = client.leadId;
  const noteBody = `Arquivamento de cliente: ${reason}`;

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { status: true },
    });
    if (!lead) {
      throw new Error("lead_missing");
    }

    await tx.leadNote.create({
      data: {
        leadId,
        body: noteBody,
        createdByUserId: input.actorUserId,
      },
    });

    await tx.leadStatusEvent.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: ARCHIVED_CLIENT_STATUS,
        changedByUserId: input.actorUserId,
      },
    });

    await tx.demand.updateMany({
      where: { clientId: client.id },
      data: { clientId: null, leadId },
    });

    await tx.client.delete({ where: { id: client.id } });

    await tx.lead.update({
      where: { id: leadId },
      data: { status: ARCHIVED_CLIENT_STATUS },
    });
  });

  return {
    ok: true,
    lead_id: leadId,
    status: ARCHIVED_CLIENT_STATUS,
  };
}

export async function deleteClientAndRelations(
  prisma: PrismaClient,
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { leadId: true },
  });
  if (!client) {
    return { ok: false, error: "not_found" };
  }

  return deleteLeadAndRelations(prisma, client.leadId);
}
