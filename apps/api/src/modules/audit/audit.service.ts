import type { Prisma, PrismaClient } from "@prisma/client";

/** Chaves/propriedades que nunca devem ir para metadata (LGPD / segredos). */
const BLOCKED_KEY_SUBSTR = ["email", "password", "token", "secret", "hash"];

function sanitizeMetadata(
  meta: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }

  const out: Record<string, Prisma.InputJsonValue> = {};

  for (const [k, v] of Object.entries(meta)) {
    const kl = k.toLowerCase();
    if (BLOCKED_KEY_SUBSTR.some((b) => kl.includes(b))) {
      continue;
    }
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null
    ) {
      out[k] = v as Prisma.InputJsonValue;
      continue;
    }
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out[k] = v as Prisma.InputJsonValue;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export async function writeAuditLog(
  prisma: PrismaClient,
  entry: {
    userId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const meta = sanitizeMetadata(entry.metadata);
  await prisma.auditLog.create({
    data: {
      userId: entry.userId ?? undefined,
      action: entry.action,
      entityType: entry.entityType ?? undefined,
      entityId: entry.entityId ?? undefined,
      metadata: meta === undefined ? undefined : meta,
    },
  });
}

export type PublicAuditEntry = {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: unknown;
  created_at: string;
};

export async function listAuditLogs(
  prisma: PrismaClient,
  options: { limit: number; offset: number },
): Promise<PublicAuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: options.limit,
    skip: options.offset,
  });

  return rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    action: r.action,
    entity_type: r.entityType,
    entity_id: r.entityId,
    metadata: r.metadata ?? null,
    created_at: r.createdAt.toISOString(),
  }));
}
