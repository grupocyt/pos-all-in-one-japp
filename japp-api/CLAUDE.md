# CLAUDE.md · japp-api

Back de **Japp TPV**, el punto de venta de Cañas y Tapas. Va en el servidor de cada tienda (Ubuntu, 4 núcleos, 8 GB) y atiende a los TPV y las PDA del local. Se sincroniza con **Japp Manager** (central, en Azure) usando un outbox y pulls. Sustituye a MaxPoint tienda a tienda, y durante la migración conviven los dos.

Plan de Kevin: Node.js + TypeScript, PostgreSQL, Docker, Traefik; API de tienda v2, API del Manager, API Gateway y backoffice en Next.js; latido cada 5 s.

## Fuentes de verdad (léelas antes de escribir código)

| Qué | Dónde | Regla |
|---|---|---|
| Contrato HTTP (122 endpoints, errores, ejemplos) | `docs/openapi.yaml` (versión legible: `docs/api-japp.html`) | La API cumple el contrato. Si hay que cambiarlo, se cambia primero el YAML |
| Reglas de negocio | `packages/domain` (251 pruebas) | Los controladores y servicios **no** calculan: llaman al dominio |
| Esquema de base de datos | repo hermano `../japp-db` (`sql/01_esquema_postgres.sql`) | El back nunca crea ni altera tablas; se genera el esquema tipado con `drizzle-kit pull` |
| Comportamiento esperado en pantalla | `docs/prototipo/tpv-japp.html` (abrir en el navegador; entrar con PIN 5845) | Si una regla no está en el dominio, búscala aquí y pórtala **con su prueba** |
| Transacción de ejemplo | `docs/prototipo/transaccion-mesa-12.json` | Forma del JSON `Transaction` (vista-orden) |

## Stack (decidido)

- **Node 22 LTS**, TypeScript `strict`, ESM.
- **NestJS 11 sobre Fastify** (`@nestjs/platform-fastify`), con `@fastify/websocket` para `/api/v2/ws`.
- **Drizzle ORM** + driver `pg`. El esquema se genera con `drizzle-kit pull` desde la base de `japp-db`, **no** con `push` ni `generate`.
- **zod** para validar entrada. Tipos del contrato con `openapi-typescript` → `packages/contracts`.
- **decimal.js** para dinero (ya en `@japp/domain`).
- **vitest** para todo. Integración con PostgreSQL real (Testcontainers, o la base temporal de `../japp-db/scripts/db.mjs`).
- **pino** para logs (JSON). Las versiones van fijadas exactas en `package.json` (sin `^`).

## Estructura (monorepo con npm workspaces)

```
packages/domain/      reglas puras, sin E/S (251 pruebas), incluidos los tickets (tickets.ts). No importa nada de Nest, Drizzle ni pg
packages/contracts/   tipos + validador generados de docs/openapi.yaml (npm run contracts)
packages/db/          esquema Drizzle (npm run db:pull) + pool + withTx
apps/store-api/       NestJS + Fastify: API de tienda /api/v2 (264 pruebas de integración contra PostgreSQL)
  src/Program.ts              arranque (lee Properties/AppSettings.ts y llama a Startup.buildApp)
  src/Startup.ts              módulo Nest: controladores, servicios, applications, filtro de errores, guard de sesión e interceptores
  src/Controllers/            HTTP: ruta, verbo, leer cuerpo/params, sesión, validar la forma (Models/) y llamar a UN método del servicio
  src/Services/               lógica de negocio: permisos (AuthorizationService), orden de los pasos, transacción (withTx), dominio, errores. SIN SQL
  src/Applications/           todo lo de la base con Drizzle (consultas, FOR UPDATE, advisory locks); ConfigRegistry.ts = módulos de Ajustes
  src/Models/                 esquemas zod de los cuerpos y consultas, por área (OrdersModels.ts…)
  src/Helpers/                AuthGuard (sesión), IntegrationKeyGuard (Order on Table), ErrorsFilter, IdempotencyInterceptor, ResponseHelper (formato común),
                              EventsInterceptor + EventsSocket (WebSocket /api/v2/ws), TokenHelper, VerifactuHelper (huella), ValidationHelper, WebHost (TPV, Swagger)
  src/Clases/                 Printers.ts (LogPrinter / EscPosNetPrinter), EventsHub.ts (avisos en tiempo real)
apps/sync-agent/      agente de la tienda: sync_outbox (entity order) → Japp Manager, LISTEN sync_outbox, latido, conciliación (14 pruebas)
apps/fake-manager/    Manager de pruebas para el agente (6 pruebas)
Dockerfile, docker-compose.yml   base + API (que sirve también ../japp-tpv) y, con --profile sync, el agente; al arrancar aplica esquema y migraciones
```

Regla de capas (comprobación): `grep -nE "tx\.(select|insert|update|delete|execute)|database\.db|schema as s|from \"drizzle-orm\"" apps/store-api/src/Services/*.ts apps/store-api/src/Controllers/*.ts` → vacío.

## Estado (19/10/2026)

**Hechos los 97 endpoints de la API de tienda** del contrato, con pruebas de integración y de contrato (`docs/api-japp.html` marca cada uno «Hecho» leyendo las rutas de los controladores). Además del bloque del 15/10 (sesiones, periodos y caja, mesas, órdenes, líneas, cobro, facturas, Ajustes, impresoras, cierres y transacciones del día), el 18–19/10 se añadió:

| Módulo | Endpoints |
|---|---|
| Sync · App Manager | `GET /config/carta`, `POST /config/carta/sync`, `POST /config/categorias/sync`, `POST /config/productos/sync`, `POST /config/preguntas/sync`, `GET /config/carta/preview?mode=tpv\|oot` |
| Equipo | `POST /devices/identify`, `POST /devices/claim-main`, `GET /devices/me` |
| Órdenes | `POST /orders/{id}/save`, `POST /orders/{id}/transfer` (scope table\|account), `POST /orders/{id}/reopen`, `PATCH /orders/{id}/accounts/{accountId}` |
| Cobro | `POST …/accounts/{accountId}/checkout`, `GET /customers` |
| Order on Table | `POST` y `DELETE /orders/{id}/oot`, `GET /oot/{token}`, `POST /oot/{token}/lines` |
| Facturas, caja e informes | `POST /invoices/{id}/credit`, `GET /invoices/{id}/verifactu`, `POST /cash/drawer/open`, `GET /cash/x-report`, `GET /reports/sales`, `GET /reports/staff` |
| Ajustes | `PUT /config/categorias/order`, `POST /config/productos/{id}/sold-out`, `GET /config/permisos`, `GET /config/restaurante/pwa`, `PUT /config/areas/order`, `PUT /config/areas/{areaId}/layout`, `GET /incidents`, `POST /incidents/send` |
| Sincronización y tiempo real | `POST /sync/now`, `GET /ws` (WebSocket) |

