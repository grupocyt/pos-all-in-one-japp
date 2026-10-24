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
UPDATE store_parameters SET lock_seconds=7, lock_seconds_pda=10, duplicate_minutes=3, cash_float=150, cash_diff_threshold=5, idle_table_minutes=45, prebill_to_pay_minutes=6, kpi_min_tables=20, pin_attempts=3, pin_lock_seconds=30;

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
  ('cobro.reabrir', 'ADMIN'),
  ('cobro.reabrir', 'ADMIN_LOCAL'),
  ('cobro.reabrir', 'CAPITAN'),
  ('cobro.reabrir', 'CAJERO'),
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

-- Impresoras y canales: BARRA pasa a llamarse BEBIDA y se crea COMIDA (impresora LINEA)
UPDATE printer SET connection='tcp://10.221.17.35';
UPDATE print_channel SET name='BEBIDA' WHERE name='BARRA';
INSERT INTO print_channel (id, store_id, name, active, kind, printer_id)
SELECT gen_random_uuid(), s.id, 'COMIDA', TRUE, 'kitchen', (SELECT id FROM printer WHERE name='LINEA') FROM store s
WHERE NOT EXISTS (SELECT 1 FROM print_channel WHERE name='COMIDA');
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

-- Salas y mesas: BARRA (1), SALON (100–199) y TERRAZA (200–399)
INSERT INTO area (id, store_id, name, sort_order, price_list, table_number_from, plan_width, plan_height, active, ticket_channel_id)
SELECT gen_random_uuid(), s.id, 'SALON', 2, 'general', 100, 1000, 640, TRUE, (SELECT id FROM print_channel WHERE name='TICKET') FROM store s
WHERE NOT EXISTS (SELECT 1 FROM area WHERE name='SALON');
UPDATE area SET sort_order=3, table_number_from=200, plan_width=2000, plan_height=640, price_list='terrace' WHERE name='TERRAZA';
UPDATE area SET sort_order=1, table_number_from=1, price_list='general' WHERE name='BARRA';
DELETE FROM dining_table WHERE number='100';
INSERT INTO dining_table (id, store_id, area_id, number, capacity, pos_x, pos_y, width, height, active)
SELECT gen_random_uuid(), a.store_id, a.id, (100+n)::text, 4, 20+(n%10)*98, 20+(n/10)*62, 80, 48, TRUE FROM area a, generate_series(0,99) n WHERE a.name='SALON';
INSERT INTO dining_table (id, store_id, area_id, number, capacity, pos_x, pos_y, width, height, active)
SELECT gen_random_uuid(), a.store_id, a.id, (200+n)::text, 4, 20+(n%20)*98, 20+(n/20)*62, 80, 48, TRUE FROM area a, generate_series(0,199) n WHERE a.name='TERRAZA';
