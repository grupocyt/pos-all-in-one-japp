import { applyDiscount, removeDiscount, setCustomer, removeEmptyAccount, isValidSpanishTaxId } from "../src/accounts.js";
import { accountTotals } from "../src/totals.js";
import { DomainError } from "../src/errors.js";
import { account, line, ctx } from "./helpers.js";

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };
const acc = () => account({ lines: [line({ quantity: 2, unitPrice: 10 })] });

describe("descuentos", () => {
  it("aplica un 10 % y el total baja", () => {
    const a = applyDiscount(acc(), { type: "percentage", value: 10, reason: "Empleado" }, ctx());
    expect(accountTotals(a)).toMatchObject({ disc: 2, total: 18 });
  });
  it("el nuevo sustituye al anterior (uno activo por cuenta)", () => {
    let a = applyDiscount(acc(), { type: "percentage", value: 10, reason: "x" }, ctx());
    a = applyDiscount(a, { type: "fixed", value: 5, reason: "y" }, ctx());
    expect(a.discounts.map(d => d.status)).toEqual(["removed", "applied"]);
    expect(accountTotals(a).total).toBe(15);
  });
  it("sin motivo, porcentaje fuera de rango, fijo ≤ 0 o cuenta vacía → VALIDATION", () => {
    expect(code(() => applyDiscount(acc(), { type: "percentage", value: 10, reason: " " }, ctx()))).toBe("VALIDATION");
    expect(code(() => applyDiscount(acc(), { type: "percentage", value: 120, reason: "x" }, ctx()))).toBe("VALIDATION");
    expect(code(() => applyDiscount(acc(), { type: "fixed", value: 0, reason: "x" }, ctx()))).toBe("VALIDATION");
    expect(code(() => applyDiscount(account(), { type: "fixed", value: 1, reason: "x" }, ctx()))).toBe("VALIDATION");
  });
  it("con cobros hechos no se aplica ni se quita", () => {
    const paid = { ...acc(), payments: [{ id: "p", method: "card", kind: "card" as const, amount: 5, tip: 0, cashGiven: null, change: null, status: "confirmed" as const, collectedBy: { user: "x", role: "w", at: "" } }] };
    expect(code(() => applyDiscount(paid, { type: "fixed", value: 1, reason: "x" }, ctx()))).toBe("VALIDATION");
  });
  it("quitar descuento lo deja como removed", () => {
    const a = applyDiscount(acc(), { type: "fixed", value: 3, reason: "x" }, ctx());
    const b = removeDiscount(a, a.discounts[0]!.id);
    expect(accountTotals(b).total).toBe(20);
    expect(code(() => removeDiscount(b, a.discounts[0]!.id))).toBe("NOT_FOUND");
  });
});

describe("cliente para factura F1", () => {
  it("valida NIF, NIE y CIF españoles", () => {
    expect(isValidSpanishTaxId("12345678Z")).toBe(true);
    expect(isValidSpanishTaxId("12345678A")).toBe(false);
    expect(isValidSpanishTaxId("X1234567L")).toBe(true);
    expect(isValidSpanishTaxId("B02891075")).toBe(true);   // Daily Food Ventures (emisor)
    expect(isValidSpanishTaxId("B02891076")).toBe(false);
    expect(isValidSpanishTaxId("b-0289107.5")).toBe(true);
  });
  it("guarda el cliente normalizado; NIF malo → VALIDATION; extranjero solo forma", () => {
    const a = setCustomer(acc(), { name: "Eventos Madrid SL", taxId: "b02891075" });
    expect(a.customerData!.taxId).toBe("B02891075");
    expect(code(() => setCustomer(acc(), { name: "x", taxId: "B12345678" }))).toBe("VALIDATION");
    expect(code(() => setCustomer(acc(), { name: "Acme GmbH", taxId: "DE123456789", country: "DE" }))).toBe("OK");
    expect(code(() => setCustomer(acc(), { name: "", taxId: "12345678Z" }))).toBe("VALIDATION");
  });
});

describe("quitar cuenta", () => {
  const order = (accs: ReturnType<typeof account>[]) => ({ id: "o", tableId: "1", guests: 2, version: 1, accounts: accs });
  it("solo vacía y si queda otra abierta", () => {
    const o = order([account({ id: "a1", lines: [line()] }), account({ id: "a2" })]);
    expect(removeEmptyAccount(o, "a2").accounts.map(a => a.id)).toEqual(["a1"]);
    expect(code(() => removeEmptyAccount(o, "a1"))).toBe("VALIDATION");
    expect(code(() => removeEmptyAccount(order([account({ id: "a2" })]), "a2"))).toBe("VALIDATION");
  });
});
