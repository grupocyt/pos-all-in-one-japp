-- 0007 · En qué momento se eliminó cada línea: pendiente de enviar, ya impresa (comanda) o en precuenta.
-- Lo pide el Manager (quién eliminó «en línea, impreso o precuenta») y el informe de anulaciones.
ALTER TABLE "order_line" ADD COLUMN IF NOT EXISTS "deleted_stage" VARCHAR(20);
DO $$ BEGIN
  ALTER TABLE "order_line" ADD CONSTRAINT "ck_order_line_deleted_stage" CHECK ("deleted_stage" IS NULL OR "deleted_stage" IN ('pendingPrint','printed','preBill'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN "order_line"."deleted_stage" IS 'Estado de la línea cuando se eliminó: pendingPrint (sin enviar) · printed (comanda impresa) · preBill (en precuenta)';
-- Líneas ya eliminadas: sin enviar si nunca se imprimió; impresa en otro caso (antes no se guardaba si estaba en precuenta).
UPDATE "order_line" SET "deleted_stage" = CASE WHEN "printed" THEN 'printed' ELSE 'pendingPrint' END WHERE "deleted" AND "deleted_stage" IS NULL;
