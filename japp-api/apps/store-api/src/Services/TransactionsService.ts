import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Database } from "@japp/db";
import {
  deletedStageOf,
  fail,
  isMovedOrAbsorbed,
  isRectificative,
  madridDay,
  paymentKind,
  r2,
  sum,
  voidAmount,
} from "@japp/domain";
import { CLOCK, CONFIG, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Config } from "../Properties/AppSettings.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { TransactionsApplication } from "../Applications/TransactionsApplication.js";
import { AuthorizationService } from "./AuthorizationService.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { SendTransactionsModel } from "../Models/TransactionsModels.js";

export type DayType = "all" | "invoices" | "credits" | "open" | "cancelled";
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const who = (r: any, p: string) =>
  r[`${p}_user_name`]
    ? {
        user: r[`${p}_user_name`],
        role: r[`${p}_role`] ?? null,
        device: r[`${p}_device`] ?? null,
        at: iso(r[`${p}_at`]),
      }
    : null;
const STAGE: Record<string, string> = {
  pendingPrint: "sin enviar",
  printed: "impreso",
  preBill: "precuenta",
};

/**
 * Transacciones del día para el Manager: cada CUENTA con su mesa, líneas (PLU, nombre, PVP, hora, quién la marcó, opciones),
 * eliminaciones (en qué momento, quién y quién autorizó), descuentos, cobros (forma de pago y quién cobró), factura y el historial.
 * El día es el de negocio (fecha de apertura del periodo en Madrid), igual que el Gestor de cierres.
 */
