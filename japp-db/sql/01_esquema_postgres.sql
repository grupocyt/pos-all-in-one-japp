-- Japp TPV · esquema PostgreSQL 16
-- Mismas tablas y columnas que en MySQL y SQLite. UUID nativo, NUMERIC para importes, TIMESTAMPTZ (UTC), JSONB.
SET client_encoding = 'UTF8';
SET timezone = 'UTC';

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Empresa (razón social y NIF del emisor de las facturas)
CREATE TABLE IF NOT EXISTS "company" (
  "id" UUID NOT NULL,
  "legal_name" VARCHAR(120) NOT NULL,
  "trade_name" VARCHAR(120),
  "tax_id" VARCHAR(20) NOT NULL,
  "address" VARCHAR(200),
  "country" VARCHAR(60),
  "maxpoint_cdn_id" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_company_tax_id" UNIQUE ("tax_id")
);
CREATE OR REPLACE TRIGGER "trg_company_updated_at" BEFORE UPDATE ON "company" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Restaurante / local (Ajustes › Restaurante)
CREATE TABLE IF NOT EXISTS "store" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL REFERENCES "company" ("id"),
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "service_type" VARCHAR(30) NOT NULL DEFAULT 'table' CHECK ("service_type" IN ('table','fastfood')),
  "address" VARCHAR(200),
  "city" VARCHAR(80),
  "phone" VARCHAR(30),
  "opening_hours" VARCHAR(60),
  "reviews_url" VARCHAR(300),
  "logo_url" VARCHAR(300),
  "ticket_header" TEXT,
  "ticket_footer" TEXT,
  "maxpoint_rst_id" INTEGER,
  "server_url" VARCHAR(200),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_store_code" UNIQUE ("code")
);
CREATE INDEX IF NOT EXISTS "ix_store_company_id" ON "store" ("company_id");
CREATE OR REPLACE TRIGGER "trg_store_updated_at" BEFORE UPDATE ON "store" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Facturación del local: series, establecimiento y punto de emisión
CREATE TABLE IF NOT EXISTS "billing_settings" (
  "store_id" UUID NOT NULL REFERENCES "store" ("id") ON DELETE CASCADE,
  "billing_email" VARCHAR(120),
  "establishment" VARCHAR(10),
  "emission_point" VARCHAR(10),
  "series_simplified" VARCHAR(20) NOT NULL,
  "series_full" VARCHAR(20) NOT NULL,
  "series_credit" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("store_id")
);
CREATE OR REPLACE TRIGGER "trg_billing_settings_updated_at" BEFORE UPDATE ON "billing_settings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Parámetros del local (Ajustes › Parámetros)
CREATE TABLE IF NOT EXISTS "store_parameters" (
  "store_id" UUID NOT NULL REFERENCES "store" ("id") ON DELETE CASCADE,
  "lock_seconds" SMALLINT NOT NULL DEFAULT 7,
  "lock_seconds_pda" SMALLINT NOT NULL DEFAULT 10,
  "duplicate_minutes" SMALLINT NOT NULL DEFAULT 3,
  "cash_float" NUMERIC(10,2) NOT NULL DEFAULT 150,
  "cash_diff_threshold" NUMERIC(10,2) NOT NULL DEFAULT 5,
  "idle_table_minutes" SMALLINT NOT NULL DEFAULT 45,
  "prebill_to_pay_minutes" SMALLINT NOT NULL DEFAULT 6,
  "kpi_min_tables" SMALLINT NOT NULL DEFAULT 20,
  "pin_attempts" SMALLINT NOT NULL DEFAULT 3,
  "pin_lock_seconds" SMALLINT NOT NULL DEFAULT 30,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("store_id")
);
CREATE OR REPLACE TRIGGER "trg_store_parameters_updated_at" BEFORE UPDATE ON "store_parameters" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Perfiles (Administrador, Cajero, Mesero…)
CREATE TABLE IF NOT EXISTS "user_profile" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "level" SMALLINT NOT NULL DEFAULT 10,
  "color" VARCHAR(30) CHECK ("color" IN ('red','amber','green')),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_user_profile_store_id_code" UNIQUE ("store_id", "code")
);
CREATE OR REPLACE TRIGGER "trg_user_profile_updated_at" BEFORE UPDATE ON "user_profile" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Catálogo de permisos por módulo y por botón (global, igual en todos los locales)
CREATE TABLE IF NOT EXISTS "permission" (
  "code" VARCHAR(40) NOT NULL,
  "module" VARCHAR(30) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "sort_order" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("code")
);

-- Permisos concedidos a cada perfil
CREATE TABLE IF NOT EXISTS "profile_permission" (
  "profile_id" UUID NOT NULL REFERENCES "user_profile" ("id") ON DELETE CASCADE,
  "permission_code" VARCHAR(40) NOT NULL REFERENCES "permission" ("code"),
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  PRIMARY KEY ("profile_id", "permission_code")
);
CREATE INDEX IF NOT EXISTS "ix_profile_permission_permission_code" ON "profile_permission" ("permission_code");
CREATE INDEX IF NOT EXISTS "ix_profile_permission_store_id" ON "profile_permission" ("store_id");

-- Usuarios del TPV (entran con clave de 4 cifras)
CREATE TABLE IF NOT EXISTS "app_user" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(60) NOT NULL,
  "initials" VARCHAR(4),
  "profile_id" UUID NOT NULL REFERENCES "user_profile" ("id"),
  "pin_hash" VARCHAR(100) NOT NULL,
  "can_charge" BOOLEAN,
  "can_delete_printed" BOOLEAN,
  "can_delete_prebill" BOOLEAN,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_app_user_store_id_name" UNIQUE ("store_id", "name")
);
CREATE INDEX IF NOT EXISTS "ix_app_user_profile_id" ON "app_user" ("profile_id");
CREATE OR REPLACE TRIGGER "trg_app_user_updated_at" BEFORE UPDATE ON "app_user" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Áreas o planos (BARRA, TERRAZA…)
CREATE TABLE IF NOT EXISTS "area" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(60) NOT NULL,
  "sort_order" SMALLINT NOT NULL DEFAULT 1,
  "price_list" VARCHAR(30) NOT NULL DEFAULT 'general' CHECK ("price_list" IN ('general','terrace')),
  "table_number_from" INTEGER NOT NULL DEFAULT 1,
  "plan_width" SMALLINT DEFAULT 1000,
  "plan_height" SMALLINT DEFAULT 640,
  "plan_image_url" VARCHAR(300),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_area_store_id_name" UNIQUE ("store_id", "name")
);
CREATE OR REPLACE TRIGGER "trg_area_updated_at" BEFORE UPDATE ON "area" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lo dibujado en Editar sala: paredes, bloques, elementos y textos
CREATE TABLE IF NOT EXISTS "area_drawing" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "area_id" UUID NOT NULL REFERENCES "area" ("id") ON DELETE CASCADE,
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('wall','block','item','text')),
  "x1" NUMERIC(7,2) NOT NULL,
  "y1" NUMERIC(7,2) NOT NULL,
  "x2" NUMERIC(7,2),
  "y2" NUMERIC(7,2),
  "item" VARCHAR(20),
  "label" VARCHAR(80),
  "sort_order" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_area_drawing_area_id" ON "area_drawing" ("area_id");
CREATE INDEX IF NOT EXISTS "ix_area_drawing_store_id" ON "area_drawing" ("store_id");

-- Mesas
CREATE TABLE IF NOT EXISTS "dining_table" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "area_id" UUID NOT NULL REFERENCES "area" ("id"),
  "number" VARCHAR(10) NOT NULL,
  "capacity" SMALLINT NOT NULL DEFAULT 4,
  "pos_x" NUMERIC(7,2),
  "pos_y" NUMERIC(7,2),
  "width" SMALLINT DEFAULT 110,
  "height" SMALLINT DEFAULT 90,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_dining_table_store_id_number" UNIQUE ("store_id", "number")
);
CREATE INDEX IF NOT EXISTS "ix_dining_table_area_id" ON "dining_table" ("area_id");
CREATE OR REPLACE TRIGGER "trg_dining_table_updated_at" BEFORE UPDATE ON "dining_table" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Impuestos (IVA 10 %)
CREATE TABLE IF NOT EXISTS "tax" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(30) NOT NULL,
  "rate" NUMERIC(5,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_tax_store_id_name_rate" UNIQUE ("store_id", "name", "rate")
);
CREATE OR REPLACE TRIGGER "trg_tax_updated_at" BEFORE UPDATE ON "tax" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Categorías de la toma de pedido
CREATE TABLE IF NOT EXISTS "category" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(60) NOT NULL,
  "bg_color" VARCHAR(9),
  "fg_color" VARCHAR(9),
  "sort_order" SMALLINT NOT NULL DEFAULT 0,
  "hidden" BOOLEAN NOT NULL DEFAULT FALSE,
  "maxpoint_id" VARCHAR(40),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_category_store_id_name" UNIQUE ("store_id", "name")
);
CREATE OR REPLACE TRIGGER "trg_category_updated_at" BEFORE UPDATE ON "category" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Productos (PLU) con PVP general y PVP terraza
CREATE TABLE IF NOT EXISTS "product" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "plu" INTEGER NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "ticket_name" VARCHAR(80),
  "category_id" UUID REFERENCES "category" ("id"),
  "price" NUMERIC(10,2) NOT NULL,
  "price_terrace" NUMERIC(10,2),
  "tax_id" UUID NOT NULL REFERENCES "tax" ("id"),
  "bg_color" VARCHAR(9),
  "fg_color" VARCHAR(9),
  "answer_only" BOOLEAN NOT NULL DEFAULT FALSE,
  "sold_out" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_product_store_id_plu" UNIQUE ("store_id", "plu")
);
CREATE INDEX IF NOT EXISTS "ix_product_category_id" ON "product" ("category_id");
CREATE INDEX IF NOT EXISTS "ix_product_tax_id" ON "product" ("tax_id");
CREATE OR REPLACE TRIGGER "trg_product_updated_at" BEFORE UPDATE ON "product" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Teclas: qué producto sale en cada categoría y dónde
CREATE TABLE IF NOT EXISTS "category_product" (
  "category_id" UUID NOT NULL REFERENCES "category" ("id") ON DELETE CASCADE,
  "product_id" UUID NOT NULL REFERENCES "product" ("id") ON DELETE CASCADE,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "label" VARCHAR(80),
  "bg_color" VARCHAR(9),
  "fg_color" VARCHAR(9),
  "pos_x" SMALLINT,
  "pos_y" SMALLINT,
  PRIMARY KEY ("category_id", "product_id")
);
CREATE INDEX IF NOT EXISTS "ix_category_product_product_id" ON "category_product" ("product_id");
CREATE INDEX IF NOT EXISTS "ix_category_product_store_id" ON "category_product" ("store_id");

-- Preguntas (opciones del producto: leche, punto, menú…)
CREATE TABLE IF NOT EXISTS "question" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(100) NOT NULL,
  "min_answers" SMALLINT NOT NULL DEFAULT 0,
  "max_answers" SMALLINT NOT NULL DEFAULT 1,
  "maxpoint_id" VARCHAR(40),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_question_store_id" ON "question" ("store_id");
CREATE OR REPLACE TRIGGER "trg_question_updated_at" BEFORE UPDATE ON "question" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Respuestas de una pregunta (cada respuesta es un producto)
CREATE TABLE IF NOT EXISTS "question_answer" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "question_id" UUID NOT NULL REFERENCES "question" ("id") ON DELETE CASCADE,
  "product_id" UUID NOT NULL REFERENCES "product" ("id"),
  "label" VARCHAR(80),
  "extra_price" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "bg_color" VARCHAR(9),
  "fg_color" VARCHAR(9),
  "sort_order" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_question_answer_question_id_product_id" UNIQUE ("question_id", "product_id")
);
CREATE INDEX IF NOT EXISTS "ix_question_answer_store_id" ON "question_answer" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_question_answer_product_id" ON "question_answer" ("product_id");

-- Preguntas que hace cada producto
CREATE TABLE IF NOT EXISTS "product_question" (
  "product_id" UUID NOT NULL REFERENCES "product" ("id") ON DELETE CASCADE,
  "question_id" UUID NOT NULL REFERENCES "question" ("id") ON DELETE CASCADE,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "sort_order" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("product_id", "question_id")
);
CREATE INDEX IF NOT EXISTS "ix_product_question_question_id" ON "product_question" ("question_id");
CREATE INDEX IF NOT EXISTS "ix_product_question_store_id" ON "product_question" ("store_id");

