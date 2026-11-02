-- 0023 · Ajustes › Administración › Sistema (TPV 1.2.206, 02/11/2026).
-- system_branding: una fila por tienda con el nombre del sistema (acceso, menú lateral y pestaña del navegador),
-- el subtítulo, el texto del grupo en la pantalla de acceso, el logo del sistema, el icono «Sin imagen»,
-- la paleta de colores que cada equipo puede elegir y los colores del sistema. La ven todos los equipos.
-- Sin fila = los valores originales (Japp, paleta Verde #15616D). Se edita con el permiso ajustes.restaurante.
-- Las imágenes van como data URL (PNG reescalado a 256 px o SVG): como mucho 190 000 caracteres, igual que en el TPV.
CREATE TABLE IF NOT EXISTS "system_branding" (
  "store_id"    UUID PRIMARY KEY REFERENCES "store" ("id"),
  "name"        VARCHAR(60) NOT NULL DEFAULT 'Japp',
  "subtitle"    VARCHAR(60),
  "login_group" VARCHAR(80),
  "logo"        TEXT,
  "no_image"    TEXT,
  "palette"     JSONB NOT NULL DEFAULT '[{"hex":"#15616D","name":"Verde","default":true}]'::jsonb,
  "colors"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version"     INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "updated_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by"  VARCHAR(80),
  CONSTRAINT "ck_system_branding_name" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "ck_system_branding_logo" CHECK ("logo" IS NULL OR ("logo" LIKE 'data:image/%' AND length("logo") <= 190000)),
  CONSTRAINT "ck_system_branding_no_image" CHECK ("no_image" IS NULL OR ("no_image" LIKE 'data:image/%' AND length("no_image") <= 190000)),
  CONSTRAINT "ck_system_branding_palette" CHECK (jsonb_typeof("palette") = 'array' AND jsonb_array_length("palette") BETWEEN 1 AND 12),
  CONSTRAINT "ck_system_branding_colors" CHECK (jsonb_typeof("colors") = 'object')
);
DROP TRIGGER IF EXISTS "trg_system_branding_updated_at" ON "system_branding";
CREATE TRIGGER "trg_system_branding_updated_at" BEFORE UPDATE ON "system_branding" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "system_branding" IS 'Ajustes › Administración › Sistema: nombre, textos del acceso, logos y colores del sistema (una fila por tienda; sin fila = los originales)';
COMMENT ON COLUMN "system_branding"."name" IS 'Nombre del sistema: acceso, menú lateral y pestaña del navegador («TPV <name>»)';
COMMENT ON COLUMN "system_branding"."login_group" IS 'Texto del grupo en la pantalla de acceso; vacío = no se enseña';
COMMENT ON COLUMN "system_branding"."logo" IS 'Logo del sistema como data URL (PNG ≤ 256 px o SVG); vacío = el original';
COMMENT ON COLUMN "system_branding"."no_image" IS 'Icono «Sin imagen» (productos sin foto) como data URL; vacío = el original';
COMMENT ON COLUMN "system_branding"."palette" IS 'Colores que se pueden elegir en cada equipo: [{hex:"#RRGGBB", name, default:true en uno solo}]';
COMMENT ON COLUMN "system_branding"."colors" IS 'Colores del sistema: secondary, bg, card, text, muted, line, link, ok, warn, err, info (#RRGGBB); el que falta = el original';
