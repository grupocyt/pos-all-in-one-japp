import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * 1.2.289 (20/11/2026):
 *  - Transferir 1 producto ya enviado a otra mesa: el TPV lo pasa a una cuenta temporal y la transfiere con into = main e
 *    intoAccountId = la cuenta de la mesa de destino que eligió (si la mesa tiene varias, pregunta «¿A qué cuenta…?»).
 *  - Ajustes › Funcionalidades: parametros.disabledFeatures (0042). Lo desactivado no lo usa nadie (403 NOT_ALLOWED), ni con
 *    la clave de un encargado; al volver a activarlo, funciona como siempre.
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
const open = async (plu: number) => {
  const o = await t.call("POST", "/orders", { token: sistemas, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } });
  await t.call("POST", `/orders/${o.body._id}/lines`, { token: sistemas, body: { plu, force: true } });
  await t.call("POST", `/orders/${o.body._id}/send`, { token: sistemas, body: {} });
  return { id: o.body._id as string, tableId: o.body.tableData.tableId as string, acc: o.body.accounts[0].id as string };
};
const names = (o: any) =>
  Object.fromEntries(
    o.accounts.filter((a: any) => a.status !== "cancelled").map((a: any) => [a.name, a.lines.map((l: any) => l.plu ?? l.productId).sort()]),
  );
const setOff = async (keys: string[]) => {
  const p = (await t.call("GET", "/config/parametros/current", { token: sistemas })).body;
  return t.call("PATCH", "/config/parametros/current", { token: sistemas, body: { disabledFeatures: keys, version: p.version } });
};

describe("transferir 1 producto a una cuenta concreta de otra mesa", () => {
  it("con intoAccountId llega a esa cuenta (no a la principal); una cuenta de otra mesa → 422", async () => {
    // destino: Cuenta 1 (kaspirinha) y Cuenta 2 (croquetas)
    const d = await open(PLU.kaspirinha);
    const c2 = await t.call("POST", `/orders/${d.id}/accounts`, { token: sistemas, body: {} });
    const acc2 = c2.body.accounts.find((a: any) => a.id !== d.acc).id as string;
    await t.call("POST", `/orders/${d.id}/lines`, { token: sistemas, body: { plu: PLU.croquetas, accountId: acc2, force: true } });
    await t.call("POST", `/orders/${d.id}/send`, { token: sistemas, body: {} });
    // origen: el producto va en una cuenta temporal (como hace el TPV)
    const s = await open(PLU.tosta);
    const tmp = await t.call("POST", `/orders/${s.id}/accounts`, { token: sistemas, body: {} });
    const tmpId = tmp.body.accounts.find((a: any) => a.id !== s.acc).id as string;
    await t.call("POST", `/orders/${s.id}/lines`, { token: sistemas, body: { plu: PLU.redbull, accountId: tmpId, force: true } });
    await t.call("POST", `/orders/${s.id}/send`, { token: sistemas, body: {} });
    // una cuenta que no es de la mesa de destino → 422 field intoAccountId (y no se mueve nada)
    const bad = await t.call("POST", `/orders/${s.id}/accounts/${tmpId}/transfer`, {
      token: sistemas,
      body: { toTableId: d.tableId, version: (await get(s.id)).version, into: "main", intoAccountId: s.acc },
    });
    expect(bad.status).toBe(422);
    expect(bad.error.field).toBe("intoAccountId");
    const r = await t.call("POST", `/orders/${s.id}/accounts/${tmpId}/transfer`, {
      token: sistemas,
      body: { toTableId: d.tableId, version: (await get(s.id)).version, into: "main", intoAccountId: acc2 },
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const dest = names(await get(d.id));
    expect(dest["Cuenta 1"]).toEqual([PLU.kaspirinha]);
    expect(dest["Cuenta 2"]).toEqual([PLU.croquetas, PLU.redbull].sort());
    expect(names(await get(s.id))["Cuenta 1"]).toEqual([PLU.tosta]);
  });
});

describe("Ajustes › Funcionalidades", () => {
  it("se guarda en parámetros; una clave que no existe → 422", async () => {
    const r = await setOff(["eliminaciones"]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body.item.disabledFeatures).toEqual(["eliminaciones"]);
    expect((await setOff(["volar"])).status).toBe(422);
    expect((await setOff([])).status).toBe(200);
  });
  it("«Transferir» desactivado: 403 NOT_ALLOWED para todos (ni con autorización); activado otra vez, funciona", async () => {
    const d = await open(PLU.kaspirinha);
    const s = await open(PLU.tosta);
    expect((await setOff(["transferir"])).status).toBe(200);
    const no = await t.call("POST", `/orders/${s.id}/accounts/${s.acc}/transfer`, {
      token: sistemas,
      body: { toTableId: d.tableId, version: (await get(s.id)).version },
    });
    expect(no.status).toBe(403);
    expect(no.error.code).toBe("NOT_ALLOWED");
    expect(no.error.details?.feature ?? no.env?.error?.details?.feature).toBe("transferir");
    expect((await setOff([])).status).toBe(200);
    const ok = await t.call("POST", `/orders/${s.id}/accounts/${s.acc}/transfer`, {
      token: sistemas,
      body: { toTableId: d.tableId, version: (await get(s.id)).version },
    });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
  });
});
