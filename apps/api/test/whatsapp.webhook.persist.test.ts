import crypto from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

function sign(body: Buffer, secret: string) {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

const prisma = new PrismaClient();

describe("WhatsApp webhook persistence + dedupe (Story 2.3)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const secret = "app-secret-test";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL em falta.");
    process.env.WHATSAPP_APP_SECRET = secret;
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    const msgs = await prisma.whatsAppMessage.findMany({
      where: { providerMessageId: { in: ["wamid.test-1"] } },
      select: { id: true },
    });
    if (msgs.length > 0) {
      await prisma.task.deleteMany({
        where: { sourceMessageId: { in: msgs.map((m) => m.id) } },
      });
    }
    await prisma.lead.deleteMany({
      where: { contact: { waId: "5511999999999" } },
    });
    await prisma.whatsAppMessage.deleteMany({
      where: { providerMessageId: { in: ["wamid.test-1"] } },
    });
    await prisma.whatsAppConversation.deleteMany({
      where: { phoneNumberId: "123", contact: { waId: "5511999999999" } },
    });
    await prisma.whatsAppContact.deleteMany({
      where: { waId: "5511999999999" },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("persiste uma mensagem e não duplica em reentrega", async () => {
    const payloadObj = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123" },
                contacts: [{ wa_id: "5511999999999" }],
                messages: [
                  {
                    id: "wamid.test-1",
                    timestamp: "1711929600",
                    type: "text",
                    text: { body: "Olá" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const raw = Buffer.from(JSON.stringify(payloadObj));

    const first = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, secret),
      },
      payload: raw,
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toMatchObject({ ok: true, created: 1, deduped: 0 });

    const second = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, secret),
      },
      payload: raw,
    });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body)).toMatchObject({ ok: true, created: 0, deduped: 1 });

    const rows = await prisma.whatsAppMessage.findMany({
      where: { providerMessageId: "wamid.test-1" },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].textBody).toBe("Olá");
    expect(rows[0].waId).toBe("5511999999999");
    expect(rows[0].phoneNumberId).toBe("123");

    const contact = await prisma.whatsAppContact.findUnique({
      where: { waId: "5511999999999" },
    });
    expect(contact).toBeTruthy();

    const lead = await prisma.lead.findUnique({
      where: { contactId: contact!.id },
    });
    expect(lead).toBeTruthy();
    expect(lead!.source).toBe("whatsapp");
    expect(lead!.status).toBe("new");

    const convs = await prisma.whatsAppConversation.findMany({
      where: { contactId: contact!.id, phoneNumberId: "123" },
    });
    expect(convs.length).toBe(1);

    const msgRow = await prisma.whatsAppMessage.findFirst({
      where: { providerMessageId: "wamid.test-1" },
    });
    expect(msgRow).toBeTruthy();
    const followUp = await prisma.task.findFirst({
      where: { sourceMessageId: msgRow!.id },
    });
    expect(followUp).toBeTruthy();
    expect(followUp!.source).toBe("inbound_message");
    expect(followUp!.status).toBe("open");
  });
});

