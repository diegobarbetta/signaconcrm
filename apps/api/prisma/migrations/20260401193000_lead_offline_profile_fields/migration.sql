-- Lead sem WhatsApp: contact_id opcional + campos de perfil e notas.

ALTER TABLE "leads" ADD COLUMN "display_name" VARCHAR(255),
ADD COLUMN "city" VARCHAR(128),
ADD COLUMN "email" VARCHAR(255),
ADD COLUMN "phone_secondary" VARCHAR(64),
ADD COLUMN "notes" TEXT;

ALTER TABLE "leads" DROP CONSTRAINT "leads_contact_id_fkey";

ALTER TABLE "leads" ALTER COLUMN "contact_id" DROP NOT NULL;

ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "leads_email_idx" ON "leads"("email");
