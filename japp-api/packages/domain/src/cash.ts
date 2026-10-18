import { D, r2, sum } from "./money.js";

export interface CashMovement { type: "retiro" | "ingreso"; amount: number; reason: string; }
export interface CashPayment { kind: "cash" | "card" | "other"; amount: number; refund?: boolean; }

/**
 * Efectivo que debería haber en el cajón (= cajaTeorico):
 * fondo inicial + cobros en efectivo − abonos en efectivo − retiros + ingresos.
 */
export function expectedCash(opening: number, payments: CashPayment[], moves: CashMovement[]) {
  const cash = sum(payments.filter(p => p.kind === "cash").map(p => (p.refund ? -Math.abs(p.amount) : p.amount)));
  const card = sum(payments.filter(p => p.kind !== "cash").map(p => (p.refund ? -Math.abs(p.amount) : p.amount)));
  const out = sum(moves.filter(m => m.type === "retiro").map(m => m.amount));
  const inn = sum(moves.filter(m => m.type === "ingreso").map(m => m.amount));
  return { opening: r2(opening), cashSales: r2(cash), card: r2(card), withdrawals: r2(out), deposits: r2(inn), expected: r2(D(opening).plus(cash).minus(out).plus(inn)) };
}

export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] as const;

/** Arqueo ciego: total contado a partir de billetes y monedas. */
export const countedTotal = (count: Partial<Record<number, number>>) => r2(sum(DENOMINATIONS.map(d => D(d).times(count[d] ?? 0))));

/** Descuadre = contado − esperado. Si |descuadre| > umbral hay que justificarlo (Parámetros › umbral). */
export function cashDifference(counted: number, expected: number, threshold = 5) {
  const diff = r2(D(counted).minus(expected));
  return { diff, needsReason: Math.abs(diff) > threshold };
}
