-- 0037 · 1.2.274 (16/11/2026): arqueo pedido por auditoría (reuniones con el Area Manager y con auditoría).
-- 1) Apertura con la base contada, corte X contado en pantalla y arqueos de auditoría: cada conteo es un cash_movement
--    «count» con su tipo, lo esperado en ese momento, las propinas y la diferencia (así se puede reimprimir y auditar).
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "count_type" VARCHAR(12);
ALTER TABLE "cash_movement" DROP CONSTRAINT IF EXISTS "ck_cash_movement_count_type";
ALTER TABLE "cash_movement" ADD CONSTRAINT "ck_cash_movement_count_type"
  CHECK ("count_type" IS NULL OR "count_type" IN ('arqueo', 'apertura', 'cortex', 'auditoria'));
UPDATE "cash_movement" SET "count_type" = 'arqueo' WHERE "kind" = 'count' AND "count_type" IS NULL;
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "expected_cash" NUMERIC(10,2);
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "expected_card" NUMERIC(10,2);
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "cash_tips" NUMERIC(10,2);
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "card_tips" NUMERIC(10,2);
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "tips_confirmed" BOOLEAN;
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "difference" NUMERIC(10,2);
COMMENT ON COLUMN "cash_movement"."count_type" IS 'Conteo: arqueo, apertura (base de la mañana), cortex (corte X contado) o auditoria';
COMMENT ON COLUMN "cash_movement"."expected_card" IS 'Tarjeta esperada en los datáfonos (ventas + propinas con tarjeta) al contar';

-- 2) Caja chica: fondo fijo del gerente, aparte del cajón (no entra en el arqueo). Se gasta con motivo y se repone.
ALTER TABLE "store_parameters" ADD COLUMN IF NOT EXISTS "petty_cash_limit" NUMERIC(10,2) NOT NULL DEFAULT 50;
ALTER TABLE "store_parameters" DROP CONSTRAINT IF EXISTS "ck_store_parameters_petty_cash_limit";
ALTER TABLE "store_parameters" ADD CONSTRAINT "ck_store_parameters_petty_cash_limit"
  CHECK ("petty_cash_limit" > 0 AND "petty_cash_limit" <= 10000);
COMMENT ON COLUMN "store_parameters"."petty_cash_limit" IS 'Caja chica: fondo fijo (50 € por defecto); ningún gasto lo pasa';
CREATE TABLE IF NOT EXISTS "petty_cash_movement" (
  "id" UUID PRIMARY KEY,
  "store_id" UUID NOT NULL REFERENCES "store"("id"),
  "kind" VARCHAR(12) NOT NULL CHECK ("kind" IN ('expense', 'replenish')),
  "amount" NUMERIC(10,2) NOT NULL CHECK ("amount" > 0),
  "reason" VARCHAR(200) NOT NULL,
  "balance_after" NUMERIC(10,2) NOT NULL CHECK ("balance_after" >= 0),
  "period_id" UUID REFERENCES "sales_period"("id"),
  "station_id" UUID REFERENCES "station"("id"),
  "by_user_id" UUID REFERENCES "app_user"("id"),
  "by_user_name" VARCHAR(60) NOT NULL,
  "by_device" VARCHAR(40),
  "by_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ix_petty_cash_movement_store_at" ON "petty_cash_movement" ("store_id", "by_at" DESC);
CREATE INDEX IF NOT EXISTS "ix_petty_cash_movement_period" ON "petty_cash_movement" ("period_id");
CREATE INDEX IF NOT EXISTS "ix_petty_cash_movement_station" ON "petty_cash_movement" ("station_id");
CREATE INDEX IF NOT EXISTS "ix_petty_cash_movement_user" ON "petty_cash_movement" ("by_user_id");
COMMENT ON TABLE "petty_cash_movement" IS 'Caja chica (fondo del gerente, aparte del cajón): gastos con motivo y reposiciones; saldo después de cada uno';

-- 3) Permisos: arqueo de auditoría (Administrador) y caja chica (Administrador y Encargado)
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('funciones.arqueoAuditoria', 'Funciones', 'Arqueo de auditoría', 35),
  ('funciones.cajaChica', 'Funciones', 'Caja chica', 36)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", 'funciones.arqueoAuditoria', p."store_id" FROM "user_profile" p WHERE p."code" = 'ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", 'funciones.cajaChica', p."store_id" FROM "user_profile" p WHERE p."code" IN ('ADMIN', 'ADMIN_LOCAL')
ON CONFLICT DO NOTHING;
