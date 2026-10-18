import { D, r2 } from "./money.js";
import { assertNoPendingCourses } from "./courses.js";
import { clone, type Ctx } from "./context.js";
import { fail } from "./errors.js";
import { accountTotals } from "./totals.js";
import type { Account, Payment } from "./types.js";

export interface PaymentInput { method: string; kind: "cash" | "card" | "other"; amount: number; tip?: number; cashGiven?: number | null; }

/**
 * Registrar un cobro (= payModal › Cobrar):
 * - se cobra como mucho lo pendiente; tiene que ser > 0;
 * - efectivo: lo entregado ≥ lo cobrado; cambio = entregado − cobrado; sin propina;
 * - tarjeta: admite propina (no cuenta para el total de la cuenta);
 * - devuelve si la cuenta quedó a 0 (entonces toca emitir la factura).
 */
export function registerPayment(acc: Account, input: PaymentInput, ctx: Ctx): { account: Account; payment: Payment; settled: boolean } {
  if (acc.status !== "open") fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  const { pending, total } = accountTotals(acc);
  assertNoPendingCourses(acc);
  if (!(total > 0)) fail("NOTHING_TO_CHARGE", "La cuenta está a 0,00 €: no hay nada que cobrar", { total });
  const a = r2(Math.min(input.amount, pending));
  if (!(a > 0)) fail("VALIDATION", "Importe a cobrar no válido", { field: "amount", pending });
  let change: number | null = null, cashGiven: number | null = null, tip = 0;
  if (input.kind === "cash") {
    cashGiven = r2(input.cashGiven ?? a);
    if (cashGiven < a) fail("VALIDATION", "El efectivo entregado no llega", { field: "cashGiven", required: a });
    change = r2(D(cashGiven).minus(a));
  } else if (input.kind === "card") {
    tip = r2(input.tip ?? 0);
    if (tip < 0) fail("VALIDATION", "Propina negativa", { field: "tip" });
  }
  const payment: Payment = { id: ctx.newId(), method: input.method, kind: input.kind, amount: a, tip, cashGiven, change, status: "confirmed", collectedBy: { ...ctx.actor, at: ctx.now.toISOString() } };
  const out = clone(acc);
  out.payments.push(payment);
  return { account: out, payment, settled: accountTotals(out).pending <= 0 };
}

/** Cobro a partes iguales: importe por persona (la última parte absorbe el céntimo que sobra). */
export function equalParts(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) fail("VALIDATION", "Número de partes no válido", { field: "parts" });
  const each = D(total).div(parts).toDecimalPlaces(2, 1 /* ROUND_DOWN */);
  const res = Array.from({ length: parts }, () => each.toNumber());
  res[parts - 1] = r2(D(total).minus(each.times(parts - 1)));
  return res;
}
