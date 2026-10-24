-- 0015 · Incidencias de mesa (25/10/2026).
-- Cuando un equipo pierde la conexión, ve que la mesa no cuadra con el servidor o el servidor le rechaza un cambio,
-- guarda aquí la incidencia SIN aplicar nada: los cambios pendientes, las diferencias o el error, quién, equipo y hora.
-- Lo que se hace después (reintentar el envío o quedarse con lo del servidor) lo decide una persona en ese equipo.
-- order_id y account_id no llevan FK: una mesa abierta sin conexión puede no existir aún en el servidor.
CREATE TABLE IF NOT EXISTS "order_incident" (
  "id"                     UUID PRIMARY KEY,
  "store_id"               UUID NOT NULL REFERENCES "store" ("id"),
  "order_id"               UUID,
  "account_id"             UUID,
  "table_name"             VARCHAR(20) NOT NULL,
  "kind"                   VARCHAR(20) NOT NULL CHECK ("kind" IN ('offline', 'mismatch', 'rejected')),
  "status"                 VARCHAR(20) NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'retried', 'discarded', 'resolved')),
  "detail"                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  "station_id"             UUID,
  "device"                 VARCHAR(60),
  "occurred_at"            TIMESTAMPTZ(3) NOT NULL,
  "opened_by_user_id"      UUID,
  "opened_by_user_name"    VARCHAR(80) NOT NULL,
  "opened_by_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "resolved_by_user_id"    UUID,
  "resolved_by_user_name"  VARCHAR(80),
  "resolved_authorized_by" VARCHAR(80),
  "resolved_by_at"         TIMESTAMPTZ(3),
  "resolution_note"        VARCHAR(200),
  "created_at"             TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "version"                INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ck_order_incident_resolved" CHECK (("status" = 'open') = ("resolved_by_at" IS NULL))
);
CREATE INDEX IF NOT EXISTS "ix_order_incident_store_id" ON "order_incident" ("store_id", "status", "opened_by_at" DESC);
CREATE INDEX IF NOT EXISTS "ix_order_incident_order_id" ON "order_incident" ("store_id", "order_id");
DROP TRIGGER IF EXISTS "trg_order_incident_updated_at" ON "order_incident";
CREATE TRIGGER "trg_order_incident_updated_at" BEFORE UPDATE ON "order_incident" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "order_incident" IS 'Incidencias de mesa: sin conexión, no cuadra con el servidor o cambio rechazado. Se guardan solas; resolverlas lo decide una persona en el equipo donde pasó';
COMMENT ON COLUMN "order_incident"."id" IS 'Lo genera el equipo: repetir el envío no duplica la incidencia';
COMMENT ON COLUMN "order_incident"."order_id" IS 'Orden de la mesa (sin FK: puede no existir aún en el servidor si se abrió sin conexión)';
COMMENT ON COLUMN "order_incident"."kind" IS 'offline (cambios que se quedaron en el equipo), mismatch (pantalla y servidor no coinciden) o rejected (el servidor no aceptó un cambio)';
COMMENT ON COLUMN "order_incident"."status" IS 'open; retried (se reintentó el envío), discarded (se quedó lo del servidor) o resolved (volvió a cuadrar sola)';
COMMENT ON COLUMN "order_incident"."detail" IS 'Cambios pendientes, diferencias o error, tal como los vio el equipo';
COMMENT ON COLUMN "order_incident"."device" IS 'Nombre del equipo donde pasó';
COMMENT ON COLUMN "order_incident"."occurred_at" IS 'Hora del equipo en que pasó (puede ser anterior a opened_by_at si estuvo sin conexión)';
COMMENT ON COLUMN "order_incident"."resolved_authorized_by" IS 'Encargado que autorizó la resolución, si hizo falta';
