import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { schema as s, type Database } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

/** Lecturas del latido (GET /health): base viva, cola hacia el Manager y última factura. */
@Injectable()
export class SystemApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** «select 1»: lanza si la base no responde. */
  async ping() {
    await this.database.db.execute(sql`select 1`);
  }

  /**
   * C1 (04/11): ¿hay internet? Lo dice la cola hacia el Manager (el agente de sincronización es lo único que sale a internet):
   * down = lo pendiente ya falló al menos una vez (sin internet o el Manager no responde); ok = no hay nada fallando.
   */
  async internet(storeId: string) {
    const r = await this.database.db.execute(sql`
      SELECT (SELECT max(sent_at) FROM sync_outbox WHERE store_id = ${storeId}) AS last_sent,
             (SELECT min(created_at) FROM sync_outbox WHERE store_id = ${storeId} AND sent_at IS NULL AND attempts > 0 AND last_error IS NOT NULL) AS failing_since,
             (SELECT last_error FROM sync_outbox WHERE store_id = ${storeId} AND sent_at IS NULL AND attempts > 0 AND last_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error`);
    const x = (r.rows as Record<string, unknown>[])[0] ?? {};
    const iso = (d: unknown) => (d == null ? null : new Date(d as string).toISOString());
    return {
      status: x.failing_since ? ("down" as const) : ("ok" as const),
      lastSentAt: iso(x.last_sent),
      failingSince: iso(x.failing_since),
      lastError: (x.last_error as string) ?? null,
    };
  }

  /** Mensajes de la cola sin enviar. */
  async outboxPending(storeId: string) {
    const [pending] = await this.database.db
      .select({ n: count() })
      .from(s.syncOutbox)
      .where(and(eq(s.syncOutbox.storeId, storeId), isNull(s.syncOutbox.sentAt)));
    return Number(pending?.n ?? 0);
  }

  /** Hora de la última factura emitida, o null. */
  async lastInvoiceAt(storeId: string) {
    const [last] = await this.database.db
      .select({ at: s.invoice.issuedAt })
      .from(s.invoice)
      .where(eq(s.invoice.storeId, storeId))
      .orderBy(desc(s.invoice.issuedAt))
      .limit(1);
    return last ? new Date(last.at).toISOString() : null;
  }

  /** Despierta al agente de sincronización: escucha el canal «sync_outbox» (LISTEN sync_outbox). */
  async notifySync() {
    await this.database.db.execute(sql`SELECT pg_notify('sync_outbox', '')`);
  }

  /** Transacciones (entity order) en la cola sin enviar ni apartar. */
  async pendingOrders(storeId: string) {
    const [pending] = await this.database.db
      .select({ n: count() })
      .from(s.syncOutbox)
      .where(
        and(
          eq(s.syncOutbox.storeId, storeId),
          eq(s.syncOutbox.entity, "order"),
          isNull(s.syncOutbox.sentAt),
          isNull(s.syncOutbox.parkedAt),
        ),
      );
    return Number(pending?.n ?? 0);
  }
}
