-- 0024 · Gestiones › Resumen semana (TPV 1.2.262–1.2.263, 02/11/2026).
-- La semana se calcula con los cierres de periodo (period_summary) y los objetivos (sales_target): GET /reports/week.
-- week_note: la observación de cada día de la hoja (una por tienda y día de negocio), con versión para no pisar a otro equipo.
-- period_summary.by_product: lo vendido por producto en el periodo, para «productos más vendidos con su % de mezcla».
CREATE TABLE IF NOT EXISTS "week_note" (
  "id"            UUID PRIMARY KEY,
  "store_id"      UUID NOT NULL REFERENCES "store" ("id"),
  "business_date" DATE NOT NULL,
  "note"          VARCHAR(500) NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by"    VARCHAR(80),
  CONSTRAINT "ck_week_note_note" CHECK (length(btrim("note")) > 0),
  CONSTRAINT "uq_week_note_store_id_business_date" UNIQUE ("store_id", "business_date")
);
DROP TRIGGER IF EXISTS "trg_week_note_updated_at" ON "week_note";
CREATE TRIGGER "trg_week_note_updated_at" BEFORE UPDATE ON "week_note" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "week_note" IS 'Observaciones de cada día en Gestiones › Resumen semana (una por tienda y día de negocio; borrar el texto borra la fila)';
COMMENT ON COLUMN "week_note"."business_date" IS 'Día de negocio (el del periodo), no el día natural';

ALTER TABLE "period_summary" ADD COLUMN IF NOT EXISTS "by_product" JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN ALTER TABLE "period_summary" ADD CONSTRAINT "ck_period_summary_by_product" CHECK (jsonb_typeof("by_product") = 'array'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN "period_summary"."by_product" IS 'Vendido por producto en el periodo: [{plu, name, quantity, amount}] (sin anulaciones ni invitaciones); se rellena al cerrar';
