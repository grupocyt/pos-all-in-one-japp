import { D, r2, sum, Decimal } from "./money.js";
import { fail } from "./errors.js";
import type { TaxBreakdown } from "./types.js";

/**
 * Abono (factura rectificativa), decidido 18/10/2026:
 * - Simplificada (F2) → R5; completa (F1, F3) → R1. Serie de abonos de Ajustes › Facturación (billing_settings.series_credit).
 * - Total (sin líneas) o de algunas unidades de algunas líneas. Nunca más de lo que queda por abonar → 422 QUANTITY_EXCEEDS.
 * - El importe de cada línea lleva su parte del descuento de la cuenta (el mismo reparto que la factura).
 * - El abono que deja la factura a 0 usa lo que queda exacto (total e IVA por tipo), así la suma de abonos = la factura.
 * - Importes en positivo aquí; la rectificativa se guarda con el total en negativo (rectificativa por diferencias).
 */
export type CreditType = "R1" | "R5";

/** Rectificativa (R1…R5): resta venta y no cuenta como ticket (cierres, informes y transacciones del día). */
export function isRectificative(type: string | null | undefined): boolean {
  return /^R[1-5]$/.test(type ?? "");
}

export function creditTypeFor(invoiceType: string): CreditType {
  if (invoiceType === "F2") {
    return "R5";
  }
  if (invoiceType === "F1" || invoiceType === "F3") {
    return "R1";
  }
  return fail("VALIDATION", "Una rectificativa no se abona", { field: "invoiceId", type: invoiceType });
}

export interface CreditableLine {
  lineId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  modifiers: { unitPrice: number; quantity?: number }[];
}

export interface CreditSource {
  /** Líneas vivas (no eliminadas) de la cuenta facturada. */
  lines: CreditableLine[];
  /** Subtotal y total de la factura (total = subtotal − descuentos). */
  sub: number;
  total: number;
  taxes: TaxBreakdown[];
  /** Ya abonado antes: unidades por línea, total e IVA por tipo. */
  creditedQty: Record<string, number>;
  creditedTotal: number;
  creditedTaxes: TaxBreakdown[];
}

export interface CreditLine {
  lineId: string;
  name: string;
  quantity: number;
  amount: number;
  taxRate: number;
}

export interface CreditPlan {
  lines: CreditLine[];
  total: number;
  taxes: TaxBreakdown[];
  /** Con este abono la factura queda abonada entera (pasa a status «rectified»). */
  full: boolean;
}

/** Importe de la línea entera: cantidad × (precio + Σ modificadores × su cantidad), como lineAmount. */
function amountOf(l: CreditableLine): Decimal {
  const mods = sum(l.modifiers.map((m) => D(m.unitPrice).times(m.quantity ?? 1)));
  return D(r2(D(l.quantity).times(D(l.unitPrice).plus(mods))));
}

const q3 = (n: Decimal.Value) => new Decimal(n).toDecimalPlaces(3).toNumber();

/**
 * Solo se abona la factura entera (decidido por el product owner, 27/10/2026): un abono con líneas → 422 en `lines`.
 * planCredit sigue sabiendo abonar «lo que queda» de una factura que ya tenía abonos parciales de antes.
 */
export function assertWholeCredit(lines: readonly unknown[] | null | undefined): void {
  if (lines && lines.length) {
    fail("VALIDATION", "Solo se puede abonar la factura entera", { field: "lines" });
  }
}

