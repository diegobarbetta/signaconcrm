import { PassThrough } from "node:stream";

import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export const rawBodyPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook("preParsing", async (request, _reply, payload) => {
    // Só capturar quando houver corpo (webhooks POST).
    if (!payload) return payload;

    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    request.rawBody = Buffer.concat(chunks);

    // Recria o stream para o parser JSON padrão do Fastify.
    const stream = new PassThrough();
    stream.end(request.rawBody);
    return stream;
  });
});

