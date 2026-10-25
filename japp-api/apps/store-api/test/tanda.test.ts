import { randomUUID } from "node:crypto";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** POST /orders/{orderId}/batch (25/10/2026): la tanda de cambios de una mesa en UNA petición y UNA transacción. */
let t: T;
let sis: string;
let mesero: string;
let barra: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  barra = await t.login(PIN.barra);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.sql.query(
    "UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL",
  );
  await t.close();
});

const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
const lines = async (id: string) =>
  (await get(id)).accounts.flatMap((a: any) => a.lines).map((l: any) => [l.productId, l.quantity]);
const batch = (tok: string, id: string, commands: unknown[], key?: string) =>
  t.call("POST", `/orders/${id}/batch`, {
    token: tok,
    body: { commands },
    headers: key ? { "idempotency-key": key } : {},
  });
async function newOrder(tok = mesero) {
  const o = (
    await t.call("POST", "/orders", { token: tok, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })
  ).body;
  return { id: o._id as string, acc: o.accounts[0].id as string };
}
const add = (id: string, acc: string, plu: number, quantity = 1, lineId = randomUUID()) => ({
  method: "POST",
  path: `/orders/${id}/lines`,
  body: { id: lineId, accountId: acc, plu, quantity, force: true },
  idempotencyKey: lineId,
});

