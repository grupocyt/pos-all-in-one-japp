import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * 1.2.291 (20/11/2026) · Ajustes › Funcionalidades:
 *  - «Transferir producto» aparte de «Transferir mesa»: el TPV manda item = true al pasar un producto suelto; apagado → 403.
 *  - «Reabrir» ya no está (una cuenta cobrada no se reabre nunca): mandarlo → 422.
 */
let t: T;
let sistemas: string;
beforeAll(async () => {
  t = await setup();
  sistemas = await t.login(PIN.sistemas);
  await ensurePeriod(t, sistemas);
});
afterAll(async () => {
  await t.sql.query("UPDATE store_parameters SET disabled_features = '[]'::jsonb");
  await t.close();
});
const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sistemas })).body;
const open = async () => {
  const o = await t.call("POST", "/orders", { token: sistemas, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } });
  await t.call("POST", `/orders/${o.body._id}/lines`, { token: sistemas, body: { plu: PLU.tosta, force: true } });
  await t.call("POST", `/orders/${o.body._id}/send`, { token: sistemas, body: {} });
  return { id: o.body._id as string, tableId: o.body.tableData.tableId as string, acc: o.body.accounts[0].id as string };
};
const setOff = async (keys: string[]) => {
  const p = (await t.call("GET", "/config/parametros/current", { token: sistemas })).body;
  return t.call("PATCH", "/config/parametros/current", { token: sistemas, body: { disabledFeatures: keys, version: p.version } });
};

describe("Funcionalidades › Transferir producto", () => {
  it("apagado: el producto suelto (item) → 403; la cuenta o la mesa sí se pasan", async () => {
    expect((await setOff(["transferirProducto"])).status).toBe(200);
    const d = await open();
    const s = await open();
    const no = await t.call("POST", `/orders/${s.id}/accounts/${s.acc}/transfer`, {
      token: sistemas,
      body: { toTableId: d.tableId, version: (await get(s.id)).version, item: true },
    });
    expect(no.status).toBe(403);
    expect(no.error.code).toBe("NOT_ALLOWED");
    const ok = await t.call("POST", `/orders/${s.id}/accounts/${s.acc}/transfer`, {
      token: sistemas,
      body: { toTableId: d.tableId, version: (await get(s.id)).version },
    });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect((await setOff([])).status).toBe(200);
  });
  it("«reabrir» ya no es una funcionalidad → 422", async () => {
    expect((await setOff(["reabrir"])).status).toBe(422);
  });
});
