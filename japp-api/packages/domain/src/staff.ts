import { D, r2, sum } from "./money.js";
import type { PeriodSummary } from "./closings.js";

/**
 * Camareros · KPI (GET /reports/staff), sobre el resumen del periodo (summarizePeriod) para no calcular dos veces:
 * - camarero = quien abrió la mesa; mesas, tickets y venta salen de summary.byWaiter (las rectificativas restan venta);
 * - ticket medio = venta / tickets (0 sin tickets);
 * - anulaciones = líneas borradas tras enviar (voidsOf) de las mesas que abrió, en unidades y en importe;
 * - un camarero con anulaciones y sin venta también sale; orden: más venta primero.
 */
export interface StaffVoid {
  waiter: string;
  qty: number;
  amount: number;
}
export interface StaffRow {
  userId: string | null;
  user: string;
  tables: number;
  tickets: number;
  sales: number;
  avgTicket: number;
  voids: number;
  voidsAmount: number;
}

export function staffKpi(
  byWaiter: PeriodSummary["byWaiter"],
  voids: StaffVoid[],
  userIds: Record<string, string | null> = {},
): StaffRow[] {
  const rows = new Map<string, StaffRow>();
  const rowOf = (name: string) => {
    let r = rows.get(name);
    if (!r) {
      r = {
        userId: userIds[name] ?? null,
        user: name,
        tables: 0,
        tickets: 0,
        sales: 0,
        avgTicket: 0,
        voids: 0,
        voidsAmount: 0,
      };
      rows.set(name, r);
    }
    return r;
  };
  for (const w of byWaiter) {
    const r = rowOf(w.name);
    r.tables = w.tables;
    r.tickets = w.tickets;
    r.sales = r2(w.sales);
    if (w.tickets > 0) {
      r.avgTicket = r2(D(w.sales).div(w.tickets));
    }
  }
  for (const v of voids) {
    const r = rowOf(v.waiter);
    r.voids = r.voids + v.qty;
    r.voidsAmount = r2(sum([r.voidsAmount, v.amount]));
  }
  return [...rows.values()].sort((a, b) => b.sales - a.sales || a.user.localeCompare(b.user));
}
