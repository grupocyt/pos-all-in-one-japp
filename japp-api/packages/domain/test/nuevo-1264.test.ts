import {
  DomainError,
  normalizeBranding,
  weekMonday,
  weekPct,
  weekSummary,
  nextDeliveryStatus,
  deliveryLight,
  deliveryTotal,
  assertDeliveryCancel,
} from "../src/index.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
};

describe("Resumen semana (weekSummary, como wkLocal del TPV)", () => {
  it("lunes de la semana y comparativa de la hoja (real − ref) / real", () => {
    expect(weekMonday("2026-11-05")).toBe("2026-11-02");
    expect(weekMonday("2026-11-08")).toBe("2026-11-02");
    expect(weekMonday("2026-11-02")).toBe("2026-11-02");
    expect(weekPct(3409.63, 3120.4)).toBe(8.48);
    expect(weekPct(100, 0)).toBeNull();
    expect(weekPct(null, 10)).toBeNull();
  });

  const base = {
    date: "2026-11-04",
    today: "2026-11-04",
    openDate: "2026-11-04",
    notes: [],
    products: [[], [], [], [], [], [], []],
  };

  it("días, semana anterior, año anterior (364 días) y proyección con el % de la semana", () => {
    const r = weekSummary({
      ...base,
      days: {
        "2026-11-02": { sales: 1000, tickets: 40 },
        "2026-11-03": { sales: 500, tickets: 20 },
        "2026-11-04": { sales: 300, tickets: 10 },
        "2026-10-26": { sales: 800, tickets: 32 },
        "2025-11-03": { sales: 900, tickets: 36 },
        "2025-11-09": { sales: 700, tickets: 28 },
      },
      targets: [
        { week: 0, growthPct: 5, amount: null },
        { week: 45, growthPct: 10, amount: null },
      ],
    });
    expect(r).toMatchObject({ year: 2026, week: 45, from: "2026-11-02", to: "2026-11-08", growthPct: 10 });
    expect(r.complete).toBe(false);
    const [mon, , wed, thu, , , sun] = r.days;
    expect(mon!.real).toEqual({ sales: 1000, tickets: 40, avg: 25 });
    expect(mon!.prevWeek).toMatchObject({ date: "2026-10-26", sales: 800, tickets: 32 });
    expect(mon!.lastYear).toMatchObject({ date: "2025-11-03", sales: 900 });
    expect(mon!.target).toEqual({ sales: 990, tickets: 40, avg: 24.75 });
    expect(mon!.vsPrevWeek.sales).toBe(20);
    expect(mon!.vsTarget.sales).toBe(1);
    expect(wed!.open).toBe(true);
    expect(thu!.real).toBeNull();
    expect(thu!.vsTarget).toEqual({ sales: null, tickets: null, avg: null });
    expect(sun!.target.sales).toBe(770);
    // totales: venta de toda la semana; comparativas solo con los días con venta real (lunes a miércoles)
    expect(r.totals.real).toEqual({ sales: 1800, tickets: 70, avg: 25.71 });
    expect(r.totals.target.sales).toBe(1760);
    expect(r.totals.vsTarget.sales).toBe(45); // (1800 − 990) / 1800
  });

  it("importe fijo de la semana: se reparte por días en proporción al año anterior", () => {
    const r = weekSummary({
      ...base,
      days: { "2025-11-03": { sales: 300, tickets: 10 }, "2025-11-04": { sales: 100, tickets: 5 } },
      targets: [{ week: 45, growthPct: 0, amount: 2000 }],
    });
    expect(r.targetAmount).toBe("2000.00");
    expect(r.days[0]!.target.sales).toBe(1500);
    expect(r.days[1]!.target.sales).toBe(500);
    expect(r.days[2]!.target.sales).toBe(0);
  });

  it("semana terminada, observaciones y productos con su % de mezcla (los 20 primeros)", () => {
    const r = weekSummary({
      ...base,
      today: "2026-11-10",
      openDate: "2026-11-10",
      days: {},
      targets: [],
      notes: [{ date: "2026-11-03", note: "Lluvia", version: 1, updatedBy: "Sistemas", updatedAt: "x" }],
      products: [
        [
          { plu: 1, name: "Caña", quantity: 10, amount: 30 },
          { plu: 2, name: "Bravas", quantity: 2, amount: 10 },
        ],
        [{ plu: 1, name: "Caña", quantity: 20, amount: 60 }],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    expect(r.complete).toBe(true);
    expect(r.days[1]!.note).toBe("Lluvia");
    expect(r.products).toEqual([
      { rank: 1, plu: 1, name: "Caña", quantity: 30, amount: 90, mixPct: 90 },
      { rank: 2, plu: 2, name: "Bravas", quantity: 2, amount: 10, mixPct: 10 },
    ]);
  });
});

describe("Sistema (normalizeBranding)", () => {
  const ok = { name: " Japp ", palette: [{ hex: "#15616d" }] };
  it("limpia textos, pasa a mayúsculas y marca el primero por defecto", () => {
    const b = normalizeBranding({ ...ok, subtitle: "  ", colors: { err: "#b3261e", ok: "" } });
    expect(b).toMatchObject({ name: "Japp", subtitle: null, colors: { err: "#B3261E" } });
    expect(b.palette).toEqual([{ hex: "#15616D", name: "#15616D", default: true }]);
  });
  it("errores: nombre vacío, paleta vacía o con más de 12, dos por defecto, color desconocido, logo grande", () => {
    expect(code(() => normalizeBranding({ ...ok, name: " " }))).toBe("VALIDATION");
    expect(code(() => normalizeBranding({ ...ok, palette: [] }))).toBe("VALIDATION");
    expect(code(() => normalizeBranding({ ...ok, palette: Array(13).fill({ hex: "#000000" }) }))).toBe(
      "VALIDATION",
    );
    expect(
      code(() =>
        normalizeBranding({
          ...ok,
          palette: [
            { hex: "#000000", default: true },
            { hex: "#111111", default: true },
          ],
        }),
      ),
    ).toBe("VALIDATION");
    expect(code(() => normalizeBranding({ ...ok, colors: { fondo: "#000000" } }))).toBe("VALIDATION");
    expect(code(() => normalizeBranding({ ...ok, logo: "http://x/logo.png" }))).toBe("VALIDATION");
    expect(
      code(() => normalizeBranding({ ...ok, logo: "data:image/png;base64," + "A".repeat(190_000) })),
    ).toBe("TOO_LARGE");
  });
});

describe("Delivery (estados, semáforo y total)", () => {
  it("orden de los estados; terminado → INVALID_TRANSITION", () => {
    expect(nextDeliveryStatus("pending")).toBe("received");
    expect(nextDeliveryStatus("received")).toBe("to_assign");
    expect(nextDeliveryStatus("to_assign")).toBe("assigned");
    expect(nextDeliveryStatus("assigned")).toBe("on_route");
    expect(nextDeliveryStatus("on_route")).toBe("delivered");
    expect(code(() => nextDeliveryStatus("delivered"))).toBe("INVALID_TRANSITION");
    expect(code(() => nextDeliveryStatus("cancelled"))).toBe("INVALID_TRANSITION");
    expect(code(() => assertDeliveryCancel("delivered"))).toBe("INVALID_TRANSITION");
    expect(code(() => assertDeliveryCancel("on_route"))).toBeNull();
  });
  it("semáforo desde que llegó: verde, ámbar y rojo; null si está terminado", () => {
    const at = "2026-11-02T21:00:00.000Z";
    const s = { amberMinutes: 15, redMinutes: 30 };
    expect(deliveryLight("received", at, new Date("2026-11-02T21:14:59Z"), s)).toEqual({
      wait: 14,
      light: "green",
    });
    expect(deliveryLight("received", at, new Date("2026-11-02T21:15:00Z"), s).light).toBe("amber");
    expect(deliveryLight("assigned", at, new Date("2026-11-02T21:31:00Z"), s).light).toBe("red");
    expect(deliveryLight("delivered", at, new Date("2026-11-02T21:31:00Z"), s).light).toBeNull();
  });
  it("total = Σ cantidad × precio, redondeado a céntimos", () => {
    expect(
      deliveryTotal([
        { quantity: 2, unitPrice: 5.5 },
        { quantity: 1, unitPrice: 11.9 },
        { quantity: 3, unitPrice: 0.333 },
      ]),
    ).toBe(23.9);
  });
});
