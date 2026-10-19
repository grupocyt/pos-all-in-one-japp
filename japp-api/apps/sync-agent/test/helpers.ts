import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@japp/db";
import { sql } from "drizzle-orm";
import { createFakeManager, type FakeManager } from "fake-manager";
import { inject } from "vitest";
import { OutboxApplication } from "../src/Applications/OutboxApplication.js";
import { ManagerClient } from "../src/Clases/ManagerClient.js";
import { createLogger } from "../src/Helpers/Logger.js";
import type { AppSettings } from "../src/Properties/AppSettings.js";
import { SyncService } from "../src/Services/SyncService.js";

export const KEY = "clave-de-pruebas";
/** Empresa de los datos de arranque de japp-db (la tienda de cada prueba cuelga de ella). */
const COMPANY = "2e540e3e-9e0c-5185-96fb-91f723f0c720";

export const rows = async <T = Record<string, any>>(db: Database, q: ReturnType<typeof sql>) =>
  (await db.db.execute(q)).rows as T[];

/** Espera activa con tiempo máximo: nada de sleeps fijos. */
export async function waitFor<T>(
  fn: () => Promise<T> | T,
  what: string,
  timeoutMs = 5000,
): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) {
        return v as NonNullable<T>;
      }
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) {
      throw new Error(`Tiempo agotado esperando: ${what}${last ? ` (${String(last)})` : ""}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Una tienda nueva por prueba: así cada caso tiene su cola y su estado limpios. */
export async function newStore(db: Database): Promise<string> {
  const id = randomUUID();
  const code = `T${id.slice(0, 8)}`;
  await db.db.execute(
    sql`INSERT INTO store (id, company_id, code, name) VALUES (${id}, ${COMPANY}, ${code}, ${`Tienda ${code}`})`,
  );
  return id;
}

export async function newPeriod(db: Database, storeId: string): Promise<string> {
  const id = randomUUID();
  await db.db.execute(
    sql`INSERT INTO sales_period (id, store_id, status, opened_by_user_name, opened_by_at, open_flag)
        VALUES (${id}, ${storeId}, 'open', 'Pruebas', now(), 1)`,
  );
  return id;
}

export async function closePeriod(db: Database, periodId: string) {
  await db.db.execute(
    sql`UPDATE sales_period SET status = 'closed', open_flag = NULL, closed_by_user_name = 'Pruebas', closed_by_at = now()
         WHERE id = ${periodId}`,
  );
}

export interface OrderOpts {
  version: number;
  status?: "open" | "billing" | "closed" | "cancelled";
  periodId?: string | null;
  invoice?: Record<string, unknown> | null;
  note?: string;
}

/** La transacción completa (forma vista-orden, lo justo para el Manager). */
export function snapshot(storeId: string, orderId: string, o: OrderOpts) {
  return {
    _id: orderId,
    storeId,
    status: o.status ?? "open",
    version: o.version,
    tableData: { tableId: "m12", name: "12", zone: "terraza", guests: 4, note: o.note ?? null },
    events: [],
    accounts: [
      {
        id: `acc-${orderId.slice(0, 4)}`,
        name: "Cuenta 1",
        status: o.invoice ? "invoiced" : "open",
        lines: [],
        deletedLines: [],
        discounts: [],
        payments: [],
        totals: {},
        invoice: o.invoice ?? null,
        events: [],
      },
    ],
  };
}

/**
 * Lo que hace store-api en OrdersApplication.save: orders.version/snapshot con la última foto
 * y un aviso en sync_outbox (entity 'order') con esa foto, en la misma transacción.
 */
export async function saveOrder(db: Database, storeId: string, orderId: string, o: OrderOpts, notify = true) {
  const snap = snapshot(storeId, orderId, o);
  await db.withTx(async (tx) => {
    await tx.execute(
      sql`INSERT INTO orders (id, store_id, period_id, status, version, table_name, opened_by_user_name, opened_by_at, snapshot)
          VALUES (${orderId}, ${storeId}, ${o.periodId ?? null}, ${snap.status}, ${o.version}, '12', 'Pruebas', now(), ${JSON.stringify(snap)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET status = excluded.status, version = excluded.version, snapshot = excluded.snapshot`,
    );
    await tx.execute(
      sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload)
          VALUES (${storeId}, 'order', ${orderId}, 'upsert', ${JSON.stringify(snap)}::jsonb)`,
    );
  });
  if (notify) {
    await db.db.execute(sql`SELECT pg_notify('sync_outbox', '')`);
  }
  return snap;
}

export async function outboxRows(db: Database, storeId: string) {
  return rows<{
    id: string;
    entity: string;
    entity_id: string;
    sent_at: string | null;
    parked_at: string | null;
    attempts: number;
    last_error: string | null;
  }>(
    db,
    sql`SELECT id::text, entity, entity_id::text, sent_at, parked_at, attempts, last_error
          FROM sync_outbox WHERE store_id = ${storeId} ORDER BY id`,
  );
}

export async function allSent(db: Database, storeId: string) {
  const list = await outboxRows(db, storeId);
  return list.filter((r) => r.entity === "order").every((r) => r.sent_at || r.parked_at);
}

export function testSettings(
  managerUrl: string,
  storeId: string,
  over: Partial<AppSettings> = {},
): AppSettings {
  return {
    databaseUrl: inject("dbUrl"),
    managerUrl,
    storeId,
    storeKey: KEY,
    intervalMs: 50,
    instant: true,
    debounceMs: 20,
    batch: 100,
    gzip: true,
    maxAttempts: 10,
    reconcileMs: 60_000,
    heartbeatMs: 60_000,
    retryBaseMs: 20,
    retryMaxMs: 100,
    httpTimeoutMs: 2000,
    agentVersion: "sync-agent/test",
    logLevel: process.env.LOG_LEVEL ?? "silent",
    ...over,
  };
}

export interface RunningAgent {
  service: SyncService;
  database: Database;
  stop(): Promise<void>;
}

let instances = 0;

/** Arranca un agente igual que Program.ts, pero con la configuración de la prueba. */
export async function startAgent(settings: AppSettings): Promise<RunningAgent> {
  const database = createDatabase(settings.databaseUrl, 3);
  const manager = new ManagerClient({
    baseUrl: settings.managerUrl,
    storeId: settings.storeId!,
    storeKey: settings.storeKey,
    gzip: settings.gzip,
    timeoutMs: settings.httpTimeoutMs,
  });
  const service = new SyncService(
    settings,
    settings.storeId!,
    new OutboxApplication(database),
    manager,
    createLogger(settings.logLevel).child({ instance: ++instances }),
  );
  await service.start();
  let stopped = false;
  return {
    service,
    database,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await service.stop();
      await database.close();
    },
  };
}

export async function startFake(): Promise<{ fake: FakeManager; url: string }> {
  const fake = createFakeManager({ storeKey: KEY });
  const url = await fake.listen(0);
  return { fake, url };
}
