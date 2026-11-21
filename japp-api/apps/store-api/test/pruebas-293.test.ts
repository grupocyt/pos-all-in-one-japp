import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * 1.2.293 (20/11/2026, noche) · decisiones del dueño:
 *  - Un solo periodo por día: hoy ya se abrió y se cerró uno → 409 PERIOD_DAY_USED.
 *  - Agotado y desactivado en la tienda valen hasta el día siguiente: al abrir el periodo se reactivan solos; lo desactivado
 *    por el Manager no se toca.
 *  - Tablero de delivery: por defecto solo Cajero y Administrador.
 */
let t: T;
let sis: string;
beforeAll(async () => {
  t = await setup({ onePeriodPerDay: true });
  sis = await t.login(PIN.sistemas);
});
afterAll(async () => {
  await t.close();
});
const closeCurrent = async () => {
  await t.sql.query(
    "UPDATE sales_period SET status = 'closed', open_flag = NULL, closed_by_user_name = 'Prueba', closed_by_at = now() WHERE open_flag = 1",
  );
};

describe("un periodo por día", () => {
  it("con uno abierto hoy y cerrado, abrir otro → 409 PERIOD_DAY_USED; si el de hoy es de ayer, sí abre", async () => {
    await ensurePeriod(t, sis);
    await closeCurrent();
    const no = await t.call("POST", "/periods", { token: sis, body: {} });
    expect(no.status).toBe(409);
    expect(no.error.code).toBe("PERIOD_DAY_USED");
    // los periodos de hoy pasan a ser de ayer → ya se puede
    await t.sql.query("UPDATE sales_period SET opened_by_at = opened_by_at - interval '1 day' WHERE opened_by_at > now() - interval '1 day'");
    const ok = await t.call("POST", "/periods", { token: sis, body: {} });
    expect(ok.status, JSON.stringify(ok.error)).toBe(201);
  });
});

describe("agotado y desactivado en la tienda, hasta el día siguiente", () => {
  it("al abrir el periodo vuelven solos; lo desactivado por el Manager se queda", async () => {
    const ps = (await t.sql.query("SELECT id::text, version FROM product WHERE active ORDER BY plu LIMIT 3")).rows;
    // agotado (tienda), desactivado en la tienda (PATCH desde el TPV) y desactivado por el Manager (sin marca)
    await t.call("POST", `/config/productos/${ps[0].id}/sold-out`, { token: sis, body: { soldOut: true } });
    const off = await t.call("PATCH", `/config/productos/${ps[1].id}`, { token: sis, body: { active: false, version: ps[1].version } });
    expect(off.status, JSON.stringify(off.error)).toBe(200);
    expect((await t.sql.query("SELECT local_off FROM product WHERE id = $1", [ps[1].id])).rows[0].local_off).toBe(true);
    await t.sql.query("UPDATE product SET active = FALSE, local_off = FALSE WHERE id = $1", [ps[2].id]);
    const cv0 = Number((await t.sql.query("SELECT config_version FROM store LIMIT 1")).rows[0].config_version);
    await closeCurrent();
    await t.sql.query("UPDATE sales_period SET opened_by_at = opened_by_at - interval '1 day' WHERE opened_by_at > now() - interval '1 day'");
    expect((await t.call("POST", "/periods", { token: sis, body: {} })).status).toBe(201);
    const st = (await t.sql.query("SELECT id::text, sold_out, active, local_off FROM product WHERE id = ANY($1::uuid[])", [ps.map((p: any) => p.id)])).rows;
    const by = (id: string) => st.find((x: any) => x.id === id);
    expect(by(ps[0].id)).toMatchObject({ sold_out: false, active: true });
    expect(by(ps[1].id)).toMatchObject({ active: true, local_off: false });
    expect(by(ps[2].id)).toMatchObject({ active: false });
    expect(Number((await t.sql.query("SELECT config_version FROM store LIMIT 1")).rows[0].config_version)).toBeGreaterThan(cv0);
    await t.sql.query("UPDATE product SET active = TRUE WHERE id = $1", [ps[2].id]);
  });
});

describe("tablero de delivery", () => {
  it("por defecto solo el Cajero y el Administrador lo tienen", async () => {
    const r = (await t.sql.query(
      "SELECT p.code FROM profile_permission pp JOIN user_profile p ON p.id = pp.profile_id WHERE pp.permission_code = 'funciones.pedidos' ORDER BY 1",
    )).rows.map((x: any) => x.code);
    expect(r).toEqual(["ADMIN", "CAJERO"]);
  });
});

describe("auditoría 21/11", () => {
  it("retirar más efectivo del que hay en la caja → 422 field amount", async () => {
    await ensurePeriod(t, sis);
    const sum = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const r = await t.call("POST", "/cash/movements", { token: sis, body: { kind: "withdrawal", amount: Math.round((sum.expectedCash + 100) * 100) / 100 } });
    expect(r.status).toBe(422);
    expect(r.error.field).toBe("amount");
    expect((await t.call("POST", "/cash/movements", { token: sis, body: { kind: "withdrawal", amount: 1 } })).status).toBe(201);
  });
  it("cambiar de mesa a la misma mesa → 422 «Es la misma mesa»", async () => {
    const o = await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } });
    await t.call("POST", `/orders/${o.body._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
    const g = (await t.call("GET", `/orders/${o.body._id}`, { token: sis })).body;
    const r = await t.call("POST", `/orders/${o.body._id}/transfer`, { token: sis, body: { toTableId: g.tableData.tableId, version: g.version } });
    expect(r.status).toBe(422);
    expect(r.error.field).toBe("toTableId");
  });
});
