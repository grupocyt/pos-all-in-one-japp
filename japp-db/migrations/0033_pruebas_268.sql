-- 0033 · Pruebas de la 1.2.268 en JC01 (documento «POS PRUEBAS V. 1.2.268»), aprobado por el dueño el 11/11/2026 (API 1.2.269).

-- A3 · Descuentos por perfil (Ajustes › Facturación › Descuentos): qué perfiles lo pueden aplicar, para todos los equipos a la vez.
-- [] = todos. Lo de antes: «Solo encargados» (needs_authorization) pasa a Administrador y Administrador local.
ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "profiles" JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN "discount"."profiles" IS 'Códigos de perfil que pueden aplicar el descuento (["ADMIN","CAJERO"]); [] = todos';
UPDATE "discount" SET "profiles" = '["ADMIN","ADMIN_LOCAL"]'::jsonb
 WHERE "needs_authorization" = TRUE AND "profiles" = '[]'::jsonb;

-- A4 · Fast food: nombre del cliente (solo el nombre, para llamarle; no son datos fiscales)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_name" VARCHAR(40);
COMMENT ON COLUMN "orders"."customer_name" IS 'Nombre del cliente en fast food (sale en la comanda y en el ticket); no es un dato fiscal';

-- A5 · Calificativos por categoría: los PLU de la categoría CALIFICATIVOS que salen en Comentario para sus productos. [] = todos.
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "qualifiers" JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN "category"."qualifiers" IS 'PLU de los calificativos que salen al comentar un producto de esta categoría; [] = todos';

-- A7 · Mesa cerrada a base de eliminar lo enviado (no se cobra nada): motivo obligatorio, para Gestiones › Eliminaciones › Mesas enteras
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "void_close" JSONB;
COMMENT ON COLUMN "orders"."void_close" IS 'Cierre de la mesa entera con eliminaciones: {reason, amount, lines, user, role, device, at}';

-- A10 · Resumen semana: las observaciones de días anteriores solo con este permiso (o la clave de quien lo tenga)
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('funciones.semanaEditar', 'Funciones', 'Resumen semana › editar días anteriores', 33)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", 'funciones.semanaEditar', p."store_id" FROM "user_profile" p WHERE p."code" IN ('ADMIN', 'ADMIN_LOCAL')
ON CONFLICT DO NOTHING;

-- D2 · Arqueo: varios datáfonos (cuántos tiene el local) y lo que marcó cada uno, en el arqueo y en el cierre
ALTER TABLE "store_parameters" ADD COLUMN IF NOT EXISTS "card_terminals" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "store_parameters" DROP CONSTRAINT IF EXISTS "ck_store_parameters_card_terminals";
ALTER TABLE "store_parameters" ADD CONSTRAINT "ck_store_parameters_card_terminals" CHECK ("card_terminals" BETWEEN 1 AND 9);
COMMENT ON COLUMN "store_parameters"."card_terminals" IS 'Datáfonos del local: un campo por datáfono en el arqueo y el cierre';
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "card_detail" JSONB;
ALTER TABLE "cash_movement" ADD COLUMN IF NOT EXISTS "counted_card" NUMERIC(10,2);
COMMENT ON COLUMN "cash_movement"."card_detail" IS 'Arqueo: total de cada datáfono [{name, amount}]';
ALTER TABLE "cash_closing" ADD COLUMN IF NOT EXISTS "card_detail" JSONB;
COMMENT ON COLUMN "cash_closing"."card_detail" IS 'Cierre: total de cada datáfono [{name, amount}]';

-- D2 · El corte X normal solo lleva ventas, formas de pago y propinas (el resumen completo es el del arqueo).
-- Se quitan las partes del corte X guardadas (lo que no viene, sale) y se apagan: comensales, ticket medio, IVA, áreas,
-- camareros, descuentos, eliminaciones, abonos y caja. Se vuelven a encender en Ajustes › Formatos › Corte X.
UPDATE "store_parameters"
   SET "ticket_formats" = jsonb_set(coalesce("ticket_formats", '{}'::jsonb), '{cutx}',
       (coalesce("ticket_formats"->'cutx', '{}'::jsonb) - 'comensales' - 'ticketMedio' - 'iva' - 'areas' - 'camareros'
          - 'descuentos' - 'eliminaciones' - 'abonos' - 'caja')
       || '{"comensales":false,"ticketMedio":false,"iva":false,"areas":false,"camareros":false,"descuentos":false,"eliminaciones":false,"abonos":false,"caja":false}'::jsonb);
