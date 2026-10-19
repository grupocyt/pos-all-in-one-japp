import { D, r2 } from "./money.js";
import { assertNoPendingCourses } from "./courses.js";
import { clone, type Ctx } from "./context.js";
import { fail } from "./errors.js";
import { accountTotals } from "./totals.js";
import type { Account, Payment } from "./types.js";

export interface PaymentInput {
  method: string;
  kind: "cash" | "card" | "other";
  methodId?: string | null;
  /** null/undefined = lo pendiente */
  amount?: number | null;
  tip?: number;
  cashGiven?: number | null;
}

export type PaymentKind = Payment["kind"];
/**
 * Tipo de una forma de pago (una sola regla para cobros, caja, cierres y transacciones):
 * payment_method.kind cash → efectivo, card → tarjeta, el resto (platform, voucher…) → otros.
 * Cobros antiguos sin forma de pago enlazada: por el código (cash / card); bizum, vales… → otros.
 */
export function paymentKind(kind?: string | null, code?: string | null): PaymentKind {
  if (kind) {
    return kind === "cash" ? "cash" : kind === "card" ? "card" : "other";
  }
  return code === "cash" ? "cash" : code === "card" ? "card" : "other";
}

export interface MethodRow {
  id: string;
  code: string;
  kind: string;
  active: boolean;
}
/**
 * ¿Se puede cobrar con esta forma de pago en esta estación?
 * - tiene que existir y estar activa;
 * - si la estación tiene formas de pago configuradas (station_payment_method), tiene que ser una de ellas;
 * - en la PDA solo tarjeta (kind card).
 */
export function assertMethodAllowed(
  m: MethodRow | null | undefined,
  station: { name: string; kind: string; methodIds: string[] },
  code: string,
): MethodRow {
  if (!m || !m.active) {
    return fail("METHOD_NOT_ALLOWED", "Forma de pago no disponible", { field: "method", method: code });
  }
  if (station.methodIds.length && !station.methodIds.includes(m.id)) {
    fail("METHOD_NOT_ALLOWED", `${station.name} no cobra con esa forma de pago`, {
      field: "method",
      method: code,
      station: station.name,
    });
  }
  if (station.kind === "pda" && m.kind !== "card") {
    fail("METHOD_NOT_ALLOWED", "La PDA solo cobra con tarjeta", {
      field: "method",
      method: code,
      station: station.name,
    });
  }
  return m;
}

/**
 * Formas de pago de una estación (GET /devices/me), con la misma regla que assertMethodAllowed:
 * activas; si la estación tiene alguna configurada, solo esas; en la PDA, solo las de tarjeta.
 */
export function stationMethods<M extends MethodRow>(
  methods: M[],
  station: { kind: string; methodIds: string[] },
): M[] {
  return methods.filter((m) => {
    if (!m.active) {
      return false;
    }
    if (station.methodIds.length && !station.methodIds.includes(m.id)) {
      return false;
    }
    if (station.kind === "pda" && m.kind !== "card") {
      return false;
    }
    return true;
  });
}

/**
 * Registrar un cobro (= payModal › Cobrar):
 * - se cobra como mucho lo pendiente (más → AMOUNT_EXCEEDS_PENDING, nunca se recorta); sin importe = lo pendiente; tiene que ser > 0;
 * - efectivo: lo entregado ≥ lo cobrado; cambio = entregado − cobrado; sin propina;
 * - tarjeta: admite propina (no cuenta para el total de la cuenta);
 * - devuelve si la cuenta quedó a 0 (entonces toca emitir la factura).
 */
export function registerPayment(
  acc: Account,
  input: PaymentInput,
  ctx: Ctx,
): { account: Account; payment: Payment; settled: boolean } {
  if (acc.status !== "open") {
    fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  }
  const { pending, total } = accountTotals(acc);
  assertNoPendingCourses(acc);
  if (!(total > 0)) {
    fail("NOTHING_TO_CHARGE", "La cuenta está a 0,00 €: no hay nada que cobrar", { total });
  }
  const a = r2(input.amount ?? pending);
  if (!(a > 0)) {
    fail("VALIDATION", "Importe a cobrar no válido", { field: "amount", pending });
  }
  if (a > pending) {
    fail("AMOUNT_EXCEEDS_PENDING", `Quedan ${pending.toFixed(2).replace(".", ",")} € por cobrar`, {
      field: "amount",
      pending,
      amount: a,
    });
  }
  let change: number | null = null;
  let cashGiven: number | null = null;
  let tip = 0;
  if (input.kind === "cash") {
    cashGiven = r2(input.cashGiven ?? a);
    if (cashGiven < a) {
      fail("VALIDATION", "El efectivo entregado no llega", { field: "cashGiven", required: a });
    }
    change = r2(D(cashGiven).minus(a));
  } else if (input.kind === "card") {
    tip = r2(input.tip ?? 0);
    if (tip < 0) {
      fail("VALIDATION", "Propina negativa", { field: "tip" });
    }
  }
  const payment: Payment = {
    id: ctx.newId(),
    method: input.method,
    ...(input.methodId ? { methodId: input.methodId } : {}),
    kind: input.kind,
    amount: a,
    tip,
    cashGiven,
    change,
    status: "confirmed",
    collectedBy: { ...ctx.actor, at: ctx.now.toISOString() },
  };
  const out = clone(acc);
  out.payments.push(payment);
  return { account: out, payment, settled: accountTotals(out).pending <= 0 };
}

/** Cobro a partes iguales: importe por persona (la última parte absorbe el céntimo que sobra). */
export function equalParts(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) {
    fail("VALIDATION", "Número de partes no válido", { field: "parts" });
  }
  const each = D(total).div(parts).toDecimalPlaces(2, 1 /* ROUND_DOWN */);
  const res = Array.from({ length: parts }, () => each.toNumber());
  res[parts - 1] = r2(D(total).minus(each.times(parts - 1)));
  return res;
}