**Pendiente:** logo en raster; registro del cajón abierto (hace falta un `kind` nuevo en `cash_movement`); color de la PWA por local; estado del agente en `sync_state` (hoy va en `last_error`); cómo llega el Manager a la API de cada tienda para los servicios Sync (VPN, túnel o relé).

**Tienda de este servidor y usuario de la base (21/10/2026):** cada tienda tiene su servidor y su base. `STORE_CODE` es opcional: sin él la API y el agente usan la única tienda activa de la base; con él se compara sin espacios ni mayúsculas (`pickStore` en `@japp/domain/stores.ts`). Si no se puede saber (varias tiendas sin código, código que no existe, base vacía) la API no arranca y lo dice (`Program.ts`). El código de verdad es `store.code` (Ajustes › Restaurante); al crear la base, `STORE_CODE=CT05 npm run db:init` (con `SEED=1`) o `npm run db:reset` lo pone. El usuario de la base es `sa` (en Docker, `DB_USER`, por defecto `sa`).

**Tanda de cambios de una mesa (25/10/2026):** `POST /orders/{orderId}/batch {commands:[{method, path, body, idempotencyKey}]}` (≤ 100). Cada comando pasa por su propia ruta (mismos permisos, presencia, versión e idempotencia; Fastify `inject`) pero todos en UNA transacción: `Database.ambient()` (AsyncLocalStorage en `@japp/db`: dentro, `database.db` y `withTx` usan esa transacción). Si uno falla no queda ninguno y se responde su error con `details.batchIndex`, `method` y `path`. Qué entra, en `@japp/domain/batch.ts` → `planBatch`: solo comandos de esa mesa que se quedan en la base (abrir esa misma mesa, comensales, cuentas, líneas, elegir un pase sin marchar); lo que imprime, cobra o toca la presencia va suelto (422 `commands[i].path`). El TPV (v163) manda así lo que junta en 5 s sin tocar.

**Incidencias al cerrar (25/10/2026):** `POST /periods/{id}/close` envía en la misma transacción las incidencias de productos pendientes (`IncidentsService.sendPending`, trigger `period_close`) y responde `incidentRequest` (REQ-nnnn o null). `GET /incidents` devuelve también `code` (INC-nnnn) y `GET /orders?status=closed|cancelled` trae zona, camarero, apertura, cierre y periodo (Gestiones › Reabrir mesa del TPV).

**Interfaz de ventas al SIR (25/10/2026, migración 0019):** `GET /interface/sir/sales?periodId` (funciones.periodo; sin periodId, el último periodo cerrado) devuelve lo que mandaba MaxPoint (`interface.USP_InterfaceSistemaGerente`, rama NORMAL) al SIR de Grupo KFC: `cod_restaurante` (= `store.maxpoint_rst_id`, Ajustes › Restaurante › `sirCode` / IdIntegración en el TPV), `lc_fecha` (dd/mm/aaaa) y cada bloque como XML `FOR XML RAW` en UTF-16LE con BOM, en hexadecimal `0x…` (`sirHex`, idéntico al de SQL Server: probado contra un HorasCajero real): CierreCajas, DinTrans, VentaHora, PlusTrans, HorasCajero; lo que no hay → `0x00000000`. Más `xml` (los bloques sin codificar) y `soap` (el sobre `interfaceVentasAgregadores` en el orden del SIR). `POST /interface/sir/sales/send` lo manda desde el servidor a `store.sir_url` (Ajustes › Restaurante › `sirUrl`) y lee el `<return>` JSON del SIR (`{"Respuesta","Mensaje"}` → `sir`, `accepted`). Reglas en `@japp/domain/sir.ts`; SQL en `Applications/SirApplication.ts`; envío en `Clases/SirClient.ts` (`SIR_SOAP_ACTION` opcional). El TPV lo enseña al cerrar el periodo («Enviar ventas al SIR», Developer), en Gestiones y desde el Gestor de cierres. Los códigos del SIR son los id de integración: `store.maxpoint_rst_id` (cod_restaurante) y `payment_method.external_id` (Cod_FormaPago); los descuentos son una forma de pago más, de tipo `discount` (migración 0020, con `show_in_tpv`: las que no se muestran no se cobran, `chargeable` en `@japp/domain/payments.ts`). PlusTrans y descuentos cuadrados con un envío real de MaxPoint (CT03, 18/08/2026).

**Venta del día (25/10/2026):** `GET /reports/sales` añade `invoiced` (facturado sin restar abonos), `credits {count, amount}` (rectificativas del periodo, ya restan en `sold`), `open` (lo marcado en mesas abiertas sin facturar: mesas, total con IVA, cobrado a cuenta, por hora y por camarero; también entra en `topProducts`) y `outlook` (regla `salesOutlook` en `@japp/domain/outlook.ts`: venta real = facturado + mesas abiertas; proyección con el reparto por hora de los últimos 8 cierres del mismo día de la semana o, sin historia, una curva por defecto desde la apertura).

**SLA de atención (25/10/2026, migración 0017):** `GET /service/live` (funciones.kpi) mide cada mesa abierta con lo que ya guarda la base —apertura, primera línea marcada, lo más antiguo sin enviar, último `linePrinted`/`courseFired`, `preBill` sin cobrar— y lo compara con sus límites; `GET/PUT /service/sla` (ajustes.parametros; leer también con funciones.kpi) guarda turnos (`service_shift`) y reglas (`service_sla`) por tienda, zona o mesa y turno, la configuración entera de una vez con `version`. Las reglas viven en `@japp/domain/sla.ts`: `resolveSla` (manda lo más concreto, campo a campo; lo vacío se hereda), `shiftAt` (turno de la apertura, hora de Madrid, cruza medianoche), `measureTable`, `validateSlaConfig`. El TPV (v170) lo enseña en Gestiones › Mesas en servicio y Ajustes › SLA de atención.

