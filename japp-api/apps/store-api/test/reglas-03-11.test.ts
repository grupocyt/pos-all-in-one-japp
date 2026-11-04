import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Reglas del 03/11/2026 (API 1.2.268): una cuenta con descuento o con un cobro parcial queda CONGELADA (ya se está cobrando).
 * Por cuenta, no por mesa. Para seguir: anular los cobros (POST …/payments/{id}/void) y quitar el descuento.
 */
let t: T;
let sis: string;
let barra: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  barra = await t.login(PIN.barra);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.close();
});

const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
const code = (r: any) => [r.status, r.error?.code];

/** Mesa con Cuenta 1 (tosta enviada + croquetas por enviar) y Cuenta 2 (tosta enviada). */
async function mesa() {
  const o = (
    await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })
  ).body;
  const a1 = o.accounts[0].id as string;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
  const a2 = (await t.call("POST", `/orders/${o._id}/accounts`, { token: sis, body: {} })).body.accounts[1]
    .id as string;
  await t.call("POST", `/orders/${o._id}/lines`, {
    token: sis,
    body: { plu: PLU.tosta, accountId: a2, force: true },
  });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.croquetas, force: true } });
  const ord = await get(o._id);
  const acc1 = ord.accounts.find((a: any) => a.id === a1);
  const sent = acc1.lines.find((l: any) => l.status !== "pendingPrint").id as string;
  const unsent = acc1.lines.find((l: any) => l.status === "pendingPrint").id as string;
  return { id: o._id as string, a1, a2, sent, unsent };
}

describe("cuenta congelada con descuento o cobro parcial (409 ACCOUNT_LOCKED)", () => {
  it("solo con descuento: no se tica, ni se cambia, ni se elimina (tampoco lo por enviar); la otra cuenta sigue libre", async () => {
    const m = await mesa();
    const d = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 10, reason: "Cliente habitual" },
    });
    expect(d.status, JSON.stringify(d.env)).toBe(201);
    const v = (await get(m.id)).version;
    const add = await t.call("POST", `/orders/${m.id}/lines`, {
      token: sis,
      body: { plu: PLU.redbull, accountId: m.a1 },
    });
    expect(code(add)).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(add.error.details).toMatchObject({
      accountId: m.a1,
      action: "añadir productos",
      discount: { reason: "Cliente habitual" },
    });
    expect(
      code(await t.call("PATCH", `/orders/${m.id}/lines/${m.unsent}`, { token: sis, body: { quantity: 2 } })),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(
      code(
        await t.call("PATCH", `/orders/${m.id}/lines/${m.unsent}`, {
          token: sis,
          body: { comment: "sin sal" },
        }),
      ),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(
      code(await t.call("POST", `/orders/${m.id}/lines/${m.unsent}/delete`, { token: sis, body: {} })),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(
      code(
        await t.call("POST", `/orders/${m.id}/lines/${m.sent}/delete`, {
          token: sis,
          body: { reason: "Invitación" },
        }),
      ),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect((await get(m.id)).version).toBe(v);
    // la Cuenta 2 no tiene nada: sigue libre
    const free = await t.call("POST", `/orders/${m.id}/lines`, {
      token: sis,
      body: { plu: PLU.redbull, accountId: m.a2 },
    });
    expect(free.status, JSON.stringify(free.env)).toBe(201);
    // quitado el descuento (no hay cobros), se vuelve a ticar
    const disc = d.body.accounts
      .find((a: any) => a.id === m.a1)
      .discounts.find((x: any) => x.status === "applied").id;
    expect(
      (await t.call("DELETE", `/orders/${m.id}/accounts/${m.a1}/discounts/${disc}`, { token: sis })).status,
    ).toBe(200);
    expect(
      (
        await t.call("POST", `/orders/${m.id}/lines`, {
          token: sis,
          body: { plu: PLU.redbull, accountId: m.a1 },
        })
      ).status,
    ).toBe(201);
  });

  it("con cobro parcial: no se pasan productos a ni desde ella; sí cambiar de mesa (04/11), cliente y cobrar lo que falta", async () => {
    const m = await mesa();
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments`, {
      token: barra,
      body: { method: "cash", amount: 2 },
    });
    expect(pay.status, JSON.stringify(pay.env)).toBe(201);
    let v = (await get(m.id)).version;
    const out = await t.call("POST", `/orders/${m.id}/lines/move`, {
      token: sis,
      body: { lines: [{ lineId: m.sent, quantity: 1 }], toAccountId: m.a2 },
    });
    expect(code(out)).toEqual([409, "ACCOUNT_LOCKED"]);
    const c2 = (await get(m.id)).accounts.find((a: any) => a.id === m.a2).lines[0].id;
    const into = await t.call("POST", `/orders/${m.id}/lines/move`, {
      token: sis,
      body: { lines: [{ lineId: c2, quantity: 1 }], toAccountId: m.a1 },
    });
    expect(code(into)).toEqual([409, "ACCOUNT_LOCKED"]);
    expect((await get(m.id)).version).toBe(v);
    // la Cuenta 2 sí se pasa a otra mesa
    const ok2 = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/transfer`, {
      token: sis,
      body: { toTableId: await freeTable(t, "BARRA"), version: v },
    });
    expect(ok2.status, JSON.stringify(ok2.env)).toBe(200);
    // datos de cliente sí (es parte del cobro)
    const cust = await t.call("PUT", `/orders/${m.id}/accounts/${m.a1}/customer`, {
      token: sis,
      body: { type: "company", taxId: "B12345674", name: "Reglas SL" },
    });
    expect(cust.status, JSON.stringify(cust.env)).toBe(200);
    // y cobrar lo que falta (lo por enviar se envía antes)
    await t.call("POST", `/orders/${m.id}/send`, { token: sis, body: {} });
    v = (await get(m.id)).version;
    const rest = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments`, {
      token: barra,
      body: { method: "card" },
    });
    expect(rest.status, JSON.stringify(rest.env)).toBe(201);
    expect(rest.body.totals.pending).toBe(0);
  });

  it("un descuento no puede dejar la cuenta a 0 € → 422 VALIDATION field value", async () => {
    const m = await mesa();
    const all = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 100, reason: "Invitar" },
    });
    expect([all.status, all.error.code, all.error.field]).toEqual([422, "VALIDATION", "value"]);
    expect(all.error.message).toContain("Invitación");
    const total = (await get(m.id)).accounts.find((a: any) => a.id === m.a2).totals.total;
    const fixed = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/discounts`, {
      token: sis,
      body: { type: "fixed", value: total, reason: "Invitar" },
    });
    expect(fixed.status).toBe(422);
  });
});

