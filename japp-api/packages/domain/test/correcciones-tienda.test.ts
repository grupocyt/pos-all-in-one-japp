import { describe, expect, it } from "vitest";
import { nextAccountName, newAccountName } from "../src/accountNames.js";
import { moveUnits } from "../src/lines.js";
import { transferAccount, mergeOrders, joinNotes } from "../src/transfer.js";
import { changeFiredCourse, chooseCourse, kitchenItemOf } from "../src/courses.js";
import {
  preBillTicket,
  kitchenTicket,
  voidTicket,
  cutTicket,
  renderText,
  lr,
  WIDTH,
} from "../src/tickets.js";
import { lineAmount } from "../src/totals.js";
import type { DomainError } from "../src/errors.js";
import type { Account, Line, Order, Payment } from "../src/types.js";
import { account, line, ctx, T0 } from "./helpers.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return "OK";
};
const order = (id: string, accounts: Account[], guests = 2): Order => ({
  id,
  tableId: id,
  guests,
  version: 3,
  accounts,
});
const pay = (amount: number): Payment => ({
  id: "p1",
  method: "card",
  kind: "card",
  amount,
  tip: 0,
  cashGiven: null,
  change: null,
  status: "confirmed",
  collectedBy: { user: "x", role: "waiter", at: "" },
});

describe("nombres de cuenta: nunca se repite un «Cuenta N»", () => {
  it("N = el número más alto + 1, aunque falten intermedias", () => {
    const o = order("o", [account({ id: "a1", name: "Cuenta 1" }), account({ id: "a3", name: "Cuenta 3" })]);
    expect(nextAccountName(o)).toBe("Cuenta 4");
  });
  it("cuenta también las anuladas o quitadas (knownNames), las facturadas y sin distinguir mayúsculas", () => {
    const o = order("o", [
      account({ id: "a1", name: "Cuenta 1" }),
      account({ id: "a2", name: "  CUENTA   5 ", status: "invoiced" }),
      account({ id: "a3", name: "Pareja" }),
    ]);
    expect(nextAccountName(o)).toBe("Cuenta 6");
    expect(nextAccountName(o, ["Cuenta 9", "Cuenta 2"])).toBe("Cuenta 10");
    expect(nextAccountName(order("o", []))).toBe("Cuenta 1");
    // «Cuenta 2b» o «Mi cuenta 7» no son nombres automáticos
    expect(
      nextAccountName(order("o", [account({ name: "Cuenta 2b" }), account({ name: "Mi cuenta 7" })])),
    ).toBe("Cuenta 1");
  });
  it("nombre explícito: se respeta (limpio); repetido con otra cuenta de la mesa → DUPLICATE; vacío → automático", () => {
    const o = order("o", [account({ id: "a1", name: "Cuenta 1" }), account({ id: "a2", name: "Pareja" })]);
    expect(newAccountName(o, "  Los   de la barra ")).toBe("Los de la barra");
    expect(code(() => newAccountName(o, "pareja"))).toBe("DUPLICATE");
    expect(code(() => newAccountName(o, "x".repeat(41)))).toBe("VALIDATION");
    expect(newAccountName(o, "  ", ["Cuenta 4"])).toBe("Cuenta 5");
    expect(newAccountName(o, null)).toBe("Cuenta 2");
  });
  it("separar a cuenta nueva tras quitar una intermedia: no repite el nombre", () => {
    const l = line({ quantity: 2 });
    const o = order("o", [
      account({ id: "a1", name: "Cuenta 1", lines: [l] }),
      account({ id: "a3", name: "Cuenta 3", lines: [line()] }),
    ]);
    const r = moveUnits(o, "a1", "new", { [l.id]: 1 }, ctx());
    expect(r.order.accounts.find((a) => a.id === r.destId)!.name).toBe("Cuenta 4");
    // la Cuenta 4 anulada antes (knownNames) tampoco se repite
    const r2 = moveUnits(o, "a1", "new", { [l.id]: 1 }, ctx(), ["Cuenta 4"]);
    expect(r2.order.accounts.find((a) => a.id === r2.destId)!.name).toBe("Cuenta 5");
  });
  it("1.2.203 · lo que sale de una cuenta traída de otra mesa lleva esa mesa y no se junta con lo igual de la mesa", () => {
    const mine = line({ id: "m1", quantity: 1 });
    const came = line({ id: "c1", quantity: 2 });
    const o = order("o", [
      account({ id: "main", name: "Cuenta 1", lines: [mine] }),
      account({ id: "in", name: "Cuenta 2", lines: [came], origin: { table: "7", by: "Ana", at: T0.toISOString() } }),
    ]);
    const r = moveUnits(o, "in", "main", { c1: 2 }, ctx());
    const main = r.order.accounts.find((a) => a.id === "main")!;
    expect(main.lines).toHaveLength(2);
    expect(main.lines.find((l) => l.id === "m1")!.quantity).toBe(1);
    const moved = main.lines.find((l) => l.id !== "m1")!;
    expect(moved.origin).toEqual({ table: "7" });
    expect(moved.quantity).toBe(2);
    // sin origen, lo igual se suma como siempre
    const o2 = order("o", [
      account({ id: "main", name: "Cuenta 1", lines: [line({ id: "m2" })] }),
      account({ id: "b", name: "Cuenta 2", lines: [line({ id: "b2" })] }),
    ]);
    const r2 = moveUnits(o2, "b", "main", { b2: 1 }, ctx());
    expect(r2.order.accounts.find((a) => a.id === "main")!.lines).toHaveLength(1);
  });
  it("pasar una cuenta a otra mesa con el nombre repetido: siguiente número del destino, nunca uno reutilizado", () => {
    const dest = order("o8", [
      account({ id: "b1", name: "Cuenta 1", lines: [line()] }),
      account({ id: "b3", name: "Cuenta 3", lines: [line()] }),
    ]);
    const src = order("o7", [account({ id: "a1", name: "Cuenta 1", lines: [line()] })]);
    const r = transferAccount(src, "a1", dest);
    expect([r.account.name, r.renamedFrom]).toEqual(["Cuenta 4", "Cuenta 1"]);
    expect(transferAccount(src, "a1", dest, ["Cuenta 6"]).account.name).toBe("Cuenta 7");
    // sin repetir, conserva su nombre
    const libre = order("o7", [account({ id: "a2", name: "Cuenta 2", lines: [line()] })]);
    expect(transferAccount(libre, "a2", dest).renamedFrom).toBeNull();
  });
});

