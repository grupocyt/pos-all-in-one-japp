import { fail } from "./errors.js";

/**
 * Reabrir mesa (POST /orders/{id}/reopen).
 * REGLA FIJA (03/11/2026, API 1.2.268): una mesa cerrada NO se reabre nunca, se haya cobrado o no. Lo cobrado se corrige
 * con un abono; lo que no se llegó a cobrar se marca en una mesa nueva. El endpoint se queda para dar el motivo:
 * - sin periodo abierto o de otro periodo → PERIOD_CLOSED;
 * - la mesa sigue abierta → TABLE_BUSY;
 * - cerrada (closed) o cerrada sin venta (cancelled) → ORDER_CLOSED, siempre.
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
  /** tiene algún cobro confirmado */
  paid?: boolean;
}

export function planReopen(
  order: ReopenOrder,
  accounts: ReopenAccount[],
  currentPeriodId: string | null,
): never {
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
  return fail(
    "ORDER_CLOSED",
    "Una mesa cerrada no se reabre nunca: abre una mesa nueva (lo cobrado se corrige con un abono)",
    {
      orderId: order.id,
      charged: accounts.filter((a) => a.invoiced || a.status === "invoiced" || a.paid).map((a) => a.id),
    },
  );
}
