import type { Database, Db, Tx } from "@japp/db";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";

type Q = Db | Tx;

const rows = async <T = Record<string, unknown>>(q: Q, query: SQL) => (await q.execute(query)).rows as T[];

/** Una transacción con avisos pendientes: sus avisos van de firstId a lastId y se manda la foto actual. */
export interface PendingTransaction {
  orderId: string;
  firstId: number;
  lastId: number;
  attempts: number;
  /** JSON completo de la transacción (orders.snapshot o, si faltara, el payload del último aviso). */
  transaction: Record<string, unknown> | null;
  version: number | null;
}

/** Qué hacer con los avisos de una transacción tras la respuesta del Manager. */
export type Outcome =
  | { orderId: string; lastId: number; kind: "sent" }
  | { orderId: string; lastId: number; kind: "park"; error: string }
  | { orderId: string; lastId: number; kind: "reject"; error: string };

export interface PeriodRow {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
}

export interface OutboxStats {
  outboxPending: number;
  oldestPendingAt: string | null;
  openTransactions: number;
  lastSentAt: string | null;
}

/**
 * Sesión dedicada del agente (una conexión que se mantiene): el advisory lock de «un solo agente»
 * es de sesión, y LISTEN también, así que los dos viven en la misma conexión mientras el agente sea el que envía.
 */
export class LeaderSession {
  private readonly db: Db;
  private closed = false;
  private locked = false;

  constructor(
    private readonly client: PoolClient,
    private readonly storeId: string,
  ) {
    this.db = drizzle(client) as unknown as Db;
  }

  /**
   * Bloqueo por tienda (hashtext('sync-agent:' || storeId)): dos tiendas en la misma base no se estorban.
   * true si este proceso es el único agente de la tienda (pg_try_advisory_lock no espera: si otro lo tiene, devuelve false). */
  async tryLock(): Promise<boolean> {
    const [r] = await rows<{ ok: boolean }>(
      this.db,
      sql`SELECT pg_try_advisory_lock(hashtext('sync-agent:' || ${this.storeId}::text)) ok`,
    );
    this.locked = r?.ok === true;
    return this.locked;
  }

  /** LISTEN sync_outbox: store-api (o un trigger) avisa con NOTIFY al hacer COMMIT de un cambio. */
  async listen(onNotify: () => void): Promise<void> {
    this.client.on("notification", (msg) => {
      if (msg.channel === "sync_outbox") {
        onNotify();
      }
    });
    await this.db.execute(sql`LISTEN sync_outbox`);
  }

  /** Avisa si la conexión se cae: entonces se pierde el bloqueo y hay que volver a pedirlo. */
  onLost(fn: (err: Error) => void) {
    this.client.on("error", fn);
    this.client.on("end", () => fn(new Error("Conexión del agente cerrada")));
  }

  /** Suelta el bloqueo y devuelve la conexión. broken = la conexión ya no vale (se destruye). */
  async close(broken = false): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (!broken) {
      try {
        await this.db.execute(sql`UNLISTEN *`);
        if (this.locked) {
          await this.db.execute(
            sql`SELECT pg_advisory_unlock(hashtext('sync-agent:' || ${this.storeId}::text))`,
          );
        }
      } catch {
        broken = true;
      }
    }
    this.client.removeAllListeners("notification");
    this.client.release(broken ? new Error("descartada") : undefined);
  }
}

/** Todo el SQL del agente: cola (sync_outbox), fotos de las órdenes, periodos y estado (sync_state). */
export class OutboxApplication {
  constructor(private readonly database: Database) {}

  /** Conexión dedicada para el bloqueo y LISTEN (sale del mismo pool de @japp/db). */
  async openSession(storeId: string): Promise<LeaderSession> {
    const client = await this.database.pool.connect();
    client.on("error", () => {
      // Sin este manejador un corte de la conexión tumbaría el proceso; LeaderSession.onLost lo gestiona.
    });
    return new LeaderSession(client, storeId);
  }

  /** Todas las tiendas de la base (normalmente una); cuál es la de este servidor lo decide pickStore. */
  async stores(): Promise<{ id: string; code: string; active: boolean }[]> {
    return rows<{ id: string; code: string; active: boolean }>(
      this.database.db,
      sql`SELECT id::text id, code, active FROM store`,
    );
  }

  async storeExists(storeId: string): Promise<boolean> {
    const [r] = await rows(this.database.db, sql`SELECT 1 FROM store WHERE id = ${storeId}::uuid`);
    return Boolean(r);
  }

