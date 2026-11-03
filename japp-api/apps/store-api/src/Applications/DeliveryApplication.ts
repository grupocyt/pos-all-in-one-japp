import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Database, Db, Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;
type Row = Record<string, any>;

export interface DeliverySettingsRow {
  active: boolean;
  integration: boolean;
  platforms: { id: string; name: string; active: boolean }[];
  autoAccept: boolean;
  askRider: boolean;
  sound: boolean;
  prepMinutes: number;
  amberMinutes: number;
  redMinutes: number;
}

const ORDER_COLS =
  sql.raw(`d.id::text id, d.platform, d.code, d.external_id "externalId", d.customer_name "customerName",
  d.customer_phone "customerPhone", d.address, d.payment_note "paymentNote", d.note, d.status, d.rider_id::text "riderId",
  d.rider_name "riderName", d.total::float8 total, d.received_at "receivedAt", d.finished_at "finishedAt",
  d.order_id::text "orderId", d.version`);

/** Pedidos de delivery en la base: delivery_settings, delivery_rider, delivery_order (+ líneas y pasos). */
@Injectable()
export class DeliveryApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async rows(q: Q, query: SQL): Promise<Row[]> {
    return (await q.execute(query)).rows as Row[];
  }

  /** Ajustes › Pedidos de la tienda (sin fila = los valores por defecto: se crea). */
  async settings(storeId: string, q: Q = this.database.db): Promise<DeliverySettingsRow> {
    await q.execute(
      sql`INSERT INTO delivery_settings (store_id) VALUES (${storeId}) ON CONFLICT (store_id) DO NOTHING`,
    );
    const [r] = await this.rows(
      q,
      sql`SELECT active, integration, platforms, auto_accept "autoAccept", ask_rider "askRider", sound,
            prep_minutes "prepMinutes", amber_minutes "amberMinutes", red_minutes "redMinutes"
          FROM delivery_settings WHERE store_id = ${storeId}`,
    );
    return r as DeliverySettingsRow;
  }

  async riders(storeId: string, q: Q = this.database.db) {
    return this.rows(
      q,
      sql`SELECT id::text, name, phone FROM delivery_rider WHERE store_id = ${storeId} AND active ORDER BY sort_order, name`,
    );
  }

  async activeRider(tx: Tx, storeId: string, id: string) {
    const [r] = await this.rows(
      tx,
      sql`SELECT id::text, name FROM delivery_rider WHERE store_id = ${storeId} AND active AND id::text = ${id}`,
    );
    return (r as { id: string; name: string }) ?? null;
  }

  /** Tablero: los pendientes (del más antiguo al más nuevo) o los terminados del día (Madrid). */
  async list(
    storeId: string,
    o: { scope: "active" | "finished"; status?: string; q?: string; date: string },
  ): Promise<Row[]> {
    const where: SQL[] = [sql`d.store_id = ${storeId}`];
    if (o.scope === "active") {
      where.push(sql`d.finished_at IS NULL`);
      if (o.status) {
        where.push(sql`d.status = ${o.status}`);
      }
    } else {
      where.push(
        sql`d.finished_at IS NOT NULL AND (d.finished_at AT TIME ZONE 'Europe/Madrid')::date = ${o.date}::date`,
      );
    }
    if (o.q) {
      const like = `%${o.q}%`;
      where.push(
        sql`(d.code ILIKE ${like} OR d.customer_name ILIKE ${like} OR coalesce(d.rider_name, '') ILIKE ${like} OR d.platform ILIKE ${like})`,
      );
    }
    const order = o.scope === "active" ? sql`d.received_at, d.code` : sql`d.finished_at DESC`;
    return this.rows(
      this.database.db,
      sql`SELECT ${ORDER_COLS} FROM delivery_order d WHERE ${sql.join(where, sql` AND `)} ORDER BY ${order} LIMIT 500`,
    );
  }

  /** Pendientes por estado y terminados del día (columna derecha del tablero). */
  async counts(storeId: string, date: string) {
    const live = await this.rows(
      this.database.db,
      sql`SELECT status, count(*)::int n FROM delivery_order WHERE store_id = ${storeId} AND finished_at IS NULL GROUP BY status`,
    );
    const [f] = await this.rows(
      this.database.db,
      sql`SELECT count(*)::int n FROM delivery_order WHERE store_id = ${storeId} AND finished_at IS NOT NULL
          AND (finished_at AT TIME ZONE 'Europe/Madrid')::date = ${date}::date`,
    );
    return {
      live: Object.fromEntries(live.map((r) => [r.status, Number(r.n)])),
      finished: Number(f?.n ?? 0),
    };
  }

  async find(storeId: string, id: string, q: Q = this.database.db, lock = false): Promise<Row | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return null;
    }
    const [r] = await this.rows(
      q,
      sql`SELECT ${ORDER_COLS} FROM delivery_order d WHERE d.store_id = ${storeId} AND d.id = ${id}${sql.raw(lock ? " FOR UPDATE" : "")}`,
    );
    return r ?? null;
  }

  async byExternal(storeId: string, platform: string, externalId: string, q: Q = this.database.db) {
    const [r] = await this.rows(
      q,
      sql`SELECT d.id::text id FROM delivery_order d WHERE d.store_id = ${storeId} AND d.platform = ${platform} AND d.external_id = ${externalId}`,
    );
    return (r?.id as string) ?? null;
  }

  async lines(storeId: string, id: string, q: Q = this.database.db) {
    return this.rows(
      q,
      sql`SELECT l.line_no "lineNo", l.product_id::text "productId", p.plu, l.name, l.quantity::float8 quantity,
            l.unit_price::float8 "unitPrice", round(l.quantity * l.unit_price, 2)::float8 amount, l.note
          FROM delivery_order_line l LEFT JOIN product p ON p.id = l.product_id AND p.store_id = l.store_id
          WHERE l.store_id = ${storeId} AND l.delivery_order_id = ${id} ORDER BY l.line_no`,
    );
  }

  async events(storeId: string, id: string, q: Q = this.database.db) {
    return this.rows(
      q,
      sql`SELECT status, at, by_name "by", note FROM delivery_order_event
          WHERE store_id = ${storeId} AND delivery_order_id = ${id}
          ORDER BY at, array_position(ARRAY['pending','received','to_assign','assigned','on_route','delivered','cancelled']::varchar[], status)`,
    );
  }

  /** PLU → producto de la carta (para enlazar la línea), los que existan. */
  async productsByPlu(tx: Tx, storeId: string, plus: number[]): Promise<Map<number, string>> {
    if (!plus.length) {
      return new Map();
    }
    const rs = await this.rows(
      tx,
      sql`SELECT plu, id::text id FROM product WHERE store_id = ${storeId} AND plu = ANY(${sql.param(plus)})`,
    );
    return new Map(rs.map((r) => [Number(r.plu), r.id]));
  }

  async openPeriodId(tx: Tx, storeId: string): Promise<string | null> {
    const [r] = await this.rows(
      tx,
      sql`SELECT id::text FROM sales_period WHERE store_id = ${storeId} AND status = 'open' LIMIT 1`,
    );
    return (r?.id as string) ?? null;
  }

  async insert(
    tx: Tx,
    o: {
      id: string;
      storeId: string;
      periodId: string | null;
      platform: string;
      code: string;
      externalId: string | null;
      customerName: string;
      customerPhone: string | null;
      address: string | null;
      paymentNote: string | null;
      note: string | null;
      status: string;
      total: number;
      at: string;
    },
    lines: {
      productId: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
      note: string | null;
    }[],
  ) {
    await tx.execute(
      sql`INSERT INTO delivery_order (id, store_id, period_id, platform, code, external_id, customer_name, customer_phone, address,
            payment_note, note, status, total, received_at)
          VALUES (${o.id}, ${o.storeId}, ${o.periodId}, ${o.platform}, ${o.code}, ${o.externalId}, ${o.customerName}, ${o.customerPhone},
            ${o.address}, ${o.paymentNote}, ${o.note}, ${o.status}, ${o.total.toFixed(2)}, ${o.at})`,
    );
    let n = 0;
    for (const l of lines) {
      n++;
      await tx.execute(
        sql`INSERT INTO delivery_order_line (id, store_id, delivery_order_id, line_no, product_id, name, quantity, unit_price, note)
            VALUES (${crypto.randomUUID()}, ${o.storeId}, ${o.id}, ${n}, ${l.productId}, ${l.name}, ${String(l.quantity)}, ${l.unitPrice.toFixed(2)}, ${l.note})`,
      );
    }
  }

  async event(
    tx: Tx,
    e: {
      storeId: string;
      orderId: string;
      status: string;
      at: string;
      userId: string | null;
      by: string;
      note?: string | null;
    },
  ) {
    await tx.execute(
      sql`INSERT INTO delivery_order_event (id, store_id, delivery_order_id, status, at, user_id, by_name, note)
          VALUES (${crypto.randomUUID()}, ${e.storeId}, ${e.orderId}, ${e.status}, ${e.at}, ${e.userId}, ${e.by.slice(0, 80)}, ${e.note ?? null})`,
    );
  }

  async update(
    tx: Tx,
    storeId: string,
    id: string,
    p: {
      status: string;
      version: number;
      riderId?: string | null;
      riderName?: string | null;
      finishedAt?: string | null;
    },
  ) {
    const sets: SQL[] = [sql`status = ${p.status}`, sql`version = ${p.version}`];
    if (p.riderName !== undefined) {
      sets.push(sql`rider_id = ${p.riderId ?? null}`, sql`rider_name = ${p.riderName}`);
    }
    if (p.finishedAt !== undefined) {
      sets.push(sql`finished_at = ${p.finishedAt}`);
    }
    await tx.execute(
      sql`UPDATE delivery_order SET ${sql.join(sets, sql`, `)} WHERE store_id = ${storeId} AND id = ${id}`,
    );
  }
}
