import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

let t: T;
let sis: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
});
afterAll(async () => {
  await t.close();
});

/** Deja la tienda sin mesas abiertas (cobra y factura lo que quede, o cierra sin venta). */
async function settleAll() {
  const { rows } = await t.sql.query("SELECT id FROM orders WHERE status IN ('open','billing')");
  for (const o of rows) {
    const tx = (await t.call("GET", `/orders/${o.id}`, { token: sis })).body;
    for (const a of tx.accounts.filter((x: any) => x.status === "open" && x.lines.length)) {
      if (a.totals.pending > 0) {
        await t.call("POST", `/orders/${o.id}/accounts/${a.id}/payments`, {
          token: sis,
          body: { method: "card", amount: a.totals.pending },
        });
      }
      await t.call("POST", `/orders/${o.id}/accounts/${a.id}/invoice`, { token: sis });
    }
    const after = (await t.call("GET", `/orders/${o.id}`, { token: sis })).body;
    if (["open", "billing"].includes(after.status)) {
      for (const l of after.accounts.flatMap((a: any) => a.lines)) {
        await t.call("POST", `/orders/${o.id}/lines/${l.id}/delete`, {
          token: sis,
          body: { reason: "Prueba" },
        });
      }
      await t.call("POST", `/orders/${o.id}/close`, { token: sis, body: {} });
    }
  }
}
async function sale(method: "cash" | "card", plus: number[]) {
  const o = await t.call("POST", "/orders", {
    token: mesero,
    body: { tableId: await freeTable(t, "BARRA"), guests: 3 },
  });
  const acc = o.body.accounts[0].id;
  let tx: any;
  for (const plu of plus) {
    tx = (await t.call("POST", `/orders/${o.body._id}/lines`, { token: mesero, body: { plu } })).body;
  }
  await t.call("POST", `/orders/${o.body._id}/send`, { token: mesero, body: {} });
  const total = (await t.call("GET", `/orders/${o.body._id}`, { token: sis })).body.accounts[0].totals
    .pending;
  await t.call("POST", `/orders/${o.body._id}/accounts/${acc}/payments`, {
    token: sis,
    body: { method, amount: total, cashGiven: method === "cash" ? Math.ceil(total) : undefined },
  });
  await t.call("POST", `/orders/${o.body._id}/accounts/${acc}/invoice`, { token: sis });
  return { orderId: o.body._id as string, total: total as number };
}

