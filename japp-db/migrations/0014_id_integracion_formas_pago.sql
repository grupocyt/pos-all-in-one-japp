-- 0014 · Id de integración en las formas de pago (24/10/2026).
-- Igual que category/product/question (0012): «external_id» es el id con el que otro sistema (Manager, contabilidad…)
-- reconoce la forma de pago. Opcional y sin repetir dentro de la tienda (también entre desactivadas).
ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "external_id" VARCHAR(60);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_method_external_id" ON "payment_method" ("store_id", "external_id")
  WHERE "external_id" IS NOT NULL;
COMMENT ON COLUMN "payment_method"."external_id" IS 'Id de integración: con él otro sistema (Manager, contabilidad) reconoce la forma de pago. Único por tienda';
