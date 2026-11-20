-- 0044 · 1.2.293 (20/11/2026, noche) · decisiones del dueño
-- 1) Agotado y desactivar un producto en la tienda valen hasta el día siguiente: al abrir el periodo siguiente se
--    reactivan solos (la API lo hace al abrir). «local_off» marca lo desactivado en la tienda; lo desactivado por el
--    Manager (sync de la carta) no lleva la marca y no se toca.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "local_off" BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN "product"."local_off" IS 'Desactivado en la tienda (no desde el Manager): se reactiva solo al abrir el periodo siguiente';

-- 2) Tablero de pedidos (delivery): por defecto solo el Cajero (y el Administrador, que lo tiene todo). Se puede dar a
--    otros perfiles en Ajustes › Accesos.
DELETE FROM "profile_permission" pp
 USING "user_profile" p
 WHERE p."id" = pp."profile_id" AND pp."permission_code" = 'funciones.pedidos' AND p."code" NOT IN ('CAJERO', 'ADMIN');
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", 'funciones.pedidos', p."store_id" FROM "user_profile" p WHERE p."code" IN ('CAJERO', 'ADMIN')
ON CONFLICT DO NOTHING;

-- 3) Un solo periodo por día (fecha de apertura en hora de España): lo comprueba la API al abrir (409 PERIOD_DAY_USED).
CREATE INDEX IF NOT EXISTS "ix_sales_period_store_opened" ON "sales_period" ("store_id", "opened_by_at");
