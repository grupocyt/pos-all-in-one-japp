import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import type { PeriodSummary } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

type Q = Tx | Database["db"];
const rows = async <T = any>(q: Q, query: ReturnType<typeof sql>) => (await q.execute(query)).rows as T[];

/** Lo que hace falta de la base para resumir un periodo (las cuentas las hace summarizePeriod en @japp/domain). */
export interface PeriodData {
  inv: any[];
  pays: any[];
  deleted: any[];
  discountAmount: number;
}

/**
 * Gestor de cierres en la base: period_summary (resumen guardado al cerrar), sales_target (objetivos),
 * sync_outbox y sync_state (estado de la sincronización). SQL crudo; q es la transacción o la base.
 */
/** Cuenta en precuenta: tiene líneas vivas y todas están en precuenta (la misma regla que GET /tables → bill). */
const PRE_BILL = sql`EXISTS (SELECT 1 FROM order_line x WHERE x.account_id = a.id AND x.store_id = a.store_id AND NOT x.deleted)
  AND NOT EXISTS (SELECT 1 FROM order_line x WHERE x.account_id = a.id AND x.store_id = a.store_id AND NOT x.deleted AND x.status <> 'preBill')`;

@Injectable()
export class ClosingsApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Productos más vendidos del periodo: líneas vivas de cuentas facturadas menos lo abonado de ellas (invoice_credit_line).
   * amount = importe de las líneas (sin el descuento de la cuenta) menos el importe abonado.
   */
  /**
   * Venta del día (v186): mesas abiertas del periodo con lo ya marcado sin facturar, por mesa: camarero (quien abrió),
   * comensales, total con IVA y lo cobrado a cuenta. Cuentas anuladas o facturadas fuera (lo facturado ya está en el resumen).
   */
  async openOrders(storeId: string, periodId: string) {
    // pre_bill: lo de las cuentas en precuenta (todas sus líneas vivas en precuenta), como GET /tables → bill
    return rows<{ order_id: string; waiter: string; guests: number; total: number; paid: number; pre_bill: number }>(
      this.db,
      sql`SELECT o.id::text order_id, o.opened_by_user_name waiter, o.guests::int guests,
          coalesce(sum(a.total), 0)::float8 total, coalesce(sum(a.paid), 0)::float8 paid,
          coalesce(sum(a.total) FILTER (WHERE ${PRE_BILL}), 0)::float8 pre_bill
        FROM orders o JOIN account a ON a.order_id = o.id AND a.store_id = o.store_id
        WHERE o.store_id = ${storeId} AND o.period_id = ${periodId} AND o.status IN ('open','billing')
          AND a.status NOT IN ('cancelled','invoiced')
        GROUP BY o.id, o.opened_by_user_name, o.guests`,
    );
  }

  /** Facturas rectificativas (R1–R5) del periodo: cuántas y su importe (negativo o positivo según se guarde; se usa en valor absoluto). */
  async creditsOf(storeId: string, periodId: string) {
    const [r] = await rows<{ n: number; amount: number }>(
      this.db,
      sql`SELECT count(*)::int n, coalesce(sum(i.total), 0)::float8 amount FROM invoice i JOIN orders o ON o.id = i.order_id AND o.store_id = i.store_id
        WHERE i.store_id = ${storeId} AND o.period_id = ${periodId} AND i.status <> 'cancelled' AND i.type LIKE 'R%'`,
    );
    return r ?? { n: 0, amount: 0 };
  }

  /** Lo marcado en mesas abiertas del periodo por hora (Madrid) en que se marcó, con IVA y antes de descuentos. */
  async openByHour(storeId: string, periodId: string) {
    return rows<{ hour: number; amount: number; pre_bill: number }>(
      this.db,
      sql`SELECT extract(hour FROM l.created_by_at AT TIME ZONE 'Europe/Madrid')::int AS hour, sum(l.net_amount)::float8 AS amount,
          coalesce(sum(l.net_amount) FILTER (WHERE ${PRE_BILL}), 0)::float8 AS pre_bill
        FROM order_line l JOIN account a ON a.id = l.account_id AND a.store_id = l.store_id
        JOIN orders o ON o.id = l.order_id AND o.store_id = l.store_id
        WHERE l.store_id = ${storeId} AND o.period_id = ${periodId} AND o.status IN ('open','billing')
          AND a.status NOT IN ('cancelled','invoiced') AND NOT l.deleted
        GROUP BY 1 ORDER BY 1`,
    );
  }

  /** Venta por hora de los últimos cierres del mismo día de la semana (ISO, 1 = lunes) antes de una fecha. */
  async historyByHour(storeId: string, isoDow: number, before: string, limit = 8) {
    return rows<{ by_hour: Record<string, number> | null }>(
      this.db,
      sql`SELECT by_hour FROM period_summary WHERE store_id = ${storeId} AND extract(isodow FROM business_date)::int = ${isoDow}
        AND business_date < ${before}::date AND gross_sales > 0 ORDER BY business_date DESC LIMIT ${sql.raw(String(Math.trunc(limit)))}`,
    );
  }

  /** Productos más vendidos del periodo: lo facturado (menos lo abonado) y lo marcado en mesas abiertas (v186). */
  async topProducts(storeId: string, periodId: string, limit: number) {
    return rows<{ plu: number | null; name: string; quantity: number; amount: number }>(
      this.db,
      sql`WITH sold AS (
          SELECT l.plu, l.name, sum(l.quantity) qty, sum(l.net_amount) amount FROM order_line l
          JOIN account a ON a.id = l.account_id AND a.store_id = l.store_id
          JOIN orders o ON o.id = l.order_id AND o.store_id = l.store_id
          WHERE l.store_id = ${storeId} AND o.period_id = ${periodId} AND NOT l.deleted
            AND (a.status = 'invoiced' OR (o.status IN ('open','billing') AND a.status NOT IN ('cancelled','invoiced')))
          GROUP BY l.plu, l.name
        ), cred AS (
          SELECT l.plu, l.name, sum(c.quantity) qty, sum(c.amount) amount FROM invoice_credit_line c
          JOIN order_line l ON l.id = c.order_line_id AND l.store_id = c.store_id
          JOIN orders o ON o.id = l.order_id AND o.store_id = l.store_id
          WHERE c.store_id = ${storeId} AND o.period_id = ${periodId}
          GROUP BY l.plu, l.name
        )
        SELECT s.plu, s.name, (s.qty - coalesce(c.qty, 0))::float8 quantity, (s.amount - coalesce(c.amount, 0))::float8 amount
        FROM sold s LEFT JOIN cred c ON c.plu IS NOT DISTINCT FROM s.plu AND c.name = s.name
        WHERE s.qty - coalesce(c.qty, 0) > 0
        ORDER BY quantity DESC, amount DESC, s.name LIMIT ${sql.raw(String(Math.trunc(limit)))}`,
    );
  }

  /** Apertura del periodo (o undefined si no existe). tx null = fuera de transacción. */
  async periodOpenedAt(tx: Tx | null, storeId: string, periodId: string) {
    const [p] = await rows(
      tx ?? this.db,
      sql`SELECT opened_by_at FROM sales_period WHERE id = ${periodId} AND store_id = ${storeId}`,
    );
    return p as { opened_by_at: string } | undefined;
  }

  /** Facturas, cobros, eliminadas (con sus modificadores) y descuentos del periodo, en este orden. */
  async periodData(tx: Tx | null, storeId: string, periodId: string): Promise<PeriodData> {
    const q: Q = tx ?? this.db;
    const inv = await rows(
      q,
      sql`SELECT i.issued_at, i.total::float8 total, i.tax_base::float8 base, i.tax_total::float8 tax, i.type, o.opened_by_user_name waiter, o.opened_by_user_id::text waiter_id, o.table_name, o.id::text order_id, o.guests
      FROM invoice i JOIN orders o ON o.id = i.order_id WHERE i.store_id = ${storeId} AND o.period_id = ${periodId} AND i.status <> 'cancelled' ORDER BY i.issued_at`,
    );
    const pays = await rows(
      q,
      sql`SELECT p.method, pm.kind, p.amount::float8 amount, coalesce(p.tip, 0)::float8 tip FROM payment p
      JOIN account a ON a.id = p.account_id AND a.store_id = p.store_id JOIN orders o ON o.id = a.order_id AND o.store_id = p.store_id LEFT JOIN payment_method pm ON pm.id = p.payment_method_id AND pm.store_id = p.store_id
      WHERE p.store_id = ${storeId} AND o.period_id = ${periodId} AND p.status = 'confirmed'`,
    );
    // eliminadas con sus modificadores: el servicio aplica voidsOf (sin «Pasada a…» ni «Incluida en menú»)
    const deleted = await rows(
      q,
      sql`SELECT l.id::text id, l.deleted_by_at, l.name, l.quantity::text quantity, l.unit_price::text unit_price, l.delete_reason, l.deleted_stage, l.printed, l.deleted_by_user_name, l.delete_authorized_by_user_name, o.opened_by_user_name waiter, o.opened_by_user_id::text waiter_id,
        coalesce((SELECT json_agg(json_build_object('unitPrice', m.unit_price::text, 'quantity', m.quantity::text)) FROM order_line_modifier m WHERE m.line_id = l.id AND m.store_id = l.store_id), '[]') mods
      FROM order_line l JOIN orders o ON o.id = l.order_id AND o.store_id = l.store_id WHERE l.store_id = ${storeId} AND o.period_id = ${periodId} AND l.deleted ORDER BY l.deleted_by_at`,
    );
    const [disc] = await rows(
      q,
      sql`SELECT coalesce(sum(d.amount), 0)::float8 n FROM account_discount d JOIN account a ON a.id = d.account_id JOIN orders o ON o.id = a.order_id
      WHERE d.store_id = ${storeId} AND o.period_id = ${periodId} AND d.status = 'applied' AND a.status <> 'cancelled'`,
    );
    return { inv, pays, deleted, discountAmount: disc?.n ?? 0 };
  }

  /** Guarda el resumen del periodo cerrado. */
  async insertSummary(
    tx: Tx,
    storeId: string,
    periodId: string,
    s: PeriodSummary & { openedAt: string },
    closedAt: string,
    closedBy: string,
  ) {
    const id = crypto.randomUUID();
    await tx.execute(sql`INSERT INTO period_summary (id, store_id, period_id, business_date, opened_at, closed_at, gross_sales, tax_base, tax_total, tickets, guests, cash_amount, card_amount, other_amount, tips,
      discount_amount, voids_count, voids_amount, cash_difference, by_hour, by_waiter, by_payment, voids, closed_by_user_name)
      VALUES (${id}, ${storeId}, ${periodId}, ${s.businessDate}, ${s.openedAt}, ${closedAt}, ${s.grossSales.toFixed(2)}, ${s.taxBase.toFixed(2)}, ${s.taxTotal.toFixed(2)}, ${s.tickets}, ${s.guests},
        ${s.cashAmount.toFixed(2)}, ${s.cardAmount.toFixed(2)}, ${s.otherAmount.toFixed(2)}, ${s.tips.toFixed(2)}, ${s.discountAmount.toFixed(2)}, ${s.voidsCount}, ${s.voidsAmount.toFixed(2)}, ${s.cashDifference.toFixed(2)},
        ${JSON.stringify(s.byHour)}::jsonb, ${JSON.stringify(s.byWaiter)}::jsonb, ${JSON.stringify(s.byPayment)}::jsonb, ${JSON.stringify(s.voids)}::jsonb, ${closedBy})`);
  }

  /** «period.closed» a la cola hacia el Manager. */
  async enqueuePeriodClosed(tx: Tx, storeId: string, periodId: string, payload: unknown) {
    await tx.execute(
      sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES (${storeId}, 'period.closed', ${periodId}, 'upsert', ${JSON.stringify(payload)}::jsonb)`,
    );
  }

  /** Id del periodo abierto, o undefined. */
  async openPeriodId(storeId: string) {
    const [p] = await rows(
      this.db,
      sql`SELECT id::text FROM sales_period WHERE store_id = ${storeId} AND open_flag = 1`,
    );
    return p?.id as string | undefined;
  }

  /** Resúmenes guardados entre dos días de negocio, del más reciente al más antiguo. */
  async savedBetween(storeId: string, from: string, to: string) {
    return rows(
      this.db,
      sql`SELECT ps.*, ps.period_id::text period_id, ps.business_date::text business_date FROM period_summary ps WHERE ps.store_id = ${storeId} AND ps.business_date BETWEEN ${from} AND ${to} ORDER BY ps.business_date DESC, ps.closed_at DESC`,
    );
  }

  /** Venta por día de negocio entre dos fechas. */
  async salesByDay(storeId: string, from: string, to: string) {
    return rows<{ d: string; s: number }>(
      this.db,
      sql`SELECT business_date::text d, sum(gross_sales)::float8 s FROM period_summary WHERE store_id = ${storeId} AND business_date BETWEEN ${from} AND ${to} GROUP BY business_date`,
    );
  }

  /** Resumen guardado de un periodo, o undefined. */
  async savedOf(storeId: string, periodId: string) {
    const [r] = await rows(
      this.db,
      sql`SELECT ps.*, ps.period_id::text period_id, ps.business_date::text business_date FROM period_summary ps WHERE ps.store_id = ${storeId} AND ps.period_id = ${periodId}`,
    );
    return r;
  }

  /** Venta y tickets de un día de negocio (para «el año anterior»). */
  async dayTotals(storeId: string, date: string) {
    const [p] = await rows(
      this.db,
      sql`SELECT sum(gross_sales)::float8 s, sum(tickets)::int t FROM period_summary WHERE store_id = ${storeId} AND business_date = ${date}`,
    );
    return p as { s: number | null; t: number | null } | undefined;
  }

  /** Venta por día del año anterior y del año pedido, con una semana de margen a cada lado. */
  async salesForWeeks(storeId: string, year: number) {
    return rows<{ date: string; sales: number }>(
      this.db,
      sql`SELECT business_date::text date, sum(gross_sales)::float8 sales FROM period_summary WHERE store_id = ${storeId}
      AND business_date BETWEEN ${`${year - 1}-01-01`}::date - 7 AND ${`${year}-12-31`}::date + 7 GROUP BY business_date`,
    );
  }

  /** Objetivos del año (semana 0 = crecimiento general). */
  async targets(storeId: string, year: number) {
    return rows<{ week: number; g: number; a: number }>(
      this.db,
      sql`SELECT week, growth_pct::float8 g, amount::float8 a FROM sales_target WHERE store_id = ${storeId} AND year = ${year}`,
    );
  }

  /** Mesas abiertas y lo pendiente de cobrar en ellas. */
  async openTables(storeId: string) {
    const [open] = await rows<{ tables: number; amount: number }>(
      this.db,
      sql`SELECT count(DISTINCT o.id)::int tables, coalesce(sum(a.pending), 0)::float8 amount FROM orders o JOIN account a ON a.order_id = o.id
      WHERE o.store_id = ${storeId} AND o.status IN ('open','billing') AND a.status NOT IN ('cancelled','invoiced')`,
    );
    return open;
  }

  /** Mensajes de la cola sin enviar ni apartar. */
  async outboxPending(storeId: string) {
    const [pend] = await rows<{ n: number }>(
      this.db,
      sql`SELECT count(*)::int n FROM sync_outbox WHERE store_id = ${storeId} AND sent_at IS NULL AND parked_at IS NULL`,
    );
    return pend;
  }

  /** Cuenta de la cola: pendientes, apartados, enviados y el pendiente más antiguo. */
  async outboxCounts(storeId: string) {
    const [q] = await rows(
      this.db,
      sql`SELECT count(*) FILTER (WHERE sent_at IS NULL AND parked_at IS NULL)::int pending, count(*) FILTER (WHERE parked_at IS NOT NULL)::int parked,
      count(*) FILTER (WHERE sent_at IS NOT NULL)::int sent, min(created_at) FILTER (WHERE sent_at IS NULL AND parked_at IS NULL) oldest FROM sync_outbox WHERE store_id = ${storeId}`,
    );
    return q;
  }

  /** Pendientes por entidad. */
  async outboxByEntity(storeId: string) {
    return rows(
      this.db,
      sql`SELECT entity, count(*)::int count FROM sync_outbox WHERE store_id = ${storeId} AND sent_at IS NULL AND parked_at IS NULL GROUP BY entity ORDER BY entity`,
    );
  }

  /** Estado del agente de sincronización (último envío, pulso, latido y error). */
  async syncState(storeId: string) {
    const [s] = await rows(this.db, sql`SELECT * FROM sync_state WHERE store_id = ${storeId}`);
    return s;
  }

  /** Los 20 últimos mensajes de la cola. */
  async outboxLatest(storeId: string) {
    return rows(
      this.db,
      sql`SELECT id::int seq, event_id::text "eventId", entity, created_at, sent_at, attempts, last_error, parked_at FROM sync_outbox WHERE store_id = ${storeId} ORDER BY id DESC LIMIT 20`,
    );
  }
}
