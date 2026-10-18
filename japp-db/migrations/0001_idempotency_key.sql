-- 0001 · Respuestas guardadas por Idempotency-Key (PDA con wifi inestable: reintentar no duplica cobros ni líneas).
CREATE TABLE IF NOT EXISTS "idempotency_key" (
  "store_id" UUID NOT NULL REFERENCES "store" ("id"),
  "key" VARCHAR(80) NOT NULL,
  "method" VARCHAR(8) NOT NULL,
  "path" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "status_code" SMALLINT NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("store_id", "key")
);
CREATE INDEX IF NOT EXISTS "ix_idempotency_key_created_at" ON "idempotency_key" ("created_at");
COMMENT ON TABLE "idempotency_key" IS 'Respuesta ya enviada para cada Idempotency-Key (se purga a los 7 días)';
COMMENT ON COLUMN "idempotency_key"."request_hash" IS 'SHA-256 del método + ruta + cuerpo: la misma clave con otro cuerpo es un error';
