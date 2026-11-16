-- 0036 · 1.2.271 (16/11/2026): equipos que no cambian de estación.
-- Última vez que cada equipo se identificó (POST /devices/identify y POST /devices/claim): en Ajustes › Equipos se ve
-- si un equipo lleva tiempo sin conectar o si dos equipos parecen el mismo.
ALTER TABLE "station" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;
COMMENT ON COLUMN "station"."last_seen_at" IS 'Última vez que el equipo de esta estación se identificó por su UUID';
-- «Iniciar el día» (abrir el periodo) como permiso propio, igual que en el TPV (Ajustes › Perfiles › Funciones): por
-- defecto el Cajero (y el Administrador, que lo tiene todo). Antes no existía en la API y guardar el perfil Cajero desde el TPV daba «Permisos que no
-- existen». Abrir el periodo vale con este permiso o con funciones.periodo (que además cierra).
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('funciones.iniciarDia', 'Funciones', 'Iniciar el día (abrir el periodo)', 34)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", 'funciones.iniciarDia', p."store_id" FROM "user_profile" p WHERE p."code" IN ('CAJERO', 'ADMIN')
ON CONFLICT DO NOTHING;
-- Permiso para vincular un equipo a una estación desde el propio equipo: el mismo de Ajustes › Estaciones
-- (ajustes.estaciones), no hace falta uno nuevo.
