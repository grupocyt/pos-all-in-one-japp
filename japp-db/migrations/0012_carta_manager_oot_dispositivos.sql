-- 0012 · Carta desde el App Manager, Order on Table y equipos.
--  1. category, product y question llevan «external_id» (el id del App Manager): los servicios de sync
--     (POST /config/carta/sync, /config/categorias/sync…) casan por él, y si vuelve uno quitado se reactiva
--     con su mismo id. Productos con descripción (se imprime) y categorías/productos con «order_on_table».
--  2. store.web_order_url: URL base del sistema de Order on Table (QR = web_order_url + /t/ + token).
--  3. oot_token: un token por orden abierta; caduca al cerrar la mesa (revoked_at) o al anularlo.
--  4. Permiso mesas.orderOnTable (generar y anular el QR), concedido a ADMIN y ADMIN_LOCAL.
--  5. invoice_credit_line: qué unidades de cada línea abona cada rectificativa (abono parcial por líneas).
--  6. Transacción completa en la cola de sincronización: un índice para quedarse con la última de cada orden.
-- Idempotente y sin tocar datos existentes.

-- 1 · Carta del App Manager ------------------------------------------------------------------------------------------
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "external_id" VARCHAR(60);
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "order_on_table" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "external_id" VARCHAR(60);
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "description" VARCHAR(300);
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "order_on_table" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "external_id" VARCHAR(60);

-- Un external_id por tienda (también entre registros desactivados: así se reactiva el mismo).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_category_external_id" ON "category" ("store_id", "external_id")
  WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_external_id" ON "product" ("store_id", "external_id")
  WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_question_external_id" ON "question" ("store_id", "external_id")
  WHERE "external_id" IS NOT NULL;

COMMENT ON COLUMN "category"."external_id" IS 'Id en el App Manager (casa los servicios de sync); único por tienda';
COMMENT ON COLUMN "category"."order_on_table" IS 'Sale en la carta de Order on Table';
COMMENT ON COLUMN "product"."external_id" IS 'Id en el App Manager (casa los servicios de sync); único por tienda';
COMMENT ON COLUMN "product"."description" IS 'Descripción: se imprime debajo del producto en MAYÚSCULAS (una línea por salto)';
COMMENT ON COLUMN "product"."order_on_table" IS 'Se puede pedir desde Order on Table (además de su categoría)';
COMMENT ON COLUMN "question"."external_id" IS 'Id en el App Manager (casa los servicios de sync); único por tienda';

-- 2 · URL de Order on Table -------------------------------------------------------------------------------------------
ALTER TABLE "store" ADD COLUMN IF NOT EXISTS "web_order_url" VARCHAR(300);
COMMENT ON COLUMN "store"."web_order_url" IS 'URL base de Order on Table; el QR de la mesa es esta URL + /t/ + token';

-- 3 · Tokens de Order on Table ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "oot_token" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "order_id" UUID NOT NULL REFERENCES "orders" ("id"),
  "token" VARCHAR(60) NOT NULL,
  "created_by_user_id" UUID REFERENCES "app_user" ("id"),
  "created_by_user_name" VARCHAR(60),
  "created_by_device" VARCHAR(40),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMPTZ(3),
  "revoked_reason" VARCHAR(30) CHECK ("revoked_reason" IN ('manual', 'closed', 'transferred')),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_oot_token_token" UNIQUE ("token")
);
-- Un token vigente por orden: generar otra vez devuelve el mismo.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_oot_token_order_live" ON "oot_token" ("order_id") WHERE "revoked_at" IS NULL;
CREATE INDEX IF NOT EXISTS "ix_oot_token_store_id" ON "oot_token" ("store_id");
CREATE INDEX IF NOT EXISTS "ix_oot_token_created_by_user_id" ON "oot_token" ("created_by_user_id");
COMMENT ON TABLE "oot_token" IS 'Token del QR de Order on Table de una orden abierta (caduca al cerrar la mesa)';
COMMENT ON COLUMN "oot_token"."id" IS 'Identificador';
COMMENT ON COLUMN "oot_token"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "oot_token"."order_id" IS 'Orden (mesa) a la que pide el cliente';
COMMENT ON COLUMN "oot_token"."token" IS 'Token opaco del QR (oot_ + 32 caracteres aleatorios)';
COMMENT ON COLUMN "oot_token"."created_by_user_id" IS 'Quién lo generó';
COMMENT ON COLUMN "oot_token"."created_by_user_name" IS 'Nombre de quién lo generó';
COMMENT ON COLUMN "oot_token"."created_by_device" IS 'Equipo desde el que se generó';
COMMENT ON COLUMN "oot_token"."created_at" IS 'Cuándo se generó';
COMMENT ON COLUMN "oot_token"."revoked_at" IS 'Cuándo dejó de valer (NULL = vigente)';
COMMENT ON COLUMN "oot_token"."revoked_reason" IS 'manual (anulado), closed (mesa cerrada) o transferred (mesa cambiada)';

