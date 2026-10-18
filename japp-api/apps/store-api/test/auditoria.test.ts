import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** Arreglos de la auditoría del 15/10/2026: cada prueba demuestra uno. */
let t: T, sis: string, mesero: string, barra: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas); mesero = await t.login(PIN.mesero); barra = await t.login(PIN.barra);
  await ensurePeriod(t, sis);
});
afterAll(async () => { await t.close(); });

async function openTable(tok = sis, plus: number[] = [PLU.tosta]) {
  const o = await t.call("POST", "/orders", { token: tok, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } });
  for (const plu of plus) await t.call("POST", `/orders/${o.body._id}/lines`, { token: tok, body: { plu, force: true } });
  return { orderId: o.body._id as string, accountId: o.body.accounts[0].id as string };
}
const get = async (orderId: string) => (await t.call("GET", `/orders/${orderId}`, { token: sis })).body;
const pending = async (orderId: string) => (await get(orderId)).accounts[0].totals.pending as number;

describe("1 · facturar pide cobro.cobrar", () => {
  it("el mesero no factura sin clave de encargado; con ella, sí", async () => {
    const o = await openTable();
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "card", amount: null } });
    const no = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/invoice`, { token: mesero, body: {} });
    expect([no.status, no.error.code, no.error.details.permission]).toEqual([403, "PERMISSION_REQUIRED", "cobro.cobrar"]);
    const auth = (await t.call("POST", "/sessions/authorize", { token: mesero, body: { pin: PIN.sistemas, permission: "cobro.cobrar" } })).body.authorization.token;
    const ok = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/invoice`, { token: mesero, body: { authorization: auth } });
    expect(ok.status).toBe(201);
    // la clave de encargado no sustituye la sesión de Sistemas
    expect((await t.call("GET", "/sessions/current", { token: sis })).status).toBe(200);
  });
});

describe("2 · Idempotency-Key con peticiones a la vez", () => {
  it("3 POST de línea iguales a la vez → una sola línea y la misma respuesta", async () => {
    const o = await openTable(sis, []);
    const h = { "idempotency-key": crypto.randomUUID() };
    const rs = await Promise.all([1, 2, 3].map(() => t.call("POST", `/orders/${o.orderId}/lines`, { token: sis, body: { plu: PLU.croquetas }, headers: h })));
    expect(rs.map(r => r.status)).toEqual([201, 201, 201]);
    expect(rs[1]!.body).toEqual(rs[0]!.body); expect(rs[2]!.body).toEqual(rs[0]!.body);
    const { rows } = await t.sql.query("SELECT quantity FROM order_line WHERE order_id=$1 AND NOT deleted", [o.orderId]);
    expect(rows).toEqual([{ quantity: "1.000" }]);
    expect(rs.filter(r => r.headers["idempotent-replayed"] === "true")).toHaveLength(2);
  });
  it("2 cobros iguales a la vez → un solo cobro", async () => {
    const o = await openTable();
    const h = { "idempotency-key": crypto.randomUUID() };
    const rs = await Promise.all([1, 2].map(() => t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "card", amount: 2 }, headers: h })));
    expect(rs.map(r => r.status)).toEqual([201, 201]);
    expect(rs[0]!.body.payment.id).toBe(rs[1]!.body.payment.id);
    expect((await t.sql.query("SELECT count(*)::int n FROM payment WHERE account_id=$1", [o.accountId])).rows[0].n).toBe(1);
  });
  it("si la acción falla, la clave se libera y se puede reintentar", async () => {
    const o = await openTable();
    const h = { "idempotency-key": crypto.randomUUID() };
    expect((await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "card", amount: 999 }, headers: h })).error.code).toBe("AMOUNT_EXCEEDS_PENDING");
    expect((await t.sql.query("SELECT count(*)::int n FROM idempotency_key WHERE key=$1", [h["idempotency-key"]])).rows[0].n).toBe(0);
  });
});

