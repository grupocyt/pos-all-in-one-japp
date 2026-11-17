-- 0038 · 1.2.281 (17/11/2026): los equipos (TPV y PDA) se reconocen SOLO por su IP; el UUID del equipo ya no se usa.
-- 1) Fuera la regla «un UUID, una sola estación» (0011): era la que daba «Ese UUID de equipo ya lo tiene otra estación activa».
-- 2) Se vacía el UUID de todas las estaciones: así nadie queda atado a un UUID viejo (la API ya no lo mira).
-- 3) Si alguna estación tenía UUID, sube la versión de la configuración para que cada TPV y PDA lo relea al entrar.
DROP INDEX IF EXISTS "uq_station_device_uuid";
UPDATE "store" s SET "config_version" = s."config_version" + 1
 WHERE EXISTS (SELECT 1 FROM "station" t WHERE t."store_id" = s."id" AND t."device_uuid" IS NOT NULL);
UPDATE "station" SET "device_uuid" = NULL, "version" = "version" + 1, "updated_at" = now() WHERE "device_uuid" IS NOT NULL;
COMMENT ON COLUMN "station"."device_uuid" IS 'Sin uso desde 1.2.281: los equipos se reconocen por su IP (station.ip)';
