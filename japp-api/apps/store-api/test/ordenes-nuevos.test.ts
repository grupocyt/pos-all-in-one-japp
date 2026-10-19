import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Endpoints nuevos de órdenes y cobro: POST …/save («Guardar y salir»), POST …/transfer con scope,
 * POST …/reopen, PATCH …/accounts/{id} (renombrar), POST …/accounts/{id}/checkout y GET /customers.
 */
let t: T;
let sis: string;
let mesero: string;
let jeison: string;
let storeId: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  jeison = await t.login(PIN.jeison);
  await ensurePeriod(t, sis);
  storeId = (await t.sql.query("SELECT id::text FROM store LIMIT 1")).rows[0].id;
});
afterAll(async () => {
  await t.sql.query(
    "UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL",
  );
  await t.close();
});

const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
/** Mesa nueva en BARRA con los productos pedidos (sin enviar) en la Cuenta 1. */
async function newOrder(plus: number[] = [PLU.tosta]) {
  const o = (
    await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })
  ).body;
  for (const plu of plus) {
    await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu, force: true } });
  }
  return { id: o._id as string, acc: o.accounts[0].id as string, tableId: o.tableData.tableId as string };
}
/** Quita un permiso al perfil Mesero mientras dura fn (y lo devuelve aunque falle). */
async function withoutPermission(perm: string, fn: () => Promise<void>) {
  await t.sql.query(
    "DELETE FROM profile_permission WHERE permission_code=$1 AND profile_id=(SELECT id FROM user_profile WHERE code='MESERO')",
    [perm],
  );
  try {
    await fn();
  } finally {
    await t.sql.query(
      "INSERT INTO profile_permission (profile_id, permission_code, store_id) SELECT id, $1, store_id FROM user_profile WHERE code='MESERO' ON CONFLICT DO NOTHING",
      [perm],
    );
  }
}
const outbox = async (orderId: string) =>
  (
    await t.sql.query("SELECT count(*)::int n FROM sync_outbox WHERE entity='order' AND entity_id=$1", [
      orderId,
    ])
  ).rows[0].n as number;
const holderOf = async (orderId: string) =>
  (await t.sql.query("SELECT holder_user_name FROM orders WHERE id=$1", [orderId])).rows[0].holder_user_name;

