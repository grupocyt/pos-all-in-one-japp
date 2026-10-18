import { reorderPending, addProduct, changeQuantity, deleteLine, sendOrder, preBill, findSuspectedDuplicate, deletePermissionFor } from "../src/lines.js";
import { priceFor } from "../src/pricing.js";
import { DomainError } from "../src/errors.js";
import { account, line, ctx, minutesAgo, CANA, CROQUETAS, SALA, TERRAZA, PROFILES, MARTA, LUCIA, T0 } from "./helpers.js";

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("precio por zona", () => {
  it("sala usa PVP general", () => expect(priceFor(CANA, SALA)).toBe(2.5));
  it("terraza usa PVP terraza", () => expect(priceFor(CANA, TERRAZA)).toBe(2.9));
  it("terraza sin precio terraza (o 0) cae al general", () => {
    expect(priceFor({ price: 2 }, TERRAZA)).toBe(2);
    expect(priceFor({ price: 2, terracePrice: 0 }, TERRAZA)).toBe(2);
  });
  it("sin área (fastfood) usa general", () => expect(priceFor(CANA, null)).toBe(2.5));
});

describe("añadir producto", () => {
  it("crea línea «Por enviar» con precio de la zona e IVA del producto", () => {
    const a = addProduct(account(), { product: CROQUETAS, area: TERRAZA }, ctx());
    expect(a.lines[0]).toMatchObject({ productId: 3004, quantity: 1, unitPrice: 11.5, taxRate: 10, status: "pendingPrint" });
  });
  it("no muta la cuenta original", () => {
    const acc = account();
    addProduct(acc, { product: CANA, area: SALA }, ctx());
    expect(acc.lines).toHaveLength(0);
  });
  it("junta con una línea «Por enviar» igual sin modificadores ni comentario", () => {
    let a = addProduct(account(), { product: CANA, area: SALA }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, quantity: 2 }, ctx());
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0]!.quantity).toBe(3);
  });
  it("no junta si ya está enviada, si lleva comentario o modificadores", () => {
    let a = addProduct(account(), { product: CANA, area: SALA }, ctx());
    a = sendOrder(a).account;
    a = addProduct(a, { product: CANA, area: SALA }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, comment: "bien fría" }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, modifiers: [{ name: "Con limón", unitPrice: 0 }] }, ctx());
    expect(a.lines).toHaveLength(4);
  });
  it("con preguntas: mismas respuestas se juntan; respuestas distintas van en otra línea (como en la PDA)", () => {
    const fria = [{ name: "Con limón", quantity: 1, unitPrice: 0 }], otra = [{ name: "Con naranja", quantity: 1, unitPrice: 0.5 }];
    let a = addProduct(account(), { product: CANA, area: SALA, modifiers: fria, quantity: 2 }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, modifiers: [{ ...fria[0]! }] }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, modifiers: otra }, ctx());
    expect(a.lines.map(l => [l.modifiers[0]!.name, l.quantity])).toEqual([["Con limón", 3], ["Con naranja", 1]]);
  });
  it("mismo comentario se junta; otro comentario va en otra línea", () => {
    let a = addProduct(account(), { product: CANA, area: SALA, comment: "sin hielo" }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, comment: "sin hielo ", quantity: 2 }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, comment: "con limón" }, ctx());
    expect(a.lines.map(l => [l.comment, l.quantity])).toEqual([["sin hielo", 3], ["con limón", 1]]);
  });
  it("cantidad 0, negativa o decimal → VALIDATION", () => {
    for (const q of [0, -1, 1.5]) expect(code(() => addProduct(account(), { product: CANA, area: SALA, quantity: q }, ctx()))).toBe("VALIDATION");
  });
  it("cuenta facturada → ACCOUNT_CLOSED", () => {
    expect(code(() => addProduct(account({ status: "invoiced" }), { product: CANA, area: SALA }, ctx()))).toBe("ACCOUNT_CLOSED");
  });
});

