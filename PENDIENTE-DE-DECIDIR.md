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
| 10 | Envío de la factura por email | El email del cliente se guarda y es obligatorio en la factura completa, pero no se envía nada (no hay servidor de correo) | ¿Se envía la factura por email? ¿Desde la tienda o desde el Manager? ¿Con qué cuenta de correo? |
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
| 15 | Resumen semana | Permiso `funciones.informes` (el de Informes de Gestiones) | ¿Lo ve quien ve Informes, o solo quien tiene el Gestor de cierres (`ajustes.cierres`)? |
| 16 | Tablero de pedidos (delivery) | Permiso nuevo `funciones.pedidos`, dado a todos los perfiles (hoy el TPV no lo limita) | ¿Lo usa cualquiera o solo cajero y encargado? |
| 17 | Cancelar un pedido de delivery | Pide clave de encargado (`sistema.autorizar`) y un motivo | ¿Puede cancelar cualquiera? ¿Hay que avisar a la plataforma? |
| 18 | Nombre, logo y colores del sistema | `GET /config/sistema` sin sesión (la pantalla de acceso lo enseña antes de entrar) | Que no es un dato reservado (solo nombre, textos, logo y colores) |

## Decidido el 03/11/2026 con el dueño (hecho en la 1.2.268)

| # | Tema | Decisión |
|---|---|---|
| 19 | Anular un cobro parcial | Hecho: «Anular» en cada cobro mientras la cuenta no está facturada, con motivo obligatorio y clave de encargado. El cobro queda anulado (no se borra). Tarjeta: devolución en el datáfono. Facturada: abono |
| 20 | Cuenta con descuento o cobro parcial | Se entiende que ya se está cobrando (por cuenta, no por mesa): **solo Cobrar, Precuenta y Guardar** activos; todo lo demás desactivado con un aviso. Tampoco se pasan productos, ni la cuenta, ni se cambia o junta la mesa |
| 21 | Reabrir una mesa ya cobrada o cerrada | **Regla fija: nunca.** Tampoco una cerrada sin cobrar. Lo cobrado se corrige con un abono |
| 22 | Cómo se sigue con una cuenta congelada | Anular los cobros (motivo y clave de encargado) y quitar el descuento; entonces todo vuelve a estar activo. Sin «liberar la cuenta» de un paso |
| 23 | Descuento que deja la cuenta a 0 € | Aviso y no se aplica. Para invitar: eliminar con «Invitación» |
| 24 | Facturas: historial y reimprimir | Pestaña «Historial» en Gestiones › Facturas; reimprimir nunca abre el cajón |

