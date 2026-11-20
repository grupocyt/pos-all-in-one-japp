-- 0041 · 1.2.285 (20/11/2026)
-- 1) Descuentos con «Formulario»: los datos que hay que pedir al aplicar el descuento al cobrar (Ajustes › Facturación › Descuentos).
--    Lista de campos: [{"label":"DNI","type":"text","req":true}, …]; tipos text, number, date, tel o email; [] = no pide nada.
--    Lo que se rellena al cobrar queda en el historial de la cuenta (order_event «discountForm»).
ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "form" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "discount" DROP CONSTRAINT IF EXISTS "ck_discount_form";
ALTER TABLE "discount" ADD CONSTRAINT "ck_discount_form" CHECK (jsonb_typeof("form") = 'array' AND jsonb_array_length("form") <= 10);
COMMENT ON COLUMN "discount"."form" IS 'Campos que se piden al aplicar el descuento ([{label,type,req}], máx. 10); [] = ninguno';

-- 2) Roles y accesos de lo nuevo
--    pedido.ordenImpresion: arrastrar lo «Por enviar» para cambiar el orden de impresión (quien puede enviar)
--    funciones.miVenta: «Venta · t. · tk» del camarero en la cabecera de la PDA (todos)
--    funciones.corteVerSistema: ver Sistema y Propinas en el corte X (nadie: el corte X va a ciegas)
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('pedido.ordenImpresion', 'Pedido', 'Cambiar el orden de impresión', 19),
  ('funciones.miVenta', 'Funciones', 'Ver mi venta (cabecera de la PDA)', 37),
  ('funciones.corteVerSistema', 'Funciones', 'Ver Sistema y Propinas en el corte X', 38)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT pp."profile_id", 'pedido.ordenImpresion', pp."store_id" FROM "profile_permission" pp WHERE pp."permission_code" = 'pedido.enviar'
ON CONFLICT DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", 'funciones.miVenta', p."store_id" FROM "user_profile" p
ON CONFLICT DO NOTHING;
