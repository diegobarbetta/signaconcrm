import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";

import { createFollowUpTaskForInboundMessage } from "../tasks/tasks.service.js";
import { rawBodyPlugin } from "./raw-body.plugin.js";
import { parseInboundMessages } from "./message.service.js";

type VerifyWebhookQuery = {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
};

export const whatsappWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rawBodyPlugin);

  fastify.get(
    "/webhook",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            "hub.mode": { type: "string" },
            "hub.verify_token": { type: "string" },
            "hub.challenge": { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as VerifyWebhookQuery;
      const mode = q["hub.mode"];
      const token = q["hub.verify_token"];
      const challenge = q["hub.challenge"];

      if (!mode || !token || !challenge) {
        return reply.code(400).send({ error: "Parâmetros em falta" });
      }

      // Meta WhatsApp Cloud API: handshake usa hub.* (challenge response)
      if (mode !== "subscribe") {
        return reply.code(400).send({ error: "Modo inválido" });
      }

      const expected = process.env.WHATSAPP_VERIFY_TOKEN;
      if (!expected) {
        fastify.log.error(
          { has_verify_token: false },
          "WHATSAPP_VERIFY_TOKEN não configurado",
        );
        return reply.code(500).send({ error: "Configuração inválida" });
      }

      if (token !== expected) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      // A Cloud API espera o challenge em texto puro.
      reply.type("text/plain").send(challenge);
    },
  );

  fastify.post("/webhook", async (request, reply) => {
    const started = Date.now();
    fastify.metrics.inc("whatsapp.webhook.requests_total");

    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      fastify.log.error({ has_app_secret: false }, "WHATSAPP_APP_SECRET não configurado");
      fastify.metrics.inc("whatsapp.webhook.errors_total");
      return reply.code(500).send({ error: "Configuração inválida" });
    }

    const sig = request.headers["x-hub-signature-256"];
    if (typeof sig !== "string" || !sig.startsWith("sha256=")) {
      fastify.log.warn({ reason: "missing_or_invalid_signature" }, "Webhook rejeitado");
      fastify.metrics.inc("whatsapp.webhook.signature_invalid_total");
      fastify.metrics.inc("whatsapp.webhook.errors_total");
      return reply.code(403).send({ error: "Forbidden" });
    }

    const raw = request.rawBody ?? Buffer.from("");
    const expected = crypto
      .createHmac("sha256", appSecret)
      .update(raw)
      .digest("hex");

    const provided = sig.slice("sha256=".length);
    const ok =
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!ok) {
      fastify.log.warn({ reason: "signature_mismatch" }, "Webhook rejeitado");
      fastify.metrics.inc("whatsapp.webhook.signature_mismatch_total");
      fastify.metrics.inc("whatsapp.webhook.errors_total");
      return reply.code(403).send({ error: "Forbidden" });
    }

    // Logging sanitizado: não logar payload bruto; apenas metadados mínimos.
    const contentType = request.headers["content-type"];
    fastify.log.info(
      {
        event: "whatsapp.webhook.received",
        content_type: typeof contentType === "string" ? contentType : undefined,
        body_bytes: raw.length,
      },
      "Webhook recebido",
    );

    // Story 2.3: persistir mensagens com idempotência por provider_message_id.
    const messages = parseInboundMessages(request.body);
    let created = 0;
    let deduped = 0;

    try {
      for (const m of messages) {
        try {
          await fastify.prisma.$transaction(async (tx) => {
            const contact = await tx.whatsAppContact.upsert({
              where: { waId: m.waId },
              create: { waId: m.waId },
              update: {},
            });

            const conversation = await tx.whatsAppConversation.upsert({
              where: {
                contactId_phoneNumberId: {
                  contactId: contact.id,
                  phoneNumberId: m.phoneNumberId,
                },
              },
              create: {
                contactId: contact.id,
                phoneNumberId: m.phoneNumberId,
                unanswered: true,
                lastProviderTimestamp: m.providerTimestamp,
                lastMessagePreview: m.preview,
                lastActivityAt: m.providerTimestamp ?? new Date(),
              },
              update: {},
            });

            // Epic 3 / Story 3.1: criar lead automaticamente (idempotente por contact_id).
            const leadRow = await tx.lead.upsert({
              where: { contactId: contact.id },
              create: {
                contactId: contact.id,
                source: "whatsapp",
                status: "new",
              },
              update: {},
            });

            const msgRow = await tx.whatsAppMessage.create({
              data: {
                providerMessageId: m.providerMessageId,
                waId: m.waId,
                phoneNumberId: m.phoneNumberId,
                contactId: contact.id,
                conversationId: conversation.id,
                messageType: m.messageType,
                textBody: m.textBody,
                providerTimestamp: m.providerTimestamp,
              },
            });

            // Epic 6.4: task de follow-up idempotente por source_message_id (= mensagem criada).
            await createFollowUpTaskForInboundMessage(tx, {
              messageId: msgRow.id,
              conversationId: conversation.id,
              leadId: leadRow.id,
            });

            await tx.whatsAppConversation.update({
              where: { id: conversation.id },
              data: {
                unanswered: true,
                lastProviderTimestamp:
                  m.providerTimestamp ?? conversation.lastProviderTimestamp,
                lastMessagePreview: m.preview ?? conversation.lastMessagePreview,
                lastActivityAt: m.providerTimestamp ?? new Date(),
              },
            });
          });
          created += 1;
        } catch (err: unknown) {
          if (
            typeof err === "object" &&
            err &&
            "code" in err &&
            (err as { code?: string }).code === "P2002"
          ) {
            deduped += 1;
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      fastify.metrics.inc("whatsapp.webhook.persist_errors_total");
      fastify.metrics.inc("whatsapp.webhook.errors_total");
      fastify.metrics.observeMs("whatsapp.webhook.duration_ms", Date.now() - started);
      throw err;
    }

    fastify.log.info(
      { event: "whatsapp.messages.persisted", created, deduped, total: messages.length },
      "Mensagens processadas",
    );

    fastify.metrics.inc("whatsapp.webhook.ok_total");
    fastify.metrics.observeMs("whatsapp.webhook.duration_ms", Date.now() - started);
    return reply.code(200).send({ ok: true, created, deduped });
  });
};

