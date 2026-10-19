# fake-manager · Japp Manager de pruebas

Implementa en memoria el lado Manager del contrato de sincronización de transacciones, para probar `apps/sync-agent` (y la tienda) sin el Manager real.

## Qué hace

Base `/api/manager/v1`, `Authorization: Bearer <FAKE_MANAGER_STORE_KEY>`, respuestas con el sobre estándar `{title, type, status, data, errors, traceId, author, mode}`. Acepta cuerpos con `Content-Encoding: gzip`.

| Ruta | Regla |
|---|---|
| `POST /stores/:storeId/transactions` | Guarda por (storeId, orderId) solo si `version` es mayor → `accepted`; igual y mismo contenido → `duplicate`; menor → `stale`; igual con otro contenido → `conflict`. Las facturas de dentro (`accounts[].invoice`, por `series`+`sequence` o `invoiceNumber`) son únicas por (storeId, serie, número): otra con distinto contenido → `conflict`. Mal formada → `rejected`. `Idempotency-Key`: misma clave y mismo cuerpo → la misma respuesta (`Idempotent-Replayed: true`); otro cuerpo → `409 IDEMPOTENCY_MISMATCH` |
| `POST /stores/:storeId/transactions/reconcile` | `{businessDate, periodId, items:[{orderId, version}]}` → `{missing, outdated:[{orderId, managerVersion}]}` |
| `POST /stores/:storeId/heartbeat` | Guarda el latido → `{serverTime}` |

### Inspección y controles (sin storeKey; es una herramienta local)

- `GET /__fake/state`: todo lo guardado, historial de resultados, latidos, conciliaciones y peticiones.
- `GET /__fake/stores/:storeId/transactions`: transacciones guardadas de una tienda.
- `DELETE /__fake/stores/:storeId/transactions/:orderId`: «pierde» una transacción (para probar la conciliación).
- `POST /__fake/controls` con cualquiera de:
  - `{"fail": {"transactions": 503}}`: responde ese código siempre en esa ruta (`transactions`, `reconcile`, `heartbeat`); `null` lo quita. 503 = Manager caído, 401 = storeKey revocada.
  - `{"loseResponses": 1}`: guarda el siguiente lote y corta la conexión sin contestar (tampoco apunta la respuesta de la Idempotency-Key, como si se cayera justo después de guardar).
  - `{"reject": ["<orderId>"]}`: esas órdenes salen `rejected`.
  - `{"poison": ["<orderId>"]}`: un lote que las contenga responde `422` entero.
  - `{"maxBatch": 2}`: lotes más grandes responden `413`.
- `POST /__fake/reset`: lo vacía todo.

## Variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `FAKE_MANAGER_STORE_KEY` | — (obligatoria) | storeKey que se acepta |
| `FAKE_MANAGER_PORT` | `8090` | puerto |
| `FAKE_MANAGER_HOST` | `127.0.0.1` | interfaz (`0.0.0.0` para abrirlo a la red) |

## Arrancar

```bash
npm start -w fake-manager
# el agente contra él:
MANAGER_URL=http://127.0.0.1:8090/api/manager/v1 STORE_KEY=<la misma clave> npm start -w sync-agent
```

## Probar

```bash
npm test -w fake-manager      # reglas del Manager con inject(), sin red ni base
```

Desde código: `createFakeManager({ storeKey })` devuelve `{ app, store, listen(port), close() }`; `store.controls` son los mismos controles.
