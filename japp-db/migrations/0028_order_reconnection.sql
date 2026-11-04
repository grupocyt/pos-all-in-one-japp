-- 0028 · Reconexiones de la orden (decidido con el dueño el 04/11/2026, API 1.2.268).
-- Lo que un equipo ticó sin conexión con el servidor (se le fue el wifi o se cayó el servidor) nunca entra directo en la
-- cuenta: al volver la conexión se guarda aquí, pendiente. Quien tenga «Resolver reconexiones» (o con la clave de un
-- encargado) lo valida —pasa a la orden y sale la comanda— o lo descarta con un motivo. Mientras haya algo pendiente,
-- esa cuenta no se cobra. Nada se borra: queda quién lo marcó, en qué equipo, cuándo y quién decidió.
CREATE TABLE IF NOT EXISTS "order_reconnection" (
  "id" UUID PRIMARY KEY,
  "store_id" UUID NOT NULL REFERENCES "store" ("id") ON DELETE CASCADE,
  "order_id" UUID NOT NULL REFERENCES "orders" ("id") ON DELETE CASCADE,
  "account_id" UUID REFERENCES "account" ("id") ON DELETE SET NULL,
  "client_id" VARCHAR(80) NOT NULL,
  "plu" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "unit_price" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "detail" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "marked_at" TIMESTAMPTZ(3) NOT NULL,
  "marked_by_id" UUID,
  "marked_by_name" VARCHAR(60),
  "device" VARCHAR(40),
  "offline_reason" VARCHAR(80),
  "status" VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'accepted', 'discarded')),
  "decided_at" TIMESTAMPTZ(3),
  "decided_by_name" VARCHAR(60),
  "authorized_by_name" VARCHAR(60),
  "decision_reason" VARCHAR(200),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "uq_order_reconnection_client" UNIQUE ("store_id", "client_id")
);
CREATE INDEX IF NOT EXISTS "ix_order_reconnection_store_status" ON "order_reconnection" ("store_id", "status");
CREATE INDEX IF NOT EXISTS "ix_order_reconnection_order" ON "order_reconnection" ("order_id");
CREATE INDEX IF NOT EXISTS "ix_order_reconnection_account" ON "order_reconnection" ("account_id");
COMMENT ON TABLE "order_reconnection" IS 'Lo ticado sin conexión, pendiente de validar o descartar (Reconexiones de la orden)';
COMMENT ON COLUMN "order_reconnection"."client_id" IS 'Id que puso el equipo al marcarlo: un reintento no lo duplica';
COMMENT ON COLUMN "order_reconnection"."detail" IS 'Respuestas, comentario y pases tal como se marcaron';
COMMENT ON COLUMN "order_reconnection"."offline_reason" IS 'Motivo de la desconexión que vio el equipo (sin red, servidor sin respuesta)';

-- Permiso nuevo, configurable en Ajustes › Accesos: a quien ya puede autorizar (encargados)
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('pedido.reconexiones', 'Pedido', 'Resolver reconexiones', 17)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT "profile_id", 'pedido.reconexiones', "store_id" FROM "profile_permission" WHERE "permission_code" = 'sistema.autorizar'
ON CONFLICT DO NOTHING;
