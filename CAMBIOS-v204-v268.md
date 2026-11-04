# Cambios del TPV · de la 1.2.203 (zip del 27/10) a la 1.2.264 (artefacto «TPV Japp»)

Sacado de las notas de versión que lleva dentro el propio TPV (artefacto «TPV Japp», versión publicada a 02/11/2026).
Las notas no llevan fecha, salvo las del 28/10, así que no se puede saber con exactitud cuáles son de las últimas 24 horas. Aquí van **todas las posteriores al zip**.

El TPV de la v264 ya va construido en `japp-tpv/`. Lo que necesita también la **API o la base** está marcado con 🔧. **Estado al 02/11/2026:** tablas hechas (migraciones 0023–0026 en `japp-db`, con pruebas) y contrato hecho (`japp-api/docs/openapi.yaml`); falta programarlo en la API (`japp-api/CLAUDE.md` › «Siguiente encargo»).

---

## 1 · Necesita API o base de datos 🔧

| Versión | Qué | Qué falta en el back |
|---|---|---|
| v206 | Ajustes › **Administración › Sistema**: nombre, subtítulo, logo, icono «Sin imagen», paletas de color por usuario y colores del sistema. «Se guarda en el servidor y lo ven todos los equipos». | Tabla `system_branding` (**0023**, hecha) · `GET/PUT /config/sistema` en el contrato, sin programar. |
| v207 | Administración › API backend › Documentación: «Probar sin servidor» (mock) en cada endpoint con las respuestas del contrato, y «Copiar curl». | Nada; solo usa el contrato. |
| v217–v233, v264 | **Delivery / Pedidos**: tablero de pedidos (medio, transacción, cliente, motorizado, estado, semáforo, espera), estados con colores que filtran la tabla, Ajustes › Pedidos › Delivery (integrador, plataformas, tiempos, aceptar solos, motorizados) e interruptor «Delivery en este local». | Tablas `delivery_*` (**0025**, hechas) · `/delivery/orders…`, módulos `pedidos` y `motorizados` en el contrato, sin programar. |
| v259 | Pruebas del 28/10 (Catalina): la precuenta se imprime cada vez que se pide; la cuenta vacía desaparece al guardar; Separar enseña también las cuentas con cobro parcial; no se elimina por debajo de lo cobrado; una mesa nueva sin nada se cierra al Guardar aunque la red vaya lenta; pasar una sola cuenta a otra mesa ya deja elegir mesa; fast food sin «No cuadra»; pantalla del cliente con subtotal, descuentos, «Pagado» y «Gracias». | Revisar en la API: reimprimir precuenta sin cambios, borrar la cuenta vacía al guardar y la regla de «no eliminar por debajo de lo cobrado». |
| v260 | Pruebas del 28/10: los datos del cliente de la factura completa se guardan en el fichero de clientes y se busca también por correo; no hay dos personas con el mismo nombre; bloqueo por inactividad de 10 s como mínimo. | `GET /customers` con búsqueda por email; alta del cliente al facturar; nombre de persona único (sin mayúsculas ni espacios); mínimo de 10 s en Parámetros. |
| v261 | Decisiones del 28/10: sin conexión, Cobrar desactivado; **no se cobra un menú con pases por elegir o sin marchar (también en la API)**; en Editar sala no se puede dejar ni crear una mesa encima de otra. | Regla de cobro con pases pendientes en `checkout`/`payments`; validar el solape de mesas en `PUT /config/areas/{id}/layout`. |
| v262–v263 | Gestiones › **Resumen semana**: lunes a domingo, semana anterior, año anterior, proyección (objetivo de Ajustes › Objetivos), cumplimiento, observaciones por día y productos más vendidos con % de mezcla. «Con servidor sale de los cierres de periodo»; «las observaciones se guardan en el servidor». | Tabla `week_note` y `period_summary.by_product` (**0024**, hechas) · `GET /reports/week` y `PUT /reports/week/notes/{date}` en el contrato, sin programar. |

## Arreglos posteriores

