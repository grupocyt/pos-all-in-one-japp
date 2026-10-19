# sync-agent · agente de sincronización con Japp Manager

Proceso aparte en el servidor de la tienda que lleva al Manager **las transacciones** (la transacción completa de cada mesa: abierta, cerrada o cancelada). Es lo único que sincroniza. Diseño: «Sincronización Manager» (Developer › Transacciones).

## Cómo funciona

1. store-api, en la misma transacción de cada cambio de una mesa, deja un aviso en `sync_outbox` (`entity = 'order'`) y guarda la última foto en `orders.snapshot` / `orders.version`.
2. El agente (uno solo por tienda: `pg_try_advisory_lock(hashtext('sync-agent:' || storeId))` en una conexión dedicada) despierta con `LISTEN sync_outbox` (espera `SYNC_DEBOUNCE_MS` para juntar cambios) y, por si acaso, cada `SYNC_INTERVAL_SECONDS`.
3. Agrupa los avisos pendientes por orden (`min(id)`, `max(id)`, hasta `SYNC_BATCH`), lee la foto actual de `orders.snapshot` y manda `POST {MANAGER_URL}/stores/{storeId}/transactions` con `Idempotency-Key: tx-{storeId}-{primero}-{último}` y el cuerpo en gzip.
4. Por cada resultado: `accepted` / `duplicate` / `stale` → `sent_at` en sus avisos (id ≤ último); `conflict` → `parked_at` (no reintenta); `rejected` → `attempts + 1` y aparcada al llegar a `SYNC_MAX_ATTEMPTS`. Si el lote venía lleno, repite enseguida.
5. Errores: 401/403 → deja de enviar (el latido y `sync_state.last_error` dicen `STORE_KEY_REJECTED`) hasta que un latido vuelva a dar 200 (la misma clave vuelve a valer) y entonces se reanuda solo; `409 IDEMPOTENCY_MISMATCH` → clave nueva; 413 → parte el lote; 422 → parte hasta aislar la mala y la aparca; 429/5xx/timeout/sin red → espera 5, 10, 20… hasta 60 s y reintenta el mismo lote con la misma clave (los mismos bytes). Nunca deja de intentarlo.
6. Conciliación cada `SYNC_RECONCILE_MINUTES`, al arrancar y al ver un periodo recién cerrado: manda `orderId + version` de las órdenes del periodo; lo que el Manager tenga en `missing`/`outdated` se vuelve a encolar.
7. Latido cada `SYNC_HEARTBEAT_SECONDS` (`agentVersion, outboxPending, oldestPendingAt, openTransactions, lastSentAt, lastError`); la respuesta `serverTime` da la diferencia de reloj.

Los avisos de otras entidades (`config`, `transaction`, `period.closed`…) no se tocan.

El estado queda en `sync_state` (lo lee `GET /sync/status` de store-api): `last_sent_at`, `last_sent_id`, `last_heartbeat_at`, `manager_time_offset_ms`, `last_error`, `last_error_at`.

## Capas

```
src/Program.ts                      arranque, tienda por STORE_ID/STORE_CODE, parada limpia (SIGTERM/SIGINT)
src/Properties/AppSettings.ts       configuración desde el entorno
src/Services/SyncService.ts         el ciclo y las reglas (sin SQL)
src/Applications/OutboxApplication.ts  todo el SQL (sql`…` de Drizzle sobre @japp/db) y la sesión del bloqueo/LISTEN
src/Clases/ManagerClient.ts         HTTP con fetch nativo y gzip (node:zlib)
src/Helpers/                        logs JSON (pino, sin secretos), esperas y fechas
```

## Variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `DATABASE_URL` | — | base de la tienda |
| `MANAGER_URL` | — | URL del Manager (con o sin `/api/manager/v1`; si falta, se añade) |
| `STORE_CODE` / `STORE_ID` | — | tienda: por `store.code` o directamente su UUID |
| `STORE_KEY` | — | credencial de la tienda (solo en `.env`) |
| `SYNC_INTERVAL_SECONDS` | 60 | vaciado de la cola aunque no llegue NOTIFY |
| `SYNC_INSTANT` | true | LISTEN/NOTIFY para enviar al momento |
| `SYNC_DEBOUNCE_MS` | 2000 | espera para juntar cambios seguidos |
| `SYNC_BATCH` | 100 | transacciones por lote |
| `SYNC_GZIP` | true | comprimir el cuerpo |
| `SYNC_MAX_ATTEMPTS` | 10 | rechazos antes de aparcar |
| `SYNC_RECONCILE_MINUTES` | 60 | conciliación periódica |
| `SYNC_HEARTBEAT_SECONDS` | 60 | latido |
| `SYNC_RETRY_BASE_MS` / `SYNC_RETRY_MAX_MS` | 5000 / 60000 | espera creciente ante fallos temporales |
| `SYNC_HTTP_TIMEOUT_MS` | 30000 | tiempo máximo por petición |
| `LOG_LEVEL` | info | nivel de log |

## Arrancar

```bash
npm start -w sync-agent          # lee ../../.env
```

## Probar

Contra PostgreSQL real (base temporal creada con `../japp-db`) y el Manager de pruebas (`apps/fake-manager`) en un puerto libre:

```bash
cd apps/sync-agent
DATABASE_ADMIN_URL="postgres://postgres@localhost:55432/postgres?host=/tmp/pgx" npx vitest run
npm run typecheck
```

Casos: abierta y cerrada con su versión, 50 avisos → un envío, respuesta perdida → duplicate, versión vieja → stale, Manager caído y vuelta, dos agentes, conciliación (periódica y al cerrar periodo), 401, rechazada 10 veces, factura repetida, 413/422 y avisos de otras entidades intactos.
