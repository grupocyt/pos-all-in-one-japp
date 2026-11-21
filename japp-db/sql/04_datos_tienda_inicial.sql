-- Datos de la tienda nueva (24/10/2026, formulario «Datos iniciales Japp»; al final, los datos base de LG01 del 21/11/2026).
-- Se aplica UNA vez, solo al crear una base nueva con SEED=1, DESPUÉS de las migraciones (scripts/init.mjs).
-- Parte de la Sucursal Pruebas (02_datos_arranque) y la deja como la tienda real. Las pruebas no lo usan:
-- su base sigue siendo la Sucursal Pruebas. Nunca se aplica a una base que ya tiene ventas.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM orders) OR EXISTS (SELECT 1 FROM invoice) THEN RAISE EXCEPTION 'La base ya tiene ventas: no se aplican los datos de la tienda nueva'; END IF;
END $$;

-- Tienda, empresa y facturación
UPDATE store SET code='JC01', name='Nueva Sucursal Japp', service_type='table', address='C. Castellana 5, 28700 Madrid', phone='+34 910 000 000', ticket_header='¡Gracias por su visita!', ticket_footer='IVA incluido · VERI*FACTU';
UPDATE company SET legal_name='DAILY FOOD VENTURES S.L.', trade_name='Grupo Cañas y Tapas', tax_id='B12300141', address='Calle Mayor 1, 28013 Madrid';
UPDATE billing_settings SET establishment='022', emission_point='050', series_simplified='T2026', series_full='F2026', series_credit='AB2026', billing_email='info@japp-tech.es';

-- Parámetros
UPDATE store_parameters SET lock_seconds=10, lock_seconds_pda=10, duplicate_minutes=3, cash_float=150, cash_diff_threshold=5, idle_table_minutes=45, prebill_to_pay_minutes=6, kpi_min_tables=20, pin_attempts=3, pin_lock_seconds=30;

-- Usuarios (los PIN de prueba se cambian en el TPV antes de producción)
UPDATE app_user SET initials='SI', profile_id=(SELECT id FROM user_profile WHERE code='ADMIN'), can_charge=TRUE, can_delete_printed=TRUE, can_delete_prebill=TRUE, active=TRUE WHERE name='Sistemas';
UPDATE app_user SET initials='JE', profile_id=(SELECT id FROM user_profile WHERE code='ADMIN_LOCAL'), can_charge=TRUE, can_delete_printed=TRUE, can_delete_prebill=TRUE, active=TRUE WHERE name='Jeison';
UPDATE app_user SET initials='BA', profile_id=(SELECT id FROM user_profile WHERE code='CAJERO'), can_charge=TRUE, can_delete_printed=TRUE, can_delete_prebill=FALSE, active=TRUE WHERE name='Barra';
UPDATE app_user SET initials='ME', profile_id=(SELECT id FROM user_profile WHERE code='MESERO'), can_charge=FALSE, can_delete_printed=FALSE, can_delete_prebill=FALSE, active=TRUE WHERE name='Mesero';
UPDATE app_user SET initials='CM', profile_id=(SELECT id FROM user_profile WHERE code='CAPITAN'), can_charge=TRUE, can_delete_printed=TRUE, can_delete_prebill=TRUE, active=TRUE WHERE name='Capitan Mesero';
INSERT INTO app_user (id, store_id, name, initials, profile_id, pin_hash, can_charge, can_delete_printed, can_delete_prebill, active)
SELECT gen_random_uuid(), s.id, 'Capitan Mesero', 'CM', (SELECT id FROM user_profile WHERE code='CAPITAN'), '$2a$10$9k/nAY.bRwflecMv28T55e4CYwGEHpylnIcVSx36IesQEfv13E20.', TRUE, TRUE, TRUE, TRUE
FROM store s WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE name='Capitan Mesero');

