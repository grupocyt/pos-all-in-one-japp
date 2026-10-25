-- 0017 · SLA de atención por mesa (25/10/2026).
-- Gestiones › Mesas en servicio mide, en vivo, cómo se atiende cada mesa abierta y lo compara con estos límites
-- (Ajustes › SLA de atención). Se mide solo con lo que la base ya guarda: apertura, cuándo se marca cada línea,
-- cuándo se envía a cocina, la precuenta y el cobro.
--   first_order_minutes  de abrir la mesa a marcar lo primero (la toma de nota)
--   unsent_minutes       algo marcado que lleva este tiempo sin enviarse a cocina
--   idle_minutes         desde el último envío a cocina sin volver a la mesa (antes de la precuenta)
--   prebill_pay_minutes  de la precuenta al cobro
--   total_minutes        la mesa abierta en total
-- Los límites van por tienda, zona o mesa, y cada uno para todos los turnos o para uno: manda la regla más concreta
-- (mesa+turno > mesa > zona+turno > zona > tienda+turno > tienda) y lo que una regla deja vacío lo hereda de la siguiente.

CREATE TABLE IF NOT EXISTS "service_shift" (
  "id"          UUID PRIMARY KEY,
  "store_id"    UUID NOT NULL REFERENCES "store" ("id"),
  "name"        VARCHAR(40) NOT NULL,
  "starts_at"   TIME(0) NOT NULL,
  "ends_at"     TIME(0) NOT NULL,
  "sort_order"  SMALLINT NOT NULL DEFAULT 1,
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ck_service_shift_span" CHECK ("starts_at" <> "ends_at"),
  CONSTRAINT "uq_service_shift_store_id_name" UNIQUE ("store_id", "name")
);
DROP TRIGGER IF EXISTS "trg_service_shift_updated_at" ON "service_shift";
CREATE TRIGGER "trg_service_shift_updated_at" BEFORE UPDATE ON "service_shift" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "service_shift" IS 'Turnos de servicio para los SLA de atención (p. ej. Comida 12:00–16:30, Cena 19:30–00:30). La mesa cuenta en el turno en que se abrió';
COMMENT ON COLUMN "service_shift"."ends_at" IS 'Si es menor que starts_at, el turno pasa de medianoche';

CREATE TABLE IF NOT EXISTS "service_sla" (
  "id"                   UUID PRIMARY KEY,
  "store_id"             UUID NOT NULL REFERENCES "store" ("id"),
  "area_id"              UUID REFERENCES "area" ("id") ON DELETE CASCADE,
  "table_id"             UUID REFERENCES "dining_table" ("id") ON DELETE CASCADE,
  "shift_id"             UUID REFERENCES "service_shift" ("id") ON DELETE CASCADE,
  "first_order_minutes"  SMALLINT,
  "unsent_minutes"       SMALLINT,
  "idle_minutes"         SMALLINT,
  "prebill_pay_minutes"  SMALLINT,
  "total_minutes"        SMALLINT,
  "warn_percent"         SMALLINT,
  "version"              INTEGER NOT NULL DEFAULT 1,
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ck_service_sla_scope" CHECK ("area_id" IS NULL OR "table_id" IS NULL),
  CONSTRAINT "ck_service_sla_minutes" CHECK (
    COALESCE("first_order_minutes", 1) BETWEEN 1 AND 600 AND COALESCE("unsent_minutes", 1) BETWEEN 1 AND 600 AND
    COALESCE("idle_minutes", 1) BETWEEN 1 AND 600 AND COALESCE("prebill_pay_minutes", 1) BETWEEN 1 AND 600 AND
    COALESCE("total_minutes", 1) BETWEEN 1 AND 600),
  CONSTRAINT "ck_service_sla_warn_percent" CHECK (COALESCE("warn_percent", 80) BETWEEN 50 AND 99),
  CONSTRAINT "ck_service_sla_store_default" CHECK (
    "area_id" IS NOT NULL OR "table_id" IS NOT NULL OR "shift_id" IS NOT NULL OR (
      "first_order_minutes" IS NOT NULL AND "unsent_minutes" IS NOT NULL AND "idle_minutes" IS NOT NULL AND
      "prebill_pay_minutes" IS NOT NULL AND "total_minutes" IS NOT NULL AND "warn_percent" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_sla_scope" ON "service_sla" ("store_id",
  COALESCE("area_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("table_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("shift_id", '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS "ix_service_sla_store_id" ON "service_sla" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_service_sla_area_id" ON "service_sla" ("area_id");
CREATE INDEX IF NOT EXISTS "ix_service_sla_table_id" ON "service_sla" ("table_id");
CREATE INDEX IF NOT EXISTS "ix_service_sla_shift_id" ON "service_sla" ("shift_id");
DROP TRIGGER IF EXISTS "trg_service_sla_updated_at" ON "service_sla";
CREATE TRIGGER "trg_service_sla_updated_at" BEFORE UPDATE ON "service_sla" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "service_sla" IS 'SLA de atención: minutos máximos de cada paso de la mesa por tienda, zona o mesa y turno. Vacío = hereda de la regla menos concreta';
COMMENT ON COLUMN "service_sla"."first_order_minutes" IS 'De abrir la mesa a marcar lo primero';
COMMENT ON COLUMN "service_sla"."unsent_minutes" IS 'Algo marcado sin enviar a cocina durante más de esto';
COMMENT ON COLUMN "service_sla"."idle_minutes" IS 'Desde el último envío a cocina sin volver a la mesa (antes de la precuenta)';
COMMENT ON COLUMN "service_sla"."prebill_pay_minutes" IS 'De la precuenta al cobro';
COMMENT ON COLUMN "service_sla"."total_minutes" IS 'La mesa abierta en total';
COMMENT ON COLUMN "service_sla"."warn_percent" IS 'A partir de este % del límite la mesa se pinta en ámbar (50–99)';
COMMENT ON COLUMN "service_sla"."version" IS 'Solo en la regla de la tienda: sube con cada cambio de la configuración de SLA (control de concurrencia)';

-- La regla de la tienda, para las tiendas que ya existen (los dos tiempos que ya había en Parámetros pasan aquí).
INSERT INTO "service_sla" ("id", "store_id", "first_order_minutes", "unsent_minutes", "idle_minutes", "prebill_pay_minutes", "total_minutes", "warn_percent")
SELECT gen_random_uuid(), s."id", 10, 3, LEAST(GREATEST(COALESCE(p."idle_table_minutes", 30), 1), 600),
       LEAST(GREATEST(COALESCE(p."prebill_to_pay_minutes", 6), 1), 600), 120, 80
FROM "store" s LEFT JOIN "store_parameters" p ON p."store_id" = s."id"
WHERE NOT EXISTS (SELECT 1 FROM "service_sla" x WHERE x."store_id" = s."id" AND x."area_id" IS NULL AND x."table_id" IS NULL AND x."shift_id" IS NULL);
