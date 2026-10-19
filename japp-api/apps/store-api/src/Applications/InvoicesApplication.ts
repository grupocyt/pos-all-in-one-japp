import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { schema as s, type Database, type Tx } from "@japp/db";
import type { Actor, CreditLine, TaxBreakdown } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

type Row = Record<string, any>;

/**
 * Facturas (invoice, invoice_tax) para Funciones › Facturas: lista, detalle, reimpresión, estado VeriFactu
 * y lo propio del abono (invoice_credit_line, rectificada). La numeración, la cadena VeriFactu y la inserción
 * de la factura son las de OrdersApplication (las mismas que al facturar).
 */
@Injectable()
export class InvoicesApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Las 500 últimas facturas con su mesa, filtradas por fecha y por texto (número, mesa o cliente). */
  async list(storeId: string, from?: string, to?: string, q?: string) {
    const conds = [eq(s.invoice.storeId, storeId)];
    if (from) {
      conds.push(gte(s.invoice.issuedAt, from));
    }
    if (to) {
      conds.push(lte(s.invoice.issuedAt, to));
    }
    if (q) {
      conds.push(
        or(
          ilike(s.invoice.invoiceNumber, `%${q}%`),
          ilike(s.orders.tableName, `%${q}%`),
          ilike(s.invoice.customerName, `%${q}%`),
        )!,
      );
    }
    return this.database.db
      .select({ i: s.invoice, table: s.orders.tableName })
      .from(s.invoice)
      .leftJoin(s.orders, eq(s.orders.id, s.invoice.orderId))
      .where(and(...conds))
      .orderBy(desc(s.invoice.issuedAt))
      .limit(500);
  }

  /** Formas de pago confirmadas de esas cuentas. */
  async paymentMethods(storeId: string, accountIds: string[]) {
    if (!accountIds.length) {
      return [];
    }
    return this.database.db
      .select({ acc: s.payment.accountId, m: s.payment.method })
      .from(s.payment)
      .where(
        and(
          eq(s.payment.storeId, storeId),
          inArray(s.payment.accountId, accountIds),
          eq(s.payment.status, "confirmed"),
        ),
      );
  }

  async get(storeId: string, invoiceId: string) {
    const [i] = await this.database.db
      .select()
      .from(s.invoice)
      .where(and(eq(s.invoice.storeId, storeId), eq(s.invoice.id, invoiceId)));
    return i;
  }

  async taxes(storeId: string, invoiceId: string) {
    return this.database.db
      .select()
      .from(s.invoiceTax)
      .where(and(eq(s.invoiceTax.storeId, storeId), eq(s.invoiceTax.invoiceId, invoiceId)));
  }

  /** Orden, cuenta y número de la factura (para reimprimirla); rectifiedInvoiceId si es un abono (R1/R5). */
  async ref(storeId: string, invoiceId: string) {
    const [i] = await this.database.db
      .select({
        orderId: s.invoice.orderId,
        accountId: s.invoice.accountId,
        num: s.invoice.invoiceNumber,
        rectifiedInvoiceId: s.invoice.rectifiedInvoiceId,
      })
      .from(s.invoice)
      .where(and(eq(s.invoice.storeId, storeId), eq(s.invoice.id, invoiceId)));
    return i;
  }

  /**
   * Lo que hace falta para volver a imprimir un abono: el número de la factura que rectifica y las líneas abonadas
   * (invoice_credit_line) con el nombre de su línea de la orden, en positivo como planCredit.
   */
  async creditLines(storeId: string, creditId: string) {
    const lines = (
      await this.database.db.execute(sql`SELECT l.name, c.quantity::text quantity, c.amount::text amount
        FROM invoice_credit_line c JOIN order_line l ON l.id = c.order_line_id AND l.store_id = c.store_id
        WHERE c.store_id = ${storeId} AND c.credit_invoice_id = ${creditId} ORDER BY l.sort_order, l.created_by_at`)
    ).rows as Row[];
    return lines.map((l) => ({
      name: l.name as string,
      quantity: Number(l.quantity),
      amount: Number(l.amount),
    }));
  }

  /** Evento «invoiceReprinted» en el historial de la mesa (description: qué se reimprimió). */
  async addReprintedEvent(
    storeId: string,
    orderId: string,
    accountId: string,
    description: string,
    a: Actor,
  ) {
    await this.database.db.insert(s.orderEvent).values({
      id: crypto.randomUUID(),
      storeId,
      orderId,
      accountId,
      type: "invoiceReprinted",
      description,
      at: a.at,
      userId: a.userId,
      userName: a.user,
      role: a.role,
      device: a.device,
      origin: a.origin,
    } as any);
  }

  /** La factura bloqueada (FOR UPDATE): dos abonos a la vez de la misma factura van de uno en uno. */
  async lockInvoice(tx: Tx, storeId: string, invoiceId: string) {
    const [i] = await tx
      .select()
      .from(s.invoice)
      .where(and(eq(s.invoice.storeId, storeId), eq(s.invoice.id, invoiceId)))
      .for("update");
    return i;
  }

  /** Serie de abonos de Ajustes › Facturación (billing_settings.series_credit). */
  async creditSeries(tx: Tx, storeId: string): Promise<string | undefined> {
    const [b] = await tx
      .select({ series: s.billingSettings.seriesCredit })
      .from(s.billingSettings)
      .where(eq(s.billingSettings.storeId, storeId));
    return b?.series;
  }

  /** Motivo de abono activo (reason.kind = 'credit') por id, o undefined. */
  async creditReason(storeId: string, reasonId: string) {
    const [r] = await this.database.db
      .select({ id: s.reason.id, name: s.reason.name })
      .from(s.reason)
      .where(
        and(
          eq(s.reason.storeId, storeId),
          eq(s.reason.id, reasonId),
          eq(s.reason.kind, "credit"),
          eq(s.reason.active, true),
        ),
      );
    return r;
  }

  /**
   * Lo ya abonado de una factura, en positivo (como lo usa planCredit): unidades por línea (invoice_credit_line),
   * total e IVA por tipo de sus rectificativas (que se guardan en negativo).
   */
  async creditedSoFar(
    tx: Tx,
    storeId: string,
    invoiceId: string,
  ): Promise<{ qty: Record<string, number>; total: number; taxes: TaxBreakdown[] }> {
    const lines = (
      await tx.execute(sql`SELECT order_line_id::text line_id, sum(quantity)::text qty FROM invoice_credit_line
        WHERE store_id = ${storeId} AND rectified_invoice_id = ${invoiceId} GROUP BY order_line_id`)
    ).rows as Row[];
    const [t] = (
      await tx.execute(sql`SELECT coalesce(-sum(total), 0)::text total FROM invoice
        WHERE store_id = ${storeId} AND rectified_invoice_id = ${invoiceId} AND status <> 'cancelled'`)
    ).rows as Row[];
    const taxes = (
      await tx.execute(sql`SELECT t.rate::text rate, (-sum(t.base))::text base, (-sum(t.tax))::text tax FROM invoice_tax t
        JOIN invoice i ON i.id = t.invoice_id AND i.store_id = t.store_id
        WHERE t.store_id = ${storeId} AND i.rectified_invoice_id = ${invoiceId} AND i.status <> 'cancelled' GROUP BY t.rate ORDER BY t.rate`)
    ).rows as Row[];
    return {
      qty: Object.fromEntries(lines.map((l) => [l.line_id as string, Number(l.qty)])),
      total: Number(t?.total ?? 0),
      taxes: taxes.map((x) => ({ rate: Number(x.rate), base: Number(x.base), tax: Number(x.tax) })),
    };
  }

  /** La rectificativa apunta a la factura que rectifica, con el motivo. */
  async setRectification(tx: Tx, storeId: string, creditId: string, rectifiedId: string, reason: string) {
    await tx
      .update(s.invoice)
      .set({ rectifiedInvoiceId: rectifiedId, rectificationReason: reason } as any)
      .where(and(eq(s.invoice.storeId, storeId), eq(s.invoice.id, creditId)));
  }

  /** Líneas abonadas (en positivo; el total de la rectificativa va en negativo). */
  async insertCreditLines(
    tx: Tx,
    storeId: string,
    creditId: string,
    rectifiedId: string,
    lines: CreditLine[],
  ) {
    for (const l of lines) {
      await tx.insert(s.invoiceCreditLine).values({
        storeId,
        creditInvoiceId: creditId,
        rectifiedInvoiceId: rectifiedId,
        orderLineId: l.lineId,
        quantity: String(l.quantity),
        amount: l.amount.toFixed(2),
        taxRate: l.taxRate.toFixed(2),
      } as any);
    }
  }

  /** La factura abonada entera pasa a «rectified». */
  async markRectified(tx: Tx, storeId: string, invoiceId: string) {
    await tx
      .update(s.invoice)
      .set({ status: "rectified" } as any)
      .where(and(eq(s.invoice.storeId, storeId), eq(s.invoice.id, invoiceId)));
  }

  /** Registro VeriFactu (alta) de la factura, el último si hubiera varios; undefined si no tiene. */
  async verifactu(storeId: string, invoiceId: string) {
    const [r] = await this.database.db
      .select()
      .from(s.verifactuRecord)
      .where(
        and(
          eq(s.verifactuRecord.storeId, storeId),
          eq(s.verifactuRecord.invoiceId, invoiceId),
          eq(s.verifactuRecord.recordType, "alta"),
        ),
      )
      .orderBy(desc(s.verifactuRecord.generatedAt))
      .limit(1);
    return r;
  }
}
