import { moveUnits, sameKey, isMovable } from "../src/lines.js";
import { accountTotals } from "../src/totals.js";
import type { Order } from "../src/types.js";
import { DomainError } from "../src/errors.js";
import { account, line, ctx } from "./helpers.js";

const order = (): Order => ({
  id: "o1", tableId: "12", guests: 4, version: 1, accounts: [
    account({ id: "a1", lines: [line({ id: "cana", productId: 1001, quantity: 4, unitPrice: 2.5, status: "printed" }), line({ id: "croq", quantity: 1, unitPrice: 10, status: "printed" })] }),
  ],
});
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("separar cuenta (pasar unidades)", () => {
  it("a cuenta nueva: crea «Cuenta 2» y conserva el total de la mesa", () => {
    const { order: o, destId } = moveUnits(order(), "a1", "new", { cana: 2 }, ctx());
    const d = o.accounts.find(a => a.id === destId)!;
    expect(d.name).toBe("Cuenta 2");
    expect(d.lines[0]).toMatchObject({ productId: 1001, quantity: 2, status: "printed" });
    expect(d.lines[0]!.id).not.toBe("cana");
    expect(o.accounts[0]!.lines.find(l => l.id === "cana")!.quantity).toBe(2);
    const sum = o.accounts.reduce((s, a) => s + accountTotals(a).total, 0);
    expect(sum).toBe(20);
  });
  it("si en destino hay una línea igual, suma cantidad", () => {
    let o = moveUnits(order(), "a1", "new", { cana: 1 }, ctx());
    o = moveUnits(o.order, "a1", o.destId, { cana: 2 }, ctx());
    const d = o.order.accounts.find(a => a.id === o.destId)!;
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]!.quantity).toBe(3);
  });
  it("pasar todo deja la cuenta de origen vacía y se elimina", () => {
    const { order: o } = moveUnits(order(), "a1", "new", { cana: 4, croq: 1 }, ctx());
    expect(o.accounts.map(a => a.name)).toEqual(["Cuenta 2"]);
  });
  it("no se elimina si tiene líneas borradas (hay que conservar el rastro)", () => {
    const base = order();
    base.accounts[0]!.deletedLines.push({ ...line(), reason: "x", removedBy: { user: "a", role: "w", at: "" }, authorizedBy: null, removedAt: "" });
    const { order: o } = moveUnits(base, "a1", "new", { cana: 4, croq: 1 }, ctx());
    expect(o.accounts).toHaveLength(2);
  });
  it("más unidades de las que hay → VALIDATION", () => {
    expect(code(() => moveUnits(order(), "a1", "new", { cana: 5 }, ctx()))).toBe("VALIDATION");
  });
  it("no se toca una cuenta con cobros", () => {
    const o = order();
    o.accounts[0]!.payments.push({ id: "p", method: "card", kind: "card", amount: 5, tip: 0, cashGiven: null, change: null, status: "confirmed", collectedBy: { user: "x", role: "w", at: "" } });
    expect(isMovable(o.accounts[0]!)).toBe(false);
    expect(code(() => moveUnits(o, "a1", "new", { cana: 1 }, ctx()))).toBe("ACCOUNT_CLOSED");
  });
  it("misma cuenta como destino → VALIDATION", () => expect(code(() => moveUnits(order(), "a1", "a1", { cana: 1 }, ctx()))).toBe("VALIDATION"));
  it("sameKey distingue comentario y modificadores", () => {
    expect(sameKey(line({ comment: "a" }))).not.toBe(sameKey(line({ comment: "b" })));
    expect(sameKey(line({ modifiers: [{ name: "x", unitPrice: 0 }] }))).not.toBe(sameKey(line()));
  });
});
