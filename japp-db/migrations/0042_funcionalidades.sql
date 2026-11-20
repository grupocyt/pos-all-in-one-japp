-- 0042 · 1.2.289 (20/11/2026)
-- Ajustes › Funcionalidades: funciones desactivadas para todo el sistema (nadie las puede usar, ni con la clave de un encargado).
-- Lista de claves: transferir, pasarCuenta, separar, eliminaciones, descuentos, clientes, reabrir, abonar, abrirCajon, cajaChica,
-- pedidos, editarPlano, ordenImpresion, miVenta (packages/domain/src/features.ts). [] = todo activo.
ALTER TABLE "store_parameters" ADD COLUMN IF NOT EXISTS "disabled_features" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "store_parameters" DROP CONSTRAINT IF EXISTS "ck_store_parameters_disabled_features";
ALTER TABLE "store_parameters" ADD CONSTRAINT "ck_store_parameters_disabled_features"
  CHECK (jsonb_typeof("disabled_features") = 'array' AND jsonb_array_length("disabled_features") <= 30);
COMMENT ON COLUMN "store_parameters"."disabled_features" IS 'Ajustes › Funcionalidades: claves de las funciones desactivadas para todo el sistema; [] = todo activo';
