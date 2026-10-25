# CLAUDE.md · japp-db

Base de datos de **Japp TPV**, el punto de venta de Cañas y Tapas. Este repositorio es la **única fuente de verdad del esquema**: el back (`japp-api`) lee el esquema de aquí y nunca crea ni cambia tablas por su cuenta.

Motor: **PostgreSQL 16** (servidor de tienda Ubuntu, 4 núcleos, 8 GB). MySQL y SQLite se probaron y se descartaron. Los motivos están en `docs/pruebas-bd.html`. No añadas soporte para otros motores.

## Qué hay aquí

```
sql/01_esquema_postgres.sql          50 tablas, 127 FK, CHECK, índices, trigger updated_at, COMMENT ON (línea base)
sql/02_datos_arranque_postgres.sql   Sucursal Pruebas (la base de TODAS las pruebas) (CT 03; STORE_CODE=… al crear la base le pone otro código): carta 487 productos, perfiles, 47 permisos, 4 usuarios, estaciones, impresoras…
sql/04_datos_tienda_inicial.sql      tienda nueva (24/10/2026, formulario «Datos iniciales Japp»): JC01, NIF B12300141, salas BARRA (1) · SALON (100–199) · TERRAZA (200–399), canales BEBIDA y COMIDA, matriz de permisos (el Cajero abre periodo). Solo al crear una base con SEED=1, después de las migraciones; nunca en una base con ventas. Las pruebas no lo usan
sql/verificacion/*.sql               6 consultas de control; cada una devuelve 0 filas si todo está bien
migrations/NNNN_*.sql                cambios posteriores a la línea base (0001: idempotency_key · 0002: app_user.lock_seconds, bloqueo por usuario · 0003: order_line.sort_order, orden de las líneas · 0004: pases del menú · 0005: Ajustes con versión por registro y config_version, historial con antes/después, Gestor de cierres (period_summary, sales_target), sincronización (sync_outbox.event_id/parked_at, sync_state) y carta programada (catalog_release) · 0006: canales de impresión por tipo (comanda/ticket), impresora por defecto, copias y canal de tickets por área · 0007: order_line.deleted_stage, en qué momento se eliminó cada línea · 0008: caja principal (station.is_main, user_profile.allowed_stations), una persona por mesa (orders.holder_*, charging_until, permiso mesas.entrarOcupada) e integridad de ventas (sin CASCADE, payment.method libre, una orden abierta por mesa, una factura por cuenta, VeriFactu sin ramas, series con FK, rangos) · 0009: sesiones en la base (app_session, una vigente por usuario) y bloqueo de PIN por equipo (pin_attempt) · 0010: tipos de factura VeriFactu F1, F2, F3 y R1…R5, índices de las series de billing_settings y comentarios que faltaban · 0011: UUID de equipo único entre las estaciones activas de la tienda · 0012: carta del App Manager (external_id único por tienda en category, product y question; product.description; order_on_table en categorías y productos), store.web_order_url, tokens de Order on Table (oot_token, uno vigente por orden), abonos por líneas (invoice_credit_line) y permiso mesas.orderOnTable · 0013: NOTIFY sync_outbox al encolar, para que el agente envíe al momento · 0014: payment_method.external_id, id de integración de las formas de pago · 0015: order_incident, incidencias de mesa (sin conexión, no cuadra, rechazado) que se resuelven a mano · 0016: billing_settings.batch_send_seconds, segundos sin tocar tras los que el TPV y la PDA mandan la tanda (2–30, 5) · 0017: SLA de atención (service_shift: turnos; service_sla: límites por tienda, zona o mesa y turno, lo vacío se hereda; la regla de la tienda lleva todos y la versión) · 0018: app_user.color, color de la persona en el TPV (#RRGGBB o vacío) · 0019: store.sir_url, URL de la interfaz de ventas al SIR (http/https o vacío))
scripts/init.mjs                     npm run db:init → si la base está vacía aplica la línea base (+ datos con SEED=1) y luego migraciones. Seguro de repetir
scripts/migrate.mjs                  npm run db:migrate → solo migraciones pendientes (registro en schema_migrations con checksum)
scripts/db.mjs                       crear base temporal + aplicar sql/ (lo usan las pruebas y db:reset)
scripts/apply.mjs                    npm run db:reset → recrea DATABASE_URL (solo desarrollo; se niega con nombres de bases reales)
scripts/verify.mjs                   npm run verify → pasa sql/verificacion contra DATABASE_URL
test/                                69 pruebas vitest contra PostgreSQL real (estructura, arranque, reglas, numeración concurrente, verificación)
docs/base-de-datos-japp.html         diagrama y diccionario de las 50 tablas (abrir en el navegador)
docs/pruebas-bd.html                 informe de pruebas PG vs MySQL vs SQLite (volumen 45 000 tickets, concurrencia, tamaños)
```

