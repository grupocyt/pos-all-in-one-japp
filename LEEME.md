# Japp · base de datos + API de tienda + TPV

```
japp-db/          PostgreSQL 16: esquema, datos de arranque, migraciones 0001–0026, consultas de control · 76 pruebas
japp-api/         API de tienda /api/v2 (NestJS + Fastify + Drizzle) · 107 endpoints, todos programados · 318 pruebas de dominio + 340 de integración
                  + agente de sincronización con Japp Manager (14 pruebas) y un Manager de pruebas (6)
japp-tpv/         el TPV (PWA) 1.2.268 (con modo ?mock). La API lo sirve en http://localhost:8080/
japp-print-test/  la prueba de impresoras antigua (ahora está dentro de la API: /api/v2/printers/*)
```

Las tres carpetas van juntas, una al lado de la otra: la API usa `../japp-db` para crear y migrar la base y `../japp-tpv` para servir el TPV.

**Pendiente de decidir:** ver `PENDIENTE-DE-DECIDIR.md`. **Inventario del sistema:** `Japp-TPV-inventario-360.pdf` (versión 1.2.268). **Reglas de cobro nuevas:** `Japp-reglas-de-cobro-1.2.268.pdf` (checklist).

## 1.2.268 (03/11/2026): reglas de descuento, cobro parcial y mesas cerradas

Decididas con el dueño el 03/11 y aplicadas en la API **y** en el TPV (caja y PDA). Detalle con checklist en `Japp-reglas-de-cobro-1.2.268.pdf`.

- **Cuenta con descuento o con un cobro parcial = ya se está cobrando.** Va por cuenta: las otras cuentas de la mesa siguen libres. En el TPV **solo quedan activos Cobrar, Precuenta y Guardar**; todo lo demás sale desactivado (productos, categorías, buscador, líneas, «Cambiar», Eliminar, Separar, Transferir, Order on Table, comensales y nota), con un aviso arriba de la cuenta. La API responde `409 ACCOUNT_LOCKED` a todo lo que cambiaría la cuenta.
- **Para volver a pedir:** anular los cobros (Cobrar › «Anular», motivo y clave de encargado) y quitar el descuento. Al quedar sin cobros ni descuento, todo vuelve a estar activo. No hay «liberar la cuenta» de un paso.
- **Anular un cobro** (`POST …/payments/{paymentId}/void`, decisión 19): tarjeta, devolución en el datáfono; ya facturada, abono.
- **Un descuento no puede dejar la cuenta a 0 €**: aviso y no se aplica (para invitar, eliminar con «Invitación»).
- **Regla fija: una mesa cerrada no se reabre nunca** (se haya cobrado o no). «Reabrir mesa» ya no está en Gestiones y `POST /orders/{id}/reopen` responde `409 ORDER_CLOSED`.
- **Gestiones › Facturas:** pestaña nueva «Historial» con todo lo que pasó en la cuenta (productos, descuentos puestos y quitados con quién autorizó, cobros y anulaciones). **Reimprimir ya no abre el cajón.**
- Arreglo: el velo «Enviando al servidor…» ya no se queda encima cuando el cobro se para con un aviso.

**Actualizar JC01 a la 1.2.268:** cambian API y TPV, no hay migraciones nuevas: guarda los `.env`, descomprime encima, `npm install`, `docker compose up --build -d` y Ctrl+F5 en todos los equipos a la vez.

## 1.2.267 (03/11/2026): la API ya tiene todo lo que usa el TPV

Lo que estaba «diseñado, sin programar» ya está programado y probado (el «Siguiente encargo» de `japp-api/CLAUDE.md`, puntos 1–4):

- **Sistema** (`GET /config/sistema` sin sesión y `PUT /config/sistema`): nombre, textos del acceso, logos y colores. El TPV lo guarda en el servidor y la pantalla de clave lo lee antes de entrar.
- **Resumen semana** (`GET /reports/week`, `PUT /reports/week/notes/{date}`): la cuenta va en el dominio (`weekSummary`) y al cerrar el periodo se guarda lo vendido por producto (productos más vendidos y % de mezcla).
- **Delivery**: Ajustes › Pedidos y Motorizados (`/config/pedidos/current`, `/config/motorizados`) y el tablero (`/delivery/orders`: lista, ficha, alta del integrador con la clave de la tienda, siguiente paso y cancelar con clave de encargado). El TPV ya no usa los pedidos de ejemplo cuando hay servidor.
- **Reglas del 28/10 en el servidor**: nombre de persona sin repetir, bloqueo 0 o 10–3600 s, ninguna mesa encima de otra (`TABLE_OVERLAP`), no se cobra un menú con pases por elegir o sin marchar, la cuenta vaciada desaparece al guardar y los clientes se buscan también por correo.
- **PDA**: la comanda abierta se repinta sola cuando la mesa queda retenida tras un corte (salen al momento «Reintentar envío» y «Quedarme con lo del servidor»). Probado en tamaño de móvil junto con el cobro parcial.
- **Tienda nueva**: `04_datos_tienda_inicial.sql` ya da el tablero de pedidos a todos los perfiles (antes una base nueva lo dejaba sin permiso).

