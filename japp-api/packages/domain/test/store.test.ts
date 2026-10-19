import { tableClass, canTransferTo } from "../src/tables.js";
import { expectedCash, countedTotal, cashDifference } from "../src/cash.js";
import { isFastFood, fastFoodTableId, isFastFoodTable, FAST_FOOD_AREA } from "../src/fastfood.js";
import { priceFor } from "../src/pricing.js";
import { assertVersion } from "../src/concurrency.js";
import { DomainError } from "../src/errors.js";
import { CANA } from "./helpers.js";

describe("estado de mesa en el plano", () => {
  it("libre / precuenta / dividida / mía / de otro", () => {
    expect(tableClass(null, "Marta")).toBe("free");
    expect(tableClass({ state: "bill", waiter: "Marta" }, "Marta")).toBe("bill");
    expect(tableClass({ state: "split", waiter: "Pablo" }, "Marta")).toBe("split");
    expect(tableClass({ waiter: "Marta" }, "Marta")).toBe("mine");
    expect(tableClass({ waiter: "Pablo" }, "Marta")).toBe("busy");
    expect(tableClass({ waiter: "Pablo" }, null)).toBe("busy");
  });
  it("solo se transfiere a una mesa libre", () => {
    expect(canTransferTo(null)).toBe(true);
    expect(canTransferTo({ waiter: "x" })).toBe(false);
  });
});

describe("caja", () => {
  it("efectivo esperado = fondo + cobros en efectivo − abonos − retiros + ingresos", () => {
    const r = expectedCash(
      150,
      [
        { kind: "cash", amount: 23.5 },
        { kind: "cash", amount: 10 },
        { kind: "card", amount: 50 },
        { kind: "cash", amount: 5, refund: true },
      ],
      [
        { type: "retiro", amount: 100, reason: "Banco" },
        { type: "ingreso", amount: 20, reason: "Cambio" },
      ],
    );
    expect(r).toEqual({
      opening: 150,
      cashSales: 28.5,
      card: 50,
      withdrawals: 100,
      deposits: 20,
      expected: 98.5,
    });
  });
  it("arqueo ciego por billetes y monedas", () => {
    expect(countedTotal({ 50: 1, 20: 2, 5: 1, 2: 1, 1: 1, 0.5: 1 })).toBe(98.5);
    expect(countedTotal({ 0.1: 3, 0.2: 0 })).toBe(0.3);
  });
  it("descuadre y umbral (5 € por defecto)", () => {
    expect(cashDifference(98.5, 98.5)).toEqual({ diff: 0, needsReason: false });
    expect(cashDifference(93, 98.5)).toEqual({ diff: -5.5, needsReason: true });
    expect(cashDifference(103.5, 98.5).needsReason).toBe(false);
  });
});

describe("modo fastfood", () => {
  it("solo en TPV, no en PDA", () => {
    expect(isFastFood("fastfood", false)).toBe(true);
    expect(isFastFood("fastfood", true)).toBe(false);
    expect(isFastFood("table", false)).toBe(false);
  });
  it("pedido FF-<estación> con PVP general", () => {
    expect(fastFoodTableId("Caja 1")).toBe("FF-Caja 1");
    expect(isFastFoodTable("FF-Caja 1")).toBe(true);
    expect(isFastFoodTable("12")).toBe(false);
    expect(priceFor(CANA, FAST_FOOD_AREA)).toBe(2.5);
  });
});

describe("bloqueo optimista", () => {
  it("misma versión → siguiente; distinta → VERSION_CONFLICT; sin versión → VALIDATION", () => {
    expect(assertVersion(7, 7)).toBe(8);
    try {
      assertVersion(7, 6);
      expect.fail();
    } catch (e) {
      expect((e as DomainError).code).toBe("VERSION_CONFLICT");
      expect((e as DomainError).status).toBe(409);
    }
    expect(() => assertVersion(7, undefined)).toThrow(/version/);
  });
});
