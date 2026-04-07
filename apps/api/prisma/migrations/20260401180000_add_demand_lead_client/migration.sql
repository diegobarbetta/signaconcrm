-- AlterTable
ALTER TABLE "demands" ADD COLUMN "lead_id" UUID,
ADD COLUMN "client_id" UUID;

-- CreateIndex
CREATE INDEX "demands_lead_id_due_at_idx" ON "demands"("lead_id", "due_at");

-- CreateIndex
CREATE INDEX "demands_client_id_due_at_idx" ON "demands"("client_id", "due_at");

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma demanda não pode estar ligada a lead e cliente em simultâneo
ALTER TABLE "demands" ADD CONSTRAINT "demands_lead_xor_client_chk" CHECK ("lead_id" IS NULL OR "client_id" IS NULL);
