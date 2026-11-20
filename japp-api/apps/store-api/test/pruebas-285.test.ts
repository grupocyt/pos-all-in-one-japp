import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * 1.2.285 (20/11/2026):
 *  - Precuenta deshecha: POST /orders/{id}/accounts/{aid}/prebill/undo → las líneas en precuenta vuelven a «enviadas»
 *    y la mesa a «en uso»; queda en el historial (preBillUndone).
 *  - Descuentos con «Formulario» (discount.form): los campos obligatorios tienen que venir en formData; lo rellenado queda
 *    en el historial (discountForm).
 *  - Roles nuevos: pedido.ordenImpresion (POST …/lines/reorder) y funciones.miVenta (GET /reports/me).
 */
let t: T;
let mesero: string;
let sistemas: string;
beforeAll(async () => {
  t = await setup();
  mesero = await t.login(PIN.mesero);
  sistemas = await t.login(PIN.sistemas);
  await ensurePeriod(t, sistemas);
});
afterAll(async () => {
  await t.sql.query("UPDATE discount SET form = '[]'::jsonb");
  await t.close();
});
const newOrder = async (token = sistemas) => {
  const o = await t.call("POST", "/orders", { token, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } });
  await t.call("POST", `/orders/${o.body._id}/lines`, { token, body: { plu: PLU.tosta, quantity: 2 } });
  return { id: o.body._id as string, acc: o.body.accounts[0].id as string };
};
const events = async (id: string, type: string) =>
  (await t.sql.query("SELECT description FROM order_event WHERE order_id = $1 AND type = $2 ORDER BY at", [id, type])).rows.map((r: any) => r.description);

describe("precuenta deshecha", () => {
  it("las líneas vuelven a enviadas, la mesa a «en uso» y queda en el historial; sin precuenta no hace nada", async () => {
    const o = await newOrder();
    await t.call("POST", `/orders/${o.id}/send`, { token: sistemas, body: {} });
    const pb = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill`, { token: sistemas });
    expect([200, 409]).toContain(pb.status); // sin impresora de tickets la precuenta queda guardada igual
    const st0 = (await t.sql.query("SELECT DISTINCT status FROM order_line WHERE order_id = $1 AND status <> 'deleted'", [o.id])).rows.map((r: any) => r.status);
    expect(st0).toEqual(["preBill"]);
    const u = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill/undo`, { token: sistemas });
    expect(u.status, JSON.stringify(u.error)).toBe(200);
    const st1 = (await t.sql.query("SELECT DISTINCT status FROM order_line WHERE order_id = $1 AND status <> 'deleted'", [o.id])).rows.map((r: any) => r.status);
    expect(st1).toEqual(["printed"]);
    expect((await events(o.id, "preBillUndone")).length).toBe(1);
    const again = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill/undo`, { token: sistemas });
    expect(again.status).toBe(200);
    expect((await events(o.id, "preBillUndone")).length).toBe(1);
  });
});

describe("descuentos con formulario", () => {
  it("se guarda en Ajustes; sin los obligatorios no se aplica; con ellos queda en el historial", async () => {
    const d = (await t.sql.query("SELECT id::text, version FROM discount WHERE active ORDER BY name LIMIT 1")).rows[0];
    const form = [{ label: "Nombre del empleado", type: "text", req: true }, { label: "DNI", type: "text", req: true }, { label: "Fecha de alta", type: "date", req: false }];
    const p = await t.call("PATCH", `/config/descuentos/${d.id}`, { token: sistemas, body: { form, version: d.version } });
    expect(p.status, JSON.stringify(p.error)).toBe(200);
    expect((await t.sql.query("SELECT form FROM discount WHERE id = $1", [d.id])).rows[0].form).toEqual(form);
    const bad = await t.call("PATCH", `/config/descuentos/${d.id}`, { token: sistemas, body: { form: [{ label: "x", type: "color" }], version: d.version + 1 } });
    expect(bad.status).toBe(422);
    const o = await newOrder();
    const url = `/orders/${o.id}/accounts/${o.acc}/discounts`;
    const miss = await t.call("POST", url, { token: sistemas, body: { discountId: d.id, formData: [{ label: "Nombre del empleado", value: "Ana" }] } });
    expect([miss.error?.code, miss.error?.details?.label]).toEqual(["VALIDATION", "DNI"]);
    const ok = await t.call("POST", url, { token: sistemas, body: { discountId: d.id, formData: [{ label: "Nombre del empleado", value: "Ana Pérez" }, { label: "DNI", value: "12345678Z" }, { label: "Fecha de alta", value: "" }] } });
    expect(ok.status, JSON.stringify(ok.error)).toBe(201);
    const ev = await events(o.id, "discountForm");
    expect(ev.length).toBe(1);
    expect(ev[0]).toContain("Nombre del empleado: Ana Pérez · DNI: 12345678Z");
    expect(ev[0]).not.toContain("Fecha de alta");
  });
});

describe("roles nuevos", () => {
  it("mi venta y orden de impresión: el mesero los tiene; sin el permiso, PERMISSION_REQUIRED", async () => {
    const me = await t.call("GET", "/reports/me", { token: mesero });
    expect(me.status).toBe(200);
    const o = await newOrder(mesero);
    await t.call("POST", `/orders/${o.id}/lines`, { token: mesero, body: { plu: PLU.croquetas, quantity: 1 } });
    const ids = (await t.sql.query("SELECT id::text FROM order_line WHERE order_id = $1 AND status = 'pendingPrint' ORDER BY sort_order", [o.id])).rows.map((r: any) => r.id);
    const re = await t.call("POST", `/orders/${o.id}/lines/reorder`, { token: mesero, body: { accountId: o.acc, lineIds: ids.reverse() } });
    expect(re.status, JSON.stringify(re.error)).toBe(200);
    const prof = (await t.sql.query("SELECT u.profile_id::text p FROM app_user u WHERE u.name = $1 LIMIT 1", [me.body.user])).rows[0]?.p;
    const gone = await t.sql.query("DELETE FROM profile_permission WHERE profile_id = $1 AND permission_code IN ('funciones.miVenta','pedido.ordenImpresion') RETURNING profile_id, permission_code, store_id", [prof]);
    try {
      const m2 = await t.login(PIN.mesero);
      expect((await t.call("GET", "/reports/me", { token: m2 })).error?.code).toBe("PERMISSION_REQUIRED");
      expect((await t.call("POST", `/orders/${o.id}/lines/reorder`, { token: m2, body: { accountId: o.acc, lineIds: ids } })).error?.code).toBe("PERMISSION_REQUIRED");
    } finally {
      for (const r of gone.rows) await t.sql.query("INSERT INTO profile_permission (profile_id, permission_code, store_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [r.profile_id, r.permission_code, r.store_id]);
    }
  });
});
