import type { FastifyPluginAsync } from "fastify";

import { getCurrentStatusDays } from "../../lib/lead-time.js";
import { moneyToNumber } from "../../lib/money.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  requireAuth,
  requirePermission,
  requirePermissionUnlessAdminRole,
} from "../auth/require-permission.js";
import {
  addLeadNote,
  buildLeadListWhere,
  convertQualifiedLeadToClient,
  createManualLead,
  deleteLead,
  isAllowedLeadFilterStatus,
  updateLeadProfile,
  updateLeadStatus,
} from "./leads.service.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export const leadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      preHandler: requireAuth,
      schema: {
        querystring: {
          type: "object",
          properties: {
            status: { type: "string" },
            q: { type: "string" },
            assigned_user_id: {
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
        q?: string;
        assigned_user_id?: string;
        limit?: string;
        offset?: string;
      };

      let limit = Number.parseInt(q.limit ?? String(DEFAULT_LIMIT), 10);
      let offset = Number.parseInt(q.offset ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      let statusFilter: string | undefined;
      if (q.status !== undefined && q.status.trim() !== "") {
        const s = q.status.trim();
        if (!isAllowedLeadFilterStatus(s)) {
          return reply.code(400).send({ error: "status inválido no filtro" });
        }
        statusFilter = s;
      }

      const where = buildLeadListWhere({
        dataScope: request.authUser!.dataScope,
        currentUserId: request.authUser!.id,
        status: statusFilter,
        assignedUserId: q.assigned_user_id,
        searchWa: q.q,
      });

      const [total, rows] = await Promise.all([
        fastify.prisma.lead.count({ where }),
        fastify.prisma.lead.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
          select: {
            id: true,
            source: true,
            status: true,
            assignedUserId: true,
            createdAt: true,
            updatedAt: true,
            displayName: true,
            city: true,
            email: true,
            phoneSecondary: true,
            potentialValue: true,
            contact: { select: { waId: true } },
            statusEvents: {
              orderBy: { createdAt: "asc" },
              select: { toStatus: true, createdAt: true },
            },
          },
        }),
      ]);

      return reply.send({
        items: rows.map((r) => ({
          id: r.id,
          source: r.source,
          status: r.status,
          assigned_user_id: r.assignedUserId ?? null,
          wa_id: r.contact?.waId ?? null,
          display_name: r.displayName ?? null,
          city: r.city ?? null,
          email: r.email ?? null,
          phone_secondary: r.phoneSecondary ?? null,
          potential_value: moneyToNumber(r.potentialValue),
          current_status_days: getCurrentStatusDays(r.createdAt, r.statusEvents),
          created_at: r.createdAt.toISOString(),
          updated_at: r.updatedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    },
  );

  fastify.post(
    "/",
    {
      preHandler: requirePermission("leads.create_manual"),
      schema: {
        body: {
          type: "object",
          required: ["source"],
          properties: {
            wa_id: { type: "string" },
            source: { type: "string", minLength: 1, maxLength: 64 },
            display_name: { type: "string" },
            city: { type: "string" },
            email: { type: "string" },
            phone_secondary: { type: "string" },
            notes: { type: "string" },
            potential_value: { type: ["number", "string", "null"] },
            status: { type: "string" },
            assigned_user_id: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        wa_id?: string;
        source: string;
        display_name?: string;
        city?: string;
        email?: string;
        phone_secondary?: string;
        notes?: string;
        potential_value?: string | number | null;
        status?: string;
        assigned_user_id?: string;
      };

      const result = await createManualLead(fastify.prisma, {
        waIdRaw: body.wa_id,
        source: body.source,
        status: body.status,
        assignedUserId: body.assigned_user_id ?? null,
        actorUserId: request.authUser!.id,
        displayName: body.display_name,
        city: body.city,
        email: body.email,
        phoneSecondary: body.phone_secondary,
        notes: body.notes,
        potentialValue: body.potential_value,
      });

      if (!result.ok) {
        if (result.error === "duplicate") {
          return reply.code(409).send({ error: "Já existe lead para este contacto" });
        }
        if (result.error === "invalid_wa") {
          return reply.code(400).send({ error: "wa_id inválido (5–32 caracteres)" });
        }
        if (result.error === "invalid_source") {
          return reply.code(400).send({ error: "Fonte inválida" });
        }
        if (result.error === "invalid_status") {
          return reply.code(400).send({ error: "Status inválido" });
        }
        if (result.error === "offline_requires_name") {
          return reply
            .code(400)
            .send({ error: "Sem WhatsApp: indique display_name (nome) com pelo menos 2 caracteres" });
        }
        if (result.error === "invalid_potential_value") {
          return reply.code(400).send({ error: "potential_value invalido" });
        }
        return reply.code(400).send({ error: "Utilizador atribuído inválido" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "lead.create_manual",
        entityType: "lead",
        entityId: result.lead.id,
        metadata: {
          wa_id: result.lead.wa_id,
          source: result.lead.source,
          offline: result.lead.wa_id === null,
        },
      });

      return reply.code(201).send(result.lead);
    },
  );

  fastify.get(
    "/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };

      const lead = await fastify.prisma.lead.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          source: true,
          status: true,
          assignedUserId: true,
          createdAt: true,
          updatedAt: true,
          displayName: true,
          city: true,
          email: true,
          phoneSecondary: true,
          potentialValue: true,
          client: { select: { id: true } },
          noteEntries: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              body: true,
              createdAt: true,
              createdBy: { select: { id: true, name: true } },
            },
          },
          contact: {
            select: {
              waId: true,
              conversations: {
                orderBy: [{ lastActivityAt: "desc" }],
                select: {
                  id: true,
                  phoneNumberId: true,
                  unanswered: true,
                  assignedUserId: true,
                  lastProviderTimestamp: true,
                  lastMessagePreview: true,
                  lastActivityAt: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
          statusEvents: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              fromStatus: true,
              toStatus: true,
              changedByUserId: true,
              createdAt: true,
            },
          },
        },
      });

      if (!lead) {
        return reply.code(404).send({ error: "Lead não encontrado" });
      }

      return reply.send({
        id: lead.id,
        source: lead.source,
        status: lead.status,
        assigned_user_id: lead.assignedUserId ?? null,
        display_name: lead.displayName ?? null,
        city: lead.city ?? null,
        email: lead.email ?? null,
        phone_secondary: lead.phoneSecondary ?? null,
        potential_value: moneyToNumber(lead.potentialValue),
        current_status_days: getCurrentStatusDays(lead.createdAt, lead.statusEvents),
        client_id: lead.client?.id ?? null,
        note_entries: lead.noteEntries.map((n) => ({
          id: n.id,
          body: n.body,
          created_at: n.createdAt.toISOString(),
          created_by: n.createdBy
            ? { id: n.createdBy.id, name: n.createdBy.name }
            : null,
        })),
        created_at: lead.createdAt.toISOString(),
        updated_at: lead.updatedAt.toISOString(),
        wa_id: lead.contact?.waId ?? null,
        conversations: (lead.contact?.conversations ?? []).map((c) => ({
          id: c.id,
          phone_number_id: c.phoneNumberId,
          unanswered: c.unanswered,
          assigned_user_id: c.assignedUserId ?? null,
          last_provider_timestamp: c.lastProviderTimestamp?.toISOString() ?? null,
          last_message_preview: c.lastMessagePreview ?? null,
          last_activity_at: c.lastActivityAt.toISOString(),
          created_at: c.createdAt.toISOString(),
          updated_at: c.updatedAt.toISOString(),
        })),
        status_events: lead.statusEvents.map((e) => ({
          id: e.id,
          from_status: e.fromStatus,
          to_status: e.toStatus,
          changed_by_user_id: e.changedByUserId,
          created_at: e.createdAt.toISOString(),
        })),
      });
    },
  );

  fastify.patch(
    "/:id/status",
    {
      preHandler: requirePermission("leads.update_status"),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { status: string };

      const result = await updateLeadStatus(
        fastify.prisma,
        params.id,
        body.status,
        request.authUser!.id,
      );

      if (!result.ok) {
        if (result.error === "not_found") {
          return reply.code(404).send({ error: "Lead não encontrado" });
        }
        if (result.error === "invalid_status") {
          return reply.code(400).send({ error: "Status inválido" });
        }
        return reply.code(400).send({ error: "Status inalterado" });
      }

      return reply.send(result.lead);
    },
  );

  fastify.patch(
    "/:id/profile",
    {
      preHandler: requirePermission("leads.update_profile"),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          properties: {
            display_name: { type: "string" },
            city: { type: "string" },
            email: { type: "string" },
            phone_secondary: { type: "string" },
            potential_value: { type: ["number", "string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as {
        display_name?: string;
        city?: string;
        email?: string;
        phone_secondary?: string;
        potential_value?: string | number | null;
      };

      const result = await updateLeadProfile(fastify.prisma, params.id, {
        displayName: body.display_name,
        city: body.city,
        email: body.email,
        phoneSecondary: body.phone_secondary,
        potentialValue: body.potential_value,
      });

      if (!result.ok) {
        if (result.error === "invalid_potential_value") {
          return reply.code(400).send({ error: "potential_value invalido" });
        }
        return reply.code(404).send({ error: "Lead não encontrado" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "lead.update_profile",
        entityType: "lead",
        entityId: params.id,
        metadata: {
          lead_id: params.id,
          fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
        },
      });

      return reply.send({ ok: true });
    },
  );

  fastify.post(
    "/:id/notes",
    {
      preHandler: requirePermission("leads.update_profile"),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["body"],
          properties: { body: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { body: string };

      const result = await addLeadNote(
        fastify.prisma,
        params.id,
        body.body,
        request.authUser!.id,
      );
      if (!result.ok) {
        if (result.error === "not_found") {
          return reply.code(404).send({ error: "Lead não encontrado" });
        }
        return reply.code(400).send({ error: "Texto da nota em falta" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "lead.note.create",
        entityType: "lead",
        entityId: params.id,
        metadata: { lead_id: params.id },
      });

      return reply.code(201).send({ ok: true });
    },
  );

  fastify.patch(
    "/:id/assignee",
    {
      preHandler: requirePermission("leads.assign"),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["assigned_user_id"],
          properties: { assigned_user_id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { assigned_user_id: string };

      const assignee = await fastify.prisma.user.findUnique({
        where: { id: body.assigned_user_id },
        select: { id: true, status: true },
      });
      if (!assignee || assignee.status !== "active") {
        return reply.code(400).send({ error: "Utilizador inválido" });
      }

      const updated = await fastify.prisma.lead.updateMany({
        where: { id: params.id },
        data: { assignedUserId: body.assigned_user_id },
      });
      if (updated.count === 0) {
        return reply.code(404).send({ error: "Lead não encontrado" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "lead.assign",
        entityType: "lead",
        entityId: params.id,
        metadata: {
          lead_id: params.id,
          assigned_user_id: body.assigned_user_id,
        },
      });

      return reply.send({ ok: true, assigned_user_id: body.assigned_user_id });
    },
  );

  fastify.post(
    "/:id/convert",
    {
      preHandler: requirePermission("leads.convert"),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };

      const result = await convertQualifiedLeadToClient(fastify.prisma, params.id);
      if (!result.ok) {
        if (result.error === "not_found") {
          return reply.code(404).send({ error: "Lead não encontrado" });
        }
        return reply
          .code(400)
          .send({ error: "Apenas leads em estado qualificado podem ser convertidos" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "lead.convert_to_client",
        entityType: "lead",
        entityId: params.id,
        metadata: {
          lead_id: params.id,
          client_id: result.client.id,
          created: result.created,
        },
      });

      return reply.send({
        ok: true,
        client_id: result.client.id,
        lead_id: result.client.lead_id,
        created: result.created,
      });
    },
  );

  fastify.delete(
    "/:id",
    {
      preHandler: requirePermissionUnlessAdminRole("leads.delete"),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };

      const result = await deleteLead(fastify.prisma, params.id);
      if (!result.ok) {
        return reply.code(404).send({ error: "Lead não encontrado" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "lead.delete",
        entityType: "lead",
        entityId: params.id,
        metadata: { lead_id: params.id },
      });

      return reply.code(204).send();
    },
  );
};