**Actualizar la tienda JC01 a la 1.2.267:** ahora cambian la API y el TPV, así que se actualiza todo junto: guarda los `.env`, descomprime encima, doble clic en **`actualizar-base.bat`** (copia de seguridad + migraciones 0023–0026; no borra nada), `docker compose up --build -d` y Ctrl+F5 en cada TPV y PDA (abajo debe poner 1.2.267). El integrador de delivery manda los pedidos a `POST /api/v2/delivery/orders` con `Authorization: Bearer <STORE_KEY>`.

## TPV 1.2.266 (03/11/2026): arreglos de las pruebas en JC01

Dos fallos que dejaban mesas sin poder cobrarse en la 1.2.203 (pruebas del 03/11, mesas 4, 5, 8 y 9):

- **Mesa «Pendiente de revisar» sin salida:** tras un corte con el servidor, si lo pendiente era de la mesa (comensales, cuentas, notas o pases) y no de una línea, no salían «Reintentar envío» ni «Quedarme con lo del servidor». Arreglado en la **1.2.266**: salen debajo de la cuenta y en el aviso al cobrar o pedir la precuenta.
- **Cuenta con un cobro parcial que no se podía terminar** con varias cuentas en la mesa («Separar y cobrar» salía vacío). Arreglado desde la **1.2.259**: la cuenta sale con «Faltan …» y «Cobrar …».

Probado contra la API y PostgreSQL de este zip (tienda JC01): corte simulado, reintento, cobro parcial y cobro de lo que falta.

**Actualizar la tienda JC01:** como la API no cambia, basta con copiar la carpeta `japp-tpv` encima de la del servidor (con Docker, después `docker compose up --build -d`, porque la imagen lleva el TPV dentro) y pulsar **Actualizar** (Ctrl+F5) en cada equipo; abajo debe poner 1.2.266. Opcional: doble clic en **`actualizar-base.bat`** para tener las tablas nuevas (0023–0026): hace una copia en `backups\`, aplica solo las migraciones que falten y no borra ningún dato (`reiniciar-base.bat`, en cambio, borra todo). Las mesas que ya estaban retenidas enseñan ahora los dos botones: «Reintentar envío» y listo.

## TPV 1.2.265 (02/11/2026): qué cambia respecto a la 1.2.203

- `japp-tpv/` trae el TPV **1.2.266** (la 1.2.264 recuperada del artefacto «TPV Japp», la documentación de Administración al día y los arreglos del 03/11). Los cambios están en `CAMBIOS-v204-v268.md`.
- **La base ya está lista:** `japp-db` trae las migraciones **0023–0026** (Sistema, Resumen semana, Delivery y reglas del 28/10) con sus pruebas (76 en verde). `npm run db:init` las aplica sin borrar nada.
- **El contrato ya está listo:** `japp-api/docs/openapi.yaml` y `docs/api-japp.html` (sección «4 · Nuevo en el TPV 1.2.264») traen los 9 endpoints nuevos, los módulos `pedidos` y `motorizados` y las reglas nuevas. Lo mismo en el TPV, en Administración › API backend (29 «nuevos» y 28 que «cambian») y Base de datos (72 tablas).
- **Programado en la 1.2.267** (ver arriba). Antes, Sistema, Delivery y Resumen semana solo guardaban en el equipo.
- **Probar sin base de datos:** abre `http://localhost:8080/?mock`, o el `index.html` suelto añadiendo `?mock`. Entra como CAJA1, no llama a la API y guarda en el navegador. Abre el periodo con 1012 y entra con 0186. Se quita con «Salir» en el chip de abajo o con `?mock=0`. Sin `?mock` no hace nada.

## Opción A · Docker (lo más rápido)

```
cd japp-api
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
echo "DB_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up --build -d
```

- **TPV**: http://localhost:8080/ → PIN 0186. Arriba aparece la etiqueta «API ✓»: cada cambio del TPV se replica en la API y se compara.
- **Ajustes › Developer › API backend**: documentación de la API y pestaña *Conectar y probar* (registro, diferencias y Swagger).
- **Agente de sincronización** (opcional): pon `MANAGER_URL` y `STORE_KEY` en `.env` y `docker compose --profile sync up -d`.
- **Swagger suelto**: http://localhost:8080/api/v2/docs/ (entra con el PIN en la barra de arriba).
- Desde otro equipo de la red: http://<IP del Mac>:8080/

Todas las respuestas de la API tienen el formato `{ title, type, status, data, errors, traceId, author, mode }`.

Tras cambiar código: `docker compose up --build -d` otra vez (la base se conserva).

## Opción B · Node 22 + PostgreSQL 16 en tu equipo

```
cd japp-db  && cp .env.example .env && npm install && npm run db:up && npm test
cd ../japp-api && cp .env.example .env && npm install
#  → en japp-api/.env pon SESSION_SECRET y las URL de la base (las mismas que en japp-db/.env)
npm run db:init
npm test
npm run dev        # también sirve el TPV en http://localhost:8080/
```

