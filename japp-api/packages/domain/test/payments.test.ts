import { registerPayment, equalParts } from "../src/payments.js";
import { DomainError } from "../src/errors.js";
import { account, line, ctx } from "./helpers.js";

const acc = () => account({ lines: [line({ quantity: 1, unitPrice: 23.5 })] });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("cobro en efectivo", () => {
  it("devuelve el cambio y deja la cuenta saldada", () => {
    const r = registerPayment(acc(), { method: "cash", kind: "cash", amount: 23.5, cashGiven: 50 }, ctx());
    expect(r.payment).toMatchObject({ amount: 23.5, cashGiven: 50, change: 26.5, tip: 0, status: "confirmed" });
    expect(r.settled).toBe(true);
  });
  it("sin indicar lo entregado se entiende exacto", () => {
    expect(registerPayment(acc(), { method: "cash", kind: "cash", amount: 23.5 }, ctx()).payment.change).toBe(0);
  });
  it("entregado menor que lo cobrado → VALIDATION", () => {
    expect(code(() => registerPayment(acc(), { method: "cash", kind: "cash", amount: 23.5, cashGiven: 20 }, ctx()))).toBe("VALIDATION");
  });
  it("en efectivo no hay propina", () => {
    expect(registerPayment(acc(), { method: "cash", kind: "cash", amount: 23.5, cashGiven: 30, tip: 3 }, ctx()).payment.tip).toBe(0);
  });
});

describe("cobro con tarjeta", () => {
  it("admite propina, que no cuenta para saldar", () => {
    const r = registerPayment(acc(), { method: "card", kind: "card", amount: 10, tip: 2 }, ctx());
    expect(r.payment).toMatchObject({ amount: 10, tip: 2, change: null });
    expect(r.settled).toBe(false);
  });
  it("propina negativa → VALIDATION", () => {
    expect(code(() => registerPayment(acc(), { method: "card", kind: "card", amount: 10, tip: -1 }, ctx()))).toBe("VALIDATION");
  });
});

describe("reglas generales", () => {
  it("nunca cobra más de lo pendiente", () => {
    expect(registerPayment(acc(), { method: "card", kind: "card", amount: 100 }, ctx()).payment.amount).toBe(23.5);
  });
  it("cobros parciales hasta saldar", () => {
    let a = acc();
    const r1 = registerPayment(a, { method: "card", kind: "card", amount: 10 }, ctx()); a = r1.account;
    const r2 = registerPayment(a, { method: "bizum", kind: "other", amount: 13.5 }, ctx());
    expect([r1.settled, r2.settled]).toEqual([false, true]);
  });
  it("importe 0 o cuenta ya saldada → VALIDATION", () => {
    expect(code(() => registerPayment(acc(), { method: "card", kind: "card", amount: 0 }, ctx()))).toBe("VALIDATION");
    const paid = registerPayment(acc(), { method: "card", kind: "card", amount: 23.5 }, ctx()).account;
    expect(code(() => registerPayment(paid, { method: "card", kind: "card", amount: 1 }, ctx()))).toBe("VALIDATION");
  });
  it("cuenta facturada → ACCOUNT_CLOSED", () => {
    expect(code(() => registerPayment(account({ status: "invoiced" }), { method: "card", kind: "card", amount: 1 }, ctx()))).toBe("ACCOUNT_CLOSED");
  });
});

describe("a partes iguales", () => {
  it("las partes suman exactamente el total", () => {
    const p = equalParts(100, 3);
    expect(p).toEqual([33.33, 33.33, 33.34]);
    expect(p.reduce((a, b) => a + b * 100, 0) / 100).toBe(100);
  });
  it("una parte = total", () => expect(equalParts(42.1, 1)).toEqual([42.1]));
  it("0 partes → VALIDATION", () => expect(() => equalParts(10, 0)).toThrow(DomainError));
});
