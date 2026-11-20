# Pendiente de decidir (negocio)

Preguntas de las pruebas en tienda que aún no tienen respuesta. Hasta decidirlas **no se toca nada** en el TPV ni en la API.
Las peticiones de las pruebas que cambian funcionalidad se aprueban antes de hacerlas.

## Para la reunión con Leslie y Catalina

| # | Pregunta | Origen | Cómo está hoy |
|---|---|---|---|
| 1 | ¿Quién puede marcar un producto como «Agotado»: solo Sistemas o también el Gerente? | Catalina, pruebas 22/10/2026 | Lo hace quien tiene el permiso de Ajustes › Productos | **→ Decidido 20/11 (noche), ver abajo (1)**
| 2 | Al marcar «Agotado», ¿el aviso a Marketing es inmediato o va en el envío diario de incidencias? ¿Cómo se hace el seguimiento? | Catalina, pruebas 22/10/2026 | Queda como incidencia y se envía a Marketing al cerrar el periodo | **→ Decidido 20/11 (noche), ver abajo (1)**
| 3 | ¿El «Agotado» dura solo el día y se reactiva solo al día siguiente, o se puede poner fecha y hora de reactivación? | Catalina, pruebas 22/10/2026 | Se quita a mano | **→ Decidido 20/11 (noche), ver abajo (1)**
| 4 | Activar o desactivar un producto: ¿debe ir a Marketing para validarlo antes, en vez de cambiarse directamente? | Catalina, pruebas 22/10/2026 | Se cambia directamente y se avisa en el envío de incidencias | **→ Decidido 20/11 (noche), ver abajo (2)**
| 5 | El módulo de Incidencias, ¿es un registro informativo o un sistema de solicitudes que Marketing aprueba? | Catalina, pruebas 22/10/2026 | Registro informativo | **→ Decidido 20/11 (noche), ver abajo (3)**
| 6 | Numeración de cuentas: Catalina pide reutilizar los números de las cuentas que se quedan vacías. Que lo explique en la reunión | Catalina, pruebas 26/10/2026 | Los números nunca se repiten (decisión del 23/10/2026; 1.2.196) | **→ Decidido 20/11 (noche), ver abajo (4)**

## De las pruebas internas (tienda montada desde el zip, 27/10/2026)

| # | Tema | Cómo está hoy | Qué hay que decidir |
|---|---|---|---|
| 7 | Plano de mesas de una tienda nueva (datos iniciales JC01) | En la caja solo se ven 2 de las 100 mesas del salón y 2 de las 200 de terraza: las posiciones de los datos iniciales no encajan con el plano del TPV. En la PDA salen todas en lista | ¿Se dibuja un plano por defecto en los datos iniciales (rejilla) o cada tienda coloca sus mesas con «Editar plano» antes de abrir? | **→ Decidido 20/11 (noche), ver abajo (7)**
| 8 | Canales de impresión de la carta | Los primeros y segundos platos del menú tienen canal BEBIDA (salen por barra) y 70 productos activos no tienen canal (no salen en ninguna comanda) | Revisar la carta en el Manager / Ajustes › Productos (es dato, no programa) | **→ Decidido 20/11 (noche), ver abajo (carta)**
| 9 | Calificativos de combinados y bebidas calientes | «CON HIELO», «SIN LIMÓN», «CAMBIO LECHE»… son productos sueltos de 0 €, no opciones del combinado o del café | ¿Pasan a ser preguntas/opciones del producto (como en MaxPoint)? | **→ Decidido 20/11 (noche), ver abajo (5)**
| 10 | Envío de la factura por email | El email del cliente se guarda y es obligatorio en la factura completa | **Decidido el 04/11:** no se envían correos; queda un estado de envío en «no enviada» (ver «Decidido el 04/11/2026 (tarde)») |
| 11 | Corte Z | Lleva ventas por forma de pago y el efectivo esperado, pero no lo contado, la diferencia ni el motivo | ¿Se añaden contado, diferencia y motivo al Z impreso? |

## Pruebas de Catalina del 27/10/2026 (requerimientos, no fallos)

