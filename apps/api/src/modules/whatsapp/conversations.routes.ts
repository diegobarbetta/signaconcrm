import type { FastifyPluginAsync } from "fastify";

import { requireAuth } from "../auth/require-permission.js";
import { requirePermission } from "../auth/require-permission.js";
import { writeAuditLog } from "../audit/audit.service.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export const whatsappConversationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/conversations/:id",
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
      const conv = await fastify.prisma.whatsAppConversation.findUnique({
        where: { id: params.id },
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
          contact: { select: { waId: true } },
        },
      });

      if (!conv) {
        return reply.code(404).send({ error: "Conversa não encontrada" });
      }

      return reply.send({
        id: conv.id,
        wa_id: conv.contact.waId,
        phone_number_id: conv.phoneNumberId,
        unanswered: conv.unanswered,
        assigned_user_id: conv.assignedUserId ?? null,
        last_provider_timestamp: conv.lastProviderTimestamp?.toISOString() ?? null,
        last_message_preview: conv.lastMessagePreview ?? null,
        last_activity_at: conv.lastActivityAt.toISOString(),
        created_at: conv.createdAt.toISOString(),
        updated_at: conv.updatedAt.toISOString(),
      });
    },
  );

  fastify.get(
    "/conversations",
    {
      preHandler: requireAuth,
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
            offset: { type: "string" },
            unanswered: { type: "string" }, // "1" para filtrar unanswered=true
            mine: { type: "string" }, // "1" para filtrar assigned_user_id = eu
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as {
        limit?: string;
        offset?: string;
        unanswered?: string;
        mine?: string;
      };

      let limit = Number.parseInt(q.limit ?? String(DEFAULT_LIMIT), 10);
      let offset = Number.parseInt(q.offset ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const where: {
        unanswered?: boolean;
        assignedUserId?: string;
      } = {};

      if (q.unanswered === "1") where.unanswered = true;
      if (q.mine === "1") where.assignedUserId = request.authUser!.id;

      const rows = await fastify.prisma.whatsAppConversation.findMany({
        where,
        orderBy: [{ lastActivityAt: "desc" }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          phoneNumberId: true,
          unanswered: true,
          assignedUserId: true,
          lastProviderTimestamp: true,
          lastMessagePreview: true,
          lastActivityAt: true,
          contact: { select: { waId: true } },
        },
      });

      return reply.send(
        rows.map((r) => ({
          id: r.id,
          wa_id: r.contact.waId,
          phone_number_id: r.phoneNumberId,
          unanswered: r.unanswered,
          assigned_user_id: r.assignedUserId ?? null,
          last_provider_timestamp: r.lastProviderTimestamp?.toISOString() ?? null,
          last_message_preview: r.lastMessagePreview ?? null,
          last_activity_at: r.lastActivityAt.toISOString(),
        })),
      );
    },
  );

  fastify.get(
    "/conversations/:id/messages",
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
            offset: { type: "string" },
            order: { type: "string", enum: ["asc", "desc"] },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const q = request.query as { limit?: string; offset?: string; order?: "asc" | "desc" };

      let limit = Number.parseInt(q.limit ?? String(DEFAULT_LIMIT), 10);
      let offset = Number.parseInt(q.offset ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const order = q.order ?? "desc"; // Story 2.9: primeira página traz mais recentes por padrão.
      const dir = order === "asc" ? "asc" : "desc";

      const rows = await fastify.prisma.whatsAppMessage.findMany({
        where: { conversationId: params.id },
        orderBy: [{ providerTimestamp: dir }, { receivedAt: dir }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          providerMessageId: true,
          messageType: true,
          textBody: true,
          providerTimestamp: true,
          receivedAt: true,
          waId: true,
          phoneNumberId: true,
        },
      });

      // Ordenação consistente: providerTimestamp quando existir; fallback para receivedAt.
      // Nota: o orderBy acima empurra nulls para o fim (Postgres). Este sort final garante fallback local
      // em cenários onde a base não aplica a ordenação como esperado.
      rows.sort((a, b) => {
        const aKey = (a.providerTimestamp ?? a.receivedAt).getTime();
        const bKey = (b.providerTimestamp ?? b.receivedAt).getTime();
        if (aKey !== bKey) return order === "asc" ? aKey - bKey : bKey - aKey;
        return order === "asc"
          ? a.receivedAt.getTime() - b.receivedAt.getTime()
          : b.receivedAt.getTime() - a.receivedAt.getTime();
      });

      return reply.send(rows);
    },
  );

  fastify.post(
    "/conversations/:id/responded",
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

      const updated = await fastify.prisma.whatsAppConversation.updateMany({
        where: { id: params.id },
        data: { unanswered: false, lastActivityAt: new Date() },
      });

      if (updated.count === 0) {
        return reply.code(404).send({ error: "Conversa não encontrada" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "whatsapp.conversation.mark_responded",
        entityType: "whatsapp_conversation",
        entityId: params.id,
        metadata: { conversation_id: params.id },
      });

      return reply.send({ ok: true });
    },
  );

  /** Permite voltar a marcar como «sem resposta» (Kanban) ou fixar estado explicitamente. */
  fastify.patch(
    "/conversations/:id/unanswered",
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["unanswered"],
          properties: { unanswered: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { unanswered: boolean };

      const updated = await fastify.prisma.whatsAppConversation.updateMany({
        where: { id: params.id },
        data: { unanswered: body.unanswered, lastActivityAt: new Date() },
      });

      if (updated.count === 0) {
        return reply.code(404).send({ error: "Conversa não encontrada" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: body.unanswered
          ? "whatsapp.conversation.mark_unanswered"
          : "whatsapp.conversation.mark_responded",
        entityType: "whatsapp_conversation",
        entityId: params.id,
        metadata: { conversation_id: params.id, unanswered: body.unanswered },
      });

      return reply.send({ ok: true });
    },
  );

  fastify.patch(
    "/conversations/:id/assignee",
    {
      preHandler: requirePermission("whatsapp.conversations.assign"),
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["assigned_user_id"],
          properties: {
            assigned_user_id: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { assigned_user_id: string };

      const updated = await fastify.prisma.whatsAppConversation.updateMany({
        where: { id: params.id },
        data: { assignedUserId: body.assigned_user_id, lastActivityAt: new Date() },
      });

      if (updated.count === 0) {
        return reply.code(404).send({ error: "Conversa não encontrada" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "whatsapp.conversation.assign",
        entityType: "whatsapp_conversation",
        entityId: params.id,
        metadata: {
          conversation_id: params.id,
          assigned_user_id: body.assigned_user_id,
        },
      });

      return reply.send({ ok: true });
    },
  );
};

