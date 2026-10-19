import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";
import { safeUrl } from "../src/Helpers/LogHelper.js";
import { pgRetryable } from "../src/Helpers/ErrorsFilter.js";

/**
 * Arreglos de la revisión independiente (19/10/2026): bloqueo de PIN de claim-main, alta de equipos sin la principal,
 * tokens fuera de los logs, reimpresión de abonos, orden de bloqueos (sin interbloqueos) y BUSY_RETRY, requestId de
 * Order on Table, QR al cambiar de mesa y WebSocket al salir o caducar la sesión.
 */
const KEY = "clave-oot-de-revision-0123456789abcdef";
let t: T;
let sistemas: string;
let storeId: string;

const one = async (q: string, p: unknown[] = []) => (await t.sql.query(q, p)).rows[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  t = await setup({ ootIntegrationKey: KEY });
  sistemas = await t.login(PIN.sistemas);
  await ensurePeriod(t, sistemas);
  storeId = (await one("SELECT id::text FROM store WHERE code = 'CT 03'")).id;
});
afterAll(async () => {
  await t.sql.query("UPDATE pin_attempt SET failures = 0, locked_until = NULL");
  await t.sql.query(
    "UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL",
  );
  await t.close();
});

/** Mesa abierta por Sistemas con una tosta enviada. */
async function openTable(token = sistemas) {
  const o = await t.call("POST", "/orders", {
    token,
    body: { tableId: await freeTable(t, "BARRA"), guests: 2 },
  });
  expect(o.status, JSON.stringify(o.env)).toBe(201);
  const l = await t.call("POST", `/orders/${o.body._id}/lines`, {
    token,
    body: { plu: PLU.tosta, force: true },
  });
  await t.call("POST", `/orders/${o.body._id}/send`, { token, body: {} });
  return { orderId: o.body._id as string, acc: o.body.accounts[0].id as string, total: l.body };
}

describe("claim-main: bloqueo de PIN por tienda", () => {
  const claimKey = () => `claim-main:${storeId}`;
  beforeEach(async () => {
    await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim-main:%'");
  });

  it("cambiar de UUID en cada intento no sirve: a los 3 fallos 423 PIN_LOCKED, también con la clave buena", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await t.call("POST", "/devices/claim-main", {
        body: { deviceUuid: crypto.randomUUID(), pin: "9999" },
      });
      expect([r.status, r.error.code]).toEqual([401, "BAD_PIN"]);
    }
    expect(
      (await one("SELECT locked_until FROM pin_attempt WHERE key = $1", [claimKey()])).locked_until,
    ).toBeTruthy();
    const r = await t.call("POST", "/devices/claim-main", {
      body: { deviceUuid: crypto.randomUUID(), pin: PIN.sistemas },
    });
    expect([r.status, r.error.code]).toEqual([423, "PIN_LOCKED"]);
    expect(r.error.details.retryAfter).toBeGreaterThan(0);
  });

  it("clave de alguien sin ajustes.estaciones → 401 BAD_PIN sin su nombre, y cuenta como fallo en las dos claves", async () => {
    const uuid = crypto.randomUUID();
    const r = await t.call("POST", "/devices/claim-main", { body: { deviceUuid: uuid, pin: PIN.mesero } });
    expect([r.status, r.error.code]).toEqual([401, "BAD_PIN"]);
    expect(r.error.message).toBe("Clave incorrecta");
    expect(r.error.details.attemptsLeft).toBe(2);
    expect((await one("SELECT failures FROM pin_attempt WHERE key = $1", [claimKey()])).failures).toBe(1);
    expect((await one("SELECT failures FROM pin_attempt WHERE key = $1", [`device:${uuid}`])).failures).toBe(
      1,
    );
  });
});

