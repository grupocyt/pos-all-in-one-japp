-- 0008 · Reglas del 15/10/2026 y arreglos de la auditoría.
--  1. Caja principal: una por tienda; el perfil Cajero solo entra en ella.
--  2. Una persona por mesa: quién tiene la mesa, hasta cuándo, y si hay un cobro abierto. Solo entra en una mesa ocupada quien tenga mesas.entrarOcupada.
--  3. Integridad de ventas: sin CASCADE, formas de pago libres (validadas por FK), una orden abierta por mesa, una factura por cuenta, cadena VeriFactu sin ramas.
-- Pensada para tiendas con datos: cada paso es idempotente y no borra nada.

-- 1 · Caja principal ---------------------------------------------------------------------------------------------
ALTER TABLE "station" ADD COLUMN IF NOT EXISTS "is_main" BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN "station"."is_main" IS 'Caja principal de la tienda (solo una): caja, arqueo, retiros y cierre de periodo se hacen aquí';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_station_main" ON "station" ("store_id") WHERE "is_main";
-- La primera estación de tipo caja de cada tienda que no tenga ninguna (en la Sucursal Pruebas, CAJA1).
UPDATE "station" s SET "is_main" = true
 WHERE s.id = (SELECT x.id FROM "station" x WHERE x.store_id = s.store_id AND x.kind = 'station' AND x.active ORDER BY (x.name = 'CAJA1') DESC, x.name LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM "station" y WHERE y.store_id = s.store_id AND y.is_main);