## Instalación nueva (base vacía) con los datos de la tienda

Con `SEED=1` la base se crea con la carta y con los datos de la tienda del formulario «Datos iniciales Japp» (`japp-db/sql/04_datos_tienda_inicial.sql`):
tienda **JC01 · Nueva Sucursal Japp**, empresa con NIF B12300141, salas BARRA (mesa 1), SALON (100–199) y TERRAZA (200–399), canales BEBIDA (impresora BARRA) y COMIDA (impresora LINEA), y la matriz de permisos (el Cajero ya puede abrir el periodo).
Usuarios de prueba: Sistemas, Jeison, Barra, Mesero y **Capitan Mesero (PIN 7070)**. **Cambia todos los PIN antes de producción.**
Solo se aplica al crear la base desde cero; una base que ya existe (como la de LG01) no cambia.

## Actualizar una tienda ya instalada a 1.2.203 (sin borrar la base)

La 1.2.203 trae **la migración 0022**: de qué mesa viene una cuenta o un producto al juntar mesas (una columna `origin` en account y otra en order_line). Desde la 1.2.192 está **la migración 0021**: la segunda pantalla del cliente (dos tablas, customer_display y display_media). Los vídeos e imágenes se guardan en disco en `MEDIA_DIR` (en Docker, el volumen `media`; sin Docker, `./data/media` junto a la API). Desde la 1.2.188 están **la 0019 y la 0020**: la URL de la interfaz de ventas al SIR (una columna en store) y, en las formas de pago, «mostrar en el TPV» y el tipo descuento (para el SIR). Desde la 1.2.184 está **la 0018**: el color de cada usuario en el TPV (una columna en app_user, vacía = automático). Desde la 1.2.170 está la **0017**: los SLA de atención (dos tablas nuevas, turnos y límites; la regla de la tienda se crea sola con los tiempos de Parámetros). Si vienes de antes de la 1.2.164, también la **0016** (tiempo de la tanda en Ajustes › Facturación). No borran ni cambian datos y `npm run db:init` las aplica solas. Si vienes de una versión anterior a la 1.2.160, aplica también la 0014 (id de integración de las formas de pago) y la 0015 (incidencias de mesa). No hagas `db:reset`.

**Importante:** la API y el TPV de la 1.2.203 van juntos (separar cuentas y transferir con «unir a la cuenta principal» los hace la API nueva). Actualiza todos los equipos (cajas y PDA) a la vez: con la API nueva, un TPV antiguo ya no puede añadir ni guardar en una mesa que tiene otro equipo.

1. Para la API (Ctrl+C en su ventana, o `docker compose stop api`).
2. Haz copia de tu `.env` de `japp-api` y de `japp-db`. Descomprime el zip encima de la carpeta anterior (el zip no trae `.env`).
3. En `japp-db`: `npm install` (lo necesita `db:init`). En `japp-api`: `npm install` y después `npm run db:init` (aplica las migraciones pendientes: la 0022 y, si faltan, la 0014 a la 0021; no borra nada). Con Docker: `docker compose up --build -d`.
4. Para que la factura, la precuenta y la comanda salgan por papel, en el `.env` de `japp-api` pon `PRINTER_MODE=escpos`.
5. Arranca la API (`npm start`) y en el TPV pulsa **Actualizar** (o Ctrl+F5): abajo debe poner **1.2.266**.
6. Para que lleguen los datos al Manager, arranca también el agente (`npm start -w sync-agent` en otra ventana, o en Docker `--profile sync`).

## Git: un solo repositorio en la carpeta principal

Desde la 1.2.169 todo el proyecto es **un solo repositorio git** en la carpeta principal (`pos-all-in-one-japp`), con un único `.gitignore` en la raíz. Las subcarpetas (`japp-api`, `japp-db`, `japp-print-test`, `japp-tpv`) ya no tienen su propio `.git`; el historial de cada una está dentro del repositorio principal (`git log -- japp-api`).

Si tu copia aún tiene un `.git` en cada subcarpeta, una sola vez:

1. Guarda tus `.env` (`japp-api/.env`, `japp-db/.env`).
2. Borra los `.git` de las subcarpetas y el de la raíz (en Mac, desde la carpeta principal: `rm -rf .git japp-api/.git japp-db/.git japp-print-test/.git japp-tpv/.git`).
3. Descomprime el zip encima: trae el `.git` nuevo de la raíz, con todo el historial. `git status` debe salir limpio.

El `.gitignore` deja fuera `node_modules`, `dist`, `.env` (menos `.env.example`), `preset.js`, las copias `*.sql.gz` y `.DS_Store`.

## Seguir construyendo con Claude Code

Abre `japp-api` en VS Code y pídele a Claude Code: *«Lee CLAUDE.md y haz el Siguiente encargo, punto 1»*.

Los PIN de prueba (0186 Sistemas, 5845 Jeison, 1012 Barra, 1111 Mesero) se cambian antes de producción.
