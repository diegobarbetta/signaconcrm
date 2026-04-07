import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();

function sign(body: Buffer, secret: string) {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

describe("WhatsApp webhook metrics (Story 2.10)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let userId: string;
  let contactWa: string;
  const email = "wa-metrics@test.local";
  const password = "SecretPass123!";
  const secret = "app-secret-test";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    process.env.WHATSAPP_APP_SECRET = secret;

    app = await buildApp({ logger: false });

    const perm = await prisma.permission.upsert({
      where: { code: "whatsapp.metrics.read" },
      create: { id: randomUUID(), code: "whatsapp.metrics.read" },
      update: {},
    });
    const role = await prisma.role.upsert({
      where: { name: "vitest_wa_metrics_role" },
      create: { id: randomUUID(), name: "vitest_wa_metrics_role", dataScope: "own" },
      update: { dataScope: "own" },
    });
    await prisma.rolePermission.createMany({
      data: [{ roleId: role.id, permissionId: perm.id }],
      skipDuplicates: true,
    });

    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "WA Metrics",
        email,
        passwordHash: await argon2.hash(password),
        roleId: role.id,
        status: "active",
      },
    });
    userId = user.id;

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    token = (JSON.parse(login.body) as { access_token: string }).access_token;

    contactWa = `5511${Math.floor(Math.random() * 1e8)}`; // apenas para limpeza
  });

  afterAll(async () => {
    await prisma.whatsAppMessage.deleteMany({ where: { waId: contactWa } });
    await prisma.whatsAppConversation.deleteMany({ where: { contact: { waId: contactWa } } });
    await prisma.whatsAppContact.deleteMany({ where: { waId: contactWa } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it("incrementa counters e publica summary em /whatsapp/metrics", async () => {
    // chamada inválida (sem assinatura) → 403 + counters de erro
    const bad = await app.inject({ method: "POST", url: "/whatsapp/webhook", payload: {} });
    expect(bad.statusCode).toBe(403);

    // chamada OK → 200 + counters ok_total
    const payloadObj = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123" },
                contacts: [{ wa_id: contactWa }],
                messages: [{ id: "wamid.metrics-1", timestamp: "1711929600", type: "text", text: { body: "Olá" } }],
              },
            },
          ],
        },
      ],
    };
    const raw = Buffer.from(JSON.stringify(payloadObj));
    const ok = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, secret),
      },
      payload: raw,
    });
    expect(ok.statusCode).toBe(200);

    const metrics = await app.inject({
      method: "GET",
      url: "/whatsapp/metrics",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(metrics.statusCode).toBe(200);
    const body = JSON.parse(metrics.body) as {
      counters: Record<string, number>;
      timings: Record<string, { count: number }>;
    };
    expect(body.counters["whatsapp.webhook.requests_total"]).toBeGreaterThanOrEqual(2);
    expect(body.counters["whatsapp.webhook.ok_total"]).toBeGreaterThanOrEqual(1);
    expect(body.counters["whatsapp.webhook.errors_total"]).toBeGreaterThanOrEqual(1);
    expect(body.timings["whatsapp.webhook.duration_ms"].count).toBeGreaterThanOrEqual(1);
  });
});

