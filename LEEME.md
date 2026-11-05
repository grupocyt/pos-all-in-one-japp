# Japp · base de datos + API de tienda + TPV

```
japp-db/          PostgreSQL 16: esquema, datos de arranque, migraciones 0001–0032, consultas de control · 82 pruebas
japp-api/         API de tienda /api/v2 (NestJS + Fastify + Drizzle) · 112 endpoints, todos programados · 337 pruebas de dominio + 366 de integración
                  + agente de sincronización con Japp Manager (14 pruebas) y un Manager de pruebas (6)
japp-tpv/         el TPV (PWA) 1.2.268 (con modo ?mock). La API lo sirve en http://localhost:8080/
japp-print-test/  la prueba de impresoras antigua (ahora está dentro de la API: /api/v2/printers/*)
```

Las tres carpetas van juntas, una al lado de la otra: la API usa `../japp-db` para crear y migrar la base y `../japp-tpv` para servir el TPV.

**Pendiente de decidir:** ver `PENDIENTE-DE-DECIDIR.md`. **Informes en PDF:** todos en la carpeta `Public/`. **Inventario del sistema:** `Japp-TPV-inventario-360.pdf` (versión 1.2.268). **Reglas de cobro nuevas:** `Japp-reglas-de-cobro-1.2.268.pdf` (checklist). **Lo que falta:** `Japp-flujos-pendientes.pdf` (solo facturación: `Japp-pendientes-facturacion.pdf`). **Lo que hay que probar en JC01:** `Japp-plan-de-pruebas.pdf`.

## Facturación: lo que queda a futuro y cómo funciona hoy (decidido el 04/11/2026)

- **Servidor de la tienda caído:** mientras la API no responde **no se cobra ni se factura**; los equipos solo pueden ticar en las mesas ya abiertas. Es así a propósito: la numeración y el registro de cada factura los lleva el servidor. Qué hacer para recuperarlo (arranque automático, batería, servidor de reserva) queda en el Plan de contingencia de `PENDIENTE-DE-DECIDIR.md`.
- **Pedidos de delivery (N9):** hoy no generan factura en la tienda. Quién los factura, la tienda o la plataforma (Glovo, Uber…), **se verá a futuro**.
- **Envío de VeriFactu a la AEAT (K1):** VeriFactu es configurable; el envío **se verá a futuro**.
- **Factura por email (10):** **no se envían correos.** El email del cliente se guarda en la factura completa y la factura lleva un estado de envío que queda en «no enviada»; ahí termina el flujo.

**Cierre de la versión de facturación (programado el 04/11/2026, migración 0030):**

- **Factura completa después del ticket (F1):** Gestiones › Facturas › «Factura completa» sobre una simplificada. Se emite una factura completa nueva (tipo F3, serie de completas) con los datos del cliente que **sustituye** a la simplificada: la simplificada no se edita (queda «Sustituida»), no se cobra nada otra vez y en las ventas cuenta una sola vez. Se imprime sin abrir el cajón. Para devolver dinero se abona la completa.
- **Límite de la factura simplificada (F3):** Ajustes › Facturación, **3.000 € por defecto** (lo máximo en hostelería; 0 = sin límite). Por encima, el TPV pide los datos del cliente y la API no deja hacer la simplificada (`422 SIMPLIFIED_LIMIT`).
- **Productos de 0 € (9):** los calificativos de 0 € («con hielo», «sin jamón»…) se tican y salen en la comanda de cocina o barra (rectificado el 04/11 por la noche). Lo que no se cobra ni se factura es una **cuenta a 0 €** (precuenta, cobro y factura → aviso, 409 NOTHING_TO_CHARGE).
- **Propina con todas las formas de pago (N3):** también en efectivo (lo entregado cubre cuenta + propina y el cambio es lo que sobra; esa propina cuenta en el efectivo esperado del cajón). Sigue fuera de la factura y de VeriFactu.
- **Corte Z (11):** lleva lo contado (efectivo y tarjeta), la diferencia y el motivo escrito al cerrar.
- **Order on Table (N7):** los pedidos del cliente van a su propia cuenta (tipo `order_on_table`, en violeta). Si esa cuenta ya se está cobrando, el pedido va a «Order on Table 2» en vez de rechazarse.
- **Tablero de delivery (16):** solo para cajero y encargado (al resto se le quita; se puede volver a dar en Ajustes › Accesos).

**Pruebas en JC01 (04/11, tarde):**

