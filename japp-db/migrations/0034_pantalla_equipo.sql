-- 0034 · Tamaño de pantalla por equipo (11/11/2026, API 1.2.269): hay TPV muy anchos y otros más altos.
-- Ajustes › Equipos (solo Administrador y Encargado): automático (toda la pantalla) o fijo (ancho × alto en píxeles) y la escala.
ALTER TABLE "station" ADD COLUMN IF NOT EXISTS "screen_mode" VARCHAR(10) NOT NULL DEFAULT 'auto';
ALTER TABLE "station" ADD COLUMN IF NOT EXISTS "screen_width" SMALLINT;
ALTER TABLE "station" ADD COLUMN IF NOT EXISTS "screen_height" SMALLINT;
ALTER TABLE "station" ADD COLUMN IF NOT EXISTS "ui_scale" SMALLINT NOT NULL DEFAULT 100;
ALTER TABLE "station" DROP CONSTRAINT IF EXISTS "ck_station_screen";
ALTER TABLE "station" ADD CONSTRAINT "ck_station_screen" CHECK (
  "screen_mode" IN ('auto', 'fixed')
  AND ("screen_width" IS NULL OR "screen_width" BETWEEN 800 AND 7680)
  AND ("screen_height" IS NULL OR "screen_height" BETWEEN 600 AND 4320)
  AND "ui_scale" BETWEEN 70 AND 150);
COMMENT ON COLUMN "station"."screen_mode" IS 'auto = toda la pantalla; fixed = screen_width × screen_height píxeles';
COMMENT ON COLUMN "station"."ui_scale" IS 'Escala del TPV en %, de 70 a 150 (botones, letras y ventanas)';
