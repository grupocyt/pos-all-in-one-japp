import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";
// @ts-ignore
import { verificationQueries } from "../../../../japp-db/scripts/db.mjs";

let t: T;
let barra: string;
let sistemas: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  barra = await t.login(PIN.barra);
  sistemas = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sistemas);
});
afterAll(async () => {
  await t.close();
});

async function sale(token: string, method: "cash" | "card", plu: number = PLU.tosta) {
  const o = await t.call("POST", "/orders", {
    token,
    body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
  });
  const acc = o.body.accounts[0].id;
  const l = await t.call("POST", `/orders/${o.body._id}/lines`, { token, body: { plu } });
  const total = l.body.accounts[0].totals.total;
  await t.call("POST", `/orders/${o.body._id}/accounts/${acc}/payments`, {
    token,
    body: { method, amount: total, cashGiven: method === "cash" ? 20 : undefined },
  });
  return { orderId: o.body._id as string, acc: acc as string, total: total as number };
}

describe("facturas", () => {
  it("12 cobros a la vez desde varios equipos: números consecutivos sin huecos y cadena VeriFactu íntegra", async () => {
    const before = (await t.sql.query("SELECT last_sequence FROM invoice_series WHERE series='T2026'"))
      .rows[0].last_sequence;
    const sales = [];
    for (let i = 0; i < 12; i++) {
      sales.push(await sale(barra, i % 2 ? "cash" : "card"));
    }
    const res = await Promise.all(
      sales.map((s) => t.call("POST", `/orders/${s.orderId}/accounts/${s.acc}/invoice`, { token: barra })),
    );
    expect(res.every((r) => r.status === 201)).toBe(true);
    const seqs = res.map((r) => r.body.invoice.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => before + 1 + i));
    for (const q of verificationQueries()) {
      expect((await t.sql.query(q.sql)).rows, q.name).toEqual([]);
    }
  });
  it("la misma cuenta no se factura dos veces", async () => {
    const s = await sale(barra, "card");
    expect(
      (await t.call("POST", `/orders/${s.orderId}/accounts/${s.acc}/invoice`, { token: barra })).status,
    ).toBe(201);
    const r = await t.call("POST", `/orders/${s.orderId}/accounts/${s.acc}/invoice`, { token: barra });
    expect(r.error.code).toBe("ORDER_CLOSED");
  });
});

