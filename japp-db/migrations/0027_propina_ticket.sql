-- 0027 · Propina en el ticket de la factura (04/11/2026, API 1.2.268).
-- La propina nunca forma parte de la factura (ni del total, ni del IVA, ni del registro VeriFactu): es un dato interno
-- del cobro (payment.tip). Este parámetro solo decide si se imprime en el ticket de la factura. Por defecto, sí.
ALTER TABLE "store_parameters" ADD COLUMN IF NOT EXISTS "print_tip" BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN "store_parameters"."print_tip" IS 'Imprimir la propina en el ticket de la factura (no es dato fiscal)';

-- Bloqueo por inactividad: desde las pruebas del 28/10 es 0 (nunca) o de 10 a 3600 s. Los datos de arranque traían 7 s y
-- con eso la API rechazaba cualquier cambio de Ajustes › Parámetros («El bloqueo es 0 (nunca) o de 10 a 3600 segundos»).
UPDATE "store_parameters" SET "lock_seconds" = 10 WHERE "lock_seconds" BETWEEN 1 AND 9;
UPDATE "store_parameters" SET "lock_seconds_pda" = 10 WHERE "lock_seconds_pda" BETWEEN 1 AND 9;
ALTER TABLE "store_parameters" ALTER COLUMN "lock_seconds" SET DEFAULT 10;
