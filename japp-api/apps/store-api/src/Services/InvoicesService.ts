import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import {
  accountTotals,
  creditTicket,
  creditTypeFor,
  fail,
  formatInvoiceNumber,
  planCredit,
  r2,
  sum,
  verifactuQrUrl,
  type CreditPlan,
  type CreditTicket,
  type Invoice,
} from "@japp/domain";
import { CLOCK, DATABASE, PRINTER, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { verifactuHash } from "../Helpers/VerifactuHelper.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { OrdersService } from "./OrdersService.js";
import { InvoicesApplication } from "../Applications/InvoicesApplication.js";
import { OrdersApplication } from "../Applications/OrdersApplication.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import type { PrinterPort } from "../Clases/Printers.js";
import { CreditModel, DAY, InvoiceIdModel, InvoicesFilterModel } from "../Models/InvoicesModels.js";

/** Lo que hace falta del abono para imprimirlo después del COMMIT. */
interface IssuedCredit {
  id: string;
  type: string;
  invoiceNumber: string;
  rectifies: string;
  issuedAt: string;
  reason: string;
  total: number;
  taxes: { rate: number; base: number; tax: number }[];
  plan: CreditPlan;
  verifactuQr: string;
  orderId: string;
}

/** En negativo, a céntimos (la rectificativa por diferencias se guarda con el signo menos). */
const neg = (n: number) => r2(-n);

/** Fin del filtro «hasta»: un día AAAA-MM-DD incluye todo ese día; una fecha ISO vale tal cual. */
const endOf = (to: string) => {
  if (DAY.test(to)) {
    return new Date(Date.parse(to) + 864e5 - 1);
  }
  return new Date(to);
};

/**
 * Funciones › Facturas: lista, detalle, reimpresión, abono (rectificativa) y estado VeriFactu.
 * El permiso se comprueba antes de validar la entrada (como siempre): por eso aquí se valida con los modelos.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(InvoicesApplication) private readonly invoices: InvoicesApplication,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OrdersApplication) private readonly repo: OrdersApplication,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(PRINTER) private readonly printer: PrinterPort,
  ) {}

  async list(se: Session, rawFrom?: string, rawTo?: string, q?: string) {
    await this.auth.require(se, "funciones.facturas");
    // AAAA-MM-DD (día entero en UTC; «hasta» incluye todo ese día) o fecha ISO completa
    const f = parse(InvoicesFilterModel, {
      from: rawFrom || undefined,
      to: rawTo || undefined,
    });
    const from = f.from ? new Date(f.from).toISOString() : undefined;
    const to = f.to ? endOf(f.to).toISOString() : undefined;
    const rows = await this.invoices.list(se.storeId, from, to, q);
    const accIds = rows.map((r) => r.i.accountId!).filter(Boolean);
    const pays = await this.invoices.paymentMethods(se.storeId, accIds);
    return {
      items: rows.map((r) => ({
        id: r.i.id,
        invoiceNumber: r.i.invoiceNumber,
        type: r.i.type,
        table: r.table ?? "",
        issuedAt: new Date(r.i.issuedAt).toISOString(),
        total: Number(r.i.total),
        customer: r.i.customerName,
        methods: [...new Set(pays.filter((p) => p.acc === r.i.accountId).map((p) => p.m))],
      })),
    };
  }

  async get(se: Session, id: string) {
    await this.auth.require(se, "funciones.facturas");
    const i = await this.invoices.get(se.storeId, parse(InvoiceIdModel, id));
    if (!i) {
      fail("NOT_FOUND", "La factura no existe", { invoiceId: id });
    }
    const taxes = await this.invoices.taxes(se.storeId, i!.id);
    return {
      id: i!.id,
      invoiceNumber: i!.invoiceNumber,
      type: i!.type,
      issuedAt: new Date(i!.issuedAt).toISOString(),
      total: Number(i!.total),
      taxBase: Number(i!.taxBase),
      taxTotal: Number(i!.taxTotal),
      customer: i!.customerTaxId ? { name: i!.customerName, taxId: i!.customerTaxId } : null,
      verifactuQr: i!.verifactuQr,
      taxes: taxes
        .map((t) => ({ rate: Number(t.rate), base: Number(t.base), tax: Number(t.tax) }))
        .sort((a, b) => a.rate - b.rate),
    };
  }

  /**
   * Reimprimir el ticket de una factura (mismo formato; queda en el historial de la mesa). Un abono (R1/R5) sale con su
   * ticket de rectificativa y sin abrir el cajón: con el de la factura saldría la original y se abriría si hubo efectivo.
   */
  async reprint(se: Session, id: string) {
    await this.auth.require(se, "funciones.facturas");
    const i = await this.invoices.ref(se.storeId, parse(InvoiceIdModel, id));
    if (!i?.orderId || !i.accountId) {
      fail("NOT_FOUND", "La factura no existe", { invoiceId: id });
    }
    let printed: boolean;
    let description = `Reimpresión de ${i!.num}`;
    if (i!.rectifiedInvoiceId) {
      printed = await this.reprintCredit(se, i!.orderId!, id, i!.rectifiedInvoiceId);
      description = `Reimpresión del abono ${i!.num}`;
    } else {
      printed = await this.orders.printInvoice(se, i!.orderId!, i!.accountId!);
    }
    const a = se.actor(this.clock());
    await this.invoices.addReprintedEvent(se.storeId, i!.orderId!, i!.accountId!, description, a);
    return { printed };
  }

  /** El abono otra vez, con lo guardado: cabecera e IVA de la rectificativa, la factura que rectifica y sus líneas. */
  private async reprintCredit(se: Session, orderId: string, creditId: string, rectifiedId: string) {
    const c = await this.invoices.get(se.storeId, creditId);
    const orig = await this.invoices.get(se.storeId, rectifiedId);
    if (!c || !orig) {
      fail("NOT_FOUND", "La factura no existe", { invoiceId: creditId });
    }
    const taxes = (await this.invoices.taxes(se.storeId, creditId))
      .map((t) => ({ rate: Number(t.rate), base: Number(t.base), tax: Number(t.tax) }))
      .sort((a, b) => a.rate - b.rate);
    return this.printCredit(se, orderId, {
      type: c!.type,
      invoiceNumber: c!.invoiceNumber,
      rectifies: orig!.invoiceNumber,
      issuedAt: new Date(c!.issuedAt).toISOString(),
      reason: c!.rectificationReason ?? null,
      lines: await this.invoices.creditLines(se.storeId, creditId),
      total: Number(c!.total),
      taxes,
      verifactuQr: c!.verifactuQr ?? "",
    });
  }

  /**
   * Abono (rectificativa por diferencias; regla planCredit en @japp/domain/credit.ts).
   * Misma transacción, bloqueos y cadena que facturar: orden FOR UPDATE → factura FOR UPDATE → bloqueo de la cadena
   * VeriFactu de la tienda → serie de abonos FOR UPDATE → invoice + invoice_tax (en negativo) + invoice_credit_line
   * + verifactu_record encadenado con la misma huella. La orden sube de versión y va a la cola (entity order) con su evento.
   * Se imprime después del COMMIT; un fallo de impresora no deshace el abono (printed: false).
   */
  async credit(se: Session, rawId: string, body: unknown) {
    const raw = (body ?? {}) as { authorization?: unknown };
    let token: string | null = null;
    if (typeof raw.authorization === "string") {
      token = raw.authorization;
    }
    await this.auth.require(se, "funciones.abonar", token);
    const id = parse(InvoiceIdModel, rawId);
    const b = parse(CreditModel, body);
    const reason = await this.creditReasonText(se, b.reasonId, b.reason);
    const ref = await this.invoices.ref(se.storeId, id);
    if (!ref?.orderId || !ref.accountId) {
      fail("NOT_FOUND", "La factura no existe", { invoiceId: rawId });
    }
    const store = await this.stores.store();
    const issued = await this.database.withTx(async (tx): Promise<IssuedCredit> => {
      const l = await this.repo.load(tx, se.storeId, ref!.orderId!, { lock: true });
      const orig = await this.invoices.lockInvoice(tx, se.storeId, id);
      const acc = l.order.accounts.find((a) => a.id === orig?.accountId);
      if (!orig || !acc) {
        fail("NOT_FOUND", "La factura no existe", { invoiceId: rawId });
      }
      const type = creditTypeFor(orig!.type);
      const done = await this.invoices.creditedSoFar(tx, se.storeId, orig!.id);
      const taxes = await this.invoices.taxes(se.storeId, orig!.id);
      const plan = planCredit(
        {
          lines: acc!.lines.map((x) => ({
            lineId: x.id,
            name: x.name,
            quantity: x.quantity,
            unitPrice: x.unitPrice,
            taxRate: x.taxRate,
            modifiers: x.modifiers,
          })),
          sub: accountTotals(acc!).sub,
          total: Number(orig!.total),
          taxes: taxes.map((t) => ({ rate: Number(t.rate), base: Number(t.base), tax: Number(t.tax) })),
          creditedQty: done.qty,
          creditedTotal: done.total,
          creditedTaxes: done.taxes,
        },
        b.lines ?? null,
      );
      // cadena VeriFactu: una factura (o abono) de la tienda cada vez; la hora se toma DESPUÉS de tener el bloqueo
      await this.repo.lockInvoiceChain(tx, se.storeId);
      const now = this.clock();
      const actor = se.actor(now);
      const series = await this.invoices.creditSeries(tx, se.storeId);
      const row = series ? await this.repo.lockSeries(tx, se.storeId, series) : undefined;
      if (!series || !row) {
        fail("NOT_FOUND", `No existe la serie de abonos ${series ?? ""}`.trim(), { series });
      }
      const sequence = row!.lastSequence + 1;
      const invoiceNumber = formatInvoiceNumber(series!, sequence);
      await this.repo.setSeriesSequence(tx, se.storeId, series!, sequence);
      const total = neg(plan.total);
      const credTaxes = plan.taxes.map((t) => ({ rate: t.rate, base: neg(t.base), tax: neg(t.tax) }));
      const base = r2(sum(credTaxes.map((t) => t.base)));
      const tax = r2(sum(credTaxes.map((t) => t.tax)));
      const verifactuQr = verifactuQrUrl(store.nif, invoiceNumber, now, total);
      // la rectificativa lleva los datos del cliente de la original (R1 de una completa)
      const customer = orig!.customerTaxId
        ? {
            id: orig!.customerId ?? undefined,
            type: (orig!.customerType ?? undefined) as "person" | "company" | undefined,
            name: orig!.customerName ?? "",
            taxId: orig!.customerTaxId,
            email: orig!.customerEmail ?? undefined,
            street: orig!.customerStreet ?? undefined,
            postalCode: orig!.customerPostalCode ?? undefined,
            city: orig!.customerCity ?? undefined,
            province: orig!.customerProvince ?? undefined,
            country: orig!.customerCountry ?? undefined,
          }
        : null;
      // insertInvoice/insertVerifactuRecord son las de facturar; el tipo (R1/R5) lo admite la base desde la migración 0010
      const inv = {
        type,
        series: series!,
        sequence,
        invoiceNumber,
        issuedAt: actor.at,
        total,
        taxes: credTaxes,
        customer,
        verifactuQr,
      } as unknown as Invoice;
      const creditId = crypto.randomUUID();
      await this.repo.insertInvoice(tx, {
        id: creditId,
        storeId: se.storeId,
        accountId: acc!.id,
        orderId: l.order.id,
        inv,
        issuer: { nif: store.nif, name: store.issuerName },
        taxBase: base.toFixed(2),
        taxTotal: tax.toFixed(2),
        actor,
      });
      await this.invoices.setRectification(tx, se.storeId, creditId, orig!.id, reason);
      await this.repo.insertInvoiceTaxes(tx, se.storeId, creditId, credTaxes);
      await this.invoices.insertCreditLines(tx, se.storeId, creditId, orig!.id, plan.lines);
      if (plan.full) {
        await this.invoices.markRectified(tx, se.storeId, orig!.id);
      }
      const prev = await this.repo.verifactuTail(tx, se.storeId);
      const hash = verifactuHash({
        nif: store.nif,
        invoiceNumber,
        issuedAt: actor.at,
        type,
        taxTotal: tax.toFixed(2),
        total: total.toFixed(2),
        previousHash: prev?.hash ?? "",
        generatedAt: actor.at,
      });
      await this.repo.insertVerifactuRecord(tx, {
        storeId: se.storeId,
        invoiceId: creditId,
        issuerTaxId: store.nif,
        inv,
        taxTotal: tax.toFixed(2),
        previous: prev,
        hash,
        generatedAt: actor.at,
      });
      // la orden de la factura: evento, versión + 1 y la transacción completa a la cola (entity order) para el Manager
      await this.repo.save(tx, se.storeId, l.order, l.order, l.header, {
        actor,
        events: [
          {
            type: "invoiceCredited",
            description: `Abono ${type} ${invoiceNumber} de ${orig!.invoiceNumber} · ${total.toFixed(2)} €`,
            accountId: acc!.id,
            actor,
          },
        ],
      });
      return {
        id: creditId,
        type,
        invoiceNumber,
        rectifies: orig!.invoiceNumber,
        issuedAt: actor.at,
        reason,
        total,
        taxes: credTaxes,
        plan,
        verifactuQr,
        orderId: l.order.id,
      };
    });
    let printed = false;
    if (b.print !== false) {
      printed = await this.printCredit(se, issued.orderId, {
        type: issued.type,
        invoiceNumber: issued.invoiceNumber,
        rectifies: issued.rectifies,
        issuedAt: issued.issuedAt,
        reason: issued.reason,
        lines: issued.plan.lines,
        total: issued.total,
        taxes: issued.taxes,
        verifactuQr: issued.verifactuQr,
      }).catch(() => false);
    }
    return {
      id: issued.id,
      type: issued.type,
      invoiceNumber: issued.invoiceNumber,
      rectifies: issued.rectifies,
      issuedAt: issued.issuedAt,
      total: issued.total,
      taxes: issued.taxes,
      lines: issued.plan.lines.map((x) => ({
        lineId: x.lineId,
        name: x.name,
        quantity: x.quantity,
        amount: x.amount,
      })),
      full: issued.plan.full,
      verifactuQr: issued.verifactuQr,
      printed,
    };
  }

  /** Motivo del abono: el de Ajustes › Motivos (tipo credit) o el texto. Hace falta uno. */
  private async creditReasonText(se: Session, reasonId?: string | null, text?: string | null) {
    if (reasonId) {
      const r = await this.invoices.creditReason(se.storeId, reasonId);
      if (!r) {
        fail("VALIDATION", "Ese motivo no es de abono", { field: "reasonId" });
      }
      return r!.name;
    }
    if (!text) {
      fail("VALIDATION", "El abono necesita motivo", { field: "reason" });
    }
    return text!;
  }

  /** Ticket del abono por la impresora de tickets de la mesa (la misma que la factura), después del COMMIT. Nunca abre el cajón. */
  private async printCredit(se: Session, orderId: string, c: CreditTicket): Promise<boolean> {
    return this.database.withTx(async (tx) => {
      const l = await this.repo.load(tx, se.storeId, orderId);
      const p = await this.orders.ticketPrinter(tx, se, orderId);
      const ctx = await this.orders.ticketCtx(tx, se, l, new Date(c.issuedAt));
      const res = await this.printer.print({
        kind: "invoice",
        channel: p.channel,
        printer: p.name,
        connection: p.connection,
        title: c.invoiceNumber,
        ticket: creditTicket(c, ctx),
      });
      return res.ok;
    });
  }

  /** Estado VeriFactu del registro de una factura (o abono). */
  async verifactu(se: Session, rawId: string) {
    await this.auth.require(se, "funciones.facturas");
    const id = parse(InvoiceIdModel, rawId);
    const i = await this.invoices.get(se.storeId, id);
    const r = i ? await this.invoices.verifactu(se.storeId, i.id) : undefined;
    if (!i || !r) {
      fail("NOT_FOUND", "La factura no existe o no tiene registro VeriFactu", { invoiceId: rawId });
    }
    let lastError: string | null = null;
    if (r!.status === "rejected" || r!.status === "accepted_with_errors") {
      lastError = r!.aeatResponse ?? null;
    }
    return {
      invoiceNumber: i!.invoiceNumber,
      type: i!.type,
      status: r!.status,
      hash: r!.hash,
      previousHash: r!.previousHash ?? null,
      generatedAt: new Date(r!.generatedAt).toISOString(),
      sentAt: r!.sentAt ? new Date(r!.sentAt).toISOString() : null,
      attempts: Number(r!.attempts),
      lastError,
    };
  }
}
