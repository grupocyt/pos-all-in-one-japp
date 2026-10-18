import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** POST /orders/{id}/accounts/{accountId}/transfer: una cuenta entera a otra mesa. */
let t: T, sis: string, mesero: string, jeison: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas); mesero = await t.login(PIN.mesero); jeison = await t.login(PIN.jeison);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.sql.query("UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL");
  await t.close();
});

const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
/** Mesa con dos cuentas: Cuenta 1 (tosta) y Cuenta 2 (croquetas + red bull). */
async function twoAccounts() {
  const o = (await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 3 } })).body;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
  const a2 = (await t.call("POST", `/orders/${o._id}/accounts`, { token: sis, body: {} })).body.accounts[1].id;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.croquetas, accountId: a2, force: true } });
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.redbull, accountId: a2, force: true } });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  return { orderId: o._id as string, a1: o.accounts[0].id as string, a2: a2 as string, table: o.tableData.name as string };
}
const move = (tok: string, o: { orderId: string }, acc: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  t.call("POST", `/orders/${o.orderId}/accounts/${acc}/transfer`, { token: tok, body, headers });

describe("pasar una cuenta a otra mesa", () => {
  it("a una mesa libre: se abre con la cuenta entera (mismo id, mismos precios, cobro parcial incluido); el origen sigue con la otra", async () => {
    const o = await twoAccounts();
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.a2}/payments`, { token: sis, body: { method: "card", amount: 2 } });
    const before = await get(o.orderId);
    const acc = before.accounts.find((a: any) => a.id === o.a2);
    const dest = await freeTable(t, "TERRAZA"); // otra tarifa: los precios no cambian
    const r = await move(sis, o, o.a2, { version: before.version, toTableId: dest });
    expect(r.status).toBe(200);
    expect(r.body.from.accounts.map((a: any) => a.id)).toEqual([o.a1]);
    expect(r.body.from.version).toBe(before.version + 1);
    expect(r.body.to.tableData).toMatchObject({ tableId: dest, guests: 1 });
    const moved = r.body.to.accounts[0];
    expect(moved).toMatchObject({ id: o.a2, name: "Cuenta 2", totals: acc.totals });
    expect(moved.lines.map((l: any) => [l.productId, l.unitPrice, l.status])).toEqual(acc.lines.map((l: any) => [l.productId, l.unitPrice, l.status]));
    expect(moved.payments.map((p: any) => p.amount)).toEqual([2]);
    expect(r.body.from.events.map((e: any) => e.description)).toContain(`Cuenta 2 pasa a la mesa ${r.body.to.tableData.name}`);
    expect(r.body.to.events.map((e: any) => e.description)).toContain(`Llega Cuenta 2 desde la mesa ${o.table}`);
    const { rows } = await t.sql.query("SELECT DISTINCT order_id::text FROM order_line WHERE account_id = $1", [o.a2]);
    expect(rows).toEqual([{ order_id: r.body.to._id }]);
    // y se sigue cobrando allí
    expect((await t.call("POST", `/orders/${r.body.to._id}/accounts/${o.a2}/payments`, { token: sis, body: { method: "card", amount: null } })).status).toBe(201);
    expect((await t.call("POST", `/orders/${r.body.to._id}/accounts/${o.a2}/invoice`, { token: sis, body: {} })).status).toBe(201);
  });

  it("a una mesa ocupada: una cuenta más, renombrada si el nombre existe; el origen sin cuentas vivas se cierra y la mesa queda libre", async () => {
    const dest = await twoAccounts();
    const src = (await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })).body;
    await t.call("POST", `/orders/${src._id}/lines`, { token: sis, body: { plu: PLU.kaspirinha, force: true } });
    const v = (await get(src._id)).version, destV = (await get(dest.orderId)).version;
    const r = await move(sis, { orderId: src._id }, src.accounts[0].id, { version: v, toTableId: (await get(dest.orderId)).tableData.tableId });
    expect(r.status).toBe(200);
    expect(r.body.to.accounts.map((a: any) => a.name)).toEqual(["Cuenta 1", "Cuenta 2", "Cuenta 3"]);
    expect(r.body.to.accounts[0].lines).toHaveLength(1); // no se juntan líneas
    expect(r.body.to.version).toBe(destV + 1);
    expect(r.body.from.status).toBe("cancelled");
    const tbl = (await t.call("GET", "/tables", { token: sis })).body.items.find((x: any) => x.tableId === src.tableData.tableId);
    expect(tbl.state).toBe("free");
    expect(r.body.to.events.map((e: any) => e.description)).toContain(`Llega Cuenta 1 desde la mesa ${src.tableData.name} (ahora Cuenta 3)`);
  });

  it("facturada → 422 NOTHING_TO_TRANSFER; a la misma mesa → 422; versión vieja → 409 VERSION_CONFLICT; cuerpo malo → 422", async () => {
    const o = await twoAccounts();
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.a1}/payments`, { token: sis, body: { method: "card", amount: null } });
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.a1}/invoice`, { token: sis, body: {} });
    const tx = await get(o.orderId);
    const inv = await move(sis, o, o.a1, { version: tx.version, toTableId: await freeTable(t, "BARRA") });
    expect([inv.status, inv.error.code]).toEqual([422, "NOTHING_TO_TRANSFER"]);
    expect((await move(sis, o, o.a2, { version: tx.version, toTableId: tx.tableData.tableId })).error).toMatchObject({ code: "VALIDATION", field: "toTableId" });
    expect((await move(sis, o, o.a2, { version: tx.version - 1, toTableId: await freeTable(t, "BARRA") })).error.code).toBe("VERSION_CONFLICT");
    expect((await move(sis, o, o.a2, { toTableId: await freeTable(t, "BARRA") })).status).toBe(422);
    expect((await move(sis, o, o.a2, { version: tx.version, toTableId: "mesa-8" })).status).toBe(422);
  });

  it("destino cobrándose → 409 TABLE_CHARGING; destino con otra persona → TABLE_TAKEN salvo mesas.entrarOcupada", async () => {
    const dest = await twoAccounts();
    const o = await twoAccounts();
    const destTable = (await get(dest.orderId)).tableData.tableId;
    await t.call("POST", `/orders/${dest.orderId}/presence`, { token: jeison, body: { action: "charging" } });
    const ch = await move(sis, o, o.a2, { version: (await get(o.orderId)).version, toTableId: destTable });
    expect([ch.status, ch.error.code]).toEqual([409, "TABLE_CHARGING"]);
    await t.call("POST", `/orders/${dest.orderId}/presence`, { token: jeison, body: { action: "chargingEnd" } });
    // el Mesero (sin entrarOcupada) no mete una cuenta en una mesa que tiene Jeison; Sistemas sí
    const auth = (await t.call("POST", "/sessions/authorize", { token: mesero, body: { pin: PIN.sistemas, permission: "mesas.transferir" } })).body.authorization.token;
    const tk = await move(mesero, o, o.a2, { version: (await get(o.orderId)).version, toTableId: destTable, authorization: auth });
    expect([tk.status, tk.error.code]).toEqual([409, "TABLE_TAKEN"]);
    expect((await move(sis, o, o.a2, { version: (await get(o.orderId)).version, toTableId: destTable })).status).toBe(200);
  });

  it("sin mesas.transferir → 403 PERMISSION_REQUIRED; misma Idempotency-Key a la vez → un solo traspaso", async () => {
    const o = await twoAccounts();
    await t.sql.query("DELETE FROM profile_permission WHERE permission_code='mesas.transferir' AND profile_id=(SELECT id FROM user_profile WHERE code='MESERO')");
    try {
      const no = await move(mesero, o, o.a2, { version: (await get(o.orderId)).version, toTableId: await freeTable(t, "BARRA") });
      expect([no.status, no.error.code, no.error.details.permission]).toEqual([403, "PERMISSION_REQUIRED", "mesas.transferir"]);
    } finally {
      await t.sql.query("INSERT INTO profile_permission (profile_id, permission_code, store_id) SELECT id, 'mesas.transferir', store_id FROM user_profile WHERE code='MESERO' ON CONFLICT DO NOTHING");
    }
    const h = { "idempotency-key": crypto.randomUUID() };
    const body = { version: (await get(o.orderId)).version, toTableId: await freeTable(t, "BARRA") };
    const [a, b] = await Promise.all([move(sis, o, o.a2, body, h), move(sis, o, o.a2, body, h)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body.to._id).toBe(a.body.to._id);
    expect((await t.sql.query("SELECT count(*)::int n FROM orders WHERE table_id = $1 AND status IN ('open','billing')", [body.toTableId])).rows[0].n).toBe(1);
  });

  it("a la vez que se añade una línea en el origen: sin interbloqueo y todo queda en una sola orden", async () => {
    const o = await twoAccounts();
    const v = (await get(o.orderId)).version, dest = await freeTable(t, "BARRA");
    const [tr, add] = await Promise.all([
      move(sis, o, o.a2, { version: v, toTableId: dest }),
      t.call("POST", `/orders/${o.orderId}/lines`, { token: sis, body: { plu: PLU.tosta, accountId: o.a2, force: true } }),
    ]);
    // o la línea entra antes (y la cuenta se va con ella; el traspaso ve otra versión → 409) o después (la cuenta ya no está → 404)
    expect([[200, 404], [409, 201]]).toContainEqual([tr.status, add.status]);
    const { rows } = await t.sql.query("SELECT count(DISTINCT order_id)::int n FROM order_line WHERE account_id = $1", [o.a2]);
    expect(rows[0].n).toBe(1);
  });
});
