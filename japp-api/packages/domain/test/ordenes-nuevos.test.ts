import { DomainError } from "../src/errors.js";
import { planReopen } from "../src/reopen.js";
import { liveContentOf, assertNothingLive, renameAccount, dropEmptyAfterInvoice } from "../src/orderState.js";
import type { Order, Payment } from "../src/types.js";
import { account, line } from "./helpers.js";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return { code: (e as DomainError).code, details: (e as DomainError).details };
  }
  return "OK";
};
const order = (accounts: Order["accounts"]): Order => ({
  id: "o-1",
  tableId: "t-1",
  guests: 2,
  version: 3,
  accounts,
});
const pay = (status: Payment["status"]): Payment => ({
  id: "p-1",
  method: "card",
  kind: "card",
  amount: 5,
  tip: 0,
  cashGiven: null,
  change: null,
  status,
  collectedBy: { user: "Marta", role: "waiter", at: "2026-10-13T12:00:00.000Z" },
});

describe("reabrir mesa (planReopen)", () => {
  const closed = { id: "o-1", status: "cancelled", periodId: "P1" };
  it("las cuentas anuladas sin factura vuelven a open; las facturadas no", () => {
    const r = planReopen(
      { ...closed, status: "closed" },
      [
        { id: "a1", status: "invoiced", invoiced: true },
        { id: "a2", status: "cancelled", invoiced: false },
        { id: "a3", status: "cancelled", invoiced: true },
      ],
      "P1",
    );
    expect(r.reopen).toEqual(["a2"]);
  });
  it("sin periodo abierto, o de otro periodo → PERIOD_CLOSED", () => {
    const accs = [{ id: "a1", status: "cancelled", invoiced: false }];
    expect(err(() => planReopen(closed, accs, null))).toMatchObject({ code: "PERIOD_CLOSED" });
    expect(err(() => planReopen(closed, accs, "P2"))).toMatchObject({
      code: "PERIOD_CLOSED",
      details: { periodId: "P1" },
    });
  });
  it("una mesa abierta no se reabre → TABLE_BUSY; todas facturadas → ACCOUNT_CLOSED", () => {
    const accs = [{ id: "a1", status: "cancelled", invoiced: false }];
    expect(err(() => planReopen({ ...closed, status: "open" }, accs, "P1"))).toMatchObject({
      code: "TABLE_BUSY",
    });
    expect(
      err(() =>
        planReopen({ ...closed, status: "closed" }, [{ id: "a1", status: "invoiced", invoiced: true }], "P1"),
      ),
    ).toMatchObject({ code: "ACCOUNT_CLOSED" });
  });
});

describe("lo que le queda vivo a la mesa (liveContentOf / assertNothingLive)", () => {
  it("sin líneas ni cobros confirmados en cuentas sin facturar → nada vivo", () => {
    const o = order([
      account({ id: "a1", status: "invoiced", lines: [line()] }),
      account({ id: "a2", payments: [pay("cancelled")] }),
    ]);
    expect(liveContentOf(o)).toBeNull();
    expect(err(() => assertNothingLive(o))).toBe("OK");
  });
  it("con productos o con cobros → ORDER_NOT_EMPTY con la cuenta", () => {
    const withLines = order([account({ id: "a1", lines: [line(), line()] })]);
    expect(liveContentOf(withLines)).toEqual({ accountId: "a1", reason: "lines", lines: 2 });
    expect(err(() => assertNothingLive(withLines))).toMatchObject({
      code: "ORDER_NOT_EMPTY",
      details: { accountId: "a1", lines: 2 },
    });
    const withPay = order([account({ id: "a2", payments: [pay("confirmed")] })]);
    expect(err(() => assertNothingLive(withPay))).toMatchObject({
      code: "ORDER_NOT_EMPTY",
      details: { accountId: "a2" },
    });
  });
});

describe("tras facturar, las cuentas vacías no dejan la mesa abierta (dropEmptyAfterInvoice)", () => {
  it("todo facturado + cuentas vacías → se quitan las vacías (la mesa se cierra)", () => {
    const o = order([
      account({ id: "a1", status: "invoiced", lines: [line()] }),
      account({ id: "a2" }),
      account({ id: "a3", payments: [pay("cancelled")] }),
    ]);
    expect(dropEmptyAfterInvoice(o).accounts.map((a) => a.id)).toEqual(["a1"]);
  });
  it("si queda algo vivo, o no hay nada facturado, no cambia nada", () => {
    const live = order([
      account({ id: "a1", status: "invoiced" }),
      account({ id: "a2", lines: [line()] }),
      account({ id: "a3" }),
    ]);
    expect(dropEmptyAfterInvoice(live)).toBe(live);
    const none = order([account({ id: "a1" })]);
    expect(dropEmptyAfterInvoice(none)).toBe(none);
  });
});

describe("renombrar cuenta (renameAccount)", () => {
  const o = order([account({ id: "a1", name: "Cuenta 1" }), account({ id: "a2", name: "Ana" })]);
  it("cambia el nombre sin espacios de más y no muta", () => {
    const n = renameAccount(o, "a1", "  Pepe   y  Luis ");
    expect(n.accounts[0]!.name).toBe("Pepe y Luis");
    expect(o.accounts[0]!.name).toBe("Cuenta 1");
  });
  it("repetido en la mesa (sin mayúsculas) → DUPLICATE; su propio nombre vale", () => {
    expect(err(() => renameAccount(o, "a1", "ANA"))).toMatchObject({
      code: "DUPLICATE",
      details: { field: "name" },
    });
    expect(renameAccount(o, "a2", "ana").accounts[1]!.name).toBe("ana");
  });
  it("vacío o de más de 40 → VALIDATION; facturada → ACCOUNT_CLOSED; otra cuenta → NOT_FOUND", () => {
    expect(err(() => renameAccount(o, "a1", "   "))).toMatchObject({ code: "VALIDATION" });
    expect(err(() => renameAccount(o, "a1", "x".repeat(41)))).toMatchObject({ code: "VALIDATION" });
    const inv = order([account({ id: "a1", status: "invoiced" })]);
    expect(err(() => renameAccount(inv, "a1", "Ana"))).toMatchObject({ code: "ACCOUNT_CLOSED" });
    expect(err(() => renameAccount(o, "zz", "Ana"))).toMatchObject({ code: "NOT_FOUND" });
  });
});
