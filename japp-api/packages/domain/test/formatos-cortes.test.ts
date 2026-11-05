import { cutTicket, kitchenVoidTicket, renderText, WIDTH } from "../src/index.js";

/** 05/11/2026 · Corte X/Z con logo y el contenido de la vista previa del TPV; corte y anulación configurables. */
const base = {
  kind: "X" as const,
  store: { legalName: "DAILY FOOD VENTURES S.L.", taxId: "B12300141", tradeName: "Plaza Mayor", chain: "Cañas y Tapas", local: "Plaza Mayor", logoRaster: "HXYwAAEAAQD/" },
  station: "CAJA1",
  from: new Date("2026-11-05T07:00:00Z"),
  to: new Date("2026-11-05T19:00:00Z"),
  byMethod: [
    { name: "Tarjeta", amount: 363.46, count: 7 },
    { name: "Efectivo", amount: 107.62, count: 5 },
  ],
  tickets: 12,
  expectedCash: 267.62,
  user: "Sistemas",
  guests: 20,
  gross: 471.08,
  tax: 42.83,
  byArea: [{ name: "BARRA", tickets: 12, amount: 471.08 }],
  byWaiter: [{ name: "Barra", tickets: 12, amount: 471.08 }],
  discounts: [{ name: "DESCUENTO 20% THE FORK", count: 1, amount: 11.59 }],
  voids: [{ at: new Date("2026-11-05T18:55:00Z"), qty: 1, name: "CHAPATA Y PICOS", amount: 3.5, reason: "Error al marcar", by: "Sistemas", auth: "Encargado" }],
  credits: [{ number: "AB2026-000001", amount: -5 }],
  tips: 2,
  cashTips: 1,
  cash: { float: 150, cashSales: 107.62, withdrawals: 0, card: 363.46 },
};

describe("9 · corte X como la vista previa", () => {
  it("logo del local, cadena · local y todas las secciones; nada pasa de 48 columnas", () => {
    const L = cutTicket(base);
    expect(L[0]).toEqual({ k: "logo", raster: "HXYwAAEAAQD/" });
    const x = renderText(L);
    for (const s of ["Cañas y Tapas · Plaza Mayor", "CORTE X · RESUMEN DE VENTA", "COMENSALES", "TICKET MEDIO (NETO)", "VENTA BRUTA", "- IVA", "= VENTA NETA",
      "POR FORMA DE PAGO", "  7  Tarjeta", "POR ÁREA", "POR CAMARERO", "DESCUENTOS", "ELIMINACIONES", "CHAPATA Y PICOS", "ABONOS", "PROPINAS", "CAJA (EFECTIVO)", "= Efectivo esperado"]) {
      expect(x, s).toContain(s);
    }
    expect(x).not.toContain("NIF"); // el corte no lleva los datos fiscales salvo que el formato los pida
    expect(x.split("\n").every((l) => l.length <= WIDTH)).toBe(true);
  });
  it("cada parte se quita con su opción", () => {
    const x = renderText(cutTicket({ ...base, format: { logo: false, comensales: false, areas: false, camareros: false, descuentos: false, eliminaciones: false, abonos: false, propinas: false, iva: false, nif: true } }));
    expect(x).not.toContain("[LOGO]");
    for (const s of ["COMENSALES", "POR ÁREA", "POR CAMARERO", "DESCUENTOS", "ELIMINACIONES", "ABONOS", "PROPINAS", "VENTA BRUTA"]) {
      expect(x, s).not.toContain(s);
    }
    expect(x).toContain("NIF: B12300141");
    expect(x).toContain("Total ventas");
  });
  it("el Z lleva lo contado si el formato no lo quita", () => {
    const counted = { cash: 260, difference: -7.62, note: "Faltan monedas" };
    expect(renderText(cutTicket({ ...base, kind: "Z", counted }))).toContain("Efectivo contado");
    expect(renderText(cutTicket({ ...base, kind: "Z", counted, format: { contado: false } }))).not.toContain("Efectivo contado");
  });
});

describe("10 · comanda de anulación configurable", () => {
  const ctx = { channel: "BARRA", waiter: "Sistemas", table: { name: "12", area: "BARRA" }, at: new Date(), stage: "printed" as const, reason: "Error al marcar", authorizedBy: "Encargado" };
  it("por defecto, todo; cada parte se quita", () => {
    const all = renderText(kitchenVoidTicket([{ quantity: 1, name: "Chapata y picos" }], ctx));
    for (const s of ["ANULADO", "BARRA/ Sistemas", "ELIMINADO TRAS ENVIAR", "MOTIVO: ERROR AL MARCAR", "Autoriza: Encargado", "NO PREPARAR"]) {
      expect(all, s).toContain(s);
    }
    const few = renderText(kitchenVoidTicket([{ quantity: 1, name: "Chapata y picos" }], { ...ctx, format: { dibujo: false, motivo: false, autoriza: false, noPreparar: false, grande: false } }));
    for (const s of ["ANULADO", "MOTIVO", "Autoriza", "NO PREPARAR"]) {
      expect(few, s).not.toContain(s);
    }
    expect(few).toContain("-1  CHAPATA Y PICOS");
  });
});