-- Canales de impresión (BARRA, cocina…)
CREATE TABLE IF NOT EXISTS "print_channel" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(40) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_print_channel_store_id_name" UNIQUE ("store_id", "name")
);
CREATE OR REPLACE TRIGGER "trg_print_channel_updated_at" BEFORE UPDATE ON "print_channel" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Por qué canal sale cada producto
CREATE TABLE IF NOT EXISTS "product_channel" (
  "product_id" UUID NOT NULL REFERENCES "product" ("id") ON DELETE CASCADE,
  "channel_id" UUID NOT NULL REFERENCES "print_channel" ("id") ON DELETE CASCADE,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  PRIMARY KEY ("product_id", "channel_id")
);
CREATE INDEX IF NOT EXISTS "ix_product_channel_channel_id" ON "product_channel" ("channel_id");
CREATE INDEX IF NOT EXISTS "ix_product_channel_store_id" ON "product_channel" ("store_id");

-- Impresoras
CREATE TABLE IF NOT EXISTS "printer" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(40) NOT NULL,
  "connection" VARCHAR(120) NOT NULL,
  "model" VARCHAR(30) NOT NULL DEFAULT 'EPSON' CHECK ("model" IN ('EPSON','BIXOLON','POSIFLEX','VCOCINA')),
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('ticket','kitchen','bar')),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_printer_store_id_name" UNIQUE ("store_id", "name")
);
CREATE OR REPLACE TRIGGER "trg_printer_updated_at" BEFORE UPDATE ON "printer" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Estaciones (cajas) y PDA (comanderos)
CREATE TABLE IF NOT EXISTS "station" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(40) NOT NULL,
  "kind" VARCHAR(30) NOT NULL DEFAULT 'station' CHECK ("kind" IN ('station','pda')),
  "device_uuid" VARCHAR(36),
  "ip" VARCHAR(45),
  "emission_point" VARCHAR(10),
  "opens_drawer" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_station_store_id_name" UNIQUE ("store_id", "name")
);
CREATE INDEX IF NOT EXISTS "ix_station_device_uuid" ON "station" ("device_uuid");
CREATE OR REPLACE TRIGGER "trg_station_updated_at" BEFORE UPDATE ON "station" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- En cada estación, por qué impresora sale cada canal
CREATE TABLE IF NOT EXISTS "station_channel_printer" (
  "station_id" UUID NOT NULL REFERENCES "station" ("id") ON DELETE CASCADE,
  "channel_id" UUID NOT NULL REFERENCES "print_channel" ("id") ON DELETE CASCADE,
  "printer_id" UUID NOT NULL REFERENCES "printer" ("id"),
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  PRIMARY KEY ("station_id", "channel_id")
);
CREATE INDEX IF NOT EXISTS "ix_station_channel_printer_channel_id" ON "station_channel_printer" ("channel_id");
CREATE INDEX IF NOT EXISTS "ix_station_channel_printer_printer_id" ON "station_channel_printer" ("printer_id");
CREATE INDEX IF NOT EXISTS "ix_station_channel_printer_store_id" ON "station_channel_printer" ("store_id");

-- Formas de pago
CREATE TABLE IF NOT EXISTS "payment_method" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('cash','card','platform','voucher')),
  "opens_drawer" BOOLEAN NOT NULL DEFAULT FALSE,
  "allows_tip" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_payment_method_store_id_code" UNIQUE ("store_id", "code")
);
CREATE OR REPLACE TRIGGER "trg_payment_method_updated_at" BEFORE UPDATE ON "payment_method" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Formas de pago activas en cada estación o PDA
CREATE TABLE IF NOT EXISTS "station_payment_method" (
  "station_id" UUID NOT NULL REFERENCES "station" ("id") ON DELETE CASCADE,
  "payment_method_id" UUID NOT NULL REFERENCES "payment_method" ("id") ON DELETE CASCADE,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  PRIMARY KEY ("station_id", "payment_method_id")
);
CREATE INDEX IF NOT EXISTS "ix_station_payment_method_payment_method_id" ON "station_payment_method" ("payment_method_id");
CREATE INDEX IF NOT EXISTS "ix_station_payment_method_store_id" ON "station_payment_method" ("store_id");

-- Descuentos configurados
CREATE TABLE IF NOT EXISTS "discount" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(60) NOT NULL,
  "percent" NUMERIC(5,2) NOT NULL,
  "valid_from" DATE,
  "valid_to" DATE,
  "needs_authorization" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_discount_store_id" ON "discount" ("store_id");
CREATE OR REPLACE TRIGGER "trg_discount_updated_at" BEFORE UPDATE ON "discount" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Descuentos activos en cada estación o PDA
CREATE TABLE IF NOT EXISTS "station_discount" (
  "station_id" UUID NOT NULL REFERENCES "station" ("id") ON DELETE CASCADE,
  "discount_id" UUID NOT NULL REFERENCES "discount" ("id") ON DELETE CASCADE,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  PRIMARY KEY ("station_id", "discount_id")
);
CREATE INDEX IF NOT EXISTS "ix_station_discount_discount_id" ON "station_discount" ("discount_id");
CREATE INDEX IF NOT EXISTS "ix_station_discount_store_id" ON "station_discount" ("store_id");

-- Motivos de eliminación, retiro de caja y abono
CREATE TABLE IF NOT EXISTS "reason" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "name" VARCHAR(80) NOT NULL,
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('delete','withdrawal','credit')),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_reason_store_id" ON "reason" ("store_id");
CREATE OR REPLACE TRIGGER "trg_reason_updated_at" BEFORE UPDATE ON "reason" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Periodos de venta (uno abierto por local)
CREATE TABLE IF NOT EXISTS "sales_period" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "status" VARCHAR(30) NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','closed')),
  "opened_by_user_id" UUID REFERENCES "app_user" ("id"),
  "opened_by_user_name" VARCHAR(60) NOT NULL,
  "opened_by_role" VARCHAR(30) CHECK ("opened_by_role" IN ('waiter','cashier','manager','customer','system')),
  "opened_by_device" VARCHAR(40),
  "opened_by_at" TIMESTAMPTZ(3) NOT NULL,
  "station_id" UUID REFERENCES "station" ("id"),
  "closed_by_user_id" UUID REFERENCES "app_user" ("id"),
  "closed_by_user_name" VARCHAR(60),
  "closed_by_role" VARCHAR(30) CHECK ("closed_by_role" IN ('waiter','cashier','manager','customer','system')),
  "closed_by_device" VARCHAR(40),
  "closed_by_at" TIMESTAMPTZ(3),
  "open_flag" SMALLINT CHECK ("open_flag" = 1),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_sales_period_store_id_open_flag" UNIQUE ("store_id", "open_flag")
);
CREATE INDEX IF NOT EXISTS "ix_sales_period_store_id_opened_by_at" ON "sales_period" ("store_id", "opened_by_at");
CREATE INDEX IF NOT EXISTS "ix_sales_period_opened_by_user_id" ON "sales_period" ("opened_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_sales_period_station_id" ON "sales_period" ("station_id");
CREATE INDEX IF NOT EXISTS "ix_sales_period_closed_by_user_id" ON "sales_period" ("closed_by_user_id");

-- Movimientos de caja: fondo, retiros, arqueos y depósitos
CREATE TABLE IF NOT EXISTS "cash_movement" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "period_id" UUID NOT NULL REFERENCES "sales_period" ("id"),
  "station_id" UUID REFERENCES "station" ("id"),
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('float','withdrawal','count','deposit')),
  "amount" NUMERIC(10,2) NOT NULL,
  "reason_id" UUID REFERENCES "reason" ("id"),
  "note" VARCHAR(200),
  "counted_detail" JSONB,
  "by_user_id" UUID REFERENCES "app_user" ("id"),
  "by_user_name" VARCHAR(60) NOT NULL,
  "by_role" VARCHAR(30) CHECK ("by_role" IN ('waiter','cashier','manager','customer','system')),
  "by_device" VARCHAR(40),
  "by_at" TIMESTAMPTZ(3) NOT NULL,
  "authorized_by" VARCHAR(60),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_cash_movement_period_id" ON "cash_movement" ("period_id");
CREATE INDEX IF NOT EXISTS "ix_cash_movement_store_id" ON "cash_movement" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_cash_movement_station_id" ON "cash_movement" ("station_id");
CREATE INDEX IF NOT EXISTS "ix_cash_movement_reason_id" ON "cash_movement" ("reason_id");
CREATE INDEX IF NOT EXISTS "ix_cash_movement_by_user_id" ON "cash_movement" ("by_user_id");

-- Cierre de periodo y arqueo final
CREATE TABLE IF NOT EXISTS "cash_closing" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "period_id" UUID NOT NULL REFERENCES "sales_period" ("id"),
  "counted_cash" NUMERIC(10,2) NOT NULL,
  "counted_card" NUMERIC(10,2),
  "expected_cash" NUMERIC(10,2) NOT NULL,
  "difference" NUMERIC(10,2) NOT NULL,
  "next_float" NUMERIC(10,2) NOT NULL,
  "deposit" NUMERIC(10,2) NOT NULL,
  "gross_sales" NUMERIC(10,2) NOT NULL,
  "guests" INTEGER,
  "by_user_id" UUID REFERENCES "app_user" ("id"),
  "by_user_name" VARCHAR(60) NOT NULL,
  "by_role" VARCHAR(30) CHECK ("by_role" IN ('waiter','cashier','manager','customer','system')),
  "by_device" VARCHAR(40),
  "by_at" TIMESTAMPTZ(3) NOT NULL,
  "authorized_by" VARCHAR(60),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_cash_closing_period_id" UNIQUE ("period_id")
);
CREATE INDEX IF NOT EXISTS "ix_cash_closing_store_id" ON "cash_closing" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_cash_closing_by_user_id" ON "cash_closing" ("by_user_id");

-- Historial de cambios de Ajustes (se envía a Japp Manager)
CREATE TABLE IF NOT EXISTS "config_change_log" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "at" TIMESTAMPTZ(3) NOT NULL,
  "user_id" UUID REFERENCES "app_user" ("id"),
  "user_name" VARCHAR(60) NOT NULL,
  "module" VARCHAR(30) NOT NULL,
  "action" VARCHAR(30) NOT NULL CHECK ("action" IN ('create','update','delete','activate','deactivate')),
  "record_name" VARCHAR(120),
  "diff" TEXT,
  "synced_at" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_config_change_log_store_id_synced_at" ON "config_change_log" ("store_id", "synced_at");
CREATE INDEX IF NOT EXISTS "ix_config_change_log_user_id" ON "config_change_log" ("user_id");

-- Requerimientos enviados a Marketing con las incidencias
CREATE TABLE IF NOT EXISTS "incident_request" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "code" VARCHAR(30) NOT NULL,
  "trigger_kind" VARCHAR(30) NOT NULL CHECK ("trigger_kind" IN ('period_close','manual')),
  "sent_at" TIMESTAMPTZ(3) NOT NULL,
  "sent_by" VARCHAR(60),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_incident_request_store_id_code" UNIQUE ("store_id", "code")
);

-- Incidencias: cambios de productos hechos en el local
CREATE TABLE IF NOT EXISTS "product_incident" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "code" VARCHAR(20) NOT NULL,
  "at" TIMESTAMPTZ(3) NOT NULL,
  "user_name" VARCHAR(60) NOT NULL,
  "product_id" UUID REFERENCES "product" ("id"),
  "product_name" VARCHAR(80),
  "action" VARCHAR(20) NOT NULL,
  "diff" TEXT,
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','sent')),
  "request_id" UUID REFERENCES "incident_request" ("id"),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_product_incident_store_id_code" UNIQUE ("store_id", "code")
);
CREATE INDEX IF NOT EXISTS "ix_product_incident_product_id" ON "product_incident" ("product_id");
CREATE INDEX IF NOT EXISTS "ix_product_incident_request_id" ON "product_incident" ("request_id");

