-- 0010 · Tipos de factura de VeriFactu, índices de las series y comentarios que faltaban.
--  1. invoice_series.kind, invoice.type y verifactu_record.invoice_type admiten los tipos que usa
--     Ajustes › Facturación: F1, F2, F3 y R1…R5 (antes solo F1, F2 y R1: un abono R5 se rechazaba).
--  2. Índice en cada clave foránea de billing_settings hacia invoice_series (PostgreSQL no las indexa solo).
--  3. COMMENT ON en las columnas que se quedaron sin descripción.
-- Idempotente y sin tocar datos existentes.

-- 1 · Tipos de factura ------------------------------------------------------------------------------------------------
ALTER TABLE "invoice_series" DROP CONSTRAINT IF EXISTS "invoice_series_kind_check";
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_kind_check"
  CHECK ("kind" IN ('F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'));

ALTER TABLE "invoice" DROP CONSTRAINT IF EXISTS "invoice_type_check";
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_type_check"
  CHECK ("type" IN ('F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'));

ALTER TABLE "verifactu_record" DROP CONSTRAINT IF EXISTS "verifactu_record_invoice_type_check";
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_invoice_type_check"
  CHECK ("invoice_type" IN ('F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'));

COMMENT ON COLUMN "invoice_series"."kind" IS
  'Tipo VeriFactu: F1 completa, F2 simplificada, F3 sustitutiva, R1…R5 rectificativas (R5 = abono de simplificada)';
COMMENT ON COLUMN "invoice"."type" IS
  'Tipo VeriFactu: F1 completa, F2 simplificada, F3 sustitutiva, R1…R5 rectificativas (R5 = abono de simplificada)';

-- 2 · Índices de las claves foráneas de billing_settings --------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "ix_billing_settings_series_simplified" ON "billing_settings" ("store_id", "series_simplified");
CREATE INDEX IF NOT EXISTS "ix_billing_settings_series_full" ON "billing_settings" ("store_id", "series_full");
CREATE INDEX IF NOT EXISTS "ix_billing_settings_series_credit" ON "billing_settings" ("store_id", "series_credit");

-- 3 · Comentarios que faltaban ----------------------------------------------------------------------------------------
COMMENT ON COLUMN "idempotency_key"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "idempotency_key"."created_at" IS 'Cuándo llegó la petición original (las claves caducan a las 24 h)';
COMMENT ON COLUMN "sync_state"."created_at" IS 'Cuándo se creó';
COMMENT ON COLUMN "sync_state"."updated_at" IS 'Último cambio (lo pone el disparador)';
COMMENT ON COLUMN "catalog_release"."created_at" IS 'Cuándo se creó';
COMMENT ON COLUMN "catalog_release"."updated_at" IS 'Último cambio (lo pone el disparador)';
COMMENT ON COLUMN "sales_target"."created_at" IS 'Cuándo se creó';
COMMENT ON COLUMN "sales_target"."updated_at" IS 'Último cambio (lo pone el disparador)';