describe("3 · IVA cuadrado al céntimo en la factura", () => {
  it("tipos 10 y 21 % con un 7 % de descuento: Σ base + cuota de invoice_tax = total de la factura", async () => {
    const tax = await t.call("POST", "/config/impuestos", { token: sis, body: { name: "IVA 21 prueba", rate: 21 } });
    expect(tax.status).toBe(201);
    const p = await t.call("POST", "/config/productos", { token: sis, body: { name: "CAMISETA PRUEBA", price: 13.37, taxRate: 21 } });
    const o = await openTable(sis, [PLU.tosta, PLU.croquetas, p.body.item.plu]);
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/discounts`, { token: sis, body: { type: "percentage", value: 7, reason: "Prueba" } });
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "card", amount: null } });
    expect((await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/invoice`, { token: sis, body: {} })).status).toBe(201);
    const { rows: [inv] } = await t.sql.query("SELECT id, total, tax_base, tax_total FROM invoice WHERE account_id=$1", [o.accountId]);
    const { rows: [s] } = await t.sql.query("SELECT sum(base) b, sum(tax) t, sum(base + tax) bt, count(*)::int n FROM invoice_tax WHERE invoice_id=$1", [inv.id]);
    expect(s.n).toBe(2);
    expect(s.bt).toBe(inv.total);
    expect([s.b, s.t]).toEqual([inv.tax_base, inv.tax_total]);
  });
});

describe("4 · datos mal formados → 422 / 409, nunca 500", () => {
  it("ids y fechas en consultas y cuerpos", async () => {
    expect((await t.call("GET", "/invoices?from=ayer", { token: sis })).status).toBe(422);
    expect((await t.call("GET", "/invoices?from=2026-10-01&to=2026-13-45", { token: sis })).status).toBe(422);
    expect((await t.call("GET", "/invoices?from=2026-10-01&to=2026-12-31", { token: sis })).status).toBe(200);
    expect((await t.call("GET", "/tables?areaId=sala", { token: sis })).status).toBe(422);
    expect((await t.call("GET", "/orders?tableId=12", { token: sis })).status).toBe(422);
    expect((await t.call("GET", "/orders?status=volando", { token: sis })).status).toBe(422);
    const o = await openTable();
    const line = (await get(o.orderId)).accounts[0].lines[0];
    expect((await t.call("POST", `/orders/${o.orderId}/lines/${line.id}/delete`, { token: sis, body: { reasonId: "motErr" } })).status).toBe(422);
    expect((await t.call("POST", `/orders/${o.orderId}/lines/${line.id}/delete`, { token: sis, body: { reasonId: crypto.randomUUID() } })).error).toMatchObject({ code: "VALIDATION", field: "reasonId" });
  });
  it("un id de línea que ya existe (en otra mesa) → 409 DUPLICATE", async () => {
    const a = await openTable(), b = await openTable(sis, []);
    const used = (await get(a.orderId)).accounts[0].lines[0].id;
    const r = await t.call("POST", `/orders/${b.orderId}/lines`, { token: sis, body: { id: used, plu: PLU.croquetas } });
    expect([r.status, r.error.code]).toEqual([409, "DUPLICATE"]);
  });
});

describe("5 y 7 · formas de pago de Ajustes y reglas del cobro", () => {
  let glovo: any;
  it("una forma de pago nueva (glovo, tipo tarjeta) no vale hasta que la estación la tiene; entonces cobra y guarda su id", async () => {
    glovo = (await t.call("POST", "/config/formas-pago", { token: sis, body: { code: "glovo", name: "Glovo", kind: "card" } })).body.item;
    const o = await openTable();
    const no = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "glovo", amount: 1 } });
    expect([no.status, no.error.code]).toEqual([409, "METHOD_NOT_ALLOWED"]);
    const caja = (await t.call("GET", "/config/estaciones", { token: sis })).body.items.find((x: any) => x.name === "CAJA1");
    const pm = (await t.call("GET", "/config/formas-pago", { token: sis })).body.items.filter((x: any) => caja.paymentMethods.includes(x.id)).map((x: any) => x.code);
    expect((await t.call("PATCH", `/config/estaciones/${caja.id}`, { token: sis, body: { paymentMethods: [...pm, "glovo"], version: caja.version } })).status).toBe(200);
    const ok = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "glovo", amount: 1 } });
    expect(ok.status).toBe(201);
    const { rows: [p] } = await t.sql.query("SELECT method, payment_method_id::text FROM payment WHERE id=$1", [ok.body.payment.id]);
    expect(p).toEqual({ method: "glovo", payment_method_id: glovo.id });
    expect((await get(o.orderId)).accounts[0].payments[0]).toMatchObject({ method: "glovo", kind: "card", methodId: glovo.id });
    // el efectivo también guarda su forma de pago
    const cash = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "cash", amount: null } });
    expect((await t.sql.query("SELECT payment_method_id IS NOT NULL ok FROM payment WHERE id=$1", [cash.body.payment.id])).rows[0].ok).toBe(true);
  });
  it("inactiva o desconocida → METHOD_NOT_ALLOWED; en la PDA solo tarjeta", async () => {
    const o = await openTable();
    expect((await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "cheque", amount: 1 } })).error.code).toBe("METHOD_NOT_ALLOWED");
    await t.sql.query("UPDATE station SET device_uuid = 'pda-0001-aaaa' WHERE name = 'PDA1'");
    const pda = await t.login(PIN.jeison, "pda-0001-aaaa"); // otro usuario: una sesión por usuario
    const r = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: pda, body: { method: "cash", amount: 1 } });
    expect([r.status, r.error.code]).toEqual([409, "METHOD_NOT_ALLOWED"]);
    expect((await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: pda, body: { method: "card", amount: 1 } })).status).toBe(201);
  });
  it("bizum (plataforma) cuenta como «otros», no como tarjeta, en la caja", async () => {
    await t.call("POST", "/config/formas-pago", { token: sis, body: { code: "bizum2", name: "Bizum", kind: "platform" } });
    const before = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const o = await openTable();
    const caja = (await t.call("GET", "/config/estaciones", { token: sis })).body.items.find((x: any) => x.name === "CAJA1");
    const pm = (await t.call("GET", "/config/formas-pago", { token: sis })).body.items.filter((x: any) => caja.paymentMethods.includes(x.id)).map((x: any) => x.code);
    await t.call("PATCH", `/config/estaciones/${caja.id}`, { token: sis, body: { paymentMethods: [...pm, "bizum2"], version: caja.version } });
    expect((await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "bizum2", amount: null } })).status).toBe(201);
    const after = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect([after.cardSales, after.cashSales]).toEqual([before.cardSales, before.cashSales]);
  });
});

