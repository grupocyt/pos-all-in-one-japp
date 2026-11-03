import { addDays, isoWeek, type SalesTarget } from "./closings.js";
import { D, r2, sum } from "./money.js";

/**
 * Gestiones › Resumen semana (TPV 1.2.262–1.2.263), con el formato de la hoja «RESUMEN SEMANA» de los locales.
 * La misma cuenta que wkLocal del TPV, para que con y sin servidor salga lo mismo:
 * - cada día de lunes a domingo: semana anterior (7 días antes), año anterior (364 días antes, mismo día de la semana),
 *   proyección y cumplimiento (venta real), cada uno con venta, transacciones (T) y ticket medio (TM);
 * - comparativas como la hoja: (real − referencia) / real × 100, con 2 decimales; null si falta alguno o es 0;
 * - proyección = año anterior × (1 + growthPct/100) del objetivo de la semana (o el del año, week 0); con importe fijo
 *   (amount) se reparte por días en proporción al año anterior (a partes iguales si el año anterior no vendió);
 * - totales: venta de la semana entera, pero las comparativas solo con los días que ya tienen venta real;
 * - productos: suma de lo vendido por producto de los días de la semana, con su % de mezcla (los 20 primeros).
 */
export interface DayFigures {
  sales: number;
  tickets: number;
}
export interface DayProduct {
  plu: number | null;
  name: string;
  quantity: number;
  amount: number;
}
export interface WeekCell {
  sales: number;
  tickets: number;
  avg: number | null;
}
export interface WeekCmp {
  sales: number | null;
  tickets: number | null;
  avg: number | null;
}
export interface WeekNote {
  date: string;
  note: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}
export interface WeekSummaryInput {
  /** Cualquier día de la semana (AAAA-MM-DD): se toma su lunes. */
  date: string;
  /** Hoy (día de negocio de Madrid). */
  today: string;
  /** Venta y transacciones por día de negocio (cierres guardados + el periodo abierto). */
  days: Record<string, DayFigures>;
  /** Día de negocio del periodo abierto (null = no hay). */
  openDate: string | null;
  /** Objetivos del año de la semana (week 0 = el del año). */
  targets: SalesTarget[];
  notes: WeekNote[];
  /** Lo vendido por producto de cada día de la semana. */
  products: DayProduct[][];
}

/** Lunes de la semana de una fecha (AAAA-MM-DD). */
export function weekMonday(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - dow);
}

/** Comparativa de la hoja de los locales: (real − referencia) / real × 100; null si falta alguno o es 0. */
export function weekPct(real: number | null | undefined, ref: number | null | undefined): number | null {
  if (real == null || ref == null || !real || !ref) {
    return null;
  }
  return r2(D(real).minus(ref).div(real).times(100));
}

const cell = (sales: number, tickets: number): WeekCell => ({
  sales: r2(sales),
  tickets,
  avg: tickets ? r2(D(sales).div(tickets)) : null,
});
const cmp = (re: WeekCell | null, rf: WeekCell): WeekCmp => ({
  sales: weekPct(re?.sales, rf.sales),
  tickets: weekPct(re?.tickets, rf.tickets),
  avg: weekPct(re?.avg, rf.avg),
});