describe("POST /devices/register no da nunca la caja principal", () => {
  it("con la principal sin equipo y ninguna otra libre → 404; con otra libre, esa", async () => {
    const main = await one("SELECT id::text, device_uuid FROM station WHERE is_main");
    const extra = crypto.randomUUID();
    try {
      await t.sql.query("UPDATE station SET device_uuid = NULL WHERE id = $1", [main.id]);
      const uuid = `rev-reg-${crypto.randomUUID().slice(0, 8)}`;
      const r = await t.call("POST", "/devices/register", { body: { deviceUuid: uuid, kind: "desktop" } });
      expect([r.status, r.error?.code]).toEqual([404, "NOT_FOUND"]);
      expect((await one("SELECT device_uuid FROM station WHERE id = $1", [main.id])).device_uuid).toBeNull();
      await t.sql.query(
        "INSERT INTO station (id, store_id, name, kind) VALUES ($1, $2, 'CAJA-REV', 'station')",
        [extra, storeId],
      );
      const ok = await t.call("POST", "/devices/register", { body: { deviceUuid: uuid, kind: "desktop" } });
      expect([ok.status, ok.body.stationId, ok.body.name]).toEqual([201, extra, "CAJA-REV"]);
      expect((await one("SELECT device_uuid FROM station WHERE id = $1", [main.id])).device_uuid).toBeNull();
    } finally {
      await t.sql.query("DELETE FROM station WHERE id = $1", [extra]);
      await t.sql.query("UPDATE station SET device_uuid = $2 WHERE id = $1", [main.id, main.device_uuid]);
    }
  });
});

describe("tokens fuera de los logs", () => {
  it("safeUrl quita la query y tapa el token del QR", () => {
    expect(safeUrl("/api/v2/ws?token=abc.def.ghi")).toBe("/api/v2/ws");
    expect(safeUrl("/api/v2/oot/oot_9f8e7d6c5b4a/lines?x=1")).toBe("/api/v2/oot/oot_***/lines");
    expect(safeUrl("/api/v2/oot/oot_abc")).toBe("/api/v2/oot/oot_***");
    expect(safeUrl("/api/v2/orders/123/oot")).toBe("/api/v2/orders/123/oot");
    expect(safeUrl("/api/v2/tables#frag")).toBe("/api/v2/tables");
    expect(safeUrl(undefined)).toBe("");
  });
});

describe("reimprimir un abono", () => {
  it("sale el ticket de la rectificativa, sin cajón, y el evento nombra el abono", async () => {
    const o = await openTable();
    const total = o.total.accounts[0].totals.total as number;
    await t.call("POST", `/orders/${o.orderId}/accounts/${o.acc}/payments`, {
      token: sistemas,
      body: { method: "cash", amount: total, cashGiven: total },
    });
    const inv = await t.call("POST", `/orders/${o.orderId}/accounts/${o.acc}/invoice`, { token: sistemas });
    expect(inv.status, JSON.stringify(inv.env)).toBe(201);
    const orig = await one("SELECT id::text, invoice_number FROM invoice WHERE account_id = $1", [o.acc]);
    const c = await t.call("POST", `/invoices/${orig.id}/credit`, {
      token: sistemas,
      body: { reason: "Error de cobro", print: false },
    });
    expect(c.status, JSON.stringify(c.env)).toBe(201);
    t.printer.jobs.length = 0;
    // la original sí abre el cajón (hubo efectivo); el abono no
    const ro = await t.call("POST", `/invoices/${orig.id}/reprint`, { token: sistemas });
    expect(ro.body).toEqual({ printed: true });
    expect(t.printer.jobs[0]!.openDrawer).toBe(true);
    t.printer.jobs.length = 0;
    const r = await t.call("POST", `/invoices/${c.body.id}/reprint`, { token: sistemas });
    expect([r.status, r.body]).toEqual([200, { printed: true }]);
    expect(t.printer.jobs).toHaveLength(1);
    const job = t.printer.jobs[0]!;
    expect(job.title).toBe(c.body.invoiceNumber);
    expect(job.openDrawer).toBeFalsy();
    expect(job.text).toContain("FACTURA RECTIFICATIVA");
    expect(job.text).toContain(`Rectifica a: ${orig.invoice_number}`);
    expect(job.text).toContain("Error de cobro");
    const ev = await one(
      "SELECT description FROM order_event WHERE order_id = $1 AND type = 'invoiceReprinted' ORDER BY at DESC LIMIT 1",
      [o.orderId],
    );
    expect(ev.description).toBe(`Reimpresión del abono ${c.body.invoiceNumber}`);
  });
});

