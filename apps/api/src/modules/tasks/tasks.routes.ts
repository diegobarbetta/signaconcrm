import type { FastifyPluginAsync } from "fastify";

import { writeAuditLog } from "../audit/audit.service.js";
import { requirePermission } from "../auth/require-permission.js";
import {
  createManualTask,
  deleteTask,
  isValidTaskStatus,
  type TaskBucket,
  type TaskRowWithDemand,
  listTasks,
  parseDueAtOptional,
  setTaskStatus,
  type TaskStatus,
} from "./tasks.service.js";

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

function mapTaskRow(row: TaskRowWithDemand) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    due_at: row.dueAt?.toISOString() ?? null,
    completed_at: row.completedAt?.toISOString() ?? null,
    assigned_user_id: row.assignedUserId,
    conversation_id: row.conversationId,
    lead_id: row.leadId,
    client_id: row.clientId,
    demand_id: row.demandId,
    demand_lead_id: row.demand?.leadId ?? null,
    demand_client_id: row.demand?.clientId ?? null,
    lead_client_id: row.lead?.client?.id ?? null,
    source: row.source,
    source_message_id: row.sourceMessageId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function parseIncludeDone(raw: string | undefined): boolean {
  if (!raw || raw === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function parseMine(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === "") return null;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return null;
}

function isTaskBucket(value: string): value is TaskBucket {
  return value === "overdue" || value === "today" || value === "upcoming";
}

export const tasksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      preHandler: requirePermission("tasks.read"),
      schema: {
        querystring: {
          type: "object",
          properties: {
            bucket: { type: "string" },
            mine: { type: "string" },
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
            include_done: { type: "string" },
            status: { type: "string" },
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as {
        bucket?: string;
        mine?: string;
        assigned_user_id?: string;
        lead_id?: string;
        client_id?: string;
        include_done?: string;
        status?: string;
        limit?: string;
        offset?: string;
      };

      let limit = Number.parseInt(q.limit ?? String(DEFAULT_LIMIT), 10);
      let offset = Number.parseInt(q.offset ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      let bucket: TaskBucket | undefined;
      if (q.bucket !== undefined && q.bucket.trim() !== "") {
        const b = q.bucket.trim();
        if (!isTaskBucket(b)) {
          return reply.code(400).send({
            error: "bucket invÃ¡lido (overdue | today | upcoming)",
          });
        }
        bucket = b;
      }

      const mineRaw = parseMine(q.mine);
      if (mineRaw === null && q.mine !== undefined && q.mine !== "") {
        return reply.code(400).send({ error: "mine invÃ¡lido (use true/false)" });
      }

      let assignedUserId: string | undefined;
      let mineUserId: string | undefined;
      if (mineRaw === true) {
        mineUserId = request.authUser!.id;
      } else if (q.assigned_user_id) {
        assignedUserId = q.assigned_user_id;
      }

      const includeDone = parseIncludeDone(q.include_done);

      let taskStatus: TaskStatus | undefined;
      if (q.status !== undefined && q.status.trim() !== "") {
        const s = q.status.trim();
        if (!isValidTaskStatus(s)) {
          return reply.code(400).send({ error: "status invÃ¡lido (open | done)" });
        }
        taskStatus = s;
      }

      const { total, rows } = await listTasks(fastify.prisma, {
        bucket,
        taskStatus: bucket ? undefined : taskStatus,
        mineUserId,
        assignedUserId,
        leadId: q.lead_id,
        clientId: q.client_id,
        includeDone,
        limit,
        offset,
      });

      return reply.send({
        items: rows.map(mapTaskRow),
        total,
        limit,
        offset,
      });
    },
  );

  fastify.post(
    "/",
    {
      preHandler: requirePermission("tasks.create"),
      schema: {
        body: {
          type: "object",
          required: ["title", "status"],
          properties: {
            title: { type: "string", minLength: 1 },
            status: { type: "string" },
            due_at: {},
            assigned_user_id: {
              type: "string",
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
            conversation_id: {
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
            demand_id: {
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
        status: string;
        due_at?: unknown;
        assigned_user_id?: string;
        conversation_id?: string;
        lead_id?: string;
        client_id?: string;
        demand_id?: string;
      };

      if (!isValidTaskStatus(body.status) || body.status !== "open") {
        return reply
          .code(400)
          .send({ error: "Na criaÃ§Ã£o, status deve ser open" });
      }

      const dueParsed = parseDueAtOptional(body.due_at);
      if (body.due_at !== undefined && dueParsed === null && body.due_at !== null) {
        return reply.code(400).send({ error: "due_at invÃ¡lido" });
      }

      if (body.lead_id && body.client_id) {
        return reply
          .code(400)
          .send({ error: "Defina apenas lead_id ou client_id, nÃ£o ambos" });
      }

      if (body.assigned_user_id) {
        const u = await fastify.prisma.user.findUnique({
          where: { id: body.assigned_user_id },
          select: { id: true, status: true },
        });
        if (!u || u.status !== "active") {
          return reply.code(400).send({ error: "ResponsÃ¡vel invÃ¡lido" });
        }
      }

      if (body.conversation_id) {
        const c = await fastify.prisma.whatsAppConversation.findUnique({
          where: { id: body.conversation_id },
          select: { id: true },
        });
        if (!c) {
          return reply.code(400).send({ error: "Conversa nÃ£o encontrada" });
        }
      }

      if (body.lead_id) {
        const l = await fastify.prisma.lead.findUnique({
          where: { id: body.lead_id },
          select: { id: true },
        });
        if (!l) {
          return reply.code(400).send({ error: "Lead nÃ£o encontrado" });
        }
      }

      if (body.client_id) {
        const c = await fastify.prisma.client.findUnique({
          where: { id: body.client_id },
          select: { id: true },
        });
        if (!c) {
          return reply.code(400).send({ error: "Cliente nÃ£o encontrado" });
        }
      }

      if (body.demand_id) {
        const d = await fastify.prisma.demand.findUnique({
          where: { id: body.demand_id },
          select: { id: true },
        });
        if (!d) {
          return reply.code(400).send({ error: "Demanda nÃ£o encontrada" });
        }
      }

      const row = await createManualTask(fastify.prisma, {
        title: body.title,
        status: "open",
        dueAt: dueParsed ?? null,
        assignedUserId: body.assigned_user_id ?? null,
        conversationId: body.conversation_id ?? null,
        leadId: body.lead_id ?? null,
        clientId: body.client_id ?? null,
        demandId: body.demand_id ?? null,
      });

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "task.create",
        entityType: "task",
        entityId: row.id,
        metadata: { task_id: row.id, source: "manual" },
      });

      return reply.code(201).send(mapTaskRow(row));
    },
  );

  fastify.patch(
    "/:id",
    {
      preHandler: requirePermission("tasks.update"),
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            status: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { status?: string };

      if (!body.status || !isValidTaskStatus(body.status)) {
        return reply.code(400).send({ error: "status invÃ¡lido (open | done)" });
      }

      const markConversationAnswered =
        process.env.TASK_DONE_SETS_CONVERSATION_ANSWERED === "true";

      const existing = await fastify.prisma.task.findUnique({
        where: { id: params.id },
        select: { id: true, conversationId: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Task nÃ£o encontrada" });
      }

      const updated = await setTaskStatus(fastify.prisma, params.id, body.status);

      if (
        markConversationAnswered &&
        body.status === "done" &&
        existing.conversationId
      ) {
        await fastify.prisma.whatsAppConversation.update({
          where: { id: existing.conversationId },
          data: { unanswered: false },
        });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "task.update",
        entityType: "task",
        entityId: updated.id,
        metadata: {
          task_id: updated.id,
          status: updated.status,
          completed_at: updated.completedAt?.toISOString() ?? null,
        },
      });

      return reply.send(mapTaskRow(updated));
    },
  );

  fastify.delete(
    "/:id",
    {
      preHandler: requirePermission("tasks.update"),
      schema: { params: uuidParam },
    },
    async (request, reply) => {
      const params = request.params as { id: string };

      const result = await deleteTask(fastify.prisma, params.id);
      if (!result.ok) {
        return reply.code(404).send({ error: "Task nÃ£o encontrada" });
      }

      await writeAuditLog(fastify.prisma, {
        userId: request.authUser!.id,
        action: "task.delete",
        entityType: "task",
        entityId: params.id,
        metadata: { task_id: params.id },
      });

      return reply.code(204).send();
    },
  );
};