-- Permisos: la matriz completa del formulario sustituye a la de prueba
DELETE FROM profile_permission;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
SELECT p.id, v.code, p.store_id FROM (VALUES
  ('mesas.abrirMesa', 'ADMIN'),
  ('mesas.abrirMesa', 'ADMIN_LOCAL'),
  ('mesas.abrirMesa', 'CAPITAN'),
  ('mesas.abrirMesa', 'CAJERO'),
  ('mesas.abrirMesa', 'MESERO'),
  ('mesas.transferir', 'ADMIN'),
  ('mesas.transferir', 'ADMIN_LOCAL'),
  ('mesas.transferir', 'CAPITAN'),
  ('mesas.transferir', 'CAJERO'),
  ('mesas.transferir', 'MESERO'),
  ('mesas.moverMesas', 'ADMIN'),
  ('mesas.moverMesas', 'ADMIN_LOCAL'),
  ('mesas.moverMesas', 'CAPITAN'),
  ('mesas.editarPlano', 'ADMIN'),
  ('mesas.editarPlano', 'ADMIN_LOCAL'),
  ('mesas.editarPlano', 'CAPITAN'),
  ('pedido.enviar', 'ADMIN'),
  ('pedido.enviar', 'ADMIN_LOCAL'),
  ('pedido.enviar', 'CAPITAN'),
  ('pedido.enviar', 'CAJERO'),
  ('pedido.enviar', 'MESERO'),
  ('pedido.precuenta', 'ADMIN'),
  ('pedido.precuenta', 'ADMIN_LOCAL'),
  ('pedido.precuenta', 'CAPITAN'),
  ('pedido.precuenta', 'CAJERO'),
  ('pedido.precuenta', 'MESERO'),
  ('pedido.comentarios', 'ADMIN'),
  ('pedido.comentarios', 'ADMIN_LOCAL'),
  ('pedido.comentarios', 'CAPITAN'),
  ('pedido.comentarios', 'CAJERO'),
  ('pedido.comentarios', 'MESERO'),
  ('pedido.notaMesa', 'ADMIN'),
  ('pedido.notaMesa', 'ADMIN_LOCAL'),
  ('pedido.notaMesa', 'CAPITAN'),
  ('pedido.notaMesa', 'CAJERO'),
  ('pedido.notaMesa', 'MESERO'),
  ('pedido.comensales', 'ADMIN'),
  ('pedido.comensales', 'ADMIN_LOCAL'),
  ('pedido.comensales', 'CAPITAN'),
  ('pedido.comensales', 'CAJERO'),
  ('pedido.comensales', 'MESERO'),
  ('pedido.cuentas', 'ADMIN'),
  ('pedido.cuentas', 'ADMIN_LOCAL'),
  ('pedido.cuentas', 'CAPITAN'),
  ('pedido.cuentas', 'CAJERO'),
  ('pedido.cuentas', 'MESERO'),
  ('pedido.pasarCuenta', 'ADMIN'),
  ('pedido.pasarCuenta', 'ADMIN_LOCAL'),
  ('pedido.pasarCuenta', 'CAPITAN'),
  ('pedido.pasarCuenta', 'CAJERO'),
  ('pedido.pasarCuenta', 'MESERO'),
  ('pedido.separar', 'ADMIN'),
  ('pedido.separar', 'ADMIN_LOCAL'),
  ('pedido.separar', 'CAPITAN'),
  ('pedido.separar', 'CAJERO'),
  ('pedido.separar', 'MESERO'),
  ('pedido.elimEnviado', 'ADMIN'),
  ('pedido.elimEnviado', 'ADMIN_LOCAL'),
  ('pedido.elimEnviado', 'CAPITAN'),
  ('pedido.elimPrecuenta', 'ADMIN'),
  ('pedido.elimPrecuenta', 'ADMIN_LOCAL'),
  ('pedido.elimPrecuenta', 'CAPITAN'),
  ('mesas.entrarOcupada', 'ADMIN'),
  ('mesas.entrarOcupada', 'ADMIN_LOCAL'),
  ('mesas.entrarOcupada', 'CAPITAN'),
  ('mesas.entrarOcupada', 'CAJERO'),
  ('pedido.historial', 'ADMIN'),
  ('pedido.historial', 'ADMIN_LOCAL'),
  ('pedido.historial', 'CAPITAN'),
  ('pedido.historial', 'CAJERO'),
  ('pedido.historial', 'MESERO'),
  ('mesas.orderOnTable', 'ADMIN'),
  ('mesas.orderOnTable', 'ADMIN_LOCAL'),
  ('mesas.orderOnTable', 'CAPITAN'),
  ('pedido.transaccion', 'ADMIN'),
  ('pedido.transaccion', 'ADMIN_LOCAL'),
  ('pedido.transaccion', 'CAPITAN'),
  ('pedido.transaccion', 'CAJERO'),
  ('pedido.transaccion', 'MESERO'),
  ('cobro.cobrar', 'ADMIN'),
  ('cobro.cobrar', 'ADMIN_LOCAL'),
  ('cobro.cobrar', 'CAPITAN'),
  ('cobro.cobrar', 'CAJERO'),
  ('cobro.descuentos', 'ADMIN'),
  ('cobro.descuentos', 'ADMIN_LOCAL'),
  ('cobro.descuentos', 'CAPITAN'),
  ('cobro.descuentos', 'CAJERO'),
  ('cobro.clientes', 'ADMIN'),
  ('cobro.clientes', 'ADMIN_LOCAL'),
  ('cobro.clientes', 'CAPITAN'),
  ('cobro.clientes', 'CAJERO'),
  ('funciones.facturas', 'ADMIN'),
  ('funciones.facturas', 'ADMIN_LOCAL'),
  ('funciones.facturas', 'CAPITAN'),
  ('funciones.facturas', 'CAJERO'),
  ('funciones.abonar', 'ADMIN'),
  ('funciones.abonar', 'ADMIN_LOCAL'),
  ('funciones.abonar', 'CAPITAN'),
  ('funciones.informes', 'ADMIN'),
  ('funciones.informes', 'ADMIN_LOCAL'),
  ('funciones.informes', 'CAPITAN'),
  ('funciones.kpi', 'ADMIN'),
  ('funciones.kpi', 'ADMIN_LOCAL'),
  ('funciones.caja', 'ADMIN'),
  ('funciones.caja', 'ADMIN_LOCAL'),
  ('funciones.caja', 'CAPITAN'),
  ('funciones.abrirCajon', 'ADMIN'),
  ('funciones.abrirCajon', 'ADMIN_LOCAL'),
  ('funciones.abrirCajon', 'CAPITAN'),
  ('funciones.periodo', 'ADMIN'),
  ('funciones.periodo', 'ADMIN_LOCAL'),
  ('funciones.periodo', 'CAPITAN'),
  ('funciones.periodo', 'CAJERO'),
  ('ajustes.acceso', 'ADMIN'),
  ('ajustes.acceso', 'ADMIN_LOCAL'),
  ('ajustes.restaurante', 'ADMIN'),
  ('ajustes.facturacion', 'ADMIN'),
  ('ajustes.usuarios', 'ADMIN'),
  ('ajustes.usuarios', 'ADMIN_LOCAL'),
  ('ajustes.perfiles', 'ADMIN'),
  ('ajustes.categorias', 'ADMIN'),
  ('ajustes.productos', 'ADMIN'),
  ('ajustes.productos', 'ADMIN_LOCAL'),
  ('ajustes.preguntas', 'ADMIN'),
  ('ajustes.estaciones', 'ADMIN'),
  ('ajustes.impresoras', 'ADMIN'),
  ('ajustes.canales', 'ADMIN'),
  ('ajustes.incidencias', 'ADMIN'),
  ('ajustes.incidencias', 'ADMIN_LOCAL'),
  ('ajustes.motivos', 'ADMIN'),
  ('ajustes.parametros', 'ADMIN'),
  ('ajustes.historial', 'ADMIN'),
  ('ajustes.historial', 'ADMIN_LOCAL'),
  ('ajustes.devtx', 'ADMIN'),
  ('ajustes.cierres', 'ADMIN'),
  ('ajustes.cierres', 'ADMIN_LOCAL'),
  ('ajustes.devdb', 'ADMIN'),
  ('ajustes.devapi', 'ADMIN'),
  ('ajustes.devtests', 'ADMIN'),
  ('ajustes.devsync', 'ADMIN'),
  ('sistema.autorizar', 'ADMIN'),
  ('sistema.autorizar', 'ADMIN_LOCAL'),
  ('sistema.autorizar', 'CAPITAN')
) AS v(code, profile) JOIN user_profile p ON p.code = v.profile JOIN permission x ON x.code = v.code;
-- 1.2.267: los permisos de las migraciones posteriores (0025 delivery) que el DELETE de arriba quitaría en una tienda nueva:
-- Ajustes › Pedidos a quien tiene Restaurante (0025) y el tablero de pedidos solo a cajero y encargado (0030, 04/11/2026):
-- los perfiles que abren o cierran el periodo o autorizan
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT profile_id, 'ajustes.pedidos', store_id FROM profile_permission WHERE permission_code = 'ajustes.restaurante'
ON CONFLICT DO NOTHING;
DELETE FROM profile_permission pp WHERE pp.permission_code = 'funciones.pedidos'
  AND NOT EXISTS (SELECT 1 FROM profile_permission x WHERE x.profile_id = pp.profile_id AND x.permission_code IN ('cobro.cobrar', 'funciones.periodo', 'sistema.autorizar'));
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT DISTINCT profile_id, 'funciones.pedidos', store_id FROM profile_permission WHERE permission_code IN ('cobro.cobrar', 'funciones.periodo', 'sistema.autorizar')
ON CONFLICT DO NOTHING;
-- 0044 · el tablero de delivery, por defecto solo el Cajero (y el Administrador)
DELETE FROM profile_permission pp USING user_profile p
 WHERE p.id = pp.profile_id AND pp.permission_code = 'funciones.pedidos' AND p.code NOT IN ('CAJERO', 'ADMIN');
