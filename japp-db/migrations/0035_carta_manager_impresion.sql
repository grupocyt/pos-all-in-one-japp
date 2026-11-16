-- 0035 · Carta del Manager, canales y cola de impresión (16/11/2026, API 1.2.270)
--
-- 1) Publicación de Carta (JSON «Campos del JSON · Publicación de Carta al TPV»): descripción y traducciones,
--    texto del botón propio, calificativos, preguntas obligatorias / única o múltiple, y cada carga recibida
--    en catalog_release con su publicación, tipo, menú y línea de precios.
-- 2) Canales: solo los dos del Manager, COMIDA y BEBIDA (code). Los demás canales de comanda (hechos a mano y copias)
--    se borran con sus impresoras por equipo y sus productos. Los canales de ticket (precuenta y factura por área) no se tocan.
-- 3) Cola de impresión (print_job): guardar y enviar ya no esperan a la impresora.
-- 4) Order on Table encendido o apagado (store.oot_enabled).

-- Order on Table encendido o apagado (Ajustes › Restaurante). Apagado: sin botón en la mesa, sin QR y la API no da carta ni pedidos
ALTER TABLE "store" ADD COLUMN IF NOT EXISTS "oot_enabled" BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN "store"."oot_enabled" IS 'Order on Table encendido (por defecto) o apagado';

-- ───────────────────────── 1. Carta ─────────────────────────
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "description" VARCHAR(300);
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "translations" JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN "category"."description" IS 'Descripción (Carta)';
COMMENT ON COLUMN "category"."translations" IS 'Textos por idioma: {"en":{"name":"…"}} (Order on Table)';

ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "button_label" VARCHAR(80);
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "translations" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "qualifier" BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN "product"."button_label" IS 'Texto del botón; null = el nombre del PLU. Una tecla sin texto propio usa este';
COMMENT ON COLUMN "product"."translations" IS 'Textos por idioma: name, ticketName, buttonLabel, description';
COMMENT ON COLUMN "product"."qualifier" IS 'Calificativo: texto rápido del comentario (SIN SAL, POCO HECHO…)';
-- el texto propio que ya tenía la tecla de su categoría pasa al producto
UPDATE "product" p SET "button_label" = btrim(cp."label")
  FROM "category_product" cp
 WHERE cp."product_id" = p."id" AND cp."category_id" = p."category_id" AND p."button_label" IS NULL
   AND cp."label" IS NOT NULL AND btrim(cp."label") <> '' AND btrim(cp."label") <> p."name";
-- los productos que ya se usan como calificativos (categoría CALIFICATIVOS) quedan marcados
UPDATE "product" p SET "qualifier" = TRUE
  FROM "category" c WHERE c."id" = p."category_id" AND upper(c."name") = 'CALIFICATIVOS' AND NOT p."qualifier";

ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "plu" INTEGER;
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "description" VARCHAR(300);
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "required" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "answer_type" VARCHAR(10) NOT NULL DEFAULT 'unica';
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "course_name" VARCHAR(40);
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "translations" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "question" DROP CONSTRAINT IF EXISTS "ck_question_answer_type";
ALTER TABLE "question" ADD CONSTRAINT "ck_question_answer_type" CHECK ("answer_type" IN ('unica', 'multiple'));
-- lo que ya hacían las preguntas: obligatoria si pide al menos una respuesta; múltiple si deja más de una
UPDATE "question" SET "required" = ("min_answers" > 0),
       "answer_type" = CASE WHEN "max_answers" > 1 THEN 'multiple' ELSE 'unica' END;
COMMENT ON COLUMN "question"."plu" IS 'PLU de la pregunta (Carta), si tiene';
COMMENT ON COLUMN "question"."required" IS 'Obligatoria: no se puede saltar';
COMMENT ON COLUMN "question"."answer_type" IS 'unica (una respuesta) o multiple (varias)';
COMMENT ON COLUMN "question"."course_name" IS 'Nombre del pase: Bebida, Primero, Segundo, Postre';
COMMENT ON COLUMN "question"."translations" IS 'Textos por idioma: name, description';

ALTER TABLE "question_answer" ADD COLUMN IF NOT EXISTS "translations" JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN "question_answer"."translations" IS 'Texto de la respuesta por idioma: {"en":{"label":"…"}}';