| # | Petición | Cómo está hoy | Qué hay que decidir |
|---|---|---|---|
| 12 | Nombres de los canales de impresión: los acordados (LINEA, CONTROL, BEBIDA, TICKET/FACTURACIÓN) | Los datos iniciales traen TICKET, BEBIDA y COMIDA | ¿Qué canales y con qué nombre se crean en una tienda nueva? (se cambia en los datos iniciales) | **→ Decidido 20/11 (noche), ver abajo (6)**
| 13 | Editar sala: número de mesa nueva secuencial por zona, sin poder pisar una existente | Se escribe el número a mano y avisa si ya existe (desde la 1.2.277 la base nueva trae una sola mesa por sala; las 300 de ejemplo se quitan con `japp-db/sql/limpiar-mesas-ejemplo.sql`) | ¿Se propone solo el siguiente número libre de la zona? | **→ Decidido 20/11 (noche), ver abajo (7)**

## Al diseñar la API de la 1.2.264 (02/11/2026)

Decisiones tomadas para poder dejar el contrato y las tablas listos. **Ya están programadas así en la API 1.2.267**: si se decide otra cosa, se cambia el permiso en Ajustes › Perfiles (15, 16) o una línea en el código (17, 18).

| # | Tema | Cómo queda en el contrato | Qué hay que confirmar |
|---|---|---|---|
| 15 | Resumen de la semana (ventas de la semana contra el año anterior) | Lo ve quien puede ver Informes en Gestiones | ¿Basta con eso, o solo lo ve quien entra al Gestor de cierres (gerentes)? | **→ Decidido 20/11 (noche), ver abajo (8)**
| 16 | Tablero de pedidos de delivery (Glovo, Uber…) | Lo puede abrir cualquier persona (todos los perfiles tienen el permiso) | ¿Cualquiera, o solo cajero y encargado? Se cambia en Ajustes › Accesos sin programar | **→ Decidido 20/11 (noche), ver abajo (9)**
| 17 | Cancelar un pedido de delivery | Hace falta la clave de un encargado y escribir el motivo | ¿Está bien así? ¿Hay que avisar a la plataforma (Glovo, Uber) cuando se cancela? | **→ Decidido 20/11 (noche), ver abajo (10)**
| 18 | Nombre, logo y colores en la pantalla de la clave | Se enseñan antes de que nadie entre (no hace falta clave para verlos) | Confirmar que no es un dato reservado: solo nombre, textos, logo y colores | **→ Decidido 20/11 (noche), ver abajo (11)**

## Decidido el 04/11/2026 (tarde) con el dueño