-- 0030: propina con todas las formas de pago (menos las de descuento)
UPDATE payment_method SET allows_tip = TRUE WHERE kind <> 'discount';
-- 0028: «Resolver reconexiones» a quien puede autorizar (igual que la migración)
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT profile_id, 'pedido.reconexiones', store_id FROM profile_permission WHERE permission_code = 'sistema.autorizar'
ON CONFLICT DO NOTHING;
-- 0032 (05/11/2026): Historial › Developer solo al Administrador y un permiso por botón de Gestiones con el reparto por rol
-- 1 · Historial › pestaña Developer: un permiso propio. Por defecto, solo el perfil Administrador (Sistemas).
INSERT INTO permission (code, module, name, sort_order) VALUES
  ('pedido.historialDev', 'Pedido', 'Historial › Developer', 18)
ON CONFLICT (code) DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT p.id, 'pedido.historialDev', p.store_id FROM user_profile p WHERE p.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- 11 · Gestiones: un permiso por botón. Los que iban juntos se separan: Resumen semana y Eliminaciones (antes «Informes»),
-- Mesas en servicio (antes «KPI») y Enviar ventas al SIR (antes «Cerrar periodo»).
INSERT INTO permission (code, module, name, sort_order) VALUES
  ('funciones.semana', 'Funciones', 'Resumen semana', 29),
  ('funciones.eliminaciones', 'Funciones', 'Eliminaciones', 30),
  ('funciones.servicio', 'Funciones', 'Mesas en servicio', 31),
  ('funciones.sir', 'Funciones', 'Enviar ventas al SIR', 32)
ON CONFLICT (code) DO NOTHING;
-- los perfiles que no están en la tabla del dueño (p. ej. Capitán) siguen viendo lo mismo que antes
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT pp.profile_id, v.code, pp.store_id
    FROM profile_permission pp
    JOIN (VALUES ('funciones.informes', 'funciones.semana'), ('funciones.informes', 'funciones.eliminaciones'),
                 ('funciones.kpi', 'funciones.servicio'), ('funciones.periodo', 'funciones.sir')) AS v(old, code)
      ON v.old = pp.permission_code
ON CONFLICT DO NOTHING;
-- Reparto por rol decidido el 05/11 (Administrador, Encargado = Administrador local, Cajero y Mesero/Barra):
-- Administrador todo; Encargado todo menos el SIR; Cajero Facturas, Mesas en servicio, Abrir cajón, Arqueo y Cerrar periodo;
-- Mesero nada. Se puede cambiar perfil a perfil en Ajustes › Perfiles.
DELETE FROM profile_permission pp
 USING user_profile p
 WHERE p.id = pp.profile_id AND p.code IN ('ADMIN', 'ADMIN_LOCAL', 'CAJERO', 'MESERO')
   AND pp.permission_code IN ('funciones.facturas', 'pedido.reconexiones', 'funciones.semana', 'funciones.eliminaciones',
     'funciones.kpi', 'funciones.servicio', 'funciones.sir', 'funciones.abrirCajon', 'mesas.moverMesas', 'funciones.caja',
     'funciones.periodo');
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT p.id, v.code, p.store_id
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
    ) AS v(profile, code)
    JOIN user_profile p ON p.code = v.profile
    JOIN permission x ON x.code = v.code
ON CONFLICT DO NOTHING;
-- 0033 (11/11/2026): Resumen semana › editar días anteriores, para Administrador y Administrador local
INSERT INTO permission (code, module, name, sort_order) VALUES
  ('funciones.semanaEditar', 'Funciones', 'Resumen semana › editar días anteriores', 33)
ON CONFLICT (code) DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT p.id, 'funciones.semanaEditar', p.store_id FROM user_profile p WHERE p.code IN ('ADMIN', 'ADMIN_LOCAL')
ON CONFLICT DO NOTHING;
-- 0036 · Iniciar el día (abrir el periodo): el Cajero y el Administrador
INSERT INTO permission (code, module, name, sort_order) VALUES
  ('funciones.iniciarDia', 'Funciones', 'Iniciar el día (abrir el periodo)', 34)