describe("juntar mesas (mergeOrders)", () => {
  const destino = () =>
    order(
      "o8",
      [
        account({ id: "b1", name: "Cuenta 1", lines: [line({ unitPrice: 3 })] }),
        account({ id: "b2", name: "Pareja" }),
      ],
      3,
    );
  it("las cuentas vivas pasan enteras (cobros, descuentos, eliminadas, cliente); nombres repetidos → Cuenta N; comensales sumados", () => {
    const viva = account({
      id: "a1",
      name: "Cuenta 1",
      lines: [line({ unitPrice: 9, status: "printed" })],
      payments: [pay(2)],
      discounts: [{ id: "d", type: "fixed", value: 1, reason: "x", status: "applied" }],
      customerData: { name: "Eventos SL", taxId: "B02891075" },
    });
    const pareja = account({ id: "a2", name: "pareja", lines: [line()] });
    const facturada = account({ id: "a3", name: "Cuenta 3", status: "invoiced", lines: [line()] });
    const r = mergeOrders(order("o7", [viva, pareja, facturada], 2), destino(), {
      knownNames: ["Cuenta 2"],
      fromNote: "alérgico",
      toNote: "cumpleaños",
    });
    expect(r.to.accounts.map((a) => [a.id, a.name])).toEqual([
      ["b1", "Cuenta 1"],
      ["b2", "Pareja"],
      ["a1", "Cuenta 3"],
      ["a2", "Cuenta 4"],
    ]);
    expect(r.moved.map((m) => m.renamedFrom)).toEqual(["Cuenta 1", "pareja"]);
    const a1 = r.to.accounts.find((a) => a.id === "a1")!;
    expect(a1).toMatchObject({
      payments: [{ id: "p1" }],
      discounts: [{ id: "d" }],
      customerData: { name: "Eventos SL" },
    });
    expect(a1.lines[0]!.unitPrice).toBe(9); // sin cambiar de precio
    expect(r.to.guests).toBe(5);
    expect(r.from.accounts.map((a) => a.id)).toEqual(["a3"]);
    expect(r.sourceStatus).toBe("closed");
    expect(r.note).toBe("cumpleaños · alérgico");
  });
  it("sin facturadas el origen queda cancelled; una cuenta viva vacía no pasa (se anula)", () => {
    const r = mergeOrders(
      order("o7", [
        account({ id: "a1", name: "Cuenta 7", lines: [line()] }),
        account({ id: "a2", name: "Cuenta 8" }),
      ]),
      destino(),
    );
    expect(r.to.accounts.map((a) => a.name)).toEqual(["Cuenta 1", "Pareja", "Cuenta 7"]);
    expect([r.dropped, r.sourceStatus, r.from.accounts]).toEqual([["a2"], "cancelled", []]);
  });
  it("sin productos vivos → VALIDATION; la misma orden → VALIDATION", () => {
    expect(code(() => mergeOrders(order("o7", [account({ id: "a1" })]), destino()))).toBe("VALIDATION");
    expect(code(() => mergeOrders(destino(), destino()))).toBe("VALIDATION");
  });
  it("notas: se unen sin repetir y sin vacías", () => {
    expect(joinNotes(null, "  ")).toBeNull();
    expect(joinNotes("Terraza", "terraza")).toBe("Terraza");
  });
});