| # | Tema | Decisión | Estado |
|---|---|---|---|
| 11 | Corte Z | Añadir lo contado, la diferencia y el motivo | **Hecho 1.2.268** (0030: `cash_closing.note`) |
| N7 | Order on Table | Cuenta propia de tipo `order_on_table`, de otro color, que no se bloquea por otra cuenta en cobro | **Hecho 1.2.268** (0030: `account.kind`; si la del cliente se está cobrando, «Order on Table 2»). Queda la prueba de punta a punta (O1–O2) |
| 16 | Tablero de delivery | Solo cajero y encargado (se cambia en Accesos) | **Hecho 1.2.268** (0030) | **→ Decidido 20/11 (noche), ver abajo (9)**
| N3 | Propina | Se admite con **todas** las formas de pago; siempre fuera de la factura y de VeriFactu | **Hecho 1.2.268**: en efectivo lo entregado cubre cuenta + propina y la propina cuenta en el efectivo esperado |
| 4, 6, 15, 17, 18 | Devolución con abono total, números de cuenta que no se repiten, Resumen semana con Informes, cancelar delivery con clave y motivo, Sistema visible antes de entrar | **Se quedan como están** | Cerrado |
| F2 | Corregir la forma de pago de algo ya facturado | **Regla fija: nada de lo facturado se edita.** Se hace un abono completo y se vuelve a ticar y cobrar normal | Cerrado (ya funciona así) |
| F1 | Factura completa después del ticket | Factura completa nueva (F3) que **sustituye** a la simplificada: la simplificada no se edita (queda «sustituida»), no se mueve dinero y no cuenta dos veces en las ventas | **Hecho 1.2.268** (Gestiones › Facturas › «Factura completa»; `POST /invoices/{id}/full`) |
| F3 | Límite de la factura simplificada | **Configurable** por tienda (Ajustes › Facturación), 3.000 € por defecto, 0 = sin límite. Por encima, hacen falta los datos del cliente (422 SIMPLIFIED_LIMIT) | **Hecho 1.2.268** (0030) |
| F4 | Descuento por producto | **No existe:** los descuentos son solo al total de la cuenta (uno por cuenta) | Cerrado (ya funciona así) |
| 1–5, 8, 12, 14 | Agotado, activar o desactivar productos, incidencias, canales de impresión de la carta | **Son configuración** (Ajustes › Productos y Canales): no se programa nada | Cerrado |
| 7, 13 | Plano de una tienda nueva y número de mesa nueva | **Son configuración** (Editar sala: se colocan las mesas y se escribe el número, avisa si ya existe) | Cerrado |
| 9 (calificativos) | «CON HIELO», «SIN LIMÓN»… como productos de 0 € | **Se pueden ticar productos a 0 €** (calificativos, salen en la comanda); lo que no se cobra ni factura es una cuenta a 0 € (409 NOTHING_TO_CHARGE). Rectificado el 04/11 por la noche (antes se bloqueaban) | **Hecho 1.2.268** · pasar los calificativos a opciones es configuración de la carta |
| 9 | Servidor de la tienda caído | Correcto como está: sin servidor no se cobra ni se factura (escrito en el LEEME). Lo de recuperarlo sigue en el Plan de contingencia | Cerrado · contingencia pendiente | **→ Decidido 20/11 (noche), ver abajo (5)**
| 10 | Factura por email | **No se envían correos.** La factura lleva un estado de envío que queda en «no enviada» y ahí termina el flujo | **Hecho 1.2.268** (0030: `invoice.email_status`) |
| N9 | Facturar los pedidos de delivery | **A futuro** (escrito en el LEEME) | A futuro |
| Notas de la mesa | Varias notas, con quién y cuándo | **Varias notas por mesa, con autor, equipo y hora; no se borran** (05/11) | **Hecho 1.2.268** (0032) |
| Historial › Developer | Quién ve la pestaña Developer | **Permiso propio**; por defecto solo el Administrador (05/11) | **Hecho 1.2.268** (0032) |
| Gestiones | Un permiso por botón | **Reparto por rol** del 05/11 (Administrador todo, Encargado todo menos SIR, Cajero lo de caja, Mesero nada) | **Hecho 1.2.268** (0032) |
| Formatos | Corte X, Z y anulación configurables | **Configurables** como la precuenta; el corte con el logo del local (05/11) | **Hecho 1.2.268** (0032) |
| Fast food | Cambiar de usuario sin salir | **Tocar el nombre arriba** abre Cambiar camarero / Cambiar mi clave; el ticket se queda (11/11) | **Hecho 1.2.269** |
| Pruebas 1.2.268 (A1–A10) | Clave, formas de pago, descuentos por perfil, nombre del cliente, comentarios, aviso, cambiar mesa, mesa entera, local en la comanda, plano, semana | **Aprobado el 11/11** | **Hecho 1.2.269** (0033) |
| D1 | Formas de pago de descuento («Influ») | **Salen en Cobrar** y cierran la cuenta sin dinero (11/11) | **Hecho 1.2.269** |
| D2 · Arqueo | Varios datáfonos, resumen impreso, corte X corto, ingresos, fondo del día siguiente, depósito | **Aprobado el 11/11** (sin esperar a la reunión con F. Chirino) | **Hecho 1.2.269** (0033) · revisar con F. Chirino |
| Pantalla | TPV muy anchos o más altos | **Configurable por equipo** en Ajustes › Equipos (solo Administrador y Encargado; sin atajo en el TPV) (11/11) | **Hecho 1.2.269** (0034) |
| Carta del Manager | JSON «Publicación de Carta» en `/config/carta/sync` | **Aprobado el 16/11**: fecha futura se aplica a su hora; retirar lo confirma un encargado; traducciones solo para Order on Table; rejilla de 6 columnas; calificativos del Manager (también PDA); precio de un producto desconocido rechaza la carga | **Hecho 1.2.270** (0035) |
| Canales | Solo COMIDA y BEBIDA | **Los dos del Manager**; se borran los demás canales de comanda y sus copias; los productos sin canal no se mueven (ya vienen del Manager) (16/11) | **Hecho 1.2.270** (0035) · los canales de ticket se quedan |
| Impresión | Que guardar no espere a la impresora | **Cola de impresión** para comandas, anulaciones y cambio de mesa (16/11) | **Hecho 1.2.270** · precuenta, factura y cortes siguen directos |
| Order on Table | Encender / apagar | Interruptor en Ajustes › Restaurante, encendido por defecto (16/11) | **Hecho 1.2.270** |
| Usuarios | Nombre, iniciales y clave | **No se repiten** (16/11) | **Hecho 1.2.270** |
| PDA | Todo se veía pequeño en el móvil | Se probó ajustarla a la pantalla y **se volvió atrás** (16/11 noche: en el iPhone se salía de la pantalla) | Como en la 1.2.269 · pendiente de otra propuesta |
| Logo | Cambiar el logo en todas partes (impresos sobre todo) | OK a los puntos 7–9 (17/11) | **Falta saber qué eran los puntos 7–9** (no están en la conversación guardada) |
| Manager y SIR | SP de facturacionJapp, tablas del SIR | **Lo hacemos luego** (16/11) | En espera |
| Login | «Clave incorrecta» a veces con la clave buena | **El login pregunta siempre a la base de datos** (16/11 noche); «Cambiar mi clave» en el servidor; las personas llegan a todos los equipos | **Hecho 1.2.272** |
| Mesas en servicio | Lectura rápida para el Area Manager | **Dos bloques (en servicio y en precuenta), lo más crítico arriba y tarjeta con lo justo** (17/11) | **Hecho 1.2.274** |
| Apertura | Contar la base al abrir | **Por billetes y monedas**; si no cuadra, motivo (17/11) | **Hecho 1.2.274** (0037) |
| Corte X | Contar en pantalla y no a partir del ticket | **Propinas del sistema con check; efectivo y cada datáfono escritos; ticket corto solo; el detallado en Movimientos** (17/11) | **Hecho 1.2.274** · **Julián debe validar la fórmula** (estándar, ajustable) |
| Auditoría | Separar sus arqueos de la operativa | **Permiso «Arqueo de auditoría»** y apartado «Movimiento de caja – Auditoría» (17/11) | **Hecho 1.2.274** (0037) |
| Retiros | Solo traslado a caja fuerte | **Siempre «Traslado a caja fuerte»**, sin motivo (17/11) | **Hecho 1.2.274** |
| Caja chica | Fondo del gerente aparte | **Fondo fijo de 50 € aparte del cajón, se repone hasta el límite** (17/11) | **Hecho 1.2.274** (0037) |
| Abonos en efectivo | Al abonar una factura cobrada en efectivo, ¿lo devuelto sale del cajón? | **Decidido con el dueño 20/11: sale del cajón** (resta del efectivo esperado) | **Hecho 1.2.292** |
| Diseño de la PDA | Entrar en la PDA como el diseño enviado (17/11) | **Hecho 1.2.275** (PDA, caja, tipo de equipo, reset, bloqueo y letra de base.css), probado en el artefacto | OK del 17/11 |
| Login y configuración | Cada login vuelve a leer configuración y permisos del servidor | OK (17/11): leer antes de entrar; permisos de la API; si el servidor no contesta, copia guardada y aviso | **Hecho 1.2.276** |
| Zoom en el móvil | El doble toque no debe hacer zoom | OK (17/11) | **Hecho 1.2.276** |
| Mesas de ejemplo | 300 mesas que nadie configuró (SALON 100–199, TERRAZA 200–399) | **Una mesa por sala en la base nueva** y script para quitarlas de la actual (17/11) | **Hecho 1.2.278** · ejecutar `limpiar-mesas-ejemplo.sql` en JC01 |
| Equipos por IP | Quitar el UUID, todo por IP | OK (17/11) | **Hecho 1.2.281** (0038) · revisar la IP de cada estación |
| Caja y caja chica | Pestañas, corte X por forma de pago, caja chica con ingresos y foto | OK (17/11) | **Hecho 1.2.281** (0039) |
| Caja por pestañas y teclado | Sin Resumen, teclado siempre abierto y flotante, caja chica eliminable, cortes X no eliminables, imagen de las formas de pago | OK (17/11) | **Hecho 1.2.282** (0040) |
| Caja, Gestiones y KPI pulidos en el artefacto (19/11) | Corte X / cierre por forma de pago, datáfonos, KPI en %, mesas en servicio en rejilla, impresiones con el papel | OK (19/11) | **Hecho 1.2.283** (sin migración) |
| PDA rediseñada en el artefacto (19/11) | Comanda a pantalla completa, separar cuenta, Gestiones al 70 %, cabecera con mis números, cobro 2 por fila | OK (19/11) | **Hecho 1.2.284** (sin migración) |
| Pruebas en JC01 (20/11) | PDA (zoom del plano, teclas, Guardar/Precuenta al plano, precuenta deshecha), caja (corte X a ciegas, retiros, monedas), descuentos por equipo y con formulario | OK (20/11) | **Hecho 1.2.285** |
| Cobrar y pantalla fija (20/11) | Sin «Borrar entregado» ni «Propina», teclado fijo bajo Precuenta; azulejo oscuro alrededor | OK (20/11) | **Hecho 1.2.286** |
| Transferir un producto y Funcionalidades (20/11) | Transferir 1 producto ya enviado a otra mesa (pregunta a qué cuenta); Ajustes › Funcionalidades para activar o desactivar funciones en todo el sistema; «Billete» en Cobrar; papelera en el bloqueo | OK (20/11) | **Hecho 1.2.289** (0042); en la caja web, **1.2.290** |
| Transferir producto: ¿permiso propio? | Hoy usa el mismo permiso que transferir la mesa o una cuenta (Mesas › Transferir); desde la 1.2.291 se puede apagar aparte en Funcionalidades | **Decidido 20/11: sí** | **Hecho 1.2.292** (0043) |
| Funcionalidades: ¿cuáles más? | Hoy se pueden desactivar 14 (Transferir mesa, Transferir producto, Pasar entre cuentas, Separar, Eliminaciones, Descuentos, Datos del cliente, Abonar, Abrir cajón, Caja chica, Pedidos, Editar el plano, Orden de impresión, Mi venta) | **Decidido 20/11: no** (y fuera «Reabrir») | **Hecho 1.2.292** |
| «Cambiar mi clave» en la PDA (20/11) | La foto ahora abre Gestiones: ¿añadir «Cambiar mi clave» dentro de Gestiones? | **Decidido 20/11: sí** | **Hecho 1.2.292** |
| Datos del formulario del descuento en la factura | ¿Imprimir en la factura lo rellenado (nombre, DNI…)? | **Decidido 20/11: se imprime** | **Hecho 1.2.292** (0043) |
| Detalle de una cuenta cobrada en la PDA | ¿Se puede abrir desde el ☰ para ver lo cobrado? | **Decidido 20/11: sí** | **Hecho 1.2.292** («Cuentas cobradas») |
| Cierre: otras formas de pago | En el cierre se escriben los importes de las formas de pago que no son efectivo ni tarjeta, pero la API del cierre solo guarda efectivo y tarjeta | **Decidido 20/11: se guardan todas las formas de pago dadas de alta** | **Hecho 1.2.292** (0043) |
| Caja chica y efectivo del sistema | ¿El dinero de la caja chica sale del mismo cajón? | **Decidido 20/11: no, es de la caja fuerte** (ya era así: no toca el efectivo del cajón) | Sin cambios |
| Hora en la caja | Hora de cada línea en la cuenta de la mesa | OK (17/11) | **Hecho 1.2.280** |
| Comanda de la PDA de lado | La hoja se movía a izquierda y derecha | Arreglado (17/11) | **Hecho 1.2.280** |
| Botones de la PDA | Iconos nuevos en la mesa | OK (17/11) | **Hecho 1.2.279** |
| Comanda de la PDA | Hora por línea, sin camarero ni «Precuenta», precuenta en rojo, quién imprimió solo para encargados | OK (17/11) | **Hecho 1.2.278** |
| Todo en la base | Nada solo en la caché del equipo (p. ej. ancho y alto de la pantalla) | 1.2.281: bloqueo, «Puede cobrar» y permisos sueltos ya se leen de la base. Falta: «Guardar» espere a la API (17/11) | **Decidido 20/11:** Guardar sigue como estaba (sin red, lo ticado va a Reconexiones). Precuenta y cobro sí esperan al servidor y comparan el total (N2b) | **Hecho 1.2.292** |
| Roles y accesos | «Actualiza roles y accesos» (17/11 y 20/11): permisos de lo nuevo | Orden de impresión, Mi venta y Sistema en el corte X; botones nuevos de la PDA con su permiso | **Hecho 1.2.285** (migración 0041) |
| Login de la caja | Texto bajo el logo y marcas | **«Comandero Japp» y la rueda; fuera KFC y CasaRES; vuelve el mundo; tickets con su letra de antes** (17/11). El diseño con foto, logo animado y azulejos con marcas se probó y se descartó | **Hecho 1.2.277** |
| Datáfonos por API | Que el POS mande el importe al datáfono | Mejora futura (17/11) | A futuro · ver con los proveedores |
| Equipos por IP | Reconocer el equipo por su IP si cambia el UUID | **Por IP** (16/11 noche), con la IP del equipo en la pantalla sin alta | **Hecho 1.2.273** · reservar las IP en el router |
| Permisos | «Permisos que no existen» al guardar el perfil Cajero | **«Iniciar el día» pasa a la API** (Cajero y Administrador) (16/11 noche) | **Hecho 1.2.271** (0036) |
| Equipos | El UUID cambiaba al pasar de versión y las estaciones se mezclaban | **UUID en varios sitios del equipo, «¿Qué equipo es este?» con clave de encargado, sin «primera libre», última conexión** (16/11, noche) | **Hecho 1.2.271** (0036) · revisar en JC01 |
| D3 · Menú del día | Guarniciones y fallo «Row# Q» | **No se hace ahora** (11/11) | Fuera |
| D4 · Banners | Continuidad, días de activación y hora «desde/hasta» | **No se hace ahora** (11/11): es del Manager | Fuera |
| C2b y reconexión | Choques con conexión y nuevos desarrollos de reconexión | **En pausa** hasta que el dueño lo analice. Lo hecho en la 1.2.268 se queda | En pausa |

