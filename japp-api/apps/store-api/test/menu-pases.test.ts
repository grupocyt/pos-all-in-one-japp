import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, type T } from "./helpers.js";

// Sucursal Pruebas: «Menu Del Dia Ciclo 1» (4478) con bebida (pase 0), primero (1) y segundo (2)
const MENU = 4478, AGUA = 4480, CREMA = 5990, MERLUZA = 6619;
let t: T, tok: string;
beforeAll(async () => { t = await setup(); tok = await t.login(PIN.sistemas); await ensurePeriod(t, tok); });
const opened: string[] = [];
afterAll(async () => {
  // dejar libres las mesas de estas pruebas (el menú por elegir no se puede cobrar): se quitan sus líneas y se cierran sin venta
  for (const id of opened) {
    const tx = (await t.call("GET", `/orders/${id}`, { token: tok })).body;
    if (!["open", "billing"].includes(tx.status)) continue;
    for (const l of tx.accounts.flatMap((a: any) => a.lines)) await t.call("POST", `/orders/${id}/lines/${l.id}/delete`, { token: tok, body: { reason: "Prueba" } });
    await t.call("POST", `/orders/${id}/close`, { token: tok, body: {} });
  }
  await t.close();
});
const open = async () => { const o = (await t.call("POST", "/orders", { token: tok, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })).body; opened.push(o._id); return o; };
const states = (tx: any, i = 0) => tx.accounts[0].lines[i].courses.map((c: any) => `${c.course}:${c.state}`).join(" ");
const kitchen = (from: number) => t.printer.jobs.slice(from).filter(j => j.kind === "kitchen").map(j => j.text).join("\n");

