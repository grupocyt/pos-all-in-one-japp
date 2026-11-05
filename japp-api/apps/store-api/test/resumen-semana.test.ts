import { addDays, madridDay, weekMonday } from "@japp/domain";
import { setup, PIN, type T } from "./helpers.js";

let t: T;
let admin: string;
let store: string;
const today = madridDay(new Date()).date;
const mon = weekMonday(today);
/** Semana de las pruebas: hace 60 semanas (no se mezcla con los cierres de los últimos 30 días de otras pruebas). */
const W0 = addDays(mon, -7 * 60);

/** Un cierre guardado (period_summary) de un día, con lo vendido por producto. */
async function closed(date: string, sales: number, tickets: number, byProduct: unknown[] = []) {
  const p = crypto.randomUUID();
  await t.sql.query(
    `INSERT INTO sales_period (id, store_id, opened_by_at, closed_by_at, status, opened_by_user_name)
     VALUES ($1, $2, $3::date + time '10:00', $3::date + time '23:00', 'closed', 'Pruebas')`,
    [p, store, date],
  );
  await t.sql.query(
    `INSERT INTO period_summary (id, store_id, period_id, business_date, opened_at, closed_at, gross_sales, tax_base, tax_total, tickets, guests, by_product)
     VALUES ($1, $2, $3, $4, $4::date + time '10:00', $4::date + time '23:00', $5, $5, 0, $6, $6, $7::jsonb)`,
    [crypto.randomUUID(), store, p, date, sales, tickets, JSON.stringify(byProduct)],
  );
}

beforeAll(async () => {
  t = await setup();
  admin = await t.login(PIN.sistemas);
  store = (await t.sql.query("SELECT id FROM store LIMIT 1")).rows[0].id;
  // la semana W0 (lunes), la semana siguiente (su «semana anterior» es W0) y el año anterior de W0
  const lastMon = W0;
  await closed(lastMon, 800, 32, [{ plu: 1, name: "Caña", quantity: 50, amount: 125 }]);
  await closed(addDays(lastMon, -364), 1000, 40);
  await t.sql.query(
    "INSERT INTO sales_target (id, store_id, year, week, growth_pct) VALUES ($1,$2,$3,0,10)",
    [crypto.randomUUID(), store, Number(addDays(lastMon, 3).slice(0, 4))],
  );
});
afterAll(async () => {
  await t.close();
});

describe("Gestiones › Resumen semana (GET /reports/week)", () => {
  it("una semana cerrada: días, año anterior, proyección con el objetivo del año y productos con su mezcla", async () => {
    const r = await t.call("GET", `/reports/week?date=${addDays(W0, 2)}`, { token: admin });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ from: W0, to: addDays(W0, 6), complete: true });
    const d0 = r.body.days[0];
    expect(d0.real).toEqual({ sales: 800, tickets: 32, avg: 25 });
    expect(d0.lastYear).toMatchObject({ date: addDays(W0, -364), sales: 1000, tickets: 40 });
    expect(d0.target.sales).toBe(1100);
    expect(d0.vsLastYear.sales).toBe(-25);
    expect(r.body.products).toEqual([
      { rank: 1, plu: 1, name: "Caña", quantity: 50, amount: 125, mixPct: 100 },
    ]);
  });

  it("la semana siguiente compara con W0; esta semana: los días que faltan sin real; una semana futura → 422", async () => {
    const n = await t.call("GET", `/reports/week?date=${addDays(W0, 7)}`, { token: admin });
    expect(n.body.days[0].prevWeek).toMatchObject({ date: W0, sales: 800, tickets: 32 });
    const r = await t.call("GET", "/reports/week", { token: admin });
    expect(r.status).toBe(200);
    expect(r.body.from).toBe(mon);
    expect(r.body.days.filter((d: any) => d.date > today).every((d: any) => d.real === null)).toBe(true);
    const f = await t.call("GET", `/reports/week?date=${addDays(mon, 7)}`, { token: admin });
    expect([f.status, f.error.code]).toEqual([422, "VALIDATION"]);
    const x = await t.call("GET", "/reports/week?date=ayer", { token: admin });
    expect([x.status, x.error.code]).toEqual([422, "VALIDATION"]);
  });

  it("observaciones: escribir, cambiar con version, conflicto, borrar; salen en la hoja", async () => {
    const day = addDays(W0, 1);
    const a = await t.call("PUT", `/reports/week/notes/${day}`, {
      token: admin,
      body: { note: "Lluvia", version: 0 },
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ date: day, note: "Lluvia", version: 1, updatedBy: "Sistemas" });
    const b = await t.call("PUT", `/reports/week/notes/${day}`, {
      token: admin,
      body: { note: "Lluvia toda la tarde", version: 1 },
    });
    expect(b.body.version).toBe(2);
    const c = await t.call("PUT", `/reports/week/notes/${day}`, {
      token: admin,
      body: { note: "Otra", version: 1 },
    });
    expect([c.status, c.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    expect(c.error.details.current.note).toBe("Lluvia toda la tarde");
    const w = await t.call("GET", `/reports/week?date=${day}`, { token: admin });
    expect(w.body.days[1].note).toBe("Lluvia toda la tarde");
    expect(w.body.notes).toHaveLength(1);
    const d = await t.call("PUT", `/reports/week/notes/${day}`, {
      token: admin,
      body: { note: " ", version: 2 },
    });
    expect(d.body).toMatchObject({ note: null, version: 0 });
    expect((await t.sql.query("SELECT count(*)::int n FROM week_note")).rows[0].n).toBe(0);
    const fut = await t.call("PUT", `/reports/week/notes/${addDays(today, 1)}`, {
      token: admin,
      body: { note: "x" },
    });
    expect([fut.status, fut.error.code]).toEqual([422, "VALIDATION"]);
  });

  it("sin el permiso funciones.semana (0032) → 403", async () => {
    const mesero = await t.login(PIN.mesero);
    const r = await t.call("GET", "/reports/week", { token: mesero });
    expect([r.status, r.error.code, r.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "funciones.semana",
    ]);
  });
});