ON CONFLICT (code) DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT p.id, 'funciones.iniciarDia', p.store_id FROM user_profile p WHERE p.code IN ('CAJERO', 'ADMIN')
ON CONFLICT DO NOTHING;
-- 0037 · arqueo de auditoría (Administrador) y caja chica (Administrador y Encargado)
INSERT INTO permission (code, module, name, sort_order) VALUES
  ('funciones.arqueoAuditoria', 'Funciones', 'Arqueo de auditoría', 35),
  ('funciones.cajaChica', 'Funciones', 'Caja chica', 36)
ON CONFLICT (code) DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT p.id, 'funciones.arqueoAuditoria', p.store_id FROM user_profile p WHERE p.code = 'ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT p.id, 'funciones.cajaChica', p.store_id FROM user_profile p WHERE p.code IN ('ADMIN', 'ADMIN_LOCAL')
ON CONFLICT DO NOTHING;
-- 0041 · roles de lo nuevo: orden de impresión (quien envía), mi venta (todos), Sistema en el corte X (nadie)
INSERT INTO permission (code, module, name, sort_order) VALUES
  ('pedido.ordenImpresion', 'Pedido', 'Cambiar el orden de impresión', 19),
  ('funciones.miVenta', 'Funciones', 'Ver mi venta (cabecera de la PDA)', 37),
  ('funciones.corteVerSistema', 'Funciones', 'Ver Sistema y Propinas en el corte X', 38)
ON CONFLICT (code) DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT pp.profile_id, 'pedido.ordenImpresion', pp.store_id FROM profile_permission pp WHERE pp.permission_code = 'pedido.enviar'
ON CONFLICT DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT p.id, 'funciones.miVenta', p.store_id FROM user_profile p
ON CONFLICT DO NOTHING;
-- 0043 · transferir un producto: permiso propio (quien ya podía transferir); «Reabrir» ya no existe
INSERT INTO permission (code, module, name, sort_order) VALUES ('mesas.transferirProducto', 'Mesas', 'Transferir un producto a otra mesa', 3)
ON CONFLICT (code) DO NOTHING;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
  SELECT pp.profile_id, 'mesas.transferirProducto', pp.store_id FROM profile_permission pp WHERE pp.permission_code = 'mesas.transferir'
ON CONFLICT DO NOTHING;


-- Impresoras y canales: BARRA pasa a llamarse BEBIDA y se crea COMIDA (impresora LINEA)
UPDATE printer SET connection='tcp://10.221.17.35';
UPDATE print_channel SET name='BEBIDA' WHERE name='BARRA';
INSERT INTO print_channel (id, store_id, name, active, kind, printer_id, code)
SELECT gen_random_uuid(), s.id, 'COMIDA', TRUE, 'kitchen', (SELECT id FROM printer WHERE name='LINEA'), 'COMIDA' FROM store s
WHERE NOT EXISTS (SELECT 1 FROM print_channel WHERE name='COMIDA');
-- 0035 ya crea COMIDA (sin impresora): sale por LINEA
UPDATE print_channel SET printer_id=(SELECT id FROM printer WHERE name='LINEA') WHERE code='COMIDA' AND printer_id IS NULL;
INSERT INTO station_channel_printer (station_id, channel_id, printer_id, store_id)
SELECT st.id, c.id, c.printer_id, st.store_id FROM station st CROSS JOIN print_channel c WHERE c.name='COMIDA'
ON CONFLICT DO NOTHING;
-- los productos de comida salen por COMIDA; las bebidas siguen por BEBIDA
UPDATE product_channel pc SET channel_id=(SELECT id FROM print_channel WHERE name='COMIDA')
FROM product pr JOIN category c ON c.id=pr.category_id
WHERE pc.product_id=pr.id AND c.name IN ('PARA COMPARTIR', 'CARNES Y MAS', 'HUEVOS ROTOS', 'ARROCES', 'TOSTAS & BOCADILLOS', 'POSTRES', 'DESAYUNOS', 'MENU DEL DIA', 'GUARNICIONES Y EXTRAS');

-- Equipos
UPDATE station SET ip='127.0.1.21', kind='station', is_main=TRUE WHERE name='CAJA1';
UPDATE station SET ip='127.0.1.22', kind='pda', is_main=FALSE WHERE name='PDA1';
DELETE FROM station_payment_method;
INSERT INTO station_payment_method (station_id, payment_method_id, store_id)
SELECT st.id, m.id, st.store_id FROM station st JOIN payment_method m ON (m.code='cash' AND st.name IN ('CAJA1')) OR (m.code='card' AND st.name IN ('CAJA1','PDA1'));

-- Descuentos
UPDATE discount SET percent=30, needs_authorization=TRUE WHERE name='DESCUENTO 30% EMPLEADOS';
UPDATE discount SET percent=20, needs_authorization=TRUE WHERE name='DESCUENTO 20% THE FORK';
UPDATE discount SET percent=10, needs_authorization=TRUE WHERE name='DESCUENTO 10% C.COMERCIAL';
-- 0033: «Solo encargados» = los perfiles Administrador y Administrador local
UPDATE discount SET profiles='["ADMIN","ADMIN_LOCAL"]'::jsonb WHERE needs_authorization AND profiles='[]'::jsonb;

