import { cutTicket, kitchenTicket, kitchenVoidTicket, preBillTicket, renderText, WIDTH } from "../src/index.js";

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

const ALL = { comensales: true, ticketMedio: true, iva: true, areas: true, camareros: true, descuentos: true, eliminaciones: true, abonos: true, caja: true };

describe("9 · corte X como la vista previa", () => {
  it("logo del local, cadena · local y todas las secciones; nada pasa de 48 columnas", () => {
    const L = cutTicket({ ...base, format: ALL });
    expect(L[0]).toEqual({ k: "logo", raster: "HXYwAAEAAQD/" });
    const x = renderText(L);
    for (const s of ["Cañas y Tapas · Plaza Mayor", "CORTE X · RESUMEN DE VENTA", "COMENSALES", "TICKET MEDIO (NETO)", "VENTA BRUTA", "- IVA", "= VENTA NETA",
      "POR FORMA DE PAGO", "  7  Tarjeta", "POR ÁREA", "POR CAMARERO", "DESCUENTOS", "ELIMINACIONES", "CHAPATA Y PICOS", "ABONOS", "PROPINAS", "CAJA (EFECTIVO)", "= Efectivo esperado"]) {
      expect(x, s).toContain(s);
    }
    expect(x).not.toContain("NIF"); // el corte no lleva los datos fiscales salvo que el formato los pida
    expect(x.split("\n").every((l) => l.length <= WIDTH)).toBe(true);
  });
  it("11/11 (D2) · sin formato, el corte X normal solo lleva ventas, formas de pago y propinas", () => {
    const x = renderText(cutTicket(base));
    for (const s of ["CORTE X · RESUMEN DE VENTA", "TICKETS", "Total ventas", "POR FORMA DE PAGO", "PROPINAS"]) {
      expect(x, s).toContain(s);
    }
    for (const s of ["COMENSALES", "TICKET MEDIO", "VENTA BRUTA", "POR ÁREA", "POR CAMARERO", "DESCUENTOS", "ELIMINACIONES", "ABONOS", "CAJA (EFECTIVO)"]) {
      expect(x, s).not.toContain(s);
    }
    // el Z sigue con todo
    expect(renderText(cutTicket({ ...base, kind: "Z" }))).toContain("CAJA (EFECTIVO)");
  });
  it("11/11 (D2) · resumen del arqueo: todas las partes, cada datáfono y la diferencia de tarjeta", () => {
    const counted = {
      cash: 267.62,
      difference: 0,
      card: 363.46,
      expectedCard: 360,
      cards: [
        { name: "Datáfono 1", amount: 200 },
        { name: "Datáfono 2", amount: 163.46 },
      ],
    };
    const x = renderText(cutTicket({ ...base, arqueo: true, counted, format: { areas: false } }));
    for (const s of ["ARQUEO · RESUMEN DE CAJA", "POR ÁREA", "CAJA (EFECTIVO)", "Datáfono 1", "Datáfono 2", "Total datáfonos", "Tarjeta en el sistema", "Diferencia tarjeta"]) {
      expect(x, s).toContain(s);
    }
    expect(x).toContain("+3,46 €");
    expect(x.split("\n").every((l) => l.length <= WIDTH)).toBe(true);
  });
  it("11/11 (D2) · el Z dice el fondo que se queda y lo que se deposita", () => {
    const counted = { cash: 400, difference: 0, nextFloat: 145, deposit: 255 };
    const z = renderText(cutTicket({ ...base, kind: "Z", counted }));
    expect(z).toContain("Fondo para el día siguiente");
    expect(z).toContain("A depositar");
    expect(z).toContain("255,00 €");
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

describe("11/11 · comanda con el local (A8) y nombre del cliente en fast food (A4)", () => {
  const kctx = { channel: "BEBIDA", waiter: "Sistemas", guests: 1, table: { name: "FASTFOOD", area: "FASTFOOD" }, at: new Date("2026-11-11T09:00:00Z") };
  const lines = [{ quantity: 2, name: "Aquarade limón", comment: "", modifiers: [] }];
  it("la comanda lleva arriba el código y el nombre del local; se quita en Formatos › Comanda", () => {
    const L = kitchenTicket(lines, { ...kctx, store: "JC01 · Cañas" });
    expect(L[0]).toMatchObject({ k: "text", text: "JC01 · Cañas" });
    expect(renderText(kitchenTicket(lines, { ...kctx, store: "JC01 · Cañas", format: { local: false } }))).not.toContain("JC01");
    expect(renderText(kitchenTicket(lines, kctx))).not.toContain("JC01");
  });
  it("1.2.296 · en fast food no sale «Mesa FF-CAJA1 FASTFOOD» en grande: «Fast food · CAJA1» en letra normal", () => {
    const L = kitchenTicket(lines, { ...kctx, table: { name: "FF-CAJA1", area: "FASTFOOD" }, customer: "Jei" });
    const x = renderText(L);
    expect(x).not.toContain("Mesa");
    expect(L.find((l: any) => l.k === "text" && l.text === "Fast food · CAJA1")).not.toHaveProperty("size");
    expect(L.find((l: any) => l.k === "text" && /^\d\d:\d\d:\d\d$/.test(l.text))).toMatchObject({ size: "wh" }); // la hora, grande
    expect(L.find((l: any) => l.k === "text" && l.text === "JEI")).toMatchObject({ size: "wh" });
    expect(renderText(kitchenTicket(lines, { ...kctx, table: { name: "12", area: "TERRAZA" } }))).toContain("Mesa 12 TERRAZA");
  });
  it("con nombre del cliente, sale grande debajo de la mesa y en la precuenta", () => {
    const x = renderText(kitchenTicket(lines, { ...kctx, customer: "Lucía" }));
    expect(x).toContain("LUCÍA");
    const acc = { id: "a", name: "Cuenta 1", status: "open", lines: [], deletedLines: [], discounts: [], payments: [], guests: 1 } as any;
    const store = { legalName: "X S.L.", taxId: "B1", tradeName: "Cañas" };
    const p = renderText(preBillTicket(acc, { store, table: { name: "FASTFOOD", area: "FASTFOOD" }, waiter: "S", at: new Date(), customerName: "Lucía" }));
    expect(p).toContain("Cliente: Lucía");
  });
});

describe("11/11 · la anulación también dice el local", () => {
  const ctx = { channel: "BARRA", waiter: "Sistemas", table: { name: "1", area: "BARRA" }, at: new Date(), stage: "printed" as const, reason: "Error al marcar" };
  it("antes de la mesa; se quita con el formato (local)", () => {
    const x = renderText(kitchenVoidTicket([{ quantity: 1, name: "Huevos trufados" }], { ...ctx, store: "JC01 · Cañas" }));
    expect(x).toMatch(/JC01 · Cañas[\s\S]*Mesa BARRA\/1/);
    expect(renderText(kitchenVoidTicket([{ quantity: 1, name: "Huevos trufados" }], { ...ctx, store: "JC01 · Cañas", format: { local: false } }))).not.toContain("JC01");
  });
});
