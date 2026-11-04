-- 0030 · Cierre de la versión de facturación (decidido con el dueño el 04/11/2026, API 1.2.268).

-- 16 · El tablero de pedidos de delivery solo para cajero y encargado: se queda en los perfiles que abren o cierran el
-- periodo o cobran (cajero) o autorizan (encargado); al resto se le quita. Se puede volver a dar en Ajustes › Accesos.
DELETE FROM "profile_permission" pp
 WHERE pp."permission_code" = 'funciones.pedidos'
   AND NOT EXISTS (SELECT 1 FROM "profile_permission" x WHERE x."profile_id" = pp."profile_id"
                    AND x."permission_code" IN ('cobro.cobrar', 'funciones.periodo', 'sistema.autorizar'));

-- 10 · Factura por email: no se envían correos. La factura lleva su estado de envío, que se queda en «no enviada».
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "email_status" VARCHAR(12) NOT NULL DEFAULT 'not_sent';
ALTER TABLE "invoice" DROP CONSTRAINT IF EXISTS "invoice_email_status_check";
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_email_status_check" CHECK ("email_status" IN ('not_sent', 'sent', 'failed'));
COMMENT ON COLUMN "invoice"."email_status" IS 'Envío por email: not_sent (no se envían correos, 04/11/2026), sent o failed';

-- F3 · Límite de la factura simplificada, configurable por tienda (0 = sin límite). Por encima, factura completa.
ALTER TABLE "billing_settings" ADD COLUMN IF NOT EXISTS "simplified_limit" NUMERIC(10,2) NOT NULL DEFAULT 3000;
ALTER TABLE "billing_settings" DROP CONSTRAINT IF EXISTS "billing_settings_simplified_limit_check";
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_simplified_limit_check" CHECK ("simplified_limit" >= 0);
COMMENT ON COLUMN "billing_settings"."simplified_limit" IS 'Importe máximo (IVA incl.) de una factura simplificada; 0 = sin límite (hostelería: 3.000 €)';

-- F1 · Factura completa que sustituye a una simplificada (tipo F3): la simplificada no se toca, queda «substituted» y
-- la nueva apunta a ella. No se mueve dinero.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "substituted_invoice_id" UUID REFERENCES "invoice" ("id");
CREATE INDEX IF NOT EXISTS "ix_invoice_substituted_invoice_id" ON "invoice" ("substituted_invoice_id");
COMMENT ON COLUMN "invoice"."substituted_invoice_id" IS 'F3: factura simplificada a la que sustituye';
ALTER TABLE "invoice" DROP CONSTRAINT IF EXISTS "invoice_status_check";
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_status_check" CHECK ("status" IN ('issued', 'rectified', 'cancelled', 'substituted'));
DROP INDEX IF EXISTS "uq_invoice_account_issued";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_account_issued" ON "invoice" ("account_id")
  WHERE "type" IN ('F1', 'F2', 'F3') AND "status" = 'issued' AND "account_id" IS NOT NULL;

-- N7 · Tipo de cuenta: normal u order_on_table (los pedidos del cliente por el QR van a su propia cuenta).
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_kind_check";
ALTER TABLE "account" ADD CONSTRAINT "account_kind_check" CHECK ("kind" IN ('normal', 'order_on_table'));
UPDATE "account" SET "kind" = 'order_on_table' WHERE "name" LIKE 'Order on Table%' AND "kind" = 'normal';
COMMENT ON COLUMN "account"."kind" IS 'normal u order_on_table (pedidos del cliente por el QR)';

-- N3 · Propina con todas las formas de pago (menos las de tipo descuento). Sigue fuera de la factura y de VeriFactu.
UPDATE "payment_method" SET "allows_tip" = TRUE WHERE "kind" <> 'discount' AND "allows_tip" = FALSE;
ALTER TABLE "payment_method" ALTER COLUMN "allows_tip" SET DEFAULT TRUE;

-- 11 · Corte Z con el motivo del descuadre: se guarda la nota del cierre.
ALTER TABLE "cash_closing" ADD COLUMN IF NOT EXISTS "note" VARCHAR(300);
COMMENT ON COLUMN "cash_closing"."note" IS 'Motivo del descuadre escrito al cerrar (sale en el corte Z)';