**Decisiones del 18–19/10/2026:**
- **Guardar** (`POST /orders/{id}/save`): envía lo por enviar (pide `pedido.enviar` solo si hay algo), sale de la mesa y, si no le queda nada vivo, la cierra sin venta (`released: true`). Con otra persona dentro solo guarda.
- **Cambio de mesa en un solo endpoint**: `POST /orders/{id}/transfer {scope: table|account}`; responde la transacción de destino. `POST …/accounts/{accountId}/transfer` sigue para compatibilidad.
- **Reabrir**: orden `cancelled`/`closed` del periodo abierto en su mesa libre; las cuentas anuladas sin factura vuelven a open, las facturadas siguen bloqueadas (regla `planReopen`).
- **Checkout**: pagos + factura en una transacción con `checkout()` del dominio; todo o nada (`PENDING_NOT_ZERO` sin guardar ningún pago). Comparte con `payments` e `invoice` los mismos métodos privados (`paymentInput`, `emitInvoice`).
- **Abono**: rectificativa por diferencias, R5 de una F2 y R1 de una F1, en la serie de abonos; total o por unidades (`invoice_credit_line`, migración 0012), nunca más de lo que queda (`QUANTITY_EXCEEDS`); el último abono cuadra al céntimo. Misma cadena VeriFactu (`Helpers/VerifactuHelper.ts`). La original pasa a `rectified` al abonarse entera. R1 y R5 restan en cierres y transacciones (`isRectificative`).
- **Equipo**: el TPV/PDA se reconoce por su UUID entre las estaciones activas (`identifyDevice`); la CAJA 1 se configura en cualquier escritorio con el PIN de quien tenga `ajustes.estaciones` (bloqueo de PIN por `device:<uuid>` y, como el UUID lo manda el equipo, también por `claim-main:<storeId>`; clave inexistente o sin el permiso → `401 BAD_PIN`, y cuenta como fallo), y el UUID se quita de cualquier otra estación. `POST /devices/register` nunca asigna la principal.
- **Sync · App Manager**: lista completa, todo o nada; casa por `externalId` y si no por nombre (PLU en productos); reactiva con el mismo id; lo que no viene se desactiva (en la carta completa en cascada, sin `IN_USE`). Canales y agotado son de la tienda. `config_version` sube una vez por llamada y solo si algo cambia; una fila de historial por registro y una sola en la cola.
- **Order on Table**: permiso `mesas.orderOnTable`; un token por orden abierta (se reutiliza); caduca al cerrar la mesa (`OrdersApplication.save` lo anula) o al anularlo. El sistema externo entra con `X-Integration-Key` (`OOT_INTEGRATION_KEY`; vacía = cerrado). Los pedidos se envían solos a la cuenta «Order on Table» como actor `customer`, y `requestId` evita el pedido doble.
- **Tiempo real**: `GET /api/v2/ws?token=…` (sesión vigente; si no, cierre 4001). `EventsInterceptor` avisa después del COMMIT según la ruta: `order.updated` + `table.updated`, `config.changed`, `print.failed` (503) y `session.replaced`. Solo avisa; el dato se pide por REST.
- **Sincronización**: el agente (`apps/sync-agent`) manda la transacción completa (abierta o cerrada) con la última versión de cada orden, gzip e `Idempotency-Key`; escucha `sync_outbox` (trigger de la migración 0013) con debounce de 2 s; un agente por tienda (`pg_try_advisory_lock(hashtext('sync-agent:' || storeId))`); tras 401/403 espera a que un latido vuelva a dar 200. `POST /sync/now` lo despierta.

