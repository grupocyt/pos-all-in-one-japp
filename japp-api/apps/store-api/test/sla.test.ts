import { randomUUID } from "node:crypto";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** Gestiones › Mesas en servicio y Ajustes › SLA de atención (25/10/2026, migración 0017). */
let t: T;
let sis: string;
let mesero: string;
let terraza: string;
let barra: string;
const real = new Date();
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sis);
  terraza = (await t.sql.query("SELECT id FROM area WHERE name='TERRAZA'")).rows[0].id;
  barra = (await t.sql.query("SELECT id FROM area WHERE name='BARRA'")).rows[0].id;
});
afterAll(async () => {
  t.clock.now = real;
  await t.sql.query(
    "UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL",
  );
  await t.close();
});

const getSla = async () => (await t.call("GET", "/service/sla", { token: sis })).body;
const putSla = (body: unknown, token = sis) => t.call("PUT", "/service/sla", { token, body });
const live = async () => (await t.call("GET", "/service/live", { token: sis })).body;
const STORE = { firstOrder: 10, unsent: 3, idle: 30, prebillPay: 6, total: 120, warnPercent: 80 };
const later = (min: number) => {
  t.clock.now = new Date(t.clock.now.getTime() + min * 60000);
};

describe("Ajustes › SLA de atención", () => {
  it("de serie: la regla de la tienda (con los tiempos de Parámetros) y sin turnos", async () => {
    const c = await getSla();
    expect(c.version).toBeGreaterThanOrEqual(1);
    expect(c.shifts).toEqual([]);
    const d = c.rules.find((r: any) => !r.areaId && !r.tableId && !r.shiftId);
    expect(d).toMatchObject({ firstOrder: 10, unsent: 3, total: 120, warnPercent: 80 });
  });

  it("guarda turnos y reglas por zona, por turno y por mesa; cada cambio sube la versión", async () => {
    const c = await getSla();
    const cena = randomUUID();
    const mesa = await freeTable(t, "TERRAZA");
    const r = await putSla({
      version: c.version,
      shifts: [
        { id: randomUUID(), name: "Comida", start: "12:00", end: "16:30" },
        { id: cena, name: "Cena", start: "19:30", end: "00:30" },
      ],
      rules: [
        STORE,
        { areaId: terraza, firstOrder: 12, idle: 40 },
        { areaId: terraza, shiftId: cena, firstOrder: 15 },
        { tableId: mesa, prebillPay: 4 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(c.version + 1);
    expect(r.body.shifts.map((s: any) => [s.name, s.start, s.end])).toEqual([
      ["Comida", "12:00", "16:30"],
      ["Cena", "19:30", "00:30"],
    ]);
    expect(r.body.rules).toHaveLength(4);
    // la misma versión ya no vale
    const stale = await putSla({ version: c.version, shifts: [], rules: [STORE] });
    expect([stale.status, stale.error.code]).toEqual([409, "VERSION_CONFLICT"]);
  });

  it("rechaza turnos que se pisan, zonas que no existen y la tienda sin todos los límites", async () => {
    const { version } = await getSla();
    const a = await putSla({
      version,
      shifts: [
        { id: randomUUID(), name: "Cena", start: "19:30", end: "00:30" },
        { id: randomUUID(), name: "Copas", start: "00:00", end: "03:00" },
      ],
      rules: [STORE],
    });
    expect([a.status, a.error.field]).toEqual([422, "shifts[1].start"]);
    const b = await putSla({ version, shifts: [], rules: [STORE, { areaId: randomUUID(), idle: 5 }] });
    expect([b.status, b.error.field]).toEqual([422, "rules[1].areaId"]);
    const c = await putSla({ version, shifts: [], rules: [{ ...STORE, total: null }] });
    expect([c.status, c.error.field]).toEqual([422, "rules[0].total"]);
    expect((await getSla()).version).toBe(version);
  });

  it("configurar pide ajustes.parametros y ver la pantalla funciones.kpi", async () => {
    const { version } = await getSla();
    const r = await putSla({ version, shifts: [], rules: [STORE] }, mesero);
    expect([r.status, r.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    const l = await t.call("GET", "/service/live", { token: mesero });
    expect([l.status, l.error.details.permission]).toEqual([403, "funciones.kpi"]);
  });
});

describe("Gestiones › Mesas en servicio", () => {
  it("sigue la mesa paso a paso: toma, marcado sin enviar, sin atender tras el envío y precuenta", async () => {
    const { version } = await getSla();
    expect(
      (await putSla({ version, shifts: [], rules: [STORE, { areaId: barra, firstOrder: 5 }] })).status,
    ).toBe(200);
    t.clock.now = new Date();
    const o = (
      await t.call("POST", "/orders", {
        token: mesero,
        body: { tableId: await freeTable(t, "BARRA"), guests: 2 },
      })
    ).body;
    const mine = async () => (await live()).items.find((i: any) => i.orderId === o._id);

    later(4.5);
    let i = await mine();
    expect([
      i.stage,
      i.status,
      i.metrics.firstOrder.status,
      i.limits.firstOrder,
      i.source.firstOrder,
    ]).toEqual(["waiting", "warn", "warn", 5, "zona"]);
    expect(i.metrics.total).toMatchObject({ minutes: 4.5, limit: 120, status: "ok" });

    later(2); // 6.5 min sin marcar nada
    expect((await mine()).metrics.firstOrder.status).toBe("late");

    await t.call("POST", `/orders/${o._id}/lines`, {
      token: mesero,
      body: { id: randomUUID(), accountId: o.accounts[0].id, plu: PLU.tosta, quantity: 1, force: true },
    });
    later(4);
    i = await mine();
    expect(i.stage).toBe("ordering");
    expect(i.metrics.firstOrder).toMatchObject({ minutes: 6.5, done: true, status: "late" });
    expect(i.metrics.unsent).toMatchObject({ minutes: 4, status: "late" });

    await t.call("POST", `/orders/${o._id}/send`, { token: mesero, body: {} });
    later(25);
    i = await mine();
    expect([i.stage, i.metrics.unsent, i.metrics.idle.minutes, i.metrics.idle.status]).toEqual([
      "service",
      null,
      25,
      "warn",
    ]);

    await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/prebill`, { token: sis, body: {} });
    later(7);
    i = await mine();
    expect([i.stage, i.metrics.idle, i.metrics.prebillPay.status, i.status]).toEqual([
      "billing",
      null,
      "late",
      "late",
    ]);

    const all = await live();
    expect(all.items[0].status).toBe("late"); // lo peor arriba
    expect(all.summary.open).toBe(all.items.length);
    expect(all.summary.late).toBeGreaterThanOrEqual(1);
    const w = all.staff.find((s: any) => s.name === i.waiter);
    expect(w).toMatchObject({ open: expect.any(Number), late: expect.any(Number) });
    expect(all.today.firstOrder.n).toBeGreaterThanOrEqual(1);
  });
});