describe("orden de bloqueos y BUSY_RETRY", () => {
  it("transferir la mesa bloquea la de destino antes que la orden (sin interbloqueo con quien bloquea mesa → orden)", async () => {
    const o = await openTable();
    const to = await freeTable(t, "BARRA");
    const v = (await t.call("GET", `/orders/${o.orderId}`, { token: sistemas })).body.version;
    // otro proceso con el orden de abrir mesa: primero la mesa de destino y luego la orden
    await t.sql.query("BEGIN");
    await t.sql.query("SET LOCAL deadlock_timeout = '10s'");
    await t.sql.query("SELECT 1 FROM dining_table WHERE id = $1 FOR UPDATE", [to]);
    const call = t.call("POST", `/orders/${o.orderId}/transfer`, {
      token: sistemas,
      body: { scope: "table", toTableId: to, version: v },
    });
    await sleep(300);
    await t.sql.query("SELECT 1 FROM orders WHERE id = $1 FOR UPDATE", [o.orderId]);
    await t.sql.query("COMMIT");
    const r = await call;
    expect([r.status, r.error?.code ?? null]).toEqual([200, null]);
    expect((await one("SELECT table_id::text FROM orders WHERE id = $1", [o.orderId])).table_id).toBe(to);
  });

  it("un interbloqueo en la base → 409 BUSY_RETRY (no 500) y no queda nada a medias", async () => {
    const o = await openTable();
    const to = await freeTable(t, "BARRA");
    const v = (await t.call("GET", `/orders/${o.orderId}`, { token: sistemas })).body.version;
    // pasar una cuenta: la API bloquea la mesa de destino y luego la orden; aquí, al revés, para forzar el interbloqueo
    await t.sql.query("BEGIN");
    await t.sql.query("SET LOCAL deadlock_timeout = '10s'");
    await t.sql.query("SELECT 1 FROM orders WHERE id = $1 FOR UPDATE", [o.orderId]);
    const call = t.call("POST", `/orders/${o.orderId}/accounts/${o.acc}/transfer`, {
      token: sistemas,
      body: { toTableId: to, version: v },
    });
    await sleep(300);
    await t.sql.query("SELECT 1 FROM dining_table WHERE id = $1 FOR UPDATE", [to]);
    await t.sql.query("COMMIT");
    const r = await call;
    expect([r.status, r.error.code]).toEqual([409, "BUSY_RETRY"]);
    expect(r.error.message).toBe("Otro equipo está cambiando lo mismo: vuelve a intentarlo");
    expect((await one("SELECT version FROM orders WHERE id = $1", [o.orderId])).version).toBe(v);
    // repetirlo funciona
    const again = await t.call("POST", `/orders/${o.orderId}/accounts/${o.acc}/transfer`, {
      token: sistemas,
      body: { toTableId: to, version: v },
    });
    expect(again.status, JSON.stringify(again.env)).toBe(200);
  });

  it("pgRetryable: 40P01 y 40001 (también envueltos en cause); el resto no", () => {
    expect(pgRetryable({ code: "40P01" })).toBe(true);
    expect(pgRetryable(new Error("x", { cause: { code: "40001" } }))).toBe(true);
    expect(pgRetryable({ code: "23505" })).toBe(false);
    expect(pgRetryable(null)).toBe(false);
  });

  it("alta de producto desde Ajustes: bloqueo de carta antes que el de PLU (sin interbloqueo con el sync de carta)", async () => {
    const cat = await one("SELECT id::text FROM category WHERE store_id = $1 AND active LIMIT 1", [storeId]);
    // lo que hace el sync: carta → (PLU) → filas de la carta FOR UPDATE
    await t.sql.query("BEGIN");
    await t.sql.query("SET LOCAL deadlock_timeout = '10s'");
    await t.sql.query("SELECT pg_advisory_xact_lock(hashtext('carta:' || $1::text))", [storeId]);
    await t.sql.query("SELECT 1 FROM category WHERE id = $1 FOR UPDATE", [cat.id]);
    const call = t.call("POST", "/config/productos", {
      token: sistemas,
      body: { name: "REVISION BLOQUEO", price: 1, taxRate: 10, categoryId: cat.id },
    });
    await sleep(300);
    await t.sql.query("SELECT pg_advisory_xact_lock(hashtext('plu:' || $1::text))", [storeId]);
    await t.sql.query("COMMIT");
    const r = await call;
    expect([r.status, r.error?.code ?? null]).toEqual([201, null]);
    // se desactiva para no cambiar la carta de las demás pruebas
    await t.call("POST", `/config/productos/${r.body.id}/deactivate`, { token: sistemas, body: {} });
  });
});