**Decisiones tomadas al construir (15/10/2026):**
- **Tickets** (formato de las impresoras de la cadena, 48 columnas, CP858 con €): `@japp/domain/tickets.ts` construye factura (F1/F2: Nº Op., IVA por tipo, entregado/cambio, formas de pago, QR VERI*FACTU), precuenta («NO VÁLIDO COMO FACTURA», reparto por comensal) y comanda (comensales, CANAL/camarero, hora en doble alto, «Mesa N Área» en doble tamaño, productos en mayúsculas y doble ancho, `**comentario`, `-- n modificador`). `renderText` para vista previa/pruebas y `renderEscPos` para la impresora. Comanda y precuenta: ver «Impresión después del COMMIT». Factura: se imprime después del COMMIT; un fallo de impresora nunca deshace una factura (`printed: false`, se reimprime con `POST /invoices/{id}/reprint`). El cajón se abre si hubo efectivo y la estación tiene `opens_drawer`.
- Bloqueo de sesión por inactividad: `POST /sessions` y `GET /sessions/current` devuelven `lockSeconds` = `app_user.lock_seconds` o, si es NULL, `store_parameters.lock_seconds` (TPV, 7 s) / `lock_seconds_pda` (móvil, 10 s); 0 = nunca. Regla en `@japp/domain` → `effectiveLockSeconds`. El equipo lo vuelve a leer al desbloquear.
- Tokens de sesión firmados con HMAC (sin tabla de sesiones), con caducidad de `SESSION_HOURS` (12 h).
- La estación del equipo llega en la cabecera `X-Station-Id` (id, UUID del equipo o nombre). Si la estación tiene `device_uuid` (`POST /devices/register`), solo vale ese UUID: por nombre o id → `403 STATION_NOT_ALLOWED` «Este equipo no es esa estación» (`resolveStation` en `@japp/domain/stations.ts`). Sin cabecera, la primera caja.
- La autorización de encargado es de un solo uso y dura 2 minutos. El registro de usadas está en memoria (un proceso por tienda).
- El bloqueo de PIN se guarda en la base (`pin_attempt`, migración 0009; sobrevive a reinicios) por equipo: `device:<UUID>` si la estación tiene UUID de equipo, si no `station:<id>` (`pinLockKey`). Nunca por IP (detrás de un proxy bloquearía toda la tienda). En la clave de encargado, además, por usuario de la sesión (`user:<id>`). Al entrar no se sabe quién es (el PIN es la identidad).
- La línea pasada entera a otra cuenta queda `deleted` con motivo «Pasada a …». Su copia vive en la otra cuenta, y el informe de eliminaciones no la muestra.
- Las facturas de una tienda se emiten de una en una (`pg_advisory_xact_lock`), porque F y T comparten la cadena VeriFactu. La hora de la factura y del registro se toma **después** de tener el bloqueo, y el anterior de la cadena es el registro que aún no tiene sucesor (la base garantiza uno: `uq_verifactu_previous`, `uq_verifactu_genesis`), no «el más reciente por fecha».
- Transferir mueve la mesa entera; una sola cuenta se pasa con «Separar cuenta». Sin productos no se transfiere (422).
- **Pasar una cuenta a otra mesa** (15/10/2026; regla `transferAccount` en `@japp/domain/transfer.ts`): `POST /orders/{id}/accounts/{accountId}/transfer {version (la del origen), toTableId, authorization?}` → 200 `{from: Transaction, to: Transaction}`; permiso `mesas.transferir`, Idempotency-Key. La cuenta va entera (líneas con su estado y sus eliminadas, descuentos, cobros parciales, cliente, pases) y con sus precios: se cambian `account.order_id` y `order_line.order_id`, el resto cuelga de ellas. Destino libre → orden nueva (1 comensal, la abre quien llama); ocupado → una cuenta más, renombrada a «Cuenta N» (primer número libre) si el nombre existe; nunca se juntan líneas. Facturada o sin productos → `422 NOTHING_TO_TRANSFER`; misma mesa → 422; destino cobrándose → `TABLE_CHARGING`; destino con otra persona → `TABLE_TAKEN` salvo `mesas.entrarOcupada`. Origen sin cuentas vivas → `cancelled` (o `closed` si tenía facturadas) y mesa libre. Las dos órdenes suben de versión, van a la cola y llevan su evento. Bloqueo: la mesa de destino y luego las dos órdenes por id.
- **Cuenta a 0,00 €** (15/10/2026): no se cobra, no se factura y no se imprime precuenta → `409 NOTHING_TO_CHARGE` (regla en `@japp/domain`: `registerPayment`, `issueInvoice`, `preBill`). Una invitación ya no es un descuento del 100 % facturado a 0: se eliminan las líneas con motivo «Invitación».
- **Mesa sin productos**: `POST /orders/{id}/close` («Cerrar mesa sin venta») la cierra si no le queda nada vivo (sin líneas ni cobros en cuentas sin facturar); la orden queda `cancelled`, las cuentas sin facturar se anulan y la mesa libre. Con productos → `409 ORDER_NOT_EMPTY`. El TPV la deja disponible al salir y lo replica con este endpoint.
- **Líneas iguales se juntan** mientras están «Por enviar»: mismo producto, mismo comentario y mismas respuestas a las preguntas (`modKey` en `lines.ts`). Respuestas distintas = otra línea (como la PDA y el TPV al pedir varias unidades por separado).
- **Preguntas obligatorias** (`question.min_answers ≥ 1`): `POST …/lines` exige sus respuestas en `modifiers` (PLU de la respuesta, o `questionId`); si falta alguna o sobran → `422 VALIDATION` con `field: "modifiers"` y la pregunta en `details` (regla `checkAnswers` en `questions.ts`).
- **Orden de las líneas** (`order_line.sort_order`, migración 0003): `POST …/lines/reorder` ordena lo «Por enviar» de una cuenta (`reorderPending` en `lines.ts`; hay que mandar todas las líneas por enviar, lo enviado no se mueve). El repositorio carga por `sort_order` y luego por `created_by_at`; las nuevas van al final. La comanda sale en ese orden.
- **Menú por pases** (15/10/2026, migración 0004; regla en `@japp/domain/courses.ts`):
  - `question.course`: NULL pregunta normal; 0 bebida, 1 primero, 2 segundo, 3 postre. La línea guarda `courses` (JSONB) con el estado de cada pase: `pending` (por elegir) → `ready` (elegido) → `held` (en espera) → `fired` (marchado, con `firedAt`). Las respuestas llevan `course` y `question_id`.
  - Al añadir: la bebida es obligatoria; 1.º/2.º/postre se pueden dejar por elegir (`checkAnswers` los salta, `planCourses` crea los estados).
  - Al enviar (`sendWithCourses`): lo elegido sale si es la bebida o si los pases de comida anteriores ya estaban marchados; si no, queda `held`. Un `held` solo sale con `POST …/lines/{id}/fire` («Marchar»). Lo elegido después (`PUT …/answers`) sale en el siguiente envío si toca.
  - Comanda por piezas (`KitchenItem`): cada pase sale por las impresoras de su respuesta (bebida → barra), con `>> BEBIDA` / `>> MARCHA 1.º` / `>> AVISO MENÚ` y notas «2.º POR ELEGIR» / «2.º EN ESPERA: …».
  - No se cobra ni se factura con pases `pending` → `409 COURSE_PENDING`.
  - `POST …/lines/{id}/absorb`: una bebida ya pedida pasa a ser la del pase; se quitan tantas unidades como menús; si estaba enviada queda eliminada con motivo «Incluida en menú» sin clave de encargado y el pase queda `fired`.
  - Las respuestas de una línea se reescriben (DELETE + INSERT en `order_line_modifier`) solo cuando cambian al elegir un pase; nunca en ventas cerradas.
- **Caja principal** (15/10/2026, migración 0008; regla en `@japp/domain/stations.ts`): `station.is_main` (una por tienda; CAJA1) y `user_profile.allowed_stations` (`any` | `main`; el Cajero, `main`). Un perfil `main` solo entra y trabaja en la caja principal: `POST /sessions`, `GET /sessions/current` y el guard de sesión de cada petición → `403 STATION_NOT_ALLOWED` «Este perfil solo puede entrar en la caja principal» (`details {allowed:'main', station}`); se aplica en la siguiente petición si se cambia en Ajustes. Las sesiones devuelven `user.allowedStations` y `station.isMain`. `POST /cash/movements` y `POST /periods/{id}/close` solo desde la principal → `403 MAIN_STATION_REQUIRED` «Solo desde la caja principal»; abrir periodo, desde cualquiera. Otro `POST /periods` con uno abierto → `409 PERIOD_ALREADY_OPEN` (también si salta el único de la base). En Ajustes: `perfiles.allowedStations` y `estaciones.isMain` (al marcar otra, la anterior deja de serlo).
- **Una persona por mesa** (15/10/2026, migración 0008; regla en `@japp/domain/presence.ts` con sus pruebas): `orders.holder_*` y `charging_until`. `POST /orders/{id}/presence {action: enter|renew|leave|charging|chargingEnd}` → `{holder:{userId,userName,stationId,stationName,until}|null, charging, youHold}`; no cambia la versión de la orden.
  - Quien entra tiene la mesa 30 s (`holder_until`), renovables con `renew` o con cualquier comando suyo aceptado.
  - Otra persona dentro: cobro abierto (`charging_until` > ahora) → `409 TABLE_CHARGING` «Se está cobrando esta mesa» (también a un administrador, y aunque su equipo deje de renovar); con `mesas.entrarOcupada` (ADMIN y ADMIN_LOCAL) entra y el otro pasa a solo guardar (evento `tableTakenOver` «Sistemas entra en la mesa; Pedro pasa a solo guardar»); sin él → `409 TABLE_TAKEN` «Mesa ocupada por {nombre} · {estación}» con `details.holder {userName, stationName, until}`.
  - Quien tiene la mesa es la pareja **usuario + equipo** (cambio del product owner, 15/10/2026): el mismo usuario desde otro equipo, con el plazo vivo, cuenta como otra persona (`TABLE_TAKEN` salvo `mesas.entrarOcupada`; `TABLE_CHARGING` mientras se cobra). Renovando nunca se recupera una mesa que tiene otro.
  - `charging` (solo quien la tiene) abre el cobro 60 s, renovable mandándolo otra vez; lo quitan `chargingEnd`, un cobro que deja lo pendiente a 0 y la factura. `leave` suelta mesa y cobro.
  - El equipo desplazado, al volver, lee `GET /orders/{id}`: `status` (`closed` si se facturó todo, `cancelled` si se cerró sin venta) y cada cuenta con `status: invoiced` e `invoice`; `presence` sobre una mesa cerrada → `409 ORDER_CLOSED`.
  - Guardia en `OrdersService.command()`: si hay alguien vivo y no es quien llama (usuario **y** estación) → `409 TABLE_TAKEN` para cualquier comando (25/10/2026: ya no se puede ni añadir ni guardar); solo entran los pedidos de Order on Table. Para entrar: `presence enter` con `takeOver: true` (permiso `mesas.entrarOcupada` o `authorization` de encargado). Sin presencia (nadie o caducada), todo como siempre.
  - `GET /tables`: cada mesa con `holder {userName, stationName} | null` y `charging`.
