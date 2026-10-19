import { readFileSync } from "node:fs";
import { accountTotals, lineAmount } from "../src/totals.js";
import type { Account } from "../src/types.js";

/**
 * Prueba «dorada» con la transacción de ejemplo de vista-orden (mesa 12, 23/09/2026).
 * Si el back calcula distinto a lo que el TPV muestra, falla aquí.
 */
const raw = JSON.parse(readFileSync(new URL("./fixtures/orden-mesa-12.json", import.meta.url), "utf8"));
const toAccount = (a: any): Account => ({
  ...a,
  discounts: a.discounts ?? [],
  deletedLines: a.deletedLines ?? [],
  lines: (a.lines ?? []).map((l: any) => ({ ...l, taxRate: l.taxRate ?? 10, modifiers: l.modifiers ?? [] })),
  payments: (a.payments ?? []).map((p: any) => ({ ...p, kind: p.method === "cash" ? "cash" : "card" })),
});

describe("transacción de ejemplo · mesa 12", () => {
  const c1 = toAccount(raw.accounts[0]);
  it("Cuenta 1: 8 líneas con modificadores suman 74,70 €", () => {
    expect(c1.lines).toHaveLength(8);
    expect(c1.lines.map(lineAmount)).toEqual([11.5, 10, 25.5, 8.5, 5, 2, 7.8, 4.4]);
    expect(accountTotals(c1).total).toBe(74.7);
  });
  it("Cuenta 1: la tarjeta denegada no cuenta; 50 + 14,70 + 10 dejan pendiente 0", () => {
    const t = accountTotals(c1);
    expect(t.paid).toBe(74.7);
    expect(t.pending).toBe(0);
  });
  it("Cuenta 1: el efectivo de 100 € devuelve 90 €", () => {
    const cash = c1.payments.find((p) => p.method === "cash")!;
    expect(cash.cashGiven! - cash.amount).toBe(cash.change);
  });
  it("todas las cuentas: total ≥ 0 y pendiente ≤ total", () => {
    for (const a of raw.accounts.map(toAccount)) {
      const t = accountTotals(a);
      expect(t.total).toBeGreaterThanOrEqual(0);
      expect(t.pending).toBeLessThanOrEqual(t.total);
    }
  });
  it("el JSON de ejemplo trae totals vacío: el servidor debe calcularlos (aviso para Kevin)", () => {
    expect(raw.accounts[0].totals).toEqual({});
  });
});
