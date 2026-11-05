-- 0032 · Pruebas en JC01 del 04/11/2026 (tarde), decidido con el dueño el 05/11 (API 1.2.268).

-- 2 · Varias notas por mesa, cada una con quién la dejó, desde qué equipo y cuándo. No se borran ni se cambian.
-- «note» se queda con todas juntas («alérgico · trona»), para comandas, precuentas y equipos antiguos.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "notes" JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN "orders"."notes" IS 'Notas de la mesa: [{id, text, user, role, device, at}] (no se borran; note = todas juntas)';
UPDATE "orders" SET "notes" = jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text, 'text', "note", 'user', coalesce("opened_by_user_name", ''),
    'role', coalesce("opened_by_role", ''), 'device', coalesce("opened_by_device", ''),
    'at', to_char("opened_by_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 WHERE coalesce(trim("note"), '') <> '' AND "notes" = '[]'::jsonb;

-- 1 · Historial › pestaña Developer: un permiso propio. Por defecto, solo el perfil Administrador (Sistemas).
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('pedido.historialDev', 'Pedido', 'Historial › Developer', 18)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", 'pedido.historialDev', p."store_id" FROM "user_profile" p WHERE p."code" = 'ADMIN'
ON CONFLICT DO NOTHING;

-- 11 · Gestiones: un permiso por botón. Los que iban juntos se separan: Resumen semana y Eliminaciones (antes «Informes»),
-- Mesas en servicio (antes «KPI») y Enviar ventas al SIR (antes «Cerrar periodo»).
INSERT INTO "permission" ("code", "module", "name", "sort_order") VALUES
  ('funciones.semana', 'Funciones', 'Resumen semana', 29),
  ('funciones.eliminaciones', 'Funciones', 'Eliminaciones', 30),
  ('funciones.servicio', 'Funciones', 'Mesas en servicio', 31),
  ('funciones.sir', 'Funciones', 'Enviar ventas al SIR', 32)
ON CONFLICT ("code") DO NOTHING;
-- los perfiles que no están en la tabla del dueño (p. ej. Capitán) siguen viendo lo mismo que antes
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT pp."profile_id", v."code", pp."store_id"
    FROM "profile_permission" pp
    JOIN (VALUES ('funciones.informes', 'funciones.semana'), ('funciones.informes', 'funciones.eliminaciones'),
                 ('funciones.kpi', 'funciones.servicio'), ('funciones.periodo', 'funciones.sir')) AS v("old", "code")
      ON v."old" = pp."permission_code"
ON CONFLICT DO NOTHING;
-- Reparto por rol decidido el 05/11 (Administrador, Encargado = Administrador local, Cajero y Mesero/Barra):
-- Administrador todo; Encargado todo menos el SIR; Cajero Facturas, Mesas en servicio, Abrir cajón, Arqueo y Cerrar periodo;
-- Mesero nada. Se puede cambiar perfil a perfil en Ajustes › Perfiles.
DELETE FROM "profile_permission" pp
 USING "user_profile" p
 WHERE p."id" = pp."profile_id" AND p."code" IN ('ADMIN', 'ADMIN_LOCAL', 'CAJERO', 'MESERO')
   AND pp."permission_code" IN ('funciones.facturas', 'pedido.reconexiones', 'funciones.semana', 'funciones.eliminaciones',
     'funciones.kpi', 'funciones.servicio', 'funciones.sir', 'funciones.abrirCajon', 'mesas.moverMesas', 'funciones.caja',
     'funciones.periodo');
INSERT INTO "profile_permission" ("profile_id", "permission_code", "store_id")
  SELECT p."id", v."code", p."store_id"
    FROM (VALUES
      ('ADMIN', 'funciones.facturas'), ('ADMIN', 'pedido.reconexiones'), ('ADMIN', 'funciones.semana'),
      ('ADMIN', 'funciones.eliminaciones'), ('ADMIN', 'funciones.kpi'), ('ADMIN', 'funciones.servicio'), ('ADMIN', 'funciones.sir'),
      ('ADMIN', 'funciones.abrirCajon'), ('ADMIN', 'mesas.moverMesas'), ('ADMIN', 'funciones.caja'), ('ADMIN', 'funciones.periodo'),
      ('ADMIN_LOCAL', 'funciones.facturas'), ('ADMIN_LOCAL', 'pedido.reconexiones'), ('ADMIN_LOCAL', 'funciones.semana'),
      ('ADMIN_LOCAL', 'funciones.eliminaciones'), ('ADMIN_LOCAL', 'funciones.kpi'), ('ADMIN_LOCAL', 'funciones.servicio'),
      ('ADMIN_LOCAL', 'funciones.abrirCajon'), ('ADMIN_LOCAL', 'mesas.moverMesas'), ('ADMIN_LOCAL', 'funciones.caja'),
      ('ADMIN_LOCAL', 'funciones.periodo'),
      ('CAJERO', 'funciones.facturas'), ('CAJERO', 'funciones.servicio'), ('CAJERO', 'funciones.abrirCajon'),
      ('CAJERO', 'funciones.caja'), ('CAJERO', 'funciones.periodo')
    ) AS v("profile", "code")
    JOIN "user_profile" p ON p."code" = v."profile"
    JOIN "permission" x ON x."code" = v."code"
ON CONFLICT DO NOTHING;

-- 9, 10 · Corte X, corte Z y comanda de anulación configurables en Ajustes › Formatos: van en el mismo
-- store_parameters.ticket_formats (0029) como {cutx:{…}, cutz:{…}, void:{…}}. Lo que no viene, sale (no hace falta columna).
COMMENT ON COLUMN "store_parameters"."ticket_formats" IS 'Formatos de Ajustes › Formatos de ticket: {prebill, invoice, cutx, cutz, void}; lo que falta, sale';