## Comandos

```bash
cp .env.example .env        # una vez
npm install
npm run db:up               # PostgreSQL 16.4 en Docker (puerto 5432)
npm test                    # crea japp_test_<pid>, aplica sql/, prueba y la borra (KEEP_TEST_DB=1 para conservarla)
npm run db:reset            # recrea la base de desarrollo DATABASE_URL (borra todo)
npm run db:init             # crea si falta + migra (lo que hace el contenedor de la API al arrancar)
npm run db:migrate          # solo migraciones pendientes (tiendas ya instaladas)
npm run verify              # consultas de control sobre DATABASE_URL (sale con 1 si algo no cuadra)
```

Antes de dar algo por terminado: `npm test` en verde.

## Convenciones del esquema (obligatorias)

- **Nombres** en inglés, `snake_case`, tablas en singular (`order_line`). La excepción es `orders`, porque `order` es palabra reservada.
- **Ids**: `UUID` generados por la aplicación (v4, o v5 para datos de arranque deterministas). La única excepción es `sync_outbox.id BIGSERIAL`, porque fija el orden de envío.
- **Multitienda**: todas las tablas llevan `store_id` salvo `company`, `permission` (catálogo global) y `store`. Toda consulta del back filtra por `store_id`.
- **Dinero**: `NUMERIC(10,2)`. Tipos de IVA: `NUMERIC(5,2)`. Cantidades: `NUMERIC(9,3)`. Nunca `float`, `real` ni `money`.
- **Fechas**: `TIMESTAMPTZ(3)` guardadas en UTC. La conversión a hora de España (Europe/Madrid) se hace solo al mostrar o en el QR de VeriFactu.
- **Enums**: `VARCHAR` + `CHECK (col IN (…))`. Los valores son los que usa el dominio (`pendingPrint|printed|preBill|deleted`, `general|terrace`, `F1|F2|F3|R1…R5`…). Si añades un valor, cámbialo también en `japp-api/packages/domain/src/types.ts`.
- **Quién hizo qué (columnas ACTOR)**: los grupos son `<prefijo>_user_id`, `_user_name`, `_role`, `_device`, `_origin`, `_at`. Prefijos usados: `opened_by`, `closed_by`, `created_by`, `deleted_by`, `delete_authorized_by`, `applied_by`, `authorized_by`, `removed_by`, `collected_by`, `issued_by`, `last_entry`, `last_exit`. Se guarda el nombre además del id para que el histórico no cambie si se renombra a alguien.
- **No se borra nada de ventas**:
  - Líneas: `deleted = true` + `delete_reason` + quién la borró + quién autorizó.
  - Configuración: `active = false`.
  - Facturas: inmutables; se corrigen con una rectificativa (`R1`, `rectified_invoice_id`).
- **`updated_at`** lo mantiene el trigger `set_updated_at()`. Toda tabla nueva con `updated_at` necesita su `trg_<tabla>_updated_at`, y hay una prueba que lo exige.
- **Toda FK con índice** en su columna de origen (hay prueba).
- **`COMMENT ON`** en cada tabla y en cada columna no obvia, en español, para que el diccionario de `docs/` se genere solo.

## Reglas de negocio que viven en la base

