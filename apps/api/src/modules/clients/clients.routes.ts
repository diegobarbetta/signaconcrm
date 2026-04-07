import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

import { moneyToNumber, parseMoneyInput } from "../../lib/money.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { requirePermission } from "../auth/require-permission.js";
import {
  archiveClientRevertToLead,
  createClientForWaId,
  deleteClientAndRelations,
  isAllowedServiceStatus,
  shouldCountServiceTowardsRealValue,
} from "./clients.service.js";

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

function computeServicesRealValue(
  services: Array<{ status: string; amount: Prisma.Decimal | null }>,
): number {
  return services.reduce((sum, service) => {
    if (!shouldCountServiceTowardsRealValue(service.status)) {
      return sum;
    }
    return sum + (moneyToNumber(service.amount) ?? 0);
  }, 0);
}

export const clientsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      preHandler: requirePermission("clients.read"),
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as { q?: string; limit?: string; offset?: string };

      let limit = Number.parseInt(q.limit ?? String(DEFAULT_LIMIT), 10);
      let offset = Number.parseInt(q.offset ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const search = q.q?.trim();
      const where =
        search && search.length > 0
          ? {
              contact: {
                waId: { contains: search, mode: "insensitive" as const },
              },
            }
          : {};

      const [total, rows] = await Promise.all([
        fastify.prisma.client.count({ where }),
        fastify.prisma.client.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
          select: {
            id: true,
            createdAt: true,
            leadId: true,
            displayName: true,
            generatedValue: true,
            services: {
              select: {
                status: true,
                amount: true,
              },
            },
            contact: { select: { waId: true } },
          },
        }),
      ]);

      return reply.send({
        items: rows.map((r) => ({
          id: r.id,
          lead_id: r.leadId,
          wa_id: r.contact.waId,
          display_name: r.displayName ?? null,
          reference_value: moneyToNumber(r.generatedValue),
          real_value: computeServicesRealValue(r.services),
          created_at: r.createdAt.toISOString(),
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
      preHandler: requirePermission("clients.manage"),
      schema: {
        body: {
          type: "object",
          required: ["wa_id"],
          properties: {
            wa_id: { type: "string", minLength: 1 },
            display_name: { type: "string" },
            notes: { type: "string" },
            reference_value: { type: ["number", "string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        wa_id: string;
        display_name?: string;
        notes?: string;
        reference_value?: string | number | null;
      };

      const generatedValue = parseMoneyInput(body.reference_value);
      if (!generatedValue.ok) {
        return reply.code(400).send({ error: "reference_value invalido" });
      }

      const result = await createClientForWaId(fastify.prisma, {
        waId: body.wa_id,
        displayName: body.display_name,
        notes: body.notes,
        generatedValue: generatedValue.value ?? undefined,
      });

      if (!result.ok) {
        return reply
          .code(409)
          .send({ error: "Já existe cliente para este contacto WhatsApp" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "client.create",
        entityType: "client",
        entityId: result.client.id,
        metadata: { client_id: result.client.id, lead_id: result.client.lead_id },
      });

      return reply.code(201).send({
        id: result.client.id,
        lead_id: result.client.lead_id,
      });
    },
  );

  fastify.get(
    "/:id",
    {
      preHandler: requirePermission("clients.read"),
      schema: { params: uuidParam },
    },
    async (request, reply) => {
      const params = request.params as { id: string };

      const row = await fastify.prisma.client.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          leadId: true,
          displayName: true,
          notes: true,
          generatedValue: true,
          createdAt: true,
          contact: { select: { waId: true } },
          services: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              status: true,
              amount: true,
              renewsAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!row) {
        return reply.code(404).send({ error: "Cliente não encontrado" });
      }

      return reply.send({
        id: row.id,
        lead_id: row.leadId,
        wa_id: row.contact.waId,
        display_name: row.displayName ?? null,
        notes: row.notes ?? null,
        reference_value: moneyToNumber(row.generatedValue),
        real_value: computeServicesRealValue(row.services),
        created_at: row.createdAt.toISOString(),
        services: row.services.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          amount: moneyToNumber(s.amount) ?? 0,
          renews_at: s.renewsAt?.toISOString() ?? null,
          created_at: s.createdAt.toISOString(),
          updated_at: s.updatedAt.toISOString(),
        })),
      });
    },
  );

  fastify.post(
    "/:id/archive",
    {
      preHandler: requirePermission("clients.manage"),
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          required: ["reason"],
          properties: {
            reason: { type: "string", minLength: 10 },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { reason: string };

      const result = await archiveClientRevertToLead(fastify.prisma, {
        clientId: params.id,
        reason: body.reason,
        actorUserId: request.authUser!.id,
      });

      if (!result.ok) {
        if (result.error === "not_found") {
          return reply.code(404).send({ error: "Cliente não encontrado" });
        }
        return reply
          .code(400)
          .send({ error: `Justificativa em falta (mínimo ${10} caracteres)` });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "client.archive",
        entityType: "client",
        entityId: params.id,
        metadata: { client_id: params.id, lead_id: result.lead_id },
      });

      return reply.send({
        lead_id: result.lead_id,
        status: result.status,
      });
    },
  );

  fastify.patch(
    "/:id",
    {
      preHandler: requirePermission("clients.manage"),
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            display_name: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
            reference_value: { type: ["number", "string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as {
        display_name?: string | null;
        notes?: string | null;
        reference_value?: string | number | null;
      };

      const data: Prisma.ClientUpdateInput = {};
      if ("display_name" in body) data.displayName = body.display_name;
      if ("notes" in body) data.notes = body.notes;
      if ("reference_value" in body) {
        const generatedValue = parseMoneyInput(body.reference_value);
        if (!generatedValue.ok) {
          return reply.code(400).send({ error: "reference_value invalido" });
        }
        data.generatedValue = generatedValue.value ?? null;
      }

      try {
        const updated = await fastify.prisma.client.update({
          where: { id: params.id },
          data,
          select: {
            id: true,
            leadId: true,
            displayName: true,
            notes: true,
            generatedValue: true,
            services: {
              select: {
                status: true,
                amount: true,
              },
            },
          },
        });

        await writeAuditLog(fastify.prisma, {
          userId: request.authUser!.id,
          action: "client.update",
          entityType: "client",
          entityId: updated.id,
          metadata: { client_id: updated.id },
        });

        return reply.send({
          id: updated.id,
          lead_id: updated.leadId,
          display_name: updated.displayName ?? null,
          notes: updated.notes ?? null,
          reference_value: moneyToNumber(updated.generatedValue),
          real_value: computeServicesRealValue(updated.services),
        });
      } catch {
        return reply.code(404).send({ error: "Cliente não encontrado" });
      }
    },
  );

  fastify.post(
    "/:id/services",
    {
      preHandler: requirePermission("clients.manage"),
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          required: ["name", "status", "amount"],
          properties: {
            name: { type: "string", minLength: 1 },
            status: { type: "string", minLength: 1 },
            amount: { type: ["number", "string"] },
            renews_at: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as {
        name: string;
        status: string;
        amount?: string | number;
        renews_at?: string;
      };

      if (!isAllowedServiceStatus(body.status)) {
        return reply.code(400).send({ error: "Status de serviço inválido" });
      }
      const amountResult = parseMoneyInput(body.amount ?? 0);
      if (!amountResult.ok || amountResult.value === undefined || amountResult.value === null) {
        return reply.code(400).send({ error: "amount invalido" });
      }

      let renewsAt: Date | null = null;
      if (body.renews_at !== undefined && body.renews_at !== null && String(body.renews_at).trim() !== "") {
        const d = new Date(String(body.renews_at));
        if (Number.isNaN(d.getTime())) {
          return reply.code(400).send({ error: "renews_at inválido (ISO 8601)" });
        }
        renewsAt = d;
      }

      const client = await fastify.prisma.client.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!client) {
        return reply.code(404).send({ error: "Cliente não encontrado" });
      }

      const svc = await fastify.prisma.clientService.create({
        data: {
          clientId: params.id,
          name: body.name.trim(),
          status: body.status,
          amount: amountResult.value,
          renewsAt,
        },
        select: {
          id: true,
          name: true,
          status: true,
          amount: true,
          renewsAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "client.service.create",
        entityType: "client_service",
        entityId: svc.id,
        metadata: { client_id: params.id, service_id: svc.id },
      });

      return reply.code(201).send({
        id: svc.id,
        name: svc.name,
        status: svc.status,
        amount: moneyToNumber(svc.amount) ?? 0,
        renews_at: svc.renewsAt?.toISOString() ?? null,
        created_at: svc.createdAt.toISOString(),
        updated_at: svc.updatedAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/:id/services/:serviceId",
    {
      preHandler: requirePermission("clients.manage"),
      schema: {
        params: {
          type: "object",
          required: ["id", "serviceId"],
          properties: {
            id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
            serviceId: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
          },
        },
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1 },
            status: { type: "string", minLength: 1 },
            amount: { type: ["number", "string", "null"] },
            renews_at: { type: ["string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string; serviceId: string };
      const body = request.body as {
        name?: string;
        status?: string;
        amount?: string | number | null;
        renews_at?: string | null;
      };

      if (body.status !== undefined && !isAllowedServiceStatus(body.status)) {
        return reply.code(400).send({ error: "Status de serviço inválido" });
      }

      const existing = await fastify.prisma.clientService.findFirst({
        where: { id: params.serviceId, clientId: params.id },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Serviço não encontrado" });
      }

      let renewsPatch: Date | null | undefined;
      let amountPatch: Prisma.Decimal | null | undefined;
      if ("renews_at" in body) {
        if (body.renews_at === null || body.renews_at === "") {
          renewsPatch = null;
        } else if (typeof body.renews_at === "string") {
          const d = new Date(body.renews_at);
          if (Number.isNaN(d.getTime())) {
            return reply.code(400).send({ error: "renews_at inválido (ISO 8601)" });
          }
          renewsPatch = d;
        }
      }
      if ("amount" in body) {
        const amountResult = parseMoneyInput(body.amount);
        if (!amountResult.ok || amountResult.value === undefined || amountResult.value === null) {
          return reply.code(400).send({ error: "amount invalido" });
        }
        amountPatch = amountResult.value;
      }

      const svc = await fastify.prisma.clientService.update({
        where: { id: params.serviceId },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(amountPatch !== undefined ? { amount: amountPatch } : {}),
          ...(renewsPatch !== undefined ? { renewsAt: renewsPatch } : {}),
        },
        select: {
          id: true,
          name: true,
          status: true,
          amount: true,
          renewsAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "client.service.update",
        entityType: "client_service",
        entityId: svc.id,
        metadata: { client_id: params.id, service_id: svc.id },
      });

      return reply.send({
        id: svc.id,
        name: svc.name,
        status: svc.status,
        amount: moneyToNumber(svc.amount) ?? 0,
        renews_at: svc.renewsAt?.toISOString() ?? null,
        created_at: svc.createdAt.toISOString(),
        updated_at: svc.updatedAt.toISOString(),
      });
    },
  );

  fastify.delete(
    "/:id",
    {
      preHandler: requirePermission("clients.manage"),
      schema: { params: uuidParam },
    },
    async (request, reply) => {
      const params = request.params as { id: string };

      const result = await deleteClientAndRelations(fastify.prisma, params.id);
      if (!result.ok) {
        return reply.code(404).send({ error: "Cliente nÃ£o encontrado" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "client.delete",
        entityType: "client",
        entityId: params.id,
        metadata: { client_id: params.id },
      });

      return reply.code(204).send();
    },
  );
};
