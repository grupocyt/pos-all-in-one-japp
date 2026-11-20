-- 0043 · 1.2.292 (20/11/2026)
-- 1) Permiso propio para pasar un producto ya enviado a otra mesa (antes usaba el de transferir la mesa).
--    Por defecto lo tiene quien ya podía transferir.
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('mesas.transferirProducto', 'Mesas', 'Transferir un producto a otra mesa', 3)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT pp."profile_id", 'mesas.transferirProducto', pp."store_id" FROM "profile_permission" pp WHERE pp."permission_code" = 'mesas.transferir'
ON CONFLICT DO NOTHING;

-- 2) Fuera el permiso «Reabrir mesa»: una cuenta cobrada no se reabre nunca (regla del 03/11/2026).
DELETE FROM "profile_permission" WHERE "permission_code" = 'cobro.reabrir';
DELETE FROM "permission" WHERE "code" = 'cobro.reabrir';

-- 3) Cierre de periodo: lo contado de TODAS las formas de pago dadas de alta, no solo efectivo y tarjeta.
--    [{"method":"gourmet","name":"Gourmet","counted":12.5,"expected":12.5}, …]
ALTER TABLE "cash_closing" ADD COLUMN IF NOT EXISTS "method_detail" JSONB;
ALTER TABLE "cash_closing" DROP CONSTRAINT IF EXISTS "ck_cash_closing_method_detail";
ALTER TABLE "cash_closing" ADD CONSTRAINT "ck_cash_closing_method_detail"
  CHECK ("method_detail" IS NULL OR (jsonb_typeof("method_detail") = 'array' AND jsonb_array_length("method_detail") <= 40));
COMMENT ON COLUMN "cash_closing"."method_detail" IS 'Contado de cada forma de pago en el cierre ([{method,name,counted,expected}]); efectivo y tarjeta también van en counted_cash y counted_card';

-- 4) Descuento con «Formulario»: lo rellenado al aplicarlo se guarda con el descuento de la cuenta y sale en la factura.
--    [{"label":"DNI","value":"12345678Z"}, …]
ALTER TABLE "account_discount" ADD COLUMN IF NOT EXISTS "form_data" JSONB;
ALTER TABLE "account_discount" DROP CONSTRAINT IF EXISTS "ck_account_discount_form_data";
ALTER TABLE "account_discount" ADD CONSTRAINT "ck_account_discount_form_data"
  CHECK ("form_data" IS NULL OR (jsonb_typeof("form_data") = 'array' AND jsonb_array_length("form_data") <= 10));
COMMENT ON COLUMN "account_discount"."form_data" IS 'Lo rellenado en el formulario del descuento ([{label,value}]); sale en la factura';