describe("POST /orders/{id}/save · Guardar y salir", () => {
  it("envía lo por enviar, imprime después y suelta la mesa; la mesa sigue abierta", async () => {
    const o = await newOrder([PLU.tosta, PLU.croquetas]);
    await t.call("POST", `/orders/${o.id}/presence`, { token: sis, body: { action: "enter" } });
    expect(await holderOf(o.id)).toBe("Sistemas");
    const v = (await get(o.id)).version;
    const jobs = t.printer.jobs.length;
    const box = await outbox(o.id);
    const r = await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: { version: v } });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body).toMatchObject({ released: false, sent: 2, version: v + 1 });
    expect(r.body.order.status).toBe("open");
    expect(r.body.order.version).toBe(v + 1);
    expect(r.body.order.accounts[0].lines.map((l: any) => l.status)).toEqual(["printed", "printed"]);
    expect(t.printer.jobs.slice(jobs).some((j) => j.kind === "kitchen")).toBe(true);
    expect(await holderOf(o.id)).toBeNull();
    expect(await outbox(o.id)).toBe(box + 1);
    const { rows } = await t.sql.query("SELECT type FROM order_event WHERE order_id=$1 ORDER BY at", [o.id]);
    expect(rows.map((x) => x.type)).toContain("linePrinted");
  });

  it("sin nada nuevo: no sube la versión ni va a la cola, pero suelta la mesa", async () => {
    const o = await newOrder();
    await t.call("POST", `/orders/${o.id}/send`, { token: sis, body: {} });
    await t.call("POST", `/orders/${o.id}/presence`, { token: sis, body: { action: "enter" } });
    const v = (await get(o.id)).version;
    const box = await outbox(o.id);
    const r = await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: {} });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ released: false, sent: 0, version: v });
    expect(await outbox(o.id)).toBe(box);
    expect(await holderOf(o.id)).toBeNull();
  });

  it("mesa sin nada vivo: la cierra sin venta (cancelled) y queda libre", async () => {
    const o = await newOrder([]);
    await t.call("POST", `/orders/${o.id}/presence`, { token: sis, body: { action: "enter" } });
    const r = await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: {} });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body).toMatchObject({ released: true, sent: 0 });
    expect(r.body.order.status).toBe("cancelled");
    const {
      rows: [row],
    } = await t.sql.query("SELECT status, closed_at, holder_user_id FROM orders WHERE id=$1", [o.id]);
    expect(row.status).toBe("cancelled");
    expect(row.closed_at).not.toBeNull();
    expect(row.holder_user_id).toBeNull();
    const acc = await t.sql.query("SELECT status FROM account WHERE id=$1", [o.acc]);
    expect(acc.rows[0].status).toBe("cancelled");
    const tbl = (await t.call("GET", "/tables", { token: sis })).body.items.find(
      (x: any) => x.tableId === o.tableId,
    );
    expect(tbl.state).toBe("free");
    expect((await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: {} })).error.code).toBe(
      "ORDER_CLOSED",
    );
  });

  it("si otra persona tiene la mesa, quien solo guarda no se la cierra ni se la quita", async () => {
    const o = await newOrder([]);
    await t.call("POST", `/orders/${o.id}/presence`, { token: jeison, body: { action: "enter" } });
    const r = await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: {} });
    expect(r.status).toBe(200);
    expect(r.body.released).toBe(false);
    expect(await holderOf(o.id)).toBe("Jeison");
    await t.call("POST", `/orders/${o.id}/presence`, { token: jeison, body: { action: "leave" } });
  });

  it("impresora apagada → 503 PRINTER_OFFLINE, pero la mesa queda guardada y suelta", async () => {
    const o = await newOrder();
    await t.call("POST", `/orders/${o.id}/presence`, { token: sis, body: { action: "enter" } });
    const real = t.printer.print.bind(t.printer);
    t.printer.print = async (job) => (job.kind === "kitchen" ? { ok: false, error: "apagada" } : real(job));
    try {
      const r = await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: {} });
      expect([r.status, r.error.code]).toEqual([503, "PRINTER_OFFLINE"]);
    } finally {
      t.printer.print = real;
    }
    expect((await get(o.id)).accounts[0].lines[0].status).toBe("printed");
    expect(await holderOf(o.id)).toBeNull();
  });

  it("versión vieja → 409 VERSION_CONFLICT; cuerpo malo → 422; enviar sin pedido.enviar → 403", async () => {
    const o = await newOrder();
    const v = (await get(o.id)).version;
    const old = await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: { version: v - 1 } });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    const bad = await t.call("POST", `/orders/${o.id}/save`, { token: sis, body: { version: "x" } });
    expect([bad.status, bad.error.code]).toEqual([422, "VALIDATION"]);
    await withoutPermission("pedido.enviar", async () => {
      const no = await t.call("POST", `/orders/${o.id}/save`, { token: mesero, body: {} });
      expect([no.status, no.error.code, no.error.details.permission]).toEqual([
        403,
        "PERMISSION_REQUIRED",
        "pedido.enviar",
      ]);
    });
    expect((await get(o.id)).accounts[0].lines[0].status).toBe("pendingPrint");
  });
});

