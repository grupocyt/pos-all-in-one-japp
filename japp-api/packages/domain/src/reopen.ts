import { fail } from "./errors.js";

/**
 * Reabrir mesa (POST /orders/{id}/reopen, decidido 18/10/2026):
 * - solo una orden cerrada (closed) o cerrada sin venta (cancelled), y solo del periodo abierto: lo de un periodo
 *   cerrado ya está en su cierre y no se toca (PERIOD_CLOSED);
 * - las cuentas anuladas sin factura vuelven a open; las facturadas siguen como están (se corrigen con un abono);
 * - si no queda ninguna que reabrir (todas facturadas) → ACCOUNT_CLOSED.
 * Que la mesa esté libre lo comprueba quien llama, con la mesa bloqueada.
 */
export interface ReopenOrder {
  id: string;
  status: string;
  periodId: string | null;
}
export interface ReopenAccount {
  id: string;
  status: string;
  /** tiene factura (aunque el estado diga otra cosa) */
  invoiced: boolean;
}

export function planReopen(
  order: ReopenOrder,
  accounts: ReopenAccount[],
  currentPeriodId: string | null,
): { reopen: string[] } {
  if (!currentPeriodId) {
    fail("PERIOD_CLOSED", "No hay periodo abierto");
  }
  if (order.status !== "closed" && order.status !== "cancelled") {
    fail("TABLE_BUSY", "La mesa ya está abierta", { orderId: order.id });
  }
  if (order.periodId !== currentPeriodId) {
    fail("PERIOD_CLOSED", "Esa mesa es de un periodo ya cerrado: no se puede reabrir", {
      orderId: order.id,
      periodId: order.periodId,
    });
  }
  const reopen = accounts.filter((a) => a.status === "cancelled" && !a.invoiced).map((a) => a.id);
  if (!reopen.length) {
    fail("ACCOUNT_CLOSED", "Todas las cuentas de la mesa están facturadas: se corrigen con un abono", {
      orderId: order.id,
    });
  }
  return { reopen };
}
