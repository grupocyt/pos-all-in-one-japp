import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Reconexiones de la orden (04/11/2026, API 1.2.268): lo ticado sin conexión espera en order_reconnection; quien tenga
 * pedido.reconexiones (o con la clave de un encargado) lo valida —entra en la cuenta y sale la comanda— o lo descarta con motivo.
 * Con algo pendiente en la cuenta no se cobra (409 RECONNECTION_PENDING).
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
let n = 0;
const item = (plu: number, name: string, quantity = 1) => ({ clientId: `pda1-test-${++n}`, plu, name, quantity, unitPrice: 2 });

async function mesa() {
  const o = (await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })).body;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  return { id: o._id as string, acc: o.accounts[0].id as string };
}

describe("reconexiones de la orden", () => {
  it("se guarda sin tocar la cuenta, repetir no duplica, y con algo pendiente no se cobra", async () => {
    const m = await mesa();
    const v = (await get(m.id)).version;
    const it1 = item(PLU.redbull, "Red Bull", 2);
    const r = await t.call("POST", `/orders/${m.id}/reconnections`, {
      token: barra,
      body: { accountId: m.acc, offlineReason: "Sin red (wifi)", items: [it1] },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body.items[0]).toMatchObject({ status: "pending", name: "Red Bull", quantity: 2, accountId: m.acc, offlineReason: "Sin red (wifi)", decidedBy: null });
    expect(r.body.items[0].markedBy.user).toBeTruthy();
    const again = await t.call("POST", `/orders/${m.id}/reconnections`, { token: barra, body: { accountId: m.acc, items: [it1] } });
    expect(again.body.items[0].id).toBe(r.body.items[0].id);
    const list = (await t.call("GET", `/reconnections?orderId=${m.id}`, { token: sis })).body.items;
    expect(list).toHaveLength(1);
    const o = await get(m.id);
    expect(o.version).toBe(v); // la cuenta no cambia
    expect(o.accounts[0].lines.map((l: any) => l.name)).not.toContain("Red Bull");
    // no se cobra, ni se factura, ni cobrar y facturar
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, { token: sis, body: { method: "cash", amount: 1 } });
    expect(code(pay)).toEqual([409, "RECONNECTION_PENDING"]);
    expect(pay.error.details.items[0].name).toBe("Red Bull");
    expect(code(await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, { token: sis, body: { payments: [{ method: "cash", amount: null }] } }))).toEqual([409, "RECONNECTION_PENDING"]);
    expect(code(await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/invoice`, { token: sis, body: {} }))).toEqual([409, "RECONNECTION_PENDING"]);
  });

  it("validar pide pedido.reconexiones (o clave de encargado): entra en la cuenta, se envía y queda en el historial", async () => {
    const m = await mesa();
    const rec = (await t.call("POST", `/orders/${m.id}/reconnections`, { token: barra, body: { accountId: m.acc, items: [item(PLU.redbull, "Red Bull")] } })).body.items[0];
    const no = await t.call("POST", `/reconnections/${rec.id}/accept`, { token: barra, body: {} });
    expect([no.status, no.error.code, no.error.details.permission]).toEqual([403, "PERMISSION_REQUIRED", "pedido.reconexiones"]);
    const auth = (await t.call("POST", "/sessions/authorize", { token: barra, body: { pin: PIN.sistemas, permission: "pedido.reconexiones" } })).body.authorization.token;
    const ok = await t.call("POST", `/reconnections/${rec.id}/accept`, { token: barra, body: { authorization: auth } });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body.reconnection.status).toBe("accepted");
    expect(ok.body.reconnection.decidedBy.authorizedBy).toBeTruthy();
    const o = await get(m.id);
    const line = o.accounts[0].lines.find((l: any) => l.id === rec.id);
    expect(line).toMatchObject({ name: expect.stringMatching(/red bull/i), quantity: 1 });
    expect(line.status).not.toBe("pendingPrint"); // enviada: salió la comanda
    const ev = (await t.call("GET", `/orders/${m.id}/events`, { token: sis })).body;
    expect(JSON.stringify(ev)).toMatch(/ticado sin conexión/);
    // repetir devuelve lo mismo; descartar una validada no
    expect((await t.call("POST", `/reconnections/${rec.id}/accept`, { token: sis, body: {} })).body.reconnection.status).toBe("accepted");
    expect(code(await t.call("POST", `/reconnections/${rec.id}/discard`, { token: sis, body: { reason: "Error" } }))).toEqual([409, "RECONNECTION_DECIDED"]);
    expect(o.accounts[0].lines.filter((l: any) => l.id === rec.id)).toHaveLength(1);
    // ya sin pendientes: se cobra
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, { token: sis, body: { method: "cash", amount: 1 } });
    expect(pay.status, JSON.stringify(pay.env)).toBe(201);
  });

  it("descartar pide motivo; no entra en la cuenta y la cuenta vuelve a cobrarse", async () => {
    const m = await mesa();
    const rec = (await t.call("POST", `/orders/${m.id}/reconnections`, { token: barra, body: { items: [item(PLU.croquetas, "Croquetas")] } })).body.items[0];
    expect(rec.accountId).toBeNull(); // sin cuenta: cuenta para todas
    expect(code(await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, { token: sis, body: { method: "cash", amount: 1 } }))).toEqual([409, "RECONNECTION_PENDING"]);
    expect((await t.call("POST", `/reconnections/${rec.id}/discard`, { token: sis, body: { reason: " " } })).status).toBe(422);
    const d = await t.call("POST", `/reconnections/${rec.id}/discard`, { token: sis, body: { reason: "Ya se había servido" } });
    expect(d.status, JSON.stringify(d.env)).toBe(200);
    expect(d.body.reconnection).toMatchObject({ status: "discarded", decidedBy: { reason: "Ya se había servido" } });
    expect(code(await t.call("POST", `/reconnections/${rec.id}/accept`, { token: sis, body: {} }))).toEqual([409, "RECONNECTION_DECIDED"]);
    expect((await get(m.id)).accounts[0].lines.map((l: any) => l.name)).not.toContain("Croquetas");
    expect((await t.call("GET", `/reconnections?orderId=${m.id}`, { token: sis })).body.items).toHaveLength(0);
    expect((await t.call("GET", `/reconnections?status=all&orderId=${m.id}`, { token: sis })).body.items).toHaveLength(1);
    expect((await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, { token: sis, body: { method: "cash", amount: 1 } })).status).toBe(201);
  });

  it("cuenta en cobro: validar responde ACCOUNT_LOCKED y sigue pendiente; mesa que no existe → 404", async () => {
    const m = await mesa();
    await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/discounts`, { token: sis, body: { type: "percentage", value: 10, reason: "Cliente habitual" } });
    const rec = (await t.call("POST", `/orders/${m.id}/reconnections`, { token: barra, body: { accountId: m.acc, items: [item(PLU.redbull, "Red Bull")] } })).body.items[0];
    expect(code(await t.call("POST", `/reconnections/${rec.id}/accept`, { token: sis, body: {} }))).toEqual([409, "ACCOUNT_LOCKED"]);
    expect((await t.call("GET", `/reconnections?orderId=${m.id}`, { token: sis })).body.items[0].status).toBe("pending");
    const nf = await t.call("POST", `/orders/00000000-0000-4000-8000-000000000000/reconnections`, { token: barra, body: { items: [item(PLU.redbull, "Red Bull")] } });
    expect(code(nf)).toEqual([404, "NOT_FOUND"]);
  });
});
