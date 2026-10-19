import { transferAccount } from "../src/transfer.js";
import { assertDetailMatches, detailTotal } from "../src/cash.js";
import { DomainError } from "../src/errors.js";
import { account, line } from "./helpers.js";
import type { Order } from "../src/types.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return "OK";
};
const order = (id: string, accounts: Order["accounts"]): Order => ({
  id,
  tableId: id,
  guests: 2,
  version: 3,
  accounts,
});
const pay = {
  id: "p1",
  method: "card",
  kind: "card" as const,
  amount: 5,
  tip: 0,
  cashGiven: null,
  change: null,
  status: "confirmed" as const,
  collectedBy: { user: "x", role: "waiter", at: "" },
};

describe("pasar una cuenta a otra mesa", () => {
  const c1 = account({ id: "a1", name: "Cuenta 1", lines: [line({ unitPrice: 9, status: "printed" })] });
  const c2 = account({
    id: "a2",
    name: "Cuenta 2",
    lines: [line({ unitPrice: 4.5 })],
    payments: [pay],
    discounts: [{ id: "d", type: "fixed", value: 1, reason: "x", status: "applied" }],
  });
  it("a una mesa libre: va entera (cobros y descuentos incluidos) y el origen sigue vivo", () => {
    const r = transferAccount(order("o7", [c1, c2]), "a2", order("o8", []));
    expect(r.from.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(r.to.accounts).toHaveLength(1);
    expect(r.account).toMatchObject({
      id: "a2",
      name: "Cuenta 2",
      payments: [{ id: "p1" }],
      discounts: [{ id: "d" }],
    });
    expect(r.account.lines[0]!.unitPrice).toBe(4.5); // sin cambiar de precio
    expect([r.sourceLive, r.renamedFrom]).toEqual([true, null]);
  });
  it("a una mesa ocupada: una cuenta más; si el nombre ya existe, «Cuenta N» libre; nunca se juntan líneas", () => {
    const dest = order("o8", [
      account({ id: "b1", name: "Cuenta 1", lines: [line()] }),
      account({ id: "b2", name: "Cuenta 2", lines: [line()] }),
    ]);
    const r = transferAccount(order("o7", [c1]), "a1", dest);
    expect(r.to.accounts.map((a) => a.name)).toEqual(["Cuenta 1", "Cuenta 2", "Cuenta 3"]);
    expect(r.to.accounts[0]!.lines).toHaveLength(1);
    expect([r.renamedFrom, r.sourceLive]).toEqual(["Cuenta 1", false]);
  });
  it("facturada, vacía, inexistente o a la misma mesa → error", () => {
    expect(
      code(() => transferAccount(order("o7", [{ ...c1, status: "invoiced" }]), "a1", order("o8", []))),
    ).toBe("NOTHING_TO_TRANSFER");
    expect(code(() => transferAccount(order("o7", [account({ id: "a1" })]), "a1", order("o8", [])))).toBe(
      "NOTHING_TO_TRANSFER",
    );
    expect(code(() => transferAccount(order("o7", [c1]), "x", order("o8", [])))).toBe("NOT_FOUND");
    const o = order("o7", [c1]);
    expect(code(() => transferAccount(o, "a1", o))).toBe("VALIDATION");
  });
});

describe("arqueo con desglose", () => {
  it("suma denominación × unidades con punto o coma", () => {
    expect(detailTotal({ "50": 2, "0.5": 3, "0,20": 1, "2": 0 })).toBe(101.7);
  });
  it("no cuadra al céntimo → VALIDATION en detail con el mensaje", () => {
    try {
      assertDetailMatches({ "20": 7, "2": 9 }, 158.92);
      throw new Error("no");
    } catch (e: any) {
      expect([e.code, e.message, e.details.field]).toEqual([
        "VALIDATION",
        "El desglose suma 158,00 €, no 158,92 €",
        "detail",
      ]);
    }
    expect(() => assertDetailMatches({ "20": 7, "2": 9 }, 158)).not.toThrow();
    expect(() => assertDetailMatches(null, 1)).not.toThrow();
    expect(code(() => detailTotal({ abc: 1 }))).toBe("VALIDATION");
    expect(code(() => detailTotal({ "5": 1.5 }))).toBe("VALIDATION");
  });
});
