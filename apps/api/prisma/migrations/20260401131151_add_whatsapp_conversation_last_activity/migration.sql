-- DropIndex
DROP INDEX "whatsapp_conversations_phone_number_id_updated_at_idx";

-- DropIndex
DROP INDEX "whatsapp_conversations_unanswered_updated_at_idx";

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "whatsapp_conversations_phone_number_id_last_activity_at_idx" ON "whatsapp_conversations"("phone_number_id", "last_activity_at");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_unanswered_last_activity_at_idx" ON "whatsapp_conversations"("unanswered", "last_activity_at");
