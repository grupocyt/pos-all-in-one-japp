-- 0005 · Ajustes completos (versiones y historial), Gestor de cierres, sincronización con el Manager y carta programada.

-- ───────────────────────── 1. Ajustes: versión por registro y versión global de configuración ─────────────────────────
-- Cada registro de configuración lleva «version»: PATCH /config/{módulo}/{id} la manda y, si no coincide, 409 VERSION_CONFLICT.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['company','store','billing_settings','store_parameters','user_profile','app_user','area','dining_table','tax',
                           'category','product','question','print_channel','printer','station','payment_method','discount','reason'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1', t);
    EXECUTE format('COMMENT ON COLUMN %I."version" IS %L', t, 'Versión del registro (control de concurrencia en Ajustes); sube en cada cambio');
  END LOOP;
END $$;

-- Versión de toda la configuración de la tienda: sube con cada cambio de Ajustes. Es el ETag de GET /config.
ALTER TABLE "store" ADD COLUMN IF NOT EXISTS "config_version" BIGINT NOT NULL DEFAULT 1;
COMMENT ON COLUMN "store"."config_version" IS 'Versión de la configuración completa (ETag de GET /config); sube con cada cambio de Ajustes';

-- Historial de Ajustes con el registro afectado y el antes/después para poder auditar y reenviar.
ALTER TABLE "config_change_log" ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(40);
ALTER TABLE "config_change_log" ADD COLUMN IF NOT EXISTS "before" JSONB;
ALTER TABLE "config_change_log" ADD COLUMN IF NOT EXISTS "after" JSONB;
ALTER TABLE "config_change_log" ADD COLUMN IF NOT EXISTS "config_version" BIGINT;
ALTER TABLE "config_change_log" ADD COLUMN IF NOT EXISTS "device" VARCHAR(40);
COMMENT ON COLUMN "config_change_log"."record_id" IS 'Id del registro cambiado (UUID, o PLU en productos)';
COMMENT ON COLUMN "config_change_log"."before" IS 'Registro antes del cambio (sin PIN)';
COMMENT ON COLUMN "config_change_log"."after" IS 'Registro después del cambio (sin PIN)';
COMMENT ON COLUMN "config_change_log"."config_version" IS 'store.config_version que dejó este cambio';
COMMENT ON COLUMN "config_change_log"."device" IS 'Equipo desde el que se hizo';
CREATE INDEX IF NOT EXISTS "ix_config_change_log_store_id_at" ON "config_change_log" ("store_id", "at");

-- Un nombre por registro activo donde un duplicado confunde en pantalla.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_area_store_id_name_active" ON "area" ("store_id", lower("name")) WHERE "active";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_print_channel_store_id_name_active" ON "print_channel" ("store_id", lower("name")) WHERE "active";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_station_store_id_name_active" ON "station" ("store_id", lower("name")) WHERE "active";

-- Permisos nuevos: Gestor de cierres y Developer › Sincronización (se conceden a quien ya tenía historial / API backend).
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('ajustes.cierres', 'Ajustes', 'Gestor de cierres', 43),
  ('ajustes.devsync', 'Ajustes', 'Developer · Sincronización', 47)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT "profile_id", 'ajustes.cierres', "store_id" FROM "profile_permission" WHERE "permission_code" = 'ajustes.historial'
ON CONFLICT DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT "profile_id", 'ajustes.devsync', "store_id" FROM "profile_permission" WHERE "permission_code" = 'ajustes.devapi'
ON CONFLICT DO NOTHING;

-- ───────────────────────── 2. Sincronización con el Manager ─────────────────────────
-- event_id: identidad del mensaje para el Manager (no cambia aunque se reenvíe). parked_at: rechazado demasiadas veces, apartado.
ALTER TABLE "sync_outbox" ADD COLUMN IF NOT EXISTS "event_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "sync_outbox" ADD COLUMN IF NOT EXISTS "parked_at" TIMESTAMPTZ(3);
DO $$ BEGIN
  ALTER TABLE "sync_outbox" ADD CONSTRAINT "uq_sync_outbox_event_id" UNIQUE ("event_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
COMMENT ON COLUMN "sync_outbox"."event_id" IS 'Id del mensaje para el Manager: el Manager guarda por (store_id, event_id) y así reenviar no duplica';
COMMENT ON COLUMN "sync_outbox"."parked_at" IS 'Apartado tras demasiados rechazos (no se reintenta solo; sale en Developer › Sincronización)';
-- Lo pendiente, en orden de envío (índice parcial: la cola enviada crece, la pendiente es pequeña).
CREATE INDEX IF NOT EXISTS "ix_sync_outbox_pending" ON "sync_outbox" ("store_id", "id") WHERE "sent_at" IS NULL AND "parked_at" IS NULL;

-- Estado del agente: un registro por tienda (lo pinta Developer › Sincronización y viaja en el latido).
CREATE TABLE IF NOT EXISTS "sync_state" (
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "last_sent_at" TIMESTAMPTZ(3),
  "last_sent_id" BIGINT,
  "last_live_at" TIMESTAMPTZ(3),
  "last_heartbeat_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(300),
  "last_error_at" TIMESTAMPTZ(3),
  "config_cursor" VARCHAR(60),
  "manager_time_offset_ms" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("store_id")
);
CREATE OR REPLACE TRIGGER "trg_sync_state_updated_at" BEFORE UPDATE ON "sync_state" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "sync_state" IS 'Estado del agente de sincronización con Japp Manager (uno por tienda)';
COMMENT ON COLUMN "sync_state"."store_id" IS 'Local';
COMMENT ON COLUMN "sync_state"."last_sent_at" IS 'Último lote de la cola aceptado por el Manager';
COMMENT ON COLUMN "sync_state"."last_sent_id" IS 'Último sync_outbox.id confirmado';
COMMENT ON COLUMN "sync_state"."last_live_at" IS 'Último pulso de venta en vivo (cada minuto) recibido por el Manager';
COMMENT ON COLUMN "sync_state"."last_heartbeat_at" IS 'Último latido contestado';
COMMENT ON COLUMN "sync_state"."last_error" IS 'Último error de envío';
COMMENT ON COLUMN "sync_state"."last_error_at" IS 'Cuándo fue el último error';
COMMENT ON COLUMN "sync_state"."config_cursor" IS 'Último cursor de cambios de configuración del Manager ya aplicado';
COMMENT ON COLUMN "sync_state"."manager_time_offset_ms" IS 'Diferencia de reloj con el Manager (serverTime del latido − hora local)';

-- ───────────────────────── 3. Gestor de cierres ─────────────────────────
-- Resumen de cada periodo, escrito al cerrarlo (misma transacción). Las 52 semanas y los comparativos leen de aquí, no de las ventas.
CREATE TABLE IF NOT EXISTS "period_summary" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "period_id" UUID NOT NULL REFERENCES "sales_period" ("id"),
  "business_date" DATE NOT NULL,
  "opened_at" TIMESTAMPTZ(3) NOT NULL,
  "closed_at" TIMESTAMPTZ(3) NOT NULL,
  "gross_sales" NUMERIC(10,2) NOT NULL,
  "tax_base" NUMERIC(10,2) NOT NULL,
  "tax_total" NUMERIC(10,2) NOT NULL,
  "tickets" INTEGER NOT NULL,
  "guests" INTEGER NOT NULL,
  "cash_amount" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "card_amount" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "other_amount" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "tips" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "discount_amount" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "voids_count" INTEGER NOT NULL DEFAULT 0,
  "voids_amount" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "cash_difference" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "by_hour" JSONB NOT NULL DEFAULT '{}',
  "by_waiter" JSONB NOT NULL DEFAULT '[]',
  "by_payment" JSONB NOT NULL DEFAULT '[]',
  "voids" JSONB NOT NULL DEFAULT '[]',
  "closed_by_user_name" VARCHAR(60),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_period_summary_period_id" UNIQUE ("period_id"),
  CONSTRAINT "ck_period_summary_counts" CHECK ("tickets" >= 0 AND "guests" >= 0 AND "voids_count" >= 0)
);
CREATE INDEX IF NOT EXISTS "ix_period_summary_store_id_business_date" ON "period_summary" ("store_id", "business_date");
COMMENT ON TABLE "period_summary" IS 'Resumen de cada periodo cerrado (Gestor de cierres): totales, por hora, por camarero, formas de pago y anulaciones';
COMMENT ON COLUMN "period_summary"."id" IS 'Id';
COMMENT ON COLUMN "period_summary"."store_id" IS 'Local';
COMMENT ON COLUMN "period_summary"."period_id" IS 'Periodo resumido (uno por periodo)';
COMMENT ON COLUMN "period_summary"."business_date" IS 'Día de negocio en hora de Madrid (el de la apertura): un cierre a las 00:30 cuenta para el día anterior';
COMMENT ON COLUMN "period_summary"."opened_at" IS 'Apertura del periodo';
COMMENT ON COLUMN "period_summary"."closed_at" IS 'Cierre del periodo';
COMMENT ON COLUMN "period_summary"."gross_sales" IS 'Venta con IVA (facturas F1+F2 menos rectificativas)';
COMMENT ON COLUMN "period_summary"."tax_base" IS 'Base imponible';
COMMENT ON COLUMN "period_summary"."tax_total" IS 'Cuota de IVA';
COMMENT ON COLUMN "period_summary"."tickets" IS 'Facturas emitidas';
COMMENT ON COLUMN "period_summary"."guests" IS 'Comensales de las mesas facturadas';
COMMENT ON COLUMN "period_summary"."cash_amount" IS 'Cobrado en efectivo';
COMMENT ON COLUMN "period_summary"."card_amount" IS 'Cobrado con tarjeta';
COMMENT ON COLUMN "period_summary"."other_amount" IS 'Cobrado con otras formas (plataformas, vales)';
COMMENT ON COLUMN "period_summary"."tips" IS 'Propinas (tarjeta)';
COMMENT ON COLUMN "period_summary"."discount_amount" IS 'Importe de descuentos aplicados';
COMMENT ON COLUMN "period_summary"."voids_count" IS 'Unidades eliminadas después de enviar';
COMMENT ON COLUMN "period_summary"."voids_amount" IS 'Importe eliminado después de enviar';
COMMENT ON COLUMN "period_summary"."cash_difference" IS 'Descuadre del arqueo';
COMMENT ON COLUMN "period_summary"."by_hour" IS 'Venta por hora de Madrid {"13": 1079.85, …}';
COMMENT ON COLUMN "period_summary"."by_waiter" IS '[{name, sales, tickets, tables}]';
COMMENT ON COLUMN "period_summary"."by_payment" IS '[{method, amount, count}]';
COMMENT ON COLUMN "period_summary"."voids" IS '[{at, name, qty, amount, reason, by, auth}]';
COMMENT ON COLUMN "period_summary"."closed_by_user_name" IS 'Quién cerró';
COMMENT ON COLUMN "period_summary"."created_at" IS 'Escrito';

-- Objetivo de venta sobre el año anterior (proyección de las 52 semanas). week = 0: todo el año; 1–53: una semana concreta.
CREATE TABLE IF NOT EXISTS "sales_target" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "year" SMALLINT NOT NULL,
  "week" SMALLINT NOT NULL DEFAULT 0,
  "growth_pct" NUMERIC(5,2) NOT NULL DEFAULT 0,
  "amount" NUMERIC(10,2),
  "note" VARCHAR(200),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_sales_target_store_id_year_week" UNIQUE ("store_id", "year", "week"),
  CONSTRAINT "ck_sales_target_week" CHECK ("week" BETWEEN 0 AND 53),
  CONSTRAINT "ck_sales_target_growth" CHECK ("growth_pct" BETWEEN -100 AND 1000)
);
CREATE OR REPLACE TRIGGER "trg_sales_target_updated_at" BEFORE UPDATE ON "sales_target" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "sales_target" IS 'Objetivo de venta: % sobre el año anterior (o importe fijo) para la proyección del Gestor de cierres';
COMMENT ON COLUMN "sales_target"."id" IS 'Id';
COMMENT ON COLUMN "sales_target"."store_id" IS 'Local';
COMMENT ON COLUMN "sales_target"."year" IS 'Año ISO';
COMMENT ON COLUMN "sales_target"."week" IS '0 = todo el año; 1–53 = semana ISO concreta (manda sobre el anual)';
COMMENT ON COLUMN "sales_target"."growth_pct" IS 'Crecimiento sobre la misma semana del año anterior (%)';
COMMENT ON COLUMN "sales_target"."amount" IS 'Importe fijo de la semana (si está, manda sobre el %)';
COMMENT ON COLUMN "sales_target"."note" IS 'Nota (campaña, obra, festivo…)';
COMMENT ON COLUMN "sales_target"."version" IS 'Versión del registro';

