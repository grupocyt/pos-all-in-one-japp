-- 0011 · Un UUID de equipo, una sola estación.
-- El TPV y la PDA se reconocen por su UUID al arrancar (POST /devices/identify): si dos estaciones activas
-- de la misma tienda tuvieran el mismo UUID, no se sabría cuál es. Vacío o NULL = sin equipo asignado.
-- Idempotente y sin tocar datos existentes (si hubiera repetidos, la migración falla y hay que resolverlos antes).

CREATE UNIQUE INDEX IF NOT EXISTS "uq_station_device_uuid" ON "station" ("store_id", lower("device_uuid"))
  WHERE "active" AND "device_uuid" IS NOT NULL AND "device_uuid" <> '';

COMMENT ON COLUMN "station"."device_uuid" IS
  'UUID del equipo (TPV o PDA) con el que se reconoce al arrancar; único entre las estaciones activas de la tienda';