-- Cola de envío del local a la central (Japp Manager)
CREATE TABLE IF NOT EXISTS "sync_outbox" (
  "id" BIGINT GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "entity" VARCHAR(40) NOT NULL,
  "entity_id" UUID NOT NULL,
  "operation" VARCHAR(30) NOT NULL DEFAULT 'upsert' CHECK ("operation" IN ('upsert','delete')),
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "sent_at" TIMESTAMPTZ(3),
  "attempts" SMALLINT NOT NULL DEFAULT 0,
  "last_error" VARCHAR(300),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_sync_outbox_sent_at_id" ON "sync_outbox" ("sent_at", "id");
CREATE INDEX IF NOT EXISTS "ix_sync_outbox_store_id" ON "sync_outbox" ("store_id");

-- Orden de una mesa (la transacción). En fast food, la orden FASTFOOD de cada caja
CREATE TABLE IF NOT EXISTS "orders" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "period_id" UUID REFERENCES "sales_period" ("id"),
  "status" VARCHAR(30) NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','billing','closed','cancelled')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "table_id" UUID REFERENCES "dining_table" ("id"),
  "table_name" VARCHAR(20) NOT NULL,
  "zone" VARCHAR(60),
  "price_list" VARCHAR(30) NOT NULL DEFAULT 'general' CHECK ("price_list" IN ('general','terrace')),
  "guests" SMALLINT NOT NULL DEFAULT 1,
  "note" VARCHAR(300),
  "opened_by_user_id" UUID REFERENCES "app_user" ("id"),
  "opened_by_user_name" VARCHAR(60) NOT NULL,
  "opened_by_role" VARCHAR(30) CHECK ("opened_by_role" IN ('waiter','cashier','manager','customer','system')),
  "opened_by_device" VARCHAR(40),
  "opened_by_at" TIMESTAMPTZ(3) NOT NULL,
  "last_entry_user_id" UUID REFERENCES "app_user" ("id"),
  "last_entry_user_name" VARCHAR(60),
  "last_entry_role" VARCHAR(30) CHECK ("last_entry_role" IN ('waiter','cashier','manager','customer','system')),
  "last_entry_device" VARCHAR(40),
  "last_entry_at" TIMESTAMPTZ(3),
  "last_exit_user_id" UUID REFERENCES "app_user" ("id"),
  "last_exit_user_name" VARCHAR(60),
  "last_exit_role" VARCHAR(30) CHECK ("last_exit_role" IN ('waiter','cashier','manager','customer','system')),
  "last_exit_device" VARCHAR(40),
  "last_exit_at" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3),
  "snapshot" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_orders_store_id_status" ON "orders" ("store_id", "status");
CREATE INDEX IF NOT EXISTS "ix_orders_period_id" ON "orders" ("period_id");
CREATE INDEX IF NOT EXISTS "ix_orders_table_id_status" ON "orders" ("table_id", "status");
CREATE INDEX IF NOT EXISTS "ix_orders_opened_by_user_id" ON "orders" ("opened_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_orders_last_entry_user_id" ON "orders" ("last_entry_user_id");
CREATE INDEX IF NOT EXISTS "ix_orders_last_exit_user_id" ON "orders" ("last_exit_user_id");
CREATE OR REPLACE TRIGGER "trg_orders_updated_at" BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ficha de clientes para factura completa
CREATE TABLE IF NOT EXISTS "customer_ref" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "type" VARCHAR(30) NOT NULL CHECK ("type" IN ('person','company')),
  "tax_id" VARCHAR(20) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "email" VARCHAR(120),
  "phone" VARCHAR(30),
  "street" VARCHAR(200),
  "postal_code" VARCHAR(10),
  "city" VARCHAR(80),
  "province" VARCHAR(80),
  "country" VARCHAR(2) DEFAULT 'ES',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_customer_ref_store_id_tax_id" UNIQUE ("store_id", "tax_id")
);
CREATE OR REPLACE TRIGGER "trg_customer_ref_updated_at" BEFORE UPDATE ON "customer_ref" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Cuentas de la orden (accounts[])
CREATE TABLE IF NOT EXISTS "account" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "order_id" UUID NOT NULL REFERENCES "orders" ("id") ON DELETE CASCADE,
  "name" VARCHAR(40) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','billing','paid','invoiced','cancelled')),
  "note" VARCHAR(300),
  "opened_by_user_id" UUID REFERENCES "app_user" ("id"),
  "opened_by_user_name" VARCHAR(60) NOT NULL,
  "opened_by_role" VARCHAR(30) CHECK ("opened_by_role" IN ('waiter','cashier','manager','customer','system')),
  "opened_by_device" VARCHAR(40),
  "opened_by_at" TIMESTAMPTZ(3) NOT NULL,
  "closed_by_user_id" UUID REFERENCES "app_user" ("id"),
  "closed_by_user_name" VARCHAR(60),
  "closed_by_role" VARCHAR(30) CHECK ("closed_by_role" IN ('waiter','cashier','manager','customer','system')),
  "closed_by_device" VARCHAR(40),
  "closed_by_at" TIMESTAMPTZ(3),
  "last_entry_user_id" UUID REFERENCES "app_user" ("id"),
  "last_entry_user_name" VARCHAR(60),
  "last_entry_role" VARCHAR(30) CHECK ("last_entry_role" IN ('waiter','cashier','manager','customer','system')),
  "last_entry_device" VARCHAR(40),
  "last_entry_at" TIMESTAMPTZ(3),
  "customer_id" UUID REFERENCES "customer_ref" ("id"),
  "subtotal" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "discount_total" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "total" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "paid" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "pending" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "tips" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_account_order_id" ON "account" ("order_id");
CREATE INDEX IF NOT EXISTS "ix_account_store_id" ON "account" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_account_opened_by_user_id" ON "account" ("opened_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_account_closed_by_user_id" ON "account" ("closed_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_account_last_entry_user_id" ON "account" ("last_entry_user_id");
CREATE INDEX IF NOT EXISTS "ix_account_customer_id" ON "account" ("customer_id");
CREATE OR REPLACE TRIGGER "trg_account_updated_at" BEFORE UPDATE ON "account" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Eventos de la mesa y de cada cuenta (events[])
CREATE TABLE IF NOT EXISTS "order_event" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "order_id" UUID NOT NULL REFERENCES "orders" ("id") ON DELETE CASCADE,
  "account_id" UUID REFERENCES "account" ("id") ON DELETE CASCADE,
  "type" VARCHAR(40) NOT NULL,
  "at" TIMESTAMPTZ(3) NOT NULL,
  "description" VARCHAR(400),
  "user_id" UUID REFERENCES "app_user" ("id"),
  "user_name" VARCHAR(60),
  "role" VARCHAR(30) CHECK ("role" IN ('waiter','cashier','manager','customer','system')),
  "device" VARCHAR(40),
  "origin" VARCHAR(30) CHECK ("origin" IN ('tpv','pda','qr','api')),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_order_event_order_id_at" ON "order_event" ("order_id", "at");
CREATE INDEX IF NOT EXISTS "ix_order_event_account_id" ON "order_event" ("account_id");
CREATE INDEX IF NOT EXISTS "ix_order_event_store_id" ON "order_event" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_order_event_user_id" ON "order_event" ("user_id");

-- Productos de la cuenta, también los eliminados (lines[] y deletedLines[])
CREATE TABLE IF NOT EXISTS "order_line" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "order_id" UUID NOT NULL REFERENCES "orders" ("id") ON DELETE CASCADE,
  "account_id" UUID NOT NULL REFERENCES "account" ("id") ON DELETE CASCADE,
  "product_id" UUID REFERENCES "product" ("id"),
  "plu" INTEGER NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "comment" VARCHAR(300),
  "quantity" NUMERIC(9,3) NOT NULL DEFAULT 1,
  "unit_price" NUMERIC(10,2) NOT NULL,
  "tax_rate" NUMERIC(5,2) NOT NULL,
  "tax_amount" NUMERIC(12,4),
  "net_amount" NUMERIC(12,4),
  "status" VARCHAR(30) NOT NULL DEFAULT 'pendingPrint' CHECK ("status" IN ('pendingPrint','printed','preBill','deleted')),
  "printed" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_by_user_id" UUID REFERENCES "app_user" ("id"),
  "created_by_user_name" VARCHAR(60) NOT NULL,
  "created_by_role" VARCHAR(30) CHECK ("created_by_role" IN ('waiter','cashier','manager','customer','system')),
  "created_by_device" VARCHAR(40),
  "created_by_origin" VARCHAR(30) CHECK ("created_by_origin" IN ('tpv','pda','qr','api')),
  "created_by_at" TIMESTAMPTZ(3) NOT NULL,
  "source_line_id" UUID REFERENCES "order_line" ("id"),
  "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
  "delete_reason_id" UUID REFERENCES "reason" ("id"),
  "delete_reason" VARCHAR(80),
  "deleted_by_user_id" UUID REFERENCES "app_user" ("id"),
  "deleted_by_user_name" VARCHAR(60),
  "deleted_by_role" VARCHAR(30) CHECK ("deleted_by_role" IN ('waiter','cashier','manager','customer','system')),
  "deleted_by_device" VARCHAR(40),
  "deleted_by_at" TIMESTAMPTZ(3),
  "delete_authorized_by_user_id" UUID REFERENCES "app_user" ("id"),
  "delete_authorized_by_user_name" VARCHAR(60),
  "delete_authorized_by_role" VARCHAR(30) CHECK ("delete_authorized_by_role" IN ('waiter','cashier','manager','customer','system')),
  "delete_authorized_by_device" VARCHAR(40),
  "delete_authorized_by_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_order_line_account_id_deleted" ON "order_line" ("account_id", "deleted");