ALTER TABLE "user_profile" ADD COLUMN IF NOT EXISTS "allowed_stations" VARCHAR(10) NOT NULL DEFAULT 'any';
DO $$ BEGIN
  ALTER TABLE "user_profile" ADD CONSTRAINT "ck_user_profile_allowed_stations" CHECK ("allowed_stations" IN ('any','main'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN "user_profile"."allowed_stations" IS 'En qué equipos puede entrar el perfil: any = cualquiera · main = solo la caja principal (Cajero)';
UPDATE "user_profile" SET "allowed_stations" = 'main' WHERE "code" = 'CAJERO' AND "allowed_stations" = 'any';

-- 2 · Una persona por mesa -----------------------------------------------------------------------------------------
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "holder_user_id" UUID REFERENCES "app_user" ("id");
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "holder_user_name" VARCHAR(80);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "holder_station_id" UUID REFERENCES "station" ("id");
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "holder_station_name" VARCHAR(60);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "holder_until" TIMESTAMPTZ(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "charging_until" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "ix_orders_holder_user_id" ON "orders" ("holder_user_id");
CREATE INDEX IF NOT EXISTS "ix_orders_holder_station_id" ON "orders" ("holder_station_id");
COMMENT ON COLUMN "orders"."holder_user_id" IS 'Quién tiene la mesa ahora (una persona por mesa); vale mientras holder_until > now()';
COMMENT ON COLUMN "orders"."holder_user_name" IS 'Nombre de quien tiene la mesa, para el aviso «Mesa ocupada por …»';
COMMENT ON COLUMN "orders"."holder_station_id" IS 'Equipo desde el que se tiene la mesa';
COMMENT ON COLUMN "orders"."holder_station_name" IS 'Nombre del equipo, para el aviso';
COMMENT ON COLUMN "orders"."holder_until" IS 'El equipo lo renueva cada 10 s; pasado este momento la mesa queda libre (equipo apagado o sin wifi)';
COMMENT ON COLUMN "orders"."charging_until" IS 'Cobro abierto en la mesa hasta este momento: nadie más entra, tampoco un administrador';

INSERT INTO "permission" ("code", "module", "name", "sort_order")
VALUES ('mesas.entrarOcupada', 'Mesas', 'Entrar en una mesa ocupada por otro', 15)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
SELECT p.id, 'mesas.entrarOcupada', p.store_id FROM "user_profile" p WHERE p.code IN ('ADMIN','ADMIN_LOCAL')
ON CONFLICT DO NOTHING;

-- 3 · Integridad de ventas ------------------------------------------------------------------------------------------
-- Formas de pago creadas en Ajustes (glovo, efectivo2…): el código ya no está en una lista fija; manda payment_method_id.
ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_method_check";
DO $$ BEGIN
  ALTER TABLE "payment" ADD CONSTRAINT "ck_payment_method_code" CHECK ("method" ~ '^[a-z0-9_-]{1,30}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE "payment" p SET "payment_method_id" = pm.id FROM "payment_method" pm
 WHERE p."payment_method_id" IS NULL AND pm.store_id = p.store_id AND pm.code = p.method;

-- Nada de ventas se borra en cascada.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.conrelid::regclass AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
             FROM pg_constraint c
            WHERE c.contype = 'f' AND c.confdeltype = 'c'
              AND c.conrelid::regclass::text IN ('account','order_event','order_line','order_line_modifier','order_line_printer','account_discount','payment','payment_cash_detail','payment_bank_data','invoice_tax')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, replace(r.def, 'ON DELETE CASCADE', 'ON DELETE RESTRICT'));
  END LOOP;
END $$;

-- Una orden abierta por mesa.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_orders_open_table" ON "orders" ("table_id") WHERE "status" IN ('open','billing') AND "table_id" IS NOT NULL;

-- Una factura F1/F2 emitida por cuenta.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_account_issued" ON "invoice" ("account_id") WHERE "type" IN ('F1','F2') AND "status" = 'issued' AND "account_id" IS NOT NULL;

-- Cadena VeriFactu sin ramas: cada registro tiene como mucho un sucesor y hay un solo génesis por tienda.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_verifactu_previous" ON "verifactu_record" ("previous_record_id") WHERE "previous_record_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_verifactu_genesis" ON "verifactu_record" ("store_id") WHERE "previous_record_id" IS NULL;

-- Periodo: estado y marca de abierto coherentes.
DO $$ BEGIN
  ALTER TABLE "sales_period" ADD CONSTRAINT "ck_sales_period_open_flag" CHECK (("status" = 'open') = ("open_flag" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Series de Ajustes › Facturación: siempre existen en invoice_series.
INSERT INTO "invoice_series" ("store_id", "series", "kind")
SELECT b.store_id, s.series, s.kind FROM "billing_settings" b
 CROSS JOIN LATERAL (VALUES (b.series_simplified, 'F2'), (b.series_full, 'F1'), (b.series_credit, 'R1')) AS s(series, kind)
ON CONFLICT DO NOTHING;
DO $$ BEGIN
  ALTER TABLE "billing_settings" ADD CONSTRAINT "fk_billing_series_simplified" FOREIGN KEY ("store_id", "series_simplified") REFERENCES "invoice_series" ("store_id", "series");
  ALTER TABLE "billing_settings" ADD CONSTRAINT "fk_billing_series_full" FOREIGN KEY ("store_id", "series_full") REFERENCES "invoice_series" ("store_id", "series");
  ALTER TABLE "billing_settings" ADD CONSTRAINT "fk_billing_series_credit" FOREIGN KEY ("store_id", "series_credit") REFERENCES "invoice_series" ("store_id", "series");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rangos que hasta ahora solo vigilaba el dominio.
DO $$ BEGIN ALTER TABLE "product" ADD CONSTRAINT "ck_product_price_nonneg" CHECK ("price" >= 0 AND ("price_terrace" IS NULL OR "price_terrace" >= 0)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "question" ADD CONSTRAINT "ck_question_answers_range" CHECK ("min_answers" >= 0 AND "min_answers" <= "max_answers"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "order_line" ADD CONSTRAINT "ck_order_line_quantity_pos" CHECK ("quantity" > 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Informe «top del mes» (CLAUDE.md).
CREATE INDEX IF NOT EXISTS "ix_order_line_store_created" ON "order_line" ("store_id", "created_by_at");

-- Idempotencia: la clave se reserva dentro de la transacción del comando (status_code 0 = en curso).
COMMENT ON TABLE "idempotency_key" IS 'Respuestas guardadas por Idempotency-Key: la misma clave devuelve la misma respuesta sin repetir la acción';
COMMENT ON COLUMN "idempotency_key"."key" IS 'Idempotency-Key que manda el equipo';
COMMENT ON COLUMN "idempotency_key"."method" IS 'Método HTTP de la petición original';
COMMENT ON COLUMN "idempotency_key"."path" IS 'Ruta de la petición original';
COMMENT ON COLUMN "idempotency_key"."status_code" IS 'Código HTTP guardado; 0 = la petición original sigue en curso';
COMMENT ON COLUMN "idempotency_key"."response" IS 'Cuerpo de la respuesta guardada';
