import { r2, sum } from "./money.js";
import { TZ } from "./invoice.js";

/**
 * Venta del día · cómo vamos y hasta dónde podemos llegar (GET /reports/sales → outlook).
 *
 * - Venta real en curso = lo facturado (cobrado) + lo que ya está marcado en mesas abiertas sin cobrar.
 * - Proyección = venta real / parte del día que suele estar hecha a esta hora. La parte del día sale de cómo se
 *   repartió la venta por horas en los cierres anteriores del mismo día de la semana (history); sin historia, de una
 *   curva por defecto de 14 horas desde la apertura (method "default").
 *   Así la barra enseña: cobrado · en mesas · proyección.
 */
export interface OutlookInput {
  invoiced: number;
  open: { amount: number; tables: number };
  /** Venta por hora (Madrid) de cierres anteriores comparables: [{"13": 210.4, "14": 380}, …]. */
  history: Record<string, number>[];
  /** Apertura del periodo y ahora. */
  openedAt: Date;
  now: Date;
}
export interface Outlook {
  current: number;
  invoiced: number;
  open: number;
  openTables: number;
  method: "history" | "default";
  historyDays: number;
  doneShare: number;
  projection: number;
  expectedByHour: { hour: number; amount: number }[];
}

/** Curva por defecto (peso de venta por hora desde la apertura, 14 horas). */
export const DEFAULT_SALES_CURVE = [6, 8, 10, 12, 12, 10, 8, 7, 7, 8, 9, 8, 6, 4];

/** Hora y minuto en Madrid. */
export function madridClock(d: Date): { hour: number; minute: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { hour: Number(p.hour), minute: Number(p.minute) };
}

/** Reparto de la venta por hora del día (24 horas, suma 1). Sin historia útil → null. */
export function hourShares(history: Record<string, number>[]): number[] | null {
  const tot = new Array<number>(24).fill(0);
  let days = 0;
  for (const h of history) {
    const s = Number(sum(Object.values(h ?? {}).map((v) => Math.max(0, Number(v) || 0))));
    if (s <= 0) {
      continue;
    }
    days++;
    for (const [k, v] of Object.entries(h)) {
      const hr = Number(k);
      if (Number.isInteger(hr) && hr >= 0 && hr < 24) {
        tot[hr]! += Math.max(0, Number(v) || 0) / s; // cada día pesa lo mismo, venda mucho o poco
      }
    }
  }
  if (!days) {
    return null;
  }
  return tot.map((x) => x / days);
}

export function salesOutlook(i: OutlookInput): Outlook {
  const invoiced = r2(i.invoiced);
  const open = r2(i.open.amount);
  const current = r2(sum([invoiced, open]));
  const start = madridClock(i.openedAt).hour;
  const nowC = madridClock(i.now);
  const order = (h: number) => (h - start + 24) % 24; // horas del día de negocio desde la apertura (cruza medianoche)
  const nowK = order(nowC.hour);
  const frac = nowC.minute / 60;

  // reparto por hora: historia o curva por defecto desde la apertura
  let shares = hourShares(i.history);
  const method: Outlook["method"] = shares ? "history" : "default";
  if (!shares) {
    const w = DEFAULT_SALES_CURVE.reduce((a, b) => a + b, 0);
    shares = new Array<number>(24).fill(0);
    DEFAULT_SALES_CURVE.forEach((v, k) => {
      shares![(start + k) % 24] = v / w;
    });
  }
  let done = 0;
  for (let h = 0; h < 24; h++) {
    const k = order(h);
    if (k < nowK) {
      done += shares[h]!;
    } else if (k === nowK) {
      done += shares[h]! * frac;
    }
  }
  // al empezar el día casi no hay muestra: la proyección no baja de lo que ya hay
  const projection = done > 0.02 ? r2(Math.max(current, current / done)) : current;

  const expectedByHour = shares
    .map((s, hour) => ({ hour, amount: r2(projection * s), k: order(hour) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => a.k - b.k)
    .map(({ hour, amount }) => ({ hour, amount }));

  return {
    current,
    invoiced,
    open,
    openTables: i.open.tables,
    method,
    historyDays:
      method === "history"
        ? i.history.filter((h) => Number(sum(Object.values(h ?? {}).map((v) => Number(v) || 0))) > 0).length
        : 0,
    doneShare: r2(done * 100) / 100,
    projection,
    expectedByHour,
  };
}
