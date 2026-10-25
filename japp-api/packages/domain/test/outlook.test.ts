import { describe, expect, it } from "vitest";
import { hourShares, madridClock, salesOutlook } from "../src/index.js";

// 25/10/2026 es horario de invierno: Madrid = UTC+1
const at = (hhmm: string) => new Date(`2026-10-25T${hhmm}:00+01:00`);

describe("venta del día · proyección y potencial (salesOutlook)", () => {
  it("hora de Madrid", () => {
    expect(madridClock(at("18:45"))).toEqual({ hour: 18, minute: 45 });
  });

  it("reparto por hora: cada día pesa lo mismo; sin historia, null", () => {
    expect(hourShares([])).toBeNull();
    expect(hourShares([{}, { "13": 0 }])).toBeNull();
    const s = hourShares([
      { "13": 100, "14": 100 },
      { "13": 1000, "14": 3000 },
    ])!;
    expect(s[13]).toBeCloseTo(0.375);
    expect(s[14]).toBeCloseTo(0.625);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("venta real = cobrado + lo marcado en mesas abiertas", () => {
    const o = salesOutlook({
      invoiced: 125.15,
      open: { amount: 80.5, tables: 2 },
      history: [],
      openedAt: at("12:00"),
      now: at("12:00"),
    });
    expect([o.current, o.invoiced, o.open, o.openTables]).toEqual([205.65, 125.15, 80.5, 2]);
    // recién abierto: no se proyecta por debajo de lo que ya hay
    expect(o.projection).toBe(205.65);
  });

  it("con historia: proyecta con la parte del día hecha a esta hora (cruza medianoche)", () => {
    const history = [{ "20": 100, "21": 100, "22": 100, "23": 100 }];
    const o = salesOutlook({
      invoiced: 150,
      open: { amount: 50, tables: 1 },
      history,
      openedAt: at("19:30"),
      now: at("22:00"), // hechas 20 y 21 → 50 %
    });
    expect(o.method).toBe("history");
    expect(o.doneShare).toBe(0.5);
    expect(o.projection).toBe(400);
    expect(o.expectedByHour).toEqual([
      { hour: 20, amount: 100 },
      { hour: 21, amount: 100 },
      { hour: 22, amount: 100 },
      { hour: 23, amount: 100 },
    ]);
    // de madrugada (01:00) cuenta como el mismo día de negocio: todo hecho
    const late = salesOutlook({
      invoiced: 400,
      open: { amount: 0, tables: 0 },
      history,
      openedAt: at("19:30"),
      now: new Date("2026-10-26T01:00:00+01:00"),
    });
    expect(late.doneShare).toBe(1);
    expect(late.projection).toBe(400);
  });

  it("sin historia usa la curva por defecto desde la apertura", () => {
    const o = salesOutlook({
      invoiced: 100,
      open: { amount: 0, tables: 0 },
      history: [],
      openedAt: at("12:10"),
      now: at("14:00"),
    });
    expect(o.method).toBe("default");
    // 12 y 13 hechas: (6 + 8) / 115
    expect(o.doneShare).toBe(0.1217);
    expect(o.projection).toBe(821.43);
    expect(o.expectedByHour[0]!.hour).toBe(12);
  });
});