describe("cambiar un pase ya marchado (falta de stock)", () => {
  const menu = (over: Partial<Line> = {}): Line =>
    line({
      id: "m1",
      productId: 2600,
      name: "Menú del día",
      unitPrice: 12.5,
      status: "printed",
      comment: "sin sal",
      modifiers: [
        { name: "AGUA", unitPrice: 0, plu: 1050, course: 0, questionId: "qb" },
        { name: "SALMOREJO", unitPrice: 0, plu: 7001, course: 1, questionId: "q1" },
      ],
      courses: [
        {
          course: 0,
          questionId: "qb",
          question: "¿Bebida?",
          state: "fired",
          firedAt: "2026-10-13T11:00:00.000Z",
        },
        {
          course: 1,
          questionId: "q1",
          question: "¿Primero?",
          state: "fired",
          firedAt: "2026-10-13T11:05:00.000Z",
        },
        { course: 2, questionId: "q2", question: "¿Segundo?", state: "pending" },
      ],
      ...over,
    });
  const GAZPACHO = { name: "GAZPACHO", unitPrice: 1.5, plu: 7002, quantity: 1 };
  it("el pase sigue marchado con la respuesta nueva, firedAt nuevo, precio con su suplemento y comanda «CAMBIO 1.º»", () => {
    const acc = account({ lines: [menu()] });
    expect(code(() => chooseCourse(acc, "m1", 1, [GAZPACHO]))).toBe("VALIDATION"); // sin motivo sigue sin poder
    const r = changeFiredCourse(acc, "m1", 1, [GAZPACHO], T0);
    const l = r.account.lines[0]!;
    expect(l.modifiers.filter((m) => m.course === 1).map((m) => [m.name, m.questionId])).toEqual([
      ["GAZPACHO", "q1"],
    ]);
    expect(l.courses!.find((c) => c.course === 1)).toMatchObject({
      state: "fired",
      firedAt: T0.toISOString(),
    });
    expect(lineAmount(l)).toBe(14);
    expect(r.before.map((m) => m.name)).toEqual(["SALMOREJO"]);
    expect(r.item).toMatchObject({
      lineId: "m1",
      plu: 7002,
      tag: "CAMBIO 1.º",
      comment: "sin sal",
      notes: ["ANTES: SALMOREJO"],
    });
    const txt = renderText(
      kitchenTicket([r.item], {
        channel: "COCINA",
        waiter: "Marta",
        guests: 2,
        table: { name: "12", area: "Sala" },
        at: T0,
      }),
    );
    expect(txt).toContain(">> CAMBIO 1.º");
    expect(txt).toContain("-- 1 GAZPACHO");
    expect(txt).toContain("(ANTES: SALMOREJO)");
    // la reimpresión (canal COCINA|CAMBIO 1.º) rehace la pieza con la respuesta nueva
    expect(kitchenItemOf(l, "CAMBIO 1.º")).toMatchObject({
      plu: 7002,
      tag: "CAMBIO 1.º",
      modifiers: [{ name: "GAZPACHO" }],
    });
  });
  it("un pase no marchado o sin respuesta nueva → VALIDATION; por debajo de lo cobrado → TOTAL_BELOW_PAID", () => {
    const acc = account({ lines: [menu()] });
    expect(code(() => changeFiredCourse(acc, "m1", 2, [GAZPACHO], T0))).toBe("VALIDATION");
    expect(code(() => changeFiredCourse(acc, "m1", 1, [], T0))).toBe("VALIDATION");
    const caro = account({
      lines: [
        menu({
          modifiers: [
            { name: "AGUA", unitPrice: 0, plu: 1050, course: 0, questionId: "qb" },
            { name: "JAMÓN", unitPrice: 4, plu: 7003, course: 1, questionId: "q1" },
          ],
        }),
      ],
      payments: [pay(16.5)],
    });
    expect(code(() => changeFiredCourse(caro, "m1", 1, [GAZPACHO], T0))).toBe("TOTAL_BELOW_PAID");
    expect(
      code(() =>
        changeFiredCourse(account({ status: "invoiced", lines: [menu()] }), "m1", 1, [GAZPACHO], T0),
      ),
    ).toBe("ACCOUNT_CLOSED");
  });
});

