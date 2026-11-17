import { D, r2, sum } from "./money.js";
import { fail } from "./errors.js";

export interface CashMovement {
  type: "retiro" | "ingreso";
  amount: number;
  reason: string;
}
export interface CashPayment {
  kind: "cash" | "card" | "other";
  amount: number;
  /** N3 (04/11): la propina en efectivo también está en el cajón (no es venta) */
  tip?: number;
  refund?: boolean;
}

/**
 * Efectivo que debería haber en el cajón (= cajaTeorico):
 * fondo inicial + cobros en efectivo − abonos en efectivo − retiros + ingresos.
 */
export function expectedCash(opening: number, payments: CashPayment[], moves: CashMovement[]) {
  const cash = sum(
    payments.filter((p) => p.kind === "cash").map((p) => (p.refund ? -Math.abs(p.amount) : p.amount)),
  );
  const card = sum(
    payments.filter((p) => p.kind !== "cash").map((p) => (p.refund ? -Math.abs(p.amount) : p.amount)),
  );
  const cashTips = sum(payments.filter((p) => p.kind === "cash" && !p.refund).map((p) => p.tip ?? 0));
  // 0037 · las propinas con tarjeta también las marca el datáfono (no son venta)
  const cardTips = sum(payments.filter((p) => p.kind === "card" && !p.refund).map((p) => p.tip ?? 0));
  const out = sum(moves.filter((m) => m.type === "retiro").map((m) => m.amount));
  const inn = sum(moves.filter((m) => m.type === "ingreso").map((m) => m.amount));
  return {
    opening: r2(opening),
    cashSales: r2(cash),
    card: r2(card),
    withdrawals: r2(out),
    deposits: r2(inn),
    cashTips: r2(cashTips),
    cardTips: r2(cardTips),
    expected: r2(D(opening).plus(cash).plus(cashTips).minus(out).plus(inn)),
  };
}

export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] as const;

/** Arqueo ciego: total contado a partir de billetes y monedas. */
export const countedTotal = (count: Partial<Record<number, number>>) =>
  r2(sum(DENOMINATIONS.map((d) => D(d).times(count[d] ?? 0))));

/** Descuadre = contado − esperado. Si |descuadre| > umbral hay que justificarlo (Parámetros › umbral). */
export function cashDifference(counted: number, expected: number, threshold = 5) {
  const diff = r2(D(counted).minus(expected));
  return { diff, needsReason: Math.abs(diff) > threshold };
}

/**
 * Arqueo con desglose: Σ denominación × unidades. Las claves son la denominación como texto («50», «0.5» o «0,50»).
 * Si no suma lo contado al céntimo → 422 VALIDATION en «detail» («El desglose suma X €, no Y €»).
 */
const eur = (n: number) => n.toFixed(2).replace(".", ",");
export function detailTotal(detail: Record<string, number>): number {
  let t = D(0);
  for (const [k, units] of Object.entries(detail)) {
    const v = Number(k.trim().replace(",", "."));
    if (!/^\d+([.,]\d{1,2})?$/.test(k.trim()) || !(v > 0)) {
      fail("VALIDATION", `Denominación no válida: «${k}»`, { field: "detail", key: k });
    }
    if (!Number.isInteger(units) || units < 0) {
      fail("VALIDATION", `Unidades no válidas para ${k}`, { field: "detail", key: k });
    }
    t = t.plus(D(v).times(units));
  }
  return r2(t);
}
export function assertDetailMatches(
  detail: Record<string, number> | null | undefined,
  counted: number,
): void {
  if (!detail || Object.keys(detail).length === 0) {
    return; // 1.2.281 · sin billetes ni monedas (el corte X va por forma de pago): {} vale como «sin desglose»
  }
  const t = detailTotal(detail);
  if (t !== r2(counted)) {
    fail("VALIDATION", `El desglose suma ${eur(t)} €, no ${eur(r2(counted))} €`, {
      field: "detail",
      detailTotal: t,
      countedCash: r2(counted),
    });
  }
}

/**
 * Caja chica (0037; 1.2.281 sin fondo fijo): aparte del cajón. Saldo = ingresos − gastos (parte de 0); un gasto no puede
 * pasar del saldo.
 */
export type PettyKind = "expense" | "replenish" | "deposit";
/** 1.2.281 · saldo de la caja chica: parte de 0; ingresos (deposit, y las reposiciones de antes) suman y los gastos restan. */
export function pettyCashBalance(_limit: number, moves: { kind: PettyKind; amount: number }[]): number {
  let b = D(0);
  for (const m of moves) {
    b = m.kind === "expense" ? b.minus(m.amount) : b.plus(m.amount);
  }
  return r2(b);
}
/** 1.2.281 · ingreso: cualquier importe > 0; gasto: > 0 y sin pasar del saldo. (Reponer hasta un fondo ya no existe.) */
export function planPettyCash(
  _limit: number,
  balance: number,
  kind: PettyKind,
  amount?: number | null,
): { amount: number; balanceAfter: number } {
  const a = r2(amount ?? 0);
  if (!(a > 0)) {
    fail("VALIDATION", kind === "expense" ? "Escribe el importe del gasto" : "Escribe el importe a ingresar", { field: "amount" });
  }
  if (kind === "expense") {
    if (a > balance) {
      fail("PETTY_CASH_LIMIT", `La caja chica solo tiene ${eur(balance)} €: el gasto no puede pasar de ahí`, { field: "amount", balance });
    }
    return { amount: a, balanceAfter: r2(D(balance).minus(a)) };
  }
  return { amount: a, balanceAfter: r2(D(balance).plus(a)) };
}
