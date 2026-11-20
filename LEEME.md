# Japp · base de datos + API de tienda + TPV

```
japp-db/          PostgreSQL 16: esquema, datos de arranque, migraciones 0001–0041, consultas de control · 90 pruebas
japp-api/         API de tienda /api/v2 (NestJS + Fastify + Drizzle) · 150 rutas (165 operaciones), todas programadas · 347 pruebas de dominio + 406 de integración
                  + agente de sincronización con Japp Manager (14 pruebas) y un Manager de pruebas (6)
japp-tpv/         el TPV (PWA) 1.2.290 (con modo ?mock). La API lo sirve en http://localhost:8080/
japp-print-test/  la prueba de impresoras antigua (ahora está dentro de la API: /api/v2/printers/*)
```

Las tres carpetas van juntas, una al lado de la otra: la API usa `../japp-db` para crear y migrar la base y `../japp-tpv` para servir el TPV.

**Pendiente de decidir:** ver `PENDIENTE-DE-DECIDIR.md`. **Informes en PDF:** todos en la carpeta `Public/`. **Inventario del sistema:** `Japp-TPV-inventario-360.pdf` (versión 1.2.274). **Reglas de cobro nuevas:** `Japp-reglas-de-cobro-1.2.268.pdf` (checklist). **Lo que falta:** `Japp-flujos-pendientes.pdf` (solo facturación: `Japp-pendientes-facturacion.pdf`). **Lo que hay que probar en JC01:** `Japp-plan-de-pruebas.pdf`.

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

**Pruebas de la 1.2.268 en JC01, aprobado el 11/11 (1.2.269, migraciones 0033 y 0034):**

