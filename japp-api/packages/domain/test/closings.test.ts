import { businessDate, isoWeek, isoWeekStart, isoWeeksInYear, summarizePeriod, weeksReport, weeksTotals, addDays } from "../src/closings.js";

describe("Gestor de cierres · fechas", () => {
  it("semana ISO y su lunes (el 29/12/2025 ya es la S1 de 2026)", () => {
    expect(isoWeek("2026-10-15")).toEqual({ year: 2026, week: 42 });
    expect(isoWeek("2025-12-29")).toEqual({ year: 2026, week: 1 });
    expect(isoWeekStart(2026, 1)).toBe("2025-12-29");
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeeksInYear(2025)).toBe(52);
  });
  it("día de negocio en Madrid: un periodo abierto a las 23:30 UTC del 14 es del 15", () => {
    expect(businessDate(new Date("2026-10-14T08:00:00Z"))).toBe("2026-10-14");
    expect(businessDate(new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
  });
});

describe("Gestor de cierres · resumen del periodo", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 14, h - 2, 10)); // hora de Madrid (CEST = UTC+2)
  const s = summarizePeriod({
    openedAt: at(10), discountAmount: 3, cashDifference: -0.5,
    invoices: [
      { at: at(13), total: 30, base: 27.27, tax: 2.73, waiter: "Marta", table: "1", orderId: "o1", guests: 2, type: "F2" },
      { at: at(13), total: 12.5, base: 11.36, tax: 1.14, waiter: "Marta", table: "2", orderId: "o2", guests: 1, type: "F2" },
      { at: at(21), total: 60, base: 54.55, tax: 5.45, waiter: "Pedro", table: "3", orderId: "o3", guests: 4, type: "F1" },
      { at: at(22), total: -12.5, base: -11.36, tax: -1.14, waiter: "Marta", table: "2", orderId: "o2", guests: 1, type: "R1" },
    ],
    payments: [{ method: "cash", kind: "cash", amount: 42.5, tip: 0 }, { method: "card", kind: "card", amount: 60, tip: 2 }],
    voids: [{ at: at(14), name: "Caña", qty: 2, amount: 5, reason: "motErr", by: "Marta", auth: "Sistemas" }],
  });
  it("venta neta de rectificativas, tickets sin R1, comensales por mesa", () => {
    expect(s.grossSales).toBe(90);
    expect(s.tickets).toBe(3);
    expect(s.guests).toBe(7);
    expect(s.taxBase).toBe(81.82);
  });
  it("por hora (Madrid), por camarero, por forma de pago y anulaciones", () => {
    expect(s.byHour).toEqual({ "13": 42.5, "21": 60, "22": -12.5 });
    expect(s.byWaiter).toEqual([{ name: "Pedro", sales: 60, tickets: 1, tables: 1 }, { name: "Marta", sales: 30, tickets: 2, tables: 2 }]);
    expect([s.cashAmount, s.cardAmount, s.tips]).toEqual([42.5, 60, 2]);
    expect([s.voidsCount, s.voidsAmount, s.discountAmount, s.cashDifference]).toEqual([2, 5, 3, -0.5]);
    expect(s.businessDate).toBe("2026-10-14");
  });
});

describe("Gestor de cierres · 52 semanas", () => {
  // 100 €/día en 2025 y 110 €/día en 2026 hasta el jueves 15/10/2026
  const days = [] as { date: string; sales: number }[];
  for (let d = "2024-12-30"; d <= "2026-10-15"; d = addDays(d, 1)) days.push({ date: d, sales: d >= "2025-12-29" ? 110 : 100 });
  const rows = weeksReport(2026, days, [{ week: 0, growthPct: 5, amount: null }, { week: 50, growthPct: 0, amount: 1000 }], "2026-10-15");
  it("semanas cerradas: real, año anterior y proyección = AA × 1,05", () => {
    const w1 = rows[0]!;
    expect([w1.real, w1.prev, w1.proj]).toEqual([770, 700, 735]);
  });
  it("semana en curso: se compara con los mismos días (jueves = 4)", () => {
    const w = rows.find(r => r.current)!;
    expect([w.week, w.daysElapsed, w.real, w.prev, w.prevFull, w.proj]).toEqual([42, 4, 440, 400, 700, 420]);
  });
  it("futuro sin real; objetivo de importe fijo en la S50; 53 semanas en 2026", () => {
    expect(rows).toHaveLength(53);
    expect(rows.find(r => r.week === 43)!.real).toBeNull();
    expect(rows.find(r => r.week === 50)!.projFull).toBe(1000);
  });
  it("totales: +10 % sobre el año anterior y ≈ +4,8 % sobre la proyección", () => {
    const t = weeksTotals(rows);
    expect(t.weeksClosed).toBe(41);
    expect(t.vsPrevPct).toBe(10);
    expect(t.vsProjPct).toBe(4.76);
  });
});

describe("anulaciones (una regla para eliminaciones, cierres y transacciones)", () => {
  const row = (o: Partial<import("../src/closings.js").DeletedRow>) => ({ reason: "Error", stage: "printed", quantity: 2, unitPrice: 3, modifiers: [], ...o });
  it("importe con modificadores; solo lo eliminado tras enviar; sin «Pasada a…» ni «Incluida en menú»", async () => {
    const { voidsOf, voidAmount, deletedStageOf } = await import("../src/closings.js");
    expect(voidAmount(row({ modifiers: [{ unitPrice: 0.5, quantity: 1 }] }))).toBe(7);
    const v = voidsOf([row({}), row({ stage: "preBill" }), row({ stage: "pendingPrint" }), row({ reason: "Pasada a Cuenta 2" }), row({ reason: "Incluida en menú" }), row({ stage: null, printed: true })]);
    expect(v.map(x => [x.stage, x.amount])).toEqual([["printed", 6], ["preBill", 6], ["printed", 6]]);
    expect(deletedStageOf({ stage: null, printed: false })).toBe("pendingPrint");
  });
});
