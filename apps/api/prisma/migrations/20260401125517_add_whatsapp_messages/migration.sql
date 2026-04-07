-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "wa_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "text_body" TEXT,
    "provider_timestamp" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_provider_message_id_key" ON "whatsapp_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_wa_id_received_at_idx" ON "whatsapp_messages"("wa_id", "received_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_phone_number_id_received_at_idx" ON "whatsapp_messages"("phone_number_id", "received_at");