describe("aviso de duplicado (3 minutos, otra persona)", () => {
  const otra = (min: number) => account({ lines: [line({ productId: CANA.plu, status: "printed", createdBy: { user: "Pablo", role: "waiter", at: minutesAgo(min) } })] });
  it("mismo producto de otra persona hace 2 min → DUPLICATE_SUSPECTED", () => {
    expect(code(() => addProduct(otra(2), { product: CANA, area: SALA }, ctx()))).toBe("DUPLICATE_SUSPECTED");
  });
  it("justo en el límite de 3 min todavía avisa; a los 3 min y 1 s no", () => {
    expect(findSuspectedDuplicate(otra(3), CANA.plu, "Marta", T0)).not.toBeNull();
    expect(findSuspectedDuplicate(otra(3 + 1 / 60), CANA.plu, "Marta", T0)).toBeNull();
  });
  it("con force se añade igualmente", () => {
    expect(addProduct(otra(1), { product: CANA, area: SALA, force: true }, ctx()).lines).toHaveLength(2);
  });
  it("si lo marcó la misma persona no avisa", () => {
    const a = account({ lines: [line({ productId: CANA.plu, createdBy: { user: "Marta", role: "waiter", at: minutesAgo(1) } })] });
    expect(code(() => addProduct(a, { product: CANA, area: SALA }, ctx()))).toBe("OK");
  });
  it("respeta la ventana configurada (Parámetros › dupMin)", () => {
    expect(code(() => addProduct(otra(4), { product: CANA, area: SALA, dupWindowMin: 5 }, ctx()))).toBe("DUPLICATE_SUSPECTED");
  });
});

describe("cambiar cantidad", () => {
  it("solo «Por enviar»", () => {
    const l = line({ quantity: 2 });
    expect(changeQuantity(account({ lines: [l] }), l.id, 1).lines[0]!.quantity).toBe(3);
    const p = line({ status: "printed" });
    expect(code(() => changeQuantity(account({ lines: [p] }), p.id, 1))).toBe("VALIDATION");
  });
  it("llegar a 0 quita la línea", () => {
    const l = line({ quantity: 1 });
    expect(changeQuantity(account({ lines: [l] }), l.id, -1).lines).toHaveLength(0);
  });
  it("línea que no existe → NOT_FOUND", () => expect(code(() => changeQuantity(account(), "nope", 1))).toBe("NOT_FOUND"));
});

describe("eliminar línea", () => {
  const base = { profiles: PROFILES, actor: MARTA };
  it("permiso según estado", () => {
    expect(deletePermissionFor({ status: "pendingPrint" })).toBeNull();
    expect(deletePermissionFor({ status: "printed" })).toBe("pedido.elimEnviado");
    expect(deletePermissionFor({ status: "preBill" })).toBe("pedido.elimPrecuenta");
  });
  it("«Por enviar» se quita sin motivo y sin dejar rastro", () => {
    const l = line();
    const a = deleteLine(account({ lines: [l] }), { ...base, lineId: l.id }, ctx());
    expect(a.lines).toHaveLength(0);
    expect(a.deletedLines).toHaveLength(0);
  });
  it("enviada sin motivo → VALIDATION", () => {
    const l = line({ status: "printed" });
    expect(code(() => deleteLine(account({ lines: [l] }), { ...base, lineId: l.id }, ctx()))).toBe("VALIDATION");
  });
  it("enviada, camarero sin permiso y sin encargado → PERMISSION_REQUIRED", () => {
    const l = line({ status: "printed" });
    try { deleteLine(account({ lines: [l] }), { ...base, lineId: l.id, reason: "Error al marcar" }, ctx()); expect.fail(); }
    catch (e) { expect((e as DomainError).code).toBe("PERMISSION_REQUIRED"); expect((e as DomainError).details.permission).toBe("pedido.elimEnviado"); expect((e as DomainError).status).toBe(403); }
  });
  it("autoriza alguien que tampoco tiene el permiso → NOT_ALLOWED", () => {
    const l = line({ status: "preBill" });
    expect(code(() => deleteLine(account({ lines: [l] }), { ...base, lineId: l.id, reason: "x", authorizer: { id: "u2", profileId: "CAMARERO" } }, ctx()))).toBe("NOT_ALLOWED");
  });
  it("con clave de encargado pasa a deletedLines con motivo, quién y quién autorizó", () => {
    const l = line({ status: "preBill" });
    const lucia = { user: "Lucía", role: "manager", at: T0.toISOString() };
    const a = deleteLine(account({ lines: [l] }), { ...base, lineId: l.id, reason: " Cliente cambia de idea ", authorizer: LUCIA, authorizerActor: lucia }, ctx());
    expect(a.lines).toHaveLength(0);
    expect(a.deletedLines[0]).toMatchObject({ id: l.id, reason: "Cliente cambia de idea", removedBy: { user: "Marta" }, authorizedBy: { user: "Lucía" } });
  });
  it("borrado parcial: quita n unidades y deja el resto en la línea", () => {
    const l = line({ status: "printed", quantity: 3 });
    const a = deleteLine(account({ lines: [l] }), { profiles: PROFILES, actor: LUCIA, lineId: l.id, reason: "Rotura", quantity: 1 }, ctx({ actor: { user: "Lucía", role: "manager", at: "" } }));
    expect(a.lines[0]).toMatchObject({ id: l.id, quantity: 2 });
    expect(a.deletedLines[0]).toMatchObject({ quantity: 1, reason: "Rotura" });
    expect(a.deletedLines[0]!.id).not.toBe(l.id);
  });
  it("borrar más unidades de las que hay → VALIDATION", () => {
    const l = line({ quantity: 2 });
    expect(code(() => deleteLine(account({ lines: [l] }), { ...base, lineId: l.id, quantity: 3 }, ctx()))).toBe("VALIDATION");
  });
  it("encargado con permiso propio no necesita autorizador", () => {
    const l = line({ status: "printed" });
    const a = deleteLine(account({ lines: [l] }), { profiles: PROFILES, actor: LUCIA, lineId: l.id, reason: "Rotura" }, ctx({ actor: { user: "Lucía", role: "manager", at: "" } }));
    expect(a.deletedLines[0]!.authorizedBy).toBeNull();
  });
});

