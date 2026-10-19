import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@japp/db";
import { sql } from "drizzle-orm";
import type { FakeManager } from "fake-manager";
import { inject } from "vitest";
import type { AppSettings } from "../src/Properties/AppSettings.js";
import {
  allSent,
  closePeriod,
  newPeriod,
  newStore,
  outboxRows,
  rows,
  saveOrder,
  startAgent,
  startFake,
  testSettings,
  waitFor,
  type RunningAgent,
} from "./helpers.js";

describe("sync-agent → Manager", () => {
  let db: Database;
  let fake: FakeManager;
  let url: string;
  let storeId: string;
  let agents: RunningAgent[] = [];

  const agent = async (over: Partial<AppSettings> = {}) => {
    const a = await startAgent(testSettings(url, storeId, over));
    agents.push(a);
    return a;
  };
  const history = (orderId: string) =>
    fake.store.history.filter((h) => h.storeId === storeId && h.orderId === orderId).map((h) => h.status);
  const managerVersion = (orderId: string) => fake.store.get(storeId, orderId)?.version;
  const txRequests = () => fake.store.requests.filter((r) => r.route === "transactions");

  beforeAll(() => {
    db = createDatabase(inject("dbUrl"), 3);
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    ({ fake, url } = await startFake());
    storeId = await newStore(db);
  });
  afterEach(async () => {
    for (const a of agents) {
      await a.stop();
    }
    agents = [];
    await fake.close();
  });

  it("(a) una mesa abierta y una cerrada llegan con su versión, al momento (LISTEN), y el latido informa", async () => {
    // Intervalo largo: solo el NOTIFY puede despertar al agente.
    await agent({ intervalMs: 60_000, heartbeatMs: 50 });
    const open = randomUUID();
    const closed = randomUUID();
    await saveOrder(db, storeId, open, { version: 2 });
    await saveOrder(db, storeId, closed, {
      version: 9,
      status: "closed",
      invoice: { series: "T03", sequence: 1, invoiceNumber: "T03-000001", total: 10 },
    });
    await waitFor(() => managerVersion(open) === 2 && managerVersion(closed) === 9, "las dos en el Manager");
    expect(fake.store.get(storeId, closed)?.transaction.status).toBe("closed");
    await waitFor(() => allSent(db, storeId), "avisos marcados como enviados");
    const [st] = await rows(
      db,
      sql`SELECT last_sent_at, last_sent_id FROM sync_state WHERE store_id = ${storeId}`,
    );
    expect(st?.last_sent_at).toBeTruthy();
    const hb = await waitFor(
      () =>
        fake.store.heartbeats.find(
          (h) => h.storeId === storeId && h.body.outboxPending === 0 && h.body.openTransactions === 1,
        ),
      "latido con la cola vacía",
    );
    expect(Object.keys(hb.body).sort()).toEqual(
      [
        "agentVersion",
        "lastError",
        "lastSentAt",
        "oldestPendingAt",
        "openTransactions",
        "outboxPending",
      ].sort(),
    );
    expect(hb.body.openTransactions).toBe(1);
    // El cuerpo llega comprimido y con la Idempotency-Key del contrato.
    expect(txRequests()[0]?.key).toMatch(new RegExp(`^tx-${storeId}-\\d+-\\d+$`));
  });

  it("(b) 50 avisos de la misma mesa → llega una sola vez con la última versión", async () => {
    // 1) 50 cambios que se juntaron con el agente parado (sin red): al arrancar va una sola foto, la v50.
    const offline = randomUUID();
    for (let v = 1; v <= 50; v++) {
      await saveOrder(db, storeId, offline, { version: v }, false);
    }
    // 2) Con el agente en marcha, una ráfaga de 50 cambios con su NOTIFY cada uno (trigger 0013):
    //    la espera de SYNC_DEBOUNCE_MS (2 s, el valor por defecto) los junta en un solo envío.
    const a = await agent({ intervalMs: 60_000, debounceMs: 2000 });
    await waitFor(() => managerVersion(offline) === 50, "la foto acumulada");
    await a.service.whenIdle();
    const burst = randomUUID();
    for (let v = 1; v <= 50; v++) {
      await saveOrder(db, storeId, burst, { version: v });
    }
    await waitFor(() => allSent(db, storeId), "los 100 avisos enviados");
    expect(history(offline)).toEqual(["accepted"]);
    expect(history(burst)).toEqual(["accepted"]);
    expect(managerVersion(burst)).toBe(50);
    expect((await outboxRows(db, storeId)).length).toBe(100);
  });

  it("(c) se pierde la respuesta tras guardar → el reenvío da duplicate y no hay duplicados", async () => {
    fake.store.controls.loseResponses = 1;
    await agent();
    const id = randomUUID();
    await saveOrder(db, storeId, id, { version: 3 });
    await waitFor(() => allSent(db, storeId), "aviso enviado tras el reenvío");
    expect(history(id)).toEqual(["accepted", "duplicate"]);
    expect(fake.store.list(storeId)).toHaveLength(1);
    // El reintento usó la misma clave del lote.
    const keys = txRequests().map((r) => r.key);
    expect(new Set(keys).size).toBe(1);
  });

  it("(d) una versión vieja que llega después → stale; el Manager se queda la más alta", async () => {
    await agent();
    const id = randomUUID();
    await saveOrder(db, storeId, id, { version: 6 });
    await waitFor(() => allSent(db, storeId), "v6 enviada");
    // Llega tarde una foto anterior (p. ej. de otro camino o de una copia restaurada).
    await saveOrder(db, storeId, id, { version: 4, note: "foto vieja" });
    await waitFor(() => allSent(db, storeId), "v4 tratada");
    expect(history(id)).toEqual(["accepted", "stale"]);
    expect(managerVersion(id)).toBe(6);
  });

  it("(e) Manager caído (503) un rato → se pone al día al volver, sin perder nada", async () => {
    fake.store.controls.fail.transactions = 503;
    await agent();
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    await saveOrder(db, storeId, a, { version: 1 });
    await saveOrder(db, storeId, b, { version: 1 });
    for (let v = 1; v <= 3; v++) {
      await saveOrder(db, storeId, c, { version: v });
    }
    await waitFor(() => txRequests().filter((r) => r.status === 503).length >= 3, "varios intentos con 503");
    expect(await allSent(db, storeId)).toBe(false);
    await waitFor(async () => {
      const [st] = await rows(db, sql`SELECT last_error FROM sync_state WHERE store_id = ${storeId}`);
      return String(st?.last_error ?? "").includes("503");
    }, "el error queda en sync_state");
    fake.store.controls.fail.transactions = null;
    await waitFor(() => allSent(db, storeId), "al día tras volver el Manager");
    expect(managerVersion(a)).toBe(1);
    expect(managerVersion(b)).toBe(1);
    expect(managerVersion(c)).toBe(3);
    expect(history(a)).toEqual(["accepted"]);
    expect(history(b)).toEqual(["accepted"]);
    // c pudo salir en v1 en el lote que esperaba y luego en v3: nunca la misma versión dos veces.
    const cv = fake.store.history.filter((h) => h.orderId === c);
    expect(cv.every((h) => h.status === "accepted")).toBe(true);
    expect(new Set(cv.map((h) => h.version)).size).toBe(cv.length);
  });

  it("(f) dos agentes a la vez → solo uno envía; si cae, el otro toma el relevo", async () => {
    const one = await agent();
    const two = await agent();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) {
      await saveOrder(db, storeId, id, { version: 1 });
    }
    await waitFor(() => allSent(db, storeId), "enviadas");
    const leaders = [one, two].filter((a) => a.service.status.leader);
    expect(leaders).toHaveLength(1);
    const follower = leaders[0] === one ? two : one;
    expect(follower.service.status.batchesSent).toBe(0);
    for (const id of ids) {
      expect(history(id)).toEqual(["accepted"]);
    }
    await leaders[0]!.stop();
    await waitFor(() => follower.service.status.leader, "el otro agente toma el bloqueo");
    const late = randomUUID();
    await saveOrder(db, storeId, late, { version: 1 });
    await waitFor(() => managerVersion(late) === 1, "llega con el nuevo agente");
    // El Manager guarda antes de contestar: se espera a que la respuesta llegue al agente.
    await waitFor(() => follower.service.status.batchesSent > 0, "el nuevo agente recibe la respuesta");
  });

  it("(g) conciliación: lo que el Manager pierde se reencola y llega (periódica y al cerrar el periodo)", async () => {
    const periodId = await newPeriod(db, storeId);
    const a = await agent();
    const x = randomUUID();
    const y = randomUUID();
    await saveOrder(db, storeId, x, { version: 2, periodId });
    await saveOrder(db, storeId, y, { version: 5, periodId });
    await waitFor(() => allSent(db, storeId), "enviadas");

    fake.store.forget(storeId, x);
    a.service.reconcileNow();
    await waitFor(() => managerVersion(x) === 2, "x recuperada por la conciliación");
    const rec = fake.store.reconciles.at(-1)!;
    expect(rec.body).toMatchObject({ periodId, items: expect.arrayContaining([{ orderId: x, version: 2 }]) });
    expect(rec.body.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Al cerrar el periodo se concilia solo, sin esperar a la hora.
    fake.store.forget(storeId, y);
    await closePeriod(db, periodId);
    await waitFor(() => managerVersion(y) === 5, "y recuperada al cerrar el periodo");
    expect((await outboxRows(db, storeId)).filter((r) => r.entity_id === y)).toHaveLength(2);
  });

  it("(h) 401 → deja de enviar; el latido lo dice y, cuando vuelve a dar 200, se reanuda solo", async () => {
    // storeKey revocada: el Manager rechaza envíos y latidos.
    fake.store.controls.fail.transactions = 401;
    fake.store.controls.fail.heartbeat = 401;
    const a = await agent({ heartbeatMs: 50 });
    const id = randomUUID();
    await saveOrder(db, storeId, id, { version: 1 });
    await waitFor(() => a.service.status.authFailed, "el agente para por la storeKey");
    // El latido de arranque puede llegar antes que el envío: como mucho un intento de transacciones
    // (el ciclo que ya estaba en marcha termina el suyo).
    await a.service.whenIdle();
    const tried = txRequests().length;
    expect(tried).toBeLessThanOrEqual(1);
    // Varios latidos rechazados (50 ms cada uno) y otro aviso: no insiste con las transacciones.
    const other = randomUUID();
    await saveOrder(db, storeId, other, { version: 1 });
    const hbRejected = () => fake.store.requests.filter((r) => r.route === "heartbeat" && r.status === 401);
    const before = hbRejected().length;
    await waitFor(() => hbRejected().length >= before + 3, "más latidos rechazados");
    expect(txRequests()).toHaveLength(tried);
    expect(a.service.status.authFailed).toBe(true);
    await waitFor(async () => {
      const [st] = await rows(db, sql`SELECT last_error FROM sync_state WHERE store_id = ${storeId}`);
      return String(st?.last_error ?? "").includes("STORE_KEY_REJECTED");
    }, "sync_state dice que la storeKey está mal");
    expect(await allSent(db, storeId)).toBe(false);

    // El Manager vuelve a aceptar la clave: el primer latido 200 lleva el error y el envío se reanuda.
    fake.store.controls.fail.transactions = null;
    fake.store.controls.fail.heartbeat = null;
    const hb = await waitFor(
      () =>
        fake.store.heartbeats.find(
          (h) => h.storeId === storeId && String(h.body.lastError ?? "").includes("STORE_KEY_REJECTED"),
        ),
      "latido con el error de la storeKey",
    );
    expect(hb.body.outboxPending).toBe(2);
    await waitFor(() => managerVersion(id) === 1 && managerVersion(other) === 1, "se reanuda el envío");
    await waitFor(() => allSent(db, storeId), "cola al día");
    expect(a.service.status.authFailed).toBe(false);
  });

  it("el bloqueo es por tienda: agentes de dos tiendas en la misma base envían a la vez", async () => {
    const otherStore = await newStore(db);
    const mine = await agent();
    const theirs = await startAgent(testSettings(url, otherStore));
    agents.push(theirs);
    await waitFor(
      () => mine.service.status.leader && theirs.service.status.leader,
      "los dos tienen su bloqueo",
    );
    const x = randomUUID();
    const y = randomUUID();
    await saveOrder(db, storeId, x, { version: 1 });
    await saveOrder(db, otherStore, y, { version: 2 });
    await waitFor(
      () => managerVersion(x) === 1 && fake.store.get(otherStore, y)?.version === 2,
      "llegan las dos",
    );
  });

  it("(i) una transacción rechazada 10 veces queda aparcada y las demás siguen", async () => {
    const bad = randomUUID();
    fake.store.controls.reject.add(bad);
    await agent({ maxAttempts: 10 });
    const good = randomUUID();
    await saveOrder(db, storeId, bad, { version: 1 });
    await saveOrder(db, storeId, good, { version: 1 });
    await waitFor(async () => {
      const r = (await outboxRows(db, storeId)).find((x) => x.entity_id === bad);
      return r?.parked_at;
    }, "la rechazada queda aparcada");
    const r = (await outboxRows(db, storeId)).find((x) => x.entity_id === bad)!;
    expect(r.attempts).toBe(10);
    expect(r.last_error).toContain("REJECTED");
    expect(history(bad).filter((s) => s === "rejected")).toHaveLength(10);
    expect(history(good)).toEqual(["accepted"]);
    const later = randomUUID();
    await saveOrder(db, storeId, later, { version: 1 });
    await waitFor(() => managerVersion(later) === 1, "las demás siguen llegando");
    expect(history(bad).length).toBe(10);
  });

  it("(j) factura repetida con otro contenido → conflict y aparcada", async () => {
    await agent();
    const first = randomUUID();
    const other = randomUUID();
    const invoice = { series: "T03", sequence: 412, invoiceNumber: "T03-000412", total: 41.2 };
    await saveOrder(db, storeId, first, { version: 9, status: "closed", invoice });
    await waitFor(() => managerVersion(first) === 9, "primera factura en el Manager");
    await saveOrder(db, storeId, other, { version: 3, status: "closed", invoice: { ...invoice, total: 99 } });
    await waitFor(async () => {
      const r = (await outboxRows(db, storeId)).find((x) => x.entity_id === other);
      return r?.parked_at;
    }, "la del número repetido queda aparcada");
    const r = (await outboxRows(db, storeId)).find((x) => x.entity_id === other)!;
    expect(r.last_error).toContain("CONFLICT");
    expect(r.attempts).toBe(0);
    expect(history(other)).toEqual(["conflict"]);
    expect(managerVersion(other)).toBeUndefined();
  });

  it("(k) 413 parte el lote; 422 aísla la transacción mala y la aparca", async () => {
    fake.store.controls.maxBatch = 2;
    const poison = randomUUID();
    fake.store.controls.poison.add(poison);
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) {
      await saveOrder(db, storeId, id, { version: 1 }, false);
    }
    await saveOrder(db, storeId, poison, { version: 1 }, false);
    await agent();
    await waitFor(() => allSent(db, storeId), "todo tratado");
    for (const id of ids) {
      expect(managerVersion(id)).toBe(1);
    }
    const p = (await outboxRows(db, storeId)).find((x) => x.entity_id === poison)!;
    expect(p.parked_at).toBeTruthy();
    expect(p.last_error).toContain("422");
  });

  it("los avisos de otras entidades no se tocan", async () => {
    const other = randomUUID();
    await db.db.execute(
      sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES (${storeId}, 'config', ${other}, 'upsert', '{}'::jsonb)`,
    );
    await agent();
    const id = randomUUID();
    await saveOrder(db, storeId, id, { version: 1 });
    await waitFor(() => managerVersion(id) === 1, "la orden llega");
    await waitFor(() => allSent(db, storeId), "aviso de la orden marcado");
    const cfg = (await outboxRows(db, storeId)).find((x) => x.entity === "config")!;
    expect(cfg.sent_at).toBeNull();
    expect(cfg.parked_at).toBeNull();
    expect(cfg.attempts).toBe(0);
  });
});
