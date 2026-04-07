import type { FastifyPluginAsync } from "fastify";

import { writeAuditLog } from "../audit/audit.service.js";
import { requirePermission } from "../auth/require-permission.js";
import {
  createDemand,
  deleteDemand,
  type DemandStatus,
  type DemandRow,
  type PatchDemandInput,
  isValidDemandStatus,
  listDemands,
  parseDueAt,
  patchDemand,
} from "./demands.service.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const uuidParam = {
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern:
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    },
  },
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOverdueFlag(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") {
    return true;
  }
  if (v === "false" || v === "0" || v === "no") {
    return false;
  }
  return null;
}

function mapDemandRow(row: DemandRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    due_at: row.dueAt.toISOString(),
    status: row.status,
    assigned_user_id: row.assignedUserId,
    lead_id: row.leadId,
    client_id: row.clientId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export const demandsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      preHandler: requirePermission("demands.read"),
      schema: {
        querystring: {
          type: "object",
          properties: {
            status: { type: "string" },
            overdue: { type: "string" },
            assigned_user_id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
            lead_id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
            client_id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as {
        status?: string;
        overdue?: string;
        assigned_user_id?: string;
        lead_id?: string;
        client_id?: string;
        limit?: string;
        offset?: string;
      };

      let limit = Number.parseInt(q.limit ?? String(DEFAULT_LIMIT), 10);
      let offset = Number.parseInt(q.offset ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      let statusFilter: DemandStatus | undefined;
      if (q.status !== undefined && q.status.trim() !== "") {
        const s = q.status.trim();
        if (!isValidDemandStatus(s)) {
          return reply.code(400).send({ error: "status inválido no filtro" });
        }
        statusFilter = s;
      }

      const overdueRaw = parseOverdueFlag(q.overdue);
      if (overdueRaw === null && q.overdue !== undefined && q.overdue !== "") {
        return reply.code(400).send({ error: "overdue inválido (use true/false)" });
      }
      const overdueOnly = overdueRaw === true;

      const { total, rows } = await listDemands(fastify.prisma, {
        status: statusFilter,
        overdueOnly,
        assignedUserId: q.assigned_user_id ?? undefined,
        leadId: q.lead_id ?? undefined,
        clientId: q.client_id ?? undefined,
        limit,
        offset,
      });

      return reply.send({
        items: rows.map(mapDemandRow),
        total,
        limit,
        offset,
      });
    },
  );

  fastify.post(
    "/",
    {
      preHandler: requirePermission("demands.create"),
      schema: {
        body: {
          type: "object",
          required: ["title", "due_at", "status"],
          properties: {
            title: { type: "string", minLength: 1 },
            description: { type: "string" },
            due_at: { type: "string", minLength: 1 },
            status: { type: "string", minLength: 1 },
            assigned_user_id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
            lead_id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
            client_id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        title: string;
        description?: string;
        due_at: string;
        status: string;
        assigned_user_id?: string;
        lead_id?: string;
        client_id?: string;
      };

      const title = body.title?.trim() ?? "";
      if (!title) {
        return reply.code(400).send({ error: "Título é obrigatório" });
      }

      const dueAt = parseDueAt(body.due_at);
      if (!dueAt) {
        return reply
          .code(400)
          .send({ error: "due_at inválido ou ausente (use ISO 8601)" });
      }

      if (!isValidDemandStatus(body.status)) {
        return reply.code(400).send({
          error: `status inválido; permitidos: open, in_progress, done`,
        });
      }

      if (body.assigned_user_id) {
        const assignee = await fastify.prisma.user.findUnique({
          where: { id: body.assigned_user_id },
          select: { id: true, status: true },
        });
        if (!assignee || assignee.status !== "active") {
          return reply.code(400).send({ error: "Responsável inválido" });
        }
      }

      if (body.lead_id && body.client_id) {
        return reply
          .code(400)
          .send({ error: "Defina apenas lead_id ou client_id, não ambos" });
      }

      if (body.lead_id) {
        const lead = await fastify.prisma.lead.findUnique({
          where: { id: body.lead_id },
          select: { id: true },
        });
        if (!lead) {
          return reply.code(404).send({ error: "Lead não encontrado" });
        }
      }

      if (body.client_id) {
        const client = await fastify.prisma.client.findUnique({
          where: { id: body.client_id },
          select: { id: true },
        });
        if (!client) {
          return reply.code(404).send({ error: "Cliente não encontrado" });
        }
      }

      let row: DemandRow;
      try {
        row = await createDemand(fastify.prisma, {
          title,
          description: body.description,
          dueAt,
          status: body.status,
          assignedUserId: body.assigned_user_id ?? null,
          leadId: body.lead_id ?? null,
          clientId: body.client_id ?? null,
        });
      } catch (e) {
        if (e instanceof Error && e.message === "lead_and_client_exclusive") {
          return reply
            .code(400)
            .send({ error: "Defina apenas lead_id ou client_id, não ambos" });
        }
        throw e;
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "demand.create",
        entityType: "demand",
        entityId: row.id,
        metadata: {
          demand_id: row.id,
          status: row.status,
          due_at: row.dueAt.toISOString(),
        },
      });

      return reply.code(201).send(mapDemandRow(row));
    },
  );

  fastify.patch(
    "/:id",
    {
      preHandler: requirePermission("demands.update"),
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            status: { type: "string" },
            due_at: { type: "string" },
            assigned_user_id: { type: ["string", "null"] },
            lead_id: { type: ["string", "null"] },
            client_id: { type: ["string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as {
        status?: string;
        due_at?: string;
        assigned_user_id?: string | null;
        lead_id?: string | null;
        client_id?: string | null;
      };

      const rawLead =
        "lead_id" in body ? body.lead_id : undefined;
      const rawClient =
        "client_id" in body ? body.client_id : undefined;
      const wantsLead =
        rawLead !== undefined && rawLead !== null && String(rawLead).length > 0;
      const wantsClient =
        rawClient !== undefined &&
        rawClient !== null &&
        String(rawClient).length > 0;
      if (wantsLead && wantsClient) {
        return reply
          .code(400)
          .send({ error: "Defina apenas lead_id ou client_id, não ambos" });
      }

      const patch: PatchDemandInput = {};

      if ("status" in body && body.status !== undefined) {
        if (!isValidDemandStatus(body.status)) {
          return reply.code(400).send({
            error: "status inválido; permitidos: open, in_progress, done",
          });
        }
        patch.status = body.status;
      }

      if ("due_at" in body && body.due_at !== undefined) {
        const dueAt = parseDueAt(body.due_at);
        if (!dueAt) {
          return reply.code(400).send({ error: "due_at inválido (use ISO 8601)" });
        }
        patch.dueAt = dueAt;
      }

      if ("assigned_user_id" in body) {
        if (body.assigned_user_id === null) {
          patch.assignedUserId = null;
        } else if (typeof body.assigned_user_id === "string") {
          if (!UUID_RE.test(body.assigned_user_id)) {
            return reply.code(400).send({ error: "assigned_user_id inválido" });
          }
          const assignee = await fastify.prisma.user.findUnique({
            where: { id: body.assigned_user_id },
            select: { id: true, status: true },
          });
          if (!assignee || assignee.status !== "active") {
            return reply.code(400).send({ error: "Responsável inválido" });
          }
          patch.assignedUserId = body.assigned_user_id;
        }
      }

      if ("lead_id" in body) {
        if (body.lead_id === null) {
          patch.leadId = null;
        } else if (typeof body.lead_id === "string") {
          if (!UUID_RE.test(body.lead_id)) {
            return reply.code(400).send({ error: "lead_id inválido" });
          }
          const lead = await fastify.prisma.lead.findUnique({
            where: { id: body.lead_id },
            select: { id: true },
          });
          if (!lead) {
            return reply.code(404).send({ error: "Lead não encontrado" });
          }
          patch.leadId = body.lead_id;
        }
      }

      if ("client_id" in body) {
        if (body.client_id === null) {
          patch.clientId = null;
        } else if (typeof body.client_id === "string") {
          if (!UUID_RE.test(body.client_id)) {
            return reply.code(400).send({ error: "client_id inválido" });
          }
          const client = await fastify.prisma.client.findUnique({
            where: { id: body.client_id },
            select: { id: true },
          });
          if (!client) {
            return reply.code(404).send({ error: "Cliente não encontrado" });
          }
          patch.clientId = body.client_id;
        }
      }

      try {
        const updated = await patchDemand(fastify.prisma, params.id, patch);
        await writeAuditLog(fastify.prisma, {
          userId: request.authUser!.id,
          action: "demand.update",
          entityType: "demand",
          entityId: updated.id,
          metadata: {
            demand_id: updated.id,
            fields: Object.keys(patch),
          },
        });
        return reply.send(mapDemandRow(updated));
      } catch {
        return reply.code(404).send({ error: "Demanda não encontrada" });
      }
    },
  );

  fastify.delete(
    "/:id",
    {
      preHandler: requirePermission("demands.update"),
      schema: { params: uuidParam },
    },
    async (request, reply) => {
      const params = request.params as { id: string };

      const result = await deleteDemand(fastify.prisma, params.id);
      if (!result.ok) {
        return reply.code(404).send({ error: "Demanda nÃ£o encontrada" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "demand.delete",
        entityType: "demand",
        entityId: params.id,
        metadata: { demand_id: params.id },
      });

      return reply.code(204).send();
    },
  );
};
