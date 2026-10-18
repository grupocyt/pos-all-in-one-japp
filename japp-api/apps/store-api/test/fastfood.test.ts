import { setup, ensurePeriod, PIN, PLU, type T } from "./helpers.js";

/** Heladería / mostrador: un pedido FF-<estación> fijo, PVP general, se factura y se vuelve a empezar. */
let t: T;
beforeAll(async () => {
  t = await setup();
  await t.sql.query("UPDATE store SET service_type='fastfood'");
  await t.close();
  t = await setup(); // la tienda se cachea al arrancar: arrancamos de nuevo ya en modo fast food
  await ensurePeriod(t, await t.login(PIN.sistemas));
});
afterAll(async () => { await t.sql.query("UPDATE store SET service_type='table'"); await t.close(); });

describe("modo fast food", () => {
  it("abrir FF-CAJA1 dos veces devuelve el mismo pedido; tras facturar se abre uno nuevo", async () => {
    const tok = await t.login(PIN.barra, "CAJA1");
    const a = await t.call("POST", "/orders", { token: tok, body: { tableId: "FF-CAJA1", guests: 1 } });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.tableData).toMatchObject({ name: "FF-CAJA1", priceList: "general" });
    const b = await t.call("POST", "/orders", { token: tok, body: { tableId: "FF-CAJA1", guests: 1 } });
    expect(b.body._id).toBe(a.body._id);
    const l = await t.call("POST", `/orders/${a.body._id}/lines`, { token: tok, body: { plu: PLU.tosta } });
    const acc = l.body.accounts[0];
    await t.call("POST", `/orders/${a.body._id}/accounts/${acc.id}/payments`, { token: tok, body: { method: "cash", amount: acc.totals.total, cashGiven: 10 } });
    expect((await t.call("POST", `/orders/${a.body._id}/accounts/${acc.id}/invoice`, { token: tok })).body.tableClosed).toBe(true);
    const c = await t.call("POST", "/orders", { token: tok, body: { tableId: "FF-CAJA1", guests: 1 } });
    expect(c.body._id).not.toBe(a.body._id);
  });
});
