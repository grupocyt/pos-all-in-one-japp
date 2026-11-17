import { describe, expect, it } from "vitest";
import { expectedCash, pettyCashBalance, planPettyCash } from "../src/cash.js";
import { cutXCountTicket } from "../src/tickets.js";
import { DomainError } from "../src/errors.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return "OK";
};

describe("1.2.274 · arqueo de auditoría", () => {
  it("propinas con tarjeta aparte (las marca el datáfono); el efectivo esperado lleva las de efectivo", () => {
    const r = expectedCash(150, [
      { kind: "cash", amount: 20, tip: 2 },
      { kind: "card", amount: 30, tip: 3 },
      { kind: "card", amount: 10, tip: 1, refund: true },
    ], [{ type: "retiro", amount: 50, reason: "Traslado a caja fuerte" }]);
    expect([r.expected, r.cashTips, r.cardTips, r.card]).toEqual([122, 2, 3, 20]);
  });
  it("caja chica: saldo, gasto hasta el saldo, reposición hasta el fondo", () => {
    expect(pettyCashBalance(50, [{ kind: "expense", amount: 12.5 }, { kind: "expense", amount: 7.5 }, { kind: "replenish", amount: 10 }])).toBe(40);
    expect(planPettyCash(50, 40, "expense", 40)).toEqual({ amount: 40, balanceAfter: 0 });
    expect(code(() => planPettyCash(50, 40, "expense", 40.01))).toBe("PETTY_CASH_LIMIT");
    expect(code(() => planPettyCash(50, 40, "expense", 0))).toBe("VALIDATION");
    expect(planPettyCash(50, 40, "replenish")).toEqual({ amount: 10, balanceAfter: 50 });
    expect(code(() => planPettyCash(50, 40, "replenish", 11))).toBe("PETTY_CASH_LIMIT");
    expect(code(() => planPettyCash(50, 50, "replenish"))).toBe("VALIDATION");
  });
  it("ticket corto del corte X: contado, datáfonos, esperado, diferencia, retiros y propinas confirmadas", () => {
    const tk = cutXCountTicket({
      store: { tradeName: "Cañas y Tapas", legalName: "CyT SL", taxId: "B1", logo: false },
      station: "CAJA1", at: new Date("2026-11-16T20:00:00Z"), user: "Sistemas", type: "cortex",
      float: 150, withdrawals: 50, deposits: 0,
      cash: { counted: 120, expected: 122, difference: -2 },
      cards: [{ name: "Datáfono 1", amount: 13 }, { name: "Datáfono 2", amount: 10 }],
      card: { counted: 23, expected: 23, difference: 0 },
      tips: { cash: 2, card: 3, confirmed: true }, note: "Faltan 2 €",
    });
    const txt = tk.filter((l) => l.k === "text").map((l: any) => l.text).join("\n");
    for (const s of ["CORTE X · ARQUEO", "Contado", "FALTA 2,00 €", "Traslados a caja fuerte", "Datáfono 2", "CUADRA", "PROPINAS", "Confirmadas por Sistemas", "Motivo: Faltan 2 €"]) {
      expect(txt).toContain(s);
    }
    expect(tk.at(-1)).toEqual({ k: "cut" });
  });
});