-- Salas y mesas: una mesa por sala para empezar, BARRA (1), SALON (100) y TERRAZA (200); el resto lo crea el local en Editar sala
-- (17/11/2026: antes se creaban 100 mesas de ejemplo en SALON y 200 en TERRAZA)
INSERT INTO area (id, store_id, name, sort_order, price_list, table_number_from, plan_width, plan_height, active, ticket_channel_id)
SELECT gen_random_uuid(), s.id, 'SALON', 2, 'general', 100, 1000, 640, TRUE, (SELECT id FROM print_channel WHERE name='TICKET') FROM store s
WHERE NOT EXISTS (SELECT 1 FROM area WHERE name='SALON');
UPDATE area SET sort_order=3, table_number_from=200, plan_width=1000, plan_height=640, price_list='terrace' WHERE name='TERRAZA';
UPDATE area SET sort_order=1, table_number_from=1, price_list='general' WHERE name='BARRA';
DELETE FROM dining_table WHERE number='100';
INSERT INTO dining_table (id, store_id, area_id, number, capacity, pos_x, pos_y, width, height, active)
SELECT gen_random_uuid(), a.store_id, a.id, '100', 4, 20, 20, 80, 48, TRUE FROM area a WHERE a.name='SALON';
INSERT INTO dining_table (id, store_id, area_id, number, capacity, pos_x, pos_y, width, height, active)
SELECT gen_random_uuid(), a.store_id, a.id, '200', 4, 20, 20, 80, 48, TRUE FROM area a WHERE a.name='TERRAZA';

-- ============================================================================================
-- 21/11/2026 · Datos base del restaurante (formulario «Configuración del restaurante», Public/configuracion-sistema):
-- Luma Gelateria Italiana · Plaza Mayor (LG01), GASTORIANA SERVICES, S.L. Sustituye a los de la tienda de ejemplo de arriba.
-- La carta sigue siendo la de arranque hasta que llegue la del Manager. Cambia todos los PIN antes de producción.
-- ============================================================================================
-- Tienda, empresa (la cadena es el nombre comercial: sale en la cabecera de los tickets) y facturación
UPDATE store SET code='LG01', name='Plaza Mayor', service_type='fastfood', address='Pl. Mayor, 32B, Centro, 28012 Madrid', city='Madrid', phone='+34 910 000 000',
  opening_hours='08:00 - 23:59', reviews_url='https://search.google.com/local/writereview?placeid=ChIJjdIvLHopQg0R9FEnlSQyoeE', maxpoint_rst_id=41, sir_url=NULL, oot_enabled=FALSE, web_order_url='https://pedir.japp.es/mesa',
  logo_url='logos/logo_heladeria.jpg', updated_at=now(), config_version=config_version+1;
UPDATE company SET legal_name='GASTORIANA SERVICES, S.L.', trade_name='Luma Gelateria Italiana', tax_id='B75298851', address='C/ Magallanes, 25 PT3, 28015 Madrid', country='ES', maxpoint_cdn_id=8;
INSERT INTO invoice_series (store_id, series, kind, last_sequence, updated_at)
SELECT s.id, v.series, v.kind, 0, now() FROM store s CROSS JOIN (VALUES ('T-LG01', 'F2'), ('F-LG01', 'F1'), ('R-LG01', 'R1')) AS v(series, kind)
ON CONFLICT DO NOTHING;
UPDATE billing_settings SET billing_email='facturas@lumagelateria.es', series_simplified='T-LG01', series_full='F-LG01', series_credit='R-LG01', simplified_limit=1000.00;
UPDATE store_parameters SET cash_float=200.00, petty_cash_limit=200.00, card_terminals=2;
-- Sistema: nombre, subtítulo, grupo y logo de la pantalla de acceso
INSERT INTO system_branding (store_id, name, subtitle, login_group, logo, palette, colors, version, updated_at, updated_by)
SELECT s.id, 'Comandero Japp', 'Software de restaurantes', 'Grupo Cañas y Tapas', 'data:image/jpeg;base64,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',
  '[{"hex":"#15616D","name":"Verde","default":true},{"hex":"#6E3B5E","name":"Ciruela","default":false}]'::jsonb, '{}'::jsonb, 1, now(), 'Datos base' FROM store s
ON CONFLICT (store_id) DO UPDATE SET name=EXCLUDED.name, subtitle=EXCLUDED.subtitle, login_group=EXCLUDED.login_group, logo=EXCLUDED.logo, palette=EXCLUDED.palette, version=system_branding.version+1, updated_at=now(), updated_by=EXCLUDED.updated_by;
-- Turnos
DELETE FROM service_sla WHERE shift_id IS NOT NULL; DELETE FROM service_shift;
INSERT INTO service_shift (id, store_id, name, starts_at, ends_at, sort_order) SELECT gen_random_uuid(), s.id, 'Comida', '08:00', '23:59', 1 FROM store s;
-- Formas de pago: el código del formulario es el de integración (external_id); el código interno (cash, card) no cambia
UPDATE payment_method SET name='Efectivo', external_id='55', allows_tip=TRUE, show_in_tpv=TRUE, active=TRUE,
  image='data:image/png;base64,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' WHERE code='cash';
UPDATE payment_method SET name='Tarjetas', external_id='56', allows_tip=TRUE, show_in_tpv=TRUE, active=TRUE,
  image='data:image/png;base64,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' WHERE code='card';
