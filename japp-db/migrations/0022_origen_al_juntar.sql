-- 0022 · Origen al juntar mesas o pasar una cuenta a una mesa ocupada (27/10/2026, 1.2.203).
-- account.origin: la cuenta llegó de otra mesa como cuenta nueva: {"table":"1","by":"Sistemas","at":"2026-10-27T22:30:00.000Z"}.
-- order_line.origin: la línea se unió a la cuenta principal de la mesa de destino: {"table":"1"}. Vacío = es de esta mesa.
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "origin" JSONB;
ALTER TABLE "order_line" ADD COLUMN IF NOT EXISTS "origin" JSONB;
DO $$ BEGIN ALTER TABLE "account" ADD CONSTRAINT "ck_account_origin" CHECK ("origin" IS NULL OR jsonb_typeof("origin") = 'object'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "order_line" ADD CONSTRAINT "ck_order_line_origin" CHECK ("origin" IS NULL OR jsonb_typeof("origin") = 'object'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN "account"."origin" IS 'Mesa de la que vino la cuenta al juntar o transferir a una mesa ocupada: table, by (quién), at';
COMMENT ON COLUMN "order_line"."origin" IS 'Mesa de la que vino la línea al unirse a la cuenta principal de otra mesa: table';
