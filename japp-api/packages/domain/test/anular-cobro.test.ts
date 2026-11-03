import { registerPayment, voidPayment } from "../src/payments.js";
import { accountTotals } from "../src/totals.js";
import { removeDiscount, applyDiscount, assertAccountFree, accountLock } from "../src/accounts.js";
import { addProduct, changeQuantity, deleteLine } from "../src/lines.js";
import { DomainError } from "../src/errors.js";
import { account, line, ctx, CANA, SALA, LUCIA, PROFILES } from "./helpers.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return "OK";
};

describe("anular un cobro (decisión 19)", () => {
  const base = () => account({ lines: [line({ quantity: 1, unitPrice: 20 })] });
  it("el cobro queda cancelled, deja de contar y la cuenta vuelve a deber todo", () => {
    const p = registerPayment(base(), { method: "cash", kind: "cash", amount: 5 }, ctx());
    expect(accountTotals(p.account).pending).toBe(15);
    const v = voidPayment(p.account, p.payment.id, "Era con tarjeta");
    expect(v.payment.status).toBe("cancelled");
    expect(v.account.payments).toHaveLength(1);
    expect(accountTotals(v.account)).toMatchObject({ paid: 0, pending: 20 });
    expect(p.account.payments[0]!.status).toBe("confirmed"); // no muta
  });
  it("con cobros no se toca el descuento; anulados, sí", () => {
    const d = applyDiscount(base(), { type: "percentage", value: 10, reason: "Habitual" }, ctx());
    const p = registerPayment(d, { method: "cash", kind: "cash", amount: 2 }, ctx());
    const did = p.account.discounts[0]!.id;
    expect(code(() => removeDiscount(p.account, did))).toBe("VALIDATION");
    const v = voidPayment(p.account, p.payment.id, "Quitar descuento");
    expect(code(() => removeDiscount(v.account, did))).toBe("OK");
  });
  it("errores: sin motivo, cobro que no existe, ya anulado, cuenta facturada", () => {
    const p = registerPayment(base(), { method: "cash", kind: "cash", amount: 5 }, ctx());
    expect(code(() => voidPayment(p.account, p.payment.id, " "))).toBe("VALIDATION");
    expect(code(() => voidPayment(p.account, "nope", "Motivo"))).toBe("NOT_FOUND");
    const v = voidPayment(p.account, p.payment.id, "Motivo");
    expect(code(() => voidPayment(v.account, p.payment.id, "Motivo"))).toBe("INVALID_TRANSITION");
    expect(code(() => voidPayment({ ...p.account, status: "invoiced" }, p.payment.id, "Motivo"))).toBe(
      "ACCOUNT_CLOSED",
    );
  });
});

describe("regla 03/11: con descuento o cobro parcial la cuenta queda congelada (por cuenta)", () => {
  const base = () => account({ lines: [line({ id: "l1", quantity: 2, unitPrice: 10 })] });
  it("solo con descuento ya no se tica, ni se cambia, ni se elimina; quitado el descuento, sí", () => {
    const d = applyDiscount(base(), { type: "percentage", value: 10, reason: "Habitual" }, ctx());
    expect(code(() => addProduct(d, { product: CANA, area: SALA, force: true }, ctx()))).toBe(
      "ACCOUNT_LOCKED",
    );
    expect(code(() => changeQuantity(d, "l1", 1))).toBe("ACCOUNT_LOCKED");
    expect(code(() => deleteLine(d, { lineId: "l1", actor: LUCIA, profiles: PROFILES }, ctx()))).toBe(
      "ACCOUNT_LOCKED",
    );
    const free = removeDiscount(d, d.discounts[0]!.id);
    expect(addProduct(free, { product: CANA, area: SALA, force: true }, ctx()).lines).toHaveLength(2);
  });
  it("el detalle dice qué cobros y qué descuento tiene, para «Liberar la cuenta y continuar»", () => {
    const d = applyDiscount(base(), { type: "fixed", value: 2, reason: "Habitual" }, ctx());
    const p = registerPayment(d, { method: "card", kind: "card", amount: 3 }, ctx());
    try {
      assertAccountFree(p.account, "añadir productos");
      throw new Error("no falla");
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe("ACCOUNT_LOCKED");
      expect(err.details).toMatchObject({
        action: "añadir productos",
        payments: [{ amount: 3, method: "card" }],
        discount: { reason: "Habitual" },
      });
    }
    // para seguir: anular el cobro y quitar el descuento (sin «liberar la cuenta»)
    const v = voidPayment(p.account, p.payment.id, "Cambian de mesa");
    expect(accountLock(v.account)).toMatchObject({ payments: [], discount: { reason: "Habitual" } });
    const free = removeDiscount(v.account, v.account.discounts[0]!.id);
    expect(accountLock(free)).toBeNull();
  });
  it("un descuento no puede dejar la cuenta a 0 € (100 % o importe ≥ total)", () => {
    expect(code(() => applyDiscount(base(), { type: "percentage", value: 100, reason: "x" }, ctx()))).toBe(
      "VALIDATION",
    );
    expect(code(() => applyDiscount(base(), { type: "fixed", value: 20, reason: "x" }, ctx()))).toBe(
      "VALIDATION",
    );
    expect(code(() => applyDiscount(base(), { type: "fixed", value: 19.99, reason: "x" }, ctx()))).toBe("OK");
  });
});
