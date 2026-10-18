import { lineAmount, unitsAmount, accountTotals, discountAmount } from "../src/totals.js";
import { r2 } from "../src/money.js";
import { account, line } from "./helpers.js";

describe("dinero", () => {
  it("r2 redondea a céntimos sin errores de coma flotante", () => {
    expect(r2(0.1 + 0.2)).toBe(0.3);
    expect(r2(1.005)).toBe(1.01); // Math.round(1.005*100)/100 da 1 en JS; aquí es 1.01
    expect(r2(2.675)).toBe(2.68);
  });
});

describe("lineAmount", () => {
  it("cantidad × precio", () => expect(lineAmount(line({ quantity: 3, unitPrice: 2.5 }))).toBe(7.5));
  it("suma modificadores con su cantidad", () => {
    expect(lineAmount(line({ quantity: 2, unitPrice: 6, modifiers: [{ name: "Extra queso", unitPrice: 1.2, quantity: 2 }, { name: "Sin cebolla", unitPrice: 0 }] }))).toBe(16.8);
  });
  it("modificador sin cantidad cuenta 1", () => expect(lineAmount(line({ unitPrice: 10, modifiers: [{ name: "Alioli", unitPrice: 1.5 }] }))).toBe(11.5));
  it("importe de n unidades para pasar entre cuentas", () => {
    expect(unitsAmount(line({ quantity: 3, unitPrice: 2.5 }), 2)).toBe(5);
    expect(unitsAmount(line({ quantity: 0 }), 1)).toBe(0);
  });
});

describe("accountTotals", () => {
  const acc = () => account({ lines: [line({ quantity: 2, unitPrice: 10 }), line({ quantity: 4, unitPrice: 2.5 })] }); // 20 + 10 = 30

  it("cuenta vacía todo a cero", () => {
    expect(accountTotals(account())).toEqual({ sub: 0, disc: 0, total: 0, paid: 0, pending: 0, taxes: [] });
  });
  it("subtotal, total y pendiente sin descuentos ni pagos", () => {
    const t = accountTotals(acc());
    expect(t).toMatchObject({ sub: 30, disc: 0, total: 30, paid: 0, pending: 30 });
  });
  it("descuento porcentaje", () => {
    const t = accountTotals({ ...acc(), discounts: [{ id: "d", type: "percentage", value: 10, reason: "OTONO10", status: "applied" }] });
    expect(t).toMatchObject({ disc: 3, total: 27 });
  });
  it("descuento fijo nunca mayor que el subtotal", () => {
    const t = accountTotals({ ...acc(), discounts: [{ id: "d", type: "fixed", value: 50, reason: "Invitación", status: "applied" }] });
    expect(t).toMatchObject({ disc: 30, total: 0, pending: 0 });
  });
  it("varios descuentos suman pero se topan al subtotal", () => {
    const t = accountTotals({ ...acc(), discounts: [
      { id: "a", type: "percentage", value: 80, reason: "x", status: "applied" },
      { id: "b", type: "fixed", value: 10, reason: "y", status: "applied" }] });
    expect(t.disc).toBe(30);
  });
  it("ignora descuentos retirados", () => {
    const t = accountTotals({ ...acc(), discounts: [{ id: "d", type: "fixed", value: 5, reason: "x", status: "removed" }] });
    expect(t.disc).toBe(0);
  });
  it("solo cuentan los pagos confirmados; pendiente nunca negativo", () => {
    const base = acc();
    const p = (amount: number, status: any) => ({ id: String(amount), method: "card", kind: "card" as const, amount, tip: 0, cashGiven: null, change: null, status, collectedBy: { user: "x", role: "w", at: "" } });
    const t = accountTotals({ ...base, payments: [p(40, "declined"), p(20, "confirmed")] });
    expect(t).toMatchObject({ paid: 20, pending: 10 });
    expect(accountTotals({ ...base, payments: [p(35, "confirmed")] }).pending).toBe(0);
  });
  it("discountAmount", () => {
    expect(discountAmount({ type: "percentage", value: 15 }, 33.33)).toBe(5);
    expect(discountAmount({ type: "fixed", value: 3 }, 2)).toBe(2);
  });
});

describe("IVA por tipo", () => {
  it("10 % incluido: 11 € → base 10, cuota 1", () => {
    expect(accountTotals(account({ lines: [line({ unitPrice: 11, taxRate: 10 })] })).taxes).toEqual([{ rate: 10, base: 10, tax: 1 }]);
  });
  it("mezcla 10 % y 21 %, ordenado por tipo", () => {
    const t = accountTotals(account({ lines: [line({ unitPrice: 15, taxRate: 21 }), line({ unitPrice: 11, taxRate: 10 })] }));
    expect(t.taxes.map(x => x.rate)).toEqual([10, 21]);
    expect(t.taxes[1]).toEqual({ rate: 21, base: 12.4, tax: 2.6 });
  });
  it("el descuento se reparte en proporción entre tipos", () => {
    const t = accountTotals(account({
      lines: [line({ unitPrice: 22, taxRate: 10 }), line({ unitPrice: 24.2, taxRate: 21 })],
      discounts: [{ id: "d", type: "percentage", value: 50, reason: "x", status: "applied" }] }));
    expect(t.total).toBe(23.1);
    expect(t.taxes).toEqual([{ rate: 10, base: 10, tax: 1 }, { rate: 21, base: 10, tax: 2.1 }]);
  });
  it("base + cuota de cada tipo cuadra con el total (±1 céntimo por tipo)", () => {
    const t = accountTotals(account({ lines: [line({ quantity: 3, unitPrice: 2.35, taxRate: 10 }), line({ quantity: 1, unitPrice: 7.99, taxRate: 21 }), line({ quantity: 2, unitPrice: 1.1, taxRate: 4 })] }));
    const s = t.taxes.reduce((a, x) => a + x.base + x.tax, 0);
    expect(Math.abs(r2(s) - t.total)).toBeLessThanOrEqual(0.01 * t.taxes.length);
  });
});
