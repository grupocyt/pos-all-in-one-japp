-- 0021 · Segunda pantalla del cliente (25/10/2026): Ajustes › Restaurante › Banners.
-- customer_display: una fila por tienda con la configuración (tipo, textos, color, opciones de ticket, reproducción) y su versión.
-- display_media: los vídeos e imágenes de la lista con su horario. El archivo va en disco, en MEDIA_DIR del servidor
-- (<MEDIA_DIR>/<id>); aquí quedan sus datos, su huella sha256 y el orden. Quitar uno lo marca deleted_at (no se borra la fila).
CREATE TABLE IF NOT EXISTS "customer_display" (
  "store_id" UUID PRIMARY KEY REFERENCES "store"("id"),
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_by" VARCHAR(80),
  CONSTRAINT "ck_customer_display_config" CHECK (jsonb_typeof("config") = 'object')
);
DROP TRIGGER IF EXISTS "trg_customer_display_updated_at" ON "customer_display";
CREATE TRIGGER "trg_customer_display_updated_at" BEFORE UPDATE ON "customer_display" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "customer_display" IS 'Segunda pantalla del cliente: configuración por tienda (Ajustes › Restaurante › Banners)';
COMMENT ON COLUMN "customer_display"."config" IS 'mode (off|billing|billing_banner|banner; los banners solo en fast food), greeting, name, color, farewell, reviewUrl, sideTitle, tickets{email,print,invoice,none}, loop, muted, imageSeconds';

CREATE TABLE IF NOT EXISTS "display_media" (
  "id" UUID PRIMARY KEY,
  "store_id" UUID NOT NULL REFERENCES "store"("id"),
  "kind" VARCHAR(10) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "mime" VARCHAR(60) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "duration_s" INTEGER,
  "sha256" CHAR(64) NOT NULL,
  "days" SMALLINT[] NOT NULL DEFAULT '{}',
  "time_from" TIME,
  "time_to" TIME,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by" VARCHAR(80),
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "ck_display_media_kind" CHECK ("kind" IN ('video','image')),
  CONSTRAINT "ck_display_media_mime" CHECK ("mime" ~ '^(video|image)/[a-z0-9.+-]+$'),
  CONSTRAINT "ck_display_media_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 314572800),
  CONSTRAINT "ck_display_media_duration" CHECK ("duration_s" IS NULL OR "duration_s" >= 0),
  CONSTRAINT "ck_display_media_sha" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_display_media_days" CHECK ("days" <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[])
);
CREATE INDEX IF NOT EXISTS "ix_display_media_store_id" ON "display_media" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_display_media_live" ON "display_media" ("store_id", "sort_order") WHERE "deleted_at" IS NULL;
COMMENT ON TABLE "display_media" IS 'Vídeos e imágenes de la segunda pantalla; el archivo está en MEDIA_DIR/<id> del servidor de la tienda';
COMMENT ON COLUMN "display_media"."days" IS 'Días en que sale: 1 = lunes … 7 = domingo; vacío = todos';
COMMENT ON COLUMN "display_media"."time_from" IS 'Desde (hora de Madrid); con time_to menor, cruza la medianoche; vacío = todo el día';
