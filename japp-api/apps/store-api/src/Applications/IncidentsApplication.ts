import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Row = Record<string, any>;

/** Incidencias de productos para Marketing (product_incident) y sus solicitudes de envío (incident_request). */
@Injectable()
export class IncidentsApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Incidencias por estado (pending, sent o todas), la más reciente primero; hasta 500. */
  async list(storeId: string, status: "pending" | "sent" | "all") {
    const w: SQL[] = [sql`i.store_id = ${storeId}`];
    if (status !== "all") {
      w.push(sql`i.status = ${status}`);
    }
    return (
      await this.database.db.execute(
        sql`SELECT i.id::text id, i.code, p.plu, coalesce(i.product_name, p.name, '') product, i.action, coalesce(i.diff, '') detail, i.at, i.user_name, i.status, r.code request_code
          FROM product_incident i LEFT JOIN product p ON p.id = i.product_id AND p.store_id = i.store_id
          LEFT JOIN incident_request r ON r.id = i.request_id AND r.store_id = i.store_id
          WHERE ${sql.join(w, sql` AND `)} ORDER BY i.at DESC, i.code DESC LIMIT 500`,
      )
    ).rows as Row[];
  }

  /** Una solicitud a la vez por tienda (código REQ-nnnn sin repetidos); devuelve el número siguiente. */
  async lockAndNextRequestNumber(tx: Tx, storeId: string): Promise<number> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('incident_request:' || ${storeId}))`);
    const [r] = (
      await tx.execute(sql`SELECT count(*) + 1 n FROM incident_request WHERE store_id = ${storeId}`)
    ).rows as Row[];
    return Number(r!.n);
  }

  /** Pendientes (todas o las de ids), bloqueadas (FOR UPDATE) para marcarlas enviadas. */
  async lockPending(tx: Tx, storeId: string, ids: string[] | null) {
    const w: SQL[] = [sql`i.store_id = ${storeId}`, sql`i.status = 'pending'`];
    if (ids) {
      w.push(sql`i.id = ANY(${"{" + ids.join(",") + "}"}::uuid[])`);
    }
    return (
      await tx.execute(
        sql`SELECT i.id::text id, i.code, i.at, i.user_name, i.product_id::text product_id, i.product_name, i.action, i.diff, p.plu
          FROM product_incident i LEFT JOIN product p ON p.id = i.product_id AND p.store_id = i.store_id
          WHERE ${sql.join(w, sql` AND `)} ORDER BY i.at, i.code FOR UPDATE OF i`,
      )
    ).rows as Row[];
  }

  async insertRequest(
    tx: Tx,
    r: {
      id: string;
      storeId: string;
      code: string;
      trigger: "manual" | "period_close";
      at: string;
      by: string;
    },
  ) {
    await tx.execute(
      sql`INSERT INTO incident_request (id, store_id, code, trigger_kind, sent_at, sent_by) VALUES (${r.id}, ${r.storeId}, ${r.code}, ${r.trigger}, ${r.at}, ${r.by})`,
    );
  }

  async markSent(tx: Tx, storeId: string, requestId: string, ids: string[]) {
    await tx.execute(
      sql`UPDATE product_incident SET status = 'sent', request_id = ${requestId} WHERE store_id = ${storeId} AND id = ANY(${"{" + ids.join(",") + "}"}::uuid[])`,
    );
  }

  /** Cola hacia el Manager (entity = 'incident_request'). */
  async enqueue(tx: Tx, storeId: string, requestId: string, payload: unknown) {
    await tx.execute(
      sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES (${storeId}, 'incident_request', ${requestId}, 'upsert', ${JSON.stringify(payload)})`,
    );
  }
}
