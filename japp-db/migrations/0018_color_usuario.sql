-- 0018 · Color de cada usuario (25/10/2026).
-- En el TPV y la PDA, lo que marcó cada persona lleva una etiqueta con su nombre en su color; se elige en
-- Ajustes › Usuarios. Vacío = el TPV le da uno de la paleta según el nombre.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "color" VARCHAR(7);
ALTER TABLE "app_user" DROP CONSTRAINT IF EXISTS "ck_app_user_color";
ALTER TABLE "app_user" ADD CONSTRAINT "ck_app_user_color" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-Fa-f]{6}$');
COMMENT ON COLUMN "app_user"."color" IS 'Color de la persona en el TPV (#RRGGBB): etiqueta de lo que marcó y su nombre en las mesas. NULL = automático';
