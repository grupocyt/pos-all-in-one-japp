import { kitchenVoidTicket, tableChangeTicket } from "../src/kitchenNotices.js";
import { renderText, renderEscPos } from "../src/tickets.js";

const at = new Date("2026-10-25T12:05:09Z"); // 13:05:09 en Madrid

describe("comanda de anulación", () => {
  it("tras enviar a cocina: ANULADO, canal/camarero, mesa, motivo, autoriza, -N y NO PREPARAR", () => {
    const t = kitchenVoidTicket([{ quantity: 2, name: "Bitter", modifiers: [{ name: "Con hielo" }] }], {
      channel: "Bebida",
      waiter: "Mesero",
      table: { name: "12", area: "Barra" },
      at,
      stage: "printed",
      reason: "Error de marcado",
      authorizedBy: "Sistemas",
    });
    const txt = renderText(t);
    for (const s of [
      "*** ANULADO ***",
      "BEBIDA/ Mesero",
      "13:05:09",
      "Mesa Barra/12",
      "ELIMINADO TRAS ENVIAR A COCINA",
      "MOTIVO: ERROR DE MARCADO",
      "Autoriza: Sistemas",
      "-2  BITTER",
      "-- 2 CON HIELO",
      "*** NO PREPARAR ***",
    ]) {
      expect(txt).toContain(s);
    }
    expect(t[t.length - 1]).toEqual({ k: "cut" });
  });
  it("tras la precuenta lo dice; sin autorizador no sale la línea", () => {
    const txt = renderText(
      kitchenVoidTicket([{ quantity: 1, name: "Caña" }], {
        channel: "Bebida",
        waiter: "Mesero",
        table: { name: "3", area: "" },
        at,
        stage: "preBill",
        reason: "Cliente",
      }),
    );
    expect(txt).toContain("ELIMINADO TRAS LA PRECUENTA");
    expect(txt).toContain("Mesa 3");
    expect(txt).not.toContain("Autoriza");
  });
});

describe("aviso de cambio de mesa", () => {
  it("de qué mesa a cuál, la nueva en grande; con cuenta si solo pasa una", () => {
    const t = tableChangeTicket({
      channel: "Comida",
      waiter: "Mesero",
      from: { name: "5", area: "Salon" },
      to: { name: "12", area: "Terraza" },
      account: "Cuenta 2",
      at,
    });
    const txt = renderText(t);
    expect(txt).toContain("CAMBIO DE MESA");
    expect(txt).toContain("DE: Mesa Salon/5");
    expect(txt).toContain("A: Mesa Terraza/12");
    expect(txt).toContain("Solo Cuenta 2");
    expect(t).toContainEqual({
      k: "text",
      text: "A: Mesa Terraza/12",
      align: "center",
      size: "wh",
      bold: true,
    });
    expect(renderEscPos(t).length).toBeGreaterThan(50);
  });
});

import { priceListMove, repriceToTerrace } from "../src/transfer.js";
describe("cambio de mesa entre tarifas (1.2.195)", () => {
  it("general → terraza sí (hay que pasar a PVP terraza); terraza → general → 422 en toTableId; igual → nada", () => {
    expect(priceListMove("general", "terrace")).toBe(true);
    expect(priceListMove(null, "terrace")).toBe(true);
    expect(priceListMove("terrace", "terrace")).toBe(false);
    expect(priceListMove("general", null)).toBe(false);
    try {
      priceListMove("terrace", "general");
      throw new Error("no falló");
    } catch (e: any) {
      expect([e.code, e.details.field, e.details.fromPriceList, e.details.toPriceList]).toEqual([
        "VALIDATION",
        "toTableId",
        "terrace",
        "general",
      ]);
    }
  });
  it("repriceToTerrace: solo cuentas sin facturar y productos con PVP terraza > 0", () => {
    const L = (productId: number, unitPrice: number) => ({
      productId,
      unitPrice,
      name: `P${productId}`,
      quantity: 2,
    });
    const r = repriceToTerrace(
      [
        { status: "open", lines: [L(1, 2), L(2, 3), L(3, 4)] },
        { status: "invoiced", lines: [L(1, 2)] },
      ],
      new Map<number, number | null>([
        [1, 2.2],
        [2, null],
        [3, 0],
      ]),
    );
    expect(r.accounts[0]!.lines.map((l) => l.unitPrice)).toEqual([2.2, 3, 4]);
    expect(r.accounts[1]!.lines[0]!.unitPrice).toBe(2);
    expect(r.changed).toEqual([{ name: "P1", from: 2, to: 2.2, quantity: 2 }]);
  });
});
