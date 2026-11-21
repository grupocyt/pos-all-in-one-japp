/* =====================================================================================================
   Japp Manager · tablas de la tienda para todas las tiendas (SQL Server, dbo): transacción, operación y configuración
   VERSIÓN 1 · CERRADA el 21/11/2026. Este archivo no se modifica nunca más: cualquier cambio en las tablas
   del Manager va en un script nuevo (manager-tpv-sqlserver-v2.sql, v3…) con ALTER TABLE / CREATE TABLE sobre
   lo que crea esta versión, sin tocar lo ya creado. Se puede ejecutar otra vez: solo crea lo que falte.
   Generado el 21/11/2026 a partir de las tablas de la base de la tienda (PostgreSQL, japp-db hasta la
   migración 0044 · API 1.2.296). Una tabla del Manager por cada tabla de la tienda, con los mismos
   nombres de columna, más:
     · cod_restaurante_integracion  = store.maxpoint_rst_id (IdIntegración del restaurante, p. ej. 41)
     · cod_tienda                   = store.code (p. ej. LG01)
     · recibido_en / actualizado_en = cuándo llegó al Manager y cuándo se actualizó por última vez
   Reglas:
     · Fechas en UTC (DATETIME2(3)); el día de negocio es el de Madrid (sales_period).
     · JSON de la tienda (jsonb) en NVARCHAR(MAX) con ISJSON.
     · Se mantienen las claves ajenas DENTRO de la misma transacción (llega todo junto). Las que apuntan
       a tablas de configuración de la tienda (usuarios, productos, equipos, formas de pago, motivos…)
       o a otra entidad que llega por separado (periodo, cliente, delivery, línea de otra mesa al transferir,
       registro VeriFactu anterior de la cadena) se quitan: se guarda el id.
     · Ids: los UUID de la tienda tal cual (son únicos en todas las tiendas).
     · Se llevan las 75 tablas de la tienda. No se llevan dos columnas: app_user.pin_hash (la clave de
       cada usuario) y oot_token.token (el código vigente del QR de la mesa).
     · Lo que en la tienda es único solo dentro del local va con la tienda delante en el Manager:
       permission y schema_migrations (cod_tienda), sync_outbox (store_id, id), company.tax_id y la
       numeración VeriFactu (cod_tienda).
     · Arrays de la tienda (display_media.days) como JSON: [1,2,3].
   ===================================================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* =====================================================================================================
   1 · TRANSACCIÓN
   ===================================================================================================== */
