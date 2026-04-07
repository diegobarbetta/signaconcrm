type CloudWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string }>;
        messages?: Array<{
          id?: string;
          timestamp?: string; // seconds since epoch as string
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
};

export type ParsedInboundMessage = {
  providerMessageId: string;
  waId: string;
  phoneNumberId: string;
  messageType: string;
  textBody?: string;
  providerTimestamp?: Date;
  preview?: string;
};

export function parseInboundMessages(payload: unknown): ParsedInboundMessage[] {
  const p = payload as CloudWebhookPayload;
  const out: ParsedInboundMessage[] = [];

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      const waId = value.contacts?.[0]?.wa_id;
      const messages = value.messages ?? [];

      if (!phoneNumberId || !waId) continue;

      for (const m of messages) {
        const id = m.id;
        const type = m.type ?? "unknown";
        if (!id) continue;

        const tsSec = m.timestamp ? Number(m.timestamp) : NaN;
        const providerTimestamp =
          Number.isFinite(tsSec) && tsSec > 0 ? new Date(tsSec * 1000) : undefined;

        out.push({
          providerMessageId: id,
          waId,
          phoneNumberId,
          messageType: type,
          textBody: m.text?.body,
          providerTimestamp,
          preview: m.text?.body ? m.text.body.slice(0, 120) : undefined,
        });
      }
    }
  }

  return out;
}