  /**
   * Transacciones con avisos pendientes, agrupadas por orden (los avisos de otras entidades no se tocan).
   * No hace falta FOR UPDATE: solo envía quien tiene el advisory lock, y marcar es idempotente (id ≤ lastId).
   * La foto es la de orders.snapshot, que puede ser más nueva que la del último aviso: mejor.
   */
  async pending(storeId: string, limit: number): Promise<PendingTransaction[]> {
    const list = await rows<{
      order_id: string;
      first_id: string;
      last_id: string;
      attempts: number;
      version: number | null;
      snapshot: Record<string, unknown> | null;
      fallback: Record<string, unknown> | null;
    }>(
      this.database.db,
      sql`WITH g AS (
            SELECT entity_id, min(id) first_id, max(id) last_id, max(attempts)::int attempts
              FROM sync_outbox
             WHERE store_id = ${storeId} AND entity = 'order' AND sent_at IS NULL AND parked_at IS NULL
             GROUP BY entity_id
             ORDER BY min(id)
             LIMIT ${limit}
          )
          SELECT g.entity_id::text order_id, g.first_id::text first_id, g.last_id::text last_id, g.attempts,
                 o.version, o.snapshot,
                 CASE WHEN o.snapshot IS NULL THEN (SELECT payload FROM sync_outbox WHERE id = g.last_id) END fallback
            FROM g
            LEFT JOIN orders o ON o.id = g.entity_id AND o.store_id = ${storeId}
           ORDER BY g.first_id`,
    );
    return list.map((r) => {
      const transaction = r.snapshot ?? r.fallback ?? null;
      let version = r.version ?? null;
      if (transaction && Number.isInteger(transaction.version)) {
        version = transaction.version as number;
      }
      return {
        orderId: r.order_id,
        firstId: Number(r.first_id),
        lastId: Number(r.last_id),
        attempts: r.attempts,
        transaction,
        version,
      };
    });
  }

  /**
   * Aplica lo que respondió el Manager, en una transacción:
   * - sent: sent_at en todos los avisos de esa orden con id ≤ lastId;
   * - park: parked_at + last_error (no se reintenta);
   * - reject: attempts + 1 y last_error; al llegar a maxAttempts, parked_at.
   * Devuelve las órdenes que han quedado aparcadas.
   */
  async apply(storeId: string, outcomes: Outcome[], maxAttempts: number): Promise<{ parked: string[] }> {
    const parked: string[] = [];
    if (!outcomes.length) {
      return { parked };
    }
    await this.database.withTx(async (tx) => {
      let lastSentId = 0;
      for (const o of outcomes) {
        const scope = sql`store_id = ${storeId} AND entity = 'order' AND entity_id = ${o.orderId}::uuid
                          AND id <= ${o.lastId} AND sent_at IS NULL AND parked_at IS NULL`;
        if (o.kind === "sent") {
          await tx.execute(sql`UPDATE sync_outbox SET sent_at = now() WHERE ${scope}`);
          lastSentId = Math.max(lastSentId, o.lastId);
          continue;
        }
        if (o.kind === "park") {
          await tx.execute(
            sql`UPDATE sync_outbox SET parked_at = now(), last_error = ${o.error} WHERE ${scope}`,
          );
          parked.push(o.orderId);
          continue;
        }
        const r = await rows<{ parked: boolean }>(
          tx,
          sql`UPDATE sync_outbox
                 SET attempts = least(attempts + 1, 32767),
                     last_error = ${o.error},
                     parked_at = CASE WHEN attempts + 1 >= ${maxAttempts} THEN now() END
               WHERE ${scope}
           RETURNING parked_at IS NOT NULL parked`,
        );
        if (r.some((x) => x.parked)) {
          parked.push(o.orderId);
        }
      }
      if (lastSentId > 0) {
        await tx.execute(
          sql`INSERT INTO sync_state (store_id, last_sent_at, last_sent_id) VALUES (${storeId}, now(), ${lastSentId})
              ON CONFLICT (store_id) DO UPDATE
                 SET last_sent_at = now(),
                     last_sent_id = greatest(coalesce(sync_state.last_sent_id, 0), excluded.last_sent_id)`,
        );
      }
    });
    return { parked };
  }

  /** Último error de envío, para Developer › Sincronización (store-api lee sync_state). */
  async saveError(storeId: string, error: string): Promise<void> {
    await this.database.db.execute(
      sql`INSERT INTO sync_state (store_id, last_error, last_error_at) VALUES (${storeId}, ${error}, now())
          ON CONFLICT (store_id) DO UPDATE SET last_error = excluded.last_error, last_error_at = now()`,
    );
  }

