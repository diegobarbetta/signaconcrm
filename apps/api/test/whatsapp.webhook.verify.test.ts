import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

describe("WhatsApp Cloud API webhook verification (Story 2.1)", () => {
  it("200 e retorna hub.challenge quando verify_token confere", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    const app = await buildApp({ logger: false });

    const res = await app.inject({
      method: "GET",
      url: "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token-test&hub.challenge=12345",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("12345");

    await app.close();
  });

  it("403 quando verify_token não confere", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    const app = await buildApp({ logger: false });

    const res = await app.inject({
      method: "GET",
      url: "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "Forbidden" });

    await app.close();
  });

  it("400 quando faltam parâmetros", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    const app = await buildApp({ logger: false });

    const res = await app.inject({
      method: "GET",
      url: "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token-test",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Parâmetros em falta" });

    await app.close();
  });

  it("400 quando hub.mode é inválido", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    const app = await buildApp({ logger: false });

    const res = await app.inject({
      method: "GET",
      url: "/whatsapp/webhook?hub.mode=ping&hub.verify_token=verify-token-test&hub.challenge=12345",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Modo inválido" });

    await app.close();
  });
});