## Decidido el 03/11/2026 con el dueño (hecho en la 1.2.268)

| # | Tema | Decisión |
|---|---|---|
| 19 | Anular un cobro parcial | Hecho: «Anular» en cada cobro mientras la cuenta no está facturada, con motivo obligatorio y clave de encargado. El cobro queda anulado (no se borra). Tarjeta: devolución en el datáfono. Facturada: abono |
| 20 | Cuenta con descuento o cobro parcial | Se entiende que ya se está cobrando (por cuenta, no por mesa): **solo Cobrar, Precuenta y Guardar** activos; todo lo demás desactivado con un aviso. Tampoco se pasan productos a ni desde ella. **Cambiar o juntar mesa sí** (04/11): la cuenta pasa entera y aparte |
| 21 | Reabrir una mesa ya cobrada o cerrada | **Regla fija: nunca.** Tampoco una cerrada sin cobrar. Lo cobrado se corrige con un abono |
| 22 | Cómo se sigue con una cuenta congelada | Anular los cobros (motivo y clave de encargado) y quitar el descuento; entonces todo vuelve a estar activo. Sin «liberar la cuenta» de un paso |
| 23 | Descuento que deja la cuenta a 0 € | Aviso y no se aplica. Para invitar: eliminar con «Invitación» |
| 24 | Facturas: historial y reimprimir | Pestaña «Historial» en Gestiones › Facturas; reimprimir nunca abre el cajón |
| 26 | Propina | Fuera de la factura y de VeriFactu (dato interno). Imprimirla o no: Ajustes › Formatos de ticket › Factura › «Propina» |
| 27 | Cambiar o juntar mesa con cuentas en cobro | Sí (04/11): la cuenta pasa entera, con sus cobros, y llega aparte |
| 25 | Precuenta | Desde la barra: imprime y vuelve a mesas. Desde Cobrar: imprime y sigue en Cobrar. Lleva descuento, lo pagado a cuenta y lo que falta |