describe("para seguir: anular los cobros y quitar el descuento (sin «liberar la cuenta»)", () => {
  it("anulado el cobro sigue congelada por el descuento; quitado el descuento, se tica", async () => {
    const m = await mesa();
    await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/discounts`, {
      token: sis,
      body: { type: "fixed", value: 1, reason: "Cliente habitual" },
    });
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments`, {
      token: barra,
      body: { method: "cash", amount: 2 },
    });
    const v = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments/${pay.body.payment.id}/void`, {
      token: sis,
      body: { reason: "Piden más" },
    });
    expect(v.status, JSON.stringify(v.env)).toBe(200);
    const still = await t.call("POST", `/orders/${m.id}/lines`, {
      token: sis,
      body: { plu: PLU.redbull, accountId: m.a1 },
    });
    expect(code(still)).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(still.error.details.discount).toMatchObject({ reason: "Cliente habitual" });
    const disc = (await get(m.id)).accounts
      .find((a: any) => a.id === m.a1)
      .discounts.find((d: any) => d.status === "applied").id;
    expect(
      (await t.call("DELETE", `/orders/${m.id}/accounts/${m.a1}/discounts/${disc}`, { token: sis })).status,
    ).toBe(200);
    const ok = await t.call("POST", `/orders/${m.id}/lines`, {
      token: sis,
      body: { plu: PLU.redbull, accountId: m.a1 },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(201);
  });
});

describe("Gestiones › Facturas (03/11): historial de la cuenta, descuentos detallados y reimprimir sin cajón", () => {
  it("GET /invoices/{id} trae history y discounts con importe; POST …/reprint no abre el cajón", async () => {
    const m = await mesa();
    await t.call("POST", `/orders/${m.id}/send`, { token: sis, body: {} });
    await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 10, reason: "Cliente habitual" },
    });
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/payments`, {
      token: barra,
      body: { method: "cash", amount: null, cashGiven: 50 },
    });
    expect(pay.status, JSON.stringify(pay.env)).toBe(201);
    const inv = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/invoice`, { token: barra, body: {} });
    expect(inv.status, JSON.stringify(inv.env)).toBe(201);
    expect(t.printer.jobs.at(-1)!.openDrawer).toBe(true); // al cobrar en efectivo, sí
    const list = (await t.call("GET", "/invoices", { token: sis })).body.items;
    const invId = list.find((x: any) => x.invoiceNumber === inv.body.invoice.invoiceNumber).id;
    const d = await t.call("GET", `/invoices/${invId}`, { token: sis });
    expect(d.status, JSON.stringify(d.env)).toBe(200);
    expect(d.body.discounts).toEqual([
      expect.objectContaining({
        reason: "Cliente habitual",
        type: "percentage",
        value: 10,
        status: "applied",
      }),
    ]);
    expect(d.body.discounts[0].amount).toBe(d.body.discountTotal);
    expect(d.body.discounts[0].amount).toBeGreaterThan(0);
    const types = d.body.history.map((e: any) => e.type);
    expect(types).toContain("discountApplied");
    expect(types).toContain("tableOpened"); // lo de la mesa entera también
    // nada de la Cuenta 1
    expect(d.body.history.every((e: any) => e.account === null || e.account === "Cuenta 2")).toBe(true);
    const n = t.printer.jobs.length;
    const r = await t.call("POST", `/invoices/${invId}/reprint`, { token: barra, body: {} });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    const job = t.printer.jobs.slice(n).find((j: any) => j.kind === "invoice");
    expect(job).toBeTruthy();
    expect(job!.openDrawer).toBeFalsy();
  });
});

describe("propina (04/11): fuera de la factura y de VeriFactu; Ajustes decide si se imprime", () => {
  it("la factura y su registro VeriFactu no llevan la propina; printTip = false la quita del ticket", async () => {
    const m = await mesa();
    await t.call("POST", `/orders/${m.id}/send`, { token: sis, body: {} });
    const total = (await get(m.id)).accounts.find((a: any) => a.id === m.a2).totals.total;
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/payments`, {
      token: sis,
      body: { method: "card", amount: null, tip: 3 },
    });
    expect(pay.status, JSON.stringify(pay.env)).toBe(201);
    const inv = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/invoice`, { token: sis, body: {} });
    expect(inv.status, JSON.stringify(inv.env)).toBe(201);
    expect(inv.body.invoice.total).toBe(total);
    const vf = (
      await t.sql.query(
        "SELECT v.total::float t FROM verifactu_record v JOIN invoice i ON i.id = v.invoice_id WHERE i.invoice_number = $1",
        [inv.body.invoice.invoiceNumber],
      )
    ).rows[0];
    expect(vf.t).toBe(total);
    expect(t.printer.jobs.at(-1)!.text).toContain("Propina");
    // Ajustes › Parámetros: printTip = false → la reimpresión ya no la enseña
    const cur = (await t.call("GET", "/config/parametros/current", { token: sis })).body;
    const p = await t.call("PATCH", "/config/parametros/current", {
      token: sis,
      body: { printTip: false, version: cur.version },
    });
    expect(p.status, JSON.stringify(p.env)).toBe(200);
    const list = (await t.call("GET", "/invoices", { token: sis })).body.items;
    const invId = list.find((x: any) => x.invoiceNumber === inv.body.invoice.invoiceNumber).id;
    const n = t.printer.jobs.length;
    expect((await t.call("POST", `/invoices/${invId}/reprint`, { token: sis, body: {} })).status).toBe(200);
    const job = t.printer.jobs.slice(n).find((j: any) => j.kind === "invoice")!;
    expect(job.text).not.toContain("Propina");
    const back = (await t.call("GET", "/config/parametros/current", { token: sis })).body;
    await t.call("PATCH", "/config/parametros/current", {
      token: sis,
      body: { printTip: true, version: back.version },
    });
  });
});
