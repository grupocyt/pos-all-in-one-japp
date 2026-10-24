import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Row = Record<string, any>;
const COLS = sql`id::text, order_id::text, account_id::text, table_name, kind, status, detail, device, occurred_at,
  opened_by_user_id::text, opened_by_user_name, opened_by_at, resolved_by_user_name, resolved_authorized_by, resolved_by_at, resolution_note`;

export interface NewOrderIncident {
  id: string;
  storeId: string;
  orderId: string | null;
  accountId: string | null;
  tableName: string;
  kind: string;
  detail: unknown;
  stationId: string | null;
  device: string | null;
  occurredAt: Date;
  userId: string | null;
  userName: string;
  at: Date;
}

/** Incidencias de mesa (order_incident, migración 0015). */
@Injectable()
export class OrderIncidentsApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Inserta; si el id ya existe en la tienda no hace nada (el equipo repite el envío). Devuelve la fila guardada. */
  async insert(i: NewOrderIncident): Promise<Row | null> {
    await this.database.db.execute(
      sql`INSERT INTO order_incident (id, store_id, order_id, account_id, table_name, kind, detail, station_id, device, occurred_at,
            opened_by_user_id, opened_by_user_name, opened_by_at)
          VALUES (${i.id}, ${i.storeId}, ${i.orderId}, ${i.accountId}, ${i.tableName}, ${i.kind}, ${JSON.stringify(i.detail)}::jsonb,
            ${i.stationId}, ${i.device}, ${i.occurredAt.toISOString()}, ${i.userId}, ${i.userName}, ${i.at.toISOString()})
          ON CONFLICT (id) DO NOTHING`,
    );
    return this.get(i.storeId, i.id);
  }

  async get(storeId: string, id: string): Promise<Row | null> {
    const r = await this.database.db.execute(
      sql`SELECT ${COLS} FROM order_incident WHERE store_id = ${storeId} AND id = ${id}`,
    );
    return ((r.rows as Row[])[0] ?? null) as Row | null;
  }

  async lock(tx: Tx, storeId: string, id: string): Promise<Row | null> {
    const r = await tx.execute(
      sql`SELECT ${COLS} FROM order_incident WHERE store_id = ${storeId} AND id = ${id} FOR UPDATE`,
    );
    return ((r.rows as Row[])[0] ?? null) as Row | null;
  }

  async resolve(
    tx: Tx,
    storeId: string,
    id: string,
    v: {
      status: string;
      userId: string | null;
      userName: string;
      authorizedBy: string | null;
      note: string | null;
      at: Date;
    },
  ) {
    await tx.execute(
      sql`UPDATE order_incident SET status = ${v.status}, resolved_by_user_id = ${v.userId}, resolved_by_user_name = ${v.userName},
            resolved_authorized_by = ${v.authorizedBy}, resolution_note = ${v.note}, resolved_by_at = ${v.at.toISOString()}, version = version + 1
          WHERE store_id = ${storeId} AND id = ${id}`,
    );
  }

  /** Abiertas (o todas), la más reciente primero; hasta 200. */
  async list(storeId: string, status: "open" | "all", orderId?: string) {
    const w: SQL[] = [sql`store_id = ${storeId}`];
    if (status === "open") {
      w.push(sql`status = 'open'`);
    }
    if (orderId) {
      w.push(sql`order_id = ${orderId}`);
    }
    return (
      await this.database.db.execute(
        sql`SELECT ${COLS} FROM order_incident WHERE ${sql.join(w, sql` AND `)} ORDER BY opened_by_at DESC LIMIT 200`,
      )
    ).rows as Row[];
  }
}