| Regla | Cómo |
|---|---|
| Una sesión vigente por usuario | `app_session` (id = jti del token) + índice único parcial `(store_id, user_id) WHERE ended_at IS NULL`; al entrar de nuevo la anterior queda `ended_reason = 'replaced'` con `replaced_by_id` (FK diferida). La API rechaza un token que no sea el vigente (401 SESSION_REPLACED) |
| Bloqueo de PIN | `pin_attempt` por `(store_id, key)`: `device:<UUID>` del equipo o `station:<id>`, y `user:<id>` en la clave de encargado; `locked_until` tras `pin_attempts` fallos |
| Una sola caja principal por tienda | `station.is_main` + índice único parcial por tienda; el perfil con `allowed_stations = 'main'` (Cajero) solo entra en ella |
| Una persona por mesa | `orders.holder_user_id/holder_station_id/holder_until` (30 s, se renueva) y `charging_until`; la API decide con `canEnterTable` |
| Un solo periodo de ventas abierto por tienda | `sales_period.open_flag SMALLINT CHECK (=1)` + `UNIQUE (store_id, open_flag)`; al cerrar se pone `NULL` |
| Numeración de facturas sin huecos ni repetidos (VeriFactu) | `invoice_series.last_sequence` se lee con `SELECT … FOR UPDATE` dentro de la **misma transacción** que inserta `invoice`, y además hay `UNIQUE (store_id, series, sequence)`. Sin el bloqueo, 8 equipos × 25 facturas repiten números (prueba `numeracion.test.ts`) |
| Encadenado VeriFactu | `verifactu_record.previous_record_id` + `previous_hash` = `hash` del anterior de la tienda |
| Concurrencia entre equipos | `orders.version`: el back hace `UPDATE … WHERE id=$1 AND version=$2`; si afecta 0 filas responde `VERSION_CONFLICT` |
| Envío al Manager | `sync_outbox` se escribe en la misma transacción que el cambio (patrón outbox); el agente lo vacía. `event_id` (único) es la identidad del mensaje: el Manager guarda por `(store_id, event_id)` y reenviar no duplica. Lo rechazado demasiadas veces queda `parked_at` |
| Concurrencia en Ajustes | cada tabla de configuración lleva `version`; `store.config_version` sube con cada cambio (ETag de `GET /config`) y queda en `config_change_log` con `before`/`after` |
| Gestor de cierres | `period_summary` se escribe al cerrar el periodo (misma transacción); un resumen por periodo, `business_date` en hora de Madrid. `sales_target`: % sobre el año anterior por año (week 0) o por semana |
| Impresión | Comanda: cada producto sale por sus canales `kind='kitchen'` y por las copias de esos canales (`copy_of_id`); impresora = la de la estación para ese canal o, si no, `print_channel.printer_id`. Precuenta y factura: canal `kind='ticket'` del área de la mesa (`area.ticket_channel_id`), con la misma regla de impresora |
| Carta programada | `catalog_release`: una por `release_version`, con `effective_at`; misma versión con otro `checksum` se rechaza |
| Carta del App Manager | `external_id` (id del Manager) único por tienda en `category`, `product` y `question` (índice único parcial, también entre desactivados: así un sync que lo vuelve a mandar reactiva el mismo registro) |
| Order on Table | `oot_token`: como mucho uno vigente por orden (`uq_oot_token_order_live` WHERE `revoked_at IS NULL`); al cerrar la mesa la API lo anula (`revoked_reason = 'closed'`) |
| Abonos por líneas | `invoice_credit_line`: unidades e importe abonados de cada línea por rectificativa (`quantity > 0`, una fila por abono y línea); así no se abona dos veces lo mismo |
| Aviso al agente | trigger `trg_sync_outbox_notify`: `pg_notify('sync_outbox')` por sentencia al encolar; llega al hacer COMMIT |
| Fotografía de la orden | `orders.snapshot JSONB` = la transacción completa como la ve el TPV (vista-orden). Las tablas normalizadas mandan; el snapshot es para leer rápido y auditar |

