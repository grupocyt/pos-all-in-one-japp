# CLAUDE.md · japp-db

Base de datos de **Japp TPV**, el punto de venta de Cañas y Tapas. Este repositorio es la **única fuente de verdad del esquema**: el back (`japp-api`) lee el esquema de aquí y nunca crea ni cambia tablas por su cuenta.

Motor: **PostgreSQL 16** (servidor de tienda Ubuntu, 4 núcleos, 8 GB). MySQL y SQLite se probaron y se descartaron. Los motivos están en `docs/pruebas-bd.html`. No añadas soporte para otros motores.

## Qué hay aquí

```
sql/01_esquema_postgres.sql          50 tablas, 127 FK, CHECK, índices, trigger updated_at, COMMENT ON (línea base)
sql/02_datos_arranque_postgres.sql   Sucursal Pruebas (CT 03): carta 487 productos, perfiles, 47 permisos, 4 usuarios, estaciones, impresoras…
sql/verificacion/*.sql               6 consultas de control; cada una devuelve 0 filas si todo está bien
migrations/NNNN_*.sql                cambios posteriores a la línea base (0001: idempotency_key · 0002: app_user.lock_seconds, bloqueo por usuario · 0003: order_line.sort_order, orden de las líneas · 0004: pases del menú · 0005: Ajustes con versión por registro y config_version, historial con antes/después, Gestor de cierres (period_summary, sales_target), sincronización (sync_outbox.event_id/parked_at, sync_state) y carta programada (catalog_release))
scripts/init.mjs                     npm run db:init → si la base está vacía aplica la línea base (+ datos con SEED=1) y luego migraciones. Seguro de repetir
scripts/migrate.mjs                  npm run db:migrate → solo migraciones pendientes (registro en schema_migrations con checksum)
scripts/db.mjs                       crear base temporal + aplicar sql/ (lo usan las pruebas y db:reset)
scripts/apply.mjs                    npm run db:reset → recrea DATABASE_URL (solo desarrollo; se niega con nombres de bases reales)
scripts/verify.mjs                   npm run verify → pasa sql/verificacion contra DATABASE_URL
test/                                44 pruebas vitest contra PostgreSQL real (estructura, arranque, reglas, numeración concurrente, verificación)
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
- **Enums**: `VARCHAR` + `CHECK (col IN (…))`. Los valores son los que usa el dominio (`pendingPrint|printed|preBill|deleted`, `general|terrace`, `F1|F2|R1`…). Si añades un valor, cámbialo también en `japp-api/packages/domain/src/types.ts`.
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
| Un solo periodo de ventas abierto por tienda | `sales_period.open_flag SMALLINT CHECK (=1)` + `UNIQUE (store_id, open_flag)`; al cerrar se pone `NULL` |
| Numeración de facturas sin huecos ni repetidos (VeriFactu) | `invoice_series.last_sequence` se lee con `SELECT … FOR UPDATE` dentro de la **misma transacción** que inserta `invoice`, y además hay `UNIQUE (store_id, series, sequence)`. Sin el bloqueo, 8 equipos × 25 facturas repiten números (prueba `numeracion.test.ts`) |
| Encadenado VeriFactu | `verifactu_record.previous_record_id` + `previous_hash` = `hash` del anterior de la tienda |
| Concurrencia entre equipos | `orders.version`: el back hace `UPDATE … WHERE id=$1 AND version=$2`; si afecta 0 filas responde `VERSION_CONFLICT` |
| Envío al Manager | `sync_outbox` se escribe en la misma transacción que el cambio (patrón outbox); el agente lo vacía. `event_id` (único) es la identidad del mensaje: el Manager guarda por `(store_id, event_id)` y reenviar no duplica. Lo rechazado demasiadas veces queda `parked_at` |
| Concurrencia en Ajustes | cada tabla de configuración lleva `version`; `store.config_version` sube con cada cambio (ETag de `GET /config`) y queda en `config_change_log` con `before`/`after` |
| Gestor de cierres | `period_summary` se escribe al cerrar el periodo (misma transacción); un resumen por periodo, `business_date` en hora de Madrid. `sales_target`: % sobre el año anterior por año (week 0) o por semana |
| Carta programada | `catalog_release`: una por `release_version`, con `effective_at`; misma versión con otro `checksum` se rechaza |
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