- **Logo en el papel:** la impresora sacaba el logo de la cadena (o ninguno) aunque el local tuviera el suyo. Ahora el TPV prepara el logo de la vista previa (Ajustes › Restaurante) para la impresora y lo guarda en el servidor (migración 0031); la API lo imprime en precuenta, factura, abono y QR de Order on Table. Hace falta abrir el TPV una vez con un usuario que tenga Ajustes › Parámetros (lo sube solo).
- **Pantalla del cliente › «Imprimir ticket»:** solo avisaba en el TPV; ahora imprime la factura de esa cuenta (con servidor la reimprime la API, sin abrir el cajón).
- **Reglas fijas:** nada de lo facturado se edita (para corregir algo, incluida la forma de pago: abono completo y volver a ticar y cobrar); los descuentos son solo al total de la cuenta, uno por cuenta (no hay descuento por producto); una mesa cerrada no se reabre nunca.

**Decidido el 05/11 (pruebas en JC01, migración 0032):**

- **Notas de la mesa:** se pueden dejar varias; cada una queda con quién la dejó, desde qué equipo y a qué hora. **No se borran ni se cambian** (regla del dueño). Salen arriba en Cuentas, Cambiar mesa, Separar, Cobrar y Descuento (una franja que se despliega). Al juntar mesas llegan las de las dos.
- **Historial de la mesa:** filtros por persona y, si hay más de una cuenta, por cuenta. La pestaña **Developer** solo la ve quien tiene el permiso «Historial › Developer» (por defecto, solo el Administrador; se da en Ajustes › Perfiles).
- **Cobrar y Descuento con tamaño fijo:** añadir el cliente o un descuento no cambia el tamaño; lo que no cabe hace scroll. Debajo del descuento aplicado: «Aplicado por … · hora».
- **Cliente en Cobrar:** tarjeta nueva con el tipo de factura, el nombre, el NIF, la dirección y el email, con «Editar» y «Quitar cliente».
- **Mesa con varias cuentas:** al entrar, primero «¿En qué cuenta continúas?» (ventana grande y fija, con scroll si hay muchas). «¿Qué cambias de mesa?» tiene el mismo diseño de tarjetas.
- **Corte X, corte Z y comanda de anulación** configurables en Ajustes › Formatos, como la precuenta. El corte impreso lleva el **logo del local** y es línea a línea la vista previa (ventas, comensales, ticket medio, venta bruta, IVA y neta, formas de pago, áreas, camareros, descuentos, eliminaciones, abonos, propinas, caja y, en el Z, el arqueo).
- **Gestiones: un permiso por botón** (Ajustes › Perfiles › Gestiones). Reparto inicial: Administrador todo; Encargado (Administrador local) todo menos «Enviar ventas al SIR»; Cajero Facturas, Mesas en servicio, Abrir cajón, Arqueo de caja y Cerrar periodo; Mesero nada. Los perfiles que no son estos cuatro (p. ej. Capitán) siguen viendo lo mismo que antes.

## 1.2.268 (03/11/2026): reglas de descuento, cobro parcial y mesas cerradas

Decididas con el dueño el 03/11 y aplicadas en la API **y** en el TPV (caja y PDA). Detalle con checklist en `Japp-reglas-de-cobro-1.2.268.pdf`.