- **Clave:** el navegador ya no ofrece guardarla ni la rellena sola (el campo ya no es de contraseña); no queda ninguna puesta.
- **Formas de pago:** el código de una nueva sale corto (minúsculas, como mucho 20 caracteres): «Influ» ya no da «String must contain at most 20 character(s)». Las de **tipo descuento** (solo para el SIR, p. ej. «Influ») **salen en Cobrar** si tienen «Mostrar en el TPV»: cierran la cuenta sin dinero (sin propina ni cajón) y van al SIR con su id de integración.
- **Descuentos por perfil:** en Ajustes › Descuentos se marcan los perfiles que lo pueden aplicar (Cajero, Encargado…), para todos los equipos a la vez (`discount.profiles`). Los que eran «Solo encargados» pasan a Administrador y Administrador local; para dárselos al cajero, se marca Cajero. Otro perfil solo con la clave de quien pueda. La lista de cada estación sigue funcionando encima.
- **Fast food:** al ticar el primer producto de un pedido sale «Nombre del cliente» (solo el nombre; «Sin nombre» para seguir). Sale grande en la comanda y como «Cliente: …» en la precuenta y la factura; se cambia con el botón 👤 de arriba. **Cambiar de usuario:** tocar el nombre del local/usuario arriba a la izquierda abre «Cambiar camarero / Cambiar mi clave»; el ticket se queda y lo nuevo va a nombre de quien entra.
- **Comentarios:** el campo crece con el texto (TPV, ventana de preguntas y PDA) y admite hasta 300 caracteres. **Calificativos por categoría:** Ajustes › Categorías › «Calificativos»; sin marcar, salen los de siempre.
- **«Cuenta en cobro»:** el aviso ya no sale en rojo (es informativo, en azul).
- **Cambiar o juntar mesa:** las cuentas con descuento o con cobros **nunca se unen**: llegan como cuenta nueva y la ventana lo dice. Si todas las que pasan están así, ya no pregunta «¿Unir o cuenta nueva?»; solo se unen las que no tienen nada cobrado.
- **Mesa entera eliminada:** si se cierra una mesa sin cobrar nada después de eliminar lo enviado, se pide el motivo (El cliente se fue, Mesa abierta por error, Queja, Invitación u otro). Sale en **Gestiones › Eliminaciones › Mesas enteras** con el importe y quién. «En línea» ya no sale. La API lo exige (`closeReason`; sin él, 422).
- **Comanda y anulación:** llevan el código y el nombre de la tienda (para soporte). En la anulación se quita en Ajustes › Formatos › Anulación › «Tienda».
- **Pantalla de cada equipo** (migración 0034): Ajustes › Equipos › la ficha de la caja (solo Administrador y Encargado): **Automática** (toda la pantalla) o **Tamaño fijo** (ancho × alto en píxeles) y **Escala** de 70 % a 150 % (botones, letras y ventanas). Se ve al momento en el equipo que se está editando y hay «Volver a automático». En pantallas verticales la cuenta va arriba y los productos abajo, a toda la altura. Si algo queda mal, abrir el TPV con `?pantalla=auto` en la dirección. La PDA no cambia.
- **Plano:** «Ya existe la mesa 101» dice en qué área está, y una mesa nueva propone un número libre en todas las áreas.
- **Resumen semana:** las observaciones de días anteriores solo con el permiso «Resumen semana › editar días anteriores» (Administrador y Encargado) o con la clave de quien lo tenga.
- **Arqueo:** Ajustes › Parámetros › «Datáfonos del local»: un campo por datáfono en el arqueo y el cierre (se guarda lo de cada uno). Al guardar el arqueo se imprime su **resumen** (todas las partes del corte y lo contado, con la diferencia de tarjeta) y se puede reimprimir desde Caja › Resumen. El **corte X normal** queda corto: ventas, formas de pago y propinas (lo demás se enciende en Ajustes › Formatos › Corte X).
- **Ingresos a caja:** Caja › Retiro › «Ingreso» (p. ej. +5 € desde la caja fuerte): suma a lo esperado y al fondo de mañana.
- **Cierre de periodo:** el fondo para mañana propuesto es el de hoy − retiros + ingresos; «A depositar = contado − fondo para mañana» lo calcula la API y el corte Z lo dice. **El periodo siguiente abre con ese fondo** (antes, siempre el de Parámetros).
- No se ha tocado: menú del día (guarniciones, fallo «Row# Q») ni banners: son del Manager.

**Decidido el 05/11 (pruebas en JC01, migración 0032):**

- **Notas de la mesa:** se pueden dejar varias; cada una queda con quién la dejó, desde qué equipo y a qué hora. **No se borran ni se cambian** (regla del dueño). Salen arriba en Cuentas, Cambiar mesa, Separar, Cobrar y Descuento (una franja que se despliega). Al juntar mesas llegan las de las dos.
- **Historial de la mesa:** filtros por persona y, si hay más de una cuenta, por cuenta. La pestaña **Developer** solo la ve quien tiene el permiso «Historial › Developer» (por defecto, solo el Administrador; se da en Ajustes › Perfiles).
- **Cobrar y Descuento con tamaño fijo:** añadir el cliente o un descuento no cambia el tamaño; lo que no cabe hace scroll. Debajo del descuento aplicado: «Aplicado por … · hora».
- **Cliente en Cobrar:** tarjeta nueva con el tipo de factura, el nombre, el NIF, la dirección y el email, con «Editar» y «Quitar cliente».
- **Mesa con varias cuentas:** al entrar, primero «¿En qué cuenta continúas?» (ventana grande y fija, con scroll si hay muchas). «¿Qué cambias de mesa?» tiene el mismo diseño de tarjetas.
- **Corte X, corte Z y comanda de anulación** configurables en Ajustes › Formatos, como la precuenta. El corte impreso lleva el **logo del local** y es línea a línea la vista previa (ventas, comensales, ticket medio, venta bruta, IVA y neta, formas de pago, áreas, camareros, descuentos, eliminaciones, abonos, propinas, caja y, en el Z, el arqueo).
- **Gestiones: un permiso por botón** (Ajustes › Perfiles › Gestiones). Reparto inicial: Administrador todo; Encargado (Administrador local) todo menos «Enviar ventas al SIR»; Cajero Facturas, Mesas en servicio, Abrir cajón, Arqueo de caja y Cerrar periodo; Mesero nada. Los perfiles que no son estos cuatro (p. ej. Capitán) siguen viendo lo mismo que antes.

## 1.2.290 (20/11/2026): transferir un producto también en la caja web

**Sin migración** (si vienes de la 1.2.288 o antes, aplica la 0042 de la 1.2.289): parar la API, copiar la carpeta nueva y arrancar; recargar el TPV en cada equipo.

- **Caja (web):** al tocar un producto enviado, el botón azul «⇄ Transferir a otra mesa» sale al lado de «Eliminar». Mismo flujo que en la PDA: cantidad, mesa y, si la mesa tiene varias cuentas, a cuál. Lo ve quien tiene el permiso Mesas › Transferir (Ajustes › Accesos › Perfiles) y desaparece si «Transferir» está apagado en Ajustes › Funcionalidades.

## 1.2.289 (20/11/2026): transferir un producto, Ajustes › Funcionalidades

**Con migración 0042:** parar la API, copiar la carpeta nueva, ejecutar `actualizar-base.bat` (o `npm run db:migrate` en japp-db) y arrancar; recargar el TPV en cada equipo.

- **Transferir 1 producto ya enviado a otra mesa:** en la comanda, deslizar la línea y pulsar ⇄ (azul), elegir la cantidad y la mesa. Si la mesa de destino tiene varias cuentas, pregunta «¿A qué cuenta…?». En la API: `POST …/accounts/{id}/transfer` con `into = main` e `intoAccountId` (la cuenta de destino).
- **Ajustes › Funcionalidades** (en Operación, con el permiso de Parámetros): un interruptor por función (Transferir, Pasar entre cuentas, Separar cuentas, Eliminaciones, Descuentos, Datos del cliente, Reabrir, Abonar facturas, Abrir cajón, Caja chica, Pedidos, Editar el plano, Orden de impresión y Mi venta). Desactivada = nadie la puede usar, ni con la clave de un encargado. Se guarda en `parametros.disabledFeatures` (migración 0042) y la API responde 403 NOT_ALLOWED con `details.feature`. Lo «Por enviar» se puede quitar siempre.
- **Cobrar:** «Entregado» pasa a llamarse «Billete».
- **Pantalla de bloqueo:** la tecla «C» es ahora la papelera.

## 1.2.288 (20/11/2026): bloqueo, abrir el periodo, teclados y cabecera de la PDA

**Sin migración:** parar la API, copiar la carpeta nueva y arrancar; recargar el TPV en cada equipo.

- **Pantalla de bloqueo** (web y PDA): teclas redondas como el login de la PDA.
- **Contar la base** (abrir el periodo): botón «Abrir el periodo» de ancho normal y centrado; sin el nombre del usuario arriba; el aviso «La base contada no cuadra…» se recalcula al contar (si ya cuadra, desaparece con el motivo); el teclado va al lado de los billetes sin tapar el motivo.
- **Teclado general:** se cierra solo al cerrar la ventana, al abrir el periodo o al bloquear; nunca encima de «Japp bloqueado».
- **Caja:** en Retiro parcial y Caja chica el teclado va a la derecha del formulario (Corte X, debajo del botón; Cierre, debajo de las monedas).
- **PDA:** fuera el botón ☰ de la cabecera; tocar la foto abre Gestiones.

## 1.2.287 (20/11/2026): teclado de la caja fijo bajo el botón

**Sin migración:** parar la API, copiar la carpeta nueva y arrancar; recargar el TPV en cada equipo.

- **Caja:** el teclado (números y letras) va fijo justo debajo del botón principal en Corte X, Retiro parcial y Caja chica, con el ancho del botón; en el Cierre, debajo de las monedas. Igual en cualquier ancho de pantalla y con «Tamaño fijo» (antes se salía por la derecha). Solo un teclado a la vez.

## 1.2.286 (20/11/2026): Cobrar con más sitio y teclado fijo · azulejo oscuro en «Tamaño fijo»

**Sin migración** (si vienes de la 1.2.284 o antes, la 0041 de la 1.2.285 se aplica sola): parar la API, copiar la carpeta nueva y arrancar. Después, en cada equipo, recargar el TPV.

- **Cobrar (caja):** fuera «Borrar entregado» y el título «Propina» (los botones de propina se quedan). El teclado queda fijo en la columna izquierda, debajo de «Precuenta», sin «Plegar» ni arrastre.
- **Cierre de periodo:** el teclado queda fijo debajo de las monedas (sin arrastre) y desaparece el aviso «Diferencia … explica la diferencia…» (el botón sigue sin dejar cerrar sin explicarla).
- **Nunca dos teclados a la vez:** si se abría el numérico y el de letras juntos, ahora se queda solo el del campo que tiene el foco.
- **Pantalla de «Tamaño fijo»** (Ajustes › Equipos): alrededor del TPV se ve el azulejo en oscuro en vez de blanco.

## 1.2.285 (20/11/2026): pruebas en la caja y la PDA de JC01 · roles y accesos de lo nuevo

**Con migración 0041** (formulario de los descuentos y 3 permisos nuevos): parar la API, copiar la carpeta nueva y arrancar; las migraciones se aplican solas. Después, en cada equipo, recargar el TPV. Todo probado antes en el artefacto «TPV Japp».

- **PDA · plano:** a tamaño real (como en la web), con scroll horizontal y zoom (pellizcar o − ⤢ +; ⤢ = ver todo). El zoom se recuerda por zona.
- **PDA · pedido:** teclas de producto más anchas y bajas; el detalle de la comanda solo con Guardar (rojo) y Precuenta (morado); la línea que se arrastra se pinta de azul. **Todos los Guardar** (pedido, detalle de la comanda y Separar cuenta) vuelven al plano; **Precuenta** imprime y vuelve al plano. Separar / Recuperar con margen dentro de la tarjeta. Cobrar sin salto de tamaño al elegir.
- **Mesa en precuenta (rojo):** si alguien entra y sale sin cobrar, o marca algo, vuelve a «en uso» (naranja); queda en el historial. En la API: `POST /orders/{id}/accounts/{aid}/prebill/undo`.
- **Caja:** corte X **a ciegas** (sin Propinas ni Sistema; solo Contado) y, si hubo retiros parciales, una línea con lo ya retirado; billetes y monedas compactos (vuelven todas las monedas; fuera el billete de 500 €); teclados sin «Plegar» y quietos donde los dejaste al guardar; Datáfonos solo con «Sistema» y sin «N datáfonos».
- **Cobrar (web/caja):** las formas de pago con o sin imagen, todas iguales y con borde.
- **Sin zoom de pantalla** en todo el TPV (pellizco, doble toque, Ctrl+rueda), salvo el zoom del plano de la PDA.
- **Descuentos:** al cobrar solo salen los **activos en ese equipo** (Ajustes › Equipos); si no tiene ninguno, no sale el botón. Arreglado: el TPV no leía del servidor los descuentos de cada equipo. **«Formulario»** en cada descuento (Ajustes › Facturación › Descuentos): campos a pedir (Texto, Número, Fecha, Teléfono o Email; obligatorio o no). Al aplicarlo se piden; lo rellenado queda en el historial de la cuenta.
- **Roles y accesos** (Ajustes › Perfiles): nuevos «Cambiar el orden de impresión» (Pedido; por defecto quien envía), «Ver mi venta» (Funciones; todos) y «Ver Sistema y Propinas en el corte X» (Funciones; nadie). Los botones nuevos de la PDA (☰ de la mesa, Guardar y Precuenta del detalle, Separar / Recuperar / nueva cuenta) piden su permiso como los de siempre. La API exige `pedido.ordenImpresion` en `…/lines/reorder` y `funciones.miVenta` en `/reports/me`.

**Antes de producción:** marcar en cada equipo los descuentos que deba tener (sin ninguno marcado, ese equipo no ofrece descuentos).

## 1.2.284 (19/11/2026): PDA rediseñada (comanda, separar cuenta, Gestiones), cabecera con mis números, cobro sin parpadeo

**Sin migración:** parar la API, copiar la carpeta nueva y arrancar. Después, en cada equipo, recargar el TPV. Todo probado antes en el artefacto «TPV Japp».

- **Comanda en PDA:** pantalla completa (máx. 560 px) con los botones de la mesa arriba (guardar, comanda, precuenta, cobrar y ☰). «Por enviar» con − / + y marca NUEVO; lo enviado con el canal y el tiempo que lleva. Arrastrar una línea por enviar cambia el orden en que se imprime (la API ya lo guardaba con `POST /orders/{id}/lines/reorder`).
- **Deslizar a la izquierda:** por enviar → comentario; enviado → eliminar (en rojo con letra blanca si ya se imprimió). Se abre en una ventana encima de la comanda. Por enviar, eliminar pide cuántas.
- **☰ de la mesa:** Separar cuenta, Cambiar mesa y Comensales (sin «Nota»). **Separar cuenta** con una tarjeta por cuenta y − / n / +; «Separar» pide a qué cuenta (solo las que hay) y «Recuperar» vuelve a la mesa en esa cuenta. Al guardar o recuperar, las cuentas vacías se eliminan y su historial pasa al de la mesa. **Cambiar mesa:** «Toda la mesa» con la misma tarjeta y las cuentas cobradas visibles pero desactivadas.
- **Cabecera PDA:** ☰ de Gestiones antes del logo (colores invertidos), el logo cambia mi clave, y junto a «Salir» «Venta: € 415 · t. 14 · tk: € 29» del camarero que entra (nuevo `GET /reports/me`, sin permiso de KPI).
- **Gestiones en PDA:** ventanas centradas al 70 % del alto (máx. 560 px de ancho); sin Personal · KPI ni «Cargar ticket de caja chica». Facturas (productos y pagos juntos, Reimprimir/Abonar fijos abajo), Eliminaciones, Venta del día (venta, trans, ticket, proyección y top productos) y Mesas en servicio pensadas para el móvil.
- **Abonar factura:** sin texto ni botón «Emitir abono»: al elegir el motivo (rojo con letra blanca) se emite.
- **Clave del camarero (web y PDA):** teclas redondas más grandes, logo de Japp arriba y «Cambiar camarero / Cambiar mi clave» al final. **Login PDA** con los colores configurados; el color elegido es el principal.
- **Cobrar:** máximo 2 formas de pago por fila (PDA y pantallas estrechas) y sin parpadeo al elegir forma de pago o propina. **Caja:** guardar sin recargar la ventana. **Terraza** sin dorado.

## 1.2.283 (19/11/2026): caja pulida, Gestiones del mismo tamaño, KPI en %, mesas en servicio en rejilla, impresiones con el papel

**Sin migración:** parar la API, copiar la carpeta nueva y arrancar. Después, en cada equipo, recargar el TPV. Todo probado antes en el artefacto «TPV Japp».

- **Corte X:** columnas «Propinas · Sistema · Contado» por forma de pago con su imagen; las de tarjeta van juntas en «Tarjeta» y las que están a 0 no salen (salvo Efectivo); scroll a partir de 4. El botón «Confirmar corte X» sale desactivado si el total es 0 o si la diferencia pasa de 5 € sin comentario. El comentario es una caja de texto y la confirmación enseña solo lo que no es 0, con las imágenes. Los movimientos van debajo del total.
- **Retiro parcial** (antes «Traslado a caja fuerte»): media pantalla, imagen de Efectivo con lo que hay en el cajón, comentario opcional y movimientos debajo del botón.
- **Caja chica:** «Apuntar gasto» primero (importe y después la descripción) e «Ingresar efectivo» segundo; los movimientos de cada sección debajo, con descripción y quién lo hizo.
- **Cierre de periodo:** billetes y monedas más grandes (500, 200, 100, 50, 20, 10, 5, 1 € y 1 cént.); a la derecha las formas de pago como en el corte X (Efectivo sale de lo contado, Tarjeta de los datáfonos, el resto se escribe); la explicación de la diferencia es una caja de texto y, si hay diferencia sin explicación, no se deja poner el fondo ni cerrar.
- **Datáfonos:** la casilla de Tarjeta se abre con doble toque: Datáfono 1, 2… con «+ Añadir», su teclado y «Listo»; arriba Sistema, Propinas y Diferencia.
- **Teclado de la caja:** fijo en su sitio en cada pestaña, se arrastra por la barra y se pliega; el de letras, flotante y centrado. Cerrar la sesión lo quita.
- **Formas de pago:** imágenes siempre de 220 × 56 (botones de Cobrar con esa forma).
- **Gestiones:** todas las ventanas del mismo tamaño. Fuera «Carta del Manager» y «Enviar ventas al SIR».
- **Personal · KPI:** marcador (una fila por persona, notas en % con colores) y ficha con una barra frente a la media del equipo, lo mejor, lo que mejorar y «Explicación de nota».
- **Mesas en servicio:** rejilla de fichas pequeñas (pensada para 50 mesas o más), la más urgente primero; filtros por semáforo, «Todas / En servicio / En precuenta» y zona; al tocar una ficha, el detalle de todos los pasos.
- **Impresiones:** como Facturas: lista a la izquierda (con buscador) y a la derecha el papel que se imprime, el error y Reintentar / Otra impresora / Cancelar. Cancelar pide confirmación («Volver» / «Sí, cancelar»).
- **Facturas:** arriba solo fecha, mesa y quién la cobró; en «Pagos», la imagen de cada forma de pago; el buscador con teclado flotante (ya no pierde el foco).
- **Resumen semana:** sin el texto explicativo; la observación se escribe en una ventana aparte.
- **Venta del día:** escala por hora 0 · 100 · 500 · 1000 · 3000 €; Top productos ordenado por unidades y con las unidades a la vista.
- **Ajustes › Estaciones:** sin la columna «Última conexión».
- **API:** `GET /cash/summary` devuelve `byPayment` (código, tipo, importe, propinas y cobros de cada forma de pago) y `GET /print-jobs` devuelve `text` (el papel en texto).

## 1.2.282 (17/11/2026): caja sin Resumen; teclado siempre abierto; caja chica eliminable; imagen en las formas de pago

**Con migración (0040):** parar la API y ejecutar `actualizar-base.bat` (o `npm run db:migrate` en japp-api). Después, en cada equipo, recargar el TPV. Probado primero en el artefacto «TPV Japp».

**Caja**
- **Sin pestaña «Resumen»:** Corte X · Traslado a caja fuerte · Caja chica · Cierre de periodo. Cada pestaña lleva **sus movimientos debajo**: en Corte X los cortes y arqueos (con «Imprimir»), en Traslado los traslados y en Caja chica sus ingresos y gastos. Al guardar (un traslado, un apunte, un corte) **se queda en la misma pestaña**. Un equipo que no es la caja principal sigue viendo el Resumen (es lo único que tiene).
- **Corte X:** el cuadro de propinas va encima de «Comentario». **Los cortes X no se eliminan** (se quita el botón y la ruta `DELETE /cash/counts/{id}` de la 1.2.281).
- **Caja chica más compacta:** el saldo y «Ingresar efectivo | Apuntar gasto» en una línea; el importe (o descripción e importe) y el botón en otra.
- **Eliminar un apunte de caja chica** (ingreso o gasto), con confirmación (importe, descripción, quién y el saldo que queda). No se borra: queda anulado (migración 0040) y el saldo se recalcula. Si el saldo quedara en negativo (un ingreso que ya se gastó), no se deja. API: `DELETE /api/v2/cash/petty/{id}` (permiso funciones.cajaChica).
- **Teclado de la caja siempre abierto** en todos los formularios: el **numérico flota a la derecha**, debajo del botón principal (Confirmar, Cerrar periodo…); el de **letras flota abajo**. Los dos se **arrastran** desde la barra de arriba (cada equipo recuerda dónde), con doble toque vuelven a su sitio y con «▾ Plegar» quedan como una pastilla abajo a la derecha (se abren tocando la pastilla o un importe). «Listo» confirma el campo sin esconder el teclado.

**Cobrar**
- **Formas de pago de 3 en 3**; con más de 6, dos filas y el resto deslizando de lado (el borde se difumina para indicar que hay más).
- **Imagen del botón** (Ajustes › Formas de pago › Imagen del botón): tamaño **220 × 56** (se guarda a doble resolución, 440 × 112, sin recortar; si la imagen trae un marco de 1–3 px se quita). En Cobrar se ve la imagen en lugar del nombre. Se guarda **en la base** (`payment_method.image`, migración 0040), así la ven todas las cajas y PDAs.

**Además**
- **Venta del día › Venta por hora:** la escala va por tramos fijos, a la misma altura cada uno: 0 · 100 · 500 · 1000 · 2000 · 4000 € (8000… si hace falta).
- **Cola de impresión** con el diseño del resto: pestañas como las de la caja, cada trabajo en una tarjeta y botones redondos con icono (Reintentar, Otra impresora y Cancelar en rojo).

## 1.2.281 (17/11/2026): equipos por IP; caja nueva; caja chica con ingresos y foto del ticket

**Con migración (0038 y 0039):** parar la API y ejecutar `actualizar-base.bat` (o `npm run db:migrate` en japp-api). Después, en cada equipo, recargar el TPV.

**Equipos solo por IP (sin UUID)**
- La API reconoce cada equipo **por su IP**; la caja abierta en el propio servidor (`localhost`) es la caja principal. Vincular un equipo con la clave de un encargado le guarda su IP.
- Migración 0038: fuera la regla «un UUID, una estación» (el aviso «Ese UUID de equipo ya lo tiene otra estación activa») y se vacían los UUID. En Ajustes › Equipos ya no hay campo UUID.
- **Importante:** cada estación tiene que tener bien puesta su **IP** en Ajustes › Equipos (la del móvil o la caja que la usa; mejor con la IP reservada en el router).

**Configuración en todos los equipos**
- El **bloqueo por inactividad** respeta los segundos de cada usuario también en la PDA (manda el valor que da la API al entrar).
- «Puede cobrar», «Puede eliminar enviados» y «Puede eliminar con precuenta» de cada usuario se leen de la base en todos los equipos (antes se quedaban solo en el equipo donde se guardaron). Probado con dos equipos: lo cambiado en uno lo ve el otro en menos de 20 s y nadie lo pisa.

**Caja**
- Pestañas en **una línea**: Resumen · Corte X · Traslado a caja fuerte · Caja chica · Cierre de periodo. Fuera «Movimientos» (va debajo del Resumen) e «Ingreso a caja».
- **Resumen:** propinas aparte («no son venta») y debajo **todos los movimientos** (traslados, cortes, arqueos y caja chica) con botón de **reimprimir**.
- **Corte X:** una fila igual por **cada forma de pago activa** (efectivo primero; una por datáfono si hay varios) y el total contado. Fuera billetes y monedas, la casilla de propinas y «Arqueo de auditoría». Propinas solo informativas.
- **Corte X: guardar e imprimir por separado.** «Confirmar corte X» pide confirmación (con lo escrito en cada forma de pago y el total) y **solo guarda**: no imprime ni abre el ticket. Se imprime desde **Resumen › Movimientos**, con el botón «Imprimir» al final de cada fila.
- ~~**Eliminar un corte X mal escrito**~~ (quitado en la 1.2.282: los cortes X no se eliminan): en Resumen › Movimientos, botón «Eliminar» (pide confirmación). Solo del periodo abierto y no la base del inicio. No se borra: queda anulado (`voided_at`, `voided_by_name`, migración 0039) y deja de salir en los movimientos. API: `DELETE /api/v2/cash/counts/{countId}`.
- **Cierre de periodo:** fuera los textos «según el servidor», «Efectivo esperado = …» y «Contado … − fondo …».
- **Tickets de corte X y Z:** llevan el detalle de los **traslados a caja fuerte** y de la **caja chica** (ingresos, gastos y saldo).
- **Teclado de la caja** más grande, a todo el ancho y debajo del formulario; en los importes, solo números.

**Caja chica** (migración 0039)
- Ya no es un fondo fijo de 50 €: se **ingresa efectivo** (p. ej. 100 € para el día) y se **apuntan gastos** con descripción. El saldo de antes no cambia: el fondo de 50 € queda como un ingreso «Saldo inicial» (no se borra nada).
- **PDA › Gestiones › Cargar ticket de caja chica:** foto del ticket, descripción e importe. En la web el gasto se apunta sin foto; en los movimientos sale la miniatura y al tocarla se ve en grande.

**Cobrar**
- **Formas de pago creadas en el TPV** (por ejemplo «TARJETA GERENTE» o «TO GOOD TO GO»): al cobrar con ellas salía «La API no lo ha aceptado · method: String must contain at most 30 character(s)». El TPV mandaba su identificador interno (36 caracteres) en lugar del código que tiene en la base (`tarjeta-gerente`). Corregido: se manda el código.
- Con muchas formas de pago, los botones ya no se descuadran en filas: son fichas iguales en rejilla (3 por fila en la caja, 2 en la PDA) y la elegida va en color.

**Además**
- **Caja:** el nombre de quien marcó cada línea va debajo del precio, en pequeño (en lugar de la etiqueta de color).
- **PDA:** al tocar el logo de arriba se abren las Gestiones en lista: Facturas, Eliminaciones, Personal · KPI, Mesas en servicio, Venta del día y Cargar ticket de caja chica (cada una con su permiso), adaptadas al móvil.

## 1.2.280 (17/11/2026): hora en cada línea de la caja; la comanda de la PDA quieta

Sin migración (la API solo cambia el número de versión). Probado primero en el artefacto «TPV Japp».

- **Caja › cuenta de la mesa:** debajo del nombre de cada producto sale, en letra pequeña y gris, la hora en que se marcó (también en lo que está por enviar).
- **PDA › Comanda:** la hoja ya no se mueve a izquierda y derecha al deslizar el dedo; solo se desplaza arriba y abajo. La cabecera medía unos píxeles más que la pantalla y dejaba arrastrar la hoja de lado.

## 1.2.279 (17/11/2026): botones de la mesa en la PDA con los iconos nuevos

Sin migración (la API solo cambia el número de versión). Probado primero en el artefacto «TPV Japp».

- **PDA › mesa:** los cinco botones de arriba son los iconos enviados, tal cual y en este orden: **Guardar** (rojo), **Comanda** (azul, con el número de pendientes), **Precuenta** (impresora, morado), **Cobrar** (verde) y **Opciones** (azul). Sin sombras, bordes ni cambios de color: solo un pequeño hundido al pulsar.

## 1.2.278 (17/11/2026): la base manda; comanda de la PDA con hora; una mesa por sala

Sin migración (la API solo cambia el número de versión). La comanda de la PDA se probó primero en el artefacto «TPV Japp».

- **PDA › Comanda:** cada línea lleva la hora en que se marcó. Ya no salen el nombre del camarero ni el texto «Precuenta»: lo que está en precuenta va en **rojo**. Los encargados (permiso «Autorizar») ven además, en pequeño, quién imprimió la precuenta y a qué hora.
- **La base manda:** al leer la configuración (al entrar y cada 15 s), las mesas, salas, estaciones, impuestos y categorías que ya no están en la base desaparecen también de la caja y de la PDA. Antes, una mesa borrada en la base seguía saliendo porque el equipo la tenía guardada.
- **Una mesa por sala:** la base nueva (`SEED=1`, también con `reiniciar-base.bat`, que al final enseña las mesas creadas) arranca con BARRA 1, SALON 100 y TERRAZA 200. Ya no se crean las 300 mesas de ejemplo (SALON 100–199 y TERRAZA 200–399).
- **Quitar las mesas de ejemplo de una base que ya las tiene:** doble clic en **`limpiar-mesas.bat`** (con la API parada; no borra ventas). Ejecuta `japp-db/sql/limpiar-mesas-ejemplo.sql`: enseña cuántas salen, borra las que nunca se usaron, da de baja las que tienen pedidos (no se pierde el historial), deja la 100 y la 200 y sube la versión de la configuración para que todos los equipos lo lean al entrar.

  `psql -d "postgresql://USUARIO:CLAVE@localhost:5432/japp" -f japp-db\sql\limpiar-mesas-ejemplo.sql`

## 1.2.277 (17/11/2026): «Comandero Japp» bajo el logo; fuera KFC y CasaRES

Sin migración (la API solo cambia el número de versión). Probado primero en el artefacto «TPV Japp» y pasado al código con el OK del 17/11.

- **Entrar en la caja:** bajo el logo pone **«Comandero Japp»** y a su lado la rueda; ya no sale «Japp · Versión …» (en catalán «Comander Japp», en inglés «Japp Waiter Pad»).
- **Marcas:** quedan Cañas y Tapas, Las Tapas de Juan y Luma; KFC y CasaRES salen de la lista en todas las pantallas.
- **El mundo** vuelve a salir arriba a la derecha (en la 1.2.276 se había quitado).
- **Tickets en pantalla:** vuelven a su letra de ancho fijo. La letra de base.css (1.2.275) también se aplicaba a la factura, la comanda y demás tickets y descuadraba las columnas (los importes salían fuera de su sitio); ahora no los toca.
- Se probó también un login con foto de la barra, logo animado y fondo de azulejos con marcas; se descartó el 17/11 y no va en esta versión.

## 1.2.276 (17/11/2026): cada login relee configuración y permisos; sin zoom en el móvil

Sin migración (la API solo cambia el número de versión).

- **Cada login** (entrar, cambiar de usuario o desbloquear) lee del servidor la configuración antes de abrir la pantalla: precios, carta, preguntas, formas de pago, descuentos, mesas, impresoras, parámetros… Mientras tanto sale «Cargando la configuración…». Si nada ha cambiado, el servidor contesta al momento sin mandarlo todo. Si no contesta en 6 s, se entra con la copia guardada y sale el aviso «No se pudo leer la configuración del servidor: se usa la guardada en este equipo.»
- **Permisos de la API:** con servidor, lo que puede hacer cada persona sale de la API (su perfil y sus excepciones), no de la copia de los perfiles del equipo. Si se cambia un perfil en otro equipo, a quien está dentro se le aplica en menos de 15 s, sin volver a entrar.
- **Móvil:** el doble toque ya no hace zoom, ni tocar un campo.
- **Entrar en la caja:** sin el mapamundi de arriba a la derecha.
- **Este equipo no está dado de alta:** sin el texto «Ninguna estación tiene…», sin el UUID y sin «¿Qué equipo es este?» (el equipo se reconoce por la IP). «Es la CAJA1 (caja principal)» sigue: con la clave de un administrador entra directo y luego se configura dentro; la ventana de la clave ya no habla del UUID.
- **actualizar-base.bat:** si Windows bloquea `pg_dump.exe` (Device Guard / AppLocker), la copia de seguridad se hace dentro de PostgreSQL con `psql` (base `japp_copia_FECHA`). Hay que cerrar antes la API, el agente y pgAdmin.

## 1.2.275 (17/11/2026): pantallas de entrada con el diseño nuevo

Sin migración. Probado primero en el artefacto «TPV Japp» y pasado al código con el OK del 17/11.

- **Entrar en la PDA** (diseño enviado): logo del local (Ajustes › Restaurante) en un círculo, el local y el equipo con su IP y la rueda de ajustes; «Contraseña» hace de marcador y al teclear se cambia por puntos dorados, uno por número; teclas blancas redondas con sombra (la papelera borra toda la clave, la flecha el último número); «Ingresar» dorado; idiomas ES · CA · EN; abajo «Japp · versión». Sin el aviso «Periodo abierto…»; con el periodo cerrado sí sale el aviso. Se adapta al alto de cada móvil.
- **Entrar en la caja:** sin «Iniciar sesión», sin «Periodo abierto desde las … por …» y sin «Clave de mesero o encargado». Al abrir el periodo («Paso 1 de 2», «No hay periodo abierto», «Clave del encargado») sigue igual.
- **¿Cómo se va a usar este equipo?:** con el estilo nuevo y adaptada al móvil (cabe en una pantalla; en tablet y escritorio, las dos opciones lado a lado). Sin «Ej.: localhost…», sin «Después, elige el tipo de equipo» y sin «Para cambiarlo después…».
- **¿Resetear este equipo?:** un solo aviso, sin explicar el UUID ni el recuadro con dominio, tipo y UUID.
- **Japp bloqueado:** solo «Ingrese su clave para continuar».
- **Letra:** la de base.css en todo el TPV (Helvetica Neue › Helvetica › Arial). Viene de serie en iPhone y Mac; en Windows sale Arial y en Android la del sistema.
- **Modo mock:** en un móvil entra como PDA1 con el periodo abierto (entra Mesero, 1111); «Pasar a móvil» / «Pasar a caja» en la etiqueta MOCK.

## 1.2.274 (17/11/2026): Mesas en servicio y arqueo de caja (reuniones con el Area Manager y con auditoría)

Migración **0037**. Lo pidió Catalina tras las reuniones con Francisco (Area Manager) y Julián (auditoría), para cerrar la versión antes del piloto en LG01 y TJ03.

- **Mesas en servicio** (Gestiones): dos bloques, **«En servicio»** y **«En precuenta»**. En cada bloque, primero las mesas fuera de SLA, luego las cercanas al límite y al final las que van en tiempo; dentro de cada grupo, la que más ha gastado de su límite va arriba, y el orden se recalcula cada 30 s. Cada tarjeta enseña solo la mesa, el camarero, el tiempo grande con su color y la barra; lo demás se abre con un toque. Las medias de hoy y por camarero quedan plegadas abajo.
- **Abrir el periodo:** antes de abrir se **cuenta la base por billetes y monedas**. Si no cuadra con la base del cierre anterior (por encima del umbral), pide el motivo. Queda como movimiento «Base contada al abrir».
- **Caja › Corte X** (nuevo, sustituye a «Arqueo»): se cuenta **en pantalla**. Arriba, las **propinas hasta ahora** (las calcula el sistema; efectivo y tarjeta) con el check **«He visto las propinas»**. Abajo, el efectivo por billetes y monedas y **lo que marca cada datáfono**. Lo que espera el sistema no se ve hasta confirmar. Al confirmar sale solo el **ticket corto** (efectivo contado, esperado y diferencia; cada datáfono y su diferencia; propinas confirmadas y quién). Si la diferencia pasa del umbral, pide el motivo.
- **Fórmula del corte X** (la estándar; Julián puede ajustarla): efectivo esperado = base + ventas en efectivo + propinas en efectivo − traslados a caja fuerte + ingresos. Tarjeta esperada = ventas con tarjeta + propinas con tarjeta. Los traslados ya hechos entran solos. **Abonos:** la API no resta del cajón el dinero devuelto en efectivo (el TPV sin servidor sí): está en `PENDIENTE-DE-DECIDIR.md`.
- **Caja › Movimientos:** dos apartados, **«Movimiento de caja»** (la operativa: base, cortes X, traslados, ingresos) y **«Movimiento de caja – Auditoría»** (los arqueos de auditoría). Cada corte tiene su **ticket detallado** (ventas, formas de pago, descuentos, eliminaciones, abonos, propinas, caja, cada datáfono y la diferencia).
- **Arqueo de auditoría:** el mismo corte X con la casilla «Arqueo de auditoría». Solo con el permiso nuevo **«Arqueo de auditoría»** (por defecto, el Administrador). Va a su apartado y no se mezcla con la operativa.
- **Traslado a caja fuerte:** el retiro es solo eso (ya no se elige motivo). Registra importe, quién lo hace y quién lo autoriza. No es un gasto: sigue en la venta y en el arqueo.
- **Caja › Caja chica** (nueva): fondo fijo del gerente de **50 €** (Ajustes › Parámetros), **aparte del cajón**: no entra en el arqueo, ni en la venta, ni en las propinas. «Apuntar gasto» (importe, en qué se gasta y quién); no deja gastar más del saldo. «Reponer hasta 50 €». Permiso nuevo **«Caja chica»** (Administrador y Administrador local).
- **Probado el 17/11** contra la API real con ventas de prueba (propinas, descuento, eliminación y abono): 49 de 49 comprobaciones bien con Sistemas, cajero, encargado y PDA. Retoques tras las pruebas: el traslado se guarda como «Traslado a caja fuerte» (antes «A caja fuerte»); el ticket dice «Traslados a caja fuerte»; «Ingreso a caja» ya no habla de caja chica; en Mesas en servicio el tiempo va en minutos enteros.
- **A futuro:** datáfonos integrados por API (el POS manda el importe al datáfono). Se verá con los proveedores.

## 1.2.273 (16/11/2026, noche): el equipo se reconoce por su IP

Sin migración.

- Un navegador no puede leer el identificador del dispositivo, y al borrar la caché se crea un UUID nuevo. Por eso ahora la API mira también **la IP desde la que llega el equipo**: si su UUID no está dado de alta y su IP es la de **una sola** estación activa de su tipo (PDA o caja) en Ajustes › Equipos, es esa estación. Se le guarda el UUID nuevo y queda en el historial («Reconocido por su IP …»).
- La pantalla **«Este equipo no está dado de alta»** enseña la **IP del equipo** (con «Copiar IP»): se pone en la estación en Ajustes › Equipos y se pulsa «Volver a comprobar».
- **Hace falta:** cada PDA y cada caja con su IP **reservada en el router** (reserva DHCP) y que lleguen directas al servidor de la tienda (sin proxy ni VPN). Si dos estaciones tienen la misma IP, no se reconoce por IP (sale «¿Qué equipo es este?»).

## 1.2.272 (16/11/2026, noche): la clave la decide siempre la base de datos

Sin migración.

- **«Clave incorrecta» con una clave buena:** cada equipo comprobaba la clave en su propia copia de usuarios antes de preguntar al servidor. Esa copia no tiene las claves de las personas creadas o con la clave cambiada en otro equipo, así que les decía «Clave incorrecta» sin preguntar. Además, «Cambiar mi clave» solo la cambiaba en ese equipo. Ahora, con servidor:
  - **Entrar, desbloquear, cambiar de usuario y la clave de encargado** se comprueban siempre en la API.
  - **«Cambiar mi clave»** se guarda en el servidor (`PUT /api/v2/sessions/current/pin`) y vale en todos los equipos.
  - **Las personas** (sin clave) llegan a todos los equipos con GET /config: una persona creada en la caja puede entrar en la PDA al momento.
  - Si el servidor no responde: «Sin conexión con el servidor: la clave no se puede comprobar», en vez de «Clave incorrecta».
  - **Una clave de encargado mal escrita ya no echa al camarero:** antes el TPV tomaba el «clave incorrecta» del encargado como si la sesión del camarero hubiera caducado.
- Sin servidor configurado (modo demo) sigue como antes.

## 1.2.271 (16/11/2026, noche): el equipo no cambia de estación

Migración **0036** (`actualizar-base.bat`).

- **El UUID del equipo no cambia al pasar de versión.** El TPV nunca lo borraba: se perdía cuando el navegador perdía sus datos o cuando el TPV se abría desde otra dirección (otra IP o nombre, otro puerto, http o https). Ahora se guarda en varios sitios del equipo (preferencias, su propia clave, una cookie de la tienda e IndexedDB) y se pide al navegador que no los borre. Si se pierde uno, se recupera de otro, y nunca se crea uno nuevo mientras quede alguno. Los equipos que ya están configurados copian su UUID a esos sitios al abrir la 1.2.271.
- **«¿Qué equipo es este?»** en la pantalla «Este equipo no está dado de alta»: con la clave de un encargado (permiso de Ajustes › Equipos) se elige su estación y el equipo vuelve a ser esa, sin ir a Ajustes desde otra caja. El equipo que la tenía antes deja de serlo. Queda en el historial de Ajustes (`POST /api/v2/devices/claim`).
- **Ningún equipo se hace pasar por otra estación:** con servidor, un equipo que no se reconoce ya no se pone por su cuenta «la primera PDA libre» o «la primera caja». También se quita `POST /devices/register`, que daba la primera estación libre a cualquier UUID nuevo (el TPV no la usaba).
- **«No s'ha desat al servidor · Perfils i permisos «Cajero»: Permisos que no existen»:** el TPV tiene el permiso «Iniciar el día» (abrir el periodo, del Cajero) y la API no lo conocía. Ahora existe (`funciones.iniciarDia`, migración 0036, para el Cajero y el Administrador) y abrir el periodo vale con él o con «Periodo».
- **PDA:** se vuelve a ver como en la 1.2.269 (lo de hacerla más grande se quitó: en el iPhone se salía de la pantalla).
- **Sin cabecera de estación** la API toma siempre la caja principal (antes «la primera caja» dependía del orden en que la base devolvía las filas).
- **Ajustes › Equipos › Última conexión:** cuándo se identificó o entró por última vez el equipo de cada estación. Así se ve si un equipo lleva tiempo sin conectar o si dos parecen el mismo.
- **Para que no vuelva a pasar:** abrir el TPV siempre desde la misma dirección en cada equipo (la misma IP o el mismo nombre, y el mismo puerto). En el iPhone, instalarlo en la pantalla de inicio: Safari borra los datos de las webs que no se usan en 7 días.

## 1.2.270 (16/11/2026): carta del Manager, canales COMIDA y BEBIDA, cola de impresión

Aprobado el 16/11. Migración **0035** (la aplica `actualizar-base.bat`; hay que pasarla antes de arrancar la API nueva).

- **Carta del Manager** (`POST /api/v2/config/carta/sync` con el JSON «Publicación de Carta»: `release` + `categories`, `products`, `questions`, `keys`). Cuatro tipos: **completa**, **solo precios**, **solo nombres** y **retirar**. Cada carga queda registrada (Gestiones › **Carta del Manager**) con su versión: la misma versión con el mismo contenido no hace nada; con otro contenido o una versión anterior se rechaza (409 VERSION_CONFLICT). Con fecha futura (`effectiveAt`) **se aplica sola a su hora**. **Retirar la carta espera a que un encargado la confirme** (Confirmar / No aplicar). Un precio de un producto que no existe rechaza toda la carga (422 con la fila).
- Lo nuevo de la carta: descripción y traducciones (solo para Order on Table), nombre de la tecla, **teclas en su casilla** (la rejilla sigue de 6 columnas), **calificativos** (`products[].qualifier` y `categories[].qualifiers`, también en la PDA, debajo del comentario), **preguntas obligatorias** con su descripción y tipo (única / múltiple).
- **Canales de comanda: solo COMIDA y BEBIDA**, los que manda el Manager; un producto puede ir a los dos. La 0035 pasa BARRA a BEBIDA, crea COMIDA y **borra los demás canales de comanda y sus copias** (deja un aviso con sus nombres). COMIDA y BEBIDA no se renombran ni se desactivan; su impresora sí se cambia en cada equipo. **Los canales de ticket** (precuenta y factura por área) **se quedan** como estaban.
- **Cola de impresión:** guardar y enviar ya no esperan a la impresora. Las comandas, las anulaciones y el aviso de cambio de mesa van a una cola (`print_job`) que imprime en orden por impresora; si una no responde se reintenta sola (2, 5, 15, 30 y 60 s; a los 5 minutos queda «fallida») y se ve en Gestiones › **Impresiones** con un número en rojo: reintentar, mandarla a otra impresora o cancelar. **La precuenta, la factura y los cortes se siguen imprimiendo al momento**: el cajero necesita saber en el acto si salieron.
- **Order on Table se enciende y se apaga** en Ajustes › Restaurante (encendido por defecto). Apagado: sin botón en la mesa ni QR, sin la opción en Categorías y Productos, y la API no da la carta ni acepta pedidos (409).
- **Usuarios:** ni el nombre, ni las iniciales, ni la clave se repiten (también con los desactivados; TPV y API, 409 DUPLICATE). Las iniciales automáticas se numeran (SR, SR2…). Colores de usuario más vivos, con el nombre en oscuro.
- **Ajustes:** el título, el subtítulo y las pestañas se quedan fijos; solo se desplaza la tarjeta.
- **PDA en el móvil:** se probó hacerla más grande (16/11) y se volvió atrás porque en el iPhone se salía de la pantalla: se ve como en la 1.2.269.

## 1.2.268 (03/11/2026): reglas de descuento, cobro parcial y mesas cerradas

Decididas con el dueño el 03/11 y aplicadas en la API **y** en el TPV (caja y PDA). Detalle con checklist en `Japp-reglas-de-cobro-1.2.268.pdf`.

- **Cuenta con descuento o con un cobro parcial = ya se está cobrando.** Va por cuenta: las otras cuentas de la mesa siguen libres. En el TPV **solo quedan activos Cobrar, Precuenta y Guardar**; todo lo demás sale desactivado (productos, categorías, buscador, líneas, «Cambiar», Eliminar, Separar, Transferir, Order on Table y comensales), con un aviso abajo, en la zona de avisos de la cuenta (desde la 1.2.269, en azul: es informativo). Si en la mesa hay otras cuentas sin cobros, Separar (y cobrar) sigue activo; Transferir, siempre. La nota de la mesa se puede escribir siempre. La API responde `409 ACCOUNT_LOCKED` a todo lo que cambiaría la cuenta. **Cambiar o juntar mesa se puede siempre** (decidido el 04/11): la cuenta en cobro pasa entera, con sus cobros y su descuento, y llega como cuenta aparte (nunca se une a la principal).
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

**Actualizar JC01 a la 1.2.269:** cambian API, TPV **y base (migraciones 0027 a 0034)**: guarda los `.env`, descomprime encima, `npm install`, doble clic en **`actualizar-base.bat`** (copia de seguridad + las migraciones que falten; no borra nada), `docker compose up --build -d` y Ctrl+F5 en todos los equipos a la vez.

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
- **Probar sin base de datos:** abre `http://localhost:8080/?mock`, o el `index.html` suelto añadiendo `?mock`. Entra como CAJA1 (en un móvil, como PDA1; o con `?mock=1&modo=movil`), no llama a la API y guarda en el navegador. La etiqueta «MOCK» de abajo tiene «Pasar a móvil» / «Pasar a caja». En el móvil el periodo se abre solo (en mock no hay otra caja que lo abra); entra con Mesero (1111). Abre el periodo con 1012 y entra con 0186. Se quita con «Salir» en el chip de abajo o con `?mock=0`. Sin `?mock` no hace nada.

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
tienda **JC01 · Nueva Sucursal Japp**, empresa con NIF B12300141, salas BARRA (mesa 1), SALON (mesa 100) y TERRAZA (mesa 200), una mesa por sala, canales BEBIDA (impresora BARRA) y COMIDA (impresora LINEA), y la matriz de permisos (el Cajero ya puede abrir el periodo).
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
