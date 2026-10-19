import { creditTicket, renderText, renderEscPos, WIDTH } from "../src/tickets.js";
import { isRectificative } from "../src/credit.js";
import { summarizePeriod } from "../src/closings.js";
import { staffKpi } from "../src/staff.js";
import { stationMethods } from "../src/payments.js";

const STORE = {
  legalName: "DAILY FOOD VENTURES S.L.",
  tradeName: "Cañas y Tapas",
  taxId: "B02891075",
  footer: "IVA incluido · Gracias por su visita",
};
const tctx = {
  store: STORE,
  table: { name: "T5", area: "Terraza" },
  waiter: "Pedro",
  at: new Date("2026-10-13T16:40:00Z"),
};

describe("ticket de la factura rectificativa", () => {
  const credit = {
    type: "R5",
    invoiceNumber: "AB2026-000012",
    rectifies: "T2026-001426",
    issuedAt: "2026-10-13T16:40:00.000Z",
    reason: "Error al cobrar",
    lines: [
      { name: "Caña", quantity: 1, amount: 2.8 },
      { name: "Croquetas de jamón", quantity: 2, amount: 11.9 },
    ],
    total: -14.7,
    taxes: [{ rate: 10, base: -13.36, tax: -1.34 }],
    verifactuQr: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?numserie=AB2026-000012",
  };
  it("título, a qué factura rectifica, líneas y total en negativo, IVA y QR", () => {
    const lines = creditTicket(credit, tctx);
    const txt = renderText(lines);
    expect(txt).toContain("FACTURA RECTIFICATIVA");
    expect(txt).toContain("Nº Op.:    AB2026-000012");
    expect(txt).toContain("Rectifica a: T2026-001426");
    expect(txt).toContain("Motivo: Error al cobrar");
    expect(txt).toMatch(/1 {3}Caña +-2,80 €/);
    expect(txt).toMatch(/2 {3}Croquetas de jamón +-11,90 €/);
    expect(txt).toMatch(/Total \(Impuestos Incl\.\) +-14,70 €/);
    expect(txt).toContain("-13,36 €");
    expect(txt).toContain("VERI*FACTU");
    expect(lines.some((l) => l.k === "qr" && l.data === credit.verifactuQr)).toBe(true);
    expect(lines[lines.length - 1]).toEqual({ k: "cut" });
    for (const row of txt.split("\n")) {
      expect(row.length).toBeLessThanOrEqual(WIDTH);
    }
    expect(renderEscPos(lines).length).toBeGreaterThan(100);
  });
  it("sin motivo no pinta la línea del motivo", () => {
    expect(renderText(creditTicket({ ...credit, reason: null }, tctx))).not.toContain("Motivo:");
  });
});

describe("rectificativas en el resumen del periodo", () => {
  it("R1…R5 son rectificativas; F1, F2 y F3 no", () => {
    expect(["R1", "R2", "R5"].every(isRectificative)).toBe(true);
    expect(["F1", "F2", "F3", "", null, "R6"].some(isRectificative)).toBe(false);
  });
  it("un abono R5 resta venta y no cuenta como ticket ni mesa", () => {
    const base = { waiter: "Pedro", table: "1", guests: 2 };
    const s = summarizePeriod({
      openedAt: new Date("2026-10-13T08:00:00Z"),
      invoices: [
        {
          ...base,
          at: new Date("2026-10-13T12:00:00Z"),
          total: 20,
          base: 18.18,
          tax: 1.82,
          type: "F2",
          orderId: "o1",
        },
        {
          ...base,
          at: new Date("2026-10-13T13:00:00Z"),
          total: -5,
          base: -4.55,
          tax: -0.45,
          type: "R5",
          orderId: "o1",
        },
      ],
      payments: [],
      voids: [],
      discountAmount: 0,
      cashDifference: 0,
    });
    expect(s.grossSales).toBe(15);
    expect(s.tickets).toBe(1);
    expect(s.byWaiter).toEqual([{ name: "Pedro", sales: 15, tickets: 1, tables: 1 }]);
  });
});

describe("Camareros · KPI", () => {
  it("venta, tickets y mesas del resumen; anulaciones de sus mesas; ticket medio; más venta primero", () => {
    const rows = staffKpi(
      [
        { name: "Pedro", sales: 40, tickets: 3, tables: 2 },
        { name: "Ana", sales: 100, tickets: 2, tables: 2 },
      ],
      [
        { waiter: "Pedro", qty: 1, amount: 2.8 },
        { waiter: "Pedro", qty: 2, amount: 5.95 },
        { waiter: "Luis", qty: 1, amount: 1.5 },
      ],
      { Pedro: "u-pedro", Ana: "u-ana" },
    );
    expect(rows).toEqual([
      {
        userId: "u-ana",
        user: "Ana",
        tables: 2,
        tickets: 2,
        sales: 100,
        avgTicket: 50,
        voids: 0,
        voidsAmount: 0,
      },
      {
        userId: "u-pedro",
        user: "Pedro",
        tables: 2,
        tickets: 3,
        sales: 40,
        avgTicket: 13.33,
        voids: 3,
        voidsAmount: 8.75,
      },
      {
        userId: null,
        user: "Luis",
        tables: 0,
        tickets: 0,
        sales: 0,
        avgTicket: 0,
        voids: 1,
        voidsAmount: 1.5,
      },
    ]);
  });
});

describe("formas de pago de la estación", () => {
  const M = [
    { id: "1", code: "cash", kind: "cash", active: true },
    { id: "2", code: "card", kind: "card", active: true },
    { id: "3", code: "glovo", kind: "platform", active: false },
    { id: "4", code: "card2", kind: "card", active: true },
  ];
  it("sin configurar, todas las activas; en la PDA solo tarjeta; configuradas, solo esas", () => {
    expect(stationMethods(M, { kind: "station", methodIds: [] }).map((m) => m.code)).toEqual([
      "cash",
      "card",
      "card2",
    ]);
    expect(stationMethods(M, { kind: "pda", methodIds: [] }).map((m) => m.code)).toEqual(["card", "card2"]);
    expect(stationMethods(M, { kind: "station", methodIds: ["1", "3"] }).map((m) => m.code)).toEqual([
      "cash",
    ]);
  });
});