describe("Gestor de cierres", () => {
  let periodId: string;
  let sales = 0;
  it("venta en vivo: lo cobrado del periodo + lo que hay en mesas abiertas", async () => {
    await settleAll();
    const cur = await t.call("GET", "/periods/current", { token: sis });
    if (cur.status === 200) {
      const sum = (await t.call("GET", "/cash/summary", { token: sis })).body;
      await t.call("POST", `/periods/${cur.body.id}/close`, {
        token: sis,
        body: { countedCash: sum.expectedCash, countedCard: sum.cardSales, nextFloat: 150 },
      });
    }
    periodId = await ensurePeriod(t, sis);
    sales += (await sale("cash", [PLU.tosta, PLU.croquetas])).total;
    sales += (await sale("card", [PLU.redbull])).total;
    // una mesa abierta con algo marcado y una anulación después de enviar
    const o = await t.call("POST", "/orders", {
      token: mesero,
      body: { tableId: await freeTable(t, "BARRA"), guests: 2 },
    });
    const l = await t.call("POST", `/orders/${o.body._id}/lines`, {
      token: mesero,
      body: { plu: PLU.tosta },
    });
    await t.call("POST", `/orders/${o.body._id}/send`, { token: mesero, body: {} });
    await t.call("POST", `/orders/${o.body._id}/lines/${l.body.accounts[0].lines[0].id}/delete`, {
      token: sis,
      body: { reason: "Error al marcar" },
    });
    await t.call("POST", `/orders/${o.body._id}/lines`, { token: mesero, body: { plu: PLU.croquetas } });
    const live = await t.call("GET", "/reports/live", { token: sis });
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({
      periodId,
      invoiced: { total: Math.round(sales * 100) / 100, tickets: 2, guests: 6 },
      open: { tables: 1 },
    });
    expect(live.body.open.amount).toBeGreaterThan(0);
    expect(live.body.voids).toEqual({ count: 1, amount: expect.any(Number) });
    expect(live.body.pays.cash + live.body.pays.card).toBeCloseTo(sales, 2);
    expect((await t.call("GET", "/reports/live", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
  });
  it("el periodo abierto sale en la lista de cierres marcado «open»", async () => {
    const r = await t.call("GET", "/reports/closings", { token: sis });
    const it = r.body.items.find((x: any) => x.periodId === periodId);
    expect(it).toMatchObject({ open: true, tickets: 2, closedAt: null });
  });
  it("al cerrar el periodo se guarda el resumen (por hora, camarero, pago, anulaciones) y va a la cola del Manager", async () => {
    await settleAll();
    const sum = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const c = await t.call("POST", `/periods/${periodId}/close`, {
      token: sis,
      body: { countedCash: sum.expectedCash, countedCard: sum.cardSales, nextFloat: 150 },
    });
    expect(c.status, JSON.stringify(c.env)).toBe(200);
    const {
      rows: [ps],
    } = await t.sql.query("SELECT * FROM period_summary WHERE period_id=$1", [periodId]);
    expect(Number(ps.tickets)).toBe(3); // las dos ventas + la mesa que quedó abierta (se cobra en settleAll)
    expect(Number(ps.voids_count)).toBe(1);
    expect(ps.voids[0]).toMatchObject({ reason: "Error al marcar", by: "Sistemas" });
    expect(ps.by_waiter[0].name).toBe("Mesero");
    expect(Object.values(ps.by_hour).reduce((a: number, x: any) => a + x, 0)).toBeCloseTo(
      Number(ps.gross_sales),
      2,
    );
    expect(
      (
        await t.sql.query(
          "SELECT count(*) n FROM sync_outbox WHERE entity='period.closed' AND entity_id=$1",
          [periodId],
        )
      ).rows[0].n,
    ).toBe("1");
    const d = await t.call("GET", `/reports/closings/${periodId}`, { token: sis });
    expect(d.body).toMatchObject({ open: false, tickets: 3, voidsCount: 1, closedBy: "Sistemas" });
    expect(d.body.byPayment.length).toBeGreaterThan(0);
    expect(d.body.lastYear.businessDate).toBeTruthy();
    expect((await t.call("GET", `/reports/closings/${crypto.randomUUID()}`, { token: sis })).status).toBe(
      404,
    );
  });
  it("52 semanas con el objetivo de Ajustes; año anterior por semana ISO; totales", async () => {
    // historial: el mismo día del año pasado vendió 100 €
    const {
      rows: [st],
    } = await t.sql.query("SELECT id FROM store");
    const per = crypto.randomUUID();
    const {
      rows: [mine],
    } = await t.sql.query(
      "SELECT business_date::text d, gross_sales::float8 g FROM period_summary WHERE period_id=$1",
      [periodId],
    );
    const ly = new Date(Date.parse(mine.d + "T00:00:00Z") - 364 * 864e5).toISOString().slice(0, 10);
    await t.sql.query(
      "INSERT INTO sales_period (id, store_id, status, opened_by_user_name, opened_by_at, closed_by_at) VALUES ($1,$2,'closed','Sistemas',$3,$3)",
      [per, st.id, ly + "T09:00:00Z"],
    );
    await t.sql.query(
      "INSERT INTO period_summary (id, store_id, period_id, business_date, opened_at, closed_at, gross_sales, tax_base, tax_total, tickets, guests) VALUES ($1,$2,$3,$4,$5,$5,100,90.91,9.09,4,8)",
      [crypto.randomUUID(), st.id, per, ly, ly + "T09:00:00Z"],
    );
    const year = Number(mine.d.slice(0, 4));
    await t.sql.query(
      "INSERT INTO sales_target (id, store_id, year, week, growth_pct) VALUES ($1,$2,$3,0,10) ON CONFLICT (store_id, year, week) DO UPDATE SET growth_pct = 10",
      [crypto.randomUUID(), st.id, year],
    );
    const w = await t.call("GET", `/reports/weeks?year=${year}`, { token: sis });
    expect(w.status).toBe(200);
    expect(w.body.growthPct).toBe(10);
    expect(w.body.weeks.length).toBeGreaterThanOrEqual(52);
    const cur = w.body.weeks.find((x: any) => x.current);
    expect(cur.real).toBeGreaterThanOrEqual(mine.g);
    expect(cur.prevFull).toBe(100);
    expect(cur.projFull).toBe(110);
    expect(w.body.totals.ytd).toBeGreaterThan(0);
    expect((await t.call("GET", "/reports/weeks?year=1800", { token: sis })).status).toBe(422);
    const l = await t.call("GET", `/reports/closings?from=${ly}&to=${mine.d}`, { token: sis });
    expect(l.body.items.find((x: any) => x.periodId === periodId).lastYear.grossSales).toBe(100);
    expect(
      (await t.call("GET", "/reports/closings?from=2026-10-10&to=2026-10-01", { token: sis })).status,
    ).toBe(422);
  });
  it("Developer › Sincronización: pendientes por tipo, el más antiguo, últimos mensajes con event_id", async () => {
    const s = await t.call("GET", "/sync/status", { token: sis });
    expect(s.status).toBe(200);
    expect(s.body.outboxPending).toBeGreaterThan(0);
    expect(s.body.byEntity.map((x: any) => x.entity)).toEqual(
      expect.arrayContaining(["order", "period.closed"]),
    );
    expect(s.body.latest[0].eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await t.call("GET", "/sync/status", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
    await ensurePeriod(t, sis);
  });
});