describe("8 · comanda: se imprime después del COMMIT y lo que ya salió no se repite", () => {
  it("impresora caída → 503; al volver a enviar sale solo lo que faltaba, sin subir la versión", async () => {
    const chs = (await t.call("GET", "/config/canales", { token: sis })).body.items;
    const barra = chs.find((c: any) => c.name === "BARRA");
    const pr = await t.call("POST", "/config/impresoras", { token: sis, body: { name: "ZONA PRUEBA", connection: "192.168.1.99", kind: "kitchen" } });
    const copy = (await t.call("POST", "/config/canales", { token: sis, body: { name: "COPIA PRUEBA", kind: "kitchen", copyOfId: barra.id, printerId: pr.body.id } })).body.item;
    const real = t.printer.print.bind(t.printer);
    try {
      t.printer.print = async job => (job.printer === "ZONA PRUEBA" ? { ok: false, error: "apagada" } : real(job));
      const o = await openTable();
      t.printer.jobs.length = 0;
      const r = await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} });
      expect([r.status, r.error.code]).toEqual([503, "PRINTER_OFFLINE"]);
      expect(r.error.details.printed).toEqual(expect.arrayContaining([expect.objectContaining({ printer: "ZONA PRUEBA", ok: false }), expect.objectContaining({ channel: "BARRA", ok: true })]));
      const sent = t.printer.jobs.filter(j => j.kind === "kitchen").map(j => j.channel);
      expect(sent).toContain("BARRA");
      expect(sent).not.toContain("COPIA PRUEBA");
      const after = await get(o.orderId);
      expect(after.accounts[0].lines[0].status).toBe("printed"); // se guardó antes de imprimir
      const { rows } = await t.sql.query("SELECT olp.channel_name, olp.printed FROM order_line_printer olp JOIN order_line l ON l.id = olp.line_id WHERE l.order_id=$1 AND channel_name IN ('BARRA', 'COPIA PRUEBA') ORDER BY channel_name", [o.orderId]);
      expect(rows).toEqual([{ channel_name: "BARRA", printed: true }, { channel_name: "COPIA PRUEBA", printed: false }]);
      // vuelve la impresora: «Enviar» imprime solo la copia que faltaba; BARRA no se repite y la versión no cambia
      t.printer.print = real;
      t.printer.jobs.length = 0;
      const again = await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} });
      expect(again.status).toBe(200);
      expect(again.body.printed).toEqual([{ channel: "COPIA PRUEBA", printer: "ZONA PRUEBA", lines: 1, ok: true }]);
      expect(t.printer.jobs.map(j => j.channel)).toEqual(["COPIA PRUEBA"]);
      expect(again.body.order.version).toBe(after.version);
      expect((await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} })).body.printed).toEqual([]);
    } finally {
      t.printer.print = real;
      await t.call("POST", `/config/canales/${copy.id}/deactivate`, { token: sis, body: {} });
    }
  });
  it("dos reintentos a la vez después del fallo: lo que faltaba se imprime una sola vez", async () => {
    const chs = (await t.call("GET", "/config/canales", { token: sis })).body.items;
    const barra = chs.find((c: any) => c.name === "BARRA");
    const pr = await t.call("POST", "/config/impresoras", { token: sis, body: { name: "ZONA DOBLE", connection: "192.168.1.98", kind: "kitchen" } });
    const copy = (await t.call("POST", "/config/canales", { token: sis, body: { name: "COPIA DOBLE", kind: "kitchen", copyOfId: barra.id, printerId: pr.body.id } })).body.item;
    const real = t.printer.print.bind(t.printer);
    try {
      t.printer.print = async job => (job.printer === "ZONA DOBLE" ? { ok: false, error: "apagada" } : real(job));
      const o = await openTable();
      expect((await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} })).error.code).toBe("PRINTER_OFFLINE");
      // vuelve la impresora (lenta): dos equipos reintentan a la vez
      t.printer.print = async job => { await new Promise(r => setTimeout(r, 50)); return real(job); };
      t.printer.jobs.length = 0;
      const [a, b] = await Promise.all([1, 2].map(() => t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} })));
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(t.printer.jobs.filter(j => j.channel === "COPIA DOBLE")).toHaveLength(1);
      expect([...a.body.printed, ...b.body.printed]).toEqual([{ channel: "COPIA DOBLE", printer: "ZONA DOBLE", lines: 1, ok: true }]);
    } finally {
      t.printer.print = real;
      await t.call("POST", `/config/canales/${copy.id}/deactivate`, { token: sis, body: {} });
    }
  });
  it("precuenta con la impresora caída → 503, queda en precuenta y se puede repetir", async () => {
    const o = await openTable();
    await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} });
    const real = t.printer.print.bind(t.printer);
    try {
      t.printer.print = async job => (job.kind === "prebill" ? { ok: false, error: "apagada" } : real(job));
      expect((await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/prebill`, { token: sis, body: {} })).error.code).toBe("PRINTER_OFFLINE");
    } finally { t.printer.print = real; }
    expect((await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/prebill`, { token: sis, body: {} })).status).toBe(200);
  });
});

