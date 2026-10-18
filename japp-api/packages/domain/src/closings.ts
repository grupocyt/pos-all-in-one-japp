import { r2, sum } from "./money.js";
import { TZ } from "./invoice.js";
import { MENU_ABSORB_REASON } from "./courses.js";
import { lineAmount } from "./totals.js";

/** Gestor de cierres: resumen de un periodo, semanas ISO y comparativo con el año anterior y la proyección. */

/** Fecha (AAAA-MM-DD) y hora en Madrid. */
export function madridDay(d: Date): { date: string; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Día de negocio: el de la apertura en Madrid (un cierre a las 00:30 cuenta para el día anterior). */
export const businessDate = (openedAt: Date) => madridDay(openedAt).date;

/** Semana ISO 8601 de una fecha AAAA-MM-DD. */
export function isoWeek(date: string): { year: number; week: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const x = new Date(Date.UTC(y, m - 1, d)), day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const year = x.getUTCFullYear();
  return { year, week: Math.ceil(((x.getTime() - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7) };
}
/** Lunes de la semana ISO (AAAA-MM-DD). */
export function isoWeekStart(year: number, week: number): string {
  const j4 = new Date(Date.UTC(year, 0, 4)), day = j4.getUTCDay() || 7;
  const mon = new Date(j4.getTime() + ((1 - day) + (week - 1) * 7) * 864e5);
  return mon.toISOString().slice(0, 10);
}
export const isoWeeksInYear = (year: number) => isoWeek(`${year}-12-28`).week;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export interface SoldInvoice { at: Date; total: number; base: number; tax: number; waiter: string; table: string; orderId: string; guests: number; type: "F1" | "F2" | "R1"; }
export interface SoldPayment { method: string; kind: "cash" | "card" | "other"; amount: number; tip: number; }
export interface SoldVoid { at: Date; name: string; qty: number; amount: number; reason: string; by: string; auth: string | null; }
export interface PeriodSummary {
  businessDate: string; grossSales: number; taxBase: number; taxTotal: number; tickets: number; guests: number;
  cashAmount: number; cardAmount: number; otherAmount: number; tips: number; discountAmount: number;
  voidsCount: number; voidsAmount: number; cashDifference: number;
  byHour: Record<string, number>; byWaiter: { name: string; sales: number; tickets: number; tables: number }[];
  byPayment: { method: string; amount: number; count: number }[]; voids: { at: string; name: string; qty: number; amount: number; reason: string; by: string; auth: string | null }[];
}

/** Resumen de un periodo al cerrarlo. Las rectificativas (R1) restan venta y no cuentan como ticket. */
export function summarizePeriod(input: { openedAt: Date; invoices: SoldInvoice[]; payments: SoldPayment[]; voids: SoldVoid[]; discountAmount: number; cashDifference: number }): PeriodSummary {
  const inv = input.invoices, sales = inv.filter(i => i.type !== "R1");
  const byHour: Record<string, number> = {};
  for (const i of inv) { const h = String(madridDay(i.at).hour); byHour[h] = r2(sum([byHour[h] ?? 0, i.total])); }
  const wm = new Map<string, { name: string; sales: number; tickets: number; tables: Set<string> }>();
  for (const i of inv) {
    const w = wm.get(i.waiter) ?? { name: i.waiter, sales: 0, tickets: 0, tables: new Set<string>() };
    w.sales = r2(sum([w.sales, i.total])); if (i.type !== "R1") { w.tickets++; w.tables.add(i.orderId); }
    wm.set(i.waiter, w);
  }
  const pm = new Map<string, { method: string; amount: number; count: number }>();
  for (const p of input.payments) { const x = pm.get(p.method) ?? { method: p.method, amount: 0, count: 0 }; x.amount = r2(sum([x.amount, p.amount])); x.count++; pm.set(p.method, x); }
  const kind = (k: SoldPayment["kind"]) => r2(sum(input.payments.filter(p => p.kind === k).map(p => p.amount)));
  return {
    businessDate: businessDate(input.openedAt),
    grossSales: r2(sum(inv.map(i => i.total))), taxBase: r2(sum(inv.map(i => i.base))), taxTotal: r2(sum(inv.map(i => i.tax))),
    tickets: sales.length, guests: [...new Map(sales.map(i => [i.orderId, i.guests])).values()].reduce((a, g) => a + g, 0),
    cashAmount: kind("cash"), cardAmount: kind("card"), otherAmount: kind("other"), tips: r2(sum(input.payments.map(p => p.tip))),
    discountAmount: r2(input.discountAmount),
    voidsCount: input.voids.reduce((a, v) => a + v.qty, 0), voidsAmount: r2(sum(input.voids.map(v => v.amount))), cashDifference: r2(input.cashDifference),
    byHour, byWaiter: [...wm.values()].map(w => ({ name: w.name, sales: w.sales, tickets: w.tickets, tables: w.tables.size })).sort((a, b) => b.sales - a.sales),
    byPayment: [...pm.values()].sort((a, b) => b.amount - a.amount),
    voids: input.voids.map(v => ({ ...v, at: v.at.toISOString(), amount: r2(v.amount) })),
  };
}

export interface DaySales { date: string; sales: number; }
export interface SalesTarget { week: number; growthPct: number; amount: number | null; }
export interface WeekRow { week: number; from: string; to: string; real: number | null; prev: number; proj: number; prevFull: number; projFull: number; current: boolean; daysElapsed: number; }

/**
 * 52 (o 53) semanas de un año: real, año anterior (misma semana ISO), proyección = año anterior × (1 + objetivo)
 * o el importe fijo de la semana. La semana en curso se compara solo con los mismos días transcurridos.
 */
export function weeksReport(year: number, days: DaySales[], targets: SalesTarget[], today: string): WeekRow[] {
  const byDate = new Map(days.map(d => [d.date, d.sales]));
  const total = (from: string, n: number) => r2(sum([...Array(n)].map((_, i) => byDate.get(addDays(from, i)) ?? 0)));
  const yearT = targets.find(t => t.week === 0), now = isoWeek(today);
  const rows: WeekRow[] = [];
  for (let w = 1; w <= isoWeeksInYear(year); w++) {
    const from = isoWeekStart(year, w), pw = Math.min(w, isoWeeksInYear(year - 1)), pfrom = isoWeekStart(year - 1, pw);
    const current = now.year === year && now.week === w, past = year < now.year || (year === now.year && w <= now.week);
    const elapsed = current ? (new Date(`${today}T00:00:00Z`).getUTCDay() || 7) : 7;
    const t = targets.find(x => x.week === w) ?? yearT, g = 1 + (t?.growthPct ?? 0) / 100;
    const prevFull = total(pfrom, 7), prev = total(pfrom, elapsed);
    const projFull = t?.amount != null && t.week === w ? r2(t.amount) : r2(prevFull * g);
    rows.push({ week: w, from, to: addDays(from, 6), real: past ? total(from, elapsed) : null, prev, prevFull, proj: prevFull ? r2(projFull * prev / prevFull) : r2(prev * g), projFull, current, daysElapsed: elapsed });
  }
  return rows;
}

/** Totales del año: acumulado real, frente a año anterior y proyección (mismas semanas), y cierre de año previsto. */
export function weeksTotals(rows: WeekRow[]) {
  const done = rows.filter(r => r.real != null);
  const ytd = r2(sum(done.map(r => r.real!))), ytdPrev = r2(sum(done.map(r => r.prev))), ytdProj = r2(sum(done.map(r => r.proj)));
  const pct = (a: number, b: number) => (b ? r2(((a - b) / b) * 100) : null);
  const yearEnd = r2(sum([ytd, ...rows.map(r => (r.real == null ? r.projFull : r.current ? r.projFull - r.proj : 0))]));
  return { ytd, ytdPrev, ytdProj, vsPrevPct: pct(ytd, ytdPrev), vsProjPct: pct(ytd, ytdProj), yearEnd, prevYear: r2(sum(rows.map(r => r.prevFull))), weeksClosed: done.filter(r => !r.current).length };
}

/**
 * Anulaciones (una sola regla para Eliminaciones, Gestor de cierres y Transacciones del día):
 * - línea eliminada después de enviar: deleted_stage printed o preBill (las de «Por enviar» no son anulación);
 * - no cuentan las pasadas a otra cuenta («Pasada a …») ni las incluidas en un menú («Incluida en menú»);
 * - importe = cantidad × (precio + modificadores), como la línea en la cuenta.
 */
export type DeletedStage = "pendingPrint" | "printed" | "preBill";
export interface DeletedRow { reason: string | null; stage: string | null; printed?: boolean | null; quantity: number; unitPrice: number; modifiers: { unitPrice: number; quantity?: number }[]; }
/** Momento en que se eliminó (filas antiguas sin deleted_stage: por printed). */
export const deletedStageOf = (r: Pick<DeletedRow, "stage" | "printed">): DeletedStage =>
  (r.stage === "pendingPrint" || r.stage === "printed" || r.stage === "preBill" ? r.stage : r.printed ? "printed" : "pendingPrint");
export const isMovedOrAbsorbed = (reason: string | null | undefined) => (reason ?? "").startsWith("Pasada a ") || reason === MENU_ABSORB_REASON;
export const isVoid = (r: Pick<DeletedRow, "reason" | "stage" | "printed">) => deletedStageOf(r) !== "pendingPrint" && !isMovedOrAbsorbed(r.reason);
export const voidAmount = (r: Pick<DeletedRow, "quantity" | "unitPrice" | "modifiers">) => lineAmount({ quantity: r.quantity, unitPrice: r.unitPrice, modifiers: r.modifiers.map(m => ({ name: "", unitPrice: m.unitPrice, quantity: m.quantity ?? 1 })) });
/** Las anulaciones de una lista de líneas eliminadas, con su momento e importe. */
export function voidsOf<T extends DeletedRow>(rows: T[]): (T & { stage: DeletedStage; amount: number })[] {
  return rows.filter(isVoid).map(r => ({ ...r, stage: deletedStageOf(r), amount: voidAmount(r) }));
}
