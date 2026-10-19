import { gzipSync } from "node:zlib";
import { createFakeManager, type FakeManager } from "../src/index.js";

const KEY = "clave-de-pruebas";
const STORE = "11111111-1111-4111-8111-111111111111";
const URL = `/api/manager/v1/stores/${STORE}/transactions`;

function tx(id: string, version: number, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    storeId: STORE,
    status: "open",
    version,
    tableData: {},
    events: [],
    accounts: [],
    ...extra,
  };
}

function invoiced(id: string, version: number, total: number) {
  return tx(id, version, {
    status: "closed",
    accounts: [{ id: "a1", invoice: { series: "T03", sequence: 412, invoiceNumber: "T03-000412", total } }],
  });
}

describe("Manager de pruebas", () => {
  let fake: FakeManager;
  beforeEach(() => {
    fake = createFakeManager({ storeKey: KEY });
  });
  afterEach(async () => {
    await fake.close();
  });

  const send = (transactions: unknown[], key?: string, gzip = false) => {
    const json = JSON.stringify({ agent: { version: "test", sentAt: "2026-10-18T00:00:00Z" }, transactions });
    return fake.app.inject({
      method: "POST",
      url: URL,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
        ...(gzip ? { "content-encoding": "gzip" } : {}),
      },
      payload: gzip ? gzipSync(json) : json,
    });
  };
  const statuses = (res: { json(): any }) => res.json().data.results.map((r: any) => r.status);

  it("versión mayor = accepted, igual = duplicate, menor = stale, igual con otro contenido = conflict", async () => {
    expect(statuses(await send([tx("o1", 2)]))).toEqual(["accepted"]);
    expect(statuses(await send([tx("o1", 2)]))).toEqual(["duplicate"]);
    expect(statuses(await send([tx("o1", 1)]))).toEqual(["stale"]);
    expect(statuses(await send([tx("o1", 2, { note: "otra" })]))).toEqual(["conflict"]);
    expect(statuses(await send([tx("o1", 3)]))).toEqual(["accepted"]);
    expect(fake.store.get(STORE, "o1")?.version).toBe(3);
  });

  it("acepta gzip y responde con el sobre estándar", async () => {
    const res = await send([tx("o2", 1)], undefined, true);
    expect(res.statusCode).toBe(200);
    const env = res.json();
    expect(Object.keys(env).sort()).toEqual(
      ["author", "data", "errors", "mode", "status", "title", "traceId", "type"].sort(),
    );
    expect(env).toMatchObject({ type: "success", status: 200, errors: [] });
  });

  it("Idempotency-Key: misma clave y cuerpo → misma respuesta; otro cuerpo → 409 IDEMPOTENCY_MISMATCH", async () => {
    const a = await send([tx("o3", 1)], "k1");
    const b = await send([tx("o3", 1)], "k1");
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.json()).toEqual(a.json());
    expect(statuses(b)).toEqual(["accepted"]);
    const c = await send([tx("o3", 2)], "k1");
    expect(c.statusCode).toBe(409);
    expect(c.json().errors[0].code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("factura repetida con otro contenido → conflict; la misma factura en una versión nueva → accepted", async () => {
    expect(statuses(await send([invoiced("p1", 5, 10)]))).toEqual(["accepted"]);
    expect(statuses(await send([invoiced("p1", 6, 10)]))).toEqual(["accepted"]);
    expect(statuses(await send([invoiced("q1", 1, 99)]))).toEqual(["conflict"]);
    expect(fake.store.get(STORE, "q1")).toBeUndefined();
  });

  it("transacción mal formada → rejected; sin storeKey → 401; controles de caída", async () => {
    expect(statuses(await send([{ _id: "x", version: 0, accounts: [] }]))).toEqual(["rejected"]);
    const res = await fake.app.inject({ method: "POST", url: URL, payload: { transactions: [] } });
    expect(res.statusCode).toBe(401);
    fake.store.controls.fail.transactions = 503;
    expect((await send([tx("o4", 1)])).statusCode).toBe(503);
    fake.store.controls.fail.transactions = null;
    fake.store.controls.maxBatch = 1;
    expect((await send([tx("o4", 1), tx("o5", 1)])).statusCode).toBe(413);
  });

  it("conciliación: missing y outdated", async () => {
    await send([tx("r1", 3)]);
    const res = await fake.app.inject({
      method: "POST",
      url: `${URL}/reconcile`,
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        businessDate: "2026-10-18",
        periodId: null,
        items: [
          { orderId: "r1", version: 4 },
          { orderId: "r2", version: 1 },
        ],
      },
    });
    expect(res.json().data).toEqual({ missing: ["r2"], outdated: [{ orderId: "r1", managerVersion: 3 }] });
  });
});
