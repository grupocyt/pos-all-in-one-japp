import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@japp/db";
import type { FakeManager } from "fake-manager";
import { inject } from "vitest";
import {
  newStore,
  outboxRows,
  saveOrder,
  startAgent,
  startFake,
  testSettings,
  waitFor,
  type RunningAgent,
} from "./helpers.js";

/**
 * Un 4xx del Manager que no se arregla esperando (400, 404…) no puede frenar la cola para siempre:
 * cuenta como un intento de cada aviso del lote y se aparca al llegar a SYNC_MAX_ATTEMPTS.
 */
describe("sync-agent · respuesta no reintentable del Manager", () => {
  let db: Database;
  let fake: FakeManager;
  let url: string;
  let storeId: string;
  let agent: RunningAgent | null = null;

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
    await agent?.stop();
    agent = null;
    await fake.close();
  });

  it("400 en cada lote → un intento por lote, aparcada a los 3; después la cola sigue", async () => {
    fake.store.controls.fail = { ...fake.store.controls.fail, transactions: 400 };
    agent = await startAgent(testSettings(url, storeId, { maxAttempts: 3 }));
    const stuck = randomUUID();
    await saveOrder(db, storeId, stuck, { version: 1 });
    const parked = await waitFor(async () => {
      const r = (await outboxRows(db, storeId)).find((x) => x.entity_id === stuck);
      return r?.parked_at ? r : null;
    }, "la del 400 queda aparcada");
    expect(parked.attempts).toBe(3);
    expect(parked.sent_at).toBeNull();
    expect(parked.last_error).toContain("400");
    // el Manager vuelve a aceptar: lo nuevo llega y lo aparcado no se reenvía
    fake.store.controls.fail = { ...fake.store.controls.fail, transactions: null };
    const later = randomUUID();
    await saveOrder(db, storeId, later, { version: 1 });
    await waitFor(() => fake.store.get(storeId, later)?.version === 1, "la siguiente llega");
    expect(fake.store.get(storeId, stuck)).toBeUndefined();
  });
});