UPDATE payment_method SET active=FALSE WHERE code NOT IN ('card', 'cash');
-- Perfiles: ADMIN = Administrador Sistemas, ADMIN_LOCAL pasa a MANAGER (Manager) y CAPITAN a JEFERANGO (Jefe de Rango)
UPDATE user_profile SET code='ADMIN', name='Administrador Sistemas', active=TRUE WHERE code='ADMIN';
UPDATE user_profile SET code='MANAGER', name='Manager', active=TRUE WHERE code='ADMIN_LOCAL';
UPDATE user_profile SET code='JEFERANGO', name='Jefe de Rango', active=TRUE WHERE code='CAPITAN';
UPDATE user_profile SET code='CAJERO', name='Cajero', active=TRUE WHERE code='CAJERO';
UPDATE user_profile SET code='MESERO', name='Mesero', active=TRUE WHERE code='MESERO';
-- Permisos: la matriz del formulario sustituye a la de arriba (más Gestor de cierres y Developer › Sincronización al Administrador)
DELETE FROM profile_permission;
INSERT INTO profile_permission (profile_id, permission_code, store_id)
SELECT p.id, v.code, p.store_id FROM (VALUES
  ('ajustes.acceso', 'ADMIN'),
  ('ajustes.canales', 'ADMIN'),
  ('ajustes.categorias', 'ADMIN'),
  ('ajustes.devapi', 'ADMIN'),
  ('ajustes.devdb', 'ADMIN'),
  ('ajustes.devtests', 'ADMIN'),
  ('ajustes.devtx', 'ADMIN'),
  ('ajustes.estaciones', 'ADMIN'),
  ('ajustes.facturacion', 'ADMIN'),
  ('ajustes.historial', 'ADMIN'),
  ('ajustes.impresoras', 'ADMIN'),
  ('ajustes.incidencias', 'ADMIN'),
  ('ajustes.motivos', 'ADMIN'),
  ('ajustes.parametros', 'ADMIN'),
  ('ajustes.pedidos', 'ADMIN'),
  ('ajustes.perfiles', 'ADMIN'),
  ('ajustes.preguntas', 'ADMIN'),
  ('ajustes.productos', 'ADMIN'),
  ('ajustes.restaurante', 'ADMIN'),
  ('ajustes.usuarios', 'ADMIN'),
  ('cobro.clientes', 'ADMIN'),
  ('cobro.cobrar', 'ADMIN'),
  ('cobro.descuentos', 'ADMIN'),
  ('funciones.abonar', 'ADMIN'),
  ('funciones.abrirCajon', 'ADMIN'),
  ('funciones.arqueoAuditoria', 'ADMIN'),
  ('funciones.caja', 'ADMIN'),
  ('funciones.cajaChica', 'ADMIN'),
  ('funciones.eliminaciones', 'ADMIN'),
  ('funciones.facturas', 'ADMIN'),
  ('funciones.informes', 'ADMIN'),
  ('funciones.kpi', 'ADMIN'),
  ('funciones.miVenta', 'ADMIN'),
  ('funciones.pedidos', 'ADMIN'),
  ('funciones.periodo', 'ADMIN'),
  ('funciones.semana', 'ADMIN'),
  ('funciones.semanaEditar', 'ADMIN'),
  ('funciones.servicio', 'ADMIN'),
  ('funciones.sir', 'ADMIN'),
  ('mesas.abrirMesa', 'ADMIN'),
  ('mesas.editarPlano', 'ADMIN'),
  ('mesas.entrarOcupada', 'ADMIN'),
  ('mesas.moverMesas', 'ADMIN'),
  ('mesas.transferir', 'ADMIN'),
  ('mesas.transferirProducto', 'ADMIN'),
  ('pedido.comensales', 'ADMIN'),
  ('pedido.comentarios', 'ADMIN'),
  ('pedido.cuentas', 'ADMIN'),
  ('pedido.elimEnviado', 'ADMIN'),
  ('pedido.elimPrecuenta', 'ADMIN'),
  ('pedido.enviar', 'ADMIN'),
  ('pedido.historial', 'ADMIN'),
  ('pedido.historialDev', 'ADMIN'),
  ('pedido.notaMesa', 'ADMIN'),
  ('pedido.ordenImpresion', 'ADMIN'),
  ('pedido.pasarCuenta', 'ADMIN'),
  ('pedido.precuenta', 'ADMIN'),
  ('pedido.reconexiones', 'ADMIN'),
  ('pedido.separar', 'ADMIN'),
  ('pedido.transaccion', 'ADMIN'),
  ('sistema.autorizar', 'ADMIN'),
  ('ajustes.cierres', 'ADMIN'),
  ('ajustes.devsync', 'ADMIN'),
  ('ajustes.acceso', 'MANAGER'),
  ('ajustes.canales', 'MANAGER'),
  ('ajustes.categorias', 'MANAGER'),
  ('ajustes.devapi', 'MANAGER'),
  ('ajustes.devdb', 'MANAGER'),
  ('ajustes.devtests', 'MANAGER'),
  ('ajustes.devtx', 'MANAGER'),
  ('ajustes.estaciones', 'MANAGER'),
  ('ajustes.facturacion', 'MANAGER'),
  ('ajustes.historial', 'MANAGER'),
  ('ajustes.impresoras', 'MANAGER'),
  ('ajustes.incidencias', 'MANAGER'),
  ('ajustes.motivos', 'MANAGER'),
  ('ajustes.parametros', 'MANAGER'),
  ('ajustes.pedidos', 'MANAGER'),
  ('ajustes.perfiles', 'MANAGER'),
  ('ajustes.preguntas', 'MANAGER'),
  ('ajustes.productos', 'MANAGER'),
  ('ajustes.restaurante', 'MANAGER'),
  ('ajustes.usuarios', 'MANAGER'),
  ('cobro.clientes', 'MANAGER'),
  ('cobro.cobrar', 'MANAGER'),
  ('cobro.descuentos', 'MANAGER'),
  ('funciones.abonar', 'MANAGER'),
  ('funciones.abrirCajon', 'MANAGER'),
  ('funciones.caja', 'MANAGER'),
  ('funciones.cajaChica', 'MANAGER'),
  ('funciones.eliminaciones', 'MANAGER'),
  ('funciones.facturas', 'MANAGER'),
  ('funciones.informes', 'MANAGER'),
  ('funciones.kpi', 'MANAGER'),
  ('funciones.miVenta', 'MANAGER'),
  ('funciones.periodo', 'MANAGER'),
  ('funciones.semana', 'MANAGER'),
  ('funciones.semanaEditar', 'MANAGER'),
  ('funciones.servicio', 'MANAGER'),
  ('mesas.abrirMesa', 'MANAGER'),
  ('mesas.editarPlano', 'MANAGER'),
  ('mesas.entrarOcupada', 'MANAGER'),
  ('mesas.moverMesas', 'MANAGER'),
  ('mesas.transferir', 'MANAGER'),
  ('mesas.transferirProducto', 'MANAGER'),
  ('pedido.comensales', 'MANAGER'),
  ('pedido.comentarios', 'MANAGER'),
  ('pedido.cuentas', 'MANAGER'),
  ('pedido.elimEnviado', 'MANAGER'),
  ('pedido.elimPrecuenta', 'MANAGER'),
  ('pedido.enviar', 'MANAGER'),
  ('pedido.historial', 'MANAGER'),
  ('pedido.notaMesa', 'MANAGER'),
  ('pedido.ordenImpresion', 'MANAGER'),
  ('pedido.pasarCuenta', 'MANAGER'),
  ('pedido.precuenta', 'MANAGER'),
  ('pedido.reconexiones', 'MANAGER'),
  ('pedido.separar', 'MANAGER'),
  ('pedido.transaccion', 'MANAGER'),
  ('sistema.autorizar', 'MANAGER'),
  ('ajustes.cierres', 'MANAGER'),
  ('cobro.clientes', 'JEFERANGO'),
  ('cobro.cobrar', 'JEFERANGO'),
  ('cobro.descuentos', 'JEFERANGO'),
  ('funciones.abrirCajon', 'JEFERANGO'),
  ('funciones.eliminaciones', 'JEFERANGO'),
  ('funciones.facturas', 'JEFERANGO'),
  ('funciones.informes', 'JEFERANGO'),
  ('funciones.miVenta', 'JEFERANGO'),
  ('funciones.semana', 'JEFERANGO'),
  ('mesas.abrirMesa', 'JEFERANGO'),
  ('mesas.transferir', 'JEFERANGO'),
  ('mesas.transferirProducto', 'JEFERANGO'),
  ('pedido.comensales', 'JEFERANGO'),
  ('pedido.comentarios', 'JEFERANGO'),
  ('pedido.cuentas', 'JEFERANGO'),
  ('pedido.enviar', 'JEFERANGO'),
  ('pedido.historial', 'JEFERANGO'),
  ('pedido.notaMesa', 'JEFERANGO'),
  ('pedido.ordenImpresion', 'JEFERANGO'),
  ('pedido.pasarCuenta', 'JEFERANGO'),
  ('pedido.precuenta', 'JEFERANGO'),
  ('pedido.separar', 'JEFERANGO'),
  ('pedido.transaccion', 'JEFERANGO'),
  ('cobro.clientes', 'CAJERO'),
  ('cobro.cobrar', 'CAJERO'),
  ('cobro.descuentos', 'CAJERO'),
  ('funciones.abrirCajon', 'CAJERO'),
  ('funciones.caja', 'CAJERO'),
  ('funciones.facturas', 'CAJERO'),
  ('funciones.iniciarDia', 'CAJERO'),
  ('funciones.miVenta', 'CAJERO'),
  ('funciones.pedidos', 'CAJERO'),
  ('funciones.periodo', 'CAJERO'),
  ('funciones.servicio', 'CAJERO'),
  ('mesas.abrirMesa', 'CAJERO'),
  ('mesas.transferir', 'CAJERO'),
  ('mesas.transferirProducto', 'CAJERO'),
  ('pedido.comensales', 'CAJERO'),
  ('pedido.comentarios', 'CAJERO'),
  ('pedido.cuentas', 'CAJERO'),
  ('pedido.enviar', 'CAJERO'),
  ('pedido.historial', 'CAJERO'),
  ('pedido.notaMesa', 'CAJERO'),
  ('pedido.ordenImpresion', 'CAJERO'),
  ('pedido.pasarCuenta', 'CAJERO'),
  ('pedido.precuenta', 'CAJERO'),
  ('pedido.separar', 'CAJERO'),
  ('pedido.transaccion', 'CAJERO'),
  ('funciones.miVenta', 'MESERO'),
  ('mesas.abrirMesa', 'MESERO'),
  ('mesas.transferir', 'MESERO'),
  ('mesas.transferirProducto', 'MESERO'),
  ('pedido.comensales', 'MESERO'),
  ('pedido.comentarios', 'MESERO'),
  ('pedido.cuentas', 'MESERO'),
  ('pedido.enviar', 'MESERO'),
  ('pedido.historial', 'MESERO'),
  ('pedido.notaMesa', 'MESERO'),
  ('pedido.ordenImpresion', 'MESERO'),
  ('pedido.pasarCuenta', 'MESERO'),
  ('pedido.precuenta', 'MESERO'),
  ('pedido.separar', 'MESERO'),
  ('pedido.transaccion', 'MESERO')
) AS v(code, profile) JOIN user_profile p ON p.code = v.profile JOIN permission x ON x.code = v.code
ON CONFLICT DO NOTHING;
-- Usuarios (claves de prueba: cambia todos los PIN antes de producción)
UPDATE app_user SET name='J' WHERE name='Jeison' AND NOT EXISTS (SELECT 1 FROM app_user WHERE name='J');
INSERT INTO app_user (id, store_id, name, initials, profile_id, pin_hash, can_charge, can_delete_printed, can_delete_prebill, active)
SELECT gen_random_uuid(), s.id, 'Sistemas', 'SI', (SELECT id FROM user_profile WHERE code='ADMIN'), '$2a$10$LaOpMpPHAU6Akh5fFg8s9OT2ccl7szOoq.2bisctSh1aHyNqarHC2', TRUE, TRUE, TRUE, TRUE
FROM store s WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE name='Sistemas');
UPDATE app_user SET initials='SI', profile_id=(SELECT id FROM user_profile WHERE code='ADMIN'), pin_hash='$2a$10$LaOpMpPHAU6Akh5fFg8s9OT2ccl7szOoq.2bisctSh1aHyNqarHC2', can_charge=TRUE, can_delete_printed=TRUE, can_delete_prebill=TRUE, active=TRUE WHERE name='Sistemas';
INSERT INTO app_user (id, store_id, name, initials, profile_id, pin_hash, can_charge, can_delete_printed, can_delete_prebill, active)
SELECT gen_random_uuid(), s.id, 'Barra', 'BA', (SELECT id FROM user_profile WHERE code='CAJERO'), '$2a$10$cC99JC2aBhmd4wJeFqRs4.9myhEH78We9G6Q1YjY/Y1i4iI1tTHCW', TRUE, FALSE, FALSE, TRUE
FROM store s WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE name='Barra');
UPDATE app_user SET initials='BA', profile_id=(SELECT id FROM user_profile WHERE code='CAJERO'), pin_hash='$2a$10$cC99JC2aBhmd4wJeFqRs4.9myhEH78We9G6Q1YjY/Y1i4iI1tTHCW', can_charge=TRUE, can_delete_printed=FALSE, can_delete_prebill=FALSE, active=TRUE WHERE name='Barra';
INSERT INTO app_user (id, store_id, name, initials, profile_id, pin_hash, can_charge, can_delete_printed, can_delete_prebill, active)
SELECT gen_random_uuid(), s.id, 'Mesero', 'ME', (SELECT id FROM user_profile WHERE code='MESERO'), '$2a$10$vR/ULuwvXKoAUFRQpRJhfeinsOGvFtwMpcdLdwduZf0C2XEHHm05S', FALSE, FALSE, FALSE, TRUE
FROM store s WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE name='Mesero');
UPDATE app_user SET initials='ME', profile_id=(SELECT id FROM user_profile WHERE code='MESERO'), pin_hash='$2a$10$vR/ULuwvXKoAUFRQpRJhfeinsOGvFtwMpcdLdwduZf0C2XEHHm05S', can_charge=FALSE, can_delete_printed=FALSE, can_delete_prebill=FALSE, active=TRUE WHERE name='Mesero';
INSERT INTO app_user (id, store_id, name, initials, profile_id, pin_hash, can_charge, can_delete_printed, can_delete_prebill, active)
SELECT gen_random_uuid(), s.id, 'J', 'JE', (SELECT id FROM user_profile WHERE code='ADMIN'), '$2a$10$hPFl5m71Po2auYNXgQlpk.xgkEkm77WbnIt7W77tZ5lj/Xk6cUXrm', TRUE, TRUE, TRUE, TRUE
FROM store s WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE name='J');
UPDATE app_user SET initials='JE', profile_id=(SELECT id FROM user_profile WHERE code='ADMIN'), pin_hash='$2a$10$hPFl5m71Po2auYNXgQlpk.xgkEkm77WbnIt7W77tZ5lj/Xk6cUXrm', can_charge=TRUE, can_delete_printed=TRUE, can_delete_prebill=TRUE, active=TRUE WHERE name='J';
UPDATE app_user SET active=FALSE WHERE name NOT IN ('Sistemas', 'Barra', 'Mesero', 'J');
-- Descuentos (perfiles por código; formulario [{label, type, req}])
UPDATE discount SET percent=30.00, needs_authorization=TRUE, active=TRUE, profiles='["ADMIN", "MANAGER"]'::jsonb, form='[{"label": "NOMBRE", "type": "text", "req": true}, {"label": "LOCAL", "type": "text", "req": true}]'::jsonb WHERE name='DESCUENTO 30% EMPLEADOS';
INSERT INTO discount (id, store_id, name, percent, needs_authorization, active, profiles, form) SELECT gen_random_uuid(), s.id, 'DESCUENTO 30% EMPLEADOS', 30.00, TRUE, TRUE, '["ADMIN", "MANAGER"]'::jsonb, '[{"label": "NOMBRE", "type": "text", "req": true}, {"label": "LOCAL", "type": "text", "req": true}]'::jsonb FROM store s WHERE NOT EXISTS (SELECT 1 FROM discount WHERE name='DESCUENTO 30% EMPLEADOS');
UPDATE discount SET percent=20.00, needs_authorization=FALSE, active=TRUE, profiles='["ADMIN", "MANAGER", "JEFERANGO", "CAJERO"]'::jsonb, form='[]'::jsonb WHERE name='DESCUENTO 20% THE FORK';
INSERT INTO discount (id, store_id, name, percent, needs_authorization, active, profiles, form) SELECT gen_random_uuid(), s.id, 'DESCUENTO 20% THE FORK', 20.00, FALSE, TRUE, '["ADMIN", "MANAGER", "JEFERANGO", "CAJERO"]'::jsonb, '[]'::jsonb FROM store s WHERE NOT EXISTS (SELECT 1 FROM discount WHERE name='DESCUENTO 20% THE FORK');
UPDATE discount SET percent=10.00, needs_authorization=FALSE, active=TRUE, profiles='["ADMIN", "MANAGER", "JEFERANGO", "CAJERO"]'::jsonb, form='[]'::jsonb WHERE name='DESCUENTO 10% C.COMERCIAL';
INSERT INTO discount (id, store_id, name, percent, needs_authorization, active, profiles, form) SELECT gen_random_uuid(), s.id, 'DESCUENTO 10% C.COMERCIAL', 10.00, FALSE, TRUE, '["ADMIN", "MANAGER", "JEFERANGO", "CAJERO"]'::jsonb, '[]'::jsonb FROM store s WHERE NOT EXISTS (SELECT 1 FROM discount WHERE name='DESCUENTO 10% C.COMERCIAL');
UPDATE discount SET active=FALSE WHERE name NOT IN ('DESCUENTO 30% EMPLEADOS', 'DESCUENTO 20% THE FORK', 'DESCUENTO 10% C.COMERCIAL');
-- Impresoras: una sola, BARRA; todos los canales (ticket, bebida y comida) salen por ella
UPDATE printer SET connection='tcp://10.221.9.33:9100', active=TRUE WHERE name='BARRA';
UPDATE printer SET active=FALSE WHERE name <> 'BARRA';
UPDATE print_channel SET printer_id=(SELECT id FROM printer WHERE name='BARRA');
UPDATE station_channel_printer SET printer_id=(SELECT id FROM printer WHERE name='BARRA');
-- Estaciones: 1 caja y 1 PDA (las de arranque: CAJA1 y PDA1)
