import { r2, sum } from "./money.js";
import type { Ctx } from "./context.js";
import { DomainError, fail } from "./errors.js";
import { issueInvoice, type SeriesConfig } from "./invoice.js";
import { registerPayment, type PaymentInput } from "./payments.js";
import { accountTotals } from "./totals.js";
import type { Account, Payment } from "./types.js";

/**
 * Cobrar y facturar en una sola operación (decidido 18/10/2026: POST …/checkout).
 * - Los pagos se registran en orden con las mismas reglas que un pago suelto (registerPayment).
 * - Tienen que dejar lo pendiente a 0 → si no, 409 PENDING_NOT_ZERO y no se guarda ninguno (todo o nada).
 * - Después se emite la factura (F1 con cliente, F2 sin él), con el número que reserva la base.
 * - Si la cuenta ya tenía pagos parciales, checkout cobra lo que falta (payments vacío = factura directa si ya está a 0).
 * - Los errores de un pago llevan el campo de su fila: payments[1].cashGiven.
 */
export interface CheckoutResult {
  account: Account;
  payments: Payment[];
  change: number;
}

export function checkout(
  acc: Account,
  payments: PaymentInput[],
  seq: number,
  cfg: SeriesConfig & { nif: string },
  ctx: Ctx,
): CheckoutResult {
  let current = acc;
  const done: Payment[] = [];
  payments.forEach((p, i) => {
    try {
      const r = registerPayment(current, p, ctx);
      current = r.account;
      done.push(r.payment);
    } catch (e) {
      throw withRow(e, i);
    }
  });
  const { pending } = accountTotals(current);
  if (pending > 0) {
    fail("PENDING_NOT_ZERO", `Faltan ${pending.toFixed(2).replace(".", ",")} € por cobrar`, {
      field: "payments",
      pending,
    });
  }
  const invoiced = issueInvoice(current, seq, cfg, ctx);
  const change = r2(sum(done.map((p) => p.change ?? 0)));
  return { account: invoiced, payments: done, change };
}

/** El campo del error pasa a ser el de la fila del pago (amount → payments[1].amount). */
function withRow(e: unknown, i: number): unknown {
  if (!(e instanceof DomainError)) {
    return e;
  }
  const field = typeof e.details.field === "string" ? `payments[${i}].${e.details.field}` : `payments[${i}]`;
  return new DomainError(e.code, e.message, { ...e.details, field });
}
