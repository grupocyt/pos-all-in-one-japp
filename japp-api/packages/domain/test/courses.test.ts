import { describe, expect, it } from "vitest";
import { addProduct, sendOrder } from "../src/lines.js";
import { chooseCourse, absorbIntoMenu, sendWithCourses, assertNoPendingCourses, MENU_ABSORB_REASON } from "../src/courses.js";
import { checkAnswers, planCourses, courseOfAnswer, type QuestionRule } from "../src/questions.js";
import { registerPayment } from "../src/payments.js";
import { kitchenTicket, renderText } from "../src/tickets.js";
import type { DomainError } from "../src/errors.js";
import type { Account, Modifier, Product } from "../src/types.js";
import { account, ctx, SALA, AGUA } from "./helpers.js";

const MENU: Product = { plu: 2600, name: "Menu del dia", price: 12.5, taxRate: 10 };
const RULES: QuestionRule[] = [
  { id: "qb", name: "¿Bebida?", min: 1, max: 1, answers: [1050, 1001], course: 0 },
  { id: "q1", name: "¿Primero?", min: 1, max: 1, answers: [7001, 7002], course: 1 },
  { id: "q2", name: "¿Segundo?", min: 1, max: 1, answers: [7101, 7102], course: 2 },
];
const ANS: Record<number, Modifier> = { 1050: { name: "AGUA", unitPrice: 0, plu: 1050 }, 7001: { name: "CREMA", unitPrice: 0, plu: 7001 }, 7101: { name: "MERLUZA", unitPrice: 0, plu: 7101 } };
const mods = (plus: number[]) => plus.map(p => ({ ...ANS[p]!, quantity: 1, ...courseOfAnswer(RULES, { plu: p }) }));
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };
const addMenu = (acc: Account, plus: number[]) => {
  checkAnswers(RULES, plus.map(plu => ({ plu })));
  return addProduct(acc, { product: MENU, area: SALA, modifiers: mods(plus), courses: planCourses(RULES, plus.map(plu => ({ plu }))) }, ctx());
};
const states = (a: Account) => a.lines[0]!.courses!.map(c => `${c.course}:${c.state}`).join(" ");

describe("menú por pases", () => {
  it("la bebida es obligatoria al pedir; el 1.º y el 2.º se pueden dejar por elegir", () => {
    expect(code(() => checkAnswers(RULES, []))).toBe("VALIDATION");
    expect(code(() => checkAnswers(RULES, [{ plu: 1050 }]))).toBe("OK");
    const a = addMenu(account(), [1050]);
    expect(states(a)).toBe("0:ready 1:pending 2:pending");
  });
  it("al guardar sale solo la bebida (a barra) y cocina recibe el aviso de lo que falta", () => {
    const r = sendOrder(addMenu(account(), [1050]), { now: new Date("2026-10-15T11:00:00Z") });
    expect(states(r.account)).toBe("0:fired 1:pending 2:pending");
    expect(r.items.map(i => [i.tag, i.plu])).toEqual([["BEBIDA", 1050], ["AVISO MENÚ", 2600]]);
    expect(r.items[1]!.notes).toEqual(["1.º POR ELEGIR", "2.º POR ELEGIR"]);
    expect(r.account.lines[0]!.courses![0]!.firedAt).toBe("2026-10-15T11:00:00.000Z");
  });
  it("elegir después el 1.º y guardar: sale el 1.º; el 2.º sigue por elegir", () => {
    let a = sendOrder(addMenu(account(), [1050])).account;
    a = chooseCourse(a, a.lines[0]!.id, 1, mods([7001]));
    const r = sendOrder(a);
    expect(states(r.account)).toBe("0:fired 1:fired 2:pending");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ tag: "MARCHA 1.º", plu: 7001, notes: ["2.º POR ELEGIR"] });
    expect(renderText(kitchenTicket(r.items, { channel: "COCINA", waiter: "Marta", guests: 2, table: { name: "12", area: "SALA" }, at: new Date() }))).toContain(">> MARCHA 1.º");
  });
  it("si se elige todo a la vez: bebida y 1.º salen; el 2.º queda en espera hasta «Marchar»", () => {
    let r = sendOrder(addMenu(account(), [1050, 7001, 7101]));
    expect(states(r.account)).toBe("0:fired 1:fired 2:held");
    expect(r.items.find(i => i.tag === "MARCHA 1.º")!.notes).toEqual(["2.º EN ESPERA: MERLUZA"]);
    // otro Guardar (p. ej. se añade un café) no marcha el 2.º en espera
    const again = sendOrder(r.account);
    expect(states(again.account)).toBe("0:fired 1:fired 2:held");
    const m = sendWithCourses(r.account, { force: { lineId: r.account.lines[0]!.id, course: 2 } });
    expect(states(m.account)).toBe("0:fired 1:fired 2:fired");
    expect(m.items.map(i => i.tag)).toEqual(["MARCHA 2.º"]);
  });
  it("no se puede marchar un pase por elegir ni cambiar uno marchado", () => {
    const a = sendOrder(addMenu(account(), [1050])).account, id = a.lines[0]!.id;
    expect(code(() => sendWithCourses(a, { force: { lineId: id, course: 2 } }))).toBe("COURSE_PENDING");
    expect(code(() => chooseCourse(a, id, 0, mods([1050])))).toBe("VALIDATION");
  });
  it("no se cobra con pases por elegir", () => {
    const a = sendOrder(addMenu(account(), [1050])).account;
    expect(code(() => assertNoPendingCourses(a))).toBe("COURSE_PENDING");
    expect(code(() => registerPayment(a, { method: "cash", kind: "cash", amount: 12.5 }, ctx()))).toBe("COURSE_PENDING");
  });
  it("incluir en el menú un agua ya pedida: sale de la cuenta con motivo y la bebida del menú queda marchada", () => {
    let a = addProduct(account(), { product: AGUA, area: SALA }, ctx());
    a = sendOrder(a).account;
    a = addMenu(a, [1050]);
    const menu = a.lines[1]!, agua = a.lines[0]!;
    const r = absorbIntoMenu(a, { menuLineId: menu.id, course: 0, sourceLineId: agua.id, answer: ANS[1050]! }, ctx());
    expect(r.lines.map(l => l.name)).toEqual(["Menu del dia"]);
    expect(r.deletedLines[0]).toMatchObject({ name: "Agua 50 cl", quantity: 1, reason: MENU_ABSORB_REASON, authorizedBy: null });
    expect(r.lines[0]!.courses![0]!.state).toBe("fired");
    // al guardar no vuelve a salir la bebida
    expect(sendOrder(r).items.map(i => i.tag)).toEqual(["AVISO MENÚ"]);
  });
  it("incluir: hacen falta tantas bebidas como menús", () => {
    let a = addProduct(account(), { product: AGUA, area: SALA }, ctx());
    a = addProduct(a, { product: MENU, area: SALA, quantity: 2, modifiers: mods([1050]), courses: planCourses(RULES, [{ plu: 1050 }]) }, ctx());
    expect(code(() => absorbIntoMenu(a, { menuLineId: a.lines[1]!.id, course: 0, sourceLineId: a.lines[0]!.id, answer: ANS[1050]! }, ctx()))).toBe("VALIDATION");
  });
});
