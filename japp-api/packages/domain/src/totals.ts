import { D, r2, sum, Decimal } from "./money.js";
import { fail } from "./errors.js";
import type { Account, Line, Totals, TaxBreakdown } from "./types.js";

/** Importe de una línea: cantidad × (precio + Σ modificadores × su cantidad). */
export function lineAmount(l: Pick<Line, "quantity" | "unitPrice" | "modifiers">): number {
  const mods = sum(l.modifiers.map(m => D(m.unitPrice).times(m.quantity ?? 1)));
  return r2(D(l.quantity).times(D(l.unitPrice).plus(mods)));
}

/** Importe de una parte de la línea (n unidades), para pasar unidades entre cuentas. */
export function unitsAmount(l: Pick<Line, "quantity" | "unitPrice" | "modifiers">, n: number): number {
  if (l.quantity <= 0) return 0;
  return r2(D(lineAmount(l)).div(l.quantity).times(n));
}

export function discountAmount(d: { type: "percentage" | "fixed"; value: number }, sub: Decimal.Value): number {
  const s = D(sub);
  return d.type === "percentage" ? r2(s.times(d.value).div(100)) : r2(Decimal.min(D(d.value), s));
}

/**
 * Totales de una cuenta (= accTotals del prototipo).
 * - El descuento nunca supera el subtotal.
 * - Solo cuentan los pagos confirmados; pendiente nunca es negativo.
 * - IVA por tipo: el descuento se reparte en proporción al peso de cada tipo; base = importe / (1 + tipo), cuota = importe − base.
 *   Σ (base + cuota) = total exacto: el céntimo de redondeo va al grupo del tipo más alto.
 */
export function accountTotals(acc: Pick<Account, "lines" | "discounts" | "payments">): Totals {
  const subD = sum(acc.lines.map(lineAmount));
  const sub = r2(subD);
  const discRaw = sum(acc.discounts.filter(d => d.status === "applied").map(d => discountAmount(d, sub)));
  const disc = r2(Decimal.min(discRaw, sub));
  const total = r2(D(sub).minus(disc));
  const paid = r2(sum(acc.payments.filter(p => p.status === "confirmed").map(p => p.amount)));
  const pending = r2(Decimal.max(0, D(total).minus(paid)));

  const byRate = new Map<number, Decimal>();
  for (const l of acc.lines) byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? D(0)).plus(lineAmount(l)));
  // importe con IVA de cada tipo, redondeado a céntimos; el céntimo que descuadra va al tipo más alto
  const groups = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amt]) => ({ rate, gross: r2(sub ? amt.times(total).div(sub) : 0) }));
  const diff = D(total).minus(sum(groups.map(g => g.gross)));
  if (!diff.isZero() && groups.length) { const top = groups[groups.length - 1]!; top.gross = r2(D(top.gross).plus(diff)); }
  // base y cuota de cada tipo suman exactamente su importe, y todos juntos el total de la cuenta
  const taxes: TaxBreakdown[] = groups.map(({ rate, gross }) => {
    const base = r2(D(gross).div(D(1).plus(D(rate).div(100))));
    return { rate, base, tax: r2(D(gross).minus(base)) };
  });
  return { sub, disc, total, paid, pending, taxes };
}

/** Una cuenta con cobros no puede quedar por debajo de lo ya cobrado (no hay devoluciones): 409 TOTAL_BELOW_PAID. */
export function assertTotalCoversPaid(acc: Pick<Account, "lines" | "discounts" | "payments">): void {
  const T = accountTotals(acc);
  if (T.paid > 0 && T.total < T.paid) fail("TOTAL_BELOW_PAID", `Ya se ha cobrado ${T.paid.toFixed(2).replace(".", ",")} €: no se puede dejar la cuenta por debajo`, { paid: T.paid, total: T.total });
}