describe("tickets nuevos y factura sin desglose", () => {
  const tctx = {
    store: { legalName: "DAILY FOOD VENTURES S.L.", tradeName: "Cañas y Tapas", taxId: "B02891075" },
    table: { name: "12", area: "Sala" },
    waiter: "Marta",
    at: T0,
  };
  const fits = (txt: string) => txt.split("\n").every((l) => l.length <= WIDTH);
  it("precuenta: una línea por producto con su importe total; sin respuestas ni pases del menú", () => {
    const acc = account({
      lines: [
        line({
          name: "Menú del día",
          unitPrice: 12.5,
          modifiers: [
            { name: "AGUA", unitPrice: 0, course: 0 },
            { name: "GAZPACHO", unitPrice: 1.5, course: 1 },
          ],
        }),
      ],
    });
    const txt = renderText(preBillTicket(acc, tctx));
    expect(txt).toContain("   1   Menú del día                      14,00 €");
    expect(txt).not.toContain("GAZPACHO");
    expect(txt).not.toContain("AGUA");
    expect(fits(txt)).toBe(true);
  });
  it("anulación: título, mesa, producto, motivo, quién y quién autorizó, importe en negativo", () => {
    const txt = renderText(
      voidTicket(
        {
          table: { name: "12", area: "Sala" },
          product: "Croquetas de jamón ibérico (media ración)",
          quantity: 2,
          amount: 11.9,
          reason: "Error al marcar",
          user: "Marta",
          authorizedBy: "Laura Martín",
          at: T0,
        },
        tctx.store,
      ),
    );
    expect(txt).toContain("ANULACIÓN");
    expect(txt).toContain("Mesa 12 Sala");
    expect(txt).toContain("Motivo: Error al marcar");
    expect(txt).toContain("Eliminado por: Marta");
    expect(txt).toContain("Autorizado por: Laura Martín");
    expect(txt).toContain(lr("Importe anulado", "-11,90 €"));
    expect(fits(txt)).toBe(true);
    expect(
      renderText(
        voidTicket({
          table: { name: "1", area: "" },
          product: "Caña",
          quantity: 1,
          amount: 2.5,
          reason: "x",
          user: "M",
          at: T0,
        }),
      ),
    ).not.toContain("Autorizado por");
  });
  it("corte X y corte Z: periodo, ventas por forma de pago, tickets, efectivo esperado; el Z con su número", () => {
    const base = {
      store: tctx.store,
      station: "CAJA1",
      from: new Date("2026-10-13T08:00:00Z"),
      to: T0,
      byMethod: [
        { name: "Efectivo", amount: 120.5, count: 12 },
        { name: "Tarjeta", amount: 340.25, count: 20 },
      ],
      tickets: 32,
      expectedCash: 270.5,
      user: "Laura",
    };
    const x = renderText(cutTicket({ ...base, kind: "X" }));
    expect(x).toContain("CORTE X");
    expect(x).toContain("Lectura sin cierre");
    expect(x).toContain("13/10/2026 10:00");
    expect(x).toContain(lr("Efectivo (12)", "120,50 €"));
    expect(x).toContain(lr("Total ventas", "460,75 €"));
    expect(x).toContain(lr("Tickets", "32"));
    expect(x).toContain(lr("Efectivo esperado", "270,50 €"));
    expect(fits(x)).toBe(true);
    const z = renderText(cutTicket({ ...base, kind: "Z", closingNumber: 12 }));
    expect(z).toContain("CORTE Z");
    expect(z).toContain("Z nº 0012");
    expect(z).not.toContain("Lectura sin cierre");
    expect(renderText(cutTicket({ ...base, kind: "Z" }))).not.toContain("Z nº");
  });
});