@Injectable()
export class TransactionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TransactionsApplication) private readonly txs: TransactionsApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
  ) {}

  /** GET /transactions/day (con su permiso). */
  async dayFor(se: Session, date?: string, type?: string) {
    await this.auth.require(se, "funciones.informes");
    return this.day(se.storeId, date, (type ?? "all") as DayType);
  }

  /** POST /sync/transactions: primero el permiso y luego la forma del cuerpo (como siempre). */
  async sendFor(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.devsync");
    const b = parse(SendTransactionsModel, body);
    return this.send(se.storeId, b.date, b.type);
  }

  async day(storeId: string, date?: string, type: DayType = "all") {
    const d = date ?? madridDay(this.clock()).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      fail("VALIDATION", "Fecha no válida (AAAA-MM-DD)", { field: "date" });
    }
    if (!["all", "invoices", "credits", "open", "cancelled"].includes(type)) {
      fail("VALIDATION", "type = all, invoices, credits, open o cancelled", { field: "type" });
    }
    const st = await this.stores.store();
    // periodos de ese día de negocio (apertura en hora de Madrid); margen de un día por la zona horaria
    const periods = (await this.txs.periodsAround(storeId, d)).filter(
      (p) => madridDay(new Date(p.opened_by_at)).date === d,
    );
    const pids = periods.map((p) => p.id);
    const empty = {
      date: d,
      store: { id: storeId, code: st.code, name: st.name },
      type,
      periods: periods.map((p) => ({
        id: p.id,
        status: p.status,
        openedAt: iso(p.opened_by_at),
        closedAt: iso(p.closed_by_at),
      })),
      counts: { invoices: 0, credits: 0, open: 0, cancelled: 0 },
      totals: { invoiced: 0, credited: 0, open: 0 },
      items: [] as any[],
    };
    if (!pids.length) {
      return empty;
    }
    const orders = await this.txs.orders(storeId, pids);
    if (!orders.length) {
      return empty;
    }
    const { accounts, lines, mods, pays, discs, invs, taxes, evs } = await this.txs.ordersData(
      storeId,
      orders.map((o) => o.id),
    );

    const oById = new Map(orders.map((o) => [o.id, o]));
    const lineView = (l: any) => ({
      lineId: l.id,
      plu: l.plu,
      productName: l.name,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      taxRate: Number(l.tax_rate),
      amount: r2(Number(l.net_amount ?? Number(l.quantity) * Number(l.unit_price))),
      comment: l.comment ?? null,
      status: l.status,
      createdAt: iso(l.created_by_at),
      createdBy: who(l, "created_by"),
      courses: l.courses ?? null,
      origin: l.origin ?? null,
      options: mods
        .filter((m) => m.line_id === l.id)
        .map((m) => ({
          plu: m.plu ?? null,
          name: m.name,
          quantity: m.quantity,
          unitPrice: m.unit_price,
          course: m.course ?? null,
        })),
    });
    const items: any[] = [];
    const add = (kind: string, acc: any, inv: any | null) => {
      const o = oById.get(acc.order_id)!;
      const ls = lines.filter((l) => l.account_id === acc.id);
      items.push({
        id: inv ? inv.id : acc.id,
        kind,
        orderId: o.id,
        accountId: acc.id,
        periodId: o.period_id,
        table: {
          id: o.table_id ?? null,
          number: o.table_number ?? o.table_name,
          name: o.table_name,
          area: o.area_name ?? o.zone ?? null,
          priceList: o.price_list,
          guests: o.guests,
          note: o.note ?? null,
          openedBy: who(o, "opened_by"),
          closedAt: iso(o.closed_at),
          status: o.status,
        },
        account: {
          id: acc.id,
          name: acc.name,
          status: acc.status,
          openedBy: who(acc, "opened_by"),
          closedBy: who(acc, "closed_by"),
        },
        invoice: inv
          ? {
              number: inv.invoice_number,
              type: inv.type,
              series: inv.series,
              sequence: inv.sequence,
              issuedAt: iso(inv.issued_at),
              issuedBy: who(inv, "issued_by"),
              taxBase: Number(inv.tax_base),
              taxTotal: Number(inv.tax_total),
              total: Number(inv.total),
              status: inv.status,
              verifactuQr: inv.verifactu_qr ?? null,
              customer: inv.customer_tax_id
                ? {
                    taxId: inv.customer_tax_id,
                    name: inv.customer_name,
                    email: inv.customer_email ?? null,
                    address:
                      [inv.customer_street, inv.customer_postal_code, inv.customer_city]
                        .filter(Boolean)
                        .join(", ") || null,
                  }
                : null,
              rectifies: inv.rectified_number
                ? { number: inv.rectified_number, reason: inv.rectification_reason ?? null }
                : null,
              taxes: taxes
                .filter((x) => x.invoice_id === inv.id)
                .map((x) => ({ rate: Number(x.rate), base: Number(x.base), tax: Number(x.tax) }))
                .sort((a, b) => a.rate - b.rate),
            }
          : null,
        lines: ls.filter((l) => !l.deleted).map(lineView),
        // eliminaciones con su momento (regla de @japp/domain): sin las pasadas a otra cuenta; importe con modificadores
        deletedLines: ls
          .filter((l) => l.deleted && !String(l.delete_reason ?? "").startsWith("Pasada a "))
          .map((l) => {
            const stage = deletedStageOf({ stage: l.deleted_stage, printed: l.printed });
            const amount = voidAmount({
              quantity: Number(l.quantity),
              unitPrice: Number(l.unit_price),
              modifiers: mods
                .filter((m) => m.line_id === l.id)
                .map((m) => ({ unitPrice: m.unit_price, quantity: m.quantity })),
            });
            return {
              ...lineView(l),
              amount,
              stage,
              stageLabel: STAGE[stage],
              isVoid: stage !== "pendingPrint" && !isMovedOrAbsorbed(l.delete_reason),
              reason: l.delete_reason ?? null,
              deletedBy: who(l, "deleted_by"),
              authorizedBy: who(l, "delete_authorized_by"),
            };
          }),
        discounts: discs
          .filter((x) => x.account_id === acc.id)
          .map((x) => ({
            type: x.type,
            value: Number(x.value),
            amount: Number(x.amount),
            reason: x.reason ?? null,
            status: x.status,
            appliedBy: who(x, "applied_by"),
            authorizedBy: who(x, "authorized_by"),
            removedBy: who(x, "removed_by"),
          })),
        payments: pays
          .filter((x) => x.account_id === acc.id)
          .map((x) => ({
            method: x.method,
            methodName: x.method_name ?? x.method,
            kind: paymentKind(x.method_kind, x.method),
            amount: Number(x.amount),
            tip: Number(x.tip ?? 0),
            cashGiven: x.cash_given == null ? null : Number(x.cash_given),
            change: x.change_given == null ? null : Number(x.change_given),
            status: x.status,
            collectedBy: who(x, "collected_by"),
          })),
        totals: {
          subtotal: Number(acc.subtotal),
          discount: Number(acc.discount_total),
          total: Number(acc.total),
          paid: Number(acc.paid),
          pending: Number(acc.pending),
          tips: Number(acc.tips),
        },
        events: evs
          .filter((e) => e.order_id === o.id && (!e.account_id || e.account_id === acc.id))
          .map((e) => ({
            at: iso(e.at),
            type: e.type,
            description: e.description,
            user: e.user_name ?? null,
            role: e.role ?? null,
            device: e.device ?? null,
          })),
      });
    };
    for (const acc of accounts) {
      const accInvs = invs.filter((i) => i.account_id === acc.id);
      const sale = accInvs.find((i) => !isRectificative(i.type));
      if (sale && (type === "all" || type === "invoices")) {
        add("invoice", acc, sale);
      }
      for (const cr of accInvs.filter((i) => isRectificative(i.type))) {
        if (type === "all" || type === "credits") {
          add("credit", acc, cr);
        }
      }
      if (!sale && acc.status === "cancelled" && (type === "all" || type === "cancelled")) {
        add("cancelled", acc, null);
      }
      if (!sale && acc.status !== "cancelled" && (type === "all" || type === "open")) {
        add("open", acc, null);
      }
    }
    const n = (k: string) => items.filter((i) => i.kind === k).length;
    return {
      ...empty,
      counts: { invoices: n("invoice"), credits: n("credit"), open: n("open"), cancelled: n("cancelled") },
      totals: {
        invoiced: r2(sum(items.filter((i) => i.kind === "invoice").map((i) => i.invoice.total))),
        credited: r2(sum(items.filter((i) => i.kind === "credit").map((i) => i.invoice.total))),
        open: r2(sum(items.filter((i) => i.kind === "open").map((i) => i.totals.pending))),
      },
      items,
    };
  }

  /**
   * Enviar al Manager: cada transacción va a la cola (sync_outbox, entity «transaction») salvo que ya esté igual en ella
   * (mismo contenido = mismo hash → no se duplica). Si hay MANAGER_URL se manda además al momento.
   */
  async send(storeId: string, date?: string, type: DayType = "all") {
    const day = await this.day(storeId, date, type);
    const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
    let queued = 0;
    let skipped = 0;
    await this.database.withTx(async (tx) => {
      for (const it of day.items) {
        const h = hash(it);
        if (await this.txs.isQueued(tx, storeId, it.id, h)) {
          skipped++;
          continue;
        }
        await this.txs.enqueue(tx, storeId, it.id, {
          hash: h,
          date: day.date,
          kind: it.kind,
          transaction: it,
        });
        queued++;
      }
    });
    let manager: { ok: boolean; status: number | null; message: string } | null = null;
    if (this.cfg.managerUrl) {
      const body = {
        store: day.store,
        date: day.date,
        type,
        counts: day.counts,
        totals: day.totals,
        items: day.items,
      };
      try {
        const r = await fetch(`${this.cfg.managerUrl.replace(/\/+$/, "")}/stores/${storeId}/transactions`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "content-type": "application/json",
            "idempotency-key": `tx-${storeId}-${day.date}-${type}-${hash(body).slice(0, 32)}`,
            ...(this.cfg.storeKey ? { authorization: `Bearer ${this.cfg.storeKey}` } : {}),
          },
          body: JSON.stringify(body),
        });
        manager = {
          ok: r.ok,
          status: r.status,
          message: r.ok ? "Recibido por el Manager" : `El Manager respondió ${r.status}`,
        };
        if (r.ok) {
          await this.txs.markSent(storeId, day.date);
        }
      } catch (e: any) {
        manager = { ok: false, status: null, message: `Sin conexión con el Manager: ${e?.message ?? e}` };
      }
    }
    return { date: day.date, type, transactions: day.items.length, queued, skipped, manager };
  }
}