- **Una sesión activa por usuario** (15/10/2026; regla `assertActiveSession`/`releasesStation` en `@japp/domain/session.ts`): `POST /sessions` sustituye cualquier sesión anterior del mismo usuario (en otro equipo o en el mismo, p. ej. al desbloquear). Con el token anterior, cualquier petición (también `GET /sessions/current`) → `401 SESSION_REPLACED` «Tu clave se ha abierto en {estación}: vuelve a entrar» (`details.station`). Si la anterior era en otro equipo, las mesas que el usuario tenía desde allí quedan libres (holder y cobro) con el evento `tableReleased` «{usuario} ha entrado en {estación}; sale de la mesa». `POST /sessions/authorize` no sustituye la sesión del encargado. La sesión vigente se guarda en la base (`app_session`, migración 0009: id = jti, una con `ended_at` NULL por usuario; la sustituida queda `replaced` con `replaced_by_id`), con una caché de 2 s en el proceso (`Applications/SessionsApplication.ts`); tras reiniciar la API un token sustituido sigue sin valer. `DELETE /sessions/current` la cierra (`logout`): después, `401 BAD_PIN`. Un token sin sesión vigente (salió, o anterior a la 0009) → `401 BAD_PIN`. Abrir el periodo sin `funciones.periodo` (Mesero en la PDA, Cajero): `POST /sessions/authorize` con `funciones.periodo` y `POST /periods {authorization}`; la sesión del encargado sigue intacta. `GET /periods/current` sin periodo → `409 PERIOD_CLOSED`.
- **Línea ya cobrada** (15/10/2026): con cobros, la cuenta no puede quedar por debajo de lo cobrado: eliminar, bajar cantidad, pasar unidades o incluir en menú → `409 TOTAL_BELOW_PAID` «Ya se ha cobrado {pagado} €: no se puede dejar la cuenta por debajo» (`assertTotalCoversPaid` en `totals.ts`). Añadir tras un cobro parcial sí se puede. No hay devoluciones.
- **Cobros** (15/10/2026): `method` = código de cualquier forma de pago de Ajustes (`glovo`, `efectivo2`…); se guarda `payment.payment_method_id` y su `kind` decide el tipo con **una** regla, `paymentKind()` (cash → efectivo, card → tarjeta, el resto —bizum, vales, plataformas— → otros), que usan cobro, repositorio, caja, cierres y transacciones del día. `assertMethodAllowed`: inactiva o desconocida, no configurada en la estación (si la estación tiene alguna en `station_payment_method`) o no tarjeta en la PDA → `409 METHOD_NOT_ALLOWED`. Más de lo pendiente → `409 AMOUNT_EXCEEDS_PENDING` (nunca se recorta); `amount: null` = lo pendiente. Facturar pide `cobro.cobrar` (o `authorization`).
- **IVA cuadrado** (15/10/2026): `accountTotals` redondea el importe con IVA de cada tipo y manda el céntimo que descuadre al tipo más alto; base = importe / (1 + tipo) y cuota = importe − base. Σ (base + cuota) = total de la cuenta siempre (prueba de 0,01 a 14,00 € con 10/21 % y 7 % de descuento). `invoice.tax_base/tax_total` se suman con decimal.js.
- **Idempotency-Key** (15/10/2026, `Helpers/IdempotencyInterceptor.ts` + `Applications/IdempotencyApplication.ts`): la clave se reserva antes de ejecutar (`INSERT … ON CONFLICT DO NOTHING`, `status_code 0` = en curso). Terminada → misma respuesta (`Idempotent-Replayed: true`); en curso → espera hasta 5 s y repite la guardada, o `409 IDEMPOTENCY_IN_PROGRESS`; otro cuerpo → 422; si la acción falla se borra la reserva. Una reserva en curso de más de 120 s (proceso caído) se puede volver a tomar.
- **Arqueo sin cierre** (`POST /cash/counts`, permiso `funciones.caja`, solo caja principal, Idempotency-Key): `{countedCash ≥ 0, detail?: {denominación: unidades enteras} (Σ = countedCash al céntimo, si no 422 en `detail` «El desglose suma X €, no Y €»; «0.5» o «0,50»), note? (≤ 200), authorization?}` → 201 `{id, countedCash, expectedCash, difference, at, by:{user, device}}`. `expectedCash` = fondo + efectivo − retiros + ingresos (la misma `cashState` que el cierre); se guarda como `cash_movement` kind `count` con `counted_detail` y no cambia lo esperado.
- **Impresión después del COMMIT** (15/10/2026): `POST …/send` y `…/fire` guardan primero (líneas enviadas + una fila por línea e impresora en `order_line_printer` con `printed = false`; `printed_at` con `printed = false` = intento en curso, que otro envío no repite durante 60 s; el reintento decide qué falta y lo reserva con la orden bloqueada, así dos reintentos a la vez no imprimen dos veces) e imprimen **sin** tener la fila de la orden bloqueada. Lo que sale se marca `printed = true`. Si una impresora falla → `503 PRINTER_OFFLINE` con `details.printed`: las líneas ya figuran enviadas y lo que no salió queda pendiente en esa impresora; el siguiente `send` (aunque no haya nada nuevo) lo imprime solo ahí y no repite lo que ya salió. La pieza se rehace desde la línea (`kitchenItemOf` en `courses.ts`; `order_line_printer.channel_name` = `CANAL|TAG` para los pases del menú) con sus notas («2.º EN ESPERA: …», «… POR ELEGIR») sacadas del estado de los pases. Precuenta: se guarda y se imprime después; si falla, `503` y se vuelve a pedir. `send` sin nada que enviar ni reimprimir no sube la versión ni escribe en la cola.
- **Anulaciones** (una regla, `voidsOf`/`voidAmount` en `closings.ts`): eliminadas tras enviar (`deleted_stage` printed o preBill), importe con modificadores, sin «Pasada a…» ni «Incluida en menú». La usan Eliminaciones (`stage` real: printed | preBill), el Gestor de cierres y Transacciones del día (`isVoid`).
- **Errores de la base**: interbloqueo (40P01) o fallo de serialización (40001) → `409 BUSY_RETRY` «Otro equipo está cambiando lo mismo: vuelve a intentarlo» (la base deshizo la transacción; repetir es seguro). Orden de bloqueos: carta → PLU → filas; mesa de destino → orden. El filtro global convierte 23505 → `409 DUPLICATE` (o el específico: periodo abierto → `PERIOD_ALREADY_OPEN`, mesa abierta → `TABLE_BUSY`, cuenta facturada → `ACCOUNT_CLOSED`), y 23503/23514/22P02/22007/22008/22003 → `422 VALIDATION`. Los ids de consultas y cuerpos se validan como UUID y las fechas con zod (`GET /invoices?from&to`, `GET /tables?areaId`, `GET /orders?tableId&status`, `reasonId`, `periodId`). Un id de línea ya usado → `409 DUPLICATE`.
- **Ajustes › Facturación**: cambiar una serie crea su fila en `invoice_series` en la misma transacción (la base tiene FK). PLU automático e incidencias de producto: uno a la vez por tienda (`pg_advisory_xact_lock`), sin repetidos con altas a la vez.
- **Mesa en precuenta** (`GET /tables` → `bill`) solo mientras todas las líneas de la cuenta están en precuenta; si se vuelve a marcar, vuelve a `open`.
- **Ajustes por API** (15/10/2026, migración 0005):
  - 19 módulos (`CONFIG_MODULES` en `@japp/domain/config.ts`): restaurante, empresa, facturacion, parametros (un solo registro, id `current`), usuarios, perfiles, areas, mesas, impuestos, categorias, productos, preguntas, canales, impresoras, estaciones, formas-pago, descuentos, motivos y objetivos. Permiso por módulo en `CONFIG_PERMISSION` (áreas/mesas: `mesas.editarPlano`; impuestos, formas de pago y descuentos: `ajustes.facturacion`; objetivos: `ajustes.cierres`).
  - Tabla y columnas salen **solo** de `registry.ts`; el cliente nunca elige identificadores SQL. Cuerpos `strict` (campo desconocido → 422).
  - Cada cambio, en una transacción: `version` del registro (+1, `VERSION_CONFLICT` si no coincide), `store.config_version` (+1, ETag de `GET /config`), `config_change_log` con antes/después y texto legible (`describeDiff`; el PIN sale como «PIN: cambiado»), `sync_outbox` (`entity = 'config'`) y, en productos, `product_incident` para Marketing.
  - Nada se borra: `POST …/deactivate` (o `PATCH active:false`) y `active:true` reactiva. `assertCanDeactivate` decide con recuentos: mesa con cuenta abierta, área con mesas, perfil con usuarios, IVA/categoría/canal/pregunta con productos activos, impresora asignada a una estación, efectivo/tarjeta, tu propio usuario o este equipo → `409 IN_USE`.
  - Usuarios: PIN de 4 números, cifrado con bcrypt, nunca se devuelve y no se repite (`409 DUPLICATE`, `field: "pin"`). Productos: PLU siguiente si no viene, IVA por `taxId` o `taxRate`, canales por id o nombre, botón en `category_product`. Preguntas: respuestas por `productId` o `plu`. Estaciones: `channels` = canal → impresora, formas de pago por id o código.
  - Duplicados de la base (23505) → `409 DUPLICATE`; FK rota → `422 VALIDATION` con el campo. Restaurante, empresa, facturación y parámetros vacían la caché de `StoreApplication`: se aplican en la siguiente petición.
