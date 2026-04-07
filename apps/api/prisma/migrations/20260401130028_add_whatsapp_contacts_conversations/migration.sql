/*
  Warnings:

  - Added the required column `contact_id` to the `whatsapp_messages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `conversation_id` to the `whatsapp_messages` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "contact_id" UUID NOT NULL,
ADD COLUMN     "conversation_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "id" UUID NOT NULL,
    "wa_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "unanswered" BOOLEAN NOT NULL DEFAULT true,
    "assigned_user_id" UUID,
    "last_provider_timestamp" TIMESTAMPTZ(6),
    "last_message_preview" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_wa_id_key" ON "whatsapp_contacts"("wa_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_phone_number_id_updated_at_idx" ON "whatsapp_conversations"("phone_number_id", "updated_at");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_unanswered_updated_at_idx" ON "whatsapp_conversations"("unanswered", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_conversations_contact_id_phone_number_id_key" ON "whatsapp_conversations"("contact_id", "phone_number_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversation_id_received_at_idx" ON "whatsapp_messages"("conversation_id", "received_at");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
