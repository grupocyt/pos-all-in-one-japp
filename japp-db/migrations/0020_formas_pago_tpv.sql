-- 0020 · Formas de pago que no se ven en el TPV y tipo «descuento» (25/10/2026).
-- Para la interfaz de ventas al SIR, los descuentos son una forma de pago más (su id de integración es el Cod_FormaPago
-- con el que el SIR los recibe, p. ej. 63), pero no se cobra con ella: se marca «no mostrar en el TPV».
ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "show_in_tpv" BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN "payment_method"."show_in_tpv" IS 'Se ve en el cobro del TPV y la PDA. FALSE = solo para integraciones (p. ej. descuentos en el SIR)';
ALTER TABLE "payment_method" DROP CONSTRAINT IF EXISTS "payment_method_kind_check";
ALTER TABLE "payment_method" DROP CONSTRAINT IF EXISTS "ck_payment_method_kind";
ALTER TABLE "payment_method" ADD CONSTRAINT "ck_payment_method_kind" CHECK ("kind" IN ('cash','card','platform','voucher','discount'));
COMMENT ON COLUMN "payment_method"."kind" IS 'Tipo: cash, card, platform, voucher o discount (descuentos para el SIR; no se cobra con ella)';
