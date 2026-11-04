-- 0031 · El logo configurado sale en el papel (pruebas en JC01, 04/11/2026).
-- La impresora imprimía siempre el logo de la cadena (CyT) aunque el local tuviera el suyo en Ajustes › Restaurante.
-- El TPV prepara el logo para la impresora (orden ESC/POS «GS v 0», blanco y negro) y lo guarda aquí; la API lo imprime en
-- precuenta, factura y abono. Vacío (NULL) = el logo de la cadena, como hasta ahora.
ALTER TABLE "store_parameters" ADD COLUMN IF NOT EXISTS "ticket_logo" TEXT;
COMMENT ON COLUMN "store_parameters"."ticket_logo" IS 'Logo del ticket ya preparado para la impresora (GS v 0 en base64); NULL = logo de la cadena';
