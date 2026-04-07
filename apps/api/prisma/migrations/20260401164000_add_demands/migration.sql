-- CreateTable
CREATE TABLE "demands" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "assigned_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "demands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demands_status_due_at_idx" ON "demands"("status", "due_at");

-- CreateIndex
CREATE INDEX "demands_assigned_user_id_due_at_idx" ON "demands"("assigned_user_id", "due_at");

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
