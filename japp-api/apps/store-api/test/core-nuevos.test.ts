import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";
// @ts-ignore
import { verificationQueries } from "../../../../japp-db/scripts/db.mjs";

let t: T;
let sistemas: string;
let barra: string;
let mesero: string;

beforeAll(async () => {
  t = await setup();
  sistemas = await t.login(PIN.sistemas);
  barra = await t.login(PIN.barra);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sistemas);
});
afterAll(async () => {
  // las estaciones vuelven a quedar sin equipo (la base es la misma para todos los ficheros de prueba)
  await t.sql.query("UPDATE station SET device_uuid = NULL WHERE name IN ('CAJA1','PDA1')");
  await t.close();
});

const one = async (q: string, p: unknown[] = []) => (await t.sql.query(q, p)).rows[0];

/** Mesa cobrada con tarjeta y facturada: 1 tosta + 2 croquetas. Devuelve la orden, la cuenta, la factura y sus líneas. */
async function invoiced(token = barra) {
  const o = await t.call("POST", "/orders", {
    token,
    body: { tableId: await freeTable(t, "BARRA"), guests: 2 },
  });
  const orderId = o.body._id as string;
  const acc = o.body.accounts[0].id as string;
  await t.call("POST", `/orders/${orderId}/lines`, { token, body: { plu: PLU.tosta } });
  const l = await t.call("POST", `/orders/${orderId}/lines`, {
    token,
    body: { plu: PLU.croquetas, quantity: 2 },
  });
  const total = l.body.accounts[0].totals.total as number;
  await t.call("POST", `/orders/${orderId}/accounts/${acc}/payments`, {
    token,
    body: { method: "card", amount: total },
  });
  const r = await t.call("POST", `/orders/${orderId}/accounts/${acc}/invoice`, { token });
  expect(r.status).toBe(201);
  const inv = await one("SELECT id::text, invoice_number, total FROM invoice WHERE account_id=$1", [acc]);
  const lines = l.body.accounts[0].lines as { id: string; productId: number; quantity: number }[];
  return {
    orderId,
    acc,
    total,
    invoiceId: inv.id as string,
    number: inv.invoice_number as string,
    tosta: lines.find((x) => x.productId === PLU.tosta)!,
    croquetas: lines.find((x) => x.productId === PLU.croquetas)!,
  };
}

describe("equipos", () => {
  // 1.2.281 · identify / claim-main por IP: ver pruebas-281.test.ts (el UUID del equipo ya no se usa)
  it("me: la estación de la sesión con cajón, formas de pago (en la PDA solo tarjeta) y canales", async () => {
    const r = await t.call("GET", "/devices/me", { token: sistemas });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "CAJA1", kind: "station", main: true, opensDrawer: true });
    expect(r.body.paymentMethods).toEqual(expect.arrayContaining(["cash", "card"]));
    const ch = await one(
      `SELECT ch.name channel, pr.name printer, pr.connection FROM station_channel_printer scp JOIN station s ON s.id=scp.station_id
       JOIN print_channel ch ON ch.id=scp.channel_id JOIN printer pr ON pr.id=scp.printer_id WHERE s.name='CAJA1' LIMIT 1`,
    );
    expect(r.body.channels[ch.channel]).toEqual({ printer: ch.printer, connection: ch.connection });
    const pda = await t.login(PIN.mesero, "PDA1");
    const p = await t.call("GET", "/devices/me", { token: pda });
    expect(p.body).toMatchObject({ name: "PDA1", kind: "pda", main: false, opensDrawer: false });
    const cardCodes = (
      await t.sql.query("SELECT code FROM payment_method WHERE kind='card' AND active ORDER BY code")
    ).rows.map((x) => x.code);
    expect([...p.body.paymentMethods].sort()).toEqual(cardCodes);
    mesero = await t.login(PIN.mesero);
    expect((await t.call("GET", "/devices/me")).status).toBe(401);
  });
});