## Informe de Catalina «Pruebas POST» (TPV 1.2.267, revisado el 04/11/2026)

Lo ya corregido en la 1.2.268 no se toca (cobro parcial + descuento que bloqueaba la pantalla, descuento tras un cobro parcial, precuenta que vuelve al plano, texto «payOffline»).

**No se hace (se mantiene lo decidido por el dueño el 03/11):** la «Opción 1» de Catalina (con cobro parcial seguir ticando y que solo suba el pendiente; quitar descuento o anular solo con administrador). Sigue la regla: cuenta con descuento o cobro parcial → solo Cobrar, Precuenta y Guardar; para volver a pedir, anular los cobros y quitar el descuento.

### Conexión · definido con el dueño el 04/11/2026 (hecho en la 1.2.268, salvo lo marcado)

**Cuatro casos.** 1–2 · Sin internet: el local trabaja normal porque todo va por la red local (mesas, comandas, impresión, separar, transferir, precuenta, descuentos, efectivo y factura); solo esperan la tarjeta si el datáfono usa internet, los envíos a Japp Manager y a la AEAT (en cola) y los pedidos de delivery. 3 · El equipo pierde el wifi. 4 · Se cae el servidor de la tienda. **Las reglas son solo para los casos 3 y 4.**

| # | Regla o pendiente | Estado |
|---|---|---|
| N8 | Todo lo que se haga en el TPV aplica también a la PDA | Regla |
| 28 | Sin conexión: solo ticar, cambiar de cuenta y corregir lo «por enviar». Mesas libres (azules) en gris: no se abren mesas. Bloqueados Separar, Transferir, Cobrar, Precuenta, Descuento y Eliminar lo enviado (también Order on Table, Marchar, comensales y nota de mesa). Aviso con el motivo: «Este equipo no tiene wifi» o «El servidor de la tienda no responde». Guardar no imprime | **Hecho 1.2.268** (TPV y PDA) |
| C2 | «Reconexiones de la orden» (tabla order_reconnection): lo ticado sin conexión nunca entra directo en la cuenta. Va a una tabla aparte; un encargado valida (pasa a la orden) o descarta con motivo. Permiso configurable en Accesos (sin él, clave de encargado). Con algo pendiente la cuenta no se cobra. Lista en Gestiones › Reconexiones | **Hecho 1.2.268** (migración 0028, API `/reconnections`, TPV y PDA). Los choques con conexión (C2b) y cualquier desarrollo nuevo de reconexión: **en pausa** (04/11) |
| C1 | Aviso informativo «sin internet» (la API dice si tiene internet), sin bloquear nada | **Hecho 1.2.268**: `GET /health` → `internet` (ok/down según la cola hacia el Manager); aviso azul en el TPV y la PDA |
| C3 | Nombre de la tabla: **order_reconnection** | Decidido |
| C4 | Comanda de lo ticado sin conexión: **espera a que lo valide quien tenga el permiso «Resolver reconexiones»** (configurable en Accesos; sin él, clave de encargado). Al validar, sale a cocina | Decidido |
| C5 | Servidor de la tienda caído (caso 4): ver «Plan de contingencia» | Pendiente |
| 29–32 | Descuadres del informe de Catalina (separación perdida, comanda que no sale, producto duplicado, mesas sin salida) | Cubiertos por 28 + C2; repetir su prueba al terminar |