-- catalog_release: cada carga del Manager (completa, precios, nombres o retirar)
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "publication_id" VARCHAR(60) NOT NULL DEFAULT '';
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "publication_type" VARCHAR(20);
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "menu" VARCHAR(60);
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "price_line" VARCHAR(60);
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "store_code" VARCHAR(20);
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "note" VARCHAR(300);
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "result" JSONB;
ALTER TABLE "catalog_release" ADD COLUMN IF NOT EXISTS "decided_by" VARCHAR(60);
ALTER TABLE "catalog_release" DROP CONSTRAINT IF EXISTS "catalog_release_kind_check";
ALTER TABLE "catalog_release" DROP CONSTRAINT IF EXISTS "ck_catalog_release_kind";
ALTER TABLE "catalog_release" ADD CONSTRAINT "ck_catalog_release_kind" CHECK ("kind" IN ('full', 'prices', 'names', 'withdraw'));
ALTER TABLE "catalog_release" DROP CONSTRAINT IF EXISTS "catalog_release_status_check";
ALTER TABLE "catalog_release" DROP CONSTRAINT IF EXISTS "ck_catalog_release_status";
ALTER TABLE "catalog_release" ADD CONSTRAINT "ck_catalog_release_status"
  CHECK ("status" IN ('pending', 'confirm', 'applied', 'unchanged', 'failed', 'superseded', 'cancelled'));
ALTER TABLE "catalog_release" DROP CONSTRAINT IF EXISTS "uq_catalog_release_store_id_release_version";
ALTER TABLE "catalog_release" DROP CONSTRAINT IF EXISTS "uq_catalog_release_publication";
ALTER TABLE "catalog_release" ADD CONSTRAINT "uq_catalog_release_publication" UNIQUE ("store_id", "publication_id", "release_version");
COMMENT ON COLUMN "catalog_release"."kind" IS 'full = carta completa · prices = solo precios · names = solo nombres · withdraw = retirar la carta';
COMMENT ON COLUMN "catalog_release"."status" IS 'pending (espera su hora) · confirm (retirar: espera a un encargado) · applied · unchanged (ya estaba igual) · failed · superseded (llegó otra más nueva) · cancelled (no se aplicó)';
COMMENT ON COLUMN "catalog_release"."publication_id" IS 'Id de la publicación en Carta: publicación + versión + tienda = una carga';
COMMENT ON COLUMN "catalog_release"."result" IS 'Qué hizo al aplicarse (recuentos y versión de la configuración)';
COMMENT ON COLUMN "catalog_release"."decided_by" IS 'Quién la confirmó o la canceló (retirar)';

-- ───────────────────────── 2. Canales: solo COMIDA y BEBIDA ─────────────────────────
ALTER TABLE "print_channel" ADD COLUMN IF NOT EXISTS "code" VARCHAR(20);
COMMENT ON COLUMN "print_channel"."code" IS 'COMIDA o BEBIDA: los dos canales del Manager (fijos). null = canal de ticket';
-- tiendas antiguas: BARRA es la de bebidas
UPDATE "print_channel" c SET "name" = 'BEBIDA'
 WHERE c."name" = 'BARRA' AND c."kind" = 'kitchen' AND c."copy_of_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "print_channel" x WHERE x."store_id" = c."store_id" AND x."name" = 'BEBIDA');
-- el que falte se crea con la impresora de su tipo (cocina para COMIDA, barra para BEBIDA) o, si no hay, la primera activa
INSERT INTO "print_channel" ("id", "store_id", "name", "active", "kind", "printer_id")
SELECT gen_random_uuid(), st."id", n.name, TRUE, 'kitchen',
       (SELECT p."id" FROM "printer" p WHERE p."store_id" = st."id" AND p."active"
         ORDER BY (p."kind" = n.pk) DESC, (p."kind" <> 'ticket') DESC, p."name" LIMIT 1)
  FROM "store" st CROSS JOIN (VALUES ('COMIDA', 'kitchen'), ('BEBIDA', 'bar')) n(name, pk)
 WHERE NOT EXISTS (SELECT 1 FROM "print_channel" c WHERE c."store_id" = st."id" AND c."name" = n.name);
UPDATE "print_channel" SET "code" = "name", "kind" = 'kitchen', "copy_of_id" = NULL, "active" = TRUE
 WHERE "name" IN ('COMIDA', 'BEBIDA');