describe("tanda de cambios de una mesa", () => {
  it("varios cambios en una petición: todo se aplica en orden y cada comando devuelve su respuesta", async () => {
    const o = await newOrder();
    const l1 = randomUUID();
    const r = await batch(mesero, o.id, [
      add(o.id, o.acc, PLU.tosta, 1, l1),
      add(o.id, o.acc, PLU.croquetas, 2),
      { method: "PATCH", path: `/orders/${o.id}`, body: { guests: 4 } },
      { method: "PATCH", path: `/orders/${o.id}/lines/${l1}`, body: { quantity: 3 } },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(4);
    expect(r.body.results.map((x: any) => x.status)).toEqual([201, 201, 200, 200]);
    const g = await get(o.id);
    expect(g.tableData.guests).toBe(4);
    expect((await lines(o.id)).sort()).toEqual(
      [
        [PLU.croquetas, 2],
        [PLU.tosta, 3],
      ].sort(),
    );
  });

  it("abrir la mesa y marcar en la misma tanda", async () => {
    const id = randomUUID(),
      acc = randomUUID();
    const r = await batch(mesero, id, [
      {
        method: "POST",
        path: "/orders",
        body: { id, accountId: acc, tableId: await freeTable(t, "BARRA"), guests: 1 },
        idempotencyKey: id,
      },
      add(id, acc, PLU.redbull, 2),
    ]);
    expect(r.status).toBe(200);
    expect(await lines(id)).toEqual([[PLU.redbull, 2]]);
  });

  it("todo o nada: si un comando falla no queda ninguno y vuelve SU error con batchIndex", async () => {
    const o = await newOrder();
    const v = (await get(o.id)).version;
    const r = await batch(mesero, o.id, [
      add(o.id, o.acc, PLU.tosta),
      { method: "PATCH", path: `/orders/${o.id}/lines/${randomUUID()}`, body: { quantity: 2 } },
    ]);
    expect([r.status, r.error.code]).toEqual([404, "NOT_FOUND"]);
    expect(r.error.details).toMatchObject({ batchIndex: 1, method: "PATCH" });
    expect(await lines(o.id)).toEqual([]);
    expect((await get(o.id)).version).toBe(v);
  });

  it("versión vieja en un comando → 409 VERSION_CONFLICT y nada aplicado", async () => {
    const o = await newOrder();
    const v = (await get(o.id)).version;
    const r = await batch(mesero, o.id, [
      add(o.id, o.acc, PLU.tosta),
      { method: "PATCH", path: `/orders/${o.id}`, body: { guests: 3, version: v } }, // la tanda ya subió la versión
    ]);
    expect([r.status, r.error.code, r.error.details.batchIndex]).toEqual([409, "VERSION_CONFLICT", 1]);
    expect(await lines(o.id)).toEqual([]);
  });

  it("lo que imprime, cobra o toca la presencia no entra en una tanda → 422 commands[i].path", async () => {
    const o = await newOrder();
    for (const p of [
      "/send",
      "/save",
      "/presence",
      `/accounts/${o.acc}/payments`,
      `/accounts/${o.acc}/prebill`,
    ]) {
      const r = await batch(mesero, o.id, [
        add(o.id, o.acc, PLU.tosta),
        { method: "POST", path: `/orders/${o.id}${p}`, body: {} },
      ]);
      expect([r.status, r.error.code, r.error.field]).toEqual([422, "VALIDATION", "commands[1].path"]);
    }
    const otra = await newOrder();
    const r = await batch(mesero, o.id, [add(otra.id, otra.acc, PLU.tosta)]);
    expect(r.error.field).toBe("commands[0].path");
    expect(await lines(o.id)).toEqual([]);
    expect(await lines(otra.id)).toEqual([]);
  });

  it("si otra persona tiene la mesa → 409 TABLE_TAKEN y nada aplicado", async () => {
    const o = await newOrder();
    await t.call("POST", `/orders/${o.id}/presence`, { token: mesero, body: { action: "enter" } });
    const r = await batch(barra, o.id, [add(o.id, o.acc, PLU.tosta)]);
    expect([r.status, r.error.code]).toEqual([409, "TABLE_TAKEN"]);
    expect(await lines(o.id)).toEqual([]);
    await t.call("POST", `/orders/${o.id}/presence`, { token: mesero, body: { action: "leave" } });
  });

  it("permiso: eliminar una línea enviada sin pedido.elimEnviado → 403 PERMISSION_REQUIRED y nada aplicado", async () => {
    const o = await newOrder();
    const l = randomUUID();
    await batch(mesero, o.id, [add(o.id, o.acc, PLU.tosta, 1, l)]);
    await t.call("POST", `/orders/${o.id}/send`, { token: mesero, body: {} });
    const r = await batch(mesero, o.id, [
      add(o.id, o.acc, PLU.croquetas),
      {
        method: "POST",
        path: `/orders/${o.id}/lines/${l}/delete`,
        body: { reason: "Error de marcado", quantity: 1 },
      },
    ]);
    expect([r.status, r.error.code, r.error.details.batchIndex]).toEqual([403, "PERMISSION_REQUIRED", 1]);
    expect(await lines(o.id)).toEqual([[PLU.tosta, 1]]);
  });

  it("idempotencia: la misma tanda con la misma clave se aplica una vez", async () => {
    const o = await newOrder();
    const cmds = [add(o.id, o.acc, PLU.kaspirinha, 2)];
    const key = randomUUID();
    const a = await batch(mesero, o.id, cmds, key);
    const b = await batch(mesero, o.id, cmds, key);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(await lines(o.id)).toEqual([[PLU.kaspirinha, 2]]);
    // y los comandos con su propia clave, en otra tanda, tampoco se duplican
    const c = await batch(mesero, o.id, cmds);
    expect(c.status).toBe(200);
    expect(await lines(o.id)).toEqual([[PLU.kaspirinha, 2]]);
  });

  it("el tiempo de la tanda se ajusta en Facturación (batchSendSeconds, 2–30 s, 5 por defecto)", async () => {
    const cur = (await t.call("GET", "/config/facturacion/current", { token: sis })).body;
    expect(cur.batchSendSeconds).toBe(5);
    const ok = await t.call("PATCH", "/config/facturacion/current", {
      token: sis,
      body: { batchSendSeconds: 8, version: cur.version },
    });
    expect([ok.status, ok.body.item.batchSendSeconds]).toEqual([200, 8]);
    for (const v of [1, 31, 2.5]) {
      const r = await t.call("PATCH", "/config/facturacion/current", {
        token: sis,
        body: { batchSendSeconds: v, version: ok.body.version },
      });
      expect([r.status, r.error.code, r.error.field]).toEqual([422, "VALIDATION", "batchSendSeconds"]);
    }
    const back = await t.call("PATCH", "/config/facturacion/current", {
      token: sis,
      body: { batchSendSeconds: 5, version: ok.body.version },
    });
    expect(back.status).toBe(200);
  });

  it("vacía o mal formada → 422 VALIDATION", async () => {
    const o = await newOrder();
    expect((await batch(mesero, o.id, [])).status).toBe(422);
    expect((await batch(mesero, o.id, [{ method: "GET", path: `/orders/${o.id}` }])).status).toBe(422);
  });
});
