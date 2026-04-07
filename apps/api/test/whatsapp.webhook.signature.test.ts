import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

function sign(body: Buffer, secret: string) {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

describe("WhatsApp Cloud API webhook signature (Story 2.2)", () => {
  it("403 quando não há assinatura", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret-test";
    const app = await buildApp({ logger: false });

    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: { "content-type": "application/json" },
      payload: { object: "whatsapp_business_account" },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "Forbidden" });
    await app.close();
  });

  it("403 quando assinatura não confere", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret-test";
    const app = await buildApp({ logger: false });

    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      payload: { object: "whatsapp_business_account" },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "Forbidden" });
    await app.close();
  });

  it("200 quando assinatura confere (ACK rápido)", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret-test";
    const app = await buildApp({ logger: false });

    const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, "app-secret-test"),
      },
      payload: raw,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true });
    await app.close();
  });
});

