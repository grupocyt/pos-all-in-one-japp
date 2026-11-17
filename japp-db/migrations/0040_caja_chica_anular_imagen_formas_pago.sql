-- 0040 · 1.2.282 (17/11/2026)
-- 1) Un apunte de caja chica (ingreso o gasto) se puede eliminar desde Caja › Caja chica: queda anulado (no se borra),
--    con quién y cuándo; ya no cuenta en el saldo ni sale en los movimientos ni en los tickets de corte X y Z.
--    Los cortes X y arqueos NO se eliminan (las columnas voided_* de cash_movement de la 0039 se quedan sin uso).
ALTER TABLE "petty_cash_movement" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3) WITH TIME ZONE;
ALTER TABLE "petty_cash_movement" ADD COLUMN IF NOT EXISTS "voided_by_name" VARCHAR(60);
COMMENT ON COLUMN "petty_cash_movement"."voided_at" IS 'Apunte de caja chica eliminado (por error): ya no cuenta en el saldo ni se enseña';
COMMENT ON COLUMN "petty_cash_movement"."voided_by_name" IS 'Quién eliminó el apunte';
COMMENT ON COLUMN "cash_movement"."voided_at" IS 'Sin uso desde la 1.2.282: los cortes X y arqueos no se eliminan';

-- 2) Imagen del botón de cada forma de pago en Cobrar (Ajustes › Formas de pago › Imagen del botón), 220 × 56 a doble resolución.
--    En la base para que la vean todas las cajas y PDAs (antes no había dónde guardarla).
ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "payment_method" DROP CONSTRAINT IF EXISTS "ck_payment_method_image";
ALTER TABLE "payment_method" ADD CONSTRAINT "ck_payment_method_image"
  CHECK ("image" IS NULL OR ("image" LIKE 'data:image/%' AND length("image") <= 300000));
COMMENT ON COLUMN "payment_method"."image" IS 'Imagen del botón en Cobrar (data:image/png;base64, 440 × 112); vacía = se ve el nombre';