describe("caja y periodo", () => {
  it("resumen de caja: fondo + efectivo − retiros; el mesero no tiene acceso", async () => {
    expect((await t.call("GET", "/cash/summary", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
    const a = (await t.call("GET", "/cash/summary", { token: sistemas })).body;
    const s = await sale(barra, "cash", PLU.croquetas);
    await t.call("POST", `/orders/${s.orderId}/accounts/${s.acc}/invoice`, { token: barra });
    const b = (await t.call("GET", "/cash/summary", { token: sistemas })).body;
    expect(b.float).toBe(150);
    expect(Math.round((b.cashSales - a.cashSales) * 100) / 100).toBe(5.95);
    expect(b.expectedCash).toBe(Math.round((b.float + b.cashSales - b.withdrawals) * 100) / 100);
    expect(b.tickets).toBe(a.tickets + 1);
  });
  it("corte X impreso: datos del servidor por la impresora de tickets; permiso funciones.caja", async () => {
    expect((await t.call("POST", "/cash/x-report/print", { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
    const x = (await t.call("GET", "/cash/x-report", { token: sistemas })).body;
    const n = t.printer.jobs.length;
    const r = await t.call("POST", "/cash/x-report/print", { token: sistemas });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      kind: "X",
      printed: true,
      sales: x.sales,
      tickets: x.tickets,
      expectedCash: x.expectedCash,
    });
    const job = t.printer.jobs.slice(n).find((j) => j.kind === "cutx")!;
    expect(job.text).toMatch(/CORTE X/);
    expect(job.text).toMatch(/Efectivo esperado/);
  });
  it("factura: detalle con mesa, camarero, líneas, cobros; tras abonar una línea, lo abonado y lo que queda", async () => {
    const s = await sale(barra, "cash", PLU.croquetas);
    const inv = (await t.call("POST", `/orders/${s.orderId}/accounts/${s.acc}/invoice`, { token: barra }))
      .body;
    expect(inv).toBeTruthy();
    const id = (await t.sql.query("SELECT id::text FROM invoice WHERE account_id=$1", [s.acc])).rows[0].id;
    const list = (await t.call("GET", "/invoices", { token: sistemas })).body.items;
    const it0 = list.find((x: any) => x.id === id);
    expect(it0).toMatchObject({ waiter: expect.any(String), status: expect.any(String) });
    const d = (await t.call("GET", `/invoices/${it0.id}`, { token: sistemas })).body;
    expect(d.lines.length).toBeGreaterThan(0);
    expect(d.lines[0]).toMatchObject({ lineId: expect.any(String), credited: 0 });
    expect(d.payments[0]).toMatchObject({ kind: "cash" });
    expect(d.creditable).toBe(d.total);
    const c = await t.call("POST", `/invoices/${it0.id}/credit`, {
      token: sistemas,
      body: { reason: "Prueba", lines: [{ lineId: d.lines[0].lineId, quantity: 1 }] },
    });
    expect(c.status, JSON.stringify(c.body ?? c.error)).toBe(201);
    const d2 = (await t.call("GET", `/invoices/${it0.id}`, { token: sistemas })).body;
    expect(d2.lines[0].credited).toBe(1);
    expect(d2.credits).toHaveLength(1);
    expect(d2.creditable).toBeLessThan(d.creditable);
    const ab = (await t.call("GET", `/invoices/${c.body.id}`, { token: sistemas })).body;
    expect(ab.rectifies).toBe(d.invoiceNumber);
    expect((await t.call("POST", `/invoices/${it0.id}/reprint`, { token: sistemas })).body.printed).toBe(
      true,
    );
  });
  it("cerrar periodo: con mesas abiertas no deja; con descuadre grande pide motivo; luego cierra y no se vende", async () => {
    // cobrar y facturar lo que quede abierto
    const { rows: open } = await t.sql.query("SELECT id FROM orders WHERE status IN ('open','billing')");
    const p = (await t.call("GET", "/periods/current", { token: sistemas })).body.id;
    if (open.length) {
      expect(
        (
          await t.call("POST", `/periods/${p}/close`, {
            token: sistemas,
            body: { countedCash: 0, nextFloat: 150 },
          })
        ).error.details.openOrders,
      ).toBe(open.length);
    }
    for (const o of open) {
      const tx = (await t.call("GET", `/orders/${o.id}`, { token: sistemas })).body;
      for (const a of tx.accounts.filter((x: any) => x.status === "open")) {
        if (!a.lines.length) {
          await t.call("POST", `/orders/${o.id}/lines`, {
            token: sistemas,
            body: { plu: PLU.tosta, accountId: a.id },
          });
        }
        const cur = (await t.call("GET", `/orders/${o.id}`, { token: sistemas })).body.accounts.find(
          (x: any) => x.id === a.id,
        );
        if (cur.totals.pending > 0) {
          await t.call("POST", `/orders/${o.id}/accounts/${a.id}/payments`, {
            token: sistemas,
            body: { method: "card", amount: cur.totals.pending },
          });
        }
        await t.call("POST", `/orders/${o.id}/accounts/${a.id}/invoice`, { token: sistemas });
      }
    }
    const sum = (await t.call("GET", "/cash/summary", { token: sistemas })).body;
    const bad = await t.call("POST", `/periods/${p}/close`, {
      token: sistemas,
      body: { countedCash: sum.expectedCash - 20, nextFloat: 150 },
    });
    expect([bad.status, bad.error.details.field]).toEqual([422, "note"]);
    const ok = await t.call("POST", `/periods/${p}/close`, {
      token: sistemas,
      body: { countedCash: sum.expectedCash, countedCard: sum.cardSales, nextFloat: 150 },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.zReport).toMatchObject({ printed: true });
    expect(t.printer.jobs.some((j) => j.kind === "cutz" && /CORTE Z/.test(j.text))).toBe(true);
    expect(ok.body.closing).toMatchObject({
      expectedCash: sum.expectedCash,
      difference: 0,
      grossSales: sum.totalSales,
    });
    expect((await t.call("GET", "/periods/current", { token: sistemas })).error.code).toBe("PERIOD_CLOSED");
    const no = await t.call("POST", "/orders", {
      token: sistemas,
      body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
    });
    expect(no.error.code).toBe("PERIOD_CLOSED");
    // abrir otro: el mesero necesita permiso; Sistemas sí puede
    expect((await t.call("POST", "/periods", { token: mesero, body: {} })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
    expect((await t.call("POST", "/periods", { token: sistemas, body: {} })).status).toBe(201);
  });
});