- **Cuenta con descuento o con un cobro parcial = ya se está cobrando.** Va por cuenta: las otras cuentas de la mesa siguen libres. En el TPV **solo quedan activos Cobrar, Precuenta y Guardar**; todo lo demás sale desactivado (productos, categorías, buscador, líneas, «Cambiar», Eliminar, Separar, Transferir, Order on Table y comensales), con un aviso en rojo abajo, en la zona de avisos de la cuenta. Si en la mesa hay otras cuentas sin cobros, Separar (y cobrar) sigue activo; Transferir, siempre. La nota de la mesa se puede escribir siempre. La API responde `409 ACCOUNT_LOCKED` a todo lo que cambiaría la cuenta. **Cambiar o juntar mesa se puede siempre** (decidido el 04/11): la cuenta en cobro pasa entera, con sus cobros y su descuento, y llega como cuenta aparte (nunca se une a la principal).
- **Para volver a pedir:** anular los cobros (Cobrar › «Anular», motivo y clave de encargado) y quitar el descuento. Al quedar sin cobros ni descuento, todo vuelve a estar activo. No hay «liberar la cuenta» de un paso.
- **Anular un cobro** (`POST …/payments/{paymentId}/void`, decisión 19): tarjeta, devolución en el datáfono; ya facturada, abono.
- **Un descuento no puede dejar la cuenta a 0 €**: aviso y no se aplica (para invitar, eliminar con «Invitación»).
- **Regla fija: una mesa cerrada no se reabre nunca** (se haya cobrado o no). «Reabrir mesa» ya no está en Gestiones y `POST /orders/{id}/reopen` responde `409 ORDER_CLOSED`.
- **Gestiones › Facturas:** pestaña nueva «Historial» con todo lo que pasó en la cuenta (productos, descuentos puestos y quitados con quién autorizó, cobros y anulaciones). **Reimprimir ya no abre el cajón.**
- **Precuenta:** desde la barra de la mesa imprime y vuelve al plano de mesas; desde Cobrar imprime y la ventana de Cobrar sigue abierta. El ticket enseña el descuento con su importe y, con un cobro parcial, lo pagado a cuenta y lo que falta (el «por persona» es de lo que falta).
- **Ajustes › Pedidos:** apagar delivery ya no da «No se ha guardado en el servidor Delivery «current»: Este módulo no se desactiva» (se manda como un cambio más).
- **Propina:** nunca forma parte de la factura (ni del total, ni del IVA, ni del registro VeriFactu ni de su QR): es un dato interno de cada cobro. En Ajustes › Formatos de ticket › Factura, la casilla «Propina» decide si se imprime (por defecto, sí); se guarda en el servidor (migración 0027, `store_parameters.print_tip`) y lo respeta también la impresión desde la API.
- **Ajustes › Parámetros:** el bloqueo de 7 s de los datos de arranque no cumplía la regla del 28/10 (0 o 10–3600 s) y la API rechazaba **cualquier** cambio de Parámetros. La migración 0027 lo sube a 10 s.
- Arreglo: el velo «Enviando al servidor…» ya no se queda encima cuando el cobro se para con un aviso.

**Conexión (decidido el 04/11).** Sin internet pero con la red del local (casos 1 y 2) todo sigue igual; solo sale un aviso azul informativo «Sin internet» (`GET /health` → `internet`). Si el equipo pierde el wifi o el servidor de la tienda no responde (casos 3 y 4), en el TPV y en la PDA:

- **No se abren mesas nuevas** (las libres salen en gris). En una mesa abierta solo se tica, se cambia de cuenta y se corrige lo ticado sin conexión. Separar, Transferir, Cobrar, Precuenta, Descuento, Eliminar lo enviado, Order on Table, Marchar, comensales y nota quedan inactivos, con un aviso naranja que dice el motivo («Este equipo no tiene wifi» o «El servidor de la tienda no responde»).
- **Guardar no imprime la comanda**: lo ticado queda en rojo, «sin conexión · por validar».
- **Reconexiones de la orden** (migración 0028, tabla `order_reconnection`): al volver la conexión, lo ticado sin conexión **no entra en la cuenta**: sale en rojo dentro de la cuenta y en Gestiones › Reconexiones. Quien tenga «Resolver reconexiones» (Ajustes › Accesos; por defecto quien puede autorizar; sin él, con la clave de un encargado) lo **valida** —entra en la cuenta y sale la comanda— o lo **descarta** con motivo. **Mientras haya algo pendiente, esa cuenta no se cobra** (`409 RECONNECTION_PENDING`). Queda guardado quién lo marcó, en qué equipo, cuándo, por qué no había conexión y quién decidió.
- Con la cuenta en cobro ya se puede **marchar un pase** (no cambia el importe).
- Ticket: el nombre de un descuento largo se parte en varias líneas (antes se recortaba).
- **Formatos de ticket en el servidor** (N1, migración 0029): lo que se marca en Ajustes › Formatos de ticket para la precuenta y la factura (logo, cadena, local, razón social, NIF, dirección, teléfono, camarero, desglose de IVA, por persona, pie, despedida, QR de reseñas, QR tributario, abrir el cajón y propina) se guarda en el servidor, lo ven todos los equipos y la API imprime con ello. En la factura el nombre fiscal y el NIF salen siempre.

**Actualizar JC01 a la 1.2.268:** cambian API, TPV **y base (migraciones 0027 a 0032)**: guarda los `.env`, descomprime encima, `npm install`, doble clic en **`actualizar-base.bat`** (copia de seguridad + 0027 a 0031; no borra nada), `docker compose up --build -d` y Ctrl+F5 en todos los equipos a la vez.

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