-- 4 · Permiso ---------------------------------------------------------------------------------------------------------
INSERT INTO "permission" ("code", "module", "name", "sort_order")
VALUES ('mesas.orderOnTable', 'Mesas', 'Order on Table (QR de la mesa)', 16)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
SELECT p.id, 'mesas.orderOnTable', p.store_id FROM "user_profile" p WHERE p.code IN ('ADMIN', 'ADMIN_LOCAL')
ON CONFLICT DO NOTHING;

-- 5 · Abonos por líneas ---------------------------------------------------------------------------------------------
-- Una rectificativa puede abonar solo algunas unidades; aquí queda cuánto de cada línea, para no abonar dos veces.
CREATE TABLE IF NOT EXISTS "invoice_credit_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "credit_invoice_id" UUID NOT NULL REFERENCES "invoice" ("id"),
  "rectified_invoice_id" UUID NOT NULL REFERENCES "invoice" ("id"),
  "order_line_id" UUID NOT NULL REFERENCES "order_line" ("id"),
  "quantity" NUMERIC(9,3) NOT NULL CHECK ("quantity" > 0),
  "amount" NUMERIC(10,2) NOT NULL CHECK ("amount" >= 0),
  "tax_rate" NUMERIC(5,2) NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_invoice_credit_line" UNIQUE ("credit_invoice_id", "order_line_id")
);
CREATE INDEX IF NOT EXISTS "ix_invoice_credit_line_rectified" ON "invoice_credit_line" ("rectified_invoice_id", "order_line_id");
CREATE INDEX IF NOT EXISTS "ix_invoice_credit_line_order_line_id" ON "invoice_credit_line" ("order_line_id");
CREATE INDEX IF NOT EXISTS "ix_invoice_credit_line_store_id" ON "invoice_credit_line" ("store_id");
COMMENT ON TABLE "invoice_credit_line" IS 'Unidades de cada línea que abona una rectificativa (abono total o parcial)';
COMMENT ON COLUMN "invoice_credit_line"."id" IS 'Identificador';
COMMENT ON COLUMN "invoice_credit_line"."store_id" IS 'Local al que pertenece';
COMMENT ON COLUMN "invoice_credit_line"."credit_invoice_id" IS 'Rectificativa (R1 o R5)';
COMMENT ON COLUMN "invoice_credit_line"."rectified_invoice_id" IS 'Factura que se abona';
COMMENT ON COLUMN "invoice_credit_line"."order_line_id" IS 'Línea vendida que se abona';
COMMENT ON COLUMN "invoice_credit_line"."quantity" IS 'Unidades abonadas';
COMMENT ON COLUMN "invoice_credit_line"."amount" IS 'Importe abonado con IVA (en positivo; la rectificativa lleva el total en negativo)';
COMMENT ON COLUMN "invoice_credit_line"."tax_rate" IS 'Tipo de IVA de la línea';

-- 6 · Cola de sincronización ------------------------------------------------------------------------------------------
-- El agente manda solo la última transacción de cada orden pendiente: este índice la encuentra sin recorrer la cola.
CREATE INDEX IF NOT EXISTS "ix_sync_outbox_entity_pending" ON "sync_outbox" ("store_id", "entity", "entity_id", "id")
  WHERE "sent_at" IS NULL AND "parked_at" IS NULL;
