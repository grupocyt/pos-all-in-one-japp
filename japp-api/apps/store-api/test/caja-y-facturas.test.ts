import http from "node:http";
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
    // otra prueba puede dejar mesas abiertas en un periodo ya cerrado: el cierre solo cuenta las de este periodo
    const { rows: inPeriod } = await t.sql.query(
      "SELECT id FROM orders WHERE status IN ('open','billing') AND period_id IN (SELECT id FROM sales_period WHERE status = 'open')",
    );
    const p = (await t.call("GET", "/periods/current", { token: sistemas })).body.id;
    if (inPeriod.length) {
      expect(
        (
          await t.call("POST", `/periods/${p}/close`, {
            token: sistemas,
            body: { countedCash: 0, nextFloat: 150 },
          })
        ).error.details.openOrders,
      ).toBe(inPeriod.length);
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
    // una incidencia de producto pendiente: al cerrar se envía sola a Marketing (v185)
    const prods = (await t.call("GET", "/config/productos", { token: sistemas })).body.items;
    const pr = await t.call("PATCH", `/config/productos/${prods[0].id}`, {
      token: sistemas,
      body: { description: "Cambio antes del cierre", version: prods[0].version },
    });
    expect(pr.status, JSON.stringify(pr.error)).toBe(200);
    const pend = (await t.call("GET", "/incidents", { token: sistemas })).body.items;
    expect(pend.length).toBeGreaterThan(0);
    expect(pend[0].code).toMatch(/^INC-/);
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
    expect(ok.body.incidentRequest).toMatch(/^REQ-\d{4}$/);
    expect((await t.call("GET", "/incidents", { token: sistemas })).body.items).toEqual([]);
    const closedList = (await t.call("GET", "/orders?status=closed", { token: sistemas })).body.items;
    expect(closedList.length).toBeGreaterThan(0);
    // la base es compartida: la primera de la lista puede ser de otro periodo; se busca una de este
    const mine = closedList.find((o: any) => o.periodId === p);
    expect(mine).toMatchObject({ periodId: p, status: "closed" });
    expect(mine.waiter).toBeTruthy();
    expect(mine.closedAt).toBeTruthy();
    // interfaz de ventas al SIR del periodo recién cerrado (sin periodId = el último cerrado)
    const sir = await t.call("GET", "/interface/sir/sales", { token: sistemas });
    expect(sir.status, JSON.stringify(sir.error)).toBe(200);
    expect(sir.body.periodId).toBe(p);
    expect(sir.body.lc_fecha).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(sir.body.CierreCajas).toMatch(/^0xFFFE3C00/);
    expect(sir.body.xml.CierreCajas).toContain(`Venta_Bruta="${sum.totalSales.toFixed(4)}"`);
    expect(sir.body.xml.CierreCajas).toContain('tipo_medio="TOTAL"');
    expect(sir.body.xml.DinTrans).toContain('Cod_FormaPago="-1"');
    expect(sir.body.xml.PlusTrans).toContain('agregador="LOCAL"');
    // las sesiones se fechan con la hora de la base (now()) y el periodo con el reloj de la prueba: aquí puede no haber horas
    expect(sir.body.HorasCajero === "0x00000000" || /Horas_Conectado=/.test(sir.body.xml.HorasCajero)).toBe(
      true,
    );
    expect(sir.body.Depositos).toBe("0x00000000");
    expect(sir.body.Cortesias).toBe("0x00000000");
    const same = await t.call("GET", `/interface/sir/sales?periodId=${p}`, { token: sistemas });
    expect(same.body.CierreCajas).toBe(sir.body.CierreCajas);
    expect((await t.call("GET", "/interface/sir/sales?periodId=x", { token: sistemas })).status).toBe(422);
    expect(
      (await t.call("GET", `/interface/sir/sales?periodId=${crypto.randomUUID()}`, { token: sistemas }))
        .status,
    ).toBe(404);
    expect((await t.call("GET", "/interface/sir/sales", { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
    expect(sir.body.soap).toContain(`<CierreCajas>${sir.body.CierreCajas}</CierreCajas>`);
    // los descuentos son una forma de pago más (tipo discount, sin mostrar en el TPV): no se cobra con ella
    const dpm = await t.call("POST", "/config/formas-pago", {
      token: sistemas,
      body: { code: "descuentos", name: "Descuentos", kind: "discount", showInTpv: false, externalId: "63" },
    });
    expect(dpm.status, JSON.stringify(dpm.error)).toBe(201);
    const { rows: dr } = await t.sql.query(
      "SELECT kind, show_in_tpv, external_id FROM payment_method WHERE code = 'descuentos'",
    );
    expect(dr[0]).toEqual({ kind: "discount", show_in_tpv: false, external_id: "63" });
    // enviar: sin URL → 422; con URL, el SOAP llega tal cual al SIR (servidor de prueba) y se ve su respuesta
    expect(
      (await t.call("POST", "/interface/sir/sales/send", { token: sistemas, body: {} })).error.field,
    ).toBe("sirUrl");
    let got = "";
    const srv = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        got = b;
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(
          '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><interfaceVentasAgregadoresResponse><return xsi:type="xsd:string">{"Respuesta":"0","Mensaje":"El Menu Mix ya se encuetra Asentado"}</return></interfaceVentasAgregadoresResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>',
        );
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    try {
      const rest = (await t.call("GET", "/config/restaurante", { token: sistemas })).body;
      const cur = rest.items?.[0] ?? rest;
      const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/servicio.php`;
      const pa = await t.call("PATCH", `/config/restaurante/${cur.id}`, {
        token: sistemas,
        body: { sirUrl: url, sirCode: 41, version: cur.version },
      });
      expect(pa.status, JSON.stringify(pa.error)).toBe(200);
      const sent = await t.call("POST", "/interface/sir/sales/send", { token: sistemas, body: {} });
      expect(sent.status, JSON.stringify(sent.error)).toBe(200);
      expect(sent.body).toMatchObject({ ok: true, status: 200, url, error: null });
      expect(sent.body.response).toContain("interfaceVentasAgregadoresResponse");
      expect(sent.body.sir).toMatchObject({ respuesta: "0", mensaje: "El Menu Mix ya se encuetra Asentado" });
      expect(sent.body.accepted).toBe(false);
      expect(got).toBe(sent.body.request);
      expect(got).toContain("<cod_restaurante>41</cod_restaurante>");
    } finally {
      srv.close();
    }
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
