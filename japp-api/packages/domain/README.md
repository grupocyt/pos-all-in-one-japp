# @japp/domain

Reglas de negocio de Japp TPV, portadas del prototipo (`docs/prototipo/tpv-japp.html`). Sin base de datos, red ni reloj: todo lo impuro entra por `Ctx`.

| Fichero | Qué decide | Equivale en el prototipo |
|---|---|---|
| `money.ts` | Decimal, redondeo a céntimos (`r2`) | `r2` |
| `totals.ts` | importe de línea, subtotal, descuentos, pagado, pendiente, IVA por tipo | `lineAmount`, `accTotals` |
| `pricing.ts` | PVP general o terraza según el área | `priceOf` |
| `lines.ts` | añadir (fusión y duplicados), cantidad, eliminar con motivo/permiso, enviar, precuenta, separar cuenta | `addProduct`, `changeQty`, `deleteLine`, `sendOrder`, `preBill`, `splitModal` |
| `payments.ts` | cobro (tope pendiente, cambio, propina), partes iguales | `payModal` |
| `invoice.ts` | F1/F2, número, QR VeriFactu (fecha Madrid), huecos de serie | `issueInvoice` |
| `permissions.ts` | árbol de 47 permisos, excepciones por persona, clave de encargado | `PM_TREE`, `can`, `canAj`, `needManager` |
| `tables.ts` | estado de mesa en el plano, destino de transferencia | `cls` |
| `cash.ts` | efectivo esperado, arqueo, descuadre | `cajaTeorico`, `cntTotal` |
| `fastfood.ts` | modo mostrador | `isFF`, `ffId` |
| `concurrency.ts` | versión optimista | `version` de la orden |
| `errors.ts` | códigos de error y estado HTTP del OpenAPI | — |

`npm test` · `npm run typecheck`