describe("enviar y precuenta", () => {
  it("enviar pasa «Por enviar» → «Enviado» y devuelve lo que hay que imprimir", () => {
    const a = account({ lines: [line(), line({ status: "printed" })] });
    const r = sendOrder(a);
    expect(r.sent).toHaveLength(1);
    expect(r.account.lines.every(l => l.status === "printed")).toBe(true);
  });
  it("precuenta pasa «Enviado» → «Precuenta» y deja lo no enviado", () => {
    const a = preBill(account({ lines: [line({ status: "printed" }), line()] }));
    expect(a.lines.map(l => l.status)).toEqual(["preBill", "pendingPrint"]);
  });
});

describe("ordenar lo «Por enviar»", () => {
  it("cambia el orden de lo por enviar y deja lo enviado en su sitio", () => {
    let a = addProduct(account(), { product: CANA, area: SALA }, ctx());
    a = sendOrder(a).account;
    a = addProduct(a, { product: CROQUETAS, area: SALA }, ctx());
    a = addProduct(a, { product: CANA, area: SALA, comment: "otra" }, ctx());
    const [sent, x, y] = a.lines;
    const r = reorderPending(a, [y!.id, x!.id]);
    expect(r.lines.map(l => l.id)).toEqual([sent!.id, y!.id, x!.id]);
    expect(a.lines.map(l => l.id)).toEqual([sent!.id, x!.id, y!.id]); // no muta
  });
  it("faltan, sobran o se repiten ids, o se intenta mover lo enviado → VALIDATION", () => {
    let a = addProduct(account(), { product: CANA, area: SALA }, ctx());
    a = sendOrder(a).account;
    a = addProduct(a, { product: CROQUETAS, area: SALA }, ctx());
    const [sent, p] = a.lines;
    for (const ids of [[], [p!.id, p!.id], [sent!.id], [p!.id, sent!.id]]) expect(code(() => reorderPending(a, ids))).toBe("VALIDATION");
  });
});

describe("línea ya cobrada (TOTAL_BELOW_PAID)", () => {
  const paid = (amount: number, lines: ReturnType<typeof line>[]) => account({ lines, payments: [{ id: "p", method: "cash", kind: "cash", amount, tip: 0, cashGiven: amount, change: 0, status: "confirmed", collectedBy: { user: "x", role: "waiter", at: "" } }] });
  const err = (fn: () => unknown) => { try { fn(); } catch (e: any) { return [e.code, e.message]; } return null; };
  it("eliminar o bajar cantidad por debajo de lo cobrado → 409", () => {
    const a = paid(15, [line({ id: "a", unitPrice: 10, status: "printed" }), line({ id: "b", unitPrice: 10 })]);
    expect(err(() => deleteLine(a, { lineId: "b", actor: LUCIA, profiles: PROFILES }, ctx()))).toEqual(["TOTAL_BELOW_PAID", "Ya se ha cobrado 15,00 €: no se puede dejar la cuenta por debajo"]);
    expect(err(() => deleteLine(a, { lineId: "a", reason: "Error", actor: LUCIA, profiles: PROFILES }, ctx()))?.[0]).toBe("TOTAL_BELOW_PAID");
    expect(err(() => changeQuantity(a, "b", -1))?.[0]).toBe("TOTAL_BELOW_PAID");
  });
  it("si sigue cubierto se puede; añadir tras un cobro parcial también", () => {
    const a = paid(10, [line({ id: "a", unitPrice: 10, status: "printed" }), line({ id: "b", unitPrice: 10, quantity: 2 })]);
    expect(deleteLine(a, { lineId: "b", quantity: 2, actor: LUCIA, profiles: PROFILES }, ctx()).lines).toHaveLength(1);
    expect(addProduct(a, { product: CANA, area: SALA, force: true }, ctx()).lines).toHaveLength(3);
  });
});