- **v265** · Administración › API backend y Base de datos al día (migraciones 0023–0026 y contrato).
- **v266** · Pruebas JC01 del 03/11: una mesa «Pendiente de revisar» sin líneas marcadas ya no se queda bloqueada; los botones «Reintentar envío» y «Quedarme con lo del servidor» salen debajo de la cuenta y en el aviso al cobrar.
- **v267** · La API ya tiene todo lo de la sección 1 de esta lista (Sistema, Resumen semana, Pedidos y Motorizados, tablero de pedidos y las reglas del 28/10) y el TPV lo usa cuando hay servidor. En la PDA, la comanda abierta enseña al momento la incidencia de una mesa retenida.
- **v268** · Reglas del 03/11 (API y TPV): una cuenta con descuento o cobro parcial ya se está cobrando: solo Cobrar, Precuenta y Guardar quedan activos, el resto desactivado con un aviso (por cuenta). Cambiar o juntar mesa se puede siempre (la cuenta en cobro pasa entera y aparte). Apagar delivery en Ajustes ya no da error. Propina fuera de la factura y opcional en el ticket (Formatos › Factura). Migración 0027. La nota de la mesa se puede escribir siempre. Para volver a pedir: anular los cobros («Anular» en cada cobro, con clave) y quitar el descuento. Un descuento no deja la cuenta a 0 €; una mesa cerrada no se reabre nunca. Facturas: pestaña «Historial» y reimprimir sin abrir el cajón. Precuenta: desde la barra imprime y vuelve a mesas, desde Cobrar sigue en Cobrar; lleva descuento, lo pagado a cuenta y lo que falta. El velo «Enviando al servidor…» ya no se queda encima.
- **v268 (04/11)** · Sin conexión con el servidor: no se abren mesas, solo ticar, cambiar de cuenta y corregir; Guardar no imprime. Al volver, lo ticado va a **Reconexiones** (migración 0028): un encargado lo valida (entra y sale la comanda) o lo descarta con motivo; con algo pendiente la cuenta no se cobra. Aviso informativo «Sin internet». Marchar se puede con la cuenta en cobro. Descuentos largos en varias líneas del ticket. Precuenta y factura impresas por el servidor con Ajustes › Formatos de ticket (migración 0029). Cierre de facturación (migración 0030): factura completa que sustituye a una simplificada, límite configurable de la simplificada (3.000 €), nada a 0 €, propina con todas las formas de pago, corte Z con lo contado y el motivo, estado de envío por email («no enviada»), Order on Table en su propia cuenta y tablero de delivery solo para cajero y encargado. Pruebas en JC01: el papel sale con el logo del local (migración 0031) y «Imprimir ticket» de la pantalla del cliente imprime la factura.

## 2 · Solo TPV (diseño y pantallas), ya incluidos en `japp-tpv/`

**Facturas**
- v204 · El ticket de la factura va por pestañas (Productos · Pagos · IVA y VeriFactu · Cliente) y el total siempre a la vista.

**Fondo y tamaño**
- v205 · Azulejo azul nuevo en mosaico de 240 px.
- v227 · En pantallas grandes el sistema queda centrado (máximo 1680 × 980 px).
- v228 · El plano ocupa todo el alto, con una franja abajo.
- v234 · Sin modo oscuro: siempre en claro (los colores van en Administración › Sistema).

**Cabecera del usuario (columna izquierda)**
- v207–v209, v214, v216 · Pasa a ser una tarjeta de identificación: franja de color arriba, logo, nombre centrado, perfil en una etiqueta y «Cambiar» como botón redondo en la esquina (también se cambia tocando la tarjeta).
- v220 · Franja en el color del sistema.
- v250 · Debajo del perfil, el código y el nombre de la tienda.

**Áreas del plano**
- v210–v215, v219, v221 · Sin barra ni contador; sin elegir, en blanco con el texto oscuro; la elegida en azul mesa; la terraza lleva un sol pequeño.

**Barra de arriba y pantalla de acceso**
- v222–v226 · «Tu color» con el nombre de cada color, también en el acceso; el acceso sin barra de arriba y centrado; pie «Plataforma Japp»; mapa con Ecuador, Colombia, España y EE. UU.
- v235 · El teclado en pantalla pasa a Ajustes.
- v247 · Los idiomas solo en el acceso.
- v249 · Sin el botón de la versión arriba.
- v251 · Sin la tienda ni el logo arriba.

**Mesas y Gestiones**
- v229 · «Pedidos» a la derecha de la franja de abajo.
- v248 · En la toma de pedido, la fila de botones de abajo con fondo blanco.
- v252 · Sin «Toca un estado para resaltarlo».
- v253 · «Editar sala» pasa dentro de Gestiones.
- v254–v255 · La opción elegida se abre encima de Gestiones y al cerrarla se vuelve a Gestiones; se quita «Reabrir mesa»; el arqueo con icono de bolsa de dinero.
- v256 · Caja: la ventana tiene el mismo tamaño en todas las pestañas.

**Ajustes › Restaurante**
- v257–v258 · Tipo de servicio como interruptor (Servicio a la mesa · Fast food); Código, ID de integración y Nombre en la misma línea; se quita «Aplicación (PWA)».

**Fast food**
- v233, v236–v246 · Cabecera sin naranja; «Pedidos» en la cabecera; la tienda con su logo y debajo el usuario y su perfil; sin etiqueta, versión ni idiomas en la barra; «Gestiones» en verde.

---

## Cómo pasarlo a producción
1. **TPV:** copia `japp-tpv/` encima de la de tu repo. Lleva el `index.html` de la v264, y el `sw.js` sube a `japp-tpv-v264` para que los equipos cojan la versión nueva.
2. **API y base:** antes de publicar, haz las tareas 🔧 del punto 1. Sin ellas, lo de Sistema, Delivery y Resumen semana funciona solo en el equipo y no se guarda en el servidor.
3. Prueba primero sin servidor con `?mock` (ver `LEEME-MOCK.md`).