describe("9 · permisos de separar y quitar descuento", () => {
  it("pasar a otra cuenta vale con pedido.pasarCuenta aunque no se tenga pedido.separar", async () => {
    const o = await openTable(mesero, [PLU.tosta, PLU.croquetas]);
    const line = (await get(o.orderId)).accounts[0].lines[0];
    await t.sql.query("DELETE FROM profile_permission WHERE permission_code='pedido.separar' AND profile_id=(SELECT id FROM user_profile WHERE code='MESERO')");
    try {
      const r = await t.call("POST", `/orders/${o.orderId}/lines/move`, { token: mesero, body: { lines: [{ lineId: line.id, quantity: 1 }], toAccountId: null } });
      expect(r.status).toBe(200);
    } finally {
      await t.sql.query("INSERT INTO profile_permission (profile_id, permission_code, store_id) SELECT id, 'pedido.separar', store_id FROM user_profile WHERE code='MESERO' ON CONFLICT DO NOTHING");
    }
  });
  it("quitar un descuento admite la clave de encargado", async () => {
    const o = await openTable();
    const d = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/discounts`, { token: sis, body: { type: "percentage", value: 10, reason: "Prueba" } });
    const id = d.body.accounts[0].discounts.find((x: any) => x.status === "applied").id;
    const no = await t.call("DELETE", `/orders/${o.orderId}/accounts/${o.accountId}/discounts/${id}`, { token: mesero });
    expect([no.status, no.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    const auth = (await t.call("POST", "/sessions/authorize", { token: mesero, body: { pin: PIN.sistemas, permission: "cobro.descuentos" } })).body.authorization.token;
    const ok = await t.call("DELETE", `/orders/${o.orderId}/accounts/${o.accountId}/discounts/${id}`, { token: mesero, body: { authorization: auth } });
    expect(ok.status).toBe(200);
  });
});

describe("10 · anulaciones con su momento e importe real", () => {
  it("Eliminaciones dice si fue en precuenta y suma las respuestas; no sale lo incluido en menú ni lo pasado", async () => {
    const o = await openTable();
    await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} });
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/prebill`, { token: sis, body: {} });
    const line = (await get(o.orderId)).accounts[0].lines[0];
    await t.sql.query("INSERT INTO order_line_modifier (id, store_id, line_id, name, quantity, unit_price) SELECT $1, store_id, id, 'Extra', 1, 1.50 FROM order_line WHERE id=$2", [crypto.randomUUID(), line.id]);
    const d = await t.call("POST", `/orders/${o.orderId}/lines/${line.id}/delete`, { token: sis, body: { reason: "Invitación prueba" } });
    expect(d.status).toBe(200);
    const items = (await t.call("GET", "/reports/deletions", { token: sis })).body.items;
    const mine = items.find((x: any) => x.reason === "Invitación prueba");
    expect(mine).toMatchObject({ stage: "preBill", amount: 10 }); // 8,50 + 1,50
    expect(items.some((x: any) => x.reason === "Incluida en menú" || x.reason.startsWith("Pasada a "))).toBe(false);
  });
});