CREATE INDEX IF NOT EXISTS "ix_order_line_order_id" ON "order_line" ("order_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_store_id_plu" ON "order_line" ("store_id", "plu");
CREATE INDEX IF NOT EXISTS "ix_order_line_product_id" ON "order_line" ("product_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_created_by_user_id" ON "order_line" ("created_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_source_line_id" ON "order_line" ("source_line_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_delete_reason_id" ON "order_line" ("delete_reason_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_deleted_by_user_id" ON "order_line" ("deleted_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_delete_authorized_by_user_id" ON "order_line" ("delete_authorized_by_user_id");
CREATE OR REPLACE TRIGGER "trg_order_line_updated_at" BEFORE UPDATE ON "order_line" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Respuestas de las preguntas de cada línea (modifiers[])
CREATE TABLE IF NOT EXISTS "order_line_modifier" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "line_id" UUID NOT NULL REFERENCES "order_line" ("id") ON DELETE CASCADE,
  "question_id" UUID REFERENCES "question" ("id"),
  "product_id" UUID REFERENCES "product" ("id"),
  "plu" INTEGER,
  "name" VARCHAR(80) NOT NULL,
  "quantity" NUMERIC(9,3) NOT NULL DEFAULT 1,
  "unit_price" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "tax_amount" NUMERIC(12,4),
  "net_amount" NUMERIC(12,4),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_order_line_modifier_line_id" ON "order_line_modifier" ("line_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_modifier_store_id" ON "order_line_modifier" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_modifier_question_id" ON "order_line_modifier" ("question_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_modifier_product_id" ON "order_line_modifier" ("product_id");

-- A qué impresora salió cada línea (printers[])
CREATE TABLE IF NOT EXISTS "order_line_printer" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "line_id" UUID NOT NULL REFERENCES "order_line" ("id") ON DELETE CASCADE,
  "channel_name" VARCHAR(40) NOT NULL,
  "printer_id" UUID REFERENCES "printer" ("id"),
  "printer_name" VARCHAR(40),
  "interface" VARCHAR(120),
  "printed" BOOLEAN NOT NULL DEFAULT FALSE,
  "printed_at" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_order_line_printer_line_id" ON "order_line_printer" ("line_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_printer_store_id" ON "order_line_printer" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_order_line_printer_printer_id" ON "order_line_printer" ("printer_id");

-- Descuentos aplicados a una cuenta (discounts[])
CREATE TABLE IF NOT EXISTS "account_discount" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "account_id" UUID NOT NULL REFERENCES "account" ("id") ON DELETE CASCADE,
  "discount_id" UUID REFERENCES "discount" ("id"),
  "source" VARCHAR(30) NOT NULL CHECK ("source" IN ('coupon','manual','promotion')),
  "coupon_id" VARCHAR(40),
  "coupon_code" VARCHAR(40),
  "type" VARCHAR(30) NOT NULL CHECK ("type" IN ('percentage','fixed')),
  "value" NUMERIC(10,2) NOT NULL,
  "base_amount" NUMERIC(10,2) NOT NULL,
  "amount" NUMERIC(10,2) NOT NULL,
  "reason" VARCHAR(120),
  "status" VARCHAR(30) NOT NULL DEFAULT 'applied' CHECK ("status" IN ('applied','removed')),
  "applied_by_user_id" UUID REFERENCES "app_user" ("id"),
  "applied_by_user_name" VARCHAR(60) NOT NULL,
  "applied_by_role" VARCHAR(30) CHECK ("applied_by_role" IN ('waiter','cashier','manager','customer','system')),
  "applied_by_device" VARCHAR(40),
  "applied_by_at" TIMESTAMPTZ(3) NOT NULL,
  "authorized_by_user_id" UUID REFERENCES "app_user" ("id"),
  "authorized_by_user_name" VARCHAR(60),
  "authorized_by_role" VARCHAR(30) CHECK ("authorized_by_role" IN ('waiter','cashier','manager','customer','system')),
  "authorized_by_device" VARCHAR(40),
  "authorized_by_at" TIMESTAMPTZ(3),
  "removed_by_user_id" UUID REFERENCES "app_user" ("id"),
  "removed_by_user_name" VARCHAR(60),
  "removed_by_role" VARCHAR(30) CHECK ("removed_by_role" IN ('waiter','cashier','manager','customer','system')),
  "removed_by_device" VARCHAR(40),
  "removed_by_at" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_account_discount_account_id" ON "account_discount" ("account_id");
CREATE INDEX IF NOT EXISTS "ix_account_discount_store_id" ON "account_discount" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_account_discount_discount_id" ON "account_discount" ("discount_id");
CREATE INDEX IF NOT EXISTS "ix_account_discount_applied_by_user_id" ON "account_discount" ("applied_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_account_discount_authorized_by_user_id" ON "account_discount" ("authorized_by_user_id");
CREATE INDEX IF NOT EXISTS "ix_account_discount_removed_by_user_id" ON "account_discount" ("removed_by_user_id");

-- Pagos de una cuenta (payments[])
CREATE TABLE IF NOT EXISTS "payment" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "account_id" UUID NOT NULL REFERENCES "account" ("id") ON DELETE CASCADE,
  "payment_method_id" UUID REFERENCES "payment_method" ("id"),
  "method" VARCHAR(30) NOT NULL CHECK ("method" IN ('cash','card','bizum','voucher','invitation','platform')),
  "amount" NUMERIC(10,2) NOT NULL,
  "tip" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "cash_given" NUMERIC(10,2),
  "change_given" NUMERIC(10,2),
  "status" VARCHAR(30) NOT NULL CHECK ("status" IN ('pending','confirmed','declined','refunded','cancelled')),
  "station_id" UUID REFERENCES "station" ("id"),
  "collected_by_user_id" UUID REFERENCES "app_user" ("id"),
  "collected_by_user_name" VARCHAR(60) NOT NULL,
  "collected_by_role" VARCHAR(30) CHECK ("collected_by_role" IN ('waiter','cashier','manager','customer','system')),
  "collected_by_device" VARCHAR(40),
  "collected_by_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_payment_account_id" ON "payment" ("account_id");
CREATE INDEX IF NOT EXISTS "ix_payment_store_id_collected_by_at" ON "payment" ("store_id", "collected_by_at");
CREATE INDEX IF NOT EXISTS "ix_payment_payment_method_id" ON "payment" ("payment_method_id");
CREATE INDEX IF NOT EXISTS "ix_payment_station_id" ON "payment" ("station_id");
CREATE INDEX IF NOT EXISTS "ix_payment_collected_by_user_id" ON "payment" ("collected_by_user_id");

-- Billetes y monedas recibidos y devueltos (cashDetail)
CREATE TABLE IF NOT EXISTS "payment_cash_detail" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "payment_id" UUID NOT NULL REFERENCES "payment" ("id") ON DELETE CASCADE,
  "direction" VARCHAR(30) NOT NULL CHECK ("direction" IN ('received','returned')),
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('bill','coin')),
  "value" NUMERIC(10,2) NOT NULL,
  "quantity" SMALLINT NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ix_payment_cash_detail_payment_id" ON "payment_cash_detail" ("payment_id");
CREATE INDEX IF NOT EXISTS "ix_payment_cash_detail_store_id" ON "payment_cash_detail" ("store_id");

-- Respuesta del datáfono o del banco (bankData)
CREATE TABLE IF NOT EXISTS "payment_bank_data" (
  "payment_id" UUID NOT NULL REFERENCES "payment" ("id") ON DELETE CASCADE,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "provider" VARCHAR(40),
  "merchant_id" VARCHAR(40),
  "terminal_id" VARCHAR(40),
  "transaction_id" VARCHAR(60),
  "authorization_code" VARCHAR(20),
  "response_code" VARCHAR(10),
  "response_message" VARCHAR(120),
  "card_brand" VARCHAR(20),
  "masked_pan" VARCHAR(30),
  "entry_mode" VARCHAR(20),
  "masked_phone" VARCHAR(30),
  "amount" NUMERIC(10,2),
  "currency" VARCHAR(3),
  "processed_at" TIMESTAMPTZ(3),
  PRIMARY KEY ("payment_id")
);
CREATE INDEX IF NOT EXISTS "ix_payment_bank_data_store_id" ON "payment_bank_data" ("store_id");

-- Numeración de cada serie (sin huecos)
CREATE TABLE IF NOT EXISTS "invoice_series" (
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "series" VARCHAR(20) NOT NULL,
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('F1','F2','R1')),
  "last_sequence" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("store_id", "series")
);
CREATE OR REPLACE TRIGGER "trg_invoice_series_updated_at" BEFORE UPDATE ON "invoice_series" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Facturas emitidas (accounts[].invoice). Inmutables
CREATE TABLE IF NOT EXISTS "invoice" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "account_id" UUID REFERENCES "account" ("id"),
  "order_id" UUID REFERENCES "orders" ("id"),
  "type" VARCHAR(30) NOT NULL CHECK ("type" IN ('F1','F2','R1')),
  "series" VARCHAR(20) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "invoice_number" VARCHAR(40) NOT NULL,
  "issued_at" TIMESTAMPTZ(3) NOT NULL,
  "issuer_tax_id" VARCHAR(20) NOT NULL,
  "issuer_name" VARCHAR(120) NOT NULL,
  "customer_id" UUID REFERENCES "customer_ref" ("id"),
  "customer_type" VARCHAR(30) CHECK ("customer_type" IN ('person','company')),
  "customer_tax_id" VARCHAR(20),
  "customer_name" VARCHAR(120),
  "customer_email" VARCHAR(120),
  "customer_phone" VARCHAR(30),
  "customer_street" VARCHAR(200),
  "customer_postal_code" VARCHAR(10),
  "customer_city" VARCHAR(80),
  "customer_province" VARCHAR(80),
  "customer_country" VARCHAR(2),
  "tax_base" NUMERIC(10,2) NOT NULL,
  "tax_total" NUMERIC(10,2) NOT NULL,
  "total" NUMERIC(10,2) NOT NULL,
  "rectified_invoice_id" UUID REFERENCES "invoice" ("id"),
  "rectification_reason" VARCHAR(200),
  "verifactu_qr" VARCHAR(400),
  "status" VARCHAR(30) NOT NULL DEFAULT 'issued' CHECK ("status" IN ('issued','rectified','cancelled')),
  "issued_by_user_id" UUID REFERENCES "app_user" ("id"),
  "issued_by_user_name" VARCHAR(60) NOT NULL,
  "issued_by_role" VARCHAR(30) CHECK ("issued_by_role" IN ('waiter','cashier','manager','customer','system')),
  "issued_by_device" VARCHAR(40),
  "issued_by_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_invoice_store_id_series_sequence" UNIQUE ("store_id", "series", "sequence"),
  CONSTRAINT "uq_invoice_invoice_number_store_id" UNIQUE ("invoice_number", "store_id")
);
CREATE INDEX IF NOT EXISTS "ix_invoice_account_id" ON "invoice" ("account_id");
CREATE INDEX IF NOT EXISTS "ix_invoice_store_id_issued_at" ON "invoice" ("store_id", "issued_at");
CREATE INDEX IF NOT EXISTS "ix_invoice_order_id" ON "invoice" ("order_id");
CREATE INDEX IF NOT EXISTS "ix_invoice_customer_id" ON "invoice" ("customer_id");
CREATE INDEX IF NOT EXISTS "ix_invoice_rectified_invoice_id" ON "invoice" ("rectified_invoice_id");
CREATE INDEX IF NOT EXISTS "ix_invoice_issued_by_user_id" ON "invoice" ("issued_by_user_id");

-- Desglose de impuestos de la factura
CREATE TABLE IF NOT EXISTS "invoice_tax" (
  "invoice_id" UUID NOT NULL REFERENCES "invoice" ("id") ON DELETE CASCADE,
  "rate" NUMERIC(5,2) NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "base" NUMERIC(10,2) NOT NULL,
  "tax" NUMERIC(10,2) NOT NULL,
  PRIMARY KEY ("invoice_id", "rate")
);
CREATE INDEX IF NOT EXISTS "ix_invoice_tax_store_id" ON "invoice_tax" ("store_id");

-- Registro VeriFactu: alta o anulación con huella encadenada y envío a la AEAT
CREATE TABLE IF NOT EXISTS "verifactu_record" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "invoice_id" UUID NOT NULL REFERENCES "invoice" ("id"),
  "record_type" VARCHAR(30) NOT NULL DEFAULT 'alta' CHECK ("record_type" IN ('alta','anulacion')),
  "issuer_tax_id" VARCHAR(20) NOT NULL,
  "invoice_number" VARCHAR(40) NOT NULL,
  "issued_on" DATE NOT NULL,
  "invoice_type" VARCHAR(30) NOT NULL CHECK ("invoice_type" IN ('F1','F2','R1')),
  "tax_total" NUMERIC(10,2) NOT NULL,
  "total" NUMERIC(10,2) NOT NULL,
  "previous_record_id" UUID REFERENCES "verifactu_record" ("id"),
  "previous_hash" VARCHAR(64),
  "hash" VARCHAR(64) NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','sent','accepted','accepted_with_errors','rejected')),
  "aeat_csv" VARCHAR(40),
  "aeat_response" TEXT,
  "sent_at" TIMESTAMPTZ(3),
  "attempts" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_verifactu_record_hash" UNIQUE ("hash"),
  CONSTRAINT "uq_verifactu_record_issuer_tax_id_invoice_number_record_type" UNIQUE ("issuer_tax_id", "invoice_number", "record_type")
);
CREATE INDEX IF NOT EXISTS "ix_verifactu_record_store_id_status" ON "verifactu_record" ("store_id", "status");
CREATE INDEX IF NOT EXISTS "ix_verifactu_record_issuer_tax_id_generated_at" ON "verifactu_record" ("issuer_tax_id", "generated_at");
CREATE INDEX IF NOT EXISTS "ix_verifactu_record_invoice_id" ON "verifactu_record" ("invoice_id");
CREATE INDEX IF NOT EXISTS "ix_verifactu_record_previous_record_id" ON "verifactu_record" ("previous_record_id");

-- Comentarios
COMMENT ON TABLE "company" IS 'Empresa (razón social y NIF del emisor de las facturas)';
COMMENT ON COLUMN "company"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "company"."legal_name" IS 'Razón social';
COMMENT ON COLUMN "company"."trade_name" IS 'Nombre comercial';
COMMENT ON COLUMN "company"."tax_id" IS 'NIF / CIF';
COMMENT ON COLUMN "company"."address" IS 'Dirección fiscal';
COMMENT ON COLUMN "company"."country" IS 'País';
COMMENT ON COLUMN "company"."maxpoint_cdn_id" IS 'Código de cadena en MaxPoint (cdn_id)';
COMMENT ON COLUMN "company"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "company"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "store" IS 'Restaurante / local (Ajustes › Restaurante)';
COMMENT ON COLUMN "store"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "store"."company_id" IS 'Empresa';
COMMENT ON COLUMN "store"."code" IS 'Código del local (CT 03)';
COMMENT ON COLUMN "store"."name" IS 'Nombre';
COMMENT ON COLUMN "store"."service_type" IS 'Tipo de servicio: a la mesa o fast food (mostrador)';
COMMENT ON COLUMN "store"."address" IS 'Dirección';
COMMENT ON COLUMN "store"."city" IS 'Ciudad';
COMMENT ON COLUMN "store"."phone" IS 'Teléfono';
COMMENT ON COLUMN "store"."opening_hours" IS 'Horario';
COMMENT ON COLUMN "store"."reviews_url" IS 'Enlace de reseñas de Google';
COMMENT ON COLUMN "store"."logo_url" IS 'Logo del local';
COMMENT ON COLUMN "store"."ticket_header" IS 'Cabecera del ticket';
COMMENT ON COLUMN "store"."ticket_footer" IS 'Pie del ticket';
COMMENT ON COLUMN "store"."maxpoint_rst_id" IS 'Código de restaurante en MaxPoint (rst_id)';
COMMENT ON COLUMN "store"."server_url" IS 'Dominio del servidor (por defecto https://japp.grupocyt.com.es/)';
COMMENT ON COLUMN "store"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "store"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "store"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "billing_settings" IS 'Facturación del local: series, establecimiento y punto de emisión';
COMMENT ON COLUMN "billing_settings"."store_id" IS 'Local';
COMMENT ON COLUMN "billing_settings"."billing_email" IS 'Email de facturación';
COMMENT ON COLUMN "billing_settings"."establishment" IS 'Establecimiento (003)';
COMMENT ON COLUMN "billing_settings"."emission_point" IS 'Punto de emisión (050)';
COMMENT ON COLUMN "billing_settings"."series_simplified" IS 'Serie simplificada F2 (T2026)';
COMMENT ON COLUMN "billing_settings"."series_full" IS 'Serie completa F1 (F2026)';
COMMENT ON COLUMN "billing_settings"."series_credit" IS 'Serie de abonos R (AB2026)';
COMMENT ON COLUMN "billing_settings"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "billing_settings"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "store_parameters" IS 'Parámetros del local (Ajustes › Parámetros)';
COMMENT ON COLUMN "store_parameters"."store_id" IS 'Local';
COMMENT ON COLUMN "store_parameters"."lock_seconds" IS 'Bloqueo por inactividad en escritorio (s, 0 = nunca)';
COMMENT ON COLUMN "store_parameters"."lock_seconds_pda" IS 'Bloqueo por inactividad en PDA (s, 0 = nunca)';
COMMENT ON COLUMN "store_parameters"."duplicate_minutes" IS 'Aviso de doble marcado (min, 0 = no avisar)';
COMMENT ON COLUMN "store_parameters"."cash_float" IS 'Fondo de caja por defecto';
COMMENT ON COLUMN "store_parameters"."cash_diff_threshold" IS 'Diferencia de arqueo que hay que justificar';
COMMENT ON COLUMN "store_parameters"."idle_table_minutes" IS 'Aviso de mesa sin movimiento (min)';
COMMENT ON COLUMN "store_parameters"."prebill_to_pay_minutes" IS 'Aviso de precuenta a cobro (min)';
COMMENT ON COLUMN "store_parameters"."kpi_min_tables" IS 'Mínimo de mesas para la nota de KPI';
COMMENT ON COLUMN "store_parameters"."pin_attempts" IS 'Intentos de clave antes de bloquear';
COMMENT ON COLUMN "store_parameters"."pin_lock_seconds" IS 'Segundos de bloqueo del teclado';
COMMENT ON COLUMN "store_parameters"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "store_parameters"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "user_profile" IS 'Perfiles (Administrador, Cajero, Mesero…)';
COMMENT ON COLUMN "user_profile"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "user_profile"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "user_profile"."code" IS 'Código (ADMIN, CAJERO, MESERO)';
COMMENT ON COLUMN "user_profile"."name" IS 'Nombre';
COMMENT ON COLUMN "user_profile"."level" IS 'Nivel (100 = administrador)';
COMMENT ON COLUMN "user_profile"."color" IS 'Color del perfil en pantalla';
COMMENT ON COLUMN "user_profile"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "user_profile"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "user_profile"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "permission" IS 'Catálogo de permisos por módulo y por botón (global, igual en todos los locales)';
COMMENT ON COLUMN "permission"."code" IS 'Código (pedido.enviar, ajustes.productos…)';
COMMENT ON COLUMN "permission"."module" IS 'Módulo (Mesas, Pedido, Cobro, Funciones, Ajustes, Sistema)';
COMMENT ON COLUMN "permission"."name" IS 'Nombre del permiso';
COMMENT ON COLUMN "permission"."sort_order" IS 'Orden en pantalla';
COMMENT ON TABLE "profile_permission" IS 'Permisos concedidos a cada perfil';
COMMENT ON COLUMN "profile_permission"."profile_id" IS 'Perfil';
COMMENT ON COLUMN "profile_permission"."permission_code" IS 'Permiso';
COMMENT ON COLUMN "profile_permission"."store_id" IS 'Local al que pertenece';
COMMENT ON TABLE "app_user" IS 'Usuarios del TPV (entran con clave de 4 cifras)';
COMMENT ON COLUMN "app_user"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "app_user"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "app_user"."name" IS 'Nombre';
COMMENT ON COLUMN "app_user"."initials" IS 'Iniciales';
COMMENT ON COLUMN "app_user"."profile_id" IS 'Perfil';
COMMENT ON COLUMN "app_user"."pin_hash" IS 'Clave de 4 cifras con bcrypt (nunca en claro)';
COMMENT ON COLUMN "app_user"."can_charge" IS 'Puede cobrar (NULL = lo que diga el perfil)';
COMMENT ON COLUMN "app_user"."can_delete_printed" IS 'Puede eliminar productos impresos (NULL = perfil)';
COMMENT ON COLUMN "app_user"."can_delete_prebill" IS 'Puede eliminar con precuenta (NULL = perfil)';
COMMENT ON COLUMN "app_user"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "app_user"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "app_user"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "area" IS 'Áreas o planos (BARRA, TERRAZA…)';
COMMENT ON COLUMN "area"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "area"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "area"."name" IS 'Nombre';
COMMENT ON COLUMN "area"."sort_order" IS 'Orden';
COMMENT ON COLUMN "area"."price_list" IS 'Precio a utilizar: PVP general o PVP terraza';
COMMENT ON COLUMN "area"."table_number_from" IS 'Las mesas se numeran desde';
COMMENT ON COLUMN "area"."plan_width" IS 'Ancho del plano';
COMMENT ON COLUMN "area"."plan_height" IS 'Alto del plano';
COMMENT ON COLUMN "area"."plan_image_url" IS 'Foto del plano (opcional)';
COMMENT ON COLUMN "area"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "area"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "area"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "area_drawing" IS 'Lo dibujado en Editar sala: paredes, bloques, elementos y textos';
COMMENT ON COLUMN "area_drawing"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "area_drawing"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "area_drawing"."area_id" IS 'Área';
COMMENT ON COLUMN "area_drawing"."kind" IS 'Tipo';
COMMENT ON COLUMN "area_drawing"."x1" IS 'Posición x (inicio)';
COMMENT ON COLUMN "area_drawing"."y1" IS 'Posición y (inicio)';
COMMENT ON COLUMN "area_drawing"."x2" IS 'Posición x (fin, paredes y bloques)';
COMMENT ON COLUMN "area_drawing"."y2" IS 'Posición y (fin)';
COMMENT ON COLUMN "area_drawing"."item" IS 'Elemento: planta, impresora, baños, grifo, salida, cocina, escaleras, caja';
COMMENT ON COLUMN "area_drawing"."label" IS 'Texto';
COMMENT ON COLUMN "area_drawing"."sort_order" IS 'Orden de dibujo';
COMMENT ON TABLE "dining_table" IS 'Mesas';
COMMENT ON COLUMN "dining_table"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "dining_table"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "dining_table"."area_id" IS 'Área';
COMMENT ON COLUMN "dining_table"."number" IS 'Número de mesa (1, 100…)';
COMMENT ON COLUMN "dining_table"."capacity" IS 'Capacidad';
COMMENT ON COLUMN "dining_table"."pos_x" IS 'Posición x en el plano';
COMMENT ON COLUMN "dining_table"."pos_y" IS 'Posición y en el plano';
COMMENT ON COLUMN "dining_table"."width" IS 'Ancho';
COMMENT ON COLUMN "dining_table"."height" IS 'Alto';
COMMENT ON COLUMN "dining_table"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "dining_table"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "dining_table"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "tax" IS 'Impuestos (IVA 10 %)';
COMMENT ON COLUMN "tax"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "tax"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "tax"."name" IS 'Nombre';
COMMENT ON COLUMN "tax"."rate" IS 'Porcentaje';
COMMENT ON COLUMN "tax"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "tax"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "tax"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "category" IS 'Categorías de la toma de pedido';
COMMENT ON COLUMN "category"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "category"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "category"."name" IS 'Nombre';
COMMENT ON COLUMN "category"."bg_color" IS 'Color de la tecla';
COMMENT ON COLUMN "category"."fg_color" IS 'Color del texto';
COMMENT ON COLUMN "category"."sort_order" IS 'Orden (se arrastra en Ajustes)';
COMMENT ON COLUMN "category"."hidden" IS 'Oculta (p. ej. MODIFICADORES, solo respuestas)';
COMMENT ON COLUMN "category"."maxpoint_id" IS 'Id en MaxPoint';
COMMENT ON COLUMN "category"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "category"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "category"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "product" IS 'Productos (PLU) con PVP general y PVP terraza';
COMMENT ON COLUMN "product"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "product"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "product"."plu" IS 'PLU de MaxPoint';
COMMENT ON COLUMN "product"."name" IS 'Nombre en la tecla';
COMMENT ON COLUMN "product"."ticket_name" IS 'Nombre en el ticket';
COMMENT ON COLUMN "product"."category_id" IS 'Categoría principal';
COMMENT ON COLUMN "product"."price" IS 'PVP general (IVA incluido)';
COMMENT ON COLUMN "product"."price_terrace" IS 'PVP terraza (NULL = se usa el general)';
COMMENT ON COLUMN "product"."tax_id" IS 'Impuesto';
COMMENT ON COLUMN "product"."bg_color" IS 'Color de la tecla';
COMMENT ON COLUMN "product"."fg_color" IS 'Color del texto';
COMMENT ON COLUMN "product"."answer_only" IS 'Solo se usa como respuesta de una pregunta';
COMMENT ON COLUMN "product"."sold_out" IS 'Agotado';
COMMENT ON COLUMN "product"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "product"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "product"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "category_product" IS 'Teclas: qué producto sale en cada categoría y dónde';
COMMENT ON COLUMN "category_product"."category_id" IS 'Categoría';
COMMENT ON COLUMN "category_product"."product_id" IS 'Producto';
COMMENT ON COLUMN "category_product"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "category_product"."label" IS 'Texto de la tecla';
COMMENT ON COLUMN "category_product"."bg_color" IS 'Color de la tecla';
COMMENT ON COLUMN "category_product"."fg_color" IS 'Color del texto';
COMMENT ON COLUMN "category_product"."pos_x" IS 'Columna';
COMMENT ON COLUMN "category_product"."pos_y" IS 'Fila';
COMMENT ON TABLE "question" IS 'Preguntas (opciones del producto: leche, punto, menú…)';
COMMENT ON COLUMN "question"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "question"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "question"."name" IS 'Pregunta';
COMMENT ON COLUMN "question"."min_answers" IS 'Mínimo de respuestas (0 = opcional)';
COMMENT ON COLUMN "question"."max_answers" IS 'Máximo de respuestas';
COMMENT ON COLUMN "question"."maxpoint_id" IS 'Id en MaxPoint';
COMMENT ON COLUMN "question"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "question"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "question"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "question_answer" IS 'Respuestas de una pregunta (cada respuesta es un producto)';
COMMENT ON COLUMN "question_answer"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "question_answer"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "question_answer"."question_id" IS 'Pregunta';
COMMENT ON COLUMN "question_answer"."product_id" IS 'Producto respuesta';
COMMENT ON COLUMN "question_answer"."label" IS 'Texto de la respuesta';
COMMENT ON COLUMN "question_answer"."extra_price" IS 'Suplemento (0 = sin suplemento)';
COMMENT ON COLUMN "question_answer"."bg_color" IS 'Color';
COMMENT ON COLUMN "question_answer"."fg_color" IS 'Color del texto';
COMMENT ON COLUMN "question_answer"."sort_order" IS 'Orden';
COMMENT ON TABLE "product_question" IS 'Preguntas que hace cada producto';
COMMENT ON COLUMN "product_question"."product_id" IS 'Producto';
COMMENT ON COLUMN "product_question"."question_id" IS 'Pregunta';
COMMENT ON COLUMN "product_question"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "product_question"."sort_order" IS 'Orden';
COMMENT ON TABLE "print_channel" IS 'Canales de impresión (BARRA, cocina…)';
COMMENT ON COLUMN "print_channel"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "print_channel"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "print_channel"."name" IS 'Nombre';
COMMENT ON COLUMN "print_channel"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "print_channel"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "print_channel"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "product_channel" IS 'Por qué canal sale cada producto';
COMMENT ON COLUMN "product_channel"."product_id" IS 'Producto';
COMMENT ON COLUMN "product_channel"."channel_id" IS 'Canal';
COMMENT ON COLUMN "product_channel"."store_id" IS 'Local al que pertenece';
COMMENT ON TABLE "printer" IS 'Impresoras';
COMMENT ON COLUMN "printer"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "printer"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "printer"."name" IS 'Nombre';
COMMENT ON COLUMN "printer"."connection" IS 'Conexión (tcp://10.221.11.32, USB…)';
COMMENT ON COLUMN "printer"."model" IS 'Modelo';
COMMENT ON COLUMN "printer"."kind" IS 'Tipo';
COMMENT ON COLUMN "printer"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "printer"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "printer"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "station" IS 'Estaciones (cajas) y PDA (comanderos)';
COMMENT ON COLUMN "station"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "station"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "station"."name" IS 'Nombre (CAJA1, PDA1)';
COMMENT ON COLUMN "station"."kind" IS 'Estación o PDA';
COMMENT ON COLUMN "station"."device_uuid" IS 'UUID del equipo asociado';
COMMENT ON COLUMN "station"."ip" IS 'IP';
COMMENT ON COLUMN "station"."emission_point" IS 'Punto de emisión';
COMMENT ON COLUMN "station"."opens_drawer" IS 'Abre cajón al cobrar';
COMMENT ON COLUMN "station"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "station"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "station"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "station_channel_printer" IS 'En cada estación, por qué impresora sale cada canal';
COMMENT ON COLUMN "station_channel_printer"."station_id" IS 'Estación';
COMMENT ON COLUMN "station_channel_printer"."channel_id" IS 'Canal';
COMMENT ON COLUMN "station_channel_printer"."printer_id" IS 'Impresora';
COMMENT ON COLUMN "station_channel_printer"."store_id" IS 'Local al que pertenece';
COMMENT ON TABLE "payment_method" IS 'Formas de pago';
COMMENT ON COLUMN "payment_method"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "payment_method"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "payment_method"."code" IS 'Código (cash, card…)';
COMMENT ON COLUMN "payment_method"."name" IS 'Nombre';
COMMENT ON COLUMN "payment_method"."kind" IS 'Tipo';
COMMENT ON COLUMN "payment_method"."opens_drawer" IS 'Abre cajón';
COMMENT ON COLUMN "payment_method"."allows_tip" IS 'Admite propina';
COMMENT ON COLUMN "payment_method"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "payment_method"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "payment_method"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "station_payment_method" IS 'Formas de pago activas en cada estación o PDA';
COMMENT ON COLUMN "station_payment_method"."station_id" IS 'Estación';
COMMENT ON COLUMN "station_payment_method"."payment_method_id" IS 'Forma de pago';
COMMENT ON COLUMN "station_payment_method"."store_id" IS 'Local al que pertenece';
COMMENT ON TABLE "discount" IS 'Descuentos configurados';
COMMENT ON COLUMN "discount"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "discount"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "discount"."name" IS 'Nombre';
COMMENT ON COLUMN "discount"."percent" IS 'Porcentaje';
COMMENT ON COLUMN "discount"."valid_from" IS 'Vigente desde';
COMMENT ON COLUMN "discount"."valid_to" IS 'Vigente hasta';
COMMENT ON COLUMN "discount"."needs_authorization" IS 'Pide autorización de encargado';
COMMENT ON COLUMN "discount"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "discount"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "discount"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "station_discount" IS 'Descuentos activos en cada estación o PDA';
COMMENT ON COLUMN "station_discount"."station_id" IS 'Estación';
COMMENT ON COLUMN "station_discount"."discount_id" IS 'Descuento';
COMMENT ON COLUMN "station_discount"."store_id" IS 'Local al que pertenece';
COMMENT ON TABLE "reason" IS 'Motivos de eliminación, retiro de caja y abono';
COMMENT ON COLUMN "reason"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "reason"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "reason"."name" IS 'Motivo';
COMMENT ON COLUMN "reason"."kind" IS 'Para qué se usa';
COMMENT ON COLUMN "reason"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "reason"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "reason"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "sales_period" IS 'Periodos de venta (uno abierto por local)';
COMMENT ON COLUMN "sales_period"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "sales_period"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "sales_period"."status" IS 'Estado';
COMMENT ON COLUMN "sales_period"."opened_by_user_id" IS 'Abierto por: usuario';
COMMENT ON COLUMN "sales_period"."opened_by_user_name" IS 'Abierto por: nombre (copia)';
COMMENT ON COLUMN "sales_period"."opened_by_role" IS 'Abierto por: rol';
COMMENT ON COLUMN "sales_period"."opened_by_device" IS 'Abierto por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "sales_period"."opened_by_at" IS 'Abierto por: fecha y hora';
COMMENT ON COLUMN "sales_period"."station_id" IS 'Estación donde se abrió';
COMMENT ON COLUMN "sales_period"."closed_by_user_id" IS 'Cerrado por: usuario';
COMMENT ON COLUMN "sales_period"."closed_by_user_name" IS 'Cerrado por: nombre (copia)';
COMMENT ON COLUMN "sales_period"."closed_by_role" IS 'Cerrado por: rol';
COMMENT ON COLUMN "sales_period"."closed_by_device" IS 'Cerrado por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "sales_period"."closed_by_at" IS 'Cerrado por: fecha y hora';
COMMENT ON COLUMN "sales_period"."open_flag" IS '1 mientras está abierto (garantiza un solo periodo abierto)';
COMMENT ON TABLE "cash_movement" IS 'Movimientos de caja: fondo, retiros, arqueos y depósitos';
COMMENT ON COLUMN "cash_movement"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "cash_movement"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "cash_movement"."period_id" IS 'Periodo';
COMMENT ON COLUMN "cash_movement"."station_id" IS 'Estación';
COMMENT ON COLUMN "cash_movement"."kind" IS 'Tipo de movimiento';
COMMENT ON COLUMN "cash_movement"."amount" IS 'Importe';
COMMENT ON COLUMN "cash_movement"."reason_id" IS 'Motivo';
COMMENT ON COLUMN "cash_movement"."note" IS 'Comentario';
COMMENT ON COLUMN "cash_movement"."counted_detail" IS 'Billetes y monedas contados (arqueo)';
COMMENT ON COLUMN "cash_movement"."by_user_id" IS 'Hecho por: usuario';
COMMENT ON COLUMN "cash_movement"."by_user_name" IS 'Hecho por: nombre (copia)';
COMMENT ON COLUMN "cash_movement"."by_role" IS 'Hecho por: rol';
COMMENT ON COLUMN "cash_movement"."by_device" IS 'Hecho por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "cash_movement"."by_at" IS 'Hecho por: fecha y hora';
COMMENT ON COLUMN "cash_movement"."authorized_by" IS 'Autorizado por';
COMMENT ON TABLE "cash_closing" IS 'Cierre de periodo y arqueo final';
COMMENT ON COLUMN "cash_closing"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "cash_closing"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "cash_closing"."period_id" IS 'Periodo';
COMMENT ON COLUMN "cash_closing"."counted_cash" IS 'Efectivo contado';
COMMENT ON COLUMN "cash_closing"."counted_card" IS 'Tarjeta según datáfono';
COMMENT ON COLUMN "cash_closing"."expected_cash" IS 'Efectivo que debería haber';
COMMENT ON COLUMN "cash_closing"."difference" IS 'Diferencia';
COMMENT ON COLUMN "cash_closing"."next_float" IS 'Fondo para el siguiente periodo';
COMMENT ON COLUMN "cash_closing"."deposit" IS 'Depósito';
COMMENT ON COLUMN "cash_closing"."gross_sales" IS 'Venta total';
COMMENT ON COLUMN "cash_closing"."guests" IS 'Comensales';
COMMENT ON COLUMN "cash_closing"."by_user_id" IS 'Cerrado por: usuario';
COMMENT ON COLUMN "cash_closing"."by_user_name" IS 'Cerrado por: nombre (copia)';
COMMENT ON COLUMN "cash_closing"."by_role" IS 'Cerrado por: rol';
COMMENT ON COLUMN "cash_closing"."by_device" IS 'Cerrado por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "cash_closing"."by_at" IS 'Cerrado por: fecha y hora';
COMMENT ON COLUMN "cash_closing"."authorized_by" IS 'Autorizado por';
COMMENT ON TABLE "config_change_log" IS 'Historial de cambios de Ajustes (se envía a Japp Manager)';
COMMENT ON COLUMN "config_change_log"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "config_change_log"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "config_change_log"."at" IS 'Fecha y hora';
COMMENT ON COLUMN "config_change_log"."user_id" IS 'Usuario';
COMMENT ON COLUMN "config_change_log"."user_name" IS 'Usuario (copia)';
COMMENT ON COLUMN "config_change_log"."module" IS 'Módulo de Ajustes';
COMMENT ON COLUMN "config_change_log"."action" IS 'Acción';
COMMENT ON COLUMN "config_change_log"."record_name" IS 'Registro';
COMMENT ON COLUMN "config_change_log"."diff" IS 'Qué cambió';
COMMENT ON COLUMN "config_change_log"."synced_at" IS 'Enviado a Japp Manager (NULL = pendiente)';
COMMENT ON TABLE "incident_request" IS 'Requerimientos enviados a Marketing con las incidencias';
COMMENT ON COLUMN "incident_request"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "incident_request"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "incident_request"."code" IS 'Número de requerimiento';
COMMENT ON COLUMN "incident_request"."trigger_kind" IS 'Al cerrar periodo o a mano';
COMMENT ON COLUMN "incident_request"."sent_at" IS 'Enviado';
COMMENT ON COLUMN "incident_request"."sent_by" IS 'Enviado por';
COMMENT ON TABLE "product_incident" IS 'Incidencias: cambios de productos hechos en el local';
COMMENT ON COLUMN "product_incident"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "product_incident"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "product_incident"."code" IS 'INC-0001';
COMMENT ON COLUMN "product_incident"."at" IS 'Fecha y hora';
COMMENT ON COLUMN "product_incident"."user_name" IS 'Usuario';
COMMENT ON COLUMN "product_incident"."product_id" IS 'Producto';
COMMENT ON COLUMN "product_incident"."product_name" IS 'Producto (copia)';
COMMENT ON COLUMN "product_incident"."action" IS 'Alta, cambio, baja, activar, agotado';
COMMENT ON COLUMN "product_incident"."diff" IS 'Qué cambió';
COMMENT ON COLUMN "product_incident"."status" IS 'Estado';
COMMENT ON COLUMN "product_incident"."request_id" IS 'Requerimiento en el que se envió';
COMMENT ON TABLE "sync_outbox" IS 'Cola de envío del local a la central (Japp Manager)';
COMMENT ON COLUMN "sync_outbox"."id" IS 'Secuencia';
COMMENT ON COLUMN "sync_outbox"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "sync_outbox"."entity" IS 'Tabla o entidad (orders, invoice, config…)';
COMMENT ON COLUMN "sync_outbox"."entity_id" IS 'Id del registro';
COMMENT ON COLUMN "sync_outbox"."operation" IS 'Operación';
COMMENT ON COLUMN "sync_outbox"."payload" IS 'Datos a enviar';
COMMENT ON COLUMN "sync_outbox"."created_at" IS 'Encolado';
COMMENT ON COLUMN "sync_outbox"."sent_at" IS 'Enviado (NULL = pendiente)';
COMMENT ON COLUMN "sync_outbox"."attempts" IS 'Intentos';
COMMENT ON COLUMN "sync_outbox"."last_error" IS 'Último error';
COMMENT ON TABLE "orders" IS 'Orden de una mesa (la transacción). En fast food, la orden FASTFOOD de cada caja';
COMMENT ON COLUMN "orders"."id" IS 'Id de la transacción (_id)';
COMMENT ON COLUMN "orders"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "orders"."period_id" IS 'Periodo de venta';
COMMENT ON COLUMN "orders"."status" IS 'Estado (status)';
COMMENT ON COLUMN "orders"."version" IS 'Versión para concurrencia optimista (version)';
COMMENT ON COLUMN "orders"."table_id" IS 'Mesa (NULL en fast food)';
COMMENT ON COLUMN "orders"."table_name" IS 'Nombre de la mesa (tableData.name)';
COMMENT ON COLUMN "orders"."zone" IS 'Zona (tableData.zone)';
COMMENT ON COLUMN "orders"."price_list" IS 'Precio aplicado al abrir';
COMMENT ON COLUMN "orders"."guests" IS 'Comensales (tableData.guests)';
COMMENT ON COLUMN "orders"."note" IS 'Nota de la mesa (tableData.note)';
COMMENT ON COLUMN "orders"."opened_by_user_id" IS 'Abierta por: usuario';
COMMENT ON COLUMN "orders"."opened_by_user_name" IS 'Abierta por: nombre (copia)';
COMMENT ON COLUMN "orders"."opened_by_role" IS 'Abierta por: rol';
COMMENT ON COLUMN "orders"."opened_by_device" IS 'Abierta por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "orders"."opened_by_at" IS 'Abierta por: fecha y hora';
COMMENT ON COLUMN "orders"."last_entry_user_id" IS 'Última entrada: usuario';
COMMENT ON COLUMN "orders"."last_entry_user_name" IS 'Última entrada: nombre (copia)';
COMMENT ON COLUMN "orders"."last_entry_role" IS 'Última entrada: rol';
COMMENT ON COLUMN "orders"."last_entry_device" IS 'Última entrada: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "orders"."last_entry_at" IS 'Última entrada: fecha y hora';
COMMENT ON COLUMN "orders"."last_exit_user_id" IS 'Última salida: usuario';
COMMENT ON COLUMN "orders"."last_exit_user_name" IS 'Última salida: nombre (copia)';
COMMENT ON COLUMN "orders"."last_exit_role" IS 'Última salida: rol';
COMMENT ON COLUMN "orders"."last_exit_device" IS 'Última salida: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "orders"."last_exit_at" IS 'Última salida: fecha y hora';
COMMENT ON COLUMN "orders"."closed_at" IS 'Cierre de la mesa';
COMMENT ON COLUMN "orders"."snapshot" IS 'JSON completo de la orden al cerrarla (copia de auditoría)';
COMMENT ON COLUMN "orders"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "orders"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "customer_ref" IS 'Ficha de clientes para factura completa';
COMMENT ON COLUMN "customer_ref"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "customer_ref"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "customer_ref"."type" IS 'Particular o empresa';
COMMENT ON COLUMN "customer_ref"."tax_id" IS 'NIF / CIF';
COMMENT ON COLUMN "customer_ref"."name" IS 'Nombre o razón social';
COMMENT ON COLUMN "customer_ref"."email" IS 'Email';
COMMENT ON COLUMN "customer_ref"."phone" IS 'Teléfono';
COMMENT ON COLUMN "customer_ref"."street" IS 'Dirección';
COMMENT ON COLUMN "customer_ref"."postal_code" IS 'Código postal';
COMMENT ON COLUMN "customer_ref"."city" IS 'Ciudad';
COMMENT ON COLUMN "customer_ref"."province" IS 'Provincia';
COMMENT ON COLUMN "customer_ref"."country" IS 'País (ISO)';
COMMENT ON COLUMN "customer_ref"."active" IS 'Activo (no se borra nada: se inactiva)';
COMMENT ON COLUMN "customer_ref"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "customer_ref"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "account" IS 'Cuentas de la orden (accounts[])';
COMMENT ON COLUMN "account"."id" IS 'Id de la cuenta (accounts[].id)';
COMMENT ON COLUMN "account"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "account"."order_id" IS 'Orden';
COMMENT ON COLUMN "account"."name" IS 'Nombre (Cuenta 1)';
COMMENT ON COLUMN "account"."status" IS 'Estado';
COMMENT ON COLUMN "account"."note" IS 'Nota de la cuenta';
COMMENT ON COLUMN "account"."opened_by_user_id" IS 'Abierta por: usuario';
COMMENT ON COLUMN "account"."opened_by_user_name" IS 'Abierta por: nombre (copia)';
COMMENT ON COLUMN "account"."opened_by_role" IS 'Abierta por: rol';
COMMENT ON COLUMN "account"."opened_by_device" IS 'Abierta por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "account"."opened_by_at" IS 'Abierta por: fecha y hora';
COMMENT ON COLUMN "account"."closed_by_user_id" IS 'Cerrada por: usuario';
COMMENT ON COLUMN "account"."closed_by_user_name" IS 'Cerrada por: nombre (copia)';
COMMENT ON COLUMN "account"."closed_by_role" IS 'Cerrada por: rol';
COMMENT ON COLUMN "account"."closed_by_device" IS 'Cerrada por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "account"."closed_by_at" IS 'Cerrada por: fecha y hora';
COMMENT ON COLUMN "account"."last_entry_user_id" IS 'Último producto añadido: usuario';
COMMENT ON COLUMN "account"."last_entry_user_name" IS 'Último producto añadido: nombre (copia)';
COMMENT ON COLUMN "account"."last_entry_role" IS 'Último producto añadido: rol';
COMMENT ON COLUMN "account"."last_entry_device" IS 'Último producto añadido: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "account"."last_entry_at" IS 'Último producto añadido: fecha y hora';
COMMENT ON COLUMN "account"."customer_id" IS 'Cliente de la ficha (customerData.customerId)';
COMMENT ON COLUMN "account"."subtotal" IS 'Total PVP (totals.subtotal)';
COMMENT ON COLUMN "account"."discount_total" IS 'Descuentos (totals.discount)';
COMMENT ON COLUMN "account"."total" IS 'Total a pagar (totals.total)';
COMMENT ON COLUMN "account"."paid" IS 'Pagado (totals.paid)';
COMMENT ON COLUMN "account"."pending" IS 'Pendiente (totals.pending)';
COMMENT ON COLUMN "account"."tips" IS 'Propinas (totals.tips)';
COMMENT ON COLUMN "account"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "account"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "order_event" IS 'Eventos de la mesa y de cada cuenta (events[])';
COMMENT ON COLUMN "order_event"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "order_event"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "order_event"."order_id" IS 'Orden';
COMMENT ON COLUMN "order_event"."account_id" IS 'Cuenta (NULL = evento de la mesa)';
COMMENT ON COLUMN "order_event"."type" IS 'Tipo (tableOpened, linePrinted, invoiceIssued…)';
COMMENT ON COLUMN "order_event"."at" IS 'Fecha y hora';
COMMENT ON COLUMN "order_event"."description" IS 'Descripción';
COMMENT ON COLUMN "order_event"."user_id" IS 'Usuario';
COMMENT ON COLUMN "order_event"."user_name" IS 'Usuario (copia)';
COMMENT ON COLUMN "order_event"."role" IS 'Rol';
COMMENT ON COLUMN "order_event"."device" IS 'Equipo';
COMMENT ON COLUMN "order_event"."origin" IS 'Origen';
COMMENT ON TABLE "order_line" IS 'Productos de la cuenta, también los eliminados (lines[] y deletedLines[])';
COMMENT ON COLUMN "order_line"."id" IS 'Id de la línea';
COMMENT ON COLUMN "order_line"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "order_line"."order_id" IS 'Orden';
COMMENT ON COLUMN "order_line"."account_id" IS 'Cuenta';
COMMENT ON COLUMN "order_line"."product_id" IS 'Producto de la carta';
COMMENT ON COLUMN "order_line"."plu" IS 'PLU (productId)';
COMMENT ON COLUMN "order_line"."name" IS 'Nombre (copia)';
COMMENT ON COLUMN "order_line"."comment" IS 'Comentario para cocina';
COMMENT ON COLUMN "order_line"."quantity" IS 'Cantidad';
COMMENT ON COLUMN "order_line"."unit_price" IS 'PVP unitario aplicado (general o terraza)';
COMMENT ON COLUMN "order_line"."tax_rate" IS 'Tipo de IVA';
COMMENT ON COLUMN "order_line"."tax_amount" IS 'IVA unitario (iva)';
COMMENT ON COLUMN "order_line"."net_amount" IS 'Neto unitario (netoProce)';
COMMENT ON COLUMN "order_line"."status" IS 'Estado';
COMMENT ON COLUMN "order_line"."printed" IS 'Se imprimió en cocina o barra';
COMMENT ON COLUMN "order_line"."created_by_user_id" IS 'Pedido por: usuario';
COMMENT ON COLUMN "order_line"."created_by_user_name" IS 'Pedido por: nombre (copia)';
COMMENT ON COLUMN "order_line"."created_by_role" IS 'Pedido por: rol';
COMMENT ON COLUMN "order_line"."created_by_device" IS 'Pedido por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "order_line"."created_by_origin" IS 'Pedido por: origen';
COMMENT ON COLUMN "order_line"."created_by_at" IS 'Pedido por: fecha y hora';
COMMENT ON COLUMN "order_line"."source_line_id" IS 'Línea de la que sale al separar o pasar de cuenta';
COMMENT ON COLUMN "order_line"."deleted" IS 'Eliminada (va en deletedLines)';
COMMENT ON COLUMN "order_line"."delete_reason_id" IS 'Motivo de eliminación';
COMMENT ON COLUMN "order_line"."delete_reason" IS 'Motivo (copia)';
COMMENT ON COLUMN "order_line"."deleted_by_user_id" IS 'Eliminada por: usuario';
COMMENT ON COLUMN "order_line"."deleted_by_user_name" IS 'Eliminada por: nombre (copia)';
COMMENT ON COLUMN "order_line"."deleted_by_role" IS 'Eliminada por: rol';
COMMENT ON COLUMN "order_line"."deleted_by_device" IS 'Eliminada por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "order_line"."deleted_by_at" IS 'Eliminada por: fecha y hora';
COMMENT ON COLUMN "order_line"."delete_authorized_by_user_id" IS 'Eliminación autorizada por: usuario';
COMMENT ON COLUMN "order_line"."delete_authorized_by_user_name" IS 'Eliminación autorizada por: nombre (copia)';
COMMENT ON COLUMN "order_line"."delete_authorized_by_role" IS 'Eliminación autorizada por: rol';
COMMENT ON COLUMN "order_line"."delete_authorized_by_device" IS 'Eliminación autorizada por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "order_line"."delete_authorized_by_at" IS 'Eliminación autorizada por: fecha y hora';
COMMENT ON COLUMN "order_line"."created_at" IS 'Alta del registro';
COMMENT ON COLUMN "order_line"."updated_at" IS 'Última modificación';
COMMENT ON TABLE "order_line_modifier" IS 'Respuestas de las preguntas de cada línea (modifiers[])';
COMMENT ON COLUMN "order_line_modifier"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "order_line_modifier"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "order_line_modifier"."line_id" IS 'Línea';
COMMENT ON COLUMN "order_line_modifier"."question_id" IS 'Pregunta';
COMMENT ON COLUMN "order_line_modifier"."product_id" IS 'Producto respuesta';
COMMENT ON COLUMN "order_line_modifier"."plu" IS 'PLU (productId)';
COMMENT ON COLUMN "order_line_modifier"."name" IS 'Nombre';
COMMENT ON COLUMN "order_line_modifier"."quantity" IS 'Cantidad';
COMMENT ON COLUMN "order_line_modifier"."unit_price" IS 'Suplemento';
COMMENT ON COLUMN "order_line_modifier"."tax_amount" IS 'IVA (iva)';
COMMENT ON COLUMN "order_line_modifier"."net_amount" IS 'Neto (netoProce)';
COMMENT ON TABLE "order_line_printer" IS 'A qué impresora salió cada línea (printers[])';
COMMENT ON COLUMN "order_line_printer"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "order_line_printer"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "order_line_printer"."line_id" IS 'Línea';
COMMENT ON COLUMN "order_line_printer"."channel_name" IS 'Canal (area)';
COMMENT ON COLUMN "order_line_printer"."printer_id" IS 'Impresora';
COMMENT ON COLUMN "order_line_printer"."printer_name" IS 'Impresora (copia)';
COMMENT ON COLUMN "order_line_printer"."interface" IS 'Conexión';
COMMENT ON COLUMN "order_line_printer"."printed" IS 'Impreso';
COMMENT ON COLUMN "order_line_printer"."printed_at" IS 'Impreso a las';
COMMENT ON TABLE "account_discount" IS 'Descuentos aplicados a una cuenta (discounts[])';
COMMENT ON COLUMN "account_discount"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "account_discount"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "account_discount"."account_id" IS 'Cuenta';
COMMENT ON COLUMN "account_discount"."discount_id" IS 'Descuento configurado';
COMMENT ON COLUMN "account_discount"."source" IS 'Origen';
COMMENT ON COLUMN "account_discount"."coupon_id" IS 'Id del cupón';
COMMENT ON COLUMN "account_discount"."coupon_code" IS 'Código del cupón';
COMMENT ON COLUMN "account_discount"."type" IS 'Porcentaje o importe fijo';
COMMENT ON COLUMN "account_discount"."value" IS 'Valor';
COMMENT ON COLUMN "account_discount"."base_amount" IS 'Base de cálculo (PVP)';
COMMENT ON COLUMN "account_discount"."amount" IS 'Importe descontado';
COMMENT ON COLUMN "account_discount"."reason" IS 'Motivo';
COMMENT ON COLUMN "account_discount"."status" IS 'Estado';
COMMENT ON COLUMN "account_discount"."applied_by_user_id" IS 'Aplicado por: usuario';
COMMENT ON COLUMN "account_discount"."applied_by_user_name" IS 'Aplicado por: nombre (copia)';
COMMENT ON COLUMN "account_discount"."applied_by_role" IS 'Aplicado por: rol';
COMMENT ON COLUMN "account_discount"."applied_by_device" IS 'Aplicado por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "account_discount"."applied_by_at" IS 'Aplicado por: fecha y hora';
COMMENT ON COLUMN "account_discount"."authorized_by_user_id" IS 'Autorizado por: usuario';
COMMENT ON COLUMN "account_discount"."authorized_by_user_name" IS 'Autorizado por: nombre (copia)';
COMMENT ON COLUMN "account_discount"."authorized_by_role" IS 'Autorizado por: rol';
COMMENT ON COLUMN "account_discount"."authorized_by_device" IS 'Autorizado por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "account_discount"."authorized_by_at" IS 'Autorizado por: fecha y hora';
COMMENT ON COLUMN "account_discount"."removed_by_user_id" IS 'Retirado por: usuario';
COMMENT ON COLUMN "account_discount"."removed_by_user_name" IS 'Retirado por: nombre (copia)';
COMMENT ON COLUMN "account_discount"."removed_by_role" IS 'Retirado por: rol';
COMMENT ON COLUMN "account_discount"."removed_by_device" IS 'Retirado por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "account_discount"."removed_by_at" IS 'Retirado por: fecha y hora';
COMMENT ON TABLE "payment" IS 'Pagos de una cuenta (payments[])';
COMMENT ON COLUMN "payment"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "payment"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "payment"."account_id" IS 'Cuenta';
COMMENT ON COLUMN "payment"."payment_method_id" IS 'Forma de pago';
COMMENT ON COLUMN "payment"."method" IS 'Método';
COMMENT ON COLUMN "payment"."amount" IS 'Importe aplicado a la cuenta';
COMMENT ON COLUMN "payment"."tip" IS 'Propina';
COMMENT ON COLUMN "payment"."cash_given" IS 'Entregado por el cliente';
COMMENT ON COLUMN "payment"."change_given" IS 'Cambio devuelto';
COMMENT ON COLUMN "payment"."status" IS 'Estado';
COMMENT ON COLUMN "payment"."station_id" IS 'Estación o PDA';
COMMENT ON COLUMN "payment"."collected_by_user_id" IS 'Cobrado por: usuario';
COMMENT ON COLUMN "payment"."collected_by_user_name" IS 'Cobrado por: nombre (copia)';
COMMENT ON COLUMN "payment"."collected_by_role" IS 'Cobrado por: rol';
COMMENT ON COLUMN "payment"."collected_by_device" IS 'Cobrado por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "payment"."collected_by_at" IS 'Cobrado por: fecha y hora';
COMMENT ON TABLE "payment_cash_detail" IS 'Billetes y monedas recibidos y devueltos (cashDetail)';
COMMENT ON COLUMN "payment_cash_detail"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "payment_cash_detail"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "payment_cash_detail"."payment_id" IS 'Pago';
COMMENT ON COLUMN "payment_cash_detail"."direction" IS 'Recibido o devuelto';
COMMENT ON COLUMN "payment_cash_detail"."kind" IS 'Billete o moneda';
COMMENT ON COLUMN "payment_cash_detail"."value" IS 'Valor';
COMMENT ON COLUMN "payment_cash_detail"."quantity" IS 'Cantidad';
COMMENT ON TABLE "payment_bank_data" IS 'Respuesta del datáfono o del banco (bankData)';
COMMENT ON COLUMN "payment_bank_data"."payment_id" IS 'Pago';
COMMENT ON COLUMN "payment_bank_data"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "payment_bank_data"."provider" IS 'Proveedor (redsys…)';
COMMENT ON COLUMN "payment_bank_data"."merchant_id" IS 'Comercio';
COMMENT ON COLUMN "payment_bank_data"."terminal_id" IS 'Terminal';
COMMENT ON COLUMN "payment_bank_data"."transaction_id" IS 'Operación';
COMMENT ON COLUMN "payment_bank_data"."authorization_code" IS 'Autorización';
COMMENT ON COLUMN "payment_bank_data"."response_code" IS 'Código de respuesta';
COMMENT ON COLUMN "payment_bank_data"."response_message" IS 'Mensaje';
COMMENT ON COLUMN "payment_bank_data"."card_brand" IS 'Marca de la tarjeta';
COMMENT ON COLUMN "payment_bank_data"."masked_pan" IS 'Tarjeta enmascarada';
COMMENT ON COLUMN "payment_bank_data"."entry_mode" IS 'Lectura (contactless, chip…)';
COMMENT ON COLUMN "payment_bank_data"."masked_phone" IS 'Teléfono enmascarado (Bizum)';
COMMENT ON COLUMN "payment_bank_data"."amount" IS 'Importe en el banco';
COMMENT ON COLUMN "payment_bank_data"."currency" IS 'Moneda';
COMMENT ON COLUMN "payment_bank_data"."processed_at" IS 'Procesado';
COMMENT ON TABLE "invoice_series" IS 'Numeración de cada serie (sin huecos)';
COMMENT ON COLUMN "invoice_series"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "invoice_series"."series" IS 'Serie (T2026, F2026, AB2026)';
COMMENT ON COLUMN "invoice_series"."kind" IS 'Tipo de factura';
COMMENT ON COLUMN "invoice_series"."last_sequence" IS 'Último número emitido';
COMMENT ON COLUMN "invoice_series"."updated_at" IS 'Última emisión';
COMMENT ON TABLE "invoice" IS 'Facturas emitidas (accounts[].invoice). Inmutables';
COMMENT ON COLUMN "invoice"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "invoice"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "invoice"."account_id" IS 'Cuenta facturada';
COMMENT ON COLUMN "invoice"."order_id" IS 'Orden';
COMMENT ON COLUMN "invoice"."type" IS 'F1 completa, F2 simplificada, R1 rectificativa';
COMMENT ON COLUMN "invoice"."series" IS 'Serie';
COMMENT ON COLUMN "invoice"."sequence" IS 'Número secuencial';
COMMENT ON COLUMN "invoice"."invoice_number" IS 'Número completo (T2026-001426)';
COMMENT ON COLUMN "invoice"."issued_at" IS 'Fecha de expedición';
COMMENT ON COLUMN "invoice"."issuer_tax_id" IS 'NIF del emisor (copia)';
COMMENT ON COLUMN "invoice"."issuer_name" IS 'Emisor (copia)';
COMMENT ON COLUMN "invoice"."customer_id" IS 'Cliente de la ficha';
COMMENT ON COLUMN "invoice"."customer_type" IS 'Cliente: tipo (copia)';
COMMENT ON COLUMN "invoice"."customer_tax_id" IS 'Cliente: NIF (copia)';
COMMENT ON COLUMN "invoice"."customer_name" IS 'Cliente: nombre (copia)';
COMMENT ON COLUMN "invoice"."customer_email" IS 'Cliente: email';
COMMENT ON COLUMN "invoice"."customer_phone" IS 'Cliente: teléfono';
COMMENT ON COLUMN "invoice"."customer_street" IS 'Cliente: dirección';
COMMENT ON COLUMN "invoice"."customer_postal_code" IS 'Cliente: código postal';
COMMENT ON COLUMN "invoice"."customer_city" IS 'Cliente: ciudad';
COMMENT ON COLUMN "invoice"."customer_province" IS 'Cliente: provincia';
COMMENT ON COLUMN "invoice"."customer_country" IS 'Cliente: país';
COMMENT ON COLUMN "invoice"."tax_base" IS 'Base imponible';
COMMENT ON COLUMN "invoice"."tax_total" IS 'Cuota de IVA';
COMMENT ON COLUMN "invoice"."total" IS 'Importe total';
COMMENT ON COLUMN "invoice"."rectified_invoice_id" IS 'Factura que rectifica (R1)';
COMMENT ON COLUMN "invoice"."rectification_reason" IS 'Motivo de la rectificación';
COMMENT ON COLUMN "invoice"."verifactu_qr" IS 'URL del QR VERI*FACTU';
COMMENT ON COLUMN "invoice"."status" IS 'Estado';
COMMENT ON COLUMN "invoice"."issued_by_user_id" IS 'Emitida por: usuario';
COMMENT ON COLUMN "invoice"."issued_by_user_name" IS 'Emitida por: nombre (copia)';
COMMENT ON COLUMN "invoice"."issued_by_role" IS 'Emitida por: rol';
COMMENT ON COLUMN "invoice"."issued_by_device" IS 'Emitida por: equipo (CAJA1, PDA1…)';
COMMENT ON COLUMN "invoice"."issued_by_at" IS 'Emitida por: fecha y hora';
COMMENT ON COLUMN "invoice"."created_at" IS 'Alta';
COMMENT ON TABLE "invoice_tax" IS 'Desglose de impuestos de la factura';
COMMENT ON COLUMN "invoice_tax"."invoice_id" IS 'Factura';
COMMENT ON COLUMN "invoice_tax"."rate" IS 'Tipo de IVA';
COMMENT ON COLUMN "invoice_tax"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "invoice_tax"."base" IS 'Base';
COMMENT ON COLUMN "invoice_tax"."tax" IS 'Cuota';
COMMENT ON TABLE "verifactu_record" IS 'Registro VeriFactu: alta o anulación con huella encadenada y envío a la AEAT';
COMMENT ON COLUMN "verifactu_record"."id" IS 'Identificador (UUID)';
COMMENT ON COLUMN "verifactu_record"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "verifactu_record"."invoice_id" IS 'Factura';
COMMENT ON COLUMN "verifactu_record"."record_type" IS 'Tipo de registro';
COMMENT ON COLUMN "verifactu_record"."issuer_tax_id" IS 'NIF del emisor';
COMMENT ON COLUMN "verifactu_record"."invoice_number" IS 'Número de factura';
COMMENT ON COLUMN "verifactu_record"."issued_on" IS 'Fecha de expedición';
COMMENT ON COLUMN "verifactu_record"."invoice_type" IS 'Tipo de factura';
COMMENT ON COLUMN "verifactu_record"."tax_total" IS 'Cuota total';
COMMENT ON COLUMN "verifactu_record"."total" IS 'Importe total';
COMMENT ON COLUMN "verifactu_record"."previous_record_id" IS 'Registro anterior de la cadena';
COMMENT ON COLUMN "verifactu_record"."previous_hash" IS 'Huella del registro anterior';
COMMENT ON COLUMN "verifactu_record"."hash" IS 'Huella SHA-256 de este registro';
COMMENT ON COLUMN "verifactu_record"."generated_at" IS 'Fecha, hora y huso de generación';
COMMENT ON COLUMN "verifactu_record"."status" IS 'Envío a la AEAT';
COMMENT ON COLUMN "verifactu_record"."aeat_csv" IS 'CSV devuelto por la AEAT';
COMMENT ON COLUMN "verifactu_record"."aeat_response" IS 'Respuesta de la AEAT';
COMMENT ON COLUMN "verifactu_record"."sent_at" IS 'Enviado';
COMMENT ON COLUMN "verifactu_record"."attempts" IS 'Intentos de envío';
