import { addProduct, registerPayment, expectedCash, cutTicket, renderText } from "../src/index.js";
import { account, line, ctx } from "./helpers.js";

/** Cierre de facturación (04/11/2026): productos de 0 € que se tican, propina con todas las formas de pago y corte Z con lo contado. */
const P = (price: number) => ({ plu: 9001, name: "CON HIELO", price, taxRate: 10 }) as any;
const AREA = { id: "", name: "Barra", priceList: 1 } as any;

describe("9 · los productos de 0 € se tican", () => {
  it("un calificativo de 0 € entra en la cuenta (solo o con respuestas)", () => {
    expect(addProduct(account(), { product: P(0), area: AREA, quantity: 1 }, ctx()).lines).toHaveLength(1);
    const a = addProduct(account(), { product: P(0), area: AREA, quantity: 1, modifiers: [{ name: "Ron", unitPrice: 6, quantity: 1 }] as any }, ctx());
    expect(a.lines).toHaveLength(1);
  });
});

describe("N3 · propina con cualquier forma de pago", () => {
  const acc = () => account({ lines: [line({ productId: 1, name: "Caña", quantity: 1, unitPrice: 10, taxRate: 10 })] });
  it("en efectivo: lo entregado cubre cuenta + propina y el cambio es lo que sobra", () => {
    const r = registerPayment(acc(), { method: "cash", kind: "cash", amount: null, tip: 2, cashGiven: 20 } as any, ctx());
    expect([r.payment.amount, r.payment.tip, r.payment.change]).toEqual([10, 2, 8]);
    expect(() => registerPayment(acc(), { method: "cash", kind: "cash", amount: null, tip: 2, cashGiven: 11 } as any, ctx())).toThrow(/no llega/);
  });
  it("con otra forma de pago también se guarda", () => {
    expect(registerPayment(acc(), { method: "bizum", kind: "other", amount: null, tip: 1 } as any, ctx()).payment.tip).toBe(1);
  });
  it("la propina en efectivo cuenta en el efectivo esperado (no en ventas)", () => {
    const e = expectedCash(100, [{ kind: "cash", amount: 10, tip: 2 }, { kind: "card", amount: 5, tip: 1 }], []);
    expect([e.cashSales, e.cashTips, e.expected]).toEqual([10, 2, 112]);
  });
});

describe("11 · corte Z con lo contado, la diferencia y el motivo", () => {
  it("lo pinta cuando el periodo ya se cerró", () => {
    const base = { kind: "Z" as const, store: { legalName: "X SL", taxId: "B1" }, from: new Date(), to: new Date(), byMethod: [{ name: "Efectivo", amount: 10 }], tickets: 1, expectedCash: 110, user: "Ana" };
    const txt = renderText(cutTicket({ ...base, cashTips: 2, counted: { cash: 105, card: 40, difference: -5, note: "Faltan 5 € del cambio" } }));
    expect(txt).toContain("Propinas en efectivo");
    expect(txt).toContain("Efectivo contado");
    expect(txt).toContain("Tarjeta contada");
    expect(txt).toMatch(/Diferencia\s+-5,00 €/);
    expect(txt).toContain("Motivo: Faltan 5 € del cambio");
    expect(renderText(cutTicket({ ...base, counted: { cash: 110, difference: 0 } }))).toMatch(/Diferencia\s+cuadra/);
  });
});
