ALTER TABLE "leads"
ADD COLUMN "potential_value" DECIMAL(14, 2);

ALTER TABLE "clients"
ADD COLUMN "generated_value" DECIMAL(14, 2);
