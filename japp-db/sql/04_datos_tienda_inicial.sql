-- Datos de la tienda nueva (24/10/2026, formulario «Datos iniciales Japp»).
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