## Cómo cambiar el esquema

`01_esquema_postgres.sql` es la **línea base**. En cuanto una tienda la tenga instalada, no se vuelve a editar. A partir de ahí:

1. Crea `migrations/NNNN_descripcion.sql`, con numeración correlativa e idempotente cuando se pueda (`IF NOT EXISTS`). `scripts/db.mjs` → `migrate()` hace lo siguiente:
   - aplica cada migración en su transacción;
   - la registra en `schema_migrations` con su checksum;
   - usa un advisory lock para que dos procesos no migren a la vez;
   - **se niega** a seguir si una migración ya aplicada cambió.

   Las pruebas aplican las migraciones solas, porque `createDatabase` las incluye.
2. Cambios que no rompen: añadir columnas `NULL` o con `DEFAULT`, tablas e índices (`CREATE INDEX CONCURRENTLY` fuera de transacción en tablas grandes).
3. Cambios que rompen (renombrar, borrar, cambiar tipo) se hacen en dos versiones: añadir lo nuevo, migrar el back, y solo después quitar lo viejo. Hay tiendas con versiones distintas a la vez durante la migración tienda a tienda.
4. Actualiza las pruebas de `test/` y, si cambia algo que el back usa, avisa: en `japp-api` hay que ejecutar `npm run db:pull` (drizzle-kit pull) para regenerar el esquema tipado.
5. Regenera `docs/base-de-datos-japp.html` si cambian tablas.

## Rendimiento (medido con 45 000 tickets)

- Tamaño PG ≈ 190 MB por 45k tickets. Sobra con el disco de tienda; vigila `orders.snapshot` (JSONB) si crece.
- Informe «top 10 del mes»: necesita índice `(store_id, created_by_at)` en `order_line`, o mejor una tabla resumen diaria rellenada al cerrar el periodo.
- No metas lógica pesada en triggers: la lógica de negocio está en `japp-api/packages/domain`.

## Seguridad

- **Credenciales solo por variables de entorno** (`.env`, que no se sube). Nunca en el código, en los commits ni en el chat.
- PIN de usuarios: solo `bcrypt` (`pin_hash`). Los PIN de prueba (0186, 5845, 1012, 1111) son de la Sucursal Pruebas y **hay que cambiarlos antes de producción**.
- En producción, dos roles:
  - `japp_owner`: dueño del esquema; solo lo usan las migraciones.
  - `japp_app`: lo usa el back; tiene `SELECT/INSERT/UPDATE`, sin `DELETE` en tablas de ventas y sin DDL.
- Copias: `pg_dump` diario + WAL si se puede. El endpoint `/api/manager/v1/stores/{storeId}/backups` informa al Manager.

## Pruebas

- Corren contra **PostgreSQL de verdad**, nunca contra mocks ni SQLite. `test/global-setup.ts` crea una base temporal desde `sql/` y la borra al acabar.
- Cada prueba que escribe va dentro de `rollback(c, async () => …)` para no ensuciar a las demás.
- Si añades una regla a la base (CHECK, UNIQUE, trigger), añade una prueba que demuestre que rechaza el dato malo con su código SQLSTATE (23505 único, 23503 FK, 23514 CHECK).
- Si añades una consulta de control en `sql/verificacion/`, añade una prueba que la haga devolver filas con un dato roto, y otra que confirme 0 filas con la mesa de ejemplo (`insertSampleOrder`).

## Definición de hecho

- `npm test` en verde.
- Esquema con `COMMENT ON` y convenciones respetadas.
- Migración nueva (nunca editar la línea base instalada).
- Aviso al back si cambia algo que usa.

## No hacer

- No usar `DELETE` sobre ventas, `TRUNCATE` ni `DROP` fuera de migraciones revisadas.
- No ejecutar `db:reset` ni pruebas contra una base de tienda real.
- No guardar importes calculados en el cliente sin recalcularlos: los totales los calcula el back con `@japp/domain`.
- No añadir ORM ni lógica de negocio aquí: esto es SQL.
