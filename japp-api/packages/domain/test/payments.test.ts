import { registerPayment, equalParts, paymentKind, assertMethodAllowed } from "../src/payments.js";
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
  it("más de lo pendiente → AMOUNT_EXCEEDS_PENDING (antes se recortaba en silencio)", () => {
    expect(code(() => registerPayment(acc(), { method: "card", kind: "card", amount: 100 }, ctx()))).toBe("AMOUNT_EXCEEDS_PENDING");
    expect(code(() => registerPayment(acc(), { method: "card", kind: "card", amount: 23.51 }, ctx()))).toBe("AMOUNT_EXCEEDS_PENDING");
  });
  it("sin importe se cobra lo pendiente", () => {
    expect(registerPayment(acc(), { method: "card", kind: "card", amount: null }, ctx()).payment.amount).toBe(23.5);
    const half = registerPayment(acc(), { method: "card", kind: "card", amount: 10 }, ctx()).account;
    expect(registerPayment(half, { method: "cash", kind: "cash" }, ctx()).payment.amount).toBe(13.5);
  });
  it("cobros parciales hasta saldar", () => {
    let a = acc();
    const r1 = registerPayment(a, { method: "card", kind: "card", amount: 10 }, ctx()); a = r1.account;
    const r2 = registerPayment(a, { method: "bizum", kind: "other", amount: 13.5 }, ctx());
    expect([r1.settled, r2.settled]).toEqual([false, true]);
  });
  it("importe 0 → VALIDATION; cuenta ya saldada → AMOUNT_EXCEEDS_PENDING", () => {
    expect(code(() => registerPayment(acc(), { method: "card", kind: "card", amount: 0 }, ctx()))).toBe("VALIDATION");
    const paid = registerPayment(acc(), { method: "card", kind: "card", amount: 23.5 }, ctx()).account;
    expect(code(() => registerPayment(paid, { method: "card", kind: "card", amount: 1 }, ctx()))).toBe("AMOUNT_EXCEEDS_PENDING");
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

describe("formas de pago", () => {
  it("paymentKind: por payment_method.kind; bizum, vales y plataformas son «otros», nunca tarjeta", () => {
    expect([paymentKind("cash", "efectivo2"), paymentKind("card", "glovo"), paymentKind("platform", "glovo"), paymentKind("voucher", "ticket-rest")]).toEqual(["cash", "card", "other", "other"]);
    expect([paymentKind(null, "cash"), paymentKind(null, "card"), paymentKind(null, "bizum"), paymentKind(undefined, "voucher")]).toEqual(["cash", "card", "other", "other"]);
  });
  const glovo = { id: "m-glovo", code: "glovo", kind: "card", active: true }, cash = { id: "m-cash", code: "cash", kind: "cash", active: true };
  const caja = { name: "CAJA1", kind: "station", methodIds: ["m-cash", "m-card"] };
  it("METHOD_NOT_ALLOWED: inactiva o inexistente, no configurada en la estación, o no tarjeta en la PDA", () => {
    expect(code(() => assertMethodAllowed(null, caja, "x"))).toBe("METHOD_NOT_ALLOWED");
    expect(code(() => assertMethodAllowed({ ...cash, active: false }, caja, "cash"))).toBe("METHOD_NOT_ALLOWED");
    expect(code(() => assertMethodAllowed(glovo, caja, "glovo"))).toBe("METHOD_NOT_ALLOWED");
    expect(code(() => assertMethodAllowed(cash, { name: "PDA1", kind: "pda", methodIds: [] }, "cash"))).toBe("METHOD_NOT_ALLOWED");
  });
  it("estación sin formas configuradas: vale cualquiera activa; en la PDA, las de tipo tarjeta", () => {
    expect(assertMethodAllowed(glovo, { name: "CAJA2", kind: "station", methodIds: [] }, "glovo")).toBe(glovo);
    expect(assertMethodAllowed(glovo, { name: "PDA1", kind: "pda", methodIds: [] }, "glovo")).toBe(glovo);
    expect(assertMethodAllowed(cash, caja, "cash")).toBe(cash);
  });
});
