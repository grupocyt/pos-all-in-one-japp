# Pendiente de decidir (negocio)

Preguntas de las pruebas en tienda que aún no tienen respuesta. Hasta decidirlas **no se toca nada** en el TPV ni en la API.
Las peticiones de las pruebas que cambian funcionalidad se aprueban antes de hacerlas.

## Para la reunión con Leslie y Catalina

| # | Pregunta | Origen | Cómo está hoy |
|---|---|---|---|
| 1 | ¿Quién puede marcar un producto como «Agotado»: solo Sistemas o también el Gerente? | Catalina, pruebas 22/10/2026 | Lo hace quien tiene el permiso de Ajustes › Productos |
| 2 | Al marcar «Agotado», ¿el aviso a Marketing es inmediato o va en el envío diario de incidencias? ¿Cómo se hace el seguimiento? | Catalina, pruebas 22/10/2026 | Queda como incidencia y se envía a Marketing al cerrar el periodo |
| 3 | ¿El «Agotado» dura solo el día y se reactiva solo al día siguiente, o se puede poner fecha y hora de reactivación? | Catalina, pruebas 22/10/2026 | Se quita a mano |
| 4 | Activar o desactivar un producto: ¿debe ir a Marketing para validarlo antes, en vez de cambiarse directamente? | Catalina, pruebas 22/10/2026 | Se cambia directamente y se avisa en el envío de incidencias |
| 5 | El módulo de Incidencias, ¿es un registro informativo o un sistema de solicitudes que Marketing aprueba? | Catalina, pruebas 22/10/2026 | Registro informativo |
| 6 | Numeración de cuentas: Catalina pide reutilizar los números de las cuentas que se quedan vacías. Que lo explique en la reunión | Catalina, pruebas 26/10/2026 | Los números nunca se repiten (decisión del 23/10/2026; 1.2.196) |

## De las pruebas internas (tienda montada desde el zip, 27/10/2026)

| # | Tema | Cómo está hoy | Qué hay que decidir |
|---|---|---|---|
| 7 | Plano de mesas de una tienda nueva (datos iniciales JC01) | En la caja solo se ven 2 de las 100 mesas del salón y 2 de las 200 de terraza: las posiciones de los datos iniciales no encajan con el plano del TPV. En la PDA salen todas en lista | ¿Se dibuja un plano por defecto en los datos iniciales (rejilla) o cada tienda coloca sus mesas con «Editar plano» antes de abrir? |
| 8 | Canales de impresión de la carta | Los primeros y segundos platos del menú tienen canal BEBIDA (salen por barra) y 70 productos activos no tienen canal (no salen en ninguna comanda) | Revisar la carta en el Manager / Ajustes › Productos (es dato, no programa) |
| 9 | Calificativos de combinados y bebidas calientes | «CON HIELO», «SIN LIMÓN», «CAMBIO LECHE»… son productos sueltos de 0 €, no opciones del combinado o del café | ¿Pasan a ser preguntas/opciones del producto (como en MaxPoint)? |
| 10 | Envío de la factura por email | El email del cliente se guarda y es obligatorio en la factura completa | **Decidido el 04/11:** no se envían correos; queda un estado de envío en «no enviada» (ver «Decidido el 04/11/2026 (tarde)») |
| 11 | Corte Z | Lleva ventas por forma de pago y el efectivo esperado, pero no lo contado, la diferencia ni el motivo | ¿Se añaden contado, diferencia y motivo al Z impreso? |

## Pruebas de Catalina del 27/10/2026 (requerimientos, no fallos)