-- ───────────────────────── 4. Carta programada desde el Manager ─────────────────────────
-- El Manager envía cartas completas o solo precios con fecha de entrada en vigor; la tienda las guarda y las aplica a su hora.
CREATE TABLE IF NOT EXISTS "catalog_release" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "kind" VARCHAR(20) NOT NULL CHECK ("kind" IN ('full','prices')),
  "release_version" INTEGER NOT NULL,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','applied','failed','superseded','cancelled')),
  "payload" JSONB NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "applied_at" TIMESTAMPTZ(3),
  "error" VARCHAR(300),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_catalog_release_store_id_release_version" UNIQUE ("store_id", "release_version")
);
CREATE INDEX IF NOT EXISTS "ix_catalog_release_store_id_status_effective_at" ON "catalog_release" ("store_id", "status", "effective_at");
CREATE OR REPLACE TRIGGER "trg_catalog_release_updated_at" BEFORE UPDATE ON "catalog_release" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "catalog_release" IS 'Cartas enviadas por Japp Manager (completas o solo precios) con su fecha de entrada en vigor';
COMMENT ON COLUMN "catalog_release"."id" IS 'Id de la publicación en el Manager';
COMMENT ON COLUMN "catalog_release"."store_id" IS 'Local';
COMMENT ON COLUMN "catalog_release"."kind" IS 'full = carta completa (categorías, productos, preguntas, canales) · prices = solo PVP general/terraza';
COMMENT ON COLUMN "catalog_release"."release_version" IS 'Versión correlativa del Manager: una versión menor que la aplicada no se aplica';
COMMENT ON COLUMN "catalog_release"."effective_at" IS 'Cuándo entra en vigor (se aplica al abrir el primer periodo a partir de esa hora)';
COMMENT ON COLUMN "catalog_release"."status" IS 'pending · applied · failed · superseded (llegó otra más nueva) · cancelled (anulada desde el Manager)';
COMMENT ON COLUMN "catalog_release"."payload" IS 'Carta en JSON tal como la manda el Manager';
COMMENT ON COLUMN "catalog_release"."checksum" IS 'SHA-256 del payload: misma versión con otro contenido se rechaza';
COMMENT ON COLUMN "catalog_release"."received_at" IS 'Recibida';
COMMENT ON COLUMN "catalog_release"."applied_at" IS 'Aplicada';
COMMENT ON COLUMN "catalog_release"."error" IS 'Motivo del fallo al aplicar';
