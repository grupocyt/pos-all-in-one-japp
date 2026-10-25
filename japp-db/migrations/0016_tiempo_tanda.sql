-- 0016 · Tiempo de la tanda (25/10/2026).
-- El TPV y la PDA guardan en el equipo lo que se marca y lo mandan al servidor en una tanda (POST /orders/{id}/batch)
-- cuando pasan estos segundos sin tocar. Se ajusta en Ajustes › Facturación; entre 2 y 30 s, 5 por defecto.
ALTER TABLE "billing_settings" ADD COLUMN IF NOT EXISTS "batch_send_seconds" SMALLINT NOT NULL DEFAULT 5;
ALTER TABLE "billing_settings" DROP CONSTRAINT IF EXISTS "ck_billing_settings_batch_send_seconds";
ALTER TABLE "billing_settings" ADD CONSTRAINT "ck_billing_settings_batch_send_seconds" CHECK ("batch_send_seconds" BETWEEN 2 AND 30);
COMMENT ON COLUMN "billing_settings"."batch_send_seconds" IS 'Segundos sin tocar tras los que el TPV y la PDA mandan al servidor la tanda de cambios de la mesa (2–30, 5 por defecto)';
