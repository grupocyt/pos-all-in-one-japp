-- 0025 · Delivery: Ajustes › Pedidos y tablero de Pedidos (TPV 1.2.217–1.2.233 y 1.2.264, 02/11/2026).
-- Hasta ahora el TPV lo guardaba solo en el equipo (st.cfg.pedidos y st.delivery). Con esto pasa al servidor de la tienda.
--   delivery_settings      una fila por tienda: delivery en este local, integración, plataformas, tiempos y funcionamiento
--   delivery_rider         motorizados de la tienda (además siempre está «Repartidor de la plataforma», que no es una fila)
--   delivery_order         cada pedido: plataforma, código, cliente, dirección, pago, estado, motorizado y total
--   delivery_order_line    los productos del pedido tal como llegan
--   delivery_order_event   cada cambio de estado con hora y quién (la ficha del pedido enseña los pasos)
-- Estados (en este orden): pending → received → to_assign → assigned → on_route → delivered; cancelled desde cualquiera sin terminar.
-- En el TPV: pend, rec, poras, asig, camino, done, cancel.

CREATE TABLE IF NOT EXISTS "delivery_settings" (
  "store_id"        UUID PRIMARY KEY REFERENCES "store" ("id"),
  "active"          BOOLEAN NOT NULL DEFAULT TRUE,
  "integration"     BOOLEAN NOT NULL DEFAULT TRUE,
  "provider"        VARCHAR(40) DEFAULT 'Deliverect',
  "platforms"       JSONB NOT NULL DEFAULT '[{"id":"glovo","name":"Glovo","active":true},{"id":"uber","name":"Uber Eats","active":true},{"id":"just","name":"Just Eat","active":true},{"id":"own","name":"Web propia","active":true}]'::jsonb,
  "auto_accept"     BOOLEAN NOT NULL DEFAULT FALSE,
  "ask_rider"       BOOLEAN NOT NULL DEFAULT TRUE,
  "sound"           BOOLEAN NOT NULL DEFAULT TRUE,
  "prep_minutes"    SMALLINT NOT NULL DEFAULT 15,
  "amber_minutes"   SMALLINT NOT NULL DEFAULT 15,
  "red_minutes"     SMALLINT NOT NULL DEFAULT 30,
  "version"         INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by"      VARCHAR(80),
  CONSTRAINT "ck_delivery_settings_minutes" CHECK ("prep_minutes" BETWEEN 1 AND 240 AND "amber_minutes" BETWEEN 1 AND 240 AND "red_minutes" BETWEEN 1 AND 240),
  CONSTRAINT "ck_delivery_settings_light" CHECK ("red_minutes" > "amber_minutes"),
  CONSTRAINT "ck_delivery_settings_platforms" CHECK (jsonb_typeof("platforms") = 'array')
);
DROP TRIGGER IF EXISTS "trg_delivery_settings_updated_at" ON "delivery_settings";
CREATE TRIGGER "trg_delivery_settings_updated_at" BEFORE UPDATE ON "delivery_settings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "delivery_settings" IS 'Ajustes › Pedidos › Delivery (una fila por tienda; sin fila = los valores por defecto)';
COMMENT ON COLUMN "delivery_settings"."active" IS 'Delivery en este local: apagado, el botón Pedidos no sale (ni en mesas ni en fast food) y la API no acepta pedidos nuevos';
COMMENT ON COLUMN "delivery_settings"."integration" IS 'Recibir pedidos de las plataformas a través del integrador';
COMMENT ON COLUMN "delivery_settings"."platforms" IS '[{id: glovo|uber|just|own|…, name, active}]';
COMMENT ON COLUMN "delivery_settings"."auto_accept" IS 'Los pedidos nuevos pasan solos de pending a received';
COMMENT ON COLUMN "delivery_settings"."ask_rider" IS 'Al pasar a assigned hay que elegir quién lo lleva (motorizado o «Repartidor de la plataforma»)';
COMMENT ON COLUMN "delivery_settings"."prep_minutes" IS 'Tiempo de preparación que se avisa a la plataforma al aceptar';
COMMENT ON COLUMN "delivery_settings"."amber_minutes" IS 'Semáforo en ámbar desde estos minutos desde que llegó el pedido';
COMMENT ON COLUMN "delivery_settings"."red_minutes" IS 'Semáforo en rojo (y aviso en el botón Pedidos) desde estos minutos; mayor que amber_minutes';