- **Gestor de cierres** (15/10/2026): al cerrar el periodo se escribe `period_summary` en la misma transacción (regla `summarizePeriod` en `@japp/domain/closings.ts`: R1 resta venta y no cuenta ticket; por hora en Madrid; camarero = quien abrió la mesa; anulaciones = borradas tras enviar, sin «Pasada a…» ni «Incluida en menú») y va a la cola como `period.closed`. Día de negocio = fecha de apertura en Madrid. `weeksReport`: semanas ISO, año anterior por semana ISO (53 → 52), proyección = AA × (1 + objetivo de `sales_target`) o importe fijo de la semana; la semana en curso se compara con los mismos días. El periodo abierto se calcula al vuelo con la misma forma.
- **Canales de impresión** (15/10/2026, migración 0006): `print_channel.kind` = `kitchen` (comanda) o `ticket` (precuenta y factura); `printer_id` = impresora por defecto; `copy_of_id` = copia de otro canal de comanda (doble zona: COPIA CONTROL imprime lo mismo que CONTROL en su impresora; un nivel, sin copias de copias). Comanda: canales del producto + sus copias; impresora = la de la estación para ese canal (`station_channel_printer`) o la del canal. Precuenta y factura: canal de tickets del **área** de la mesa (`area.ticket_channel_id`) y su impresora, sea cual sea el TPV o la PDA; si el área no tiene, impresora de tipo ticket y, si no, la primera de la estación. Los productos solo van a canales de comanda que no sean copias.
- **Prueba de impresoras** (15/10/2026): lo que hacía `japp-print-test` ahora es `/printers/*` (permiso `ajustes.impresoras`): vista previa, ping TCP, imprimir ejemplos (test, comanda, menú, precuenta, factura) y estado de todas. Va siempre a la impresora real por TCP aunque `PRINTER_MODE=log`. `parseConnection` acepta `IP`, `IP:puerto` y `tcp://IP:puerto`.
- **Transacciones del día** (15/10/2026, migración 0007): `GET /transactions/day` devuelve una entrada por cuenta (`kind` invoice | credit | open | cancelled) del día de negocio: mesa y quién la abrió, líneas (PLU, nombre, PVP, cantidad, hora, quién la marcó, opciones/pases), eliminaciones con `stage` (`pendingPrint` sin enviar, `printed` impreso, `preBill` precuenta — `order_line.deleted_stage`), quién y quién autorizó, descuentos, cobros (forma de pago, entregado/cambio, quién cobró), factura con IVA, QR y rectificada, e historial de eventos. `POST /sync/transactions` las deja en `sync_outbox` (entity `transaction`, sin duplicar por hash) y, con `MANAGER_URL`, las manda al momento a `POST /api/manager/v1/stores/{storeId}/transactions` con `Authorization: Bearer STORE_KEY` e `Idempotency-Key`.
- La PDA no aplica descuentos.
- En producción se ejecuta con `tsx` (sin compilar), igual que en desarrollo.
- **Un solo contenedor de aplicación**: la API sirve el TPV (`../japp-tpv`, o `TPV_DIR`) en `/` con fallback SPA, así TPV y API comparten origen (sin CORS ni contenido mixto). `/api/*` que no existe responde 404 JSON. `CORS_ORIGINS` (vacío por defecto) solo hace falta para abrir el TPV desde otro origen o desde `file://` (`*`).
- **Swagger** en `/api/v2/docs/` (swagger-ui-dist, sin CDN): barra para entrar con PIN; añade `Authorization: Bearer` e `Idempotency-Key` a cada petición. Acepta `#token=…` (así lo abre el TPV con la sesión ya iniciada). `openapi.json` publica solo las rutas de tienda con `servers: [{url: "/"}]`.
- **Modo conexión del TPV** (Ajustes › Developer › Conexión API, objeto `JAPI` del prototipo): cada `save()` del TPV se compara con la última foto sincronizada y se traduce a comandos de la API en orden (abrir con los mismos ids → transferir → comensales → cuentas → mover → líneas → enviar → precuenta → descuentos → cliente → cobros → factura). Después hace `GET /orders/{id}` y compara totales, IVA, cantidades por estado, borradas y factura; las diferencias salen en el registro. `POST /orders` acepta `accountId`/`accountName` para que la Cuenta 1 tenga el mismo id en ambos lados. No replica todavía: pasar una cuenta a otra mesa ni formas de pago distintas de efectivo/tarjeta. **Ajustes** (v131): `JAPI.cfgView()` pone la configuración del TPV en la forma de `/config/{módulo}`; tras cada `save()` se compara con la última foto y lo distinto se manda en orden de dependencias (alta → `POST`, cambio → `PATCH` con la versión leída, quitado/desactivado → `…/deactivate`). Los ids del TPV se casan con los de la API por clave natural (PLU, nombre, código de perfil o forma de pago, número de mesa, tipo de IVA, año|semana). Lo que devuelve la API se compara con lo enviado; «Comparar Ajustes» revisa los 19 módulos. En productos, `name` es el nombre del ticket y `buttonLabel` el texto de la tecla (`category_product.label`).

