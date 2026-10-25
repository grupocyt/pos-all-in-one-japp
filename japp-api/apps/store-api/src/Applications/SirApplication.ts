import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

const rows = async <T = any>(db: Database["db"], query: ReturnType<typeof sql>) =>
  (await db.execute(query)).rows as T[];

/** Interfaz de ventas al SIR: lo que hace falta de la base para un periodo (las cuentas las hace sirSales en @japp/domain). */
@Injectable()
export class SirApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private get db() {
    return this.database.db;
  }

  /** El periodo pedido o, sin id, el último cerrado. */
  async period(storeId: string, periodId?: string) {
    const [p] = await rows<{ id: string; status: string; opened_at: Date; closed_at: Date | null }>(
      this.db,
      periodId
        ? sql`SELECT id::text id, status, opened_by_at opened_at, closed_by_at closed_at FROM sales_period WHERE store_id = ${storeId} AND id = ${periodId}`
        : sql`SELECT id::text id, status, opened_by_at opened_at, closed_by_at closed_at FROM sales_period WHERE store_id = ${storeId} AND status = 'closed' ORDER BY closed_by_at DESC LIMIT 1`,
    );
    return p;
  }

  async store(storeId: string) {
    const [s] = await rows<{ code: string; rst: number | null; sir_url: string | null }>(
      this.db,
      sql`SELECT code, maxpoint_rst_id rst, sir_url FROM store WHERE id = ${storeId}`,
    );
    return s;
  }

  /** Cod_FormaPago de los descuentos: el id de integración de la forma de pago de tipo «discount» (activa). */
  async discountCode(storeId: string) {
    const [r] = await rows<{ code: string | null }>(
      this.db,
      sql`SELECT coalesce(nullif(external_id, ''), code) code FROM payment_method WHERE store_id = ${storeId} AND kind = 'discount' AND active ORDER BY created_at LIMIT 1`,
    );
    return r?.code ?? null;
  }

  /** Facturas del periodo (también rectificativas), con su base al 0 % y el descuento de la cuenta. */
  async invoices(storeId: string, periodId: string) {
    return rows<{
      id: string;
      type: string;
      total: number;
      tax_base: number;
      tax_total: number;
      zero_base: number;
      discount: number;
      issued_at: Date;
      issued_by: string;
    }>(
      this.db,
      sql`SELECT i.id::text id, i.type, i.total::float8 total, i.tax_base::float8 tax_base, i.tax_total::float8 tax_total,
          coalesce((SELECT sum(t.base) FROM invoice_tax t WHERE t.invoice_id = i.id AND t.store_id = i.store_id AND t.rate = 0), 0)::float8 zero_base,
          CASE WHEN i.type LIKE 'R%' THEN 0 ELSE coalesce(a.discount_total, 0) END::float8 discount,
          i.issued_at, i.issued_by_user_name issued_by
        FROM invoice i JOIN orders o ON o.id = i.order_id AND o.store_id = i.store_id
        LEFT JOIN account a ON a.id = i.account_id AND a.store_id = i.store_id
        WHERE i.store_id = ${storeId} AND o.period_id = ${periodId} AND i.status <> 'cancelled'
        ORDER BY i.issued_at`,
    );
  }

  /** Cobros confirmados de las cuentas facturadas del periodo: quién cobró y el código de la forma de pago para el SIR. */
  async payments(storeId: string, periodId: string) {
    return rows<{ user: string; method: string; amount: number }>(
      this.db,
      sql`SELECT p.collected_by_user_name "user", coalesce(nullif(pm.external_id, ''), pm.code, p.method) method, p.amount::float8 amount
        FROM payment p JOIN account a ON a.id = p.account_id AND a.store_id = p.store_id
        JOIN orders o ON o.id = a.order_id AND o.store_id = a.store_id
        LEFT JOIN payment_method pm ON pm.id = p.payment_method_id AND pm.store_id = p.store_id
        WHERE p.store_id = ${storeId} AND o.period_id = ${periodId} AND p.status = 'confirmed' AND a.status = 'invoiced'`,
    );
  }

  /** Líneas facturadas del periodo (sin borradas) con sus respuestas, lo abonado de cada una y el factor de descuento de la cuenta. */
  async lines(storeId: string, periodId: string) {
    return rows<{
      id: string;
      plu: number | null;
      quantity: number;
      unit_price: number;
      tax_rate: number;
      factor: number;
      credited: number;
      mods: { plu: number | null; quantity: number; unit_price: number }[];
    }>(
      this.db,
      sql`SELECT l.id::text id, l.plu, l.quantity::float8 quantity, l.unit_price::float8 unit_price, l.tax_rate::float8 tax_rate,
          CASE WHEN a.subtotal > 0 THEN (a.total / a.subtotal)::float8 ELSE 1 END factor,
          coalesce((SELECT sum(c.quantity) FROM invoice_credit_line c WHERE c.order_line_id = l.id AND c.store_id = l.store_id), 0)::float8 credited,
          coalesce((SELECT json_agg(json_build_object('plu', m.plu, 'quantity', m.quantity::float8, 'unit_price', m.unit_price::float8))
            FROM order_line_modifier m WHERE m.line_id = l.id AND m.store_id = l.store_id), '[]'::json) mods
        FROM order_line l JOIN account a ON a.id = l.account_id AND a.store_id = l.store_id
        JOIN orders o ON o.id = l.order_id AND o.store_id = l.store_id
        WHERE l.store_id = ${storeId} AND o.period_id = ${periodId} AND NOT l.deleted AND a.status = 'invoiced'`,
    );
  }

  /** Sesiones de los usuarios dentro del periodo (desde la apertura hasta el cierre o ahora). */
  async sessions(storeId: string, from: Date, to: Date) {
    return rows<{ user_id: string; user: string; start: Date; end: Date }>(
      this.db,
      sql`SELECT s.user_id::text user_id, u.name "user", greatest(s.created_at, ${from}::timestamptz) start,
          least(coalesce(s.ended_at, s.expires_at), ${to}::timestamptz) "end"
        FROM app_session s JOIN app_user u ON u.id = s.user_id AND u.store_id = s.store_id
        WHERE s.store_id = ${storeId} AND s.created_at < ${to}::timestamptz AND coalesce(s.ended_at, s.expires_at) > ${from}::timestamptz`,
    );
  }
}
