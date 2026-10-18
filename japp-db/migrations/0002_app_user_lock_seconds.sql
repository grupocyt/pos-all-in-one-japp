-- 0002 · Bloqueo de sesión por usuario (Ajustes › Usuarios › «Bloqueo de sesión»).
-- NULL = el de la tienda (store_parameters.lock_seconds en TPV, lock_seconds_pda en móvil). 0 = nunca se bloquea.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "lock_seconds" SMALLINT;
DO $$ BEGIN
  ALTER TABLE "app_user" ADD CONSTRAINT "ck_app_user_lock_seconds" CHECK ("lock_seconds" IS NULL OR "lock_seconds" BETWEEN 0 AND 3600);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN "app_user"."lock_seconds" IS 'Segundos de inactividad hasta pedir la clave; NULL = el de store_parameters; 0 = nunca';