## Formato de respuesta (todas, correctas y de error)

```json
{ "title": "Abrir mesa", "type": "success", "status": 201, "data": { …transacción… }, "errors": [],
  "traceId": "8f14e45f-…", "author": "Api Japp Grupo Cañas y Tapas", "mode": "developer" }
```

- `title`: el `summary` del endpoint en `docs/openapi.yaml` (se lee del contrato; si cambias el resumen, cambia el título).
- `type`: `success` | `error`. `status`: el mismo código HTTP. No hay 204: las acciones sin contenido responden 200 con `data: null`.
- `data`: lo que devuelve el controlador. Los controladores devuelven **solo el dato**; `EnvelopeInterceptor` (global, por fuera de la idempotencia) lo envuelve.
- `errors`: `[{ code, message, field, details }]`. Los errores los pone `ErrorsFilter`; `VALIDATION` trae un elemento por campo; en error, `data` es `null`.
- `traceId`: id de la petición; el equipo puede mandar el suyo en `X-Trace-Id` (8–64 caracteres `[\w-]`) y vuelve en la cabecera `X-Trace-Id`. Es el que sale en los logs.
- `author` = `API_AUTHOR` y `mode` = `API_MODE` (`developer` | `production`).
- En el contrato: `components/schemas/Envelope`, `ErrorItem` y `Error`; cada respuesta es `allOf: Envelope` + su `data`. Las pruebas (`call()` en `test/helpers.ts`) validan el sobre entero y devuelven `body` = `data`, `error` = `errors[0]`, `env` = el sobre.

## Cómo es un caso de uso (patrón para todos los comandos)

```ts
// apps/store-api/src/Services/OrdersService.ts (así son todos los comandos; el SQL está en Applications/OrdersApplication.ts)
async addLine(session, orderId, b) {
  return (await this.command(session, orderId, b.version, async (l, ctx, tx) => {
    // command(): withTx → repo.load(…, { lock: true }) (SELECT … FOR UPDATE) → assertVersion → ESTO → repo.save → outbox
    const product = await this.product(tx, session.storeId, b.plu);
    const acc = this.account(l.order, b.accountId);
    const next = addProduct(acc, { product, area: { priceList: l.header.priceList }, ...b }, ctx);   // dominio puro
    return { next: this.replace(l.order, next), events: [this.ev("lineAdded", `Se añade ${product.name}`, ctx, acc.id)] };
  })).transaction;   // JSON Transaction con totales del dominio
}
```

- **Una transacción por comando**: leer, decidir con el dominio, escribir, outbox. El WebSocket se emite después del COMMIT.
- El dominio **no muta**: devuelve objetos nuevos. Recibe `now`, `newId` y `actor` por `Ctx` (nunca `new Date()` ni `Math.random()` dentro).
- El repositorio traduce filas ↔ tipos del dominio. Los `NUMERIC` llegan como `string` desde `pg`: conviértelos al cargar con `Number()` o Decimal, nunca con `parseFloat` en medio de cálculos.

## Reglas no negociables

1. **Totales siempre en el servidor** con `accountTotals()`. Lo que mande el equipo es una pista, nunca la verdad. (El JSON de ejemplo trae `totals: {}`.)
2. **Dinero en `decimal.js`**, redondeo a céntimos mitad hacia arriba (`r2`). Nada de sumar `number` a pelo.
3. **Precio según la zona**: `priceFor()`. El área con `price_list = 'terrace'` usa `price_terrace` si es > 0.
4. **Duplicados**: el mismo producto marcado desde otro equipo (24/10/2026; en el mismo equipo no se avisa) hace menos de `store_parameters.duplicate_minutes` (3) devuelve `409 DUPLICATE_SUSPECTED`; se reenvía con `force: true`.
5. **Borrar líneas**:
   - «Por enviar»: se quita sin más.
   - Enviada: pide `pedido.elimEnviado`. En precuenta: pide `pedido.elimPrecuenta`.

   En los dos últimos casos el motivo es obligatorio, se guarda quién la borró y quién autorizó, y la línea queda con `deleted = true`. **Nunca `DELETE`.**
6. **Permisos**: el código es `módulo.tecla` (`cobro.cobrar`, `ajustes.productos`…), igual en la tabla `permission`, en `@japp/domain` y en `details.permission`. La excepción personal del usuario (`app_user.can_charge`…) manda sobre el perfil. Si falta un permiso, responde `403 PERMISSION_REQUIRED`; el equipo pide la clave de un encargado (`POST /sessions/authorize`) y reenvía con `authorization`. Si el encargado tampoco lo tiene, responde `403 NOT_ALLOWED`.
7. **Cobros**:
   - Se cobra como mucho lo pendiente: más → `409 AMOUNT_EXCEEDS_PENDING` (nunca se recorta); sin importe, lo pendiente.
   - La forma de pago es la de Ajustes (por código), permitida en la estación; su tipo lo da `paymentKind()`.
   - En efectivo, `cashGiven ≥ amount` y se calcula el cambio.
   - Propina solo con tarjeta.
   - Solo cuentan los pagos `confirmed`.
   - Cuando lo pendiente llega a 0, se emite la factura.
