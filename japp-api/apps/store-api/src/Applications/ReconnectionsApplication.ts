import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Row = Record<string, any>;
const COLS = sql`r.id::text, r.order_id::text, r.account_id::text, r.client_id, r.plu, r.name, r.quantity, r.unit_price, r.detail,
  r.marked_at, r.marked_by_name, r.device, r.offline_reason, r.status, r.decided_at, r.decided_by_name, r.authorized_by_name,
  r.decision_reason, o.table_name, a.name AS account_name`;
const FROM = sql`order_reconnection r JOIN orders o ON o.id = r.order_id LEFT JOIN account a ON a.id = r.account_id`;

export interface NewReconnection {
  id: string;
  storeId: string;
  orderId: string;
  accountId: string | null;
  clientId: string;
  plu: number;
  name: string;
  quantity: number;
  unitPrice: number;
  detail: unknown;
  markedAt: Date;
  userId: string | null;
  userName: string;
  device: string | null;
  offlineReason: string | null;
}

/** Reconexiones de la orden (order_reconnection, migración 0028). */
@Injectable()
export class ReconnectionsApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async orderExists(storeId: string, orderId: string): Promise<boolean> {
    const r = await this.database.db.execute(sql`SELECT 1 FROM orders WHERE store_id = ${storeId} AND id = ${orderId}`);
    return r.rows.length > 0;
  }

  /** Inserta; si el equipo ya mandó ese clientId no hace nada (reintento). Devuelve la fila guardada. */
  async insert(i: NewReconnection): Promise<Row> {
    await this.database.db.execute(
      sql`INSERT INTO order_reconnection (id, store_id, order_id, account_id, client_id, plu, name, quantity, unit_price, detail,
            marked_at, marked_by_id, marked_by_name, device, offline_reason)
          VALUES (${i.id}, ${i.storeId}, ${i.orderId}, ${i.accountId}, ${i.clientId}, ${i.plu}, ${i.name}, ${i.quantity}, ${i.unitPrice},
            ${JSON.stringify(i.detail)}::jsonb, ${i.markedAt.toISOString()}, ${i.userId}, ${i.userName}, ${i.device}, ${i.offlineReason})
          ON CONFLICT (store_id, client_id) DO NOTHING`,
    );
    const r = await this.database.db.execute(
      sql`SELECT ${COLS} FROM ${FROM} WHERE r.store_id = ${i.storeId} AND r.client_id = ${i.clientId}`,
    );
    return (r.rows as Row[])[0]!;
  }

  async get(storeId: string, id: string): Promise<Row | null> {
    const r = await this.database.db.execute(sql`SELECT ${COLS} FROM ${FROM} WHERE r.store_id = ${storeId} AND r.id = ${id}`);
    return ((r.rows as Row[])[0] ?? null) as Row | null;
  }

  async lock(tx: Tx, storeId: string, id: string): Promise<Row | null> {
    const r = await tx.execute(
      sql`SELECT ${COLS} FROM ${FROM} WHERE r.store_id = ${storeId} AND r.id = ${id} FOR UPDATE OF r`,
    );
    return ((r.rows as Row[])[0] ?? null) as Row | null;
  }

  async decide(
    tx: Tx,
    storeId: string,
    id: string,
    v: { status: "accepted" | "discarded"; userName: string; authorizedBy: string | null; reason: string | null; at: Date },
  ) {
    await tx.execute(
      sql`UPDATE order_reconnection SET status = ${v.status}, decided_by_name = ${v.userName}, authorized_by_name = ${v.authorizedBy},
            decision_reason = ${v.reason}, decided_at = ${v.at.toISOString()}
          WHERE store_id = ${storeId} AND id = ${id} AND status = 'pending'`,
    );
  }

  /** Pendientes (o todas), la más antigua primero; hasta 500. */
  async list(storeId: string, status: "pending" | "all", orderId?: string) {
    const w: SQL[] = [sql`r.store_id = ${storeId}`];
    if (status === "pending") {
      w.push(sql`r.status = 'pending'`);
    }
    if (orderId) {
      w.push(sql`r.order_id = ${orderId}`);
    }
    return (
      await this.database.db.execute(
        sql`SELECT ${COLS} FROM ${FROM} WHERE ${sql.join(w, sql` AND `)} ORDER BY r.marked_at, r.created_at LIMIT 500`,
      )
    ).rows as Row[];
  }

  /** Cuántas quedan pendientes en esa cuenta (o sin cuenta en esa orden): con alguna, la cuenta no se cobra. */
  async pendingFor(tx: Tx, storeId: string, orderId: string, accountId: string): Promise<{ id: string; name: string; quantity: number }[]> {
    const r = await tx.execute(
      sql`SELECT id::text, name, quantity FROM order_reconnection
          WHERE store_id = ${storeId} AND order_id = ${orderId} AND status = 'pending' AND (account_id = ${accountId} OR account_id IS NULL)`,
    );
    return r.rows as { id: string; name: string; quantity: number }[];
  }
}