describe("menú del día por pases", () => {
  it("sin bebida no entra; con bebida entra y el 1.º y el 2.º quedan por elegir", async () => {
    const o = await open();
    const no = await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu: MENU } });
    expect([no.status, no.error?.field]).toEqual([422, "modifiers"]);
    const ok = await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu: MENU, modifiers: [{ plu: AGUA }] } });
    expect(ok.status, JSON.stringify(ok.env)).toBe(201);
    expect(states(ok.body)).toBe("0:ready 1:pending 2:pending");
  });

  it("flujo completo: bebida → elegir 1.º → marchar 2.º; no se cobra con pases por elegir", async () => {
    const o = await open();
    const lid = (await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu: MENU, modifiers: [{ plu: AGUA }] } })).body.accounts[0].lines[0].id;
    let n = t.printer.jobs.length;
    let r = await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} });
    expect(states(r.body.order)).toBe("0:fired 1:pending 2:pending");
    expect(kitchen(n)).toContain(">> BEBIDA");
    expect(kitchen(n)).toContain("1.º POR ELEGIR");
    // no se cobra con pases por elegir
    const pay = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/payments`, { token: tok, body: { method: "cash", amount: 5 } });
    expect([pay.status, pay.error?.code]).toEqual([409, "COURSE_PENDING"]);
    // marchar un pase por elegir → 409
    expect((await t.call("POST", `/orders/${o._id}/lines/${lid}/fire`, { token: tok, body: { course: 2 } })).error?.code).toBe("COURSE_PENDING");
    // se elige el 1.º y el 2.º a la vez: al guardar sale el 1.º y el 2.º queda en espera
    expect((await t.call("PUT", `/orders/${o._id}/lines/${lid}/answers`, { token: tok, body: { course: 1, modifiers: [{ plu: CREMA }] } })).status).toBe(200);
    const two = await t.call("PUT", `/orders/${o._id}/lines/${lid}/answers`, { token: tok, body: { course: 2, modifiers: [{ plu: CREMA }] } });
    expect([two.status, two.error?.field]).toEqual([422, "modifiers"]); // la crema no es un segundo
    expect((await t.call("PUT", `/orders/${o._id}/lines/${lid}/answers`, { token: tok, body: { course: 2, modifiers: [{ plu: MERLUZA }] } })).status).toBe(200);
    n = t.printer.jobs.length;
    r = await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} });
    expect(states(r.body.order)).toBe("0:fired 1:fired 2:held");
    expect(kitchen(n)).toContain(">> MARCHA 1.º");
    expect(kitchen(n)).toContain("2.º EN ESPERA: M MERLUZA A LA ROMANA");
    // marchar el 2.º
    n = t.printer.jobs.length;
    const f = await t.call("POST", `/orders/${o._id}/lines/${lid}/fire`, { token: tok, body: { course: 2 } });
    expect(f.status, JSON.stringify(f.env)).toBe(200);
    expect(states(f.body.order)).toBe("0:fired 1:fired 2:fired");
    expect(kitchen(n)).toContain(">> MARCHA 2.º");
    // ya se puede cobrar y facturar; las respuestas se guardaron con su pase
    const { rows } = await t.sql.query("SELECT name, course FROM order_line_modifier WHERE line_id=$1 ORDER BY course", [lid]);
    expect(rows.map((x: any) => x.course)).toEqual([0, 1, 2]);
    const tx = (await t.call("GET", `/orders/${o._id}`, { token: tok })).body;
    const p2 = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/payments`, { token: tok, body: { method: "card", amount: tx.accounts[0].totals.pending } });
    expect(p2.status, JSON.stringify(p2.env)).toBe(201);
  });

  it("«inclúyeme el agua en el menú»: el agua enviada sale de la cuenta con motivo y la bebida del menú queda marchada", async () => {
    const o = await open();
    await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu: AGUA } });
    await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} });
    // menú sin bebida aún elegida no se puede pedir (bebida obligatoria) → se pide con otra y luego se cambia por la ya pedida
    const tx = (await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu: MENU, modifiers: [{ plu: AGUA }] } })).body;
    const agua = tx.accounts[0].lines.find((l: any) => l.productId === AGUA), menu = tx.accounts[0].lines.find((l: any) => l.productId === MENU);
    const totalBefore = tx.accounts[0].totals.total;
    const r = await t.call("POST", `/orders/${o._id}/lines/${menu.id}/absorb`, { token: tok, body: { course: 0, sourceLineId: agua.id } });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    const acc = r.body.accounts[0];
    expect(acc.lines.map((l: any) => l.productId)).toEqual([MENU]);
    expect(acc.lines[0].courses[0]).toMatchObject({ course: 0, state: "fired" });
    expect(acc.totals.total).toBeCloseTo(totalBefore - agua.unitPrice, 2);
    const { rows } = await t.sql.query("SELECT delete_reason, delete_authorized_by_user_name FROM order_line WHERE order_id=$1 AND deleted", [o._id]);
    expect(rows).toEqual([{ delete_reason: "Incluida en menú", delete_authorized_by_user_name: null }]);
    // una respuesta que no es del pase → 422
    const bad = await t.call("POST", `/orders/${o._id}/lines/${menu.id}/absorb`, { token: tok, body: { course: 1, sourceLineId: menu.id } });
    expect(bad.status).toBe(422);
  });
  it("reimprimir un pase que no salió conserva sus notas («2.º EN ESPERA: …», «… POR ELEGIR»)", async () => {
    const o = await open();
    const lid = (await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu: MENU, modifiers: [{ plu: AGUA }] } })).body.accounts[0].lines[0].id;
    await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} });
    await t.call("PUT", `/orders/${o._id}/lines/${lid}/answers`, { token: tok, body: { course: 1, modifiers: [{ plu: CREMA }] } });
    await t.call("PUT", `/orders/${o._id}/lines/${lid}/answers`, { token: tok, body: { course: 2, modifiers: [{ plu: MERLUZA }] } });
    const real = t.printer.print.bind(t.printer);
    let first = "";
    try {
      t.printer.print = async job => { if (job.kind === "kitchen") { first += (first ? "\n" : "") + (await real(job), t.printer.jobs.at(-1)!.text); return { ok: false, error: "apagada" }; } return real(job); };
      expect((await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} })).error.code).toBe("PRINTER_OFFLINE");
    } finally { t.printer.print = real; }
    expect(first).toContain(">> MARCHA 1.º");
    expect(first).toContain("(2.º EN ESPERA: M MERLUZA A LA ROMANA)");
    const n = t.printer.jobs.length;
    const r = await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} });
    expect(r.status).toBe(200);
    const again = kitchen(n);
    expect(again).toContain(">> MARCHA 1.º");
    expect(again).toContain("(2.º EN ESPERA: M MERLUZA A LA ROMANA)");
  });
});
