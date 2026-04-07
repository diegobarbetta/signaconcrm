-- Notas de lead com histórico datado + data de renovação em serviços do cliente.

CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_notes_lead_id_created_at_idx" ON "lead_notes"("lead_id", "created_at");

ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "lead_notes" ("id", "lead_id", "body", "created_at")
SELECT gen_random_uuid(), "id", trim(both from "notes"), "created_at"
FROM "leads"
WHERE "notes" IS NOT NULL AND length(trim(both from "notes")) > 0;

UPDATE "leads" SET "notes" = NULL WHERE "notes" IS NOT NULL;

ALTER TABLE "client_services" ADD COLUMN "renews_at" TIMESTAMPTZ(6);

CREATE INDEX "client_services_renews_at_idx" ON "client_services"("renews_at");