## Plan de contingencia · servidor de la tienda caído (caso 4)

Pendiente de trabajar (decidido el 04/11/2026 dejarlo aparte). Si se apaga o se cuelga el ordenador donde corre la API, todos los equipos quedan sin conexión aunque la red funcione.

| # | Tema | Qué hay que definir |
|---|---|---|
| C5 | Imprimir comandas sin servidor | Marca y modelo de las impresoras: si admiten órdenes web (Epson ePOS-Print, Star WebPRNT) el TPV podría imprimir directo; si no, un programa de impresión en cada caja |
| C6 | Arrancar de nuevo el servidor | Quién lo hace, en cuánto tiempo, SAI (batería) para el ordenador, arranque automático de Docker |
| C7 | Servidor de reserva | ¿Un segundo equipo preparado con copia de la base? ¿Cada cuánto se copia? |
| C8 | Mientras tanto | Hoy aplican las reglas de sin conexión (solo ticar, reconexiones al volver). ¿Hace falta un modo de cobro de emergencia (efectivo apuntado a mano)? |

## Pedidos del cliente · Order on Table

Pendiente de pruebas (decidido el 04/11/2026). Order on Table es configurable y aún no se ha probado a fondo.

| # | Tema | Qué se propone / qué falta |
|---|---|---|
| N7 | Pedido por QR a una mesa con la cuenta en cobro | Que los pedidos del QR vayan a **su propia cuenta**, como una más, pintada de otro color. Las cuentas tendrían un **tipo** (`normal`, `order_on_table`) para darle reglas a cada una |
| O1 | Configuración de Order on Table | Qué se configura (activo por local o por zona, a qué cuenta va, si pide confirmación del camarero) |
| O2 | Pruebas | Probar de punta a punta en JC01 antes de decidir las reglas de cada tipo de cuenta |

