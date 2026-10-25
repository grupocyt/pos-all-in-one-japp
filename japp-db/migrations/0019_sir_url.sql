-- 0019 · URL de la interfaz de ventas al SIR (25/10/2026).
-- Al cerrar el periodo, el TPV consulta lo que se manda al SIR (Sistema Integrado de Restaurantes) y lo puede enviar
-- (SOAP interfaceVentasAgregadores) a esta URL. El código del restaurante en el SIR es store.maxpoint_rst_id (IdIntegración).
ALTER TABLE "store" ADD COLUMN IF NOT EXISTS "sir_url" VARCHAR(300);
ALTER TABLE "store" DROP CONSTRAINT IF EXISTS "ck_store_sir_url";
ALTER TABLE "store" ADD CONSTRAINT "ck_store_sir_url" CHECK ("sir_url" IS NULL OR "sir_url" ~* '^https?://');
COMMENT ON COLUMN "store"."sir_url" IS 'URL del servicio SOAP de la interfaz de ventas al SIR (interfaceVentasAgregadores). NULL = sin configurar';
COMMENT ON COLUMN "store"."maxpoint_rst_id" IS 'Código del restaurante en MaxPoint y en el SIR (cod_restaurante; Ajustes › Restaurante › IdIntegración)';