export function weekSummary(i: WeekSummaryInput) {
  const mon = weekMonday(i.date);
  const sun = addDays(mon, 6);
  const { year, week } = isoWeek(mon);
  const fig = (d: string): DayFigures =>
    d > i.today ? { sales: 0, tickets: 0 } : (i.days[d] ?? { sales: 0, tickets: 0 });
  const t = i.targets.find((x) => x.week === week) ?? i.targets.find((x) => x.week === 0);
  const growthPct = t?.growthPct ?? 0;
  // importe fijo: solo el objetivo de esa semana (el del año es un %)
  const fixed = t && t.week === week && t.amount != null ? r2(t.amount) : null;
  const dates = [...Array(7)].map((_, k) => addDays(mon, k));
  const ly = dates.map((d) => fig(addDays(d, -364)));
  const lyTotal = r2(sum(ly.map((x) => x.sales)));
  const notes = new Map(i.notes.map((n) => [n.date, n.note]));

  const days = dates.map((date, k) => {
    const pd = addDays(date, -7);
    const ld = addDays(date, -364);
    const real = date > i.today ? null : cell(fig(date).sales, fig(date).tickets);
    const prevWeek = cell(fig(pd).sales, fig(pd).tickets);
    const lastYear = cell(ly[k]!.sales, ly[k]!.tickets);
    let tSales: number;
    if (fixed != null) {
      tSales = lyTotal ? r2(D(fixed).times(ly[k]!.sales).div(lyTotal)) : r2(D(fixed).div(7));
    } else {
      tSales = r2(D(ly[k]!.sales).times(D(1).plus(D(growthPct).div(100))));
    }
    const factor = ly[k]!.sales ? D(tSales).div(ly[k]!.sales) : D(1).plus(D(growthPct).div(100));
    const target = cell(tSales, Math.round(D(ly[k]!.tickets).times(factor).toNumber()));
    return {
      date,
      dow: k + 1,
      open: date === i.openDate,
      real,
      prevWeek: { date: pd, ...prevWeek },
      lastYear: { date: ld, ...lastYear },
      target,
      vsPrevWeek: cmp(real, prevWeek),
      vsLastYear: cmp(real, lastYear),
      vsTarget: cmp(real, target),
      note: notes.get(date) ?? null,
    };
  });
  const tot = (pick: (d: (typeof days)[number]) => WeekCell | null, onlyReal = false) => {
    const xs = days
      .filter((d) => !onlyReal || d.real)
      .map(pick)
      .filter((x): x is WeekCell => !!x);
    return cell(
      sum(xs.map((x) => x.sales)).toNumber(),
      xs.reduce((a, x) => a + x.tickets, 0),
    );
  };
  const real = days.some((d) => d.real) ? tot((d) => d.real) : null;
  // productos: suma de los días, % de mezcla sobre el importe de todos, los 20 primeros
  const pm = new Map<string, DayProduct>();
  for (const p of i.products.flat()) {
    const k = `${p.plu ?? ""}|${p.name}`;
    const o = pm.get(k);
    pm.set(k, {
      plu: p.plu,
      name: p.name,
      quantity: (o?.quantity ?? 0) + Number(p.quantity),
      amount: r2(D(o?.amount ?? 0).plus(p.amount)),
    });
  }
  const all = [...pm.values()].filter((p) => p.quantity > 0);
  const amountAll = sum(all.map((p) => p.amount));
  const products = all
    .sort((a, b) => b.amount - a.amount || b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, 20)
    .map((p, k) => ({
      rank: k + 1,
      plu: p.plu,
      name: p.name,
      quantity: Math.round(p.quantity * 1000) / 1000,
      amount: p.amount,
      mixPct: amountAll.isZero() ? 0 : r2(D(p.amount).div(amountAll).times(100)),
    }));
  return {
    year,
    week,
    from: mon,
    to: sun,
    growthPct,
    targetAmount: fixed != null ? fixed.toFixed(2) : null,
    complete: sun < i.today && i.openDate !== sun,
    days,
    totals: {
      real,
      prevWeek: tot((d) => d.prevWeek),
      lastYear: tot((d) => d.lastYear),
      target: tot((d) => d.target),
      vsPrevWeek: cmp(
        real,
        tot((d) => d.prevWeek, true),
      ),
      vsLastYear: cmp(
        real,
        tot((d) => d.lastYear, true),
      ),
      vsTarget: cmp(
        real,
        tot((d) => d.target, true),
      ),
    },
    notes: i.notes.filter((n) => n.date >= mon && n.date <= sun),
    products,
  };
}