## Pendiente con Kevin

| # | Tema | Qué hay que decidir |
|---|---|---|
| K2 | Japp Manager y API Gateway reales | Dominios finales y cómo llega el Manager a cada tienda (VPN, túnel o relé) |
| K4 | Vista de la orden (`deletedLines`) | El JSON no trae motivo ni autorizador; la API sí los guarda |

## A futuro

Se deja para más adelante (decidido el 04/11/2026).

| # | Tema | Cómo está hoy | Qué habrá que decidir |
|---|---|---|---|
| N9 | Facturar los pedidos de delivery | Hoy no generan factura en la tienda | Quién factura, la tienda o la plataforma |
| K1 | Envío de VeriFactu a la AEAT | VeriFactu es configurable (se puede tener apagado). Encendido, la tienda genera y encadena el registro de cada factura con su QR; el envío a la AEAT no está hecho | Quién envía (la tienda o el Manager, con Kevin), cuándo se activa en cada tienda y programar el envío |

## Cobro · decidido el 04/11/2026

| # | Regla | Estado |
|---|---|---|
| N2 | No se cobra si queda un pase del menú por marchar (ya era así: COURSE_PENDING) **ni si hay algo en reconexión** de esa cuenta (409 RECONNECTION_PENDING). «Marchar» sí se puede con la cuenta en cobro (no cambia el importe) | **Hecho 1.2.268** |
| N5 | Nombre de descuento largo en el ticket | **Hecho 1.2.268**: se parte en varias líneas (antes se recortaba), en el servidor y en el TPV |
| N1 | Formatos de ticket (camarero, desglose, por persona, pie…) aplicados también por el servidor | **Hecho 1.2.268** (migración 0029, `store_parameters.ticket_formats`): el TPV guarda Ajustes › Formatos en el servidor y la API imprime precuenta, factura y abono con ellos (también «Abrir el cajón»). En la factura el nombre fiscal y el NIF salen siempre |
| N2b | Revisar a fondo el envío de lo pendiente antes de Precuenta y Cobrar | **Hecho 1.2.292**: el TPV manda el total que ve y el servidor no imprime ni cobra si es otro (409 TOTAL_MISMATCH); pruebas de varias cuentas, descuentos y productos movidos |

