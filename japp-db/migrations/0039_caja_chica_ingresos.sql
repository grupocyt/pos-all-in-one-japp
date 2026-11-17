-- 0039 · 1.2.281 (17/11/2026): la caja chica deja de ser un fondo fijo del gerente (50 €).
-- 1) Se ingresa efectivo libremente (p. ej. 100 € para los gastos del día): nuevo tipo «deposit».
-- 2) Cada gasto puede llevar la foto del ticket (la sube la PDA › Gestiones › Cargar ticket de caja chica).
-- 3) El saldo ya no parte del fondo: parte de 0. Para no cambiar el saldo de las tiendas que ya la usaban,
--    el fondo de antes queda como un ingreso «Saldo inicial» justo antes del primer apunte (no se borra nada).
ALTER TABLE "petty_cash_movement" DROP CONSTRAINT IF EXISTS "petty_cash_movement_kind_check";
ALTER TABLE "petty_cash_movement" ADD CONSTRAINT "petty_cash_movement_kind_check" CHECK ("kind" IN ('expense', 'replenish', 'deposit'));
ALTER TABLE "petty_cash_movement" ADD COLUMN IF NOT EXISTS "photo" TEXT;
ALTER TABLE "petty_cash_movement" DROP CONSTRAINT IF EXISTS "ck_petty_cash_movement_photo";
ALTER TABLE "petty_cash_movement" ADD CONSTRAINT "ck_petty_cash_movement_photo"
  CHECK ("photo" IS NULL OR ("photo" LIKE 'data:image/%' AND length("photo") <= 3000000));
COMMENT ON COLUMN "petty_cash_movement"."photo" IS 'Foto del ticket del gasto (data:image/jpeg;base64, reducida por el TPV); vacía si no se hizo';
INSERT INTO "petty_cash_movement" (id, store_id, kind, amount, reason, balance_after, by_user_name, by_device, by_at)
SELECT gen_random_uuid(), m.store_id, 'deposit', p.petty_cash_limit, 'Saldo inicial (fondo de antes de la 1.2.281)', p.petty_cash_limit,
       'Sistema', 'migración 0039', m.first_at - interval '1 millisecond'
  FROM (SELECT store_id, min(by_at) first_at FROM "petty_cash_movement" GROUP BY store_id) m
  JOIN "store_parameters" p ON p.store_id = m.store_id
 WHERE NOT EXISTS (SELECT 1 FROM "petty_cash_movement" x WHERE x.store_id = m.store_id AND x.kind = 'deposit');
COMMENT ON COLUMN "store_parameters"."petty_cash_limit" IS 'Sin uso desde 1.2.281: la caja chica parte de 0 y se le ingresa efectivo';
COMMENT ON TABLE "petty_cash_movement" IS 'Caja chica (aparte del cajón): ingresos de efectivo, gastos con descripción y foto del ticket; saldo después de cada uno';

-- 4) Un corte X (o arqueo) mal escrito se puede eliminar desde Caja › Resumen: queda anulado (no se borra), con quién y cuándo.
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3) WITH TIME ZONE;
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "voided_by_name" VARCHAR(60);
COMMENT ON COLUMN "cash_movement"."voided_at" IS 'Corte X o arqueo eliminado desde Caja › Resumen (por error al escribirlo): ya no se enseña ni cuenta';