export function planCredit(
  src: CreditSource,
  request: { lineId: string; quantity: number }[] | null,
): CreditPlan {
  const remainingTotal = r2(D(src.total).minus(src.creditedTotal));
  if (!(remainingTotal > 0)) {
    fail("QUANTITY_EXCEEDS", "Esta factura ya está abonada entera", { field: "lines" });
  }
  const left = (l: CreditableLine) => q3(D(l.quantity).minus(src.creditedQty[l.lineId] ?? 0));
  const wanted = pickLines(src, request, left);
  const factor = factorOf(src);
  const lines: CreditLine[] = wanted.map(({ line, quantity }) => ({
    lineId: line.lineId,
    name: line.name,
    quantity,
    taxRate: line.taxRate,
    amount: r2(amountOf(line).div(line.quantity).times(quantity).times(factor)),
  }));
  const full = src.lines.every((l) => {
    const w = wanted.find((x) => x.line.lineId === l.lineId);
    return q3(D(left(l)).minus(w?.quantity ?? 0)) <= 0;
  });
  if (full) {
    return { lines: fitLast(lines, remainingTotal), total: remainingTotal, taxes: remainingTaxes(src), full };
  }
  const total = r2(sum(lines.map((l) => l.amount)));
  if (total > remainingTotal) {
    fail("QUANTITY_EXCEEDS", "El abono supera lo que queda por abonar", {
      field: "lines",
      remaining: remainingTotal,
    });
  }
  return { lines, total, taxes: taxesOf(lines), full };
}

function pickLines(
  src: CreditSource,
  request: { lineId: string; quantity: number }[] | null,
  left: (l: CreditableLine) => number,
) {
  if (!request || request.length === 0) {
    return src.lines.filter((l) => left(l) > 0).map((line) => ({ line, quantity: left(line) }));
  }
  const seen = new Set<string>();
  return request.map((r, i) => {
    const line = src.lines.find((l) => l.lineId === r.lineId);
    if (!line) {
      fail("VALIDATION", "Esa línea no está en la factura", { field: `lines[${i}].lineId` });
    }
    if (seen.has(r.lineId)) {
      fail("VALIDATION", "Línea repetida", { field: `lines[${i}].lineId` });
    }
    seen.add(r.lineId);
    const l = line as CreditableLine;
    if (!(r.quantity > 0)) {
      fail("VALIDATION", "La cantidad tiene que ser mayor que 0", { field: `lines[${i}].quantity` });
    }
    if (r.quantity > left(l)) {
      fail("QUANTITY_EXCEEDS", `De ${l.name} solo quedan ${left(l)} por abonar`, {
        field: `lines[${i}].quantity`,
        left: left(l),
      });
    }
    return { line: l, quantity: q3(r.quantity) };
  });
}

/** Parte del descuento de la cuenta: total / subtotal (1 sin descuento). */
function factorOf(src: CreditSource): Decimal {
  if (!(src.sub > 0)) {
    return D(1);
  }
  return D(src.total).div(src.sub);
}

/** El último abono cuadra con lo que queda: el céntimo de redondeo va a la línea más cara. */
function fitLast(lines: CreditLine[], total: number): CreditLine[] {
  if (lines.length === 0) {
    return lines;
  }
  const diff = D(total).minus(sum(lines.map((l) => l.amount)));
  if (diff.isZero()) {
    return lines;
  }
  let top = 0;
  lines.forEach((l, i) => {
    if (l.amount > lines[top]!.amount) {
      top = i;
    }
  });
  return lines.map((l, i) => {
    if (i !== top) {
      return l;
    }
    return { ...l, amount: r2(D(l.amount).plus(diff)) };
  });
}

function remainingTaxes(src: CreditSource): TaxBreakdown[] {
  return src.taxes
    .map((t) => {
      const prev = src.creditedTaxes.find((p) => p.rate === t.rate);
      return {
        rate: t.rate,
        base: r2(D(t.base).minus(prev?.base ?? 0)),
        tax: r2(D(t.tax).minus(prev?.tax ?? 0)),
      };
    })
    .filter((t) => t.base !== 0 || t.tax !== 0);
}

/** IVA por tipo de un abono parcial: base = importe / (1 + tipo), cuota = importe − base (como la factura). */
function taxesOf(lines: CreditLine[]): TaxBreakdown[] {
  const byRate = new Map<number, Decimal>();
  for (const l of lines) {
    byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? D(0)).plus(l.amount));
  }
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, gross]) => {
      const base = r2(gross.div(D(1).plus(D(rate).div(100))));
      return { rate, base, tax: r2(gross.minus(base)) };
    });
}