## Fidelización

Captar y reconocer a los clientes (nombre, contacto, historial de compras). Sección nueva del 04/11/2026; nace del informe de Catalina (fast food Luma). Nada programado aún.

### Pendiente de fidelización

| # | Petición | Qué hay que definir |
|---|---|---|
| 33 | Pedir el nombre del cliente antes de cada comanda (fidelización) | ¿Obligatorio u opcional? ¿Sale en la comanda y en el ticket? ¿Se guarda en el fichero de clientes? |
| 34 | Revisar cómo captan los datos de fidelización Juan Valdez y llaollao | Qué datos (nombre, teléfono, correo), consentimiento (RGPD) y si se conecta con algún programa de puntos |

## Decidido el 20/11/2026 (noche) con el dueño

| # | Tema | Decisión | Estado |
|---|---|---|---|
| 1 | «Agotado» | Se reactiva solo al día siguiente. No se avisa a nadie desde la tienda: la información sube al Manager con el agente de sincronización | **Hecho 1.2.293** (0044) |
| 2 | Activar o desactivar productos | Directo, sin validar con Marketing; también se reactiva solo al día siguiente y sube al Manager con el agente | **Hecho 1.2.293** (0044) |
| 3 | Incidencias | No es un circuito de aprobación en la tienda: suben al Manager con el agente y allí se gestionan | **Hecho**: ya iban en la cola hacia el Manager; textos del TPV cambiados (1.2.293) |
| 4 | Números de cuenta | No se reutilizan (por el histórico y para evitar fallos): queda como está | Sin cambios |
| 5 | Calificativos | No es tarea: es configurable y viene del Manager | Cerrado |
| 6 | Canales de impresión de una tienda nueva | Cada producto es BEBIDA o COMIDA; dónde imprime cada uno se decide en Ajustes › Áreas de impresión | **Comprobado**: la tienda nueva trae BEBIDA, COMIDA y TICKET |
| 7 | Plano de mesas de una tienda nueva | Cada tienda coloca sus mesas | Sin cambios |
| 8 | Resumen de la semana | Configurable en Perfiles y permisos | Sin cambios |
| 9 | Tablero de delivery | Por defecto solo el Cajero; configurable en Perfiles y permisos | **Hecho 1.2.293** (0044) |
| 10 | Cancelar un delivery | Sí se avisa a la plataforma (Glovo, Uber…) | **Hecho 1.2.293**: el aviso va en la cola hacia el Manager (`delivery.cancelled`); el envío a cada plataforma lo hace su integración |
| 11 | Nombre, logo y colores en la pantalla de la clave | Quitado por el dueño: no hace falta | Cerrado |
| — | Datos de la carta (canales, calificativos) | Vienen del Manager ya configurados | Cerrado |
| — | Canales: qué opción quería mover Catalina | Quitado | Cerrado |
| — | Convivencia con MaxPoint | Quitado: MaxPoint ya no está | Cerrado |
| 12 | Periodos | Solo uno por día: no se abren y cierran varios el mismo día | **Hecho 1.2.293** |