CREATE TABLE IF NOT EXISTS "delivery_rider" (
  "id"          UUID PRIMARY KEY,
  "store_id"    UUID NOT NULL REFERENCES "store" ("id"),
  "name"        VARCHAR(40) NOT NULL,
  "phone"       VARCHAR(20),
  "active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order"  SMALLINT NOT NULL DEFAULT 0,
  "version"     INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ck_delivery_rider_name" CHECK (length(btrim("name")) > 0)
);
CREATE INDEX IF NOT EXISTS "ix_delivery_rider_store_id" ON "delivery_rider" ("store_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_delivery_rider_store_id_name_active" ON "delivery_rider" ("store_id", lower(btrim("name"))) WHERE "active";
DROP TRIGGER IF EXISTS "trg_delivery_rider_updated_at" ON "delivery_rider";
CREATE TRIGGER "trg_delivery_rider_updated_at" BEFORE UPDATE ON "delivery_rider" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "delivery_rider" IS 'Motorizados de la tienda (Ajustes › Pedidos › Motorizados). Quitar uno lo desactiva: los pedidos antiguos lo siguen nombrando';

CREATE TABLE IF NOT EXISTS "delivery_order" (
  "id"             UUID PRIMARY KEY,
  "store_id"       UUID NOT NULL REFERENCES "store" ("id"),
  "period_id"      UUID REFERENCES "sales_period" ("id"),
  "platform"       VARCHAR(20) NOT NULL,
  "code"           VARCHAR(30) NOT NULL,
  "external_id"    VARCHAR(80),
  "customer_name"  VARCHAR(80) NOT NULL,
  "customer_phone" VARCHAR(20),
  "address"        VARCHAR(200),
  "payment_note"   VARCHAR(80),
  "note"           VARCHAR(300),
  "status"         VARCHAR(12) NOT NULL DEFAULT 'pending',
  "rider_id"       UUID REFERENCES "delivery_rider" ("id"),
  "rider_name"     VARCHAR(60),
  "total"          NUMERIC(10,2) NOT NULL DEFAULT 0,
  "received_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "finished_at"    TIMESTAMPTZ(3),
  "order_id"       UUID REFERENCES "orders" ("id"),
  "version"        INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ck_delivery_order_status" CHECK ("status" IN ('pending','received','to_assign','assigned','on_route','delivered','cancelled')),
  CONSTRAINT "ck_delivery_order_platform" CHECK ("platform" ~ '^[a-z0-9_-]{2,20}$'),
  CONSTRAINT "ck_delivery_order_total" CHECK ("total" >= 0),
  CONSTRAINT "ck_delivery_order_finished" CHECK (("status" IN ('delivered','cancelled')) = ("finished_at" IS NOT NULL)),
  CONSTRAINT "ck_delivery_order_rider" CHECK ("status" NOT IN ('assigned','on_route','delivered') OR "rider_name" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "ix_delivery_order_store_id" ON "delivery_order" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_delivery_order_period_id" ON "delivery_order" ("period_id");
CREATE INDEX IF NOT EXISTS "ix_delivery_order_rider_id" ON "delivery_order" ("rider_id");
CREATE INDEX IF NOT EXISTS "ix_delivery_order_order_id" ON "delivery_order" ("order_id");
CREATE INDEX IF NOT EXISTS "ix_delivery_order_live" ON "delivery_order" ("store_id", "received_at") WHERE "finished_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_delivery_order_external" ON "delivery_order" ("store_id", "platform", "external_id") WHERE "external_id" IS NOT NULL;
DROP TRIGGER IF EXISTS "trg_delivery_order_updated_at" ON "delivery_order";
CREATE TRIGGER "trg_delivery_order_updated_at" BEFORE UPDATE ON "delivery_order" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "delivery_order" IS 'Pedidos de delivery del tablero Pedidos (Glovo, Uber Eats, Just Eat, web propia…)';
COMMENT ON COLUMN "delivery_order"."code" IS 'Transacción que se enseña en el tablero (GLV-4821)';
COMMENT ON COLUMN "delivery_order"."external_id" IS 'Id del pedido en la plataforma o el integrador: el mismo pedido no entra dos veces';
COMMENT ON COLUMN "delivery_order"."payment_note" IS 'Cómo se paga, tal como llega («Pagado online», «Paga en la entrega · tarjeta»)';
COMMENT ON COLUMN "delivery_order"."rider_name" IS 'Quién lo lleva: el nombre del motorizado al asignarlo o «Repartidor de la plataforma» (sin rider_id)';
COMMENT ON COLUMN "delivery_order"."received_at" IS 'Cuándo llegó: de aquí salen la espera y el semáforo';
COMMENT ON COLUMN "delivery_order"."order_id" IS 'Transacción del TPV si el pedido se factura en la tienda (vacío mientras no)';

CREATE TABLE IF NOT EXISTS "delivery_order_line" (
  "id"                UUID PRIMARY KEY,
  "store_id"          UUID NOT NULL REFERENCES "store" ("id"),
  "delivery_order_id" UUID NOT NULL REFERENCES "delivery_order" ("id") ON DELETE CASCADE,
  "line_no"           SMALLINT NOT NULL,
  "product_id"        UUID REFERENCES "product" ("id"),
  "name"              VARCHAR(120) NOT NULL,
  "quantity"          NUMERIC(10,3) NOT NULL,
  "unit_price"        NUMERIC(10,2) NOT NULL,
  "note"              VARCHAR(200),
  CONSTRAINT "ck_delivery_order_line_quantity" CHECK ("quantity" > 0),
  CONSTRAINT "ck_delivery_order_line_unit_price" CHECK ("unit_price" >= 0),
  CONSTRAINT "uq_delivery_order_line_order_line_no" UNIQUE ("delivery_order_id", "line_no")
);
CREATE INDEX IF NOT EXISTS "ix_delivery_order_line_store_id" ON "delivery_order_line" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_delivery_order_line_product_id" ON "delivery_order_line" ("product_id");
COMMENT ON TABLE "delivery_order_line" IS 'Productos de un pedido de delivery tal como llegan (product_id si se reconoce el PLU de la carta)';

CREATE TABLE IF NOT EXISTS "delivery_order_event" (
  "id"                UUID PRIMARY KEY,
  "store_id"          UUID NOT NULL REFERENCES "store" ("id"),
  "delivery_order_id" UUID NOT NULL REFERENCES "delivery_order" ("id") ON DELETE CASCADE,
  "status"            VARCHAR(12) NOT NULL,
  "at"                TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "user_id"           UUID REFERENCES "app_user" ("id"),
  "by_name"           VARCHAR(80),
  "note"              VARCHAR(300),
  CONSTRAINT "ck_delivery_order_event_status" CHECK ("status" IN ('pending','received','to_assign','assigned','on_route','delivered','cancelled'))
);
CREATE INDEX IF NOT EXISTS "ix_delivery_order_event_store_id" ON "delivery_order_event" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_delivery_order_event_delivery_order_id" ON "delivery_order_event" ("delivery_order_id", "at");
CREATE INDEX IF NOT EXISTS "ix_delivery_order_event_user_id" ON "delivery_order_event" ("user_id");
COMMENT ON TABLE "delivery_order_event" IS 'Pasos de cada pedido: estado, cuándo y quién (by_name = «Integración» o «Automático» si no lo hizo una persona)';

-- Permisos nuevos: Ajustes › Pedidos y el tablero. Ajustes › Pedidos a quien ya tenía Restaurante; el tablero, a todos los perfiles.
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('ajustes.pedidos', 'Ajustes', 'Pedidos · Delivery', 48),
  ('funciones.pedidos', 'Funciones', 'Tablero de pedidos (delivery)', 49)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT "profile_id", 'ajustes.pedidos', "store_id" FROM "profile_permission" WHERE "permission_code" = 'ajustes.restaurante'
ON CONFLICT DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT "id", 'funciones.pedidos', "store_id" FROM "user_profile"
ON CONFLICT DO NOTHING;