/* ---------- tpv_sales_period · Periodos de venta (uno abierto por local) ---------- */
IF OBJECT_ID(N'dbo.tpv_sales_period', N'U') IS NULL
CREATE TABLE dbo.tpv_sales_period (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_sales_period_status DEFAULT N'open',  -- Estado
    opened_by_user_id UNIQUEIDENTIFIER NULL,  -- Abierto por: usuario
    opened_by_user_name NVARCHAR(60) NOT NULL,  -- Abierto por: nombre (copia)
    opened_by_role NVARCHAR(30) NULL,  -- Abierto por: rol
    opened_by_device NVARCHAR(40) NULL,  -- Abierto por: equipo (CAJA1, PDA1…)
    opened_by_at DATETIME2(3) NOT NULL,  -- Abierto por: fecha y hora
    station_id UNIQUEIDENTIFIER NULL,  -- Estación donde se abrió
    closed_by_user_id UNIQUEIDENTIFIER NULL,  -- Cerrado por: usuario
    closed_by_user_name NVARCHAR(60) NULL,  -- Cerrado por: nombre (copia)
    closed_by_role NVARCHAR(30) NULL,  -- Cerrado por: rol
    closed_by_device NVARCHAR(40) NULL,  -- Cerrado por: equipo (CAJA1, PDA1…)
    closed_by_at DATETIME2(3) NULL,  -- Cerrado por: fecha y hora
    open_flag SMALLINT NULL,  -- 1 mientras está abierto (garantiza un solo periodo abierto)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sales_period_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sales_period_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_sales_period PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_sales_period_tienda')
    CREATE INDEX ix_tpv_sales_period_tienda ON dbo.tpv_sales_period (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_sales_period_store_id_open_flag')
    CREATE UNIQUE INDEX uq_tpv_sales_period_store_id_open_flag ON dbo.tpv_sales_period (store_id, open_flag) WHERE open_flag IS NOT NULL;
GO

/* ---------- tpv_customer_ref · Ficha de clientes para factura completa ---------- */
IF OBJECT_ID(N'dbo.tpv_customer_ref', N'U') IS NULL
CREATE TABLE dbo.tpv_customer_ref (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    type NVARCHAR(30) NOT NULL,  -- Particular o empresa
    tax_id NVARCHAR(20) NOT NULL,  -- NIF / CIF
    name NVARCHAR(120) NOT NULL,  -- Nombre o razón social
    email NVARCHAR(120) NULL,  -- Email
    phone NVARCHAR(30) NULL,  -- Teléfono
    street NVARCHAR(200) NULL,  -- Dirección
    postal_code NVARCHAR(10) NULL,  -- Código postal
    city NVARCHAR(80) NULL,  -- Ciudad
    province NVARCHAR(80) NULL,  -- Provincia
    country NVARCHAR(2) NULL CONSTRAINT df_tpv_customer_ref_country DEFAULT N'ES',  -- País (ISO)
    active BIT NOT NULL CONSTRAINT df_tpv_customer_ref_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_customer_ref_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_customer_ref_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_customer_ref_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_customer_ref_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_customer_ref PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_customer_ref_tienda')
    CREATE INDEX ix_tpv_customer_ref_tienda ON dbo.tpv_customer_ref (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_customer_ref_store_id_tax_id')
    CREATE UNIQUE INDEX uq_tpv_customer_ref_store_id_tax_id ON dbo.tpv_customer_ref (store_id, tax_id);
GO

/* ---------- tpv_orders · Orden de una mesa (la transacción). En fast food, la orden FASTFOOD de cada caja ---------- */
IF OBJECT_ID(N'dbo.tpv_orders', N'U') IS NULL
CREATE TABLE dbo.tpv_orders (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Id de la transacción (_id)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    period_id UNIQUEIDENTIFIER NULL,  -- Periodo de venta
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_orders_status DEFAULT N'open',  -- Estado (status)
    version INT NOT NULL CONSTRAINT df_tpv_orders_version DEFAULT 1,  -- Versión para concurrencia optimista (version)
    table_id UNIQUEIDENTIFIER NULL,  -- Mesa (NULL en fast food)
    table_name NVARCHAR(20) NOT NULL,  -- Nombre de la mesa (tableData.name)
    zone NVARCHAR(60) NULL,  -- Zona (tableData.zone)
    price_list NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_orders_price_list DEFAULT N'general',  -- Precio aplicado al abrir
    guests SMALLINT NOT NULL CONSTRAINT df_tpv_orders_guests DEFAULT 1,  -- Comensales (tableData.guests)
    note NVARCHAR(300) NULL,  -- Nota de la mesa (tableData.note)
    opened_by_user_id UNIQUEIDENTIFIER NULL,  -- Abierta por: usuario
    opened_by_user_name NVARCHAR(60) NOT NULL,  -- Abierta por: nombre (copia)
    opened_by_role NVARCHAR(30) NULL,  -- Abierta por: rol
    opened_by_device NVARCHAR(40) NULL,  -- Abierta por: equipo (CAJA1, PDA1…)
    opened_by_at DATETIME2(3) NOT NULL,  -- Abierta por: fecha y hora
    last_entry_user_id UNIQUEIDENTIFIER NULL,  -- Última entrada: usuario
    last_entry_user_name NVARCHAR(60) NULL,  -- Última entrada: nombre (copia)
    last_entry_role NVARCHAR(30) NULL,  -- Última entrada: rol
    last_entry_device NVARCHAR(40) NULL,  -- Última entrada: equipo (CAJA1, PDA1…)
    last_entry_at DATETIME2(3) NULL,  -- Última entrada: fecha y hora
    last_exit_user_id UNIQUEIDENTIFIER NULL,  -- Última salida: usuario
    last_exit_user_name NVARCHAR(60) NULL,  -- Última salida: nombre (copia)
    last_exit_role NVARCHAR(30) NULL,  -- Última salida: rol
    last_exit_device NVARCHAR(40) NULL,  -- Última salida: equipo (CAJA1, PDA1…)
    last_exit_at DATETIME2(3) NULL,  -- Última salida: fecha y hora
    closed_at DATETIME2(3) NULL,  -- Cierre de la mesa
    snapshot NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_orders_snapshot_json CHECK (snapshot IS NULL OR ISJSON(snapshot) = 1),  -- JSON completo de la orden al cerrarla (copia de auditoría)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_orders_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_orders_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    holder_user_id UNIQUEIDENTIFIER NULL,  -- Quién tiene la mesa ahora (una persona por mesa); vale mientras holder_until > now()
    holder_user_name NVARCHAR(80) NULL,  -- Nombre de quien tiene la mesa, para el aviso «Mesa ocupada por …»
    holder_station_id UNIQUEIDENTIFIER NULL,  -- Equipo desde el que se tiene la mesa
    holder_station_name NVARCHAR(60) NULL,  -- Nombre del equipo, para el aviso
    holder_until DATETIME2(3) NULL,  -- El equipo lo renueva cada 10 s; pasado este momento la mesa queda libre (equipo apagado o sin wifi)
    charging_until DATETIME2(3) NULL,  -- Cobro abierto en la mesa hasta este momento: nadie más entra, tampoco un administrador
    notes NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_orders_notes DEFAULT N'[]' CONSTRAINT ck_tpv_orders_notes_json CHECK (notes IS NULL OR ISJSON(notes) = 1),  -- Notas de la mesa: [{id, text, user, role, device, at}] (no se borran; note = todas juntas)
    customer_name NVARCHAR(40) NULL,  -- Nombre del cliente en fast food (sale en la comanda y en el ticket); no es un dato fiscal
    void_close NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_orders_void_close_json CHECK (void_close IS NULL OR ISJSON(void_close) = 1),  -- Cierre de la mesa entera con eliminaciones: {reason, amount, lines, user, role, device, at}
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_orders_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_orders_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_orders PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_orders_tienda')
    CREATE INDEX ix_tpv_orders_tienda ON dbo.tpv_orders (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_orders_period_id')
    CREATE INDEX ix_tpv_orders_period_id ON dbo.tpv_orders (period_id);
GO

/* ---------- tpv_account · Cuentas de la orden (accounts[]) ---------- */
IF OBJECT_ID(N'dbo.tpv_account', N'U') IS NULL
CREATE TABLE dbo.tpv_account (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Id de la cuenta (accounts[].id)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    order_id UNIQUEIDENTIFIER NOT NULL,  -- Orden
    name NVARCHAR(40) NOT NULL,  -- Nombre (Cuenta 1)
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_account_status DEFAULT N'open',  -- Estado
    note NVARCHAR(300) NULL,  -- Nota de la cuenta
    opened_by_user_id UNIQUEIDENTIFIER NULL,  -- Abierta por: usuario
    opened_by_user_name NVARCHAR(60) NOT NULL,  -- Abierta por: nombre (copia)
    opened_by_role NVARCHAR(30) NULL,  -- Abierta por: rol
    opened_by_device NVARCHAR(40) NULL,  -- Abierta por: equipo (CAJA1, PDA1…)
    opened_by_at DATETIME2(3) NOT NULL,  -- Abierta por: fecha y hora
    closed_by_user_id UNIQUEIDENTIFIER NULL,  -- Cerrada por: usuario
    closed_by_user_name NVARCHAR(60) NULL,  -- Cerrada por: nombre (copia)
    closed_by_role NVARCHAR(30) NULL,  -- Cerrada por: rol
    closed_by_device NVARCHAR(40) NULL,  -- Cerrada por: equipo (CAJA1, PDA1…)
    closed_by_at DATETIME2(3) NULL,  -- Cerrada por: fecha y hora
    last_entry_user_id UNIQUEIDENTIFIER NULL,  -- Último producto añadido: usuario
    last_entry_user_name NVARCHAR(60) NULL,  -- Último producto añadido: nombre (copia)
    last_entry_role NVARCHAR(30) NULL,  -- Último producto añadido: rol
    last_entry_device NVARCHAR(40) NULL,  -- Último producto añadido: equipo (CAJA1, PDA1…)
    last_entry_at DATETIME2(3) NULL,  -- Último producto añadido: fecha y hora
    customer_id UNIQUEIDENTIFIER NULL,  -- Cliente de la ficha (customerData.customerId)
    subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_account_subtotal DEFAULT 0,  -- Total PVP (totals.subtotal)
    discount_total DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_account_discount_total DEFAULT 0,  -- Descuentos (totals.discount)
    total DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_account_total DEFAULT 0,  -- Total a pagar (totals.total)
    paid DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_account_paid DEFAULT 0,  -- Pagado (totals.paid)
    pending DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_account_pending DEFAULT 0,  -- Pendiente (totals.pending)
    tips DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_account_tips DEFAULT 0,  -- Propinas (totals.tips)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_account_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_account_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    origin NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_account_origin_json CHECK (origin IS NULL OR ISJSON(origin) = 1),  -- Mesa de la que vino la cuenta al juntar o transferir a una mesa ocupada: table, by (quién), at
    kind NVARCHAR(20) NOT NULL CONSTRAINT df_tpv_account_kind DEFAULT N'normal',  -- normal u order_on_table (pedidos del cliente por el QR)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_account_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_account_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_account PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_account_tienda')
    CREATE INDEX ix_tpv_account_tienda ON dbo.tpv_account (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_account_order_id')
    CREATE INDEX ix_tpv_account_order_id ON dbo.tpv_account (order_id);
GO

/* ---------- tpv_order_line · Productos de la cuenta, también los eliminados (lines[] y deletedLines[]) ---------- */
IF OBJECT_ID(N'dbo.tpv_order_line', N'U') IS NULL
CREATE TABLE dbo.tpv_order_line (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Id de la línea
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    order_id UNIQUEIDENTIFIER NOT NULL,  -- Orden
    account_id UNIQUEIDENTIFIER NOT NULL,  -- Cuenta
    product_id UNIQUEIDENTIFIER NULL,  -- Producto de la carta
    plu INT NOT NULL,  -- PLU (productId)
    name NVARCHAR(80) NOT NULL,  -- Nombre (copia)
    comment NVARCHAR(300) NULL,  -- Comentario para cocina
    quantity DECIMAL(9,3) NOT NULL CONSTRAINT df_tpv_order_line_quantity DEFAULT 1,  -- Cantidad
    unit_price DECIMAL(10,2) NOT NULL,  -- PVP unitario aplicado (general o terraza)
    tax_rate DECIMAL(5,2) NOT NULL,  -- Tipo de IVA
    tax_amount DECIMAL(12,4) NULL,  -- IVA unitario (iva)
    net_amount DECIMAL(12,4) NULL,  -- Neto unitario (netoProce)
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_order_line_status DEFAULT N'pendingPrint',  -- Estado
    printed BIT NOT NULL CONSTRAINT df_tpv_order_line_printed DEFAULT 0,  -- Se imprimió en cocina o barra
    created_by_user_id UNIQUEIDENTIFIER NULL,  -- Pedido por: usuario
    created_by_user_name NVARCHAR(60) NOT NULL,  -- Pedido por: nombre (copia)
    created_by_role NVARCHAR(30) NULL,  -- Pedido por: rol
    created_by_device NVARCHAR(40) NULL,  -- Pedido por: equipo (CAJA1, PDA1…)
    created_by_origin NVARCHAR(30) NULL,  -- Pedido por: origen
    created_by_at DATETIME2(3) NOT NULL,  -- Pedido por: fecha y hora
    source_line_id UNIQUEIDENTIFIER NULL,  -- Línea de la que sale al separar o pasar de cuenta
    deleted BIT NOT NULL CONSTRAINT df_tpv_order_line_deleted DEFAULT 0,  -- Eliminada (va en deletedLines)
    delete_reason_id UNIQUEIDENTIFIER NULL,  -- Motivo de eliminación
    delete_reason NVARCHAR(80) NULL,  -- Motivo (copia)
    deleted_by_user_id UNIQUEIDENTIFIER NULL,  -- Eliminada por: usuario
    deleted_by_user_name NVARCHAR(60) NULL,  -- Eliminada por: nombre (copia)
    deleted_by_role NVARCHAR(30) NULL,  -- Eliminada por: rol
    deleted_by_device NVARCHAR(40) NULL,  -- Eliminada por: equipo (CAJA1, PDA1…)
    deleted_by_at DATETIME2(3) NULL,  -- Eliminada por: fecha y hora
    delete_authorized_by_user_id UNIQUEIDENTIFIER NULL,  -- Eliminación autorizada por: usuario
    delete_authorized_by_user_name NVARCHAR(60) NULL,  -- Eliminación autorizada por: nombre (copia)
    delete_authorized_by_role NVARCHAR(30) NULL,  -- Eliminación autorizada por: rol
    delete_authorized_by_device NVARCHAR(40) NULL,  -- Eliminación autorizada por: equipo (CAJA1, PDA1…)
    delete_authorized_by_at DATETIME2(3) NULL,  -- Eliminación autorizada por: fecha y hora
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    sort_order INT NOT NULL CONSTRAINT df_tpv_order_line_sort_order DEFAULT 0,  -- Posición de la línea en su cuenta (0, 1, 2…); fija el orden en pantalla y en la comanda
    courses NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_order_line_courses_json CHECK (courses IS NULL OR ISJSON(courses) = 1),  -- Pases del menú y su estado: pending|ready|held|fired, con la hora en que se marchó
    deleted_stage NVARCHAR(20) NULL,  -- Estado de la línea cuando se eliminó: pendingPrint (sin enviar) · printed (comanda impresa) · preBill (en precuenta)
    origin NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_order_line_origin_json CHECK (origin IS NULL OR ISJSON(origin) = 1),  -- Mesa de la que vino la línea al unirse a la cuenta principal de otra mesa: table
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_order_line PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_line_tienda')
    CREATE INDEX ix_tpv_order_line_tienda ON dbo.tpv_order_line (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_line_order_id')
    CREATE INDEX ix_tpv_order_line_order_id ON dbo.tpv_order_line (order_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_line_account_id')
    CREATE INDEX ix_tpv_order_line_account_id ON dbo.tpv_order_line (account_id);
GO

/* ---------- tpv_order_line_modifier · Respuestas de las preguntas de cada línea (modifiers[]) ---------- */
IF OBJECT_ID(N'dbo.tpv_order_line_modifier', N'U') IS NULL
CREATE TABLE dbo.tpv_order_line_modifier (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    line_id UNIQUEIDENTIFIER NOT NULL,  -- Línea
    question_id UNIQUEIDENTIFIER NULL,  -- Pregunta
    product_id UNIQUEIDENTIFIER NULL,  -- Producto respuesta
    plu INT NULL,  -- PLU (productId)
    name NVARCHAR(80) NOT NULL,  -- Nombre
    quantity DECIMAL(9,3) NOT NULL CONSTRAINT df_tpv_order_line_modifier_quantity DEFAULT 1,  -- Cantidad
    unit_price DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_order_line_modifier_unit_price DEFAULT 0,  -- Suplemento
    tax_amount DECIMAL(12,4) NULL,  -- IVA (iva)
    net_amount DECIMAL(12,4) NULL,  -- Neto (netoProce)
    course SMALLINT NULL,  -- Pase al que pertenece la respuesta (NULL = respuesta normal)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_modifier_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_modifier_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_order_line_modifier PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_line_modifier_tienda')
    CREATE INDEX ix_tpv_order_line_modifier_tienda ON dbo.tpv_order_line_modifier (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_line_modifier_line_id')
    CREATE INDEX ix_tpv_order_line_modifier_line_id ON dbo.tpv_order_line_modifier (line_id);
GO

/* ---------- tpv_order_line_printer · A qué impresora salió cada línea (printers[]) ---------- */
IF OBJECT_ID(N'dbo.tpv_order_line_printer', N'U') IS NULL
CREATE TABLE dbo.tpv_order_line_printer (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    line_id UNIQUEIDENTIFIER NOT NULL,  -- Línea
    channel_name NVARCHAR(40) NOT NULL,  -- Canal (area)
    printer_id UNIQUEIDENTIFIER NULL,  -- Impresora
    printer_name NVARCHAR(40) NULL,  -- Impresora (copia)
    interface NVARCHAR(120) NULL,  -- Conexión
    printed BIT NOT NULL CONSTRAINT df_tpv_order_line_printer_printed DEFAULT 0,  -- Impreso
    printed_at DATETIME2(3) NULL,  -- Impreso a las
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_printer_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_line_printer_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_order_line_printer PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_line_printer_tienda')
    CREATE INDEX ix_tpv_order_line_printer_tienda ON dbo.tpv_order_line_printer (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_line_printer_line_id')
    CREATE INDEX ix_tpv_order_line_printer_line_id ON dbo.tpv_order_line_printer (line_id);
GO

/* ---------- tpv_order_event · Eventos de la mesa y de cada cuenta (events[]) ---------- */
IF OBJECT_ID(N'dbo.tpv_order_event', N'U') IS NULL
CREATE TABLE dbo.tpv_order_event (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    order_id UNIQUEIDENTIFIER NOT NULL,  -- Orden
    account_id UNIQUEIDENTIFIER NULL,  -- Cuenta (NULL = evento de la mesa)
    type NVARCHAR(40) NOT NULL,  -- Tipo (tableOpened, linePrinted, invoiceIssued…)
    at DATETIME2(3) NOT NULL,  -- Fecha y hora
    description NVARCHAR(400) NULL,  -- Descripción
    user_id UNIQUEIDENTIFIER NULL,  -- Usuario
    user_name NVARCHAR(60) NULL,  -- Usuario (copia)
    role NVARCHAR(30) NULL,  -- Rol
    device NVARCHAR(40) NULL,  -- Equipo
    origin NVARCHAR(30) NULL,  -- Origen
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_event_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_event_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_order_event PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_event_tienda')
    CREATE INDEX ix_tpv_order_event_tienda ON dbo.tpv_order_event (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_event_order_id')
    CREATE INDEX ix_tpv_order_event_order_id ON dbo.tpv_order_event (order_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_event_account_id')
    CREATE INDEX ix_tpv_order_event_account_id ON dbo.tpv_order_event (account_id);
GO

/* ---------- tpv_account_discount · Descuentos aplicados a una cuenta (discounts[]) ---------- */
IF OBJECT_ID(N'dbo.tpv_account_discount', N'U') IS NULL
CREATE TABLE dbo.tpv_account_discount (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    account_id UNIQUEIDENTIFIER NOT NULL,  -- Cuenta
    discount_id UNIQUEIDENTIFIER NULL,  -- Descuento configurado
    source NVARCHAR(30) NOT NULL,  -- Origen
    coupon_id NVARCHAR(40) NULL,  -- Id del cupón
    coupon_code NVARCHAR(40) NULL,  -- Código del cupón
    type NVARCHAR(30) NOT NULL,  -- Porcentaje o importe fijo
    value DECIMAL(10,2) NOT NULL,  -- Valor
    base_amount DECIMAL(10,2) NOT NULL,  -- Base de cálculo (PVP)
    amount DECIMAL(10,2) NOT NULL,  -- Importe descontado
    reason NVARCHAR(120) NULL,  -- Motivo
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_account_discount_status DEFAULT N'applied',  -- Estado
    applied_by_user_id UNIQUEIDENTIFIER NULL,  -- Aplicado por: usuario
    applied_by_user_name NVARCHAR(60) NOT NULL,  -- Aplicado por: nombre (copia)
    applied_by_role NVARCHAR(30) NULL,  -- Aplicado por: rol
    applied_by_device NVARCHAR(40) NULL,  -- Aplicado por: equipo (CAJA1, PDA1…)
    applied_by_at DATETIME2(3) NOT NULL,  -- Aplicado por: fecha y hora
    authorized_by_user_id UNIQUEIDENTIFIER NULL,  -- Autorizado por: usuario
    authorized_by_user_name NVARCHAR(60) NULL,  -- Autorizado por: nombre (copia)
    authorized_by_role NVARCHAR(30) NULL,  -- Autorizado por: rol
    authorized_by_device NVARCHAR(40) NULL,  -- Autorizado por: equipo (CAJA1, PDA1…)
    authorized_by_at DATETIME2(3) NULL,  -- Autorizado por: fecha y hora
    removed_by_user_id UNIQUEIDENTIFIER NULL,  -- Retirado por: usuario
    removed_by_user_name NVARCHAR(60) NULL,  -- Retirado por: nombre (copia)
    removed_by_role NVARCHAR(30) NULL,  -- Retirado por: rol
    removed_by_device NVARCHAR(40) NULL,  -- Retirado por: equipo (CAJA1, PDA1…)
    removed_by_at DATETIME2(3) NULL,  -- Retirado por: fecha y hora
    form_data NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_account_discount_form_data_json CHECK (form_data IS NULL OR ISJSON(form_data) = 1),  -- Lo rellenado en el formulario del descuento ([{label,value}]); sale en la factura
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_account_discount_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_account_discount_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_account_discount PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_account_discount_tienda')
    CREATE INDEX ix_tpv_account_discount_tienda ON dbo.tpv_account_discount (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_account_discount_account_id')
    CREATE INDEX ix_tpv_account_discount_account_id ON dbo.tpv_account_discount (account_id);
GO

/* ---------- tpv_payment · Pagos de una cuenta (payments[]) ---------- */
IF OBJECT_ID(N'dbo.tpv_payment', N'U') IS NULL
CREATE TABLE dbo.tpv_payment (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    account_id UNIQUEIDENTIFIER NOT NULL,  -- Cuenta
    payment_method_id UNIQUEIDENTIFIER NULL,  -- Forma de pago
    method NVARCHAR(30) NOT NULL,  -- Método
    amount DECIMAL(10,2) NOT NULL,  -- Importe aplicado a la cuenta
    tip DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_payment_tip DEFAULT 0,  -- Propina
    cash_given DECIMAL(10,2) NULL,  -- Entregado por el cliente
    change_given DECIMAL(10,2) NULL,  -- Cambio devuelto
    status NVARCHAR(30) NOT NULL,  -- Estado
    station_id UNIQUEIDENTIFIER NULL,  -- Estación o PDA
    collected_by_user_id UNIQUEIDENTIFIER NULL,  -- Cobrado por: usuario
    collected_by_user_name NVARCHAR(60) NOT NULL,  -- Cobrado por: nombre (copia)
    collected_by_role NVARCHAR(30) NULL,  -- Cobrado por: rol
    collected_by_device NVARCHAR(40) NULL,  -- Cobrado por: equipo (CAJA1, PDA1…)
    collected_by_at DATETIME2(3) NOT NULL,  -- Cobrado por: fecha y hora
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_payment PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_payment_tienda')
    CREATE INDEX ix_tpv_payment_tienda ON dbo.tpv_payment (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_payment_account_id')
    CREATE INDEX ix_tpv_payment_account_id ON dbo.tpv_payment (account_id);
GO

/* ---------- tpv_payment_cash_detail · Billetes y monedas recibidos y devueltos (cashDetail) ---------- */
IF OBJECT_ID(N'dbo.tpv_payment_cash_detail', N'U') IS NULL
CREATE TABLE dbo.tpv_payment_cash_detail (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    payment_id UNIQUEIDENTIFIER NOT NULL,  -- Pago
    direction NVARCHAR(30) NOT NULL,  -- Recibido o devuelto
    kind NVARCHAR(30) NOT NULL,  -- Billete o moneda
    value DECIMAL(10,2) NOT NULL,  -- Valor
    quantity SMALLINT NOT NULL,  -- Cantidad
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_cash_detail_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_cash_detail_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_payment_cash_detail PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_payment_cash_detail_tienda')
    CREATE INDEX ix_tpv_payment_cash_detail_tienda ON dbo.tpv_payment_cash_detail (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_payment_cash_detail_payment_id')
    CREATE INDEX ix_tpv_payment_cash_detail_payment_id ON dbo.tpv_payment_cash_detail (payment_id);
GO

/* ---------- tpv_payment_bank_data · Respuesta del datáfono o del banco (bankData) ---------- */
IF OBJECT_ID(N'dbo.tpv_payment_bank_data', N'U') IS NULL
CREATE TABLE dbo.tpv_payment_bank_data (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    payment_id UNIQUEIDENTIFIER NOT NULL,  -- Pago
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    provider NVARCHAR(40) NULL,  -- Proveedor (redsys…)
    merchant_id NVARCHAR(40) NULL,  -- Comercio
    terminal_id NVARCHAR(40) NULL,  -- Terminal
    transaction_id NVARCHAR(60) NULL,  -- Operación
    authorization_code NVARCHAR(20) NULL,  -- Autorización
    response_code NVARCHAR(10) NULL,  -- Código de respuesta
    response_message NVARCHAR(120) NULL,  -- Mensaje
    card_brand NVARCHAR(20) NULL,  -- Marca de la tarjeta
    masked_pan NVARCHAR(30) NULL,  -- Tarjeta enmascarada
    entry_mode NVARCHAR(20) NULL,  -- Lectura (contactless, chip…)
    masked_phone NVARCHAR(30) NULL,  -- Teléfono enmascarado (Bizum)
    amount DECIMAL(10,2) NULL,  -- Importe en el banco
    currency NVARCHAR(3) NULL,  -- Moneda
    processed_at DATETIME2(3) NULL,  -- Procesado
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_bank_data_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_bank_data_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_payment_bank_data PRIMARY KEY (payment_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_payment_bank_data_tienda')
    CREATE INDEX ix_tpv_payment_bank_data_tienda ON dbo.tpv_payment_bank_data (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_payment_bank_data_payment_id')
    CREATE INDEX ix_tpv_payment_bank_data_payment_id ON dbo.tpv_payment_bank_data (payment_id);
GO

/* ---------- tpv_invoice · Facturas emitidas (accounts[].invoice). Inmutables ---------- */
IF OBJECT_ID(N'dbo.tpv_invoice', N'U') IS NULL
CREATE TABLE dbo.tpv_invoice (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    account_id UNIQUEIDENTIFIER NULL,  -- Cuenta facturada
    order_id UNIQUEIDENTIFIER NULL,  -- Orden
    type NVARCHAR(30) NOT NULL,  -- Tipo VeriFactu: F1 completa, F2 simplificada, F3 sustitutiva, R1…R5 rectificativas (R5 = abono de simplificada)
    series NVARCHAR(20) NOT NULL,  -- Serie
    sequence INT NOT NULL,  -- Número secuencial
    invoice_number NVARCHAR(40) NOT NULL,  -- Número completo (T2026-001426)
    issued_at DATETIME2(3) NOT NULL,  -- Fecha de expedición
    issuer_tax_id NVARCHAR(20) NOT NULL,  -- NIF del emisor (copia)
    issuer_name NVARCHAR(120) NOT NULL,  -- Emisor (copia)
    customer_id UNIQUEIDENTIFIER NULL,  -- Cliente de la ficha
    customer_type NVARCHAR(30) NULL,  -- Cliente: tipo (copia)
    customer_tax_id NVARCHAR(20) NULL,  -- Cliente: NIF (copia)
    customer_name NVARCHAR(120) NULL,  -- Cliente: nombre (copia)
    customer_email NVARCHAR(120) NULL,  -- Cliente: email
    customer_phone NVARCHAR(30) NULL,  -- Cliente: teléfono
    customer_street NVARCHAR(200) NULL,  -- Cliente: dirección
    customer_postal_code NVARCHAR(10) NULL,  -- Cliente: código postal
    customer_city NVARCHAR(80) NULL,  -- Cliente: ciudad
    customer_province NVARCHAR(80) NULL,  -- Cliente: provincia
    customer_country NVARCHAR(2) NULL,  -- Cliente: país
    tax_base DECIMAL(10,2) NOT NULL,  -- Base imponible
    tax_total DECIMAL(10,2) NOT NULL,  -- Cuota de IVA
    total DECIMAL(10,2) NOT NULL,  -- Importe total
    rectified_invoice_id UNIQUEIDENTIFIER NULL,  -- Factura que rectifica (R1)
    rectification_reason NVARCHAR(200) NULL,  -- Motivo de la rectificación
    verifactu_qr NVARCHAR(400) NULL,  -- URL del QR VERI*FACTU
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_invoice_status DEFAULT N'issued',  -- Estado
    issued_by_user_id UNIQUEIDENTIFIER NULL,  -- Emitida por: usuario
    issued_by_user_name NVARCHAR(60) NOT NULL,  -- Emitida por: nombre (copia)
    issued_by_role NVARCHAR(30) NULL,  -- Emitida por: rol
    issued_by_device NVARCHAR(40) NULL,  -- Emitida por: equipo (CAJA1, PDA1…)
    issued_by_at DATETIME2(3) NOT NULL,  -- Emitida por: fecha y hora
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_created_at DEFAULT SYSUTCDATETIME(),  -- Alta
    email_status NVARCHAR(12) NOT NULL CONSTRAINT df_tpv_invoice_email_status DEFAULT N'not_sent',  -- Envío por email: not_sent (no se envían correos, 04/11/2026), sent o failed
    substituted_invoice_id UNIQUEIDENTIFIER NULL,  -- F3: factura simplificada a la que sustituye
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_invoice PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_tienda')
    CREATE INDEX ix_tpv_invoice_tienda ON dbo.tpv_invoice (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_invoice_store_id_series_sequence')
    CREATE UNIQUE INDEX uq_tpv_invoice_store_id_series_sequence ON dbo.tpv_invoice (store_id, series, sequence);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_invoice_invoice_number_store_id')
    CREATE UNIQUE INDEX uq_tpv_invoice_invoice_number_store_id ON dbo.tpv_invoice (invoice_number, store_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_account_id')
    CREATE INDEX ix_tpv_invoice_account_id ON dbo.tpv_invoice (account_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_order_id')
    CREATE INDEX ix_tpv_invoice_order_id ON dbo.tpv_invoice (order_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_rectified_invoice_id')
    CREATE INDEX ix_tpv_invoice_rectified_invoice_id ON dbo.tpv_invoice (rectified_invoice_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_substituted_invoice_id')
    CREATE INDEX ix_tpv_invoice_substituted_invoice_id ON dbo.tpv_invoice (substituted_invoice_id);
GO

/* ---------- tpv_invoice_tax · Desglose de impuestos de la factura ---------- */
IF OBJECT_ID(N'dbo.tpv_invoice_tax', N'U') IS NULL
CREATE TABLE dbo.tpv_invoice_tax (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    invoice_id UNIQUEIDENTIFIER NOT NULL,  -- Factura
    rate DECIMAL(5,2) NOT NULL,  -- Tipo de IVA
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    base DECIMAL(10,2) NOT NULL,  -- Base
    tax DECIMAL(10,2) NOT NULL,  -- Cuota
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_tax_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_tax_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_invoice_tax PRIMARY KEY (invoice_id, rate)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_tax_tienda')
    CREATE INDEX ix_tpv_invoice_tax_tienda ON dbo.tpv_invoice_tax (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_tax_invoice_id')
    CREATE INDEX ix_tpv_invoice_tax_invoice_id ON dbo.tpv_invoice_tax (invoice_id);
GO

/* ---------- tpv_invoice_credit_line · Unidades de cada línea que abona una rectificativa (abono total o parcial) ---------- */
IF OBJECT_ID(N'dbo.tpv_invoice_credit_line', N'U') IS NULL
CREATE TABLE dbo.tpv_invoice_credit_line (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_tpv_invoice_credit_line_id DEFAULT NEWID(),  -- Identificador
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    credit_invoice_id UNIQUEIDENTIFIER NOT NULL,  -- Rectificativa (R1 o R5)
    rectified_invoice_id UNIQUEIDENTIFIER NOT NULL,  -- Factura que se abona
    order_line_id UNIQUEIDENTIFIER NOT NULL,  -- Línea vendida que se abona
    quantity DECIMAL(9,3) NOT NULL,  -- Unidades abonadas
    amount DECIMAL(10,2) NOT NULL,  -- Importe abonado con IVA (en positivo; la rectificativa lleva el total en negativo)
    tax_rate DECIMAL(5,2) NOT NULL,  -- Tipo de IVA de la línea
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_credit_line_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_credit_line_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_invoice_credit_line PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_credit_line_tienda')
    CREATE INDEX ix_tpv_invoice_credit_line_tienda ON dbo.tpv_invoice_credit_line (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_credit_line_rectified_invoice_id')
    CREATE INDEX ix_tpv_invoice_credit_line_rectified_invoice_id ON dbo.tpv_invoice_credit_line (rectified_invoice_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_invoice_credit_line_credit_invoice_id_order_line_id')
    CREATE UNIQUE INDEX uq_tpv_invoice_credit_line_credit_invoice_id_order_line_id ON dbo.tpv_invoice_credit_line (credit_invoice_id, order_line_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_credit_line_order_line_id')
    CREATE INDEX ix_tpv_invoice_credit_line_order_line_id ON dbo.tpv_invoice_credit_line (order_line_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_credit_line_credit_invoice_id')
    CREATE INDEX ix_tpv_invoice_credit_line_credit_invoice_id ON dbo.tpv_invoice_credit_line (credit_invoice_id);
GO

/* ---------- tpv_verifactu_record · Registro VeriFactu: alta o anulación con huella encadenada y envío a la AEAT ---------- */
IF OBJECT_ID(N'dbo.tpv_verifactu_record', N'U') IS NULL
CREATE TABLE dbo.tpv_verifactu_record (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    invoice_id UNIQUEIDENTIFIER NOT NULL,  -- Factura
    record_type NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_verifactu_record_record_type DEFAULT N'alta',  -- Tipo de registro
    issuer_tax_id NVARCHAR(20) NOT NULL,  -- NIF del emisor
    invoice_number NVARCHAR(40) NOT NULL,  -- Número de factura
    issued_on DATE NOT NULL,  -- Fecha de expedición
    invoice_type NVARCHAR(30) NOT NULL,  -- Tipo de factura
    tax_total DECIMAL(10,2) NOT NULL,  -- Cuota total
    total DECIMAL(10,2) NOT NULL,  -- Importe total
    previous_record_id UNIQUEIDENTIFIER NULL,  -- Registro anterior de la cadena
    previous_hash NVARCHAR(64) NULL,  -- Huella del registro anterior
    hash NVARCHAR(64) NOT NULL,  -- Huella SHA-256 de este registro
    generated_at DATETIME2(3) NOT NULL,  -- Fecha, hora y huso de generación
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_verifactu_record_status DEFAULT N'pending',  -- Envío a la AEAT
    aeat_csv NVARCHAR(40) NULL,  -- CSV devuelto por la AEAT
    aeat_response NVARCHAR(MAX) NULL,  -- Respuesta de la AEAT
    sent_at DATETIME2(3) NULL,  -- Enviado
    attempts SMALLINT NOT NULL CONSTRAINT df_tpv_verifactu_record_attempts DEFAULT 0,  -- Intentos de envío
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_verifactu_record_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_verifactu_record_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_verifactu_record PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_verifactu_record_tienda')
    CREATE INDEX ix_tpv_verifactu_record_tienda ON dbo.tpv_verifactu_record (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_verifactu_record_cod_tienda_issuer_tax_id_invoice_number_record_type')
    CREATE UNIQUE INDEX uq_tpv_verifactu_record_cod_tienda_issuer_tax_id_invoice_number_record_type ON dbo.tpv_verifactu_record (cod_tienda, issuer_tax_id, invoice_number, record_type);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_verifactu_record_invoice_id')
    CREATE INDEX ix_tpv_verifactu_record_invoice_id ON dbo.tpv_verifactu_record (invoice_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_verifactu_record_hash')
    CREATE UNIQUE INDEX uq_tpv_verifactu_record_hash ON dbo.tpv_verifactu_record (hash);
GO

/* ---------- tpv_order_reconnection · Lo ticado sin conexión, pendiente de validar o descartar (Reconexiones de la orden) ---------- */
IF OBJECT_ID(N'dbo.tpv_order_reconnection', N'U') IS NULL
CREATE TABLE dbo.tpv_order_reconnection (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    order_id UNIQUEIDENTIFIER NOT NULL,
    account_id UNIQUEIDENTIFIER NULL,
    client_id NVARCHAR(80) NOT NULL,  -- Id que puso el equipo al marcarlo: un reintento no lo duplica
    plu INT NOT NULL,
    name NVARCHAR(120) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_order_reconnection_unit_price DEFAULT 0,
    detail NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_order_reconnection_detail DEFAULT N'{}' CONSTRAINT ck_tpv_order_reconnection_detail_json CHECK (detail IS NULL OR ISJSON(detail) = 1),  -- Respuestas, comentario y pases tal como se marcaron
    marked_at DATETIME2(3) NOT NULL,
    marked_by_id UNIQUEIDENTIFIER NULL,
    marked_by_name NVARCHAR(60) NULL,
    device NVARCHAR(40) NULL,
    offline_reason NVARCHAR(80) NULL,  -- Motivo de la desconexión que vio el equipo (sin red, servidor sin respuesta)
    status NVARCHAR(12) NOT NULL CONSTRAINT df_tpv_order_reconnection_status DEFAULT N'pending',
    decided_at DATETIME2(3) NULL,
    decided_by_name NVARCHAR(60) NULL,
    authorized_by_name NVARCHAR(60) NULL,
    decision_reason NVARCHAR(200) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_reconnection_created_at DEFAULT SYSUTCDATETIME(),
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_reconnection_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_reconnection_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_order_reconnection PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_reconnection_tienda')
    CREATE INDEX ix_tpv_order_reconnection_tienda ON dbo.tpv_order_reconnection (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_order_reconnection_store_id_client_id')
    CREATE UNIQUE INDEX uq_tpv_order_reconnection_store_id_client_id ON dbo.tpv_order_reconnection (store_id, client_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_reconnection_order_id')
    CREATE INDEX ix_tpv_order_reconnection_order_id ON dbo.tpv_order_reconnection (order_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_reconnection_account_id')
    CREATE INDEX ix_tpv_order_reconnection_account_id ON dbo.tpv_order_reconnection (account_id);
GO

/* ---------- tpv_order_incident · Incidencias de mesa: sin conexión, no cuadra con el servidor o cambio rechazado. Se guardan solas; resolverlas lo decide una persona en el equipo donde pasó ---------- */
IF OBJECT_ID(N'dbo.tpv_order_incident', N'U') IS NULL
CREATE TABLE dbo.tpv_order_incident (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Lo genera el equipo: repetir el envío no duplica la incidencia
    store_id UNIQUEIDENTIFIER NOT NULL,
    order_id UNIQUEIDENTIFIER NULL,  -- Orden de la mesa (sin FK: puede no existir aún en el servidor si se abrió sin conexión)
    account_id UNIQUEIDENTIFIER NULL,
    table_name NVARCHAR(20) NOT NULL,
    kind NVARCHAR(20) NOT NULL,  -- offline (cambios que se quedaron en el equipo), mismatch (pantalla y servidor no coinciden) o rejected (el servidor no aceptó un cambio)
    status NVARCHAR(20) NOT NULL CONSTRAINT df_tpv_order_incident_status DEFAULT N'open',  -- open; retried (se reintentó el envío), discarded (se quedó lo del servidor) o resolved (volvió a cuadrar sola)
    detail NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_order_incident_detail DEFAULT N'{}' CONSTRAINT ck_tpv_order_incident_detail_json CHECK (detail IS NULL OR ISJSON(detail) = 1),  -- Cambios pendientes, diferencias o error, tal como los vio el equipo
    station_id UNIQUEIDENTIFIER NULL,
    device NVARCHAR(60) NULL,  -- Nombre del equipo donde pasó
    occurred_at DATETIME2(3) NOT NULL,  -- Hora del equipo en que pasó (puede ser anterior a opened_by_at si estuvo sin conexión)
    opened_by_user_id UNIQUEIDENTIFIER NULL,
    opened_by_user_name NVARCHAR(80) NOT NULL,
    opened_by_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_incident_opened_by_at DEFAULT SYSUTCDATETIME(),
    resolved_by_user_id UNIQUEIDENTIFIER NULL,
    resolved_by_user_name NVARCHAR(80) NULL,
    resolved_authorized_by NVARCHAR(80) NULL,  -- Encargado que autorizó la resolución, si hizo falta
    resolved_by_at DATETIME2(3) NULL,
    resolution_note NVARCHAR(200) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_incident_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_incident_updated_at DEFAULT SYSUTCDATETIME(),
    version INT NOT NULL CONSTRAINT df_tpv_order_incident_version DEFAULT 1,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_incident_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_order_incident_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_order_incident PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_incident_tienda')
    CREATE INDEX ix_tpv_order_incident_tienda ON dbo.tpv_order_incident (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_incident_order_id')
    CREATE INDEX ix_tpv_order_incident_order_id ON dbo.tpv_order_incident (order_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_order_incident_account_id')
    CREATE INDEX ix_tpv_order_incident_account_id ON dbo.tpv_order_incident (account_id);
GO

/* ---------- tpv_delivery_order · Pedidos de delivery del tablero Pedidos (Glovo, Uber Eats, Just Eat, web propia…) ---------- */
IF OBJECT_ID(N'dbo.tpv_delivery_order', N'U') IS NULL
CREATE TABLE dbo.tpv_delivery_order (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    period_id UNIQUEIDENTIFIER NULL,
    platform NVARCHAR(20) NOT NULL,
    code NVARCHAR(30) NOT NULL,  -- Transacción que se enseña en el tablero (GLV-4821)
    external_id NVARCHAR(80) NULL,  -- Id del pedido en la plataforma o el integrador: el mismo pedido no entra dos veces
    customer_name NVARCHAR(80) NOT NULL,
    customer_phone NVARCHAR(20) NULL,
    address NVARCHAR(200) NULL,
    payment_note NVARCHAR(80) NULL,  -- Cómo se paga, tal como llega («Pagado online», «Paga en la entrega · tarjeta»)
    note NVARCHAR(300) NULL,
    status NVARCHAR(12) NOT NULL CONSTRAINT df_tpv_delivery_order_status DEFAULT N'pending',
    rider_id UNIQUEIDENTIFIER NULL,
    rider_name NVARCHAR(60) NULL,  -- Quién lo lleva: el nombre del motorizado al asignarlo o «Repartidor de la plataforma» (sin rider_id)
    total DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_delivery_order_total DEFAULT 0,
    received_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_received_at DEFAULT SYSUTCDATETIME(),  -- Cuándo llegó: de aquí salen la espera y el semáforo
    finished_at DATETIME2(3) NULL,
    order_id UNIQUEIDENTIFIER NULL,  -- Transacción del TPV si el pedido se factura en la tienda (vacío mientras no)
    version INT NOT NULL CONSTRAINT df_tpv_delivery_order_version DEFAULT 1,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_updated_at DEFAULT SYSUTCDATETIME(),
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_delivery_order PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_order_tienda')
    CREATE INDEX ix_tpv_delivery_order_tienda ON dbo.tpv_delivery_order (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_order_period_id')
    CREATE INDEX ix_tpv_delivery_order_period_id ON dbo.tpv_delivery_order (period_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_order_order_id')
    CREATE INDEX ix_tpv_delivery_order_order_id ON dbo.tpv_delivery_order (order_id);
GO

/* ---------- tpv_delivery_order_line · Productos de un pedido de delivery tal como llegan (product_id si se reconoce el PLU de la carta) ---------- */
IF OBJECT_ID(N'dbo.tpv_delivery_order_line', N'U') IS NULL
CREATE TABLE dbo.tpv_delivery_order_line (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    delivery_order_id UNIQUEIDENTIFIER NOT NULL,
    line_no SMALLINT NOT NULL,
    product_id UNIQUEIDENTIFIER NULL,
    name NVARCHAR(120) NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    note NVARCHAR(200) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_line_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_line_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_delivery_order_line PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_order_line_tienda')
    CREATE INDEX ix_tpv_delivery_order_line_tienda ON dbo.tpv_delivery_order_line (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_order_line_delivery_order_id')
    CREATE INDEX ix_tpv_delivery_order_line_delivery_order_id ON dbo.tpv_delivery_order_line (delivery_order_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_delivery_order_line_delivery_order_id_line_no')
    CREATE UNIQUE INDEX uq_tpv_delivery_order_line_delivery_order_id_line_no ON dbo.tpv_delivery_order_line (delivery_order_id, line_no);
GO

/* ---------- tpv_delivery_order_event · Pasos de cada pedido: estado, cuándo y quién (by_name = «Integración» o «Automático» si no lo hizo una persona) ---------- */
IF OBJECT_ID(N'dbo.tpv_delivery_order_event', N'U') IS NULL
CREATE TABLE dbo.tpv_delivery_order_event (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    delivery_order_id UNIQUEIDENTIFIER NOT NULL,
    status NVARCHAR(12) NOT NULL,
    at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_event_at DEFAULT SYSUTCDATETIME(),
    user_id UNIQUEIDENTIFIER NULL,
    by_name NVARCHAR(80) NULL,
    note NVARCHAR(300) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_event_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_order_event_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_delivery_order_event PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_order_event_tienda')
    CREATE INDEX ix_tpv_delivery_order_event_tienda ON dbo.tpv_delivery_order_event (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_order_event_delivery_order_id')
    CREATE INDEX ix_tpv_delivery_order_event_delivery_order_id ON dbo.tpv_delivery_order_event (delivery_order_id);
GO

/* =====================================================================================================
   2 · OPERACIÓN DIARIA
   ===================================================================================================== */
/* ---------- tpv_cash_movement · Movimientos de caja: fondo, retiros, arqueos y depósitos ---------- */
IF OBJECT_ID(N'dbo.tpv_cash_movement', N'U') IS NULL
CREATE TABLE dbo.tpv_cash_movement (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    period_id UNIQUEIDENTIFIER NOT NULL,  -- Periodo
    station_id UNIQUEIDENTIFIER NULL,  -- Estación
    kind NVARCHAR(30) NOT NULL,  -- Tipo de movimiento
    amount DECIMAL(10,2) NOT NULL,  -- Importe
    reason_id UNIQUEIDENTIFIER NULL,  -- Motivo
    note NVARCHAR(200) NULL,  -- Comentario
    counted_detail NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_cash_movement_counted_detail_json CHECK (counted_detail IS NULL OR ISJSON(counted_detail) = 1),  -- Billetes y monedas contados (arqueo)
    by_user_id UNIQUEIDENTIFIER NULL,  -- Hecho por: usuario
    by_user_name NVARCHAR(60) NOT NULL,  -- Hecho por: nombre (copia)
    by_role NVARCHAR(30) NULL,  -- Hecho por: rol
    by_device NVARCHAR(40) NULL,  -- Hecho por: equipo (CAJA1, PDA1…)
    by_at DATETIME2(3) NOT NULL,  -- Hecho por: fecha y hora
    authorized_by NVARCHAR(60) NULL,  -- Autorizado por
    card_detail NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_cash_movement_card_detail_json CHECK (card_detail IS NULL OR ISJSON(card_detail) = 1),  -- Arqueo: total de cada datáfono [{name, amount}]
    counted_card DECIMAL(10,2) NULL,
    count_type NVARCHAR(12) NULL,  -- Conteo: arqueo, apertura (base de la mañana), cortex (corte X contado) o auditoria
    expected_cash DECIMAL(10,2) NULL,
    expected_card DECIMAL(10,2) NULL,  -- Tarjeta esperada en los datáfonos (ventas + propinas con tarjeta) al contar
    cash_tips DECIMAL(10,2) NULL,
    card_tips DECIMAL(10,2) NULL,
    tips_confirmed BIT NULL,
    difference DECIMAL(10,2) NULL,
    voided_at DATETIME2(3) NULL,  -- Sin uso desde la 1.2.282: los cortes X y arqueos no se eliminan
    voided_by_name NVARCHAR(60) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_cash_movement_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_cash_movement_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_cash_movement PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_cash_movement_tienda')
    CREATE INDEX ix_tpv_cash_movement_tienda ON dbo.tpv_cash_movement (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_cash_movement_period_id')
    CREATE INDEX ix_tpv_cash_movement_period_id ON dbo.tpv_cash_movement (period_id);
GO

/* ---------- tpv_cash_closing · Cierre de periodo y arqueo final ---------- */
IF OBJECT_ID(N'dbo.tpv_cash_closing', N'U') IS NULL
CREATE TABLE dbo.tpv_cash_closing (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    period_id UNIQUEIDENTIFIER NOT NULL,  -- Periodo
    counted_cash DECIMAL(10,2) NOT NULL,  -- Efectivo contado
    counted_card DECIMAL(10,2) NULL,  -- Tarjeta según datáfono
    expected_cash DECIMAL(10,2) NOT NULL,  -- Efectivo que debería haber
    difference DECIMAL(10,2) NOT NULL,  -- Diferencia
    next_float DECIMAL(10,2) NOT NULL,  -- Fondo para el siguiente periodo
    deposit DECIMAL(10,2) NOT NULL,  -- Depósito
    gross_sales DECIMAL(10,2) NOT NULL,  -- Venta total
    guests INT NULL,  -- Comensales
    by_user_id UNIQUEIDENTIFIER NULL,  -- Cerrado por: usuario
    by_user_name NVARCHAR(60) NOT NULL,  -- Cerrado por: nombre (copia)
    by_role NVARCHAR(30) NULL,  -- Cerrado por: rol
    by_device NVARCHAR(40) NULL,  -- Cerrado por: equipo (CAJA1, PDA1…)
    by_at DATETIME2(3) NOT NULL,  -- Cerrado por: fecha y hora
    authorized_by NVARCHAR(60) NULL,  -- Autorizado por
    note NVARCHAR(300) NULL,  -- Motivo del descuadre escrito al cerrar (sale en el corte Z)
    card_detail NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_cash_closing_card_detail_json CHECK (card_detail IS NULL OR ISJSON(card_detail) = 1),  -- Cierre: total de cada datáfono [{name, amount}]
    method_detail NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_cash_closing_method_detail_json CHECK (method_detail IS NULL OR ISJSON(method_detail) = 1),  -- Contado de cada forma de pago en el cierre ([{method,name,counted,expected}]); efectivo y tarjeta también van en counted_cash y counted_card
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_cash_closing_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_cash_closing_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_cash_closing PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_cash_closing_tienda')
    CREATE INDEX ix_tpv_cash_closing_tienda ON dbo.tpv_cash_closing (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_cash_closing_period_id')
    CREATE UNIQUE INDEX uq_tpv_cash_closing_period_id ON dbo.tpv_cash_closing (period_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_cash_closing_period_id')
    CREATE INDEX ix_tpv_cash_closing_period_id ON dbo.tpv_cash_closing (period_id);
GO

/* ---------- tpv_period_summary · Resumen de cada periodo cerrado (Gestor de cierres): totales, por hora, por camarero, formas de pago y anulaciones ---------- */
IF OBJECT_ID(N'dbo.tpv_period_summary', N'U') IS NULL
CREATE TABLE dbo.tpv_period_summary (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Id
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local
    period_id UNIQUEIDENTIFIER NOT NULL,  -- Periodo resumido (uno por periodo)
    business_date DATE NOT NULL,  -- Día de negocio en hora de Madrid (el de la apertura): un cierre a las 00:30 cuenta para el día anterior
    opened_at DATETIME2(3) NOT NULL,  -- Apertura del periodo
    closed_at DATETIME2(3) NOT NULL,  -- Cierre del periodo
    gross_sales DECIMAL(10,2) NOT NULL,  -- Venta con IVA (facturas F1+F2 menos rectificativas)
    tax_base DECIMAL(10,2) NOT NULL,  -- Base imponible
    tax_total DECIMAL(10,2) NOT NULL,  -- Cuota de IVA
    tickets INT NOT NULL,  -- Facturas emitidas
    guests INT NOT NULL,  -- Comensales de las mesas facturadas
    cash_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_period_summary_cash_amount DEFAULT 0,  -- Cobrado en efectivo
    card_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_period_summary_card_amount DEFAULT 0,  -- Cobrado con tarjeta
    other_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_period_summary_other_amount DEFAULT 0,  -- Cobrado con otras formas (plataformas, vales)
    tips DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_period_summary_tips DEFAULT 0,  -- Propinas (tarjeta)
    discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_period_summary_discount_amount DEFAULT 0,  -- Importe de descuentos aplicados
    voids_count INT NOT NULL CONSTRAINT df_tpv_period_summary_voids_count DEFAULT 0,  -- Unidades eliminadas después de enviar
    voids_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_period_summary_voids_amount DEFAULT 0,  -- Importe eliminado después de enviar
    cash_difference DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_period_summary_cash_difference DEFAULT 0,  -- Descuadre del arqueo
    by_hour NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_period_summary_by_hour DEFAULT N'{}' CONSTRAINT ck_tpv_period_summary_by_hour_json CHECK (by_hour IS NULL OR ISJSON(by_hour) = 1),  -- Venta por hora de Madrid {"13": 1079.85, …}
    by_waiter NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_period_summary_by_waiter DEFAULT N'[]' CONSTRAINT ck_tpv_period_summary_by_waiter_json CHECK (by_waiter IS NULL OR ISJSON(by_waiter) = 1),  -- [{name, sales, tickets, tables}]
    by_payment NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_period_summary_by_payment DEFAULT N'[]' CONSTRAINT ck_tpv_period_summary_by_payment_json CHECK (by_payment IS NULL OR ISJSON(by_payment) = 1),  -- [{method, amount, count}]
    voids NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_period_summary_voids DEFAULT N'[]' CONSTRAINT ck_tpv_period_summary_voids_json CHECK (voids IS NULL OR ISJSON(voids) = 1),  -- [{at, name, qty, amount, reason, by, auth}]
    closed_by_user_name NVARCHAR(60) NULL,  -- Quién cerró
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_period_summary_created_at DEFAULT SYSUTCDATETIME(),  -- Escrito
    by_product NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_period_summary_by_product DEFAULT N'[]' CONSTRAINT ck_tpv_period_summary_by_product_json CHECK (by_product IS NULL OR ISJSON(by_product) = 1),  -- Vendido por producto en el periodo: [{plu, name, quantity, amount}] (sin anulaciones ni invitaciones); se rellena al cerrar
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_period_summary_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_period_summary_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_period_summary PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_period_summary_tienda')
    CREATE INDEX ix_tpv_period_summary_tienda ON dbo.tpv_period_summary (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_period_summary_period_id')
    CREATE UNIQUE INDEX uq_tpv_period_summary_period_id ON dbo.tpv_period_summary (period_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_period_summary_period_id')
    CREATE INDEX ix_tpv_period_summary_period_id ON dbo.tpv_period_summary (period_id);
GO

/* ---------- tpv_petty_cash_movement · Caja chica (aparte del cajón): ingresos de efectivo, gastos con descripción y foto del ticket; saldo después de cada uno ---------- */
IF OBJECT_ID(N'dbo.tpv_petty_cash_movement', N'U') IS NULL
CREATE TABLE dbo.tpv_petty_cash_movement (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    kind NVARCHAR(12) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason NVARCHAR(200) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    period_id UNIQUEIDENTIFIER NULL,
    station_id UNIQUEIDENTIFIER NULL,
    by_user_id UNIQUEIDENTIFIER NULL,
    by_user_name NVARCHAR(60) NOT NULL,
    by_device NVARCHAR(40) NULL,
    by_at DATETIME2(3) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_petty_cash_movement_created_at DEFAULT SYSUTCDATETIME(),
    photo NVARCHAR(MAX) NULL,  -- Foto del ticket del gasto (data:image/jpeg;base64, reducida por el TPV); vacía si no se hizo
    voided_at DATETIME2(3) NULL,  -- Apunte de caja chica eliminado (por error): ya no cuenta en el saldo ni se enseña
    voided_by_name NVARCHAR(60) NULL,  -- Quién eliminó el apunte
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_petty_cash_movement_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_petty_cash_movement_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_petty_cash_movement PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_petty_cash_movement_tienda')
    CREATE INDEX ix_tpv_petty_cash_movement_tienda ON dbo.tpv_petty_cash_movement (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_petty_cash_movement_period_id')
    CREATE INDEX ix_tpv_petty_cash_movement_period_id ON dbo.tpv_petty_cash_movement (period_id);
GO

/* ---------- tpv_incident_request · Requerimientos enviados a Marketing con las incidencias ---------- */
IF OBJECT_ID(N'dbo.tpv_incident_request', N'U') IS NULL
CREATE TABLE dbo.tpv_incident_request (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    code NVARCHAR(30) NOT NULL,  -- Número de requerimiento
    trigger_kind NVARCHAR(30) NOT NULL,  -- Al cerrar periodo o a mano
    sent_at DATETIME2(3) NOT NULL,  -- Enviado
    sent_by NVARCHAR(60) NULL,  -- Enviado por
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_incident_request_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_incident_request_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_incident_request PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_incident_request_tienda')
    CREATE INDEX ix_tpv_incident_request_tienda ON dbo.tpv_incident_request (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_incident_request_store_id_code')
    CREATE UNIQUE INDEX uq_tpv_incident_request_store_id_code ON dbo.tpv_incident_request (store_id, code);
GO

/* ---------- tpv_product_incident · Incidencias: cambios de productos hechos en el local ---------- */
IF OBJECT_ID(N'dbo.tpv_product_incident', N'U') IS NULL
CREATE TABLE dbo.tpv_product_incident (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    code NVARCHAR(20) NOT NULL,  -- INC-0001
    at DATETIME2(3) NOT NULL,  -- Fecha y hora
    user_name NVARCHAR(60) NOT NULL,  -- Usuario
    product_id UNIQUEIDENTIFIER NULL,  -- Producto
    product_name NVARCHAR(80) NULL,  -- Producto (copia)
    action NVARCHAR(20) NOT NULL,  -- Alta, cambio, baja, activar, agotado
    diff NVARCHAR(MAX) NULL,  -- Qué cambió
    status NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_product_incident_status DEFAULT N'pending',  -- Estado
    request_id UNIQUEIDENTIFIER NULL,  -- Requerimiento en el que se envió
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_incident_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_incident_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_product_incident PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_product_incident_tienda')
    CREATE INDEX ix_tpv_product_incident_tienda ON dbo.tpv_product_incident (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_product_incident_store_id_code')
    CREATE UNIQUE INDEX uq_tpv_product_incident_store_id_code ON dbo.tpv_product_incident (store_id, code);
GO

/* ---------- tpv_config_change_log · Historial de cambios de Ajustes (se envía a Japp Manager) ---------- */
IF OBJECT_ID(N'dbo.tpv_config_change_log', N'U') IS NULL
CREATE TABLE dbo.tpv_config_change_log (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    at DATETIME2(3) NOT NULL,  -- Fecha y hora
    user_id UNIQUEIDENTIFIER NULL,  -- Usuario
    user_name NVARCHAR(60) NOT NULL,  -- Usuario (copia)
    module NVARCHAR(30) NOT NULL,  -- Módulo de Ajustes
    action NVARCHAR(30) NOT NULL,  -- Acción
    record_name NVARCHAR(120) NULL,  -- Registro
    diff NVARCHAR(MAX) NULL,  -- Qué cambió
    synced_at DATETIME2(3) NULL,  -- Enviado a Japp Manager (NULL = pendiente)
    record_id NVARCHAR(40) NULL,  -- Id del registro cambiado (UUID, o PLU en productos)
    before NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_config_change_log_before_json CHECK (before IS NULL OR ISJSON(before) = 1),  -- Registro antes del cambio (sin PIN)
    after NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_config_change_log_after_json CHECK (after IS NULL OR ISJSON(after) = 1),  -- Registro después del cambio (sin PIN)
    config_version BIGINT NULL,  -- store.config_version que dejó este cambio
    device NVARCHAR(40) NULL,  -- Equipo desde el que se hizo
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_config_change_log_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_config_change_log_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_config_change_log PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_config_change_log_tienda')
    CREATE INDEX ix_tpv_config_change_log_tienda ON dbo.tpv_config_change_log (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_week_note · Observaciones de cada día en Gestiones › Resumen semana (una por tienda y día de negocio; borrar el texto borra la fila) ---------- */
IF OBJECT_ID(N'dbo.tpv_week_note', N'U') IS NULL
CREATE TABLE dbo.tpv_week_note (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    business_date DATE NOT NULL,  -- Día de negocio (el del periodo), no el día natural
    note NVARCHAR(500) NOT NULL,
    version INT NOT NULL CONSTRAINT df_tpv_week_note_version DEFAULT 1,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_week_note_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_week_note_updated_at DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(80) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_week_note_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_week_note_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_week_note PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_week_note_tienda')
    CREATE INDEX ix_tpv_week_note_tienda ON dbo.tpv_week_note (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_week_note_store_id_business_date')
    CREATE UNIQUE INDEX uq_tpv_week_note_store_id_business_date ON dbo.tpv_week_note (store_id, business_date);
GO

/* ---------- tpv_print_job · Cola de impresión: cada papel que hay que sacar. Lo imprime la API en segundo plano (guardar no espera a la impresora) ---------- */
IF OBJECT_ID(N'dbo.tpv_print_job', N'U') IS NULL
CREATE TABLE dbo.tpv_print_job (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    seq BIGINT NOT NULL,  -- Orden de llegada: cada impresora saca sus papeles en este orden
    kind NVARCHAR(20) NOT NULL,  -- kitchen (comanda, marchar, cambio de pase) · void (anulación) · prebill · invoice · cutx · cutz · count (arqueo) · oot (QR) · test · drawer · notice
    title NVARCHAR(120) NOT NULL,
    order_id UNIQUEIDENTIFIER NULL,
    account_id UNIQUEIDENTIFIER NULL,
    station_id UNIQUEIDENTIFIER NULL,
    channel NVARCHAR(40) NOT NULL,
    printer_name NVARCHAR(60) NOT NULL,
    connection NVARCHAR(120) NOT NULL,
    job NVARCHAR(MAX) NOT NULL CONSTRAINT ck_tpv_print_job_job_json CHECK (job IS NULL OR ISJSON(job) = 1),  -- El papel ya armado (líneas del ticket, cajón, logo): se imprime tal cual aunque cambie la configuración
    line_printer_ids NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_print_job_line_printer_ids DEFAULT N'[]' CONSTRAINT ck_tpv_print_job_line_printer_ids_json CHECK (line_printer_ids IS NULL OR ISJSON(line_printer_ids) = 1),  -- order_line_printer que quedan «impresas» cuando sale (comandas)
    status NVARCHAR(12) NOT NULL CONSTRAINT df_tpv_print_job_status DEFAULT N'pending',  -- pending · printing · printed · failed (5 min sin salir: Gestiones › Impresiones) · cancelled
    attempts SMALLINT NOT NULL CONSTRAINT df_tpv_print_job_attempts DEFAULT 0,
    last_error NVARCHAR(300) NULL,
    next_try_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_job_next_try_at DEFAULT SYSUTCDATETIME(),  -- Siguiente intento: 2, 5, 15 y 30 s y después cada minuto
    created_by NVARCHAR(60) NULL,
    created_device NVARCHAR(40) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_job_created_at DEFAULT SYSUTCDATETIME(),
    printed_at DATETIME2(3) NULL,
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_job_updated_at DEFAULT SYSUTCDATETIME(),
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_job_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_job_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_print_job PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_print_job_tienda')
    CREATE INDEX ix_tpv_print_job_tienda ON dbo.tpv_print_job (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_print_job_order_id')
    CREATE INDEX ix_tpv_print_job_order_id ON dbo.tpv_print_job (order_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_print_job_account_id')
    CREATE INDEX ix_tpv_print_job_account_id ON dbo.tpv_print_job (account_id);
GO

/* ---------- tpv_catalog_release · Cartas enviadas por Japp Manager (completas o solo precios) con su fecha de entrada en vigor ---------- */
IF OBJECT_ID(N'dbo.tpv_catalog_release', N'U') IS NULL
CREATE TABLE dbo.tpv_catalog_release (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Id de la publicación en el Manager
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local
    kind NVARCHAR(20) NOT NULL,  -- full = carta completa · prices = solo precios · names = solo nombres · withdraw = retirar la carta
    release_version INT NOT NULL,  -- Versión correlativa del Manager: una versión menor que la aplicada no se aplica
    effective_at DATETIME2(3) NOT NULL,  -- Cuándo entra en vigor (se aplica al abrir el primer periodo a partir de esa hora)
    status NVARCHAR(20) NOT NULL CONSTRAINT df_tpv_catalog_release_status DEFAULT N'pending',  -- pending (espera su hora) · confirm (retirar: espera a un encargado) · applied · unchanged (ya estaba igual) · failed · superseded (llegó otra más nueva) · cancelled (no se aplicó)
    payload NVARCHAR(MAX) NOT NULL CONSTRAINT ck_tpv_catalog_release_payload_json CHECK (payload IS NULL OR ISJSON(payload) = 1),  -- Carta en JSON tal como la manda el Manager
    checksum NCHAR(64) NOT NULL,  -- SHA-256 del payload: misma versión con otro contenido se rechaza
    received_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_catalog_release_received_at DEFAULT SYSUTCDATETIME(),  -- Recibida
    applied_at DATETIME2(3) NULL,  -- Aplicada
    error NVARCHAR(300) NULL,  -- Motivo del fallo al aplicar
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_catalog_release_created_at DEFAULT SYSUTCDATETIME(),  -- Cuándo se creó
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_catalog_release_updated_at DEFAULT SYSUTCDATETIME(),  -- Último cambio (lo pone el disparador)
    publication_id NVARCHAR(60) NOT NULL CONSTRAINT df_tpv_catalog_release_publication_id DEFAULT N'',  -- Id de la publicación en Carta: publicación + versión + tienda = una carga
    publication_type NVARCHAR(20) NULL,
    menu NVARCHAR(60) NULL,
    price_line NVARCHAR(60) NULL,
    store_code NVARCHAR(20) NULL,
    note NVARCHAR(300) NULL,
    result NVARCHAR(MAX) NULL CONSTRAINT ck_tpv_catalog_release_result_json CHECK (result IS NULL OR ISJSON(result) = 1),  -- Qué hizo al aplicarse (recuentos y versión de la configuración)
    decided_by NVARCHAR(60) NULL,  -- Quién la confirmó o la canceló (retirar)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_catalog_release_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_catalog_release_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_catalog_release PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_catalog_release_tienda')
    CREATE INDEX ix_tpv_catalog_release_tienda ON dbo.tpv_catalog_release (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_catalog_release_store_id_publication_id_release_version')
    CREATE UNIQUE INDEX uq_tpv_catalog_release_store_id_publication_id_release_version ON dbo.tpv_catalog_release (store_id, publication_id, release_version);
GO

/* =====================================================================================================
   3 · CONFIGURACIÓN DEL LOCAL
   ===================================================================================================== */
/* ---------- tpv_company · Empresa (razón social y NIF del emisor de las facturas) ---------- */
IF OBJECT_ID(N'dbo.tpv_company', N'U') IS NULL
CREATE TABLE dbo.tpv_company (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    legal_name NVARCHAR(120) NOT NULL,  -- Razón social
    trade_name NVARCHAR(120) NULL,  -- Nombre comercial
    tax_id NVARCHAR(20) NOT NULL,  -- NIF / CIF
    address NVARCHAR(200) NULL,  -- Dirección fiscal
    country NVARCHAR(60) NULL,  -- País
    maxpoint_cdn_id INT NULL,  -- Código de cadena en MaxPoint (cdn_id)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_company_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_company_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_company_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_company_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_company_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_company PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_company_tienda')
    CREATE INDEX ix_tpv_company_tienda ON dbo.tpv_company (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_company_cod_tienda_tax_id')
    CREATE UNIQUE INDEX uq_tpv_company_cod_tienda_tax_id ON dbo.tpv_company (cod_tienda, tax_id);
GO

/* ---------- tpv_store · Restaurante / local (Ajustes › Restaurante) ---------- */
IF OBJECT_ID(N'dbo.tpv_store', N'U') IS NULL
CREATE TABLE dbo.tpv_store (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    company_id UNIQUEIDENTIFIER NOT NULL,  -- Empresa
    code NVARCHAR(20) NOT NULL,  -- Código del local (CT 03)
    name NVARCHAR(120) NOT NULL,  -- Nombre
    service_type NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_store_service_type DEFAULT N'table',  -- Tipo de servicio: a la mesa o fast food (mostrador)
    address NVARCHAR(200) NULL,  -- Dirección
    city NVARCHAR(80) NULL,  -- Ciudad
    phone NVARCHAR(30) NULL,  -- Teléfono
    opening_hours NVARCHAR(60) NULL,  -- Horario
    reviews_url NVARCHAR(300) NULL,  -- Enlace de reseñas de Google
    logo_url NVARCHAR(300) NULL,  -- Logo del local
    ticket_header NVARCHAR(MAX) NULL,  -- Cabecera del ticket
    ticket_footer NVARCHAR(MAX) NULL,  -- Pie del ticket
    maxpoint_rst_id INT NULL,  -- Código del restaurante en MaxPoint y en el SIR (cod_restaurante; Ajustes › Restaurante › IdIntegración)
    server_url NVARCHAR(200) NULL,  -- Dominio del servidor (por defecto https://japp.grupocyt.com.es/)
    active BIT NOT NULL CONSTRAINT df_tpv_store_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_store_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    config_version BIGINT NOT NULL CONSTRAINT df_tpv_store_config_version DEFAULT 1,  -- Versión de la configuración completa (ETag de GET /config); sube con cada cambio de Ajustes
    web_order_url NVARCHAR(300) NULL,  -- URL base de Order on Table; el QR de la mesa es esta URL + /t/ + token
    sir_url NVARCHAR(300) NULL,  -- URL del servicio SOAP de la interfaz de ventas al SIR (interfaceVentasAgregadores). NULL = sin configurar
    oot_enabled BIT NOT NULL CONSTRAINT df_tpv_store_oot_enabled DEFAULT 1,  -- Order on Table encendido (por defecto) o apagado
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_store PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_store_tienda')
    CREATE INDEX ix_tpv_store_tienda ON dbo.tpv_store (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_store_code')
    CREATE UNIQUE INDEX uq_tpv_store_code ON dbo.tpv_store (code);
GO

/* ---------- tpv_store_parameters · Parámetros del local (Ajustes › Parámetros) ---------- */
IF OBJECT_ID(N'dbo.tpv_store_parameters', N'U') IS NULL
CREATE TABLE dbo.tpv_store_parameters (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local
    lock_seconds SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_lock_seconds DEFAULT 10,  -- Bloqueo por inactividad en escritorio (s, 0 = nunca)
    lock_seconds_pda SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_lock_seconds_pda DEFAULT 10,  -- Bloqueo por inactividad en PDA (s, 0 = nunca)
    duplicate_minutes SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_duplicate_minutes DEFAULT 3,  -- Aviso de doble marcado (min, 0 = no avisar)
    cash_float DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_store_parameters_cash_float DEFAULT 150,  -- Fondo de caja por defecto
    cash_diff_threshold DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_store_parameters_cash_diff_threshold DEFAULT 5,  -- Diferencia de arqueo que hay que justificar
    idle_table_minutes SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_idle_table_minutes DEFAULT 45,  -- Aviso de mesa sin movimiento (min)
    prebill_to_pay_minutes SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_prebill_to_pay_minutes DEFAULT 6,  -- Aviso de precuenta a cobro (min)
    kpi_min_tables SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_kpi_min_tables DEFAULT 20,  -- Mínimo de mesas para la nota de KPI
    pin_attempts SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_pin_attempts DEFAULT 3,  -- Intentos de clave antes de bloquear
    pin_lock_seconds SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_pin_lock_seconds DEFAULT 30,  -- Segundos de bloqueo del teclado
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_parameters_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_parameters_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_store_parameters_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    print_tip BIT NOT NULL CONSTRAINT df_tpv_store_parameters_print_tip DEFAULT 1,  -- Imprimir la propina en el ticket de la factura (no es dato fiscal)
    ticket_formats NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_store_parameters_ticket_formats DEFAULT N'{}' CONSTRAINT ck_tpv_store_parameters_ticket_formats_json CHECK (ticket_formats IS NULL OR ISJSON(ticket_formats) = 1),  -- Formatos de Ajustes › Formatos de ticket: {prebill, invoice, cutx, cutz, void}; lo que falta, sale
    ticket_logo NVARCHAR(MAX) NULL,  -- Logo del ticket ya preparado para la impresora (GS v 0 en base64); NULL = logo de la cadena
    card_terminals SMALLINT NOT NULL CONSTRAINT df_tpv_store_parameters_card_terminals DEFAULT 1,  -- Datáfonos del local: un campo por datáfono en el arqueo y el cierre
    petty_cash_limit DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_store_parameters_petty_cash_limit DEFAULT 50,  -- Sin uso desde 1.2.281: la caja chica parte de 0 y se le ingresa efectivo
    disabled_features NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_store_parameters_disabled_features DEFAULT N'[]' CONSTRAINT ck_tpv_store_parameters_disabled_features_json CHECK (disabled_features IS NULL OR ISJSON(disabled_features) = 1),  -- Ajustes › Funcionalidades: claves de las funciones desactivadas para todo el sistema; [] = todo activo
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_parameters_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_store_parameters_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_store_parameters PRIMARY KEY (store_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_store_parameters_tienda')
    CREATE INDEX ix_tpv_store_parameters_tienda ON dbo.tpv_store_parameters (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_billing_settings · Facturación del local: series, establecimiento y punto de emisión ---------- */
IF OBJECT_ID(N'dbo.tpv_billing_settings', N'U') IS NULL
CREATE TABLE dbo.tpv_billing_settings (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local
    billing_email NVARCHAR(120) NULL,  -- Email de facturación
    establishment NVARCHAR(10) NULL,  -- Establecimiento (003)
    emission_point NVARCHAR(10) NULL,  -- Punto de emisión (050)
    series_simplified NVARCHAR(20) NOT NULL,  -- Serie simplificada F2 (T2026)
    series_full NVARCHAR(20) NOT NULL,  -- Serie completa F1 (F2026)
    series_credit NVARCHAR(20) NOT NULL,  -- Serie de abonos R (AB2026)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_billing_settings_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_billing_settings_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_billing_settings_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    batch_send_seconds SMALLINT NOT NULL CONSTRAINT df_tpv_billing_settings_batch_send_seconds DEFAULT 5,  -- Segundos sin tocar tras los que el TPV y la PDA mandan al servidor la tanda de cambios de la mesa (2–30, 5 por defecto)
    simplified_limit DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_billing_settings_simplified_limit DEFAULT 3000,  -- Importe máximo (IVA incl.) de una factura simplificada; 0 = sin límite (hostelería: 3.000 €)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_billing_settings_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_billing_settings_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_billing_settings PRIMARY KEY (store_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_billing_settings_tienda')
    CREATE INDEX ix_tpv_billing_settings_tienda ON dbo.tpv_billing_settings (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_invoice_series · Numeración de cada serie (sin huecos) ---------- */
IF OBJECT_ID(N'dbo.tpv_invoice_series', N'U') IS NULL
CREATE TABLE dbo.tpv_invoice_series (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    series NVARCHAR(20) NOT NULL,  -- Serie (T2026, F2026, AB2026)
    kind NVARCHAR(30) NOT NULL,  -- Tipo VeriFactu: F1 completa, F2 simplificada, F3 sustitutiva, R1…R5 rectificativas (R5 = abono de simplificada)
    last_sequence INT NOT NULL CONSTRAINT df_tpv_invoice_series_last_sequence DEFAULT 0,  -- Último número emitido
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_series_updated_at DEFAULT SYSUTCDATETIME(),  -- Última emisión
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_series_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_invoice_series_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_invoice_series PRIMARY KEY (store_id, series)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_invoice_series_tienda')
    CREATE INDEX ix_tpv_invoice_series_tienda ON dbo.tpv_invoice_series (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_system_branding · Ajustes › Administración › Sistema: nombre, textos del acceso, logos y colores del sistema (una fila por tienda; sin fila = los originales) ---------- */
IF OBJECT_ID(N'dbo.tpv_system_branding', N'U') IS NULL
CREATE TABLE dbo.tpv_system_branding (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(60) NOT NULL CONSTRAINT df_tpv_system_branding_name DEFAULT N'Japp',  -- Nombre del sistema: acceso, menú lateral y pestaña del navegador («TPV <name>»)
    subtitle NVARCHAR(60) NULL,
    login_group NVARCHAR(80) NULL,  -- Texto del grupo en la pantalla de acceso; vacío = no se enseña
    logo NVARCHAR(MAX) NULL,  -- Logo del sistema como data URL (PNG ≤ 256 px o SVG); vacío = el original
    no_image NVARCHAR(MAX) NULL,  -- Icono «Sin imagen» (productos sin foto) como data URL; vacío = el original
    palette NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_system_branding_palette DEFAULT N'[{"hex": "#15616D", "name": "Verde", "default": true}]' CONSTRAINT ck_tpv_system_branding_palette_json CHECK (palette IS NULL OR ISJSON(palette) = 1),  -- Colores que se pueden elegir en cada equipo: [{hex:"#RRGGBB", name, default:true en uno solo}]
    colors NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_system_branding_colors DEFAULT N'{}' CONSTRAINT ck_tpv_system_branding_colors_json CHECK (colors IS NULL OR ISJSON(colors) = 1),  -- Colores del sistema: secondary, bg, card, text, muted, line, link, ok, warn, err, info (#RRGGBB); el que falta = el original
    version INT NOT NULL CONSTRAINT df_tpv_system_branding_version DEFAULT 1,
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_system_branding_updated_at DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(80) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_system_branding_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_system_branding_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_system_branding PRIMARY KEY (store_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_system_branding_tienda')
    CREATE INDEX ix_tpv_system_branding_tienda ON dbo.tpv_system_branding (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_permission · Catálogo de permisos por módulo y por botón (global, igual en todos los locales) ---------- */
IF OBJECT_ID(N'dbo.tpv_permission', N'U') IS NULL
CREATE TABLE dbo.tpv_permission (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    code NVARCHAR(40) NOT NULL,  -- Código (pedido.enviar, ajustes.productos…)
    module NVARCHAR(30) NOT NULL,  -- Módulo (Mesas, Pedido, Cobro, Funciones, Ajustes, Sistema)
    name NVARCHAR(80) NOT NULL,  -- Nombre del permiso
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_permission_sort_order DEFAULT 0,  -- Orden en pantalla
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_permission_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_permission_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_permission PRIMARY KEY (cod_tienda, code)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_permission_tienda')
    CREATE INDEX ix_tpv_permission_tienda ON dbo.tpv_permission (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_user_profile · Perfiles (Administrador, Cajero, Mesero…) ---------- */
IF OBJECT_ID(N'dbo.tpv_user_profile', N'U') IS NULL
CREATE TABLE dbo.tpv_user_profile (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    code NVARCHAR(30) NOT NULL,  -- Código (ADMIN, CAJERO, MESERO)
    name NVARCHAR(60) NOT NULL,  -- Nombre
    level SMALLINT NOT NULL CONSTRAINT df_tpv_user_profile_level DEFAULT 10,  -- Nivel (100 = administrador)
    color NVARCHAR(30) NULL,  -- Color del perfil en pantalla
    active BIT NOT NULL CONSTRAINT df_tpv_user_profile_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_user_profile_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_user_profile_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_user_profile_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    allowed_stations NVARCHAR(10) NOT NULL CONSTRAINT df_tpv_user_profile_allowed_stations DEFAULT N'any',  -- En qué equipos puede entrar el perfil: any = cualquiera · main = solo la caja principal (Cajero)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_user_profile_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_user_profile_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_user_profile PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_user_profile_tienda')
    CREATE INDEX ix_tpv_user_profile_tienda ON dbo.tpv_user_profile (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_user_profile_store_id_code')
    CREATE UNIQUE INDEX uq_tpv_user_profile_store_id_code ON dbo.tpv_user_profile (store_id, code);
GO

/* ---------- tpv_profile_permission · Permisos concedidos a cada perfil ---------- */
IF OBJECT_ID(N'dbo.tpv_profile_permission', N'U') IS NULL
CREATE TABLE dbo.tpv_profile_permission (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    profile_id UNIQUEIDENTIFIER NOT NULL,  -- Perfil
    permission_code NVARCHAR(40) NOT NULL,  -- Permiso
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_profile_permission_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_profile_permission_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_profile_permission PRIMARY KEY (profile_id, permission_code)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_profile_permission_tienda')
    CREATE INDEX ix_tpv_profile_permission_tienda ON dbo.tpv_profile_permission (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_app_user · Usuarios del TPV (entran con clave de 4 cifras) ---------- */
IF OBJECT_ID(N'dbo.tpv_app_user', N'U') IS NULL
CREATE TABLE dbo.tpv_app_user (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(60) NOT NULL,  -- Nombre
    initials NVARCHAR(4) NULL,  -- Iniciales
    profile_id UNIQUEIDENTIFIER NOT NULL,  -- Perfil
    can_charge BIT NULL,  -- Puede cobrar (NULL = lo que diga el perfil)
    can_delete_printed BIT NULL,  -- Puede eliminar productos impresos (NULL = perfil)
    can_delete_prebill BIT NULL,  -- Puede eliminar con precuenta (NULL = perfil)
    active BIT NOT NULL CONSTRAINT df_tpv_app_user_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_app_user_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_app_user_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    lock_seconds SMALLINT NULL,  -- Segundos de inactividad hasta pedir la clave; NULL = el de store_parameters; 0 = nunca
    version INT NOT NULL CONSTRAINT df_tpv_app_user_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    color NVARCHAR(7) NULL,  -- Color de la persona en el TPV (#RRGGBB): etiqueta de lo que marcó y su nombre en las mesas. NULL = automático
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_app_user_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_app_user_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_app_user PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_app_user_tienda')
    CREATE INDEX ix_tpv_app_user_tienda ON dbo.tpv_app_user (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_app_user_store_id_name')
    CREATE UNIQUE INDEX uq_tpv_app_user_store_id_name ON dbo.tpv_app_user (store_id, name);
GO

/* ---------- tpv_area · Áreas o planos (BARRA, TERRAZA…) ---------- */
IF OBJECT_ID(N'dbo.tpv_area', N'U') IS NULL
CREATE TABLE dbo.tpv_area (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(60) NOT NULL,  -- Nombre
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_area_sort_order DEFAULT 1,  -- Orden
    price_list NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_area_price_list DEFAULT N'general',  -- Precio a utilizar: PVP general o PVP terraza
    table_number_from INT NOT NULL CONSTRAINT df_tpv_area_table_number_from DEFAULT 1,  -- Las mesas se numeran desde
    plan_width SMALLINT NULL CONSTRAINT df_tpv_area_plan_width DEFAULT 1000,  -- Ancho del plano
    plan_height SMALLINT NULL CONSTRAINT df_tpv_area_plan_height DEFAULT 640,  -- Alto del plano
    plan_image_url NVARCHAR(300) NULL,  -- Foto del plano (opcional)
    active BIT NOT NULL CONSTRAINT df_tpv_area_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_area_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_area_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_area_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    ticket_channel_id UNIQUEIDENTIFIER NULL,  -- Canal de tickets (precuenta y factura) de las mesas de esta área; NULL = el de la estación
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_area_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_area_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_area PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_area_tienda')
    CREATE INDEX ix_tpv_area_tienda ON dbo.tpv_area (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_area_store_id_name')
    CREATE UNIQUE INDEX uq_tpv_area_store_id_name ON dbo.tpv_area (store_id, name);
GO

/* ---------- tpv_dining_table · Mesas ---------- */
IF OBJECT_ID(N'dbo.tpv_dining_table', N'U') IS NULL
CREATE TABLE dbo.tpv_dining_table (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    area_id UNIQUEIDENTIFIER NOT NULL,  -- Área
    number NVARCHAR(10) NOT NULL,  -- Número de mesa (1, 100…)
    capacity SMALLINT NOT NULL CONSTRAINT df_tpv_dining_table_capacity DEFAULT 4,  -- Capacidad
    pos_x DECIMAL(7,2) NULL,  -- Posición x en el plano
    pos_y DECIMAL(7,2) NULL,  -- Posición y en el plano
    width SMALLINT NULL CONSTRAINT df_tpv_dining_table_width DEFAULT 110,  -- Ancho
    height SMALLINT NULL CONSTRAINT df_tpv_dining_table_height DEFAULT 90,  -- Alto
    active BIT NOT NULL CONSTRAINT df_tpv_dining_table_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_dining_table_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_dining_table_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_dining_table_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_dining_table_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_dining_table_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_dining_table PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_dining_table_tienda')
    CREATE INDEX ix_tpv_dining_table_tienda ON dbo.tpv_dining_table (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_dining_table_store_id_number')
    CREATE UNIQUE INDEX uq_tpv_dining_table_store_id_number ON dbo.tpv_dining_table (store_id, number);
GO

/* ---------- tpv_area_drawing · Lo dibujado en Editar sala: paredes, bloques, elementos y textos ---------- */
IF OBJECT_ID(N'dbo.tpv_area_drawing', N'U') IS NULL
CREATE TABLE dbo.tpv_area_drawing (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    area_id UNIQUEIDENTIFIER NOT NULL,  -- Área
    kind NVARCHAR(30) NOT NULL,  -- Tipo
    x1 DECIMAL(7,2) NOT NULL,  -- Posición x (inicio)
    y1 DECIMAL(7,2) NOT NULL,  -- Posición y (inicio)
    x2 DECIMAL(7,2) NULL,  -- Posición x (fin, paredes y bloques)
    y2 DECIMAL(7,2) NULL,  -- Posición y (fin)
    item NVARCHAR(20) NULL,  -- Elemento: planta, impresora, baños, grifo, salida, cocina, escaleras, caja
    label NVARCHAR(80) NULL,  -- Texto
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_area_drawing_sort_order DEFAULT 0,  -- Orden de dibujo
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_area_drawing_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_area_drawing_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_area_drawing PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_area_drawing_tienda')
    CREATE INDEX ix_tpv_area_drawing_tienda ON dbo.tpv_area_drawing (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_station · Estaciones (cajas) y PDA (comanderos) ---------- */
IF OBJECT_ID(N'dbo.tpv_station', N'U') IS NULL
CREATE TABLE dbo.tpv_station (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(40) NOT NULL,  -- Nombre (CAJA1, PDA1)
    kind NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_station_kind DEFAULT N'station',  -- Estación o PDA
    device_uuid NVARCHAR(36) NULL,  -- Sin uso desde 1.2.281: los equipos se reconocen por su IP (station.ip)
    ip NVARCHAR(45) NULL,  -- IP
    emission_point NVARCHAR(10) NULL,  -- Punto de emisión
    opens_drawer BIT NOT NULL CONSTRAINT df_tpv_station_opens_drawer DEFAULT 0,  -- Abre cajón al cobrar
    active BIT NOT NULL CONSTRAINT df_tpv_station_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_station_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    is_main BIT NOT NULL CONSTRAINT df_tpv_station_is_main DEFAULT 0,  -- Caja principal de la tienda (solo una): caja, arqueo, retiros y cierre de periodo se hacen aquí
    screen_mode NVARCHAR(10) NOT NULL CONSTRAINT df_tpv_station_screen_mode DEFAULT N'auto',  -- auto = toda la pantalla; fixed = screen_width × screen_height píxeles
    screen_width SMALLINT NULL,
    screen_height SMALLINT NULL,
    ui_scale SMALLINT NOT NULL CONSTRAINT df_tpv_station_ui_scale DEFAULT 100,  -- Escala del TPV en %, de 70 a 150 (botones, letras y ventanas)
    last_seen_at DATETIME2(3) NULL,  -- Última vez que el equipo de esta estación se identificó por su UUID
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_station PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_station_tienda')
    CREATE INDEX ix_tpv_station_tienda ON dbo.tpv_station (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_station_store_id_name')
    CREATE UNIQUE INDEX uq_tpv_station_store_id_name ON dbo.tpv_station (store_id, name);
GO

/* ---------- tpv_printer · Impresoras ---------- */
IF OBJECT_ID(N'dbo.tpv_printer', N'U') IS NULL
CREATE TABLE dbo.tpv_printer (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(40) NOT NULL,  -- Nombre
    connection NVARCHAR(120) NOT NULL,  -- Conexión (tcp://10.221.11.32, USB…)
    model NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_printer_model DEFAULT N'EPSON',  -- Modelo
    kind NVARCHAR(30) NOT NULL,  -- Tipo
    active BIT NOT NULL CONSTRAINT df_tpv_printer_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_printer_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_printer_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_printer_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_printer_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_printer_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_printer PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_printer_tienda')
    CREATE INDEX ix_tpv_printer_tienda ON dbo.tpv_printer (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_printer_store_id_name')
    CREATE UNIQUE INDEX uq_tpv_printer_store_id_name ON dbo.tpv_printer (store_id, name);
GO

/* ---------- tpv_print_channel · Canales de impresión (BARRA, cocina…) ---------- */
IF OBJECT_ID(N'dbo.tpv_print_channel', N'U') IS NULL
CREATE TABLE dbo.tpv_print_channel (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(40) NOT NULL,  -- Nombre
    active BIT NOT NULL CONSTRAINT df_tpv_print_channel_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_channel_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_channel_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_print_channel_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    kind NVARCHAR(20) NOT NULL CONSTRAINT df_tpv_print_channel_kind DEFAULT N'kitchen',  -- kitchen = comanda (los productos salen por aquí) · ticket = precuenta y factura
    printer_id UNIQUEIDENTIFIER NULL,  -- Impresora por defecto del canal (una estación puede cambiarla en station_channel_printer)
    copy_of_id UNIQUEIDENTIFIER NULL,  -- Copia de otro canal de comanda: imprime lo mismo que ese canal en su propia impresora (doble zona)
    code NVARCHAR(20) NULL,  -- COMIDA o BEBIDA: los dos canales del Manager (fijos). null = canal de ticket
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_channel_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_print_channel_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_print_channel PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_print_channel_tienda')
    CREATE INDEX ix_tpv_print_channel_tienda ON dbo.tpv_print_channel (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_print_channel_store_id_name')
    CREATE UNIQUE INDEX uq_tpv_print_channel_store_id_name ON dbo.tpv_print_channel (store_id, name);
GO

/* ---------- tpv_station_channel_printer · En cada estación, por qué impresora sale cada canal ---------- */
IF OBJECT_ID(N'dbo.tpv_station_channel_printer', N'U') IS NULL
CREATE TABLE dbo.tpv_station_channel_printer (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    station_id UNIQUEIDENTIFIER NOT NULL,  -- Estación
    channel_id UNIQUEIDENTIFIER NOT NULL,  -- Canal
    printer_id UNIQUEIDENTIFIER NOT NULL,  -- Impresora
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_channel_printer_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_channel_printer_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_station_channel_printer PRIMARY KEY (station_id, channel_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_station_channel_printer_tienda')
    CREATE INDEX ix_tpv_station_channel_printer_tienda ON dbo.tpv_station_channel_printer (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_tax · Impuestos (IVA 10 %) ---------- */
IF OBJECT_ID(N'dbo.tpv_tax', N'U') IS NULL
CREATE TABLE dbo.tpv_tax (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(30) NOT NULL,  -- Nombre
    rate DECIMAL(5,2) NOT NULL,  -- Porcentaje
    active BIT NOT NULL CONSTRAINT df_tpv_tax_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_tax_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_tax_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_tax_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_tax_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_tax_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_tax PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_tax_tienda')
    CREATE INDEX ix_tpv_tax_tienda ON dbo.tpv_tax (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_tax_store_id_name_rate')
    CREATE UNIQUE INDEX uq_tpv_tax_store_id_name_rate ON dbo.tpv_tax (store_id, name, rate);
GO

/* ---------- tpv_payment_method · Formas de pago ---------- */
IF OBJECT_ID(N'dbo.tpv_payment_method', N'U') IS NULL
CREATE TABLE dbo.tpv_payment_method (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    code NVARCHAR(20) NOT NULL,  -- Código (cash, card…)
    name NVARCHAR(40) NOT NULL,  -- Nombre
    kind NVARCHAR(30) NOT NULL,  -- Tipo: cash, card, platform, voucher o discount (descuentos para el SIR; no se cobra con ella)
    opens_drawer BIT NOT NULL CONSTRAINT df_tpv_payment_method_opens_drawer DEFAULT 0,  -- Abre cajón
    allows_tip BIT NOT NULL CONSTRAINT df_tpv_payment_method_allows_tip DEFAULT 1,  -- Admite propina
    active BIT NOT NULL CONSTRAINT df_tpv_payment_method_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_method_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_method_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_payment_method_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    external_id NVARCHAR(60) NULL,  -- Id de integración: con él otro sistema (Manager, contabilidad) reconoce la forma de pago. Único por tienda
    show_in_tpv BIT NOT NULL CONSTRAINT df_tpv_payment_method_show_in_tpv DEFAULT 1,  -- Se ve en el cobro del TPV y la PDA. FALSE = solo para integraciones (p. ej. descuentos en el SIR)
    image NVARCHAR(MAX) NULL,  -- Imagen del botón en Cobrar (data:image/png;base64, 440 × 112); vacía = se ve el nombre
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_method_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_payment_method_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_payment_method PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_payment_method_tienda')
    CREATE INDEX ix_tpv_payment_method_tienda ON dbo.tpv_payment_method (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_payment_method_store_id_code')
    CREATE UNIQUE INDEX uq_tpv_payment_method_store_id_code ON dbo.tpv_payment_method (store_id, code);
GO

/* ---------- tpv_station_payment_method · Formas de pago activas en cada estación o PDA ---------- */
IF OBJECT_ID(N'dbo.tpv_station_payment_method', N'U') IS NULL
CREATE TABLE dbo.tpv_station_payment_method (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    station_id UNIQUEIDENTIFIER NOT NULL,  -- Estación
    payment_method_id UNIQUEIDENTIFIER NOT NULL,  -- Forma de pago
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_payment_method_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_payment_method_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_station_payment_method PRIMARY KEY (station_id, payment_method_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_station_payment_method_tienda')
    CREATE INDEX ix_tpv_station_payment_method_tienda ON dbo.tpv_station_payment_method (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_discount · Descuentos configurados ---------- */
IF OBJECT_ID(N'dbo.tpv_discount', N'U') IS NULL
CREATE TABLE dbo.tpv_discount (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(60) NOT NULL,  -- Nombre
    [percent] DECIMAL(5,2) NOT NULL,  -- Porcentaje
    valid_from DATE NULL,  -- Vigente desde
    valid_to DATE NULL,  -- Vigente hasta
    needs_authorization BIT NOT NULL CONSTRAINT df_tpv_discount_needs_authorization DEFAULT 0,  -- Pide autorización de encargado
    active BIT NOT NULL CONSTRAINT df_tpv_discount_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_discount_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_discount_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_discount_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    profiles NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_discount_profiles DEFAULT N'[]' CONSTRAINT ck_tpv_discount_profiles_json CHECK (profiles IS NULL OR ISJSON(profiles) = 1),  -- Códigos de perfil que pueden aplicar el descuento (["ADMIN","CAJERO"]); [] = todos
    form NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_discount_form DEFAULT N'[]' CONSTRAINT ck_tpv_discount_form_json CHECK (form IS NULL OR ISJSON(form) = 1),  -- Campos que se piden al aplicar el descuento ([{label,type,req}], máx. 10); [] = ninguno
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_discount_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_discount_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_discount PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_discount_tienda')
    CREATE INDEX ix_tpv_discount_tienda ON dbo.tpv_discount (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_station_discount · Descuentos activos en cada estación o PDA ---------- */
IF OBJECT_ID(N'dbo.tpv_station_discount', N'U') IS NULL
CREATE TABLE dbo.tpv_station_discount (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    station_id UNIQUEIDENTIFIER NOT NULL,  -- Estación
    discount_id UNIQUEIDENTIFIER NOT NULL,  -- Descuento
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_discount_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_station_discount_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_station_discount PRIMARY KEY (station_id, discount_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_station_discount_tienda')
    CREATE INDEX ix_tpv_station_discount_tienda ON dbo.tpv_station_discount (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_reason · Motivos de eliminación, retiro de caja y abono ---------- */
IF OBJECT_ID(N'dbo.tpv_reason', N'U') IS NULL
CREATE TABLE dbo.tpv_reason (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(80) NOT NULL,  -- Motivo
    kind NVARCHAR(30) NOT NULL,  -- Para qué se usa
    active BIT NOT NULL CONSTRAINT df_tpv_reason_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_reason_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_reason_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_reason_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_reason_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_reason_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_reason PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_reason_tienda')
    CREATE INDEX ix_tpv_reason_tienda ON dbo.tpv_reason (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_category · Categorías de la toma de pedido ---------- */
IF OBJECT_ID(N'dbo.tpv_category', N'U') IS NULL
CREATE TABLE dbo.tpv_category (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(60) NOT NULL,  -- Nombre
    bg_color NVARCHAR(9) NULL,  -- Color de la tecla
    fg_color NVARCHAR(9) NULL,  -- Color del texto
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_category_sort_order DEFAULT 0,  -- Orden (se arrastra en Ajustes)
    hidden BIT NOT NULL CONSTRAINT df_tpv_category_hidden DEFAULT 0,  -- Oculta (p. ej. MODIFICADORES, solo respuestas)
    maxpoint_id NVARCHAR(40) NULL,  -- Id en MaxPoint
    active BIT NOT NULL CONSTRAINT df_tpv_category_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_category_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_category_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_category_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    external_id NVARCHAR(60) NULL,  -- Id en el App Manager (casa los servicios de sync); único por tienda
    order_on_table BIT NOT NULL CONSTRAINT df_tpv_category_order_on_table DEFAULT 1,  -- Sale en la carta de Order on Table
    qualifiers NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_category_qualifiers DEFAULT N'[]' CONSTRAINT ck_tpv_category_qualifiers_json CHECK (qualifiers IS NULL OR ISJSON(qualifiers) = 1),  -- PLU de los calificativos que salen al comentar un producto de esta categoría; [] = todos
    description NVARCHAR(300) NULL,  -- Descripción (Carta)
    translations NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_category_translations DEFAULT N'{}' CONSTRAINT ck_tpv_category_translations_json CHECK (translations IS NULL OR ISJSON(translations) = 1),  -- Textos por idioma: {"en":{"name":"…"}} (Order on Table)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_category_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_category_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_category PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_category_tienda')
    CREATE INDEX ix_tpv_category_tienda ON dbo.tpv_category (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_category_store_id_name')
    CREATE UNIQUE INDEX uq_tpv_category_store_id_name ON dbo.tpv_category (store_id, name);
GO

/* ---------- tpv_product · Productos (PLU) con PVP general y PVP terraza ---------- */
IF OBJECT_ID(N'dbo.tpv_product', N'U') IS NULL
CREATE TABLE dbo.tpv_product (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    plu INT NOT NULL,  -- PLU de MaxPoint
    name NVARCHAR(80) NOT NULL,  -- Nombre en la tecla
    ticket_name NVARCHAR(80) NULL,  -- Nombre en el ticket
    category_id UNIQUEIDENTIFIER NULL,  -- Categoría principal
    price DECIMAL(10,2) NOT NULL,  -- PVP general (IVA incluido)
    price_terrace DECIMAL(10,2) NULL,  -- PVP terraza (NULL = se usa el general)
    tax_id UNIQUEIDENTIFIER NOT NULL,  -- Impuesto
    bg_color NVARCHAR(9) NULL,  -- Color de la tecla
    fg_color NVARCHAR(9) NULL,  -- Color del texto
    answer_only BIT NOT NULL CONSTRAINT df_tpv_product_answer_only DEFAULT 0,  -- Solo se usa como respuesta de una pregunta
    sold_out BIT NOT NULL CONSTRAINT df_tpv_product_sold_out DEFAULT 0,  -- Agotado
    active BIT NOT NULL CONSTRAINT df_tpv_product_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    version INT NOT NULL CONSTRAINT df_tpv_product_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    external_id NVARCHAR(60) NULL,  -- Id en el App Manager (casa los servicios de sync); único por tienda
    description NVARCHAR(300) NULL,  -- Descripción: se imprime debajo del producto en MAYÚSCULAS (una línea por salto)
    order_on_table BIT NOT NULL CONSTRAINT df_tpv_product_order_on_table DEFAULT 1,  -- Se puede pedir desde Order on Table (además de su categoría)
    button_label NVARCHAR(80) NULL,  -- Texto del botón; null = el nombre del PLU. Una tecla sin texto propio usa este
    translations NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_product_translations DEFAULT N'{}' CONSTRAINT ck_tpv_product_translations_json CHECK (translations IS NULL OR ISJSON(translations) = 1),  -- Textos por idioma: name, ticketName, buttonLabel, description
    qualifier BIT NOT NULL CONSTRAINT df_tpv_product_qualifier DEFAULT 0,  -- Calificativo: texto rápido del comentario (SIN SAL, POCO HECHO…)
    local_off BIT NOT NULL CONSTRAINT df_tpv_product_local_off DEFAULT 0,  -- Desactivado en la tienda (no desde el Manager): se reactiva solo al abrir el periodo siguiente
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_product PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_product_tienda')
    CREATE INDEX ix_tpv_product_tienda ON dbo.tpv_product (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_product_store_id_plu')
    CREATE UNIQUE INDEX uq_tpv_product_store_id_plu ON dbo.tpv_product (store_id, plu);
GO

/* ---------- tpv_category_product · Teclas: qué producto sale en cada categoría y dónde ---------- */
IF OBJECT_ID(N'dbo.tpv_category_product', N'U') IS NULL
CREATE TABLE dbo.tpv_category_product (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    category_id UNIQUEIDENTIFIER NOT NULL,  -- Categoría
    product_id UNIQUEIDENTIFIER NOT NULL,  -- Producto
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    label NVARCHAR(80) NULL,  -- Texto de la tecla
    bg_color NVARCHAR(9) NULL,  -- Color de la tecla
    fg_color NVARCHAR(9) NULL,  -- Color del texto
    pos_x SMALLINT NULL,  -- Columna
    pos_y SMALLINT NULL,  -- Fila
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_category_product_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_category_product_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_category_product PRIMARY KEY (category_id, product_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_category_product_tienda')
    CREATE INDEX ix_tpv_category_product_tienda ON dbo.tpv_category_product (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_product_channel · Por qué canal sale cada producto ---------- */
IF OBJECT_ID(N'dbo.tpv_product_channel', N'U') IS NULL
CREATE TABLE dbo.tpv_product_channel (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    product_id UNIQUEIDENTIFIER NOT NULL,  -- Producto
    channel_id UNIQUEIDENTIFIER NOT NULL,  -- Canal
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_channel_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_channel_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_product_channel PRIMARY KEY (product_id, channel_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_product_channel_tienda')
    CREATE INDEX ix_tpv_product_channel_tienda ON dbo.tpv_product_channel (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_question · Preguntas (opciones del producto: leche, punto, menú…) ---------- */
IF OBJECT_ID(N'dbo.tpv_question', N'U') IS NULL
CREATE TABLE dbo.tpv_question (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    name NVARCHAR(100) NOT NULL,  -- Pregunta
    min_answers SMALLINT NOT NULL CONSTRAINT df_tpv_question_min_answers DEFAULT 0,  -- Mínimo de respuestas (0 = opcional)
    max_answers SMALLINT NOT NULL CONSTRAINT df_tpv_question_max_answers DEFAULT 1,  -- Máximo de respuestas
    maxpoint_id NVARCHAR(40) NULL,  -- Id en MaxPoint
    active BIT NOT NULL CONSTRAINT df_tpv_question_active DEFAULT 1,  -- Activo (no se borra nada: se inactiva)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_question_created_at DEFAULT SYSUTCDATETIME(),  -- Alta del registro
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_question_updated_at DEFAULT SYSUTCDATETIME(),  -- Última modificación
    course SMALLINT NULL,  -- Pase del menú: NULL pregunta normal; 0 bebida; 1 primero; 2 segundo; 3 postre
    version INT NOT NULL CONSTRAINT df_tpv_question_version DEFAULT 1,  -- Versión del registro (control de concurrencia en Ajustes); sube en cada cambio
    external_id NVARCHAR(60) NULL,  -- Id en el App Manager (casa los servicios de sync); único por tienda
    plu INT NULL,  -- PLU de la pregunta (Carta), si tiene
    description NVARCHAR(300) NULL,
    required BIT NOT NULL CONSTRAINT df_tpv_question_required DEFAULT 0,  -- Obligatoria: no se puede saltar
    answer_type NVARCHAR(10) NOT NULL CONSTRAINT df_tpv_question_answer_type DEFAULT N'unica',  -- unica (una respuesta) o multiple (varias)
    course_name NVARCHAR(40) NULL,  -- Nombre del pase: Bebida, Primero, Segundo, Postre
    translations NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_question_translations DEFAULT N'{}' CONSTRAINT ck_tpv_question_translations_json CHECK (translations IS NULL OR ISJSON(translations) = 1),  -- Textos por idioma: name, description
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_question_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_question_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_question PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_question_tienda')
    CREATE INDEX ix_tpv_question_tienda ON dbo.tpv_question (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_question_answer · Respuestas de una pregunta (cada respuesta es un producto) ---------- */
IF OBJECT_ID(N'dbo.tpv_question_answer', N'U') IS NULL
CREATE TABLE dbo.tpv_question_answer (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Identificador (UUID)
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    question_id UNIQUEIDENTIFIER NOT NULL,  -- Pregunta
    product_id UNIQUEIDENTIFIER NOT NULL,  -- Producto respuesta
    label NVARCHAR(80) NULL,  -- Texto de la respuesta
    extra_price DECIMAL(10,2) NOT NULL CONSTRAINT df_tpv_question_answer_extra_price DEFAULT 0,  -- Suplemento (0 = sin suplemento)
    bg_color NVARCHAR(9) NULL,  -- Color
    fg_color NVARCHAR(9) NULL,  -- Color del texto
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_question_answer_sort_order DEFAULT 0,  -- Orden
    translations NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_question_answer_translations DEFAULT N'{}' CONSTRAINT ck_tpv_question_answer_translations_json CHECK (translations IS NULL OR ISJSON(translations) = 1),  -- Texto de la respuesta por idioma: {"en":{"label":"…"}}
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_question_answer_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_question_answer_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_question_answer PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_question_answer_tienda')
    CREATE INDEX ix_tpv_question_answer_tienda ON dbo.tpv_question_answer (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_question_answer_question_id_product_id')
    CREATE UNIQUE INDEX uq_tpv_question_answer_question_id_product_id ON dbo.tpv_question_answer (question_id, product_id);
GO

/* ---------- tpv_product_question · Preguntas que hace cada producto ---------- */
IF OBJECT_ID(N'dbo.tpv_product_question', N'U') IS NULL
CREATE TABLE dbo.tpv_product_question (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    product_id UNIQUEIDENTIFIER NOT NULL,  -- Producto
    question_id UNIQUEIDENTIFIER NOT NULL,  -- Pregunta
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_product_question_sort_order DEFAULT 0,  -- Orden
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_question_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_product_question_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_product_question PRIMARY KEY (product_id, question_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_product_question_tienda')
    CREATE INDEX ix_tpv_product_question_tienda ON dbo.tpv_product_question (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_service_shift · Turnos de servicio para los SLA de atención (p. ej. Comida 12:00–16:30, Cena 19:30–00:30). La mesa cuenta en el turno en que se abrió ---------- */
IF OBJECT_ID(N'dbo.tpv_service_shift', N'U') IS NULL
CREATE TABLE dbo.tpv_service_shift (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(40) NOT NULL,
    starts_at TIME(0) NOT NULL,
    ends_at TIME(0) NOT NULL,  -- Si es menor que starts_at, el turno pasa de medianoche
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_service_shift_sort_order DEFAULT 1,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_shift_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_shift_updated_at DEFAULT SYSUTCDATETIME(),
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_shift_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_shift_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_service_shift PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_service_shift_tienda')
    CREATE INDEX ix_tpv_service_shift_tienda ON dbo.tpv_service_shift (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_service_shift_store_id_name')
    CREATE UNIQUE INDEX uq_tpv_service_shift_store_id_name ON dbo.tpv_service_shift (store_id, name);
GO

/* ---------- tpv_service_sla · SLA de atención: minutos máximos de cada paso de la mesa por tienda, zona o mesa y turno. Vacío = hereda de la regla menos concreta ---------- */
IF OBJECT_ID(N'dbo.tpv_service_sla', N'U') IS NULL
CREATE TABLE dbo.tpv_service_sla (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    area_id UNIQUEIDENTIFIER NULL,
    table_id UNIQUEIDENTIFIER NULL,
    shift_id UNIQUEIDENTIFIER NULL,
    first_order_minutes SMALLINT NULL,  -- De abrir la mesa a marcar lo primero
    unsent_minutes SMALLINT NULL,  -- Algo marcado sin enviar a cocina durante más de esto
    idle_minutes SMALLINT NULL,  -- Desde el último envío a cocina sin volver a la mesa (antes de la precuenta)
    prebill_pay_minutes SMALLINT NULL,  -- De la precuenta al cobro
    total_minutes SMALLINT NULL,  -- La mesa abierta en total
    warn_percent SMALLINT NULL,  -- A partir de este % del límite la mesa se pinta en ámbar (50–99)
    version INT NOT NULL CONSTRAINT df_tpv_service_sla_version DEFAULT 1,  -- Solo en la regla de la tienda: sube con cada cambio de la configuración de SLA (control de concurrencia)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_sla_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_sla_updated_at DEFAULT SYSUTCDATETIME(),
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_sla_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_service_sla_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_service_sla PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_service_sla_tienda')
    CREATE INDEX ix_tpv_service_sla_tienda ON dbo.tpv_service_sla (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_sales_target · Objetivo de venta: % sobre el año anterior (o importe fijo) para la proyección del Gestor de cierres ---------- */
IF OBJECT_ID(N'dbo.tpv_sales_target', N'U') IS NULL
CREATE TABLE dbo.tpv_sales_target (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- Id
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local
    year SMALLINT NOT NULL,  -- Año ISO
    week SMALLINT NOT NULL CONSTRAINT df_tpv_sales_target_week DEFAULT 0,  -- 0 = todo el año; 1–53 = semana ISO concreta (manda sobre el anual)
    growth_pct DECIMAL(5,2) NOT NULL CONSTRAINT df_tpv_sales_target_growth_pct DEFAULT 0,  -- Crecimiento sobre la misma semana del año anterior (%)
    amount DECIMAL(10,2) NULL,  -- Importe fijo de la semana (si está, manda sobre el %)
    note NVARCHAR(200) NULL,  -- Nota (campaña, obra, festivo…)
    version INT NOT NULL CONSTRAINT df_tpv_sales_target_version DEFAULT 1,  -- Versión del registro
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sales_target_created_at DEFAULT SYSUTCDATETIME(),  -- Cuándo se creó
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sales_target_updated_at DEFAULT SYSUTCDATETIME(),  -- Último cambio (lo pone el disparador)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sales_target_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sales_target_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_sales_target PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_sales_target_tienda')
    CREATE INDEX ix_tpv_sales_target_tienda ON dbo.tpv_sales_target (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_sales_target_store_id_year_week')
    CREATE UNIQUE INDEX uq_tpv_sales_target_store_id_year_week ON dbo.tpv_sales_target (store_id, year, week);
GO

/* ---------- tpv_delivery_settings · Ajustes › Pedidos › Delivery (una fila por tienda; sin fila = los valores por defecto) ---------- */
IF OBJECT_ID(N'dbo.tpv_delivery_settings', N'U') IS NULL
CREATE TABLE dbo.tpv_delivery_settings (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,
    active BIT NOT NULL CONSTRAINT df_tpv_delivery_settings_active DEFAULT 1,  -- Delivery en este local: apagado, el botón Pedidos no sale (ni en mesas ni en fast food) y la API no acepta pedidos nuevos
    integration BIT NOT NULL CONSTRAINT df_tpv_delivery_settings_integration DEFAULT 1,  -- Recibir pedidos de las plataformas a través del integrador
    provider NVARCHAR(40) NULL CONSTRAINT df_tpv_delivery_settings_provider DEFAULT N'Deliverect',
    platforms NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_delivery_settings_platforms DEFAULT N'[{"id": "glovo", "name": "Glovo", "active": true}, {"id": "uber", "name": "Uber Eats", "active": true}, {"id": "just", "name": "Just Eat", "active": true}, {"id": "own", "name": "Web propia", "active": true}]' CONSTRAINT ck_tpv_delivery_settings_platforms_json CHECK (platforms IS NULL OR ISJSON(platforms) = 1),  -- [{id: glovo|uber|just|own|…, name, active}]
    auto_accept BIT NOT NULL CONSTRAINT df_tpv_delivery_settings_auto_accept DEFAULT 0,  -- Los pedidos nuevos pasan solos de pending a received
    ask_rider BIT NOT NULL CONSTRAINT df_tpv_delivery_settings_ask_rider DEFAULT 1,  -- Al pasar a assigned hay que elegir quién lo lleva (motorizado o «Repartidor de la plataforma»)
    sound BIT NOT NULL CONSTRAINT df_tpv_delivery_settings_sound DEFAULT 1,
    prep_minutes SMALLINT NOT NULL CONSTRAINT df_tpv_delivery_settings_prep_minutes DEFAULT 15,  -- Tiempo de preparación que se avisa a la plataforma al aceptar
    amber_minutes SMALLINT NOT NULL CONSTRAINT df_tpv_delivery_settings_amber_minutes DEFAULT 15,  -- Semáforo en ámbar desde estos minutos desde que llegó el pedido
    red_minutes SMALLINT NOT NULL CONSTRAINT df_tpv_delivery_settings_red_minutes DEFAULT 30,  -- Semáforo en rojo (y aviso en el botón Pedidos) desde estos minutos; mayor que amber_minutes
    version INT NOT NULL CONSTRAINT df_tpv_delivery_settings_version DEFAULT 1,
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_settings_updated_at DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(80) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_settings_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_settings_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_delivery_settings PRIMARY KEY (store_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_settings_tienda')
    CREATE INDEX ix_tpv_delivery_settings_tienda ON dbo.tpv_delivery_settings (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_delivery_rider · Motorizados de la tienda (Ajustes › Pedidos › Motorizados). Quitar uno lo desactiva: los pedidos antiguos lo siguen nombrando ---------- */
IF OBJECT_ID(N'dbo.tpv_delivery_rider', N'U') IS NULL
CREATE TABLE dbo.tpv_delivery_rider (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(40) NOT NULL,
    phone NVARCHAR(20) NULL,
    active BIT NOT NULL CONSTRAINT df_tpv_delivery_rider_active DEFAULT 1,
    sort_order SMALLINT NOT NULL CONSTRAINT df_tpv_delivery_rider_sort_order DEFAULT 0,
    version INT NOT NULL CONSTRAINT df_tpv_delivery_rider_version DEFAULT 1,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_rider_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_rider_updated_at DEFAULT SYSUTCDATETIME(),
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_rider_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_delivery_rider_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_delivery_rider PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_delivery_rider_tienda')
    CREATE INDEX ix_tpv_delivery_rider_tienda ON dbo.tpv_delivery_rider (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_customer_display · Segunda pantalla del cliente: configuración por tienda (Ajustes › Restaurante › Banners) ---------- */
IF OBJECT_ID(N'dbo.tpv_customer_display', N'U') IS NULL
CREATE TABLE dbo.tpv_customer_display (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,
    config NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_customer_display_config DEFAULT N'{}' CONSTRAINT ck_tpv_customer_display_config_json CHECK (config IS NULL OR ISJSON(config) = 1),  -- mode (off|billing|billing_banner|banner; los banners solo en fast food), greeting, name, color, farewell, reviewUrl, sideTitle, tickets{email,print,invoice,none}, loop, muted, imageSeconds
    version INT NOT NULL CONSTRAINT df_tpv_customer_display_version DEFAULT 1,
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_customer_display_updated_at DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(80) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_customer_display_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_customer_display_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_customer_display PRIMARY KEY (store_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_customer_display_tienda')
    CREATE INDEX ix_tpv_customer_display_tienda ON dbo.tpv_customer_display (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_display_media · Vídeos e imágenes de la segunda pantalla; el archivo está en MEDIA_DIR/<id> del servidor de la tienda ---------- */
IF OBJECT_ID(N'dbo.tpv_display_media', N'U') IS NULL
CREATE TABLE dbo.tpv_display_media (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,
    store_id UNIQUEIDENTIFIER NOT NULL,
    kind NVARCHAR(10) NOT NULL,
    name NVARCHAR(200) NOT NULL,
    mime NVARCHAR(60) NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_s INT NULL,
    sha256 NCHAR(64) NOT NULL,
    days NVARCHAR(MAX) NOT NULL CONSTRAINT df_tpv_display_media_days DEFAULT N'[]' CONSTRAINT ck_tpv_display_media_days_json CHECK (days IS NULL OR ISJSON(days) = 1),  -- Días en que sale: 1 = lunes … 7 = domingo; vacío = todos
    time_from TIME(0) NULL,  -- Desde (hora de Madrid); con time_to menor, cruza la medianoche; vacío = todo el día
    time_to TIME(0) NULL,
    active BIT NOT NULL CONSTRAINT df_tpv_display_media_active DEFAULT 1,
    sort_order INT NOT NULL CONSTRAINT df_tpv_display_media_sort_order DEFAULT 0,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_display_media_created_at DEFAULT SYSUTCDATETIME(),
    created_by NVARCHAR(80) NULL,
    deleted_at DATETIME2(3) NULL,
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_display_media_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_display_media_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_display_media PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_display_media_tienda')
    CREATE INDEX ix_tpv_display_media_tienda ON dbo.tpv_display_media (cod_restaurante_integracion, cod_tienda);
GO

/* =====================================================================================================
   4 · TÉCNICAS DE LA TIENDA
   ===================================================================================================== */
/* ---------- tpv_app_session · Sesiones de la API de tienda: una vigente por usuario (ended_at NULL). Un token solo vale si su jti es la vigente; si no, 401 SESSION_REPLACED ---------- */
IF OBJECT_ID(N'dbo.tpv_app_session', N'U') IS NULL
CREATE TABLE dbo.tpv_app_session (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL,  -- jti del token de sesión
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    user_id UNIQUEIDENTIFIER NOT NULL,  -- Usuario que entró con su clave
    station_id UNIQUEIDENTIFIER NULL,  -- Equipo en el que entró
    station_name NVARCHAR(40) NOT NULL,  -- Nombre del equipo, para el aviso «Tu clave se ha abierto en …»
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_app_session_created_at DEFAULT SYSUTCDATETIME(),  -- Cuándo entró
    expires_at DATETIME2(3) NOT NULL,  -- Caducidad del token (SESSION_HOURS)
    ended_at DATETIME2(3) NULL,  -- Cuándo dejó de valer (NULL = vigente)
    ended_reason NVARCHAR(20) NULL,  -- replaced = entró de nuevo (en este u otro equipo) · logout = salió
    replaced_by_id UNIQUEIDENTIFIER NULL,  -- Sesión que la sustituyó
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_app_session_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_app_session_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_app_session PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_app_session_tienda')
    CREATE INDEX ix_tpv_app_session_tienda ON dbo.tpv_app_session (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_pin_attempt · Fallos de PIN seguidos por equipo; tras store_parameters.pin_attempts queda bloqueado hasta locked_until ---------- */
IF OBJECT_ID(N'dbo.tpv_pin_attempt', N'U') IS NULL
CREATE TABLE dbo.tpv_pin_attempt (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    [key] NVARCHAR(80) NOT NULL,  -- device:<UUID del equipo> si la estación lo tiene; si no, station:<id>. user:<id> para la clave de encargado
    failures SMALLINT NOT NULL CONSTRAINT df_tpv_pin_attempt_failures DEFAULT 0,  -- Fallos seguidos desde el último acierto o desbloqueo
    locked_until DATETIME2(3) NULL,  -- Teclado bloqueado hasta este momento (423 PIN_LOCKED)
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_pin_attempt_updated_at DEFAULT SYSUTCDATETIME(),  -- Último intento
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_pin_attempt_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_pin_attempt_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_pin_attempt PRIMARY KEY (store_id, [key])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_pin_attempt_tienda')
    CREATE INDEX ix_tpv_pin_attempt_tienda ON dbo.tpv_pin_attempt (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_idempotency_key · Respuestas guardadas por Idempotency-Key: la misma clave devuelve la misma respuesta sin repetir la acción ---------- */
IF OBJECT_ID(N'dbo.tpv_idempotency_key', N'U') IS NULL
CREATE TABLE dbo.tpv_idempotency_key (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    [key] NVARCHAR(80) NOT NULL,  -- Idempotency-Key que manda el equipo
    method NVARCHAR(8) NOT NULL,  -- Método HTTP de la petición original
    path NVARCHAR(200) NOT NULL,  -- Ruta de la petición original
    request_hash NCHAR(64) NOT NULL,  -- SHA-256 del método + ruta + cuerpo: la misma clave con otro cuerpo es un error
    status_code SMALLINT NOT NULL,  -- Código HTTP guardado; 0 = la petición original sigue en curso
    response NVARCHAR(MAX) NOT NULL CONSTRAINT ck_tpv_idempotency_key_response_json CHECK (response IS NULL OR ISJSON(response) = 1),  -- Cuerpo de la respuesta guardada
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_idempotency_key_created_at DEFAULT SYSUTCDATETIME(),  -- Cuándo llegó la petición original (las claves caducan a las 24 h)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_idempotency_key_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_idempotency_key_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_idempotency_key PRIMARY KEY (store_id, [key])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_idempotency_key_tienda')
    CREATE INDEX ix_tpv_idempotency_key_tienda ON dbo.tpv_idempotency_key (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_oot_token · Token del QR de Order on Table de una orden abierta (caduca al cerrar la mesa) ---------- */
IF OBJECT_ID(N'dbo.tpv_oot_token', N'U') IS NULL
CREATE TABLE dbo.tpv_oot_token (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_tpv_oot_token_id DEFAULT NEWID(),  -- Identificador
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    order_id UNIQUEIDENTIFIER NOT NULL,  -- Orden (mesa) a la que pide el cliente
    created_by_user_id UNIQUEIDENTIFIER NULL,  -- Quién lo generó
    created_by_user_name NVARCHAR(60) NULL,  -- Nombre de quién lo generó
    created_by_device NVARCHAR(40) NULL,  -- Equipo desde el que se generó
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_oot_token_created_at DEFAULT SYSUTCDATETIME(),  -- Cuándo se generó
    revoked_at DATETIME2(3) NULL,  -- Cuándo dejó de valer (NULL = vigente)
    revoked_reason NVARCHAR(30) NULL,  -- manual (anulado), closed (mesa cerrada) o transferred (mesa cambiada)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_oot_token_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_oot_token_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_oot_token PRIMARY KEY (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_oot_token_tienda')
    CREATE INDEX ix_tpv_oot_token_tienda ON dbo.tpv_oot_token (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_oot_token_order_id')
    CREATE INDEX ix_tpv_oot_token_order_id ON dbo.tpv_oot_token (order_id);
GO

/* ---------- tpv_sync_outbox · Cola de envío del local a la central (Japp Manager) ---------- */
IF OBJECT_ID(N'dbo.tpv_sync_outbox', N'U') IS NULL
CREATE TABLE dbo.tpv_sync_outbox (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    id BIGINT NOT NULL,  -- Secuencia
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local al que pertenece
    entity NVARCHAR(40) NOT NULL,  -- Tabla o entidad (orders, invoice, config…)
    entity_id UNIQUEIDENTIFIER NOT NULL,  -- Id del registro
    operation NVARCHAR(30) NOT NULL CONSTRAINT df_tpv_sync_outbox_operation DEFAULT N'upsert',  -- Operación
    payload NVARCHAR(MAX) NOT NULL CONSTRAINT ck_tpv_sync_outbox_payload_json CHECK (payload IS NULL OR ISJSON(payload) = 1),  -- Datos a enviar
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sync_outbox_created_at DEFAULT SYSUTCDATETIME(),  -- Encolado
    sent_at DATETIME2(3) NULL,  -- Enviado (NULL = pendiente)
    attempts SMALLINT NOT NULL CONSTRAINT df_tpv_sync_outbox_attempts DEFAULT 0,  -- Intentos
    last_error NVARCHAR(300) NULL,  -- Último error
    event_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_tpv_sync_outbox_event_id DEFAULT NEWID(),  -- Id del mensaje para el Manager: el Manager guarda por (store_id, event_id) y así reenviar no duplica
    parked_at DATETIME2(3) NULL,  -- Apartado tras demasiados rechazos (no se reintenta solo; sale en Developer › Sincronización)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sync_outbox_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sync_outbox_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_sync_outbox PRIMARY KEY (store_id, id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_sync_outbox_tienda')
    CREATE INDEX ix_tpv_sync_outbox_tienda ON dbo.tpv_sync_outbox (cod_restaurante_integracion, cod_tienda);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_tpv_sync_outbox_event_id')
    CREATE UNIQUE INDEX uq_tpv_sync_outbox_event_id ON dbo.tpv_sync_outbox (event_id);
GO

/* ---------- tpv_sync_state · Estado del agente de sincronización con Japp Manager (uno por tienda) ---------- */
IF OBJECT_ID(N'dbo.tpv_sync_state', N'U') IS NULL
CREATE TABLE dbo.tpv_sync_state (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    store_id UNIQUEIDENTIFIER NOT NULL,  -- Local
    last_sent_at DATETIME2(3) NULL,  -- Último lote de la cola aceptado por el Manager
    last_sent_id BIGINT NULL,  -- Último sync_outbox.id confirmado
    last_live_at DATETIME2(3) NULL,  -- Último pulso de venta en vivo (cada minuto) recibido por el Manager
    last_heartbeat_at DATETIME2(3) NULL,  -- Último latido contestado
    last_error NVARCHAR(300) NULL,  -- Último error de envío
    last_error_at DATETIME2(3) NULL,  -- Cuándo fue el último error
    config_cursor NVARCHAR(60) NULL,  -- Último cursor de cambios de configuración del Manager ya aplicado
    manager_time_offset_ms INT NULL,  -- Diferencia de reloj con el Manager (serverTime del latido − hora local)
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sync_state_created_at DEFAULT SYSUTCDATETIME(),  -- Cuándo se creó
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sync_state_updated_at DEFAULT SYSUTCDATETIME(),  -- Último cambio (lo pone el disparador)
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sync_state_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_sync_state_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_sync_state PRIMARY KEY (store_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_sync_state_tienda')
    CREATE INDEX ix_tpv_sync_state_tienda ON dbo.tpv_sync_state (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- tpv_schema_migrations · Versiones de la base aplicadas ---------- */
IF OBJECT_ID(N'dbo.tpv_schema_migrations', N'U') IS NULL
CREATE TABLE dbo.tpv_schema_migrations (
    cod_restaurante_integracion INT NOT NULL,                      -- store.maxpoint_rst_id
    cod_tienda NVARCHAR(20) NOT NULL,                              -- store.code
    version NCHAR(4) NOT NULL,
    name NVARCHAR(200) NOT NULL,
    checksum NCHAR(64) NOT NULL,
    applied_at DATETIME2(3) NOT NULL CONSTRAINT df_tpv_schema_migrations_applied_at DEFAULT SYSUTCDATETIME(),
    recibido_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_schema_migrations_recibido_en DEFAULT SYSUTCDATETIME(),
    actualizado_en DATETIME2(3) NOT NULL CONSTRAINT df_tpv_schema_migrations_actualizado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_tpv_schema_migrations PRIMARY KEY (cod_tienda, version)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_tpv_schema_migrations_tienda')
    CREATE INDEX ix_tpv_schema_migrations_tienda ON dbo.tpv_schema_migrations (cod_restaurante_integracion, cod_tienda);
GO

/* ---------- Claves ajenas dentro de la transacción ---------- */
IF OBJECT_ID(N'dbo.fk_tpv_account_order_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_account ADD CONSTRAINT fk_tpv_account_order_id FOREIGN KEY (order_id) REFERENCES dbo.tpv_orders (id);
IF OBJECT_ID(N'dbo.fk_tpv_order_line_order_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_order_line ADD CONSTRAINT fk_tpv_order_line_order_id FOREIGN KEY (order_id) REFERENCES dbo.tpv_orders (id);
IF OBJECT_ID(N'dbo.fk_tpv_order_line_account_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_order_line ADD CONSTRAINT fk_tpv_order_line_account_id FOREIGN KEY (account_id) REFERENCES dbo.tpv_account (id);
IF OBJECT_ID(N'dbo.fk_tpv_order_line_modifier_line_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_order_line_modifier ADD CONSTRAINT fk_tpv_order_line_modifier_line_id FOREIGN KEY (line_id) REFERENCES dbo.tpv_order_line (id);
IF OBJECT_ID(N'dbo.fk_tpv_order_line_printer_line_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_order_line_printer ADD CONSTRAINT fk_tpv_order_line_printer_line_id FOREIGN KEY (line_id) REFERENCES dbo.tpv_order_line (id);
IF OBJECT_ID(N'dbo.fk_tpv_order_event_order_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_order_event ADD CONSTRAINT fk_tpv_order_event_order_id FOREIGN KEY (order_id) REFERENCES dbo.tpv_orders (id);
IF OBJECT_ID(N'dbo.fk_tpv_order_event_account_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_order_event ADD CONSTRAINT fk_tpv_order_event_account_id FOREIGN KEY (account_id) REFERENCES dbo.tpv_account (id);
IF OBJECT_ID(N'dbo.fk_tpv_account_discount_account_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_account_discount ADD CONSTRAINT fk_tpv_account_discount_account_id FOREIGN KEY (account_id) REFERENCES dbo.tpv_account (id);
IF OBJECT_ID(N'dbo.fk_tpv_payment_account_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_payment ADD CONSTRAINT fk_tpv_payment_account_id FOREIGN KEY (account_id) REFERENCES dbo.tpv_account (id);
IF OBJECT_ID(N'dbo.fk_tpv_payment_cash_detail_payment_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_payment_cash_detail ADD CONSTRAINT fk_tpv_payment_cash_detail_payment_id FOREIGN KEY (payment_id) REFERENCES dbo.tpv_payment (id);
IF OBJECT_ID(N'dbo.fk_tpv_payment_bank_data_payment_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_payment_bank_data ADD CONSTRAINT fk_tpv_payment_bank_data_payment_id FOREIGN KEY (payment_id) REFERENCES dbo.tpv_payment (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_account_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice ADD CONSTRAINT fk_tpv_invoice_account_id FOREIGN KEY (account_id) REFERENCES dbo.tpv_account (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_order_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice ADD CONSTRAINT fk_tpv_invoice_order_id FOREIGN KEY (order_id) REFERENCES dbo.tpv_orders (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_rectified_invoice_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice ADD CONSTRAINT fk_tpv_invoice_rectified_invoice_id FOREIGN KEY (rectified_invoice_id) REFERENCES dbo.tpv_invoice (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_substituted_invoice_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice ADD CONSTRAINT fk_tpv_invoice_substituted_invoice_id FOREIGN KEY (substituted_invoice_id) REFERENCES dbo.tpv_invoice (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_tax_invoice_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice_tax ADD CONSTRAINT fk_tpv_invoice_tax_invoice_id FOREIGN KEY (invoice_id) REFERENCES dbo.tpv_invoice (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_credit_line_rectified_invoice_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice_credit_line ADD CONSTRAINT fk_tpv_invoice_credit_line_rectified_invoice_id FOREIGN KEY (rectified_invoice_id) REFERENCES dbo.tpv_invoice (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_credit_line_order_line_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice_credit_line ADD CONSTRAINT fk_tpv_invoice_credit_line_order_line_id FOREIGN KEY (order_line_id) REFERENCES dbo.tpv_order_line (id);
IF OBJECT_ID(N'dbo.fk_tpv_invoice_credit_line_credit_invoice_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_invoice_credit_line ADD CONSTRAINT fk_tpv_invoice_credit_line_credit_invoice_id FOREIGN KEY (credit_invoice_id) REFERENCES dbo.tpv_invoice (id);
IF OBJECT_ID(N'dbo.fk_tpv_verifactu_record_invoice_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_verifactu_record ADD CONSTRAINT fk_tpv_verifactu_record_invoice_id FOREIGN KEY (invoice_id) REFERENCES dbo.tpv_invoice (id);
IF OBJECT_ID(N'dbo.fk_tpv_delivery_order_line_delivery_order_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_delivery_order_line ADD CONSTRAINT fk_tpv_delivery_order_line_delivery_order_id FOREIGN KEY (delivery_order_id) REFERENCES dbo.tpv_delivery_order (id);
IF OBJECT_ID(N'dbo.fk_tpv_delivery_order_event_delivery_order_id', N'F') IS NULL
    ALTER TABLE dbo.tpv_delivery_order_event ADD CONSTRAINT fk_tpv_delivery_order_event_delivery_order_id FOREIGN KEY (delivery_order_id) REFERENCES dbo.tpv_delivery_order (id);
GO

/* ---------- Descripción de cada tabla (MS_Description) ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_sales_period') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Periodos de venta (uno abierto por local)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_sales_period';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_customer_ref') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Ficha de clientes para factura completa', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_customer_ref';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_orders') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Orden de una mesa (la transacción). En fast food, la orden FASTFOOD de cada caja', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_orders';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_account') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Cuentas de la orden (accounts[])', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_account';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_order_line') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Productos de la cuenta, también los eliminados (lines[] y deletedLines[])', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_order_line';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_order_line_modifier') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Respuestas de las preguntas de cada línea (modifiers[])', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_order_line_modifier';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_order_line_printer') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'A qué impresora salió cada línea (printers[])', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_order_line_printer';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_order_event') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Eventos de la mesa y de cada cuenta (events[])', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_order_event';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_account_discount') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Descuentos aplicados a una cuenta (discounts[])', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_account_discount';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_payment') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Pagos de una cuenta (payments[])', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_payment';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_payment_cash_detail') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Billetes y monedas recibidos y devueltos (cashDetail)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_payment_cash_detail';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_payment_bank_data') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Respuesta del datáfono o del banco (bankData)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_payment_bank_data';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_invoice') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Facturas emitidas (accounts[].invoice). Inmutables', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_invoice';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_invoice_tax') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Desglose de impuestos de la factura', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_invoice_tax';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_invoice_credit_line') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Unidades de cada línea que abona una rectificativa (abono total o parcial)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_invoice_credit_line';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_verifactu_record') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Registro VeriFactu: alta o anulación con huella encadenada y envío a la AEAT', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_verifactu_record';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_order_reconnection') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Lo ticado sin conexión, pendiente de validar o descartar (Reconexiones de la orden)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_order_reconnection';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_order_incident') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Incidencias de mesa: sin conexión, no cuadra con el servidor o cambio rechazado. Se guardan solas; resolverlas lo decide una persona en el equipo donde pasó', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_order_incident';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_delivery_order') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Pedidos de delivery del tablero Pedidos (Glovo, Uber Eats, Just Eat, web propia…)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_delivery_order';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_delivery_order_line') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Productos de un pedido de delivery tal como llegan (product_id si se reconoce el PLU de la carta)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_delivery_order_line';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_delivery_order_event') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Pasos de cada pedido: estado, cuándo y quién (by_name = «Integración» o «Automático» si no lo hizo una persona)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_delivery_order_event';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_cash_movement') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Movimientos de caja: fondo, retiros, arqueos y depósitos', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_cash_movement';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_cash_closing') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Cierre de periodo y arqueo final', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_cash_closing';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_period_summary') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Resumen de cada periodo cerrado (Gestor de cierres): totales, por hora, por camarero, formas de pago y anulaciones', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_period_summary';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_petty_cash_movement') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Caja chica (aparte del cajón): ingresos de efectivo, gastos con descripción y foto del ticket; saldo después de cada uno', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_petty_cash_movement';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_incident_request') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Requerimientos enviados a Marketing con las incidencias', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_incident_request';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_product_incident') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Incidencias: cambios de productos hechos en el local', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_product_incident';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_config_change_log') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Historial de cambios de Ajustes (se envía a Japp Manager)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_config_change_log';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_week_note') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Observaciones de cada día en Gestiones › Resumen semana (una por tienda y día de negocio; borrar el texto borra la fila)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_week_note';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_print_job') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Cola de impresión: cada papel que hay que sacar. Lo imprime la API en segundo plano (guardar no espera a la impresora)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_print_job';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_catalog_release') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Cartas enviadas por Japp Manager (completas o solo precios) con su fecha de entrada en vigor', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_catalog_release';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_company') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Empresa (razón social y NIF del emisor de las facturas)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_company';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_store') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Restaurante / local (Ajustes › Restaurante)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_store';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_store_parameters') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Parámetros del local (Ajustes › Parámetros)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_store_parameters';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_billing_settings') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Facturación del local: series, establecimiento y punto de emisión', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_billing_settings';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_invoice_series') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Numeración de cada serie (sin huecos)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_invoice_series';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_system_branding') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Ajustes › Administración › Sistema: nombre, textos del acceso, logos y colores del sistema (una fila por tienda; sin fila = los originales)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_system_branding';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_permission') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Catálogo de permisos por módulo y por botón (global, igual en todos los locales)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_permission';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_user_profile') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Perfiles (Administrador, Cajero, Mesero…)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_user_profile';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_profile_permission') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Permisos concedidos a cada perfil', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_profile_permission';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_app_user') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Usuarios del TPV (entran con clave de 4 cifras)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_app_user';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_area') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Áreas o planos (BARRA, TERRAZA…)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_area';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_dining_table') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Mesas', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_dining_table';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_area_drawing') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Lo dibujado en Editar sala: paredes, bloques, elementos y textos', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_area_drawing';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_station') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Estaciones (cajas) y PDA (comanderos)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_station';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_printer') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Impresoras', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_printer';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_print_channel') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Canales de impresión (BARRA, cocina…)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_print_channel';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_station_channel_printer') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'En cada estación, por qué impresora sale cada canal', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_station_channel_printer';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_tax') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Impuestos (IVA 10 %)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_tax';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_payment_method') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Formas de pago', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_payment_method';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_station_payment_method') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Formas de pago activas en cada estación o PDA', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_station_payment_method';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_discount') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Descuentos configurados', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_discount';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_station_discount') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Descuentos activos en cada estación o PDA', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_station_discount';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_reason') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Motivos de eliminación, retiro de caja y abono', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_reason';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_category') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Categorías de la toma de pedido', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_category';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_product') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Productos (PLU) con PVP general y PVP terraza', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_product';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_category_product') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Teclas: qué producto sale en cada categoría y dónde', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_category_product';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_product_channel') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Por qué canal sale cada producto', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_product_channel';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_question') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Preguntas (opciones del producto: leche, punto, menú…)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_question';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_question_answer') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Respuestas de una pregunta (cada respuesta es un producto)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_question_answer';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_product_question') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Preguntas que hace cada producto', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_product_question';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_service_shift') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Turnos de servicio para los SLA de atención (p. ej. Comida 12:00–16:30, Cena 19:30–00:30). La mesa cuenta en el turno en que se abrió', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_service_shift';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_service_sla') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'SLA de atención: minutos máximos de cada paso de la mesa por tienda, zona o mesa y turno. Vacío = hereda de la regla menos concreta', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_service_sla';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_sales_target') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Objetivo de venta: % sobre el año anterior (o importe fijo) para la proyección del Gestor de cierres', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_sales_target';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_delivery_settings') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Ajustes › Pedidos › Delivery (una fila por tienda; sin fila = los valores por defecto)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_delivery_settings';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_delivery_rider') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Motorizados de la tienda (Ajustes › Pedidos › Motorizados). Quitar uno lo desactiva: los pedidos antiguos lo siguen nombrando', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_delivery_rider';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_customer_display') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Segunda pantalla del cliente: configuración por tienda (Ajustes › Restaurante › Banners)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_customer_display';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_display_media') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Vídeos e imágenes de la segunda pantalla; el archivo está en MEDIA_DIR/<id> del servidor de la tienda', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_display_media';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_app_session') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Sesiones de la API de tienda: una vigente por usuario (ended_at NULL). Un token solo vale si su jti es la vigente; si no, 401 SESSION_REPLACED', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_app_session';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_pin_attempt') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Fallos de PIN seguidos por equipo; tras store_parameters.pin_attempts queda bloqueado hasta locked_until', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_pin_attempt';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_idempotency_key') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Respuestas guardadas por Idempotency-Key: la misma clave devuelve la misma respuesta sin repetir la acción', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_idempotency_key';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_oot_token') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Token del QR de Order on Table de una orden abierta (caduca al cerrar la mesa)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_oot_token';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_sync_outbox') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Cola de envío del local a la central (Japp Manager)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_sync_outbox';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_sync_state') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Estado del agente de sincronización con Japp Manager (uno por tienda)', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_sync_state';
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID(N'dbo.tpv_schema_migrations') AND minor_id = 0 AND name = N'MS_Description')
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Versiones de la base aplicadas', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'tpv_schema_migrations';
GO