describe("POST /orders/{id}/transfer · scope", () => {
  /** Mesa con dos cuentas enviadas: Cuenta 1 (tosta) y Cuenta 2 (croquetas). */
  async function twoAccounts() {
    const o = await newOrder();
    const a2 = (await t.call("POST", `/orders/${o.id}/accounts`, { token: sis, body: {} })).body.accounts[1]
      .id;
    await t.call("POST", `/orders/${o.id}/lines`, {
      token: sis,
      body: { plu: PLU.croquetas, accountId: a2, force: true },
    });
    await t.call("POST", `/orders/${o.id}/send`, { token: sis, body: {} });
    return { ...o, a2: a2 as string };
  }

  it("scope=account: pasa la cuenta y responde solo la transacción de destino", async () => {
    const o = await twoAccounts();
    const v = (await get(o.id)).version;
    const dest = await freeTable(t, "TERRAZA");
    const r = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "account", accountId: o.a2, toTableId: dest, version: v },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body._id).not.toBe(o.id);
    expect(r.body.tableData.tableId).toBe(dest);
    expect(r.body.accounts.map((a: any) => a.id)).toEqual([o.a2]);
    const src = await get(o.id);
    expect(src.accounts.map((a: any) => a.id)).toEqual([o.acc]);
    expect(src.version).toBe(v + 1);
  });

  it("scope=table (o sin scope): la mesa entera, como siempre", async () => {
    const o = await newOrder();
    const dest = await freeTable(t, "TERRAZA");
    const r = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "table", toTableId: dest },
    });
    expect(r.status).toBe(200);
    expect(r.body._id).toBe(o.id);
    expect(r.body.tableData.tableId).toBe(dest);
  });

  it("scope=account sin accountId o sin versión → 422; scope desconocido → 422; versión vieja → 409", async () => {
    const o = await twoAccounts();
    const v = (await get(o.id)).version;
    const dest = await freeTable(t, "BARRA");
    const noAcc = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "account", toTableId: dest, version: v },
    });
    expect([noAcc.status, noAcc.error.code, noAcc.error.field]).toEqual([422, "VALIDATION", "accountId"]);
    const noV = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "account", accountId: o.a2, toTableId: dest },
    });
    expect([noV.status, noV.error.field]).toEqual([422, "version"]);
    const bad = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "mesa", toTableId: dest },
    });
    expect([bad.status, bad.error.code]).toEqual([422, "VALIDATION"]);
    const old = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "account", accountId: o.a2, toTableId: dest, version: v - 1 },
    });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
  });

  it("sin mesas.transferir → 403; misma Idempotency-Key → un solo traspaso", async () => {
    const o = await twoAccounts();
    const dest = await freeTable(t, "BARRA");
    const body = { scope: "account", accountId: o.a2, toTableId: dest, version: (await get(o.id)).version };
    await withoutPermission("mesas.transferir", async () => {
      const no = await t.call("POST", `/orders/${o.id}/transfer`, { token: mesero, body });
      expect([no.status, no.error.code, no.error.details.permission]).toEqual([
        403,
        "PERMISSION_REQUIRED",
        "mesas.transferir",
      ]);
    });
    const h = { "idempotency-key": crypto.randomUUID() };
    const a = await t.call("POST", `/orders/${o.id}/transfer`, { token: sis, body, headers: h });
    const b = await t.call("POST", `/orders/${o.id}/transfer`, { token: sis, body, headers: h });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.body._id).toBe(a.body._id);
    const { rows } = await t.sql.query(
      "SELECT count(*)::int n FROM orders WHERE table_id = $1 AND status IN ('open','billing')",
      [dest],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("POST /orders/{id}/reopen · Reabrir mesa", () => {
  it("una mesa cerrada sin venta vuelve a abrirse con su cuenta, sube versión, evento y cola", async () => {
    const o = await newOrder([]);
    const closed = await t.call("POST", `/orders/${o.id}/close`, { token: sis, body: {} });
    expect(closed.body.status).toBe("cancelled");
    const box = await outbox(o.id);
    const r = await t.call("POST", `/orders/${o.id}/reopen`, { token: sis, body: {} });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.status).toBe("open");
    expect(r.body.version).toBe(closed.body.version + 1);
    expect(r.body.accounts.map((a: any) => [a.id, a.status])).toEqual([[o.acc, "open"]]);
    expect(r.body.events.map((e: any) => e.description)).toContain("Mesa reabierta");
    const {
      rows: [row],
    } = await t.sql.query("SELECT status, closed_at, version FROM orders WHERE id=$1", [o.id]);
    expect(row).toMatchObject({ status: "open", closed_at: null, version: r.body.version });
    const acc = await t.sql.query("SELECT status, closed_by_user_name FROM account WHERE id=$1", [o.acc]);
    expect(acc.rows[0]).toEqual({ status: "open", closed_by_user_name: null });
    expect(await outbox(o.id)).toBe(box + 1);
    // y se sigue vendiendo en ella
    expect(
      (await t.call("POST", `/orders/${o.id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } }))
        .status,
    ).toBe(201);
  });

  it("cerrada con una cuenta facturada y otra anulada: reabre la anulada; la facturada sigue igual", async () => {
    const o = await newOrder();
    const a2 = (await t.call("POST", `/orders/${o.id}/accounts`, { token: sis, body: {} })).body.accounts[1]
      .id;
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, {
      token: sis,
      body: { method: "card", amount: null },
    });
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/invoice`, { token: sis, body: {} });
    const closed = await t.call("POST", `/orders/${o.id}/close`, { token: sis, body: {} });
    expect(closed.body.status).toBe("closed");
    const r = await t.call("POST", `/orders/${o.id}/reopen`, { token: sis, body: {} });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.status).toBe("open");
    expect(r.body.accounts.map((a: any) => [a.id, a.status])).toEqual([
      [o.acc, "invoiced"],
      [a2, "open"],
    ]);
  });

  it("todas facturadas → 409 ACCOUNT_CLOSED; mesa ocupada → 409 TABLE_BUSY; otro periodo → 409 PERIOD_CLOSED", async () => {
    const inv = await newOrder();
    await t.call("POST", `/orders/${inv.id}/accounts/${inv.acc}/payments`, {
      token: sis,
      body: { method: "card", amount: null },
    });
    await t.call("POST", `/orders/${inv.id}/accounts/${inv.acc}/invoice`, { token: sis, body: {} });
    const all = await t.call("POST", `/orders/${inv.id}/reopen`, { token: sis, body: {} });
    expect([all.status, all.error.code]).toEqual([409, "ACCOUNT_CLOSED"]);

    const o = await newOrder([]);
    await t.call("POST", `/orders/${o.id}/close`, { token: sis, body: {} });
    const other = await t.call("POST", "/orders", { token: sis, body: { tableId: o.tableId, guests: 1 } });
    expect(other.status).toBe(201);
    const busy = await t.call("POST", `/orders/${o.id}/reopen`, { token: sis, body: {} });
    expect([busy.status, busy.error.code]).toEqual([409, "TABLE_BUSY"]);
    const open = await t.call("POST", `/orders/${other.body._id}/reopen`, { token: sis, body: {} });
    expect([open.status, open.error.code]).toEqual([409, "TABLE_BUSY"]);

    const p = await newOrder([]);
    await t.call("POST", `/orders/${p.id}/close`, { token: sis, body: {} });
    await t.sql.query("UPDATE orders SET period_id = NULL WHERE id=$1", [p.id]);
    const per = await t.call("POST", `/orders/${p.id}/reopen`, { token: sis, body: {} });
    expect([per.status, per.error.code]).toEqual([409, "PERIOD_CLOSED"]);
  });

  it("sin cobro.reabrir → 403; con clave de encargado sí; cuerpo malo → 422; no existe → 404", async () => {
    const o = await newOrder([]);
    await t.call("POST", `/orders/${o.id}/close`, { token: sis, body: {} });
    const no = await t.call("POST", `/orders/${o.id}/reopen`, { token: mesero, body: {} });
    expect([no.status, no.error.code, no.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "cobro.reabrir",
    ]);
    const bad = await t.call("POST", `/orders/${o.id}/reopen`, { token: sis, body: { authorization: 5 } });
    expect([bad.status, bad.error.code]).toEqual([422, "VALIDATION"]);
    const missing = await t.call("POST", `/orders/${crypto.randomUUID()}/reopen`, { token: sis, body: {} });
    expect(missing.status).toBe(404);
    const auth = (
      await t.call("POST", "/sessions/authorize", {
        token: mesero,
        body: { pin: PIN.sistemas, permission: "cobro.reabrir" },
      })
    ).body.authorization.token;
    const ok = await t.call("POST", `/orders/${o.id}/reopen`, {
      token: mesero,
      body: { authorization: auth },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
  });
});

describe("PATCH /orders/{id}/accounts/{accountId} · Renombrar cuenta", () => {
  it("cambia el nombre, sube la versión y queda en el historial", async () => {
    const o = await newOrder();
    const v = (await get(o.id)).version;
    const r = await t.call("PATCH", `/orders/${o.id}/accounts/${o.acc}`, {
      token: sis,
      body: { name: "  Ana  ", version: v },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.version).toBe(v + 1);
    expect(r.body.accounts[0].name).toBe("Ana");
    expect(r.body.events.map((e: any) => e.description)).toContain("Cuenta 1 pasa a llamarse Ana");
    const { rows } = await t.sql.query("SELECT name FROM account WHERE id=$1", [o.acc]);
    expect(rows[0].name).toBe("Ana");
  });

  it("repetido en la mesa → 409 DUPLICATE; facturada → 409 ACCOUNT_CLOSED; versión vieja → 409; vacío → 422", async () => {
    const o = await newOrder();
    const a2 = (await t.call("POST", `/orders/${o.id}/accounts`, { token: sis, body: { name: "Luis" } })).body
      .accounts[1].id;
    const dup = await t.call("PATCH", `/orders/${o.id}/accounts/${o.acc}`, {
      token: sis,
      body: { name: "luis" },
    });
    expect([dup.status, dup.error.code, dup.error.field]).toEqual([409, "DUPLICATE", "name"]);
    const v = (await get(o.id)).version;
    const old = await t.call("PATCH", `/orders/${o.id}/accounts/${a2}`, {
      token: sis,
      body: { name: "Pepe", version: v - 1 },
    });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    for (const body of [{ name: "   " }, {}, { name: "x".repeat(41) }]) {
      const bad = await t.call("PATCH", `/orders/${o.id}/accounts/${a2}`, { token: sis, body });
      expect([bad.status, bad.error.code]).toEqual([422, "VALIDATION"]);
    }
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, {
      token: sis,
      body: { method: "card", amount: null },
    });
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/invoice`, { token: sis, body: {} });
    const inv = await t.call("PATCH", `/orders/${o.id}/accounts/${o.acc}`, {
      token: sis,
      body: { name: "Otra" },
    });
    expect([inv.status, inv.error.code]).toEqual([409, "ACCOUNT_CLOSED"]);
  });

  it("sin pedido.cuentas → 403 PERMISSION_REQUIRED", async () => {
    const o = await newOrder();
    await withoutPermission("pedido.cuentas", async () => {
      const no = await t.call("PATCH", `/orders/${o.id}/accounts/${o.acc}`, {
        token: mesero,
        body: { name: "Ana" },
      });
      expect([no.status, no.error.code, no.error.details.permission]).toEqual([
        403,
        "PERMISSION_REQUIRED",
        "pedido.cuentas",
      ]);
    });
  });
});

describe("POST /orders/{id}/accounts/{accountId}/checkout · Cobrar y facturar", () => {
  const url = (o: { id: string; acc: string }) => `/orders/${o.id}/accounts/${o.acc}/checkout`;
  const counts = async (acc: string) =>
    (
      await t.sql.query(
        `SELECT (SELECT count(*)::int FROM payment WHERE account_id=$1) p,
                (SELECT count(*)::int FROM invoice WHERE account_id=$1) i,
                (SELECT count(*)::int FROM verifactu_record v JOIN invoice f ON f.id = v.invoice_id WHERE f.account_id=$1) v`,
        [acc],
      )
    ).rows[0] as { p: number; i: number; v: number };

  it("efectivo + tarjeta: dos cobros, factura F2 encadenada, cambio, mesa cerrada e impresa", async () => {
    const o = await newOrder([PLU.tosta, PLU.croquetas]);
    const before = await get(o.id);
    const total = before.accounts[0].totals.total as number;
    const jobs = t.printer.jobs.length;
    const r = await t.call("POST", url(o), {
      token: sis,
      body: {
        payments: [
          { method: "cash", amount: 5, cashGiven: 10 },
          { method: "card", amount: null },
        ],
        print: true,
        version: before.version,
      },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body.invoice).toMatchObject({ type: "F2", total });
    expect(r.body.payments.map((p: any) => [p.method, p.amount, p.change])).toEqual([
      ["cash", 5, 5],
      ["card", Math.round((total - 5) * 100) / 100, null],
    ]);
    expect(r.body).toMatchObject({ change: 5, tableClosed: true, printed: true });
    expect(t.printer.jobs.slice(jobs).map((j) => j.kind)).toContain("invoice");
    expect(await counts(o.acc)).toEqual({ p: 2, i: 1, v: 1 });
    const after = await get(o.id);
    expect(after.status).toBe("closed");
    expect(after.version).toBe(before.version + 1);
    expect(after.accounts[0]).toMatchObject({ status: "invoiced", totals: { pending: 0 } });
    const ev = after.events.map((e: any) => e.type);
    expect(ev.filter((x: string) => x === "paymentAdded")).toHaveLength(2);
    expect(ev).toContain("invoiceIssued");
  });

  it("los pagos no dejan 0 → 409 PENDING_NOT_ZERO y no queda ningún pago ni factura", async () => {
    const o = await newOrder();
    const r = await t.call("POST", url(o), {
      token: sis,
      body: { payments: [{ method: "card", amount: 1 }] },
    });
    expect([r.status, r.error.code]).toEqual([409, "PENDING_NOT_ZERO"]);
    expect(await counts(o.acc)).toEqual({ p: 0, i: 0, v: 0 });
    // el error de una fila lleva su campo
    const bad = await t.call("POST", url(o), {
      token: sis,
      body: { payments: [{ method: "card", amount: 1 }, { method: "nope" }] },
    });
    expect([bad.status, bad.error.code, bad.error.field]).toEqual([
      409,
      "METHOD_NOT_ALLOWED",
      "payments[1].method",
    ]);
    expect(await counts(o.acc)).toEqual({ p: 0, i: 0, v: 0 });
  });

  it("ya pagada con cobros parciales: payments vacío factura; print false no imprime", async () => {
    const o = await newOrder();
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, {
      token: sis,
      body: { method: "card", amount: null },
    });
    const jobs = t.printer.jobs.length;
    const r = await t.call("POST", url(o), { token: sis, body: { payments: [], print: false } });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body).toMatchObject({ payments: [], tableClosed: true, printed: false });
    expect(t.printer.jobs.length).toBe(jobs);
    expect(await counts(o.acc)).toEqual({ p: 1, i: 1, v: 1 });
  });

  it("impresora apagada: la factura queda y printed = false", async () => {
    const o = await newOrder();
    const real = t.printer.print.bind(t.printer);
    t.printer.print = async (job) => (job.kind === "invoice" ? { ok: false, error: "apagada" } : real(job));
    try {
      const r = await t.call("POST", url(o), { token: sis, body: { payments: [{ method: "card" }] } });
      expect(r.status).toBe(201);
      expect(r.body.printed).toBe(false);
    } finally {
      t.printer.print = real;
    }
    expect((await counts(o.acc)).i).toBe(1);
  });

  it("versión vieja → 409; cuerpo malo → 422; sin cobro.cobrar → 403; facturada → 409", async () => {
    const o = await newOrder();
    const v = (await get(o.id)).version;
    const old = await t.call("POST", url(o), {
      token: sis,
      body: { payments: [{ method: "card" }], version: v - 1 },
    });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    for (const body of [
      { payments: [{ method: "" }] },
      { payments: [{ method: "card", amount: -1 }] },
      { foo: 1 },
    ]) {
      const bad = await t.call("POST", url(o), { token: sis, body });
      expect([bad.status, bad.error.code]).toEqual([422, "VALIDATION"]);
    }
    const no = await t.call("POST", url(o), { token: mesero, body: { payments: [{ method: "card" }] } });
    expect([no.status, no.error.code, no.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "cobro.cobrar",
    ]);
    expect(await counts(o.acc)).toEqual({ p: 0, i: 0, v: 0 });
    expect(
      (await t.call("POST", url(o), { token: sis, body: { payments: [{ method: "card" }] } })).status,
    ).toBe(201);
    // la mesa se cerró con su última cuenta
    const again = await t.call("POST", url(o), { token: sis, body: { payments: [] } });
    expect([again.status, again.error.code]).toEqual([409, "ORDER_CLOSED"]);
    // con otra cuenta viva, la facturada → ACCOUNT_CLOSED
    const two = await newOrder();
    await t.call("POST", `/orders/${two.id}/accounts`, { token: sis, body: {} });
    await t.call("POST", url(two), { token: sis, body: { payments: [{ method: "card" }] } });
    const closed = await t.call("POST", url(two), { token: sis, body: { payments: [] } });
    expect([closed.status, closed.error.code]).toEqual([409, "ACCOUNT_CLOSED"]);
  });

  it("misma Idempotency-Key → la misma factura, un solo cobro", async () => {
    const o = await newOrder();
    const h = { "idempotency-key": crypto.randomUUID() };
    const body = { payments: [{ method: "card", amount: null }] };
    const a = await t.call("POST", url(o), { token: sis, body, headers: h });
    const b = await t.call("POST", url(o), { token: sis, body, headers: h });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.body.invoice.invoiceNumber).toBe(a.body.invoice.invoiceNumber);
    expect(await counts(o.acc)).toEqual({ p: 1, i: 1, v: 1 });
  });
});

describe("GET /customers · Buscar cliente", () => {
  beforeAll(async () => {
    const add = (taxId: string, name: string, active = true) =>
      t.sql.query(
        "INSERT INTO customer_ref (id, store_id, type, tax_id, name, active) VALUES ($1,$2,'company',$3,$4,$5) ON CONFLICT DO NOTHING",
        [crypto.randomUUID(), storeId, taxId, name, active],
      );
    await add("B02891075", "DAILY FOOD VENTURES S.L.");
    await add("B99999999", "Daily Baja SL", false);
    for (let i = 0; i < 25; i++) {
      await add(`Z${String(i).padStart(8, "0")}`, `Cliente Lote ${String(i).padStart(2, "0")}`);
    }
  });

  it("por NIF o por nombre (sin mayúsculas), solo activos, con su dirección", async () => {
    const byNif = await t.call("GET", "/customers?q=b0289", { token: sis });
    expect(byNif.status).toBe(200);
    expect(byNif.body.items).toEqual([
      expect.objectContaining({
        type: "company",
        taxId: "B02891075",
        name: "DAILY FOOD VENTURES S.L.",
        email: null,
        phone: null,
        address: expect.objectContaining({ country: "ES" }),
      }),
    ]);
    const byName = await t.call("GET", "/customers?q=daily", { token: sis });
    expect(byName.body.items.map((c: any) => c.taxId)).toEqual(["B02891075"]);
    const wild = await t.call("GET", `/customers?q=${encodeURIComponent("%%")}`, { token: sis });
    expect(wild.body.items).toEqual([]);
  });

  it("como mucho 20", async () => {
    const r = await t.call("GET", "/customers?q=Cliente%20Lote", { token: sis });
    expect(r.body.items).toHaveLength(20);
    expect(r.body.items[0].name).toBe("Cliente Lote 00");
  });

  it("menos de 2 caracteres → 422; sin cobro.clientes → 403", async () => {
    for (const q of ["", "?q=a", "?q=%20%20b"]) {
      const r = await t.call("GET", `/customers${q}`, { token: sis });
      expect([r.status, r.error.code, r.error.field]).toEqual([422, "VALIDATION", "q"]);
    }
    const no = await t.call("GET", "/customers?q=daily", { token: mesero });
    expect([no.status, no.error.code, no.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "cobro.clientes",
    ]);
  });
});