describe("Order on Table", () => {
  beforeAll(async () => {
    await t.sql.query("UPDATE store SET web_order_url = 'https://pedir.example.com/' WHERE id = $1", [
      storeId,
    ]);
  });
  afterAll(async () => {
    await t.sql.query("UPDATE store SET web_order_url = NULL WHERE id = $1", [storeId]);
  });
  const ext = (method: string, url: string, body?: unknown) =>
    t.call(method, url, { body, headers: { "x-integration-key": KEY } });

  it("el mismo requestId con otro pedido → 422 VALIDATION; con el mismo, la misma respuesta", async () => {
    const o = await openTable();
    const qr = await t.call("POST", `/orders/${o.orderId}/oot`, { token: sistemas, body: {} });
    expect(qr.status, JSON.stringify(qr.env)).toBeLessThan(300);
    const url = `/oot/${qr.body.token}/lines`;
    const first = await ext("POST", url, { items: [{ plu: PLU.croquetas }], requestId: "rev-1" });
    expect(first.status, JSON.stringify(first.env)).toBe(201);
    const same = await ext("POST", url, { items: [{ plu: PLU.croquetas }], requestId: "rev-1" });
    expect(same.body.accountId).toBe(first.body.accountId);
    const other = await ext("POST", url, { items: [{ plu: PLU.tosta, quantity: 3 }], requestId: "rev-1" });
    expect([other.status, other.error.code, other.error.message]).toEqual([
      422,
      "VALIDATION",
      "requestId ya usado con otro pedido",
    ]);
    const n = await one(
      "SELECT count(*)::int n FROM order_line WHERE order_id = $1 AND plu = $2 AND NOT deleted",
      [o.orderId, PLU.tosta],
    );
    expect(n.n).toBe(1);
  });

  it("cambiar la mesa entera anula el QR (revoked 'transferred') en la misma transacción", async () => {
    const o = await openTable();
    const qr = await t.call("POST", `/orders/${o.orderId}/oot`, { token: sistemas, body: {} });
    const to = await freeTable(t, "BARRA");
    const r = await t.call("POST", `/orders/${o.orderId}/transfer`, {
      token: sistemas,
      body: { scope: "table", toTableId: to },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    const tok = await one("SELECT revoked_at, revoked_reason FROM oot_token WHERE token = $1", [
      qr.body.token,
    ]);
    expect(tok.revoked_at).toBeTruthy();
    expect(tok.revoked_reason).toBe("transferred");
    const g = await ext("GET", `/oot/${qr.body.token}`);
    expect([g.status, g.error.code]).toEqual([404, "OOT_TOKEN_INVALID"]);
  });
});

describe("WebSocket: salir y caducar", () => {
  async function connect(token: string) {
    const f: any = t.app.getHttpAdapter().getInstance();
    const ws = await f.injectWS(`/api/v2/ws?token=${encodeURIComponent(token)}`);
    let closed: number | null = null;
    ws.on("close", (code: number) => {
      closed = code;
    });
    const until = async (ms: number) => {
      const end = Date.now() + ms;
      while (closed === null && Date.now() < end) {
        await sleep(20);
      }
      return closed;
    };
    return { ws, until, closedCode: () => closed };
  }

  it("DELETE /sessions/current cierra con 4001 los sockets de esa sesión", async () => {
    const tok = await t.login(PIN.barra);
    const c = await connect(tok);
    await sleep(150);
    expect(c.closedCode()).toBeNull();
    const out = await t.call("DELETE", "/sessions/current", { token: tok });
    expect(out.status).toBe(200);
    expect(await c.until(2000)).toBe(4001);
  });

  it("el socket se cierra con 4001 cuando caduca el token", async () => {
    const real = t.clock.now;
    // un token que caduca dentro de ~1,5 s: se firma con el reloj de la API 12 h atrás
    t.clock.now = new Date(Date.now() - 12 * 3600 * 1000 + 1500);
    let tok: string;
    try {
      tok = await t.login(PIN.jeison);
    } finally {
      t.clock.now = real;
    }
    const c = await connect(tok);
    await sleep(150);
    expect(c.closedCode()).toBeNull();
    expect(await c.until(4000)).toBe(4001);
  });
});
