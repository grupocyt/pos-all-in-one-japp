-- 0009 · Sesiones y bloqueo de PIN en la base (antes en memoria: al reiniciar la API los tokens sustituidos volvían a valer).
--  1. app_session: una sesión vigente por usuario (la del último POST /sessions); un token vale solo si su jti es la vigente.
--  2. pin_attempt: fallos de PIN por equipo (UUID del equipo si la estación lo tiene; si no, la estación) y hasta cuándo está bloqueado.
-- Idempotente y sin tocar datos existentes.

-- 1 · Sesiones ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app_session" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "user_id" UUID NOT NULL REFERENCES "app_user" ("id"),
  "station_id" UUID REFERENCES "station" ("id"),
  "station_name" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "ended_at" TIMESTAMPTZ(3),
  "ended_reason" VARCHAR(20),
  "replaced_by_id" UUID,
  PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "app_session" ADD CONSTRAINT "ck_app_session_ended_reason" CHECK ("ended_reason" IN ('replaced','logout'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "app_session" ADD CONSTRAINT "ck_app_session_ended" CHECK (("ended_at" IS NULL) = ("ended_reason" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- la nueva sesión se inserta después de cerrar la anterior en la misma transacción: FK diferida
DO $$ BEGIN
  ALTER TABLE "app_session" ADD CONSTRAINT "fk_app_session_replaced_by" FOREIGN KEY ("replaced_by_id") REFERENCES "app_session" ("id") DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_session_current" ON "app_session" ("store_id", "user_id") WHERE "ended_at" IS NULL;
CREATE INDEX IF NOT EXISTS "ix_app_session_user_id" ON "app_session" ("user_id");
CREATE INDEX IF NOT EXISTS "ix_app_session_station_id" ON "app_session" ("station_id");
CREATE INDEX IF NOT EXISTS "ix_app_session_replaced_by_id" ON "app_session" ("replaced_by_id");
COMMENT ON TABLE "app_session" IS 'Sesiones de la API de tienda: una vigente por usuario (ended_at NULL). Un token solo vale si su jti es la vigente; si no, 401 SESSION_REPLACED';
COMMENT ON COLUMN "app_session"."id" IS 'jti del token de sesión';
COMMENT ON COLUMN "app_session"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "app_session"."user_id" IS 'Usuario que entró con su clave';
COMMENT ON COLUMN "app_session"."station_id" IS 'Equipo en el que entró';
COMMENT ON COLUMN "app_session"."station_name" IS 'Nombre del equipo, para el aviso «Tu clave se ha abierto en …»';
COMMENT ON COLUMN "app_session"."created_at" IS 'Cuándo entró';
COMMENT ON COLUMN "app_session"."expires_at" IS 'Caducidad del token (SESSION_HOURS)';
COMMENT ON COLUMN "app_session"."ended_at" IS 'Cuándo dejó de valer (NULL = vigente)';
COMMENT ON COLUMN "app_session"."ended_reason" IS 'replaced = entró de nuevo (en este u otro equipo) · logout = salió';
COMMENT ON COLUMN "app_session"."replaced_by_id" IS 'Sesión que la sustituyó';

-- 2 · Bloqueo de PIN ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pin_attempt" (
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "key" VARCHAR(80) NOT NULL,
  "failures" SMALLINT NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("store_id", "key")
);
DO $$ BEGIN
  ALTER TABLE "pin_attempt" ADD CONSTRAINT "ck_pin_attempt_failures" CHECK ("failures" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE TRIGGER "trg_pin_attempt_updated_at" BEFORE UPDATE ON "pin_attempt" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "pin_attempt" IS 'Fallos de PIN seguidos por equipo; tras store_parameters.pin_attempts queda bloqueado hasta locked_until';
COMMENT ON COLUMN "pin_attempt"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "pin_attempt"."key" IS 'device:<UUID del equipo> si la estación lo tiene; si no, station:<id>. user:<id> para la clave de encargado';
COMMENT ON COLUMN "pin_attempt"."failures" IS 'Fallos seguidos desde el último acierto o desbloqueo';
COMMENT ON COLUMN "pin_attempt"."locked_until" IS 'Teclado bloqueado hasta este momento (423 PIN_LOCKED)';
COMMENT ON COLUMN "pin_attempt"."updated_at" IS 'Último intento';