describe("C · línea ya cobrada", () => {
  it("con un cobro parcial no se puede dejar la cuenta por debajo de lo cobrado; añadir sí", async () => {
    const o = await openTable(sis, [PLU.tosta, PLU.croquetas]);
    const acc = (await get(o.orderId)).accounts[0];
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "card", amount: acc.totals.total - 1 } });
    const big = acc.lines.reduce((a: any, l: any) => (l.amount > a.amount ? l : a));
    const r = await t.call("POST", `/orders/${o.orderId}/lines/${big.id}/delete`, { token: sis, body: {} });
    expect([r.status, r.error.code]).toEqual([409, "TOTAL_BELOW_PAID"]);
    expect(r.error.message).toMatch(/^Ya se ha cobrado \d+,\d{2} €: no se puede dejar la cuenta por debajo$/);
    expect((await t.call("PATCH", `/orders/${o.orderId}/lines/${big.id}`, { token: sis, body: { quantity: 0 } })).error.code).toBe("TOTAL_BELOW_PAID");
    expect((await t.call("POST", `/orders/${o.orderId}/lines`, { token: sis, body: { plu: PLU.redbull } })).status).toBe(201);
  });
});

describe("13 · Ajustes › Facturación crea la serie que falte", () => {
  it("cambiar la serie simplificada a una nueva: se crea en invoice_series y se factura con ella", async () => {
    const cur = (await t.call("GET", "/config/facturacion/current", { token: sis })).body;
    const r = await t.call("PATCH", "/config/facturacion/current", { token: sis, body: { seriesSimplified: "TP2099", version: cur.version } });
    expect(r.status).toBe(200);
    try {
      const o = await openTable();
      await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, { token: sis, body: { method: "card", amount: null } });
      const inv = await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/invoice`, { token: sis, body: {} });
      expect(inv.body.invoice.invoiceNumber).toBe("TP2099-000001");
    } finally {
      await t.call("PATCH", "/config/facturacion/current", { token: sis, body: { seriesSimplified: cur.seriesSimplified, version: r.body.version } });
    }
  });
});

describe("14 · enviar sin nada no cambia nada; PLU e incidencias sin repetidos", () => {
  it("send sin nada por enviar: misma versión y nada nuevo en la cola", async () => {
    const o = await openTable();
    await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} });
    const v = (await get(o.orderId)).version;
    const n = (await t.sql.query("SELECT count(*)::int n FROM sync_outbox WHERE entity_id=$1", [o.orderId])).rows[0].n;
    const r = await t.call("POST", `/orders/${o.orderId}/send`, { token: sis, body: {} });
    expect([r.status, r.body.printed, r.body.order.version]).toEqual([200, [], v]);
    expect((await t.sql.query("SELECT count(*)::int n FROM sync_outbox WHERE entity_id=$1", [o.orderId])).rows[0].n).toBe(n);
  });
  it("tres productos nuevos a la vez sin PLU: tres PLU y tres incidencias distintas", async () => {
    const rs = await Promise.all([1, 2, 3].map(i => t.call("POST", "/config/productos", { token: sis, body: { name: `A LA VEZ ${i}`, price: 1, taxRate: 10 } })));
    expect(rs.map(r => r.status)).toEqual([201, 201, 201]);
    expect(new Set(rs.map(r => r.body.item.plu)).size).toBe(3);
    const { rows } = await t.sql.query("SELECT code FROM product_incident WHERE product_name LIKE 'A LA VEZ %'");
    expect(new Set(rows.map(r => r.code)).size).toBe(3);
  });
});
