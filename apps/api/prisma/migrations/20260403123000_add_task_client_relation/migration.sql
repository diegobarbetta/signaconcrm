ALTER TABLE "tasks" ADD COLUMN "client_id" UUID;

CREATE INDEX "tasks_client_id_created_at_idx" ON "tasks"("client_id", "created_at");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