| # | Petición | Cómo está hoy | Qué hay que decidir |
|---|---|---|---|
| 12 | Nombres de los canales de impresión: los acordados (LINEA, CONTROL, BEBIDA, TICKET/FACTURACIÓN) | Los datos iniciales traen TICKET, BEBIDA y COMIDA | ¿Qué canales y con qué nombre se crean en una tienda nueva? (se cambia en los datos iniciales) |
| 13 | Editar sala: número de mesa nueva secuencial por zona, sin poder pisar una existente | Se escribe el número a mano y avisa si ya existe (100–199 y 200–399 ya existen aunque no se vean en el plano, ver #7) | ¿Se propone solo el siguiente número libre de la zona? |
| 14 | «En los canales de impresión no es posible desactivar o mover esta opción» | Un canal con productos no se puede desactivar (avisa «en uso») | Aclarar con Catalina qué opción quiere desactivar o mover |

## Al diseñar la API de la 1.2.264 (02/11/2026)

Decisiones tomadas para poder dejar el contrato y las tablas listos. **Ya están programadas así en la API 1.2.267**: si se decide otra cosa, se cambia el permiso en Ajustes › Perfiles (15, 16) o una línea en el código (17, 18).

| # | Tema | Cómo queda en el contrato | Qué hay que confirmar |
|---|---|---|---|
| 15 | Resumen de la semana (ventas de la semana contra el año anterior) | Lo ve quien puede ver Informes en Gestiones | ¿Basta con eso, o solo lo ve quien entra al Gestor de cierres (gerentes)? |
| 16 | Tablero de pedidos de delivery (Glovo, Uber…) | Lo puede abrir cualquier persona (todos los perfiles tienen el permiso) | ¿Cualquiera, o solo cajero y encargado? Se cambia en Ajustes › Accesos sin programar |
| 17 | Cancelar un pedido de delivery | Hace falta la clave de un encargado y escribir el motivo | ¿Está bien así? ¿Hay que avisar a la plataforma (Glovo, Uber) cuando se cancela? |
| 18 | Nombre, logo y colores en la pantalla de la clave | Se enseñan antes de que nadie entre (no hace falta clave para verlos) | Confirmar que no es un dato reservado: solo nombre, textos, logo y colores |

## Decidido el 04/11/2026 (tarde) con el dueño

| # | Tema | Decisión | Estado |
|---|---|---|---|
| 11 | Corte Z | Añadir lo contado, la diferencia y el motivo | **Hecho 1.2.268** (0030: `cash_closing.note`) |
| N7 | Order on Table | Cuenta propia de tipo `order_on_table`, de otro color, que no se bloquea por otra cuenta en cobro | **Hecho 1.2.268** (0030: `account.kind`; si la del cliente se está cobrando, «Order on Table 2»). Queda la prueba de punta a punta (O1–O2) |
| 16 | Tablero de delivery | Solo cajero y encargado (se cambia en Accesos) | **Hecho 1.2.268** (0030) |
| N3 | Propina | Se admite con **todas** las formas de pago; siempre fuera de la factura y de VeriFactu | **Hecho 1.2.268**: en efectivo lo entregado cubre cuenta + propina y la propina cuenta en el efectivo esperado |
| 4, 6, 15, 17, 18 | Devolución con abono total, números de cuenta que no se repiten, Resumen semana con Informes, cancelar delivery con clave y motivo, Sistema visible antes de entrar | **Se quedan como están** | Cerrado |
| F2 | Corregir la forma de pago de algo ya facturado | **Regla fija: nada de lo facturado se edita.** Se hace un abono completo y se vuelve a ticar y cobrar normal | Cerrado (ya funciona así) |
| F1 | Factura completa después del ticket | Factura completa nueva (F3) que **sustituye** a la simplificada: la simplificada no se edita (queda «sustituida»), no se mueve dinero y no cuenta dos veces en las ventas | **Hecho 1.2.268** (Gestiones › Facturas › «Factura completa»; `POST /invoices/{id}/full`) |
| F3 | Límite de la factura simplificada | **Configurable** por tienda (Ajustes › Facturación), 3.000 € por defecto, 0 = sin límite. Por encima, hacen falta los datos del cliente (422 SIMPLIFIED_LIMIT) | **Hecho 1.2.268** (0030) |
| F4 | Descuento por producto | **No existe:** los descuentos son solo al total de la cuenta (uno por cuenta) | Cerrado (ya funciona así) |
| 1–5, 8, 12, 14 | Agotado, activar o desactivar productos, incidencias, canales de impresión de la carta | **Son configuración** (Ajustes › Productos y Canales): no se programa nada | Cerrado |
| 7, 13 | Plano de una tienda nueva y número de mesa nueva | **Son configuración** (Editar sala: se colocan las mesas y se escribe el número, avisa si ya existe) | Cerrado |
| 9 (calificativos) | «CON HIELO», «SIN LIMÓN»… como productos de 0 € | **Se pueden ticar productos a 0 €** (calificativos, salen en la comanda); lo que no se cobra ni factura es una cuenta a 0 € (409 NOTHING_TO_CHARGE). Rectificado el 04/11 por la noche (antes se bloqueaban) | **Hecho 1.2.268** · pasar los calificativos a opciones es configuración de la carta |
| 9 | Servidor de la tienda caído | Correcto como está: sin servidor no se cobra ni se factura (escrito en el LEEME). Lo de recuperarlo sigue en el Plan de contingencia | Cerrado · contingencia pendiente |
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
| Logo | Cambiar el logo en todas partes (impresos sobre todo) | Pendiente de respuesta (puntos 7–9) | Pendiente |
| Manager y SIR | SP de facturacionJapp, tablas del SIR | **Lo hacemos luego** (16/11) | En espera |
| Login | «Clave incorrecta» a veces con la clave buena | **El login pregunta siempre a la base de datos** (16/11 noche); «Cambiar mi clave» en el servidor; las personas llegan a todos los equipos | **Hecho 1.2.272** |
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
| K3 | Convivencia con MaxPoint | Qué datos se espejan y durante cuánto tiempo |
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
| N2b | Revisar a fondo el envío de lo pendiente antes de Precuenta y Cobrar (hoy se manda al servidor y se compara) para que no quede ningún descuadre | Por investigar |

## Fidelización

Captar y reconocer a los clientes (nombre, contacto, historial de compras). Sección nueva del 04/11/2026; nace del informe de Catalina (fast food Luma). Nada programado aún.

### Pendiente de fidelización

| # | Petición | Qué hay que definir |
|---|---|---|
| 33 | Pedir el nombre del cliente antes de cada comanda (fidelización) | ¿Obligatorio u opcional? ¿Sale en la comanda y en el ticket? ¿Se guarda en el fichero de clientes? |
| 34 | Revisar cómo captan los datos de fidelización Juan Valdez y llaollao | Qué datos (nombre, teléfono, correo), consentimiento (RGPD) y si se conecta con algún programa de puntos |
