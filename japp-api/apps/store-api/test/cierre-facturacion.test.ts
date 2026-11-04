import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Cierre de la versión de facturación (decidido con el dueño el 04/11/2026, API 1.2.268, migración 0030):
 * F1 factura completa que sustituye a una simplificada · F3 límite de la simplificada · 10 estado de envío ·
 * 9 nada a 0 € · N3 propina con todas las formas de pago · N7 Order on Table en su propia cuenta · 16 tablero de delivery.
 */
let t: T;
let sis: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.close();
});
const code = (r: any) => [r.status, r.error?.code];
const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
async function mesa(plu: number = PLU.tosta, qty = 1) {
  const o = (await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })).body;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu, quantity: qty, force: true } });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  return { id: o._id as string, acc: o.accounts[0].id as string };
}
const invoiceIdOf = async (num: string) =>
  (await t.call("GET", "/invoices", { token: sis })).body.items.find((x: any) => x.invoiceNumber === num).id as string;
const CUST = { type: "company", taxId: "B12345674", name: "Eventos Madrid SL", email: "admin@eventos.es" };

describe("cierre de facturación (04/11)", () => {
  it("9 · no se tica nada a 0 €", async () => {
    const m = await mesa();
    const zero = (await t.sql.query("SELECT plu FROM product WHERE price = 0 AND active LIMIT 1")).rows[0].plu;
    const r = await t.call("POST", `/orders/${m.id}/lines`, { token: sis, body: { plu: zero, force: true } });
    expect(code(r)).toEqual([422, "ZERO_PRICE"]);
  });

  it("10 · la factura lleva su estado de envío: no enviada", async () => {
    const m = await mesa();
    const co = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, { token: sis, body: { payments: [{ method: "card", amount: null }] } });
    expect(co.status, JSON.stringify(co.env)).toBe(201);
    const id = await invoiceIdOf(co.body.invoice.invoiceNumber);
    expect((await t.call("GET", `/invoices/${id}`, { token: sis })).body.emailStatus).toBe("not_sent");
    expect((await t.call("GET", "/invoices", { token: sis })).body.items.find((x: any) => x.id === id).emailStatus).toBe("not_sent");
  });

  it("F3 · límite de la simplificada configurable: por encima pide factura completa; 0 = sin límite", async () => {
    const fa = (await t.call("GET", "/config/facturacion/current", { token: sis })).body;
    expect(Number(fa.simplifiedLimit)).toBe(3000);
    const set = async (v: number) => {
      const cur = (await t.call("GET", "/config/facturacion/current", { token: sis })).body;
      const r = await t.call("PATCH", "/config/facturacion/current", { token: sis, body: { simplifiedLimit: v, version: cur.version } });
      expect(r.status, JSON.stringify(r.env)).toBe(200);
    };
    await set(5);
    const m = await mesa(PLU.tosta, 3);
    const co = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, { token: sis, body: { payments: [{ method: "card", amount: null }] } });
    expect(code(co)).toEqual([422, "SIMPLIFIED_LIMIT"]);
    expect(co.error.details).toMatchObject({ limit: 5 });
    expect((await get(m.id)).accounts[0].payments).toHaveLength(0); // no se cobró nada
    // con los datos del cliente sale la completa
    expect((await t.call("PUT", `/orders/${m.id}/accounts/${m.acc}/customer`, { token: sis, body: CUST })).status).toBe(200);
    const ok = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, { token: sis, body: { payments: [{ method: "card", amount: null }] } });
    expect(ok.status, JSON.stringify(ok.env)).toBe(201);
    expect(ok.body.invoice.type).toBe("F1");
    await set(0); // sin límite
    const m2 = await mesa(PLU.tosta, 3);
    expect((await t.call("POST", `/orders/${m2.id}/accounts/${m2.acc}/checkout`, { token: sis, body: { payments: [{ method: "card", amount: null }] } })).status).toBe(201);
    await set(3000);
  });

  it("F1 · factura completa que sustituye a una simplificada: no se edita nada ni se mueve dinero; no cuenta dos veces", async () => {
    const m = await mesa();
    const co = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, { token: sis, body: { payments: [{ method: "cash", amount: null, cashGiven: 50 }] } });
    expect(co.status).toBe(201);
    const f2 = co.body.invoice;
    const id = await invoiceIdOf(f2.invoiceNumber);
    const before = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const bad = await t.call("POST", `/invoices/${id}/full`, { token: sis, body: { customer: { ...CUST, taxId: "12345678A" } } });
    expect(bad.status, JSON.stringify(bad.env)).toBe(422);
    const r = await t.call("POST", `/invoices/${id}/full`, { token: sis, body: { customer: CUST } });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body).toMatchObject({ type: "F3", substitutes: f2.invoiceNumber, total: f2.total, customer: { taxId: "B12345674" } });
    expect(r.body.printed).toBe(true);
    const job = t.printer.jobs.filter((j: any) => j.kind === "invoice").at(-1)!;
    expect(job.text).toContain(`Sustituye a la factura simplificada ${f2.invoiceNumber}`);
    expect(job.text).toContain("Eventos Madrid SL");
    expect(job.openDrawer).toBeFalsy();
    const orig = (await t.call("GET", `/invoices/${id}`, { token: sis })).body;
    expect(orig.status).toBe("substituted");
    const full = (await t.call("GET", `/invoices/${r.body.id}`, { token: sis })).body;
    expect(full).toMatchObject({ type: "F3", substitutes: f2.invoiceNumber, status: "issued", total: f2.total });
    const after = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(after.expectedCash).toBe(before.expectedCash); // no mueve dinero
    expect(after.totalSales).toBe(before.totalSales); // la sustituida no cuenta dos veces
    // otra vez → no; abonar la sustituida → no; la F3 sí se abona (R1)
    expect(code(await t.call("POST", `/invoices/${id}/full`, { token: sis, body: { customer: CUST } }))).toEqual([409, "INVALID_TRANSITION"]);
    expect(code(await t.call("POST", `/invoices/${id}/credit`, { token: sis, body: { reason: "Error" } }))).toEqual([409, "INVALID_TRANSITION"]);
    const cr = await t.call("POST", `/invoices/${r.body.id}/credit`, { token: sis, body: { reason: "Devolución" } });
    expect(cr.status, JSON.stringify(cr.env)).toBe(201);
    expect(cr.body.type).toBe("R1");
    // reimprimir la F3: su ticket, sin cajón
    const n = t.printer.jobs.length;
    expect((await t.call("POST", `/invoices/${r.body.id}/reprint`, { token: sis, body: {} })).status).toBe(200);
    const rj = t.printer.jobs.slice(n).find((j: any) => j.kind === "invoice")!;
    expect(rj.text).toContain("Sustituye a la factura simplificada");
    expect(rj.openDrawer).toBeFalsy();
  });

  it("N3 · propina con todas las formas de pago: en efectivo el entregado cubre cuenta + propina y va al cajón", async () => {
    const m = await mesa();
    const total = (await get(m.id)).accounts[0].totals.total;
    const before = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const short = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, { token: sis, body: { method: "cash", amount: null, tip: 2, cashGiven: total } });
    expect(short.status).toBe(422);
    const p = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, { token: sis, body: { method: "cash", amount: null, tip: 2, cashGiven: total + 10 } });
    expect(p.status, JSON.stringify(p.env)).toBe(201);
    expect(p.body.payment.change).toBe(8);
    const inv = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/invoice`, { token: sis, body: {} });
    expect(inv.body.invoice.total).toBe(total); // la propina no es factura
    const after = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(Math.round((after.expectedCash - before.expectedCash) * 100) / 100).toBe(Math.round((total + 2) * 100) / 100);
  });

  it("16 · el tablero de delivery ya no es para el mesero", async () => {
    const r = await t.call("GET", "/delivery/orders", { token: mesero });
    expect(code(r)).toEqual([403, "PERMISSION_REQUIRED"]);
    expect((await t.call("GET", "/delivery/orders", { token: sis })).status).toBe(200);
  });
});
