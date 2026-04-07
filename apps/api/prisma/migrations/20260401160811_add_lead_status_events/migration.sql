-- CreateTable
CREATE TABLE "lead_status_events" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_status_events_lead_id_created_at_idx" ON "lead_status_events"("lead_id", "created_at");

-- AddForeignKey
ALTER TABLE "lead_status_events" ADD CONSTRAINT "lead_status_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_events" ADD CONSTRAINT "lead_status_events_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