  /** Latido contestado: hora y diferencia de reloj con el Manager. */
  async saveHeartbeat(storeId: string, offsetMs: number | null): Promise<void> {
    await this.database.db.execute(
      sql`INSERT INTO sync_state (store_id, last_heartbeat_at, manager_time_offset_ms) VALUES (${storeId}, now(), ${offsetMs})
          ON CONFLICT (store_id) DO UPDATE
             SET last_heartbeat_at = now(), manager_time_offset_ms = excluded.manager_time_offset_ms`,
    );
  }

  /** Lo que viaja en el latido: pendientes (solo transacciones), el más antiguo, mesas abiertas y último envío. */
  async stats(storeId: string): Promise<OutboxStats> {
    const db = this.database.db;
    const [q] = await rows<{ pending: number; oldest: string | null }>(
      db,
      sql`SELECT count(*)::int pending, min(created_at) oldest FROM sync_outbox
           WHERE store_id = ${storeId} AND entity = 'order' AND sent_at IS NULL AND parked_at IS NULL`,
    );
    const [o] = await rows<{ n: number }>(
      db,
      sql`SELECT count(*)::int n FROM orders WHERE store_id = ${storeId} AND status IN ('open','billing')`,
    );
    const [st] = await rows<{ last_sent_at: string | null }>(
      db,
      sql`SELECT last_sent_at FROM sync_state WHERE store_id = ${storeId}`,
    );
    return {
      outboxPending: q?.pending ?? 0,
      oldestPendingAt: toIso(q?.oldest),
      openTransactions: o?.n ?? 0,
      lastSentAt: toIso(st?.last_sent_at),
    };
  }

  /** Periodo abierto o, si no hay, el último cerrado (la conciliación periódica repasa ese). */
  async currentPeriod(storeId: string): Promise<PeriodRow | null> {
    const [r] = await rows<PeriodDb>(
      this.database.db,
      sql`SELECT id::text id, status, opened_by_at, closed_by_at FROM sales_period
           WHERE store_id = ${storeId}
           ORDER BY (status = 'open') DESC, opened_by_at DESC
           LIMIT 1`,
    );
    return period(r);
  }

  /** Último periodo cerrado: si cambia, se acaba de cerrar uno y toca conciliarlo. */
  async latestClosedPeriod(storeId: string): Promise<PeriodRow | null> {
    const [r] = await rows<PeriodDb>(
      this.database.db,
      sql`SELECT id::text id, status, opened_by_at, closed_by_at FROM sales_period
           WHERE store_id = ${storeId} AND status = 'closed'
           ORDER BY closed_by_at DESC NULLS LAST, opened_by_at DESC
           LIMIT 1`,
    );
    return period(r);
  }

  /** orderId + versión de las órdenes del periodo que tienen foto (sin foto no hay nada que mandar). */
  async periodItems(storeId: string, periodId: string): Promise<Array<{ orderId: string; version: number }>> {
    const list = await rows<{ order_id: string; version: number }>(
      this.database.db,
      sql`SELECT id::text order_id, version FROM orders
           WHERE store_id = ${storeId} AND period_id = ${periodId}::uuid AND snapshot IS NOT NULL
           ORDER BY opened_by_at, id`,
    );
    return list.map((r) => ({ orderId: r.order_id, version: r.version }));
  }

  /**
   * Vuelve a encolar (un aviso 'order' con la foto actual) lo que al Manager le falta o tiene viejo.
   * No duplica si ya hay un aviso pendiente, y no insiste con una orden cuyo último aviso está aparcado.
   */
  async requeue(storeId: string, orderIds: string[]): Promise<number> {
    if (!orderIds.length) {
      return 0;
    }
    const ids = sql.join(
      orderIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const r = await rows(
      this.database.db,
      sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload)
          SELECT o.store_id, 'order', o.id, 'upsert', o.snapshot
            FROM orders o
           WHERE o.store_id = ${storeId} AND o.id IN (${ids}) AND o.snapshot IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM sync_outbox p
                WHERE p.store_id = o.store_id AND p.entity = 'order' AND p.entity_id = o.id
                  AND p.sent_at IS NULL AND p.parked_at IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM sync_outbox l
                WHERE l.id = (SELECT max(id) FROM sync_outbox m
                               WHERE m.store_id = o.store_id AND m.entity = 'order' AND m.entity_id = o.id)
                  AND l.parked_at IS NOT NULL)
          RETURNING id`,
    );
    return r.length;
  }
}

interface PeriodDb {
  id: string;
  status: string;
  opened_by_at: string;
  closed_by_at: string | null;
}

function period(r: PeriodDb | undefined): PeriodRow | null {
  if (!r) {
    return null;
  }
  return { id: r.id, status: r.status, openedAt: r.opened_by_at, closedAt: r.closed_by_at };
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) {
    return null;
  }
  return new Date(v).toISOString();
}
