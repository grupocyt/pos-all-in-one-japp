-- 0029 · Formatos de ticket en el servidor (N1, decidido el 04/11/2026, API 1.2.268).
-- Ajustes › Formatos de ticket (precuenta y factura) se guarda aquí y la API lo aplica al imprimir: logo, cadena, local,
-- razón social, NIF, dirección, teléfono, camarero, desglose de IVA, por persona, pie, despedida (con su texto), QR de
-- reseñas (con su texto), QR tributario, abrir el cajón y propina. Vacío = todo sale (los valores por defecto del TPV).
-- En la factura el nombre fiscal y el NIF salen siempre (obligatorios), lo diga o no el formato.
ALTER TABLE "store_parameters" ADD COLUMN IF NOT EXISTS "ticket_formats" JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN "store_parameters"."ticket_formats" IS 'Formatos de precuenta y factura de Ajustes › Formatos de ticket: {prebill:{…}, invoice:{…}}; lo que falta, sale';