8. **Facturas**:
   - El número se reserva con `SELECT … FOR UPDATE` en `invoice_series`, dentro de la misma transacción que inserta `invoice` + `invoice_tax` + `verifactu_record`.
   - Es F1 con datos de cliente (serie F) y F2 sin ellos (serie T).
   - El QR VeriFactu lleva la fecha en hora de **Madrid** (`madridDate`).
   - Las facturas son inmutables; se corrigen con una rectificativa R1.
9. **Concurrencia**: toda escritura sobre una orden lleva `version`. Si no coincide, responde `409 VERSION_CONFLICT` con la transacción actual en el cuerpo.
10. **Idempotencia**: los `POST` que crean (líneas, cobros, facturas, movimientos de caja…) aceptan `Idempotency-Key`. Ante la misma clave, se devuelve la misma respuesta sin repetir la acción. Esto es vital con la PDA en wifi inestable.
11. **Un periodo abierto por tienda**. Sin periodo no se vende: responde `409 PERIOD_CLOSED`.
12. **Fast food** (`store.service_type = 'fastfood'`): al entrar en el TPV (no en la PDA) se abre siempre la orden `FF-<estación>` con PVP general. Nunca se sale de la orden.
13. **Todo por `store_id`**: ninguna consulta sin él. El `store_id` sale del token, nunca del cuerpo.

## Errores

Van en el formato común (ver «Formato de respuesta»): `type: "error"`, `data: null` y `errors: [{ code, message, field, details }]`, con `message` en español para el usuario. Los códigos y sus estados HTTP están en `packages/domain/src/errors.ts` (`HTTP_STATUS`), copiados de `docs/openapi.yaml` (el contrato se genera con `/home/claude/api/regen.sh` desde `api.py` + `gen.py`). El filtro global convierte `DomainError` → HTTP y los errores de datos de PostgreSQL → 409/422 (ver decisiones). Cualquier otra excepción → `500` sin detalles internos, con el log completo y el `traceId`; nunca un 500 por datos del cliente.

## Seguridad

- Secretos **solo en variables de entorno** (`.env.example` lista las que hay). Nunca en el código, los commits, los logs ni el chat.
- PIN con `bcrypt` (coste ≥ 10). Tras `store_parameters.pin_attempts` fallos, responde `423 PIN_LOCKED` durante `pin_lock_seconds`.
- Los tokens de sesión llevan `userId`, `storeId`, `stationId`, `profileId` y caducan. El agente usa `storeKey`.
- Los logs no llevan PIN, tokens, NIF de clientes ni números de tarjeta (solo los 4 últimos).
- Los PIN de prueba del arranque (0186, 5845, 1012, 1111) se cambian antes de producción.

## Pruebas

Tres niveles. Todos con **vitest**:

1. **Dominio** (`packages/domain/test`):
   - Rápidas y sin E/S.
   - Cada regla nueva entra aquí primero, con un caso feliz y los casos de error con su `code`.
   - `golden-orden.test.ts` comprueba que el cálculo coincide con la transacción real de la mesa 12 (74,70 €).
   - Si cambias el comportamiento de una regla existente, cambia la prueba **a propósito** y explica el porqué en el commit.
2. **Integración** (`apps/store-api/test`):
   - Levantan la app Nest con Fastify `inject()` contra una base temporal creada desde `../japp-db` (esquema + datos + migraciones). Helper: `test/helpers.ts` → `setup()`.
   - Comprueban el HTTP (estado, cuerpo) y lo que queda en la base.
   - Obligatorio en cada endpoint: caso feliz, `422 VALIDATION`, permiso, `VERSION_CONFLICT` e idempotencia (misma clave → una sola fila).
3. **Contrato**:
   - `call()` de `test/helpers.ts` valida **cada** respuesta contra `docs/openapi.yaml` (`@japp/contracts` → `contractErrors`, con ajv).
   - Si no cuadra, la prueba falla. Si el contrato está mal, se arregla el YAML y se ejecuta `npm run contracts`.

Al terminar un cambio, la base debe pasar `../japp-db` → `npm run verify` (cuadres de cuentas, cobros, series sin huecos, IVA, borrados con motivo, cadena VeriFactu).

## Comandos

```bash
npm install
npm test                       # dominio (255) + API (264) + agente (14) + Manager de pruebas (6); necesita PostgreSQL y ../japp-db
npm run typecheck
npm run db:init                # crea/actualiza la base de DATABASE_URL (esquema + migraciones; SEED=1 carga la Sucursal Pruebas)
npm run dev                    # API en http://localhost:8080/api/v2 (recarga al guardar)
npm start                      # igual, sin recarga
npm run contracts              # regenera packages/contracts tras cambiar docs/openapi.yaml
npm run db:pull                # regenera el esquema Drizzle desde la base (tras cambios en japp-db)
docker compose up --build -d   # base + API en contenedores (pide SESSION_SECRET en .env). TPV en http://localhost:8080/, Swagger en /api/v2/docs/
```

## Definición de hecho

- `npm test` y `npm run typecheck` en verde.
- Endpoint conforme a `docs/openapi.yaml`.
- La regla nueva vive en `@japp/domain`, con su prueba.
- Pruebas de integración con los casos obligatorios.
- Sin secretos, `store_id` en todas las consultas.
- Commits pequeños y en español: `feat(cobros): …`, `fix(facturas): …`, `test(dominio): …`.

## No hacer

- No usar `DELETE` sobre ventas, `drizzle-kit push`, ni cambios de esquema desde aquí (van en `japp-db`).
- No poner lógica de negocio en controladores ni en repositorios.
- No usar `float` para dinero ni `new Date()` dentro del dominio.
- No mockear la base en las pruebas de integración.
- No inventar endpoints o campos que no estén en el OpenAPI: si falta algo, se propone el cambio del YAML.
- No llamar a la AEAT desde la API de tienda sin decidirlo antes (ver «Pendiente»).

## Pendiente de decidir con Kevin

- Dominios finales del Manager y del Gateway (hoy por defecto `https://japp.grupocyt.com.es/`).
- Quién envía los registros VeriFactu a la AEAT: la tienda o el Manager. La tienda los genera y los encadena siempre.
- El JSON de `deletedLines` en vista-orden no trae motivo ni autorizador; el back sí los guarda y los devuelve.
- Coexistencia con MaxPoint: qué datos se espejan y durante cuánto tiempo.
