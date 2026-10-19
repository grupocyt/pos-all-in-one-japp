import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import { addDays } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

const rows = async (db: Database["db"], q: ReturnType<typeof sql>) => (await db.execute(q)).rows as any[];
/** Lista de UUID como uuid[] de PostgreSQL. */
const uuids = (ids: string[]) => sql`ANY(${"{" + ids.join(",") + "}"}::uuid[])`;

/** Todo lo de una orden del día: cuentas, líneas, modificadores, cobros, descuentos, facturas, IVA e historial. */
export interface DayOrdersData {
  accounts: any[];
  lines: any[];
  mods: any[];
  pays: any[];
  discs: any[];
  invs: any[];
  taxes: any[];
  evs: any[];
}

/** Lecturas en SQL crudo de las transacciones del día y su cola hacia el Manager (sync_outbox, entity «transaction»). */
@Injectable()
export class TransactionsApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Periodos abiertos entre el día anterior y el siguiente (margen por la zona horaria; el servicio filtra el día de Madrid). */
  async periodsAround(storeId: string, d: string) {
    return rows(
      this.database.db,
      sql`SELECT id::text, opened_by_at, closed_by_at, status FROM sales_period WHERE store_id = ${storeId}
      AND opened_by_at BETWEEN ${addDays(d, -1) + "T00:00:00Z"}::timestamptz AND ${addDays(d, 1) + "T23:59:59Z"}::timestamptz`,
    );
  }

  /** Órdenes de esos periodos con su mesa y área. */
  async orders(storeId: string, periodIds: string[]) {
    return rows(
      this.database.db,
      sql`SELECT o.*, o.id::text id, dt.number table_number, a.name area_name FROM orders o LEFT JOIN dining_table dt ON dt.id = o.table_id LEFT JOIN area a ON a.id = dt.area_id
      WHERE o.store_id = ${storeId} AND o.period_id = ${uuids(periodIds)}`,
    );
  }

  /** El resto de las filas de esas órdenes, en el mismo orden de consultas que siempre. */
  async ordersData(storeId: string, orderIds: string[]): Promise<DayOrdersData> {
    const db = this.database.db;
    const O = uuids(orderIds);
    const accounts = await rows(
      db,
      sql`SELECT a.*, a.id::text id, a.order_id::text order_id FROM account a WHERE a.store_id = ${storeId} AND a.order_id = ${O} ORDER BY a.opened_by_at`,
    );
    const lines = await rows(
      db,
      sql`SELECT l.*, l.id::text id, l.account_id::text account_id FROM order_line l WHERE l.store_id = ${storeId} AND l.order_id = ${O} ORDER BY l.sort_order, l.created_by_at`,
    );
    const mods = await rows(
      db,
      sql`SELECT m.line_id::text line_id, m.plu, m.name, m.quantity::float8 quantity, m.unit_price::float8 unit_price, m.course FROM order_line_modifier m JOIN order_line l ON l.id = m.line_id AND l.store_id = m.store_id WHERE m.store_id = ${storeId} AND l.order_id = ${O}`,
    );
    const pays = await rows(
      db,
      sql`SELECT p.*, p.account_id::text account_id, pm.name method_name, pm.kind method_kind FROM payment p LEFT JOIN payment_method pm ON pm.id = p.payment_method_id AND pm.store_id = p.store_id
      JOIN account a ON a.id = p.account_id WHERE p.store_id = ${storeId} AND a.order_id = ${O} ORDER BY p.collected_by_at`,
    );
    const discs = await rows(
      db,
      sql`SELECT d.*, d.account_id::text account_id FROM account_discount d JOIN account a ON a.id = d.account_id AND a.store_id = d.store_id WHERE d.store_id = ${storeId} AND a.order_id = ${O}`,
    );
    const invs = await rows(
      db,
      sql`SELECT i.*, i.id::text id, i.account_id::text account_id, i.order_id::text order_id, r.invoice_number rectified_number FROM invoice i LEFT JOIN invoice r ON r.id = i.rectified_invoice_id AND r.store_id = i.store_id
      WHERE i.store_id = ${storeId} AND i.order_id = ${O} ORDER BY i.issued_at`,
    );
    let taxes: any[] = [];
    if (invs.length) {
      taxes = await rows(
        db,
        sql`SELECT invoice_id::text invoice_id, rate::text rate, base::text base, tax::text tax FROM invoice_tax WHERE store_id = ${storeId} AND invoice_id = ${uuids(invs.map((i) => i.id))}`,
      );
    }
    const evs = await rows(
      db,
      sql`SELECT e.*, e.order_id::text order_id, e.account_id::text account_id FROM order_event e WHERE e.store_id = ${storeId} AND e.order_id = ${O} ORDER BY e.at`,
    );
    return { accounts, lines, mods, pays, discs, invs, taxes, evs };
  }

  /** ¿Ya está en la cola esa transacción con ese mismo contenido (hash)? */
  async isQueued(tx: Tx, storeId: string, entityId: string, hash: string) {
    const [dup] = (
      await tx.execute(
        sql`SELECT 1 FROM sync_outbox WHERE store_id = ${storeId} AND entity = 'transaction' AND entity_id = ${entityId} AND payload->>'hash' = ${hash} LIMIT 1`,
      )
    ).rows;
    return !!dup;
  }

  /** A la cola hacia el Manager. */
  async enqueue(tx: Tx, storeId: string, entityId: string, payload: unknown) {
    await tx.execute(
      sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES (${storeId}, 'transaction', ${entityId}, 'upsert', ${JSON.stringify(payload)}::jsonb)`,
    );
  }

  /** El Manager lo recibió: las transacciones de ese día quedan enviadas. */
  async markSent(storeId: string, date: string) {
    await this.database.db.execute(
      sql`UPDATE sync_outbox SET sent_at = now() WHERE store_id = ${storeId} AND entity = 'transaction' AND sent_at IS NULL AND payload->>'date' = ${date}`,
    );
  }
}