describe("abono (factura rectificativa)", () => {
  let s: Awaited<ReturnType<typeof invoiced>>;
  beforeAll(async () => {
    s = await invoiced();
  });

  it("permiso funciones.abonar; motivo obligatorio; solo la factura entera; factura que no existe", async () => {
    const url = `/invoices/${s.invoiceId}/credit`;
    const p = await t.call("POST", url, { token: mesero, body: { reason: "Error" } });
    expect([p.status, p.error.code, p.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "funciones.abonar",
    ]);
    expect((await t.call("POST", url, { token: sistemas, body: {} })).error).toMatchObject({
      code: "VALIDATION",
      field: "reason",
    });
    expect(
      (await t.call("POST", url, { token: sistemas, body: { reasonId: crypto.randomUUID() } })).error,
    ).toMatchObject({ code: "VALIDATION", field: "reasonId" });
    const motivoBorrar = (await one("SELECT id::text FROM reason WHERE kind='delete' LIMIT 1")).id;
    expect((await t.call("POST", url, { token: sistemas, body: { reasonId: motivoBorrar } })).status).toBe(
      422,
    );
    // 27/10/2026: solo se abona la factura entera
    const part = await t.call("POST", url, {
      token: sistemas,
      body: { reason: "Error", lines: [{ lineId: s.croquetas.id, quantity: 1 }] },
    });
    expect([part.status, part.error.code, part.error.field]).toEqual([422, "VALIDATION", "lines"]);
    const nf = await t.call("POST", `/invoices/${crypto.randomUUID()}/credit`, {
      token: sistemas,
      body: { reason: "Error" },
    });
    expect([nf.status, nf.error.code]).toEqual([404, "NOT_FOUND"]);
    expect(
      (await t.call("POST", "/invoices/abc/credit", { token: sistemas, body: { reason: "x" } })).status,
    ).toBe(422);
    expect(
      Number((await one("SELECT count(*) n FROM invoice WHERE rectified_invoice_id=$1", [s.invoiceId])).n),
    ).toBe(0);
  });

  it("total: R5 en la serie de abonos, en negativo, encadenado, con sus líneas; la original rectified; la orden a la cola; misma Idempotency-Key → un abono", async () => {
    const tail = await one(
      "SELECT v.id::text, v.hash FROM verifactu_record v WHERE NOT EXISTS (SELECT 1 FROM verifactu_record n WHERE n.previous_record_id=v.id)",
    );
    const seq = (await one("SELECT last_sequence FROM invoice_series WHERE series='AB2026'")).last_sequence;
    const ord = await one("SELECT version FROM orders WHERE id=$1", [s.orderId]);
    const outbox = Number(
      (await one("SELECT count(*) n FROM sync_outbox WHERE entity='order' AND entity_id=$1", [s.orderId])).n,
    );
    const jobs = t.printer.jobs.length;
    const h = { "idempotency-key": crypto.randomUUID() };
    const body = { reason: "Error al cobrar", print: true };
    const r = await t.call("POST", `/invoices/${s.invoiceId}/credit`, { token: sistemas, body, headers: h });
    expect(r.status).toBe(201);
    const unit = s.total;
    expect(r.body).toMatchObject({
      type: "R5",
      invoiceNumber: `AB2026-${String(seq + 1).padStart(6, "0")}`,
      rectifies: s.number,
      total: -unit,
      full: true,
      printed: true,
    });
    expect(
      r.body.lines.map((x: { lineId: string; quantity: number }) => [x.lineId, x.quantity]).sort(),
    ).toEqual(
      [
        [s.tosta.id, 1],
        [s.croquetas.id, 2],
      ].sort(),
    );
    expect(r.body.taxes.every((x: { base: number; tax: number }) => x.base < 0 && x.tax < 0)).toBe(true);
    expect(r.body.verifactuQr).toContain(`numserie=${r.body.invoiceNumber}`);
    const inv = await one(
      "SELECT type, series, total::float8 total, rectified_invoice_id::text rid, rectification_reason, status, account_id::text acc FROM invoice WHERE id=$1",
      [r.body.id],
    );
    expect(inv).toEqual({
      type: "R5",
      series: "AB2026",
      total: -unit,
      rid: s.invoiceId,
      rectification_reason: "Error al cobrar",
      status: "issued",
      acc: s.acc,
    });
    expect((await one("SELECT status FROM invoice WHERE id=$1", [s.invoiceId])).status).toBe("rectified");
    expect(
      Number(
        (
          await one("SELECT sum(amount)::float8 a FROM invoice_credit_line WHERE credit_invoice_id=$1", [
            r.body.id,
          ])
        ).a,
      ),
    ).toBe(unit);
    const vf = await one(
      "SELECT invoice_type, previous_record_id::text prev, previous_hash, total::float8 total FROM verifactu_record WHERE invoice_id=$1",
      [r.body.id],
    );
    expect(vf).toEqual({ invoice_type: "R5", prev: tail.id, previous_hash: tail.hash, total: -unit });
    expect((await one("SELECT version FROM orders WHERE id=$1", [s.orderId])).version).toBe(ord.version + 1);
    expect(
      Number(
        (await one("SELECT count(*) n FROM sync_outbox WHERE entity='order' AND entity_id=$1", [s.orderId]))
          .n,
      ),
    ).toBe(outbox + 1);
    expect(
      (
        await one("SELECT description FROM order_event WHERE order_id=$1 AND type='invoiceCredited'", [
          s.orderId,
        ])
      ).description,
    ).toContain(r.body.invoiceNumber);
    // ticket después del COMMIT
    expect(t.printer.jobs.length).toBe(jobs + 1);
    const txt = t.printer.jobs[jobs]!.text;
    expect(txt).toContain("FACTURA RECTIFICATIVA");
    expect(txt).toContain(`Rectifica a: ${s.number}`);
    // misma clave → misma respuesta, un solo abono
    const again = await t.call("POST", `/invoices/${s.invoiceId}/credit`, {
      token: sistemas,
      body,
      headers: h,
    });
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.id).toBe(r.body.id);
    expect(
      Number((await one("SELECT count(*) n FROM invoice WHERE rectified_invoice_id=$1", [s.invoiceId])).n),
    ).toBe(1);
    // la mesa sigue mostrando su factura (no el abono)
    const o = await t.call("GET", `/orders/${s.orderId}`, { token: sistemas });
    expect(o.body.accounts[0].invoice.invoiceNumber).toBe(s.number);
  });

  it("ya abonada: nada que abonar; un abono no se abona; la base cuadra", async () => {
    const reasonId = (await one("SELECT id::text FROM reason WHERE kind='credit' LIMIT 1")).id;
    const done = await t.call("POST", `/invoices/${s.invoiceId}/credit`, {
      token: sistemas,
      body: { reasonId },
    });
    expect([done.status, done.error.code]).toEqual([422, "QUANTITY_EXCEEDS"]);
    const sum = await one("SELECT sum(total)::float8 t FROM invoice WHERE rectified_invoice_id=$1", [
      s.invoiceId,
    ]);
    expect(sum.t).toBe(-s.total);
    const ab = await one("SELECT id::text FROM invoice WHERE rectified_invoice_id=$1", [s.invoiceId]);
    const ofCredit = await t.call("POST", `/invoices/${ab.id}/credit`, {
      token: sistemas,
      body: { reason: "x" },
    });
    expect([ofCredit.status, ofCredit.error.code]).toEqual([422, "VALIDATION"]);
    for (const q of verificationQueries()) {
      expect((await t.sql.query(q.sql)).rows, q.name).toEqual([]);
    }
  });

  it("estado VeriFactu de la factura y del abono; permiso funciones.facturas; 404 y 422", async () => {
    const r = await t.call("GET", `/invoices/${s.invoiceId}/verifactu`, { token: barra });
    expect(r.status).toBe(200);
    const rec = await one("SELECT hash, previous_hash FROM verifactu_record WHERE invoice_id=$1", [
      s.invoiceId,
    ]);
    expect(r.body).toMatchObject({
      invoiceNumber: s.number,
      type: "F2",
      status: "pending",
      hash: rec.hash,
      previousHash: rec.previous_hash,
      sentAt: null,
      attempts: 0,
      lastError: null,
    });
    expect((await t.call("GET", `/invoices/${s.invoiceId}/verifactu`, { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
    expect((await t.call("GET", `/invoices/${crypto.randomUUID()}/verifactu`, { token: barra })).status).toBe(
      404,
    );
    expect((await t.call("GET", "/invoices/abc/verifactu", { token: barra })).status).toBe(422);
  });
});

describe("caja: abrir cajón y corte X", () => {
  it("abre el cajón por la impresora de la estación; sin cajón → 422; impresora caída → 503; permiso", async () => {
    const jobs = t.printer.jobs.length;
    const r = await t.call("POST", "/cash/drawer/open", { token: sistemas, body: {} });
    expect(r.status).toBe(200);
    expect(r.body.opened).toBe(true);
    const job = t.printer.jobs[jobs]!;
    expect(job).toMatchObject({ kind: "drawer", openDrawer: true, printer: r.body.printer, ticket: [] });
    expect((await t.call("POST", "/cash/drawer/open", { token: mesero, body: {} })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
    expect(
      (await t.call("POST", "/cash/drawer/open", { token: sistemas, body: { reasonId: "x" } })).status,
    ).toBe(422);
    await t.sql.query("UPDATE station SET opens_drawer=false WHERE name='CAJA1'");
    try {
      const no = await t.call("POST", "/cash/drawer/open", { token: sistemas, body: {} });
      expect([no.status, no.error.code, no.error.field]).toEqual([422, "VALIDATION", "station"]);
    } finally {
      await t.sql.query("UPDATE station SET opens_drawer=true WHERE name='CAJA1'");
    }
    const real = t.printer.print.bind(t.printer);
    t.printer.print = async () => ({ ok: false, error: "apagada" });
    try {
      const off = await t.call("POST", "/cash/drawer/open", { token: sistemas, body: {} });
      expect([off.status, off.error.code]).toEqual([503, "PRINTER_OFFLINE"]);
    } finally {
      t.printer.print = real;
    }
  });

  it("corte X: el resumen del periodo sin cerrar; una venta más suma; permiso funciones.caja", async () => {
    const a = await t.call("GET", "/cash/x-report", { token: sistemas });
    expect(a.status).toBe(200);
    const s = await invoiced();
    const b = (await t.call("GET", "/cash/x-report", { token: sistemas })).body;
    expect(b.tickets).toBe(a.body.tickets + 1);
    expect(Math.round((b.sales - a.body.sales) * 100) / 100).toBe(s.total);
    expect(Math.round((b.byMethod.card - a.body.byMethod.card) * 100) / 100).toBe(s.total);
    const cash = (await t.call("GET", "/cash/summary", { token: sistemas })).body;
    expect(b.expectedCash).toBe(cash.expectedCash);
    const live = (await t.call("GET", "/reports/live", { token: sistemas })).body;
    expect(b.sales).toBe(live.invoiced.total);
    expect(b.openTables).toEqual({ count: live.open.tables, amount: live.open.amount });
    expect((await t.call("GET", "/cash/x-report", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
  });
});

describe("informes de ventas y camareros", () => {
  it("ventas: lo mismo que el corte X, por hora, por forma de pago y productos; periodId; permiso", async () => {
    const r = await t.call("GET", "/reports/sales", { token: sistemas });
    expect(r.status).toBe(200);
    const x = (await t.call("GET", "/cash/x-report", { token: sistemas })).body;
    expect(r.body).toMatchObject({
      periodId: x.periodId,
      sold: x.sales,
      tickets: x.tickets,
      byMethod: x.byMethod,
    });
    const hours = r.body.byHour.reduce((acc: number, h: { amount: number }) => acc + h.amount, 0);
    expect(Math.round(hours * 100) / 100).toBe(r.body.sold);
    expect(r.body.topProducts.some((p: { plu: number }) => p.plu === PLU.croquetas)).toBe(true);
    const same = await t.call("GET", `/reports/sales?periodId=${x.periodId}`, { token: sistemas });
    expect(same.body.sold).toBe(r.body.sold);
    expect((await t.call("GET", "/reports/sales?periodId=abc", { token: sistemas })).status).toBe(422);
    expect(
      (await t.call("GET", `/reports/sales?periodId=${crypto.randomUUID()}`, { token: sistemas })).status,
    ).toBe(404);
    expect((await t.call("GET", "/reports/sales", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
  });

  it("ventas: las mesas abiertas sin cobrar también cuentan (open) y la proyección parte de esa venta real (outlook)", async () => {
    const before = (await t.call("GET", "/reports/sales", { token: sistemas })).body;
    const o = await t.call("POST", "/orders", {
      token: sistemas,
      body: { tableId: await freeTable(t, "BARRA"), guests: 3 },
    });
    const l = await t.call("POST", `/orders/${o.body._id}/lines`, {
      token: sistemas,
      body: { plu: PLU.croquetas, quantity: 2 },
    });
    const total = l.body.accounts[0].totals.total;
    const r = await t.call("GET", "/reports/sales", { token: sistemas });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body.sold).toBe(before.sold); // lo facturado no cambia
    expect(r.body.open.tables).toBe(before.open.tables + 1);
    expect(r.body.open.amount).toBeCloseTo(before.open.amount + total, 2);
    expect(r.body.open.guests).toBe(before.open.guests + 3);
    expect(r.body.open.byWaiter.find((w: { user: string }) => w.user === "Sistemas").tables).toBeGreaterThan(
      0,
    );
    const oh = r.body.open.byHour.reduce((acc: number, h: { amount: number }) => acc + h.amount, 0);
    expect(oh).toBeGreaterThanOrEqual(total - 0.01);
    expect(r.body.outlook.current).toBeCloseTo(r.body.sold + r.body.open.amount, 2);
    expect(r.body.outlook.projection).toBeGreaterThanOrEqual(r.body.outlook.current);
    expect(r.body.invoiced).toBeCloseTo(r.body.sold + r.body.credits.amount, 2);
    expect(["history", "default"]).toContain(r.body.outlook.method);
    // lo marcado en la mesa abierta sale en productos
    expect(r.body.topProducts.some((p: { plu: number }) => p.plu === PLU.croquetas)).toBe(true);
    // se cierra sin venta: deja de contar
    await t.call("POST", `/orders/${o.body._id}/lines/${l.body.accounts[0].lines[0].id}/delete`, {
      token: sistemas,
      body: {},
    });
    const g = (await t.call("GET", `/orders/${o.body._id}`, { token: sistemas })).body;
    expect(
      (await t.call("POST", `/orders/${o.body._id}/close`, { token: sistemas, body: { version: g.version } }))
        .status,
    ).toBe(200);
    expect((await t.call("GET", "/reports/sales", { token: sistemas })).body.open.tables).toBe(
      before.open.tables,
    );
  });

  it("ventas: lo que ya tiene precuenta va aparte en open.preBill (también por hora) y sigue dentro de open.amount", async () => {
    const before = (await t.call("GET", "/reports/sales", { token: sistemas })).body;
    expect(before.open.preBill).toBeTruthy();
    const o = await t.call("POST", "/orders", {
      token: sistemas,
      body: { tableId: await freeTable(t, "BARRA"), guests: 2 },
    });
    const l = await t.call("POST", `/orders/${o.body._id}/lines`, {
      token: sistemas,
      body: { plu: PLU.croquetas, quantity: 1 },
    });
    const acc = l.body.accounts[0];
    let r = (await t.call("GET", "/reports/sales", { token: sistemas })).body;
    expect(r.open.preBill.amount).toBeCloseTo(before.open.preBill.amount, 2); // aún sin precuenta
    await t.call("POST", `/orders/${o.body._id}/send`, { token: sistemas, body: {} });
    const pb = await t.call("POST", `/orders/${o.body._id}/accounts/${acc.id}/prebill`, {
      token: sistemas,
      body: {},
    });
    expect(pb.status, JSON.stringify(pb.error)).toBeLessThan(300);
    r = (await t.call("GET", "/reports/sales", { token: sistemas })).body;
    expect(r.open.preBill.tables).toBe(before.open.preBill.tables + 1);
    expect(r.open.preBill.amount).toBeCloseTo(before.open.preBill.amount + acc.totals.total, 2);
    expect(r.open.amount).toBeCloseTo(before.open.amount + acc.totals.total, 2);
    const hp = r.open.byHour.reduce((a: number, h: { preBill: number }) => a + h.preBill, 0);
    expect(hp).toBeGreaterThanOrEqual(acc.totals.total - 0.01);
  });

  it("camareros: por quien abrió la mesa, con sus anulaciones; permiso funciones.kpi", async () => {
    // Sistemas abre una mesa, envía y borra una línea enviada (anulación) y factura otra
    const o = await t.call("POST", "/orders", {
      token: sistemas,
      body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
    });
    const id = o.body._id;
    const acc = o.body.accounts[0].id;
    const l1 = await t.call("POST", `/orders/${id}/lines`, { token: sistemas, body: { plu: PLU.tosta } });
    await t.call("POST", `/orders/${id}/lines`, { token: sistemas, body: { plu: PLU.croquetas } });
    await t.call("POST", `/orders/${id}/send`, { token: sistemas, body: {} });
    const del = await t.call("POST", `/orders/${id}/lines/${l1.body.accounts[0].lines[0].id}/delete`, {
      token: sistemas,
      body: { reason: "Error al marcar" },
    });
    expect(del.status).toBe(200);
    const total = del.body.accounts[0].totals.total;
    await t.call("POST", `/orders/${id}/accounts/${acc}/payments`, {
      token: sistemas,
      body: { method: "card", amount: total },
    });
    expect((await t.call("POST", `/orders/${id}/accounts/${acc}/invoice`, { token: sistemas })).status).toBe(
      201,
    );
    const r = await t.call("GET", "/reports/staff", { token: sistemas });
    expect(r.status).toBe(200);
    const me = r.body.items.find((x: { user: string }) => x.user === "Sistemas");
    const userId = (await one("SELECT id::text FROM app_user WHERE name='Sistemas'")).id;
    expect(me).toMatchObject({ userId });
    expect(me.tickets).toBeGreaterThanOrEqual(1);
    expect(me.voids).toBeGreaterThanOrEqual(1);
    expect(me.voidsAmount).toBeGreaterThan(0);
    expect(me.avgTicket).toBe(Math.round((me.sales / me.tickets) * 100) / 100);
    const barraRow = r.body.items.find((x: { user: string }) => x.user === "Barra");
    expect(barraRow.tables).toBeGreaterThanOrEqual(1);
    expect((await t.call("GET", "/reports/staff?periodId=12", { token: sistemas })).status).toBe(422);
    expect((await t.call("GET", "/reports/staff", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
  });
});

describe("incidencias de productos", () => {
  let a: string;
  let b: string;
  beforeAll(async () => {
    const st = (await one("SELECT id::text FROM store")).id;
    const prod = await one("SELECT id::text, name FROM product WHERE plu=$1", [PLU.tosta]);
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const [id, at] of [
      [a, "2026-10-13T10:00:00Z"],
      [b, "2026-10-13T11:00:00Z"],
    ]) {
      await t.sql.query(
        "INSERT INTO product_incident (id, store_id, code, at, user_name, product_id, product_name, action, diff, status) VALUES ($1,$2,$3,$4,'Sistemas',$5,$6,'update','PVP: 4,50 → 4,80','pending')",
        [id, st, `T-${id.slice(0, 8)}`, at, prod.id, prod.name],
      );
    }
  });

  it("lista por estado con PLU y producto; permiso; estado no válido → 422", async () => {
    const r = await t.call("GET", "/incidents", { token: sistemas });
    expect(r.status).toBe(200);
    expect(r.body.items.find((x: { id: string }) => x.id === a)).toMatchObject({
      plu: PLU.tosta,
      action: "update",
      detail: "PVP: 4,50 → 4,80",
      user: "Sistemas",
      status: "pending",
      requestCode: null,
    });
    expect(r.body.items.every((x: { status: string }) => x.status === "pending")).toBe(true);
    expect((await t.call("GET", "/incidents?status=todas", { token: sistemas })).status).toBe(422);
    expect((await t.call("GET", "/incidents", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
  });

  it("enviar las de ids: solicitud REQ-nnnn, enviadas y a la cola; misma Idempotency-Key → una solicitud; sin pendientes → 0", async () => {
    expect((await t.call("POST", "/incidents/send", { token: mesero, body: {} })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
    expect((await t.call("POST", "/incidents/send", { token: sistemas, body: { ids: ["x"] } })).status).toBe(
      422,
    );
    expect((await t.call("POST", "/incidents/send", { token: sistemas, body: { otro: 1 } })).status).toBe(
      422,
    );
    const reqs = Number((await one("SELECT count(*) n FROM incident_request")).n);
    const h = { "idempotency-key": crypto.randomUUID() };
    const body = { ids: [a], note: "Subida de PVP" };
    const r = await t.call("POST", "/incidents/send", { token: sistemas, body, headers: h });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ request: `REQ-${String(reqs + 1).padStart(4, "0")}`, sent: 1 });
    const again = await t.call("POST", "/incidents/send", { token: sistemas, body, headers: h });
    expect(again.body).toEqual(r.body);
    expect(Number((await one("SELECT count(*) n FROM incident_request")).n)).toBe(reqs + 1);
    const row = await one(
      "SELECT i.status, r.code, r.trigger_kind, r.sent_by FROM product_incident i JOIN incident_request r ON r.id=i.request_id WHERE i.id=$1",
      [a],
    );
    expect(row).toEqual({
      status: "sent",
      code: r.body.request,
      trigger_kind: "manual",
      sent_by: "Sistemas",
    });
    expect((await one("SELECT status FROM product_incident WHERE id=$1", [b])).status).toBe("pending");
    const q = await one(
      "SELECT payload FROM sync_outbox WHERE entity='incident_request' ORDER BY id DESC LIMIT 1",
    );
    expect(q.payload).toMatchObject({ code: r.body.request, note: "Subida de PVP", incidents: [{ id: a }] });
    const sent = await t.call("GET", "/incidents?status=sent", { token: sistemas });
    expect(sent.body.items.find((x: { id: string }) => x.id === a).requestCode).toBe(r.body.request);
    const none = await t.call("POST", "/incidents/send", { token: sistemas, body: { ids: [a] } });
    expect(none.body).toEqual({ request: null, sent: 0 });
    // todas las pendientes
    const all = await t.call("POST", "/incidents/send", { token: sistemas, body: {} });
    expect(all.body.sent).toBeGreaterThanOrEqual(1);
    expect(Number((await one("SELECT count(*) n FROM product_incident WHERE status='pending'")).n)).toBe(0);
  });
});

describe("sincronización", () => {
  it("sync/now: avisa al agente (NOTIFY sync_outbox) y responde las transacciones en cola; permiso", async () => {
    const got: string[] = [];
    t.sql.on("notification", (m) => got.push(m.channel));
    await t.sql.query("LISTEN sync_outbox");
    const r = await t.call("POST", "/sync/now", { token: sistemas, body: {} });
    expect(r.status).toBe(202);
    const n = Number(
      (
        await one(
          "SELECT count(*) n FROM sync_outbox WHERE entity='order' AND sent_at IS NULL AND parked_at IS NULL",
        )
      ).n,
    );
    expect(r.body).toEqual({ queued: n });
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < 50 && !got.length; i++) {
      await new Promise((ok) => setTimeout(ok, 20));
    }
    expect(got).toContain("sync_outbox");
    await t.sql.query("UNLISTEN sync_outbox");
    expect((await t.call("POST", "/sync/now", { token: mesero, body: {} })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
  });
});