DO $$
DECLARE gone TEXT;
BEGIN
  SELECT string_agg(DISTINCT "name", ', ' ORDER BY "name") INTO gone FROM "print_channel" WHERE "kind" = 'kitchen' AND "code" IS NULL;
  IF gone IS NOT NULL THEN
    RAISE NOTICE '0035 · canales borrados (solo quedan COMIDA y BEBIDA): %', gone;
  END IF;
END $$;
-- las copias primero (copy_of_id no borra en cascada) y después el resto; sus productos e impresoras por equipo caen en cascada
DELETE FROM "print_channel" WHERE "kind" = 'kitchen' AND "code" IS NULL AND "copy_of_id" IS NOT NULL;
DELETE FROM "print_channel" WHERE "kind" = 'kitchen' AND "code" IS NULL;
DROP INDEX IF EXISTS "uq_print_channel_code";
CREATE UNIQUE INDEX "uq_print_channel_code" ON "print_channel" ("store_id", "code") WHERE "code" IS NOT NULL;
ALTER TABLE "print_channel" DROP CONSTRAINT IF EXISTS "ck_print_channel_code";
ALTER TABLE "print_channel" ADD CONSTRAINT "ck_print_channel_code" CHECK (
  ("code" IS NULL AND "kind" = 'ticket')
  OR ("code" IS NOT NULL AND "code" IN ('COMIDA', 'BEBIDA') AND "kind" = 'kitchen' AND "copy_of_id" IS NULL));
-- los productos solo van a COMIDA o BEBIDA (nunca a un canal de ticket)
DELETE FROM "product_channel" pc USING "print_channel" c WHERE c."id" = pc."channel_id" AND c."code" IS NULL;

-- ───────────────────────── 3. Cola de impresión ─────────────────────────
CREATE TABLE IF NOT EXISTS "print_job" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "seq" BIGSERIAL NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "order_id" UUID,
  "account_id" UUID,
  "station_id" UUID,
  "channel" VARCHAR(40) NOT NULL,
  "printer_name" VARCHAR(60) NOT NULL,
  "connection" VARCHAR(120) NOT NULL,
  "job" JSONB NOT NULL,
  "line_printer_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
  "attempts" SMALLINT NOT NULL DEFAULT 0,
  "last_error" VARCHAR(300),
  "next_try_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by" VARCHAR(60),
  "created_device" VARCHAR(40),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "printed_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "ck_print_job_status" CHECK ("status" IN ('pending', 'printing', 'printed', 'failed', 'cancelled')),
  CONSTRAINT "ck_print_job_kind" CHECK ("kind" IN ('kitchen', 'void', 'prebill', 'invoice', 'cutx', 'cutz', 'count', 'oot', 'test', 'drawer', 'notice'))
);
CREATE INDEX IF NOT EXISTS "ix_print_job_pending" ON "print_job" ("status", "next_try_at") WHERE "status" IN ('pending', 'printing');
CREATE INDEX IF NOT EXISTS "ix_print_job_store_created" ON "print_job" ("store_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ix_print_job_order" ON "print_job" ("order_id") WHERE "order_id" IS NOT NULL;
CREATE OR REPLACE TRIGGER "trg_print_job_updated_at" BEFORE UPDATE ON "print_job" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE "print_job" IS 'Cola de impresión: cada papel que hay que sacar. Lo imprime la API en segundo plano (guardar no espera a la impresora)';
COMMENT ON COLUMN "print_job"."seq" IS 'Orden de llegada: cada impresora saca sus papeles en este orden';
COMMENT ON COLUMN "print_job"."kind" IS 'kitchen (comanda, marchar, cambio de pase) · void (anulación) · prebill · invoice · cutx · cutz · count (arqueo) · oot (QR) · test · drawer · notice';
COMMENT ON COLUMN "print_job"."job" IS 'El papel ya armado (líneas del ticket, cajón, logo): se imprime tal cual aunque cambie la configuración';
COMMENT ON COLUMN "print_job"."line_printer_ids" IS 'order_line_printer que quedan «impresas» cuando sale (comandas)';
COMMENT ON COLUMN "print_job"."status" IS 'pending · printing · printed · failed (5 min sin salir: Gestiones › Impresiones) · cancelled';
COMMENT ON COLUMN "print_job"."next_try_at" IS 'Siguiente intento: 2, 5, 15 y 30 s y después cada minuto';
