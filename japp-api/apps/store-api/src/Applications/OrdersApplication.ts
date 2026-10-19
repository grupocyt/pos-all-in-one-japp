import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema as s, type Database, type Db, type Tx } from "@japp/db";
import {
  accountTotals,
  discountAmount,
  fail,
  lineAmount,
  paymentKind,
  r2,
  sum,
  type PresenceState,
  type Account,
  type Actor,
  type DeletedLine,
  type Discount,
  type Invoice,
  type Line,
  type LineCourse,
  type Modifier,
  type Order,
  type Payment,
} from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";
import { OrderOnTableApplication } from "./OrderOnTableApplication.js";

type Q = Db | Tx;

/** Cabecera de la orden (lo que no es de ninguna cuenta). */
export interface OrderHeader {
  id: string;
  storeId: string;
  periodId: string | null;
  status: "open" | "billing" | "closed" | "cancelled";
  version: number;
  tableId: string | null;
  tableName: string;
  zone: string | null;
  priceList: "general" | "terrace";
  guests: number;
  note: string | null;
  openedBy: Actor;
  lastEntry: Actor | null;
  /** Una persona por mesa: quién la tiene y si hay un cobro abierto */
  presence: PresenceState;
}
export interface OrderEvent {
  type: string;
  description: string;
  accountId?: string | null;
  actor: Actor;
}
export interface Loaded {
  header: OrderHeader;
  order: Order;
  meta: Map<string, { openedBy: Actor; closedBy: Actor | null; note: string | null }>;
}

const actor = (p: {
  u?: string | null;
  r?: string | null;
  d?: string | null;
  a?: string | null;
  id?: string | null;
  o?: string | null;
}): Actor => ({
  userId: p.id ?? undefined,
  user: p.u ?? "",
  role: p.r ?? "waiter",
  device: p.d ?? undefined,
  origin: (p.o as Actor["origin"]) ?? undefined,
  at: p.a ? new Date(p.a).toISOString() : "",
});
const actorCols = (prefix: string, a: Actor | null | undefined, withOrigin = false) => {
  const o: Record<string, unknown> = {
    [`${prefix}UserId`]: a?.userId ?? null,
    [`${prefix}UserName`]: a?.user ?? null,
    [`${prefix}Role`]: a?.role ?? null,
    [`${prefix}Device`]: a?.device ?? null,
    [`${prefix}At`]: a?.at ?? null,
  };
  if (withOrigin) {
    o[`${prefix}Origin`] = a?.origin ?? null;
  }
  return o;
};
/** En qué momento se eliminó la línea (order_line.deleted_stage): sin enviar, en precuenta o ya impresa. */
function deletedStageOf(status: string): "preBill" | "pendingPrint" | "printed" {
  if (status === "preBill") {
    return "preBill";
  }
  if (status === "pendingPrint") {
    return "pendingPrint";
  }
  return "printed";
}
const num = (x: string | number | null | undefined) => (x == null ? 0 : Number(x));
const iso = (x: string | null | undefined) => (x ? new Date(x).toISOString() : null);

/**
 * Lee y guarda una orden completa (orden + cuentas + líneas + modificadores + descuentos + cobros + factura).
 * Traduce filas ↔ tipos del dominio. Toda escritura va dentro de la transacción del caso de uso.
 */
@Injectable()
export class OrdersApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async load(tx: Tx, storeId: string, orderId: string, opts: { lock?: boolean } = {}): Promise<Loaded> {
    const base = tx
      .select()
      .from(s.orders)
      .where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, storeId)));
    const [o] = opts.lock ? await base.for("update") : await base;
    if (!o) {
      fail("NOT_FOUND", "La orden no existe", { orderId });
    }
    const accs = await tx
      .select()
      .from(s.account)
      .where(eq(s.account.orderId, orderId))
      .orderBy(asc(s.account.openedByAt), asc(s.account.createdAt));
    const lines = await tx
      .select()
      .from(s.orderLine)
      .where(eq(s.orderLine.orderId, orderId))
      .orderBy(asc(s.orderLine.sortOrder), asc(s.orderLine.createdByAt), asc(s.orderLine.createdAt));
    const lineIds = lines.map((l) => l.id);
    const accIds = accs.map((a) => a.id);
    const mods = lineIds.length
      ? await tx.select().from(s.orderLineModifier).where(inArray(s.orderLineModifier.lineId, lineIds))
      : [];
    const discs = accIds.length
      ? await tx.select().from(s.accountDiscount).where(inArray(s.accountDiscount.accountId, accIds))
      : [];
    const pays = accIds.length
      ? await tx
          .select()
          .from(s.payment)
          .where(and(eq(s.payment.storeId, storeId), inArray(s.payment.accountId, accIds)))
          .orderBy(asc(s.payment.collectedByAt))
      : [];
    const pmIds = [...new Set(pays.map((p) => p.paymentMethodId).filter((x): x is string => !!x))];
    const pms = pmIds.length
      ? await tx
          .select({ id: s.paymentMethod.id, kind: s.paymentMethod.kind })
          .from(s.paymentMethod)
          .where(and(eq(s.paymentMethod.storeId, storeId), inArray(s.paymentMethod.id, pmIds)))
      : [];
    const invs = accIds.length
      ? await tx
          .select()
          .from(s.invoice)
          .where(and(eq(s.invoice.storeId, storeId), inArray(s.invoice.accountId, accIds)))
      : [];
    const custIds = [...new Set(accs.map((a) => a.customerId).filter((x): x is string => !!x))];
    const custs = custIds.length
      ? await tx
          .select()
          .from(s.customerRef)
          .where(and(eq(s.customerRef.storeId, storeId), inArray(s.customerRef.id, custIds)))
      : [];
    const taxes = invs.length
      ? await tx
          .select()
          .from(s.invoiceTax)
          .where(
            inArray(
              s.invoiceTax.invoiceId,
              invs.map((i) => i.id),
            ),
          )
      : [];

    const toLine = (l: (typeof lines)[number]): Line => ({
      id: l.id,
      productId: l.plu,
      name: l.name,
      quantity: num(l.quantity),
      unitPrice: num(l.unitPrice),
      taxRate: num(l.taxRate),
      comment: l.comment ?? "",
      modifiers: mods
        .filter((m) => m.lineId === l.id)
        .map((m) => ({
          name: m.name,
          unitPrice: num(m.unitPrice),
          quantity: num(m.quantity),
          ...(m.plu != null ? { plu: m.plu } : {}),
          ...(m.course != null ? { course: m.course, questionId: m.questionId } : {}),
        })),
      ...(Array.isArray(l.courses) && l.courses.length ? { courses: l.courses as LineCourse[] } : {}),
      status: (l.status === "deleted" ? "printed" : l.status) as Line["status"],
      createdBy: actor({
        id: l.createdByUserId,
        u: l.createdByUserName,
        r: l.createdByRole,
        d: l.createdByDevice,
        a: l.createdByAt,
        o: l.createdByOrigin,
      }),
    });
    const meta: Loaded["meta"] = new Map();
    const accounts: Account[] = accs
      .filter((a) => a.status !== "cancelled")
      .map((a) => {
        meta.set(a.id, {
          openedBy: actor({
            id: a.openedByUserId,
            u: a.openedByUserName,
            r: a.openedByRole,
            d: a.openedByDevice,
            a: a.openedByAt,
          }),
          closedBy: a.closedByUserName
            ? actor({
                id: a.closedByUserId,
                u: a.closedByUserName,
                r: a.closedByRole,
                d: a.closedByDevice,
                a: a.closedByAt,
              })
            : null,
          note: a.note,
        });
        // la factura de la cuenta; sus abonos (rectificativas, con rectified_invoice_id) también cuelgan de la cuenta
        const inv = invs.find((i) => i.accountId === a.id && !i.rectifiedInvoiceId);
        const invoice: Invoice | null = inv
          ? {
              type: inv.type as Invoice["type"],
              series: inv.series,
              sequence: inv.sequence,
              invoiceNumber: inv.invoiceNumber,
              issuedAt: new Date(inv.issuedAt).toISOString(),
              total: num(inv.total),
              taxes: taxes
                .filter((t) => t.invoiceId === inv.id)
                .map((t) => ({ rate: num(t.rate), base: num(t.base), tax: num(t.tax) }))
                .sort((x, y) => x.rate - y.rate),
              customer: inv.customerTaxId
                ? {
                    name: inv.customerName ?? "",
                    taxId: inv.customerTaxId,
                    email: inv.customerEmail ?? undefined,
                  }
                : null,
              verifactuQr: inv.verifactuQr ?? "",
            }
          : null;
        return {
          id: a.id,
          name: a.name,
          status: a.status === "invoiced" ? "invoiced" : "open",
          lines: lines.filter((l) => l.accountId === a.id && !l.deleted).map(toLine),
          deletedLines: lines
            .filter((l) => l.accountId === a.id && l.deleted && l.printed)
            .map(
              (l) =>
                ({
                  ...toLine(l),
                  reason: l.deleteReason ?? "",
                  removedAt: l.deletedByAt ? new Date(l.deletedByAt).toISOString() : "",
                  removedBy: actor({
                    id: l.deletedByUserId,
                    u: l.deletedByUserName,
                    r: l.deletedByRole,
                    d: l.deletedByDevice,
                    a: l.deletedByAt,
                  }),
                  authorizedBy: l.deleteAuthorizedByUserName
                    ? actor({
                        id: l.deleteAuthorizedByUserId,
                        u: l.deleteAuthorizedByUserName,
                        r: l.deleteAuthorizedByRole,
                        d: l.deleteAuthorizedByDevice,
                        a: l.deleteAuthorizedByAt,
                      })
                    : null,
                }) satisfies DeletedLine,
            ),
          discounts: discs
            .filter((d) => d.accountId === a.id)
            .map((d) => ({
              id: d.id,
              type: d.type as Discount["type"],
              value: num(d.value),
              reason: d.reason ?? "",
              status: d.status as Discount["status"],
            })),
          payments: pays
            .filter((p) => p.accountId === a.id)
            .map((p) => ({
              id: p.id,
              method: p.method,
              methodId: p.paymentMethodId ?? null,
              kind: paymentKind(pms.find((m) => m.id === p.paymentMethodId)?.kind, p.method),
              amount: num(p.amount),
              tip: num(p.tip),
              cashGiven: p.cashGiven == null ? null : num(p.cashGiven),
              change: p.changeGiven == null ? null : num(p.changeGiven),
              status: p.status as Payment["status"],
              collectedBy: actor({
                id: p.collectedByUserId,
                u: p.collectedByUserName,
                r: p.collectedByRole,
                d: p.collectedByDevice,
                a: p.collectedByAt,
              }),
            })),
          customerData: (() => {
            const c = custs.find((x) => x.id === a.customerId);
            return c
              ? {
                  id: c.id,
                  type: (c.type as "person" | "company") ?? undefined,
                  name: c.name,
                  taxId: c.taxId,
                  email: c.email ?? undefined,
                  street: c.street ?? undefined,
                  postalCode: c.postalCode ?? undefined,
                  city: c.city ?? undefined,
                  province: c.province ?? undefined,
                  country: c.country ?? undefined,
                }
              : (invoice?.customer ?? null);
          })(),
          invoice,
        };
      });
    const header: OrderHeader = {
      id: o!.id,
      storeId: o!.storeId,
      periodId: o!.periodId,
      status: o!.status as OrderHeader["status"],
      version: o!.version,
      tableId: o!.tableId,
      tableName: o!.tableName,
      zone: o!.zone,
      priceList: o!.priceList as OrderHeader["priceList"],
      guests: o!.guests,
      note: o!.note,
      openedBy: actor({
        id: o!.openedByUserId,
        u: o!.openedByUserName,
        r: o!.openedByRole,
        d: o!.openedByDevice,
        a: o!.openedByAt,
      }),
      lastEntry: o!.lastEntryUserName
        ? actor({
            id: o!.lastEntryUserId,
            u: o!.lastEntryUserName,
            r: o!.lastEntryRole,
            d: o!.lastEntryDevice,
            a: o!.lastEntryAt,
          })
        : null,
      presence: OrdersApplication.presenceOf(o!),
    };
    return {
      header,
      order: { id: o!.id, tableId: o!.tableId ?? "", guests: o!.guests, version: o!.version, accounts },
      meta,
    };
  }

  /** Columnas holder_* y charging_until → estado de presencia del dominio. */
  static presenceOf(
    o: Pick<
      typeof s.orders.$inferSelect,
      | "holderUserId"
      | "holderUserName"
      | "holderStationId"
      | "holderStationName"
      | "holderUntil"
      | "chargingUntil"
    >,
  ): PresenceState {
    return {
      holder:
        o.holderUserId && o.holderUntil
          ? {
              userId: o.holderUserId,
              userName: o.holderUserName ?? "",
              stationId: o.holderStationId ?? "",
              stationName: o.holderStationName ?? "",
              until: iso(o.holderUntil)!,
            }
          : null,
      chargingUntil: iso(o.chargingUntil),
    };
  }

  /** Guarda quién tiene la mesa (no cambia la versión de la orden: no es un cambio de la venta). */
  async savePresence(tx: Tx, storeId: string, orderId: string, p: PresenceState) {
    await tx
      .update(s.orders)
      .set({
        holderUserId: p.holder?.userId ?? null,
        holderUserName: p.holder?.userName ?? null,
        holderStationId: p.holder?.stationId || null,
        holderStationName: p.holder?.stationName ?? null,
        holderUntil: p.holder?.until ?? null,
        chargingUntil: p.chargingUntil,
      } as any)
      .where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, storeId)));
  }

  async insertHeader(tx: Tx, h: OrderHeader) {
    await tx.insert(s.orders).values({
      id: h.id,
      storeId: h.storeId,
      periodId: h.periodId,
      status: h.status,
      version: h.version,
      tableId: h.tableId,
      tableName: h.tableName,
      zone: h.zone,
      priceList: h.priceList,
      guests: h.guests,
      note: h.note,
      ...actorCols("openedBy", h.openedBy),
      ...actorCols("lastEntry", h.openedBy),
    } as typeof s.orders.$inferInsert);
  }

  /**
   * Guarda la diferencia entre `before` y `after`:
   * - cuentas nuevas, totales recalculados con el dominio (nunca los que manda el equipo);
   * - líneas nuevas (con modificadores), cambiadas, borradas con motivo, o retiradas sin rastro (pendientes de enviar);
   * - descuentos y cobros nuevos;
   * - versión +1, snapshot JSONB y eventos.
   * Devuelve la nueva versión.
   */
  /** Respuestas de una línea, con su pregunta y su pase si los tienen (menú por pases). */
  private async insertMods(tx: Tx, storeId: string, lineId: string, mods: Modifier[], _products?: unknown) {
    if (!mods.length) {
      return;
    }
    const plus = [...new Set(mods.map((m) => m.plu).filter((x): x is number => x != null))];
    const prods = plus.length
      ? await tx
          .select({ id: s.product.id, plu: s.product.plu })
          .from(s.product)
          .where(and(eq(s.product.storeId, storeId), inArray(s.product.plu, plus)))
      : [];
    for (const m of mods) {
      await tx.insert(s.orderLineModifier).values({
        id: crypto.randomUUID(),
        storeId,
        lineId,
        name: m.name,
        quantity: String(m.quantity ?? 1),
        unitPrice: String(m.unitPrice),
        plu: m.plu ?? null,
        productId: prods.find((p) => p.plu === m.plu)?.id ?? null,
        questionId: m.questionId ?? null,
        course: m.course ?? null,
      } as typeof s.orderLineModifier.$inferInsert);
    }
  }

  async save(
    tx: Tx,
    storeId: string,
    before: Order,
    after: Order,
    header: OrderHeader,
    ctx: { actor: Actor; events?: OrderEvent[]; movedReason?: string },
  ): Promise<number> {
    const prevAcc = new Map(before.accounts.map((a) => [a.id, a]));
    const prevLines = new Map(
      before.accounts.flatMap((a) => a.lines.map((l) => [l.id, { l, acc: a.id }] as const)),
    );
    const prevDeleted = new Set(before.accounts.flatMap((a) => a.deletedLines.map((l) => l.id)));
    const nowLines = new Map(
      after.accounts.flatMap((a) => a.lines.map((l) => [l.id, { l, acc: a.id }] as const)),
    );
    const nowDeleted = new Map(after.accounts.flatMap((a) => a.deletedLines.map((l) => [l.id, l] as const)));
    const newPlus = [...nowLines.values()].filter((x) => !prevLines.has(x.l.id));
    // borrados parciales: la parte borrada es una fila nueva que nace ya eliminada
    const newDeleted = after.accounts.flatMap((a) =>
      a.deletedLines
        .filter((l) => !prevDeleted.has(l.id) && !prevLines.has(l.id))
        .map((l) => ({ l, acc: a.id })),
    );
    const plus = [...new Set([...newPlus, ...newDeleted].map((x) => x.l.productId))];
    const products = plus.length
      ? await tx
          .select({ id: s.product.id, plu: s.product.plu })
          .from(s.product)
          .where(and(eq(s.product.storeId, storeId), inArray(s.product.plu, plus)))
      : [];

    for (const a of after.accounts) {
      const T = accountTotals(a);
      const tips = r2(sum(a.payments.filter((p) => p.status === "confirmed").map((p) => p.tip)));
      const totals = {
        subtotal: T.sub.toFixed(2),
        discountTotal: T.disc.toFixed(2),
        total: T.total.toFixed(2),
        paid: T.paid.toFixed(2),
        pending: T.pending.toFixed(2),
        tips: tips.toFixed(2),
      };
      if (!prevAcc.has(a.id)) {
        await tx.insert(s.account).values({
          id: a.id,
          storeId,
          orderId: after.id,
          name: a.name,
          status: a.status,
          ...actorCols("openedBy", ctx.actor),
          ...totals,
        } as typeof s.account.$inferInsert);
      } else {
        const closed = a.status === "invoiced" && prevAcc.get(a.id)!.status !== "invoiced";
        await tx
          .update(s.account)
          .set({
            name: a.name,
            status: a.status,
            customerId: a.customerData?.id ?? null,
            ...totals,
            ...(closed ? actorCols("closedBy", ctx.actor) : {}),
            ...actorCols("lastEntry", ctx.actor),
            updatedAt: sql`now()`,
          } as any)
          .where(eq(s.account.id, a.id));
      }
    }
    // cuentas que desaparecen (quedaron vacías al separar): se anulan, no se borran
    for (const a of before.accounts) {
      if (!after.accounts.some((x) => x.id === a.id)) {
        await tx
          .update(s.account)
          .set({ status: "cancelled", ...actorCols("closedBy", ctx.actor), updatedAt: sql`now()` } as any)
          .where(eq(s.account.id, a.id));
      }
    }

    // posición de cada línea en su cuenta (sort_order): fija el orden en pantalla y en la comanda
    const posOf = new Map<string, number>();
    for (const a of after.accounts) {
      a.lines.forEach((l, i) => posOf.set(l.id, i));
    }
    for (const { l, acc } of newPlus) {
      const pid = products.find((p) => p.plu === l.productId)?.id ?? null;
      await tx.insert(s.orderLine).values({
        id: l.id,
        storeId,
        orderId: after.id,
        accountId: acc,
        productId: pid,
        plu: l.productId,
        name: l.name,
        comment: l.comment || null,
        quantity: String(l.quantity),
        unitPrice: String(l.unitPrice),
        taxRate: String(l.taxRate),
        status: l.status,
        printed: l.status !== "pendingPrint",
        netAmount: String(lineAmount(l)),
        sortOrder: posOf.get(l.id) ?? 0,
        courses: l.courses?.length ? l.courses : null,
        ...actorCols("createdBy", l.createdBy, true),
      } as typeof s.orderLine.$inferInsert);
      await this.insertMods(tx, storeId, l.id, l.modifiers, products);
    }
    for (const { l, acc } of newDeleted) {
      await tx.insert(s.orderLine).values({
        id: l.id,
        storeId,
        orderId: after.id,
        accountId: acc,
        productId: products.find((p) => p.plu === l.productId)?.id ?? null,
        plu: l.productId,
        name: l.name,
        comment: l.comment || null,
        quantity: String(l.quantity),
        unitPrice: String(l.unitPrice),
        taxRate: String(l.taxRate),
        status: "deleted",
        printed: true,
        netAmount: String(lineAmount(l)),
        ...actorCols("createdBy", l.createdBy, true),
        deleted: true,
        deletedStage: l.status === "preBill" ? "preBill" : "printed",
        deleteReason: l.reason,
        ...actorCols("deletedBy", l.removedBy),
        ...actorCols("deleteAuthorizedBy", l.authorizedBy),
      } as typeof s.orderLine.$inferInsert);
      for (const m of l.modifiers) {
        await tx.insert(s.orderLineModifier).values({
          id: crypto.randomUUID(),
          storeId,
          lineId: l.id,
          name: m.name,
          quantity: String(m.quantity ?? 1),
          unitPrice: String(m.unitPrice),
        });
      }
    }
    // si cambió el orden de una cuenta, se reescriben las posiciones de todas sus líneas
    for (const a of after.accounts) {
      const pa = before.accounts.find((x) => x.id === a.id);
      const ids = a.lines.map((l) => l.id).filter((id) => prevLines.has(id));
      const was = (pa?.lines ?? []).map((l) => l.id).filter((id) => ids.includes(id));
      if (ids.join() !== was.join()) {
        for (const [i, l] of a.lines.entries()) {
          if (prevLines.has(l.id)) {
            await tx
              .update(s.orderLine)
              .set({ sortOrder: i, updatedAt: sql`now()` } as any)
              .where(eq(s.orderLine.id, l.id));
          }
        }
      }
    }
    for (const { l, acc } of nowLines.values()) {
      const p = prevLines.get(l.id);
      if (!p) {
        continue;
      }
      const coursesChanged = JSON.stringify(p.l.courses ?? null) !== JSON.stringify(l.courses ?? null);
      const modsChanged = JSON.stringify(p.l.modifiers) !== JSON.stringify(l.modifiers);
      if (
        p.l.quantity !== l.quantity ||
        p.l.status !== l.status ||
        p.l.comment !== l.comment ||
        p.acc !== acc ||
        coursesChanged ||
        modsChanged
      ) {
        await tx
          .update(s.orderLine)
          .set({
            quantity: String(l.quantity),
            status: l.status,
            printed: l.status !== "pendingPrint",
            comment: l.comment || null,
            accountId: acc,
            netAmount: String(lineAmount(l)),
            courses: l.courses?.length ? l.courses : null,
            updatedAt: sql`now()`,
          } as any)
          .where(eq(s.orderLine.id, l.id));
      }
      // respuestas elegidas más tarde (pases del menú): se reescriben las de la línea (nunca son de una venta cerrada)
      if (modsChanged) {
        await tx.delete(s.orderLineModifier).where(eq(s.orderLineModifier.lineId, l.id));
        await this.insertMods(tx, storeId, l.id, l.modifiers, products);
      }
    }
    for (const [id, { l }] of prevLines) {
      if (nowLines.has(id)) {
        continue;
      }
      const d = nowDeleted.get(id);
      if (d && !prevDeleted.has(id)) {
        await tx
          .update(s.orderLine)
          .set({
            deleted: true,
            status: "deleted",
            deletedStage: deletedStageOf(l.status),
            deleteReason: d.reason,
            ...actorCols("deletedBy", d.removedBy),
            ...actorCols("deleteAuthorizedBy", d.authorizedBy),
            updatedAt: sql`now()`,
          } as any)
          .where(eq(s.orderLine.id, id));
      } else if (l.status === "pendingPrint") {
        // nunca salió a cocina: se retira sin pedir motivo (queda marcada, no se borra)
        await tx
          .update(s.orderLine)
          .set({
            deleted: true,
            status: "deleted",
            printed: false,
            deletedStage: "pendingPrint",
            ...actorCols("deletedBy", ctx.actor),
            updatedAt: sql`now()`,
          } as any)
          .where(eq(s.orderLine.id, id));
      } else {
        // enviada y pasada entera a otra cuenta: su copia vive en la otra cuenta
        await tx
          .update(s.orderLine)
          .set({
            deleted: true,
            status: "deleted",
            deletedStage: l.status === "preBill" ? "preBill" : "printed",
            deleteReason: ctx.movedReason ?? "Pasada a otra cuenta",
            ...actorCols("deletedBy", ctx.actor),
            updatedAt: sql`now()`,
          } as any)
          .where(eq(s.orderLine.id, id));
      }
    }

    const prevDiscMap = new Map(before.accounts.flatMap((a) => a.discounts.map((d) => [d.id, d] as const)));
    const prevDisc = new Set(prevDiscMap.keys());
    const prevPay = new Set(before.accounts.flatMap((a) => a.payments.map((p) => p.id)));
    for (const a of after.accounts) {
      const sub = accountTotals(a).sub;
      for (const d of a.discounts) {
        if (prevDisc.has(d.id) && prevDiscMap.get(d.id)!.status !== d.status && d.status === "removed") {
          await tx
            .update(s.accountDiscount)
            .set({ status: "removed", ...actorCols("removedBy", ctx.actor) } as any)
            .where(eq(s.accountDiscount.id, d.id));
        }
      }
      for (const d of a.discounts) {
        if (!prevDisc.has(d.id)) {
          const amount = discountAmount(d, sub);
          await tx.insert(s.accountDiscount).values({
            id: d.id,
            storeId,
            accountId: a.id,
            source: "manual",
            type: d.type,
            value: String(d.value),
            baseAmount: String(sub),
            amount: amount.toFixed(2),
            reason: d.reason,
            status: d.status,
            ...actorCols("appliedBy", ctx.actor),
          } as any);
        }
      }
      for (const p of a.payments) {
        if (!prevPay.has(p.id)) {
          await tx.insert(s.payment).values({
            id: p.id,
            storeId,
            accountId: a.id,
            method: p.method,
            paymentMethodId: p.methodId ?? null,
            amount: String(p.amount),
            tip: String(p.tip),
            cashGiven: p.cashGiven == null ? null : String(p.cashGiven),
            changeGiven: p.change == null ? null : String(p.change),
            status: p.status,
            ...actorCols("collectedBy", p.collectedBy),
          } as any);
        }
      }
    }

    const version = header.version + 1;
    const allClosed = after.accounts.length > 0 && after.accounts.every((a) => a.status === "invoiced");
    const status = allClosed ? "closed" : header.status;
    for (const e of ctx.events ?? []) {
      await tx.insert(s.orderEvent).values({
        id: crypto.randomUUID(),
        storeId,
        orderId: after.id,
        accountId: e.accountId ?? null,
        type: e.type,
        description: e.description,
        at: e.actor.at,
        userId: e.actor.userId ?? null,
        userName: e.actor.user,
        role: e.actor.role,
        device: e.actor.device ?? null,
        origin: e.actor.origin ?? null,
      } as any);
    }
    const h = { ...header, version, status, guests: after.guests } as OrderHeader;
    const snap = await this.transaction(tx, h, after);
    await tx
      .update(s.orders)
      .set({
        version,
        status,
        guests: after.guests,
        note: header.note,
        snapshot: snap,
        ...actorCols("lastEntry", ctx.actor),
        ...(allClosed || status === "cancelled" ? { closedAt: ctx.actor.at } : {}),
        updatedAt: sql`now()`,
      } as any)
      .where(eq(s.orders.id, after.id));
    await tx
      .insert(s.syncOutbox)
      .values({ storeId, entity: "order", entityId: after.id, operation: "upsert", payload: snap } as any);
    // Order on Table: al cerrar la mesa (factura de la última cuenta, cerrar sin venta, pasar la última cuenta…)
    // caduca su QR. Va aquí porque todo cierre pasa por save(), y así queda en la misma transacción.
    if (status === "closed" || status === "cancelled") {
      await OrderOnTableApplication.revoke(tx, storeId, after.id, "closed");
    }
    return version;
  }

  /** JSON «Transaction» de la API (la misma forma que vista-orden), con totales calculados por el dominio. */
  async transaction(tx: Tx, h: OrderHeader, order: Order) {
    const events = await tx
      .select()
      .from(s.orderEvent)
      .where(eq(s.orderEvent.orderId, order.id))
      .orderBy(asc(s.orderEvent.at));
    const who = (a: Actor | null) =>
      a ? { user: a.user, role: a.role, device: a.device ?? "", at: a.at } : null;
    return {
      _id: order.id,
      storeId: h.storeId,
      status: h.status,
      version: h.version,
      tableData: {
        tableId: h.tableId ?? "",
        name: h.tableName,
        zone: h.zone ?? "",
        priceList: h.priceList,
        guests: order.guests,
        openedBy: who(h.openedBy),
        lastEntry: who(h.lastEntry ?? h.openedBy),
        lastExit: null,
        note: h.note,
      },
      events: events.map((e) => ({
        type: e.type,
        at: new Date(e.at).toISOString(),
        description: e.description,
        user: e.userName ?? "",
        device: e.device ?? "",
        role: e.role ?? "",
      })),
      accounts: order.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        closedBy: null,
        note: null,
        lines: a.lines.map((l) => ({
          ...l,
          comment: l.comment,
          printed: l.status !== "pendingPrint",
          amount: lineAmount(l),
        })),
        deletedLines: a.deletedLines,
        discounts: a.discounts,
        payments: a.payments,
        totals: accountTotals(a),
        customerData: a.customerData,
        invoice: a.invoice,
      })),
    };
  }

  /** Carga una orden fuera de un comando (lectura para el plano de mesas), en su propia transacción de solo lectura. */
  async loadSnapshot(storeId: string, orderId: string): Promise<Loaded> {
    return this.database.db.transaction((tx) => this.load(tx, storeId, orderId));
  }

  /** Fila de la orden bloqueada (FOR UPDATE) para la presencia en mesa; undefined si no existe en la tienda. */
  async lockRow(tx: Tx, storeId: string, orderId: string) {
    const [o] = await tx
      .select()
      .from(s.orders)
      .where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, storeId)))
      .for("update");
    return o;
  }

  /** Bloquea varias órdenes (FOR UPDATE) siempre en el mismo orden (por id), para no interbloquearse con otros comandos. */
  async lockByIds(tx: Tx, storeId: string, ids: string[]) {
    await tx.execute(
      sql`SELECT id FROM orders WHERE store_id = ${storeId} AND id = ANY(${"{" + ids.join(",") + "}"}::uuid[]) ORDER BY id FOR UPDATE`,
    );
  }

  /** Un evento suelto en el historial de la orden, fuera de save() (p. ej. otra persona entra en la mesa). */
  async insertEvent(
    tx: Tx,
    storeId: string,
    orderId: string,
    e: { type: string; description: string; actor: Actor },
  ) {
    const a = e.actor;
    await tx.insert(s.orderEvent).values({
      id: crypto.randomUUID(),
      storeId,
      orderId,
      type: e.type,
      description: e.description,
      at: a.at,
      userId: a.userId,
      userName: a.user,
      role: a.role,
      device: a.device,
      origin: a.origin,
    } as any);
  }

  /** Lista de órdenes: por estado (por defecto las vivas: open y billing) y mesa; las más recientes primero, hasta 500. */
  async list(storeId: string, status?: string, tableId?: string) {
    return this.database.db
      .select({
        id: s.orders.id,
        tableName: s.orders.tableName,
        status: s.orders.status,
        version: s.orders.version,
      })
      .from(s.orders)
      .where(
        and(
          eq(s.orders.storeId, storeId),
          ...(status ? [eq(s.orders.status, status)] : [inArray(s.orders.status, ["open", "billing"])]),
          ...(tableId ? [eq(s.orders.tableId, tableId)] : []),
        ),
      )
      .orderBy(desc(s.orders.openedByAt))
      .limit(500);
  }

  /** Órdenes vivas (open y billing) de la tienda, enteras (filas de orders), para el plano de mesas. */
  async listLive(storeId: string) {
    return this.database.db
      .select()
      .from(s.orders)
      .where(and(eq(s.orders.storeId, storeId), inArray(s.orders.status, ["open", "billing"])));
  }

  /**
   * Órdenes vivas (open y billing) de una mesa. Con tableId, por mesa; sin él (fast food FF-<estación>), por nombre.
   */
  async liveOnTable(tx: Tx, storeId: string, table: { tableId: string | null; tableName?: string }) {
    return tx
      .select({ id: s.orders.id })
      .from(s.orders)
      .where(
        and(
          eq(s.orders.storeId, storeId),
          inArray(s.orders.status, ["open", "billing"]),
          table.tableId ? eq(s.orders.tableId, table.tableId) : eq(s.orders.tableName, table.tableName ?? ""),
        ),
      );
  }

  /** Cambia la mesa de la orden (transferir la mesa entera). */
  async moveToTable(
    tx: Tx,
    storeId: string,
    orderId: string,
    t: { tableId: string; tableName: string; zone: string; priceList: string },
  ) {
    await tx
      .update(s.orders)
      .set({ tableId: t.tableId, tableName: t.tableName, zone: t.zone, priceList: t.priceList } as any)
      .where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, storeId)));
  }

  /**
   * Pasa una cuenta a otra orden: la cuenta y TODAS sus líneas (también las eliminadas) cambian de orden;
   * cobros, descuentos y respuestas cuelgan de ellas.
   */
  async moveAccount(
    tx: Tx,
    storeId: string,
    accountId: string,
    fromOrderId: string,
    toOrderId: string,
    name: string,
  ) {
    await tx.execute(
      sql`UPDATE account SET order_id = ${toOrderId}, name = ${name}, updated_at = now() WHERE store_id = ${storeId} AND id = ${accountId} AND order_id = ${fromOrderId}`,
    );
    await tx.execute(
      sql`UPDATE order_line SET order_id = ${toOrderId}, updated_at = now() WHERE store_id = ${storeId} AND account_id = ${accountId} AND order_id = ${fromOrderId}`,
    );
  }

  /**
   * Todas las cuentas de la orden, también las anuladas (load() no las trae), con su estado y si tienen factura.
   * Para reabrir la mesa.
   */
  async accountStates(tx: Tx, storeId: string, orderId: string) {
    const rows = await tx
      .select({ id: s.account.id, status: s.account.status, invoiceId: s.invoice.id })
      .from(s.account)
      .leftJoin(s.invoice, and(eq(s.invoice.accountId, s.account.id), eq(s.invoice.storeId, storeId)))
      .where(and(eq(s.account.orderId, orderId), eq(s.account.storeId, storeId)));
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      invoiced: r.status === "invoiced" || !!r.invoiceId,
    }));
  }

  /** Reabrir mesa: las cuentas anuladas indicadas vuelven a open (sin quién la cerró). */
  async reopenAccounts(tx: Tx, storeId: string, orderId: string, ids: string[]) {
    if (!ids.length) {
      return;
    }
    await tx
      .update(s.account)
      .set({ status: "open", ...actorCols("closedBy", null), updatedAt: sql`now()` } as any)
      .where(
        and(
          eq(s.account.storeId, storeId),
          eq(s.account.orderId, orderId),
          eq(s.account.status, "cancelled"),
          inArray(s.account.id, ids),
        ),
      );
  }

  /** Reabrir mesa: la orden vuelve a open y deja de tener hora de cierre. La versión la sube save(). */
  async markReopened(tx: Tx, storeId: string, orderId: string) {
    await tx
      .update(s.orders)
      .set({ status: "open", closedAt: null, updatedAt: sql`now()` } as any)
      .where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, storeId)));
  }

  /** Historial de la orden (order_event), en orden de hora. */
  async events(storeId: string, orderId: string) {
    return this.database.db
      .select()
      .from(s.orderEvent)
      .where(and(eq(s.orderEvent.orderId, orderId), eq(s.orderEvent.storeId, storeId)))
      .orderBy(s.orderEvent.at);
  }

  /**
   * Cliente en el fichero de clientes (customer_ref), único por tienda y NIF: alta o actualización de sus datos.
   * active = false si no se quiere guardar en el fichero. Devuelve su id.
   */
  async upsertCustomer(
    tx: Tx,
    row: {
      storeId: string;
      type: string;
      taxId: string;
      name: string;
      email: string | null;
      street: string | null;
      postalCode: string | null;
      city: string | null;
      province: string | null;
      country: string;
    },
    active: boolean,
  ): Promise<string> {
    const [saved] = await tx
      .insert(s.customerRef)
      .values({ id: crypto.randomUUID(), ...row, active } as any)
      .onConflictDoUpdate({
        target: [s.customerRef.storeId, s.customerRef.taxId],
        set: { ...row, updatedAt: sql`now()` } as any,
      })
      .returning({ id: s.customerRef.id });
    return saved!.id;
  }

  /** Cadena VeriFactu: una factura de la tienda cada vez (bloqueo de transacción por tienda; F y T comparten cadena). */
  async lockInvoiceChain(tx: Tx, storeId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId}))`);
  }

  /** Serie de facturación bloqueada (SELECT … FOR UPDATE) para reservar el número; undefined si no existe. */
  async lockSeries(tx: Tx, storeId: string, series: string) {
    const [row] = await tx
      .select()
      .from(s.invoiceSeries)
      .where(and(eq(s.invoiceSeries.storeId, storeId), eq(s.invoiceSeries.series, series)))
      .for("update");
    return row;
  }

  async setSeriesSequence(tx: Tx, storeId: string, series: string, sequence: number) {
    await tx
      .update(s.invoiceSeries)
      .set({ lastSequence: sequence } as any)
      .where(and(eq(s.invoiceSeries.storeId, storeId), eq(s.invoiceSeries.series, series)));
  }

  /** Factura (cabecera) de una cuenta: datos del emisor, del cliente, importes y quién la emitió. */
  async insertInvoice(
    tx: Tx,
    v: {
      id: string;
      storeId: string;
      accountId: string;
      orderId: string;
      inv: Invoice;
      issuer: { nif: string; name: string };
      taxBase: string;
      taxTotal: string;
      actor: Actor;
    },
  ) {
    const { inv } = v;
    await tx.insert(s.invoice).values({
      id: v.id,
      storeId: v.storeId,
      accountId: v.accountId,
      orderId: v.orderId,
      type: inv.type,
      series: inv.series,
      sequence: inv.sequence,
      invoiceNumber: inv.invoiceNumber,
      issuedAt: inv.issuedAt,
      issuerTaxId: v.issuer.nif,
      issuerName: v.issuer.name,
      customerId: inv.customer?.id ?? null,
      customerType: inv.customer?.type ?? null,
      customerTaxId: inv.customer?.taxId ?? null,
      customerName: inv.customer?.name ?? null,
      customerEmail: inv.customer?.email ?? null,
      customerStreet: inv.customer?.street ?? null,
      customerPostalCode: inv.customer?.postalCode ?? null,
      customerCity: inv.customer?.city ?? null,
      customerProvince: inv.customer?.province ?? null,
      customerCountry: inv.customer?.country ?? null,
      taxBase: v.taxBase,
      taxTotal: v.taxTotal,
      total: inv.total.toFixed(2),
      verifactuQr: inv.verifactuQr,
      issuedByUserId: v.actor.userId,
      issuedByUserName: v.actor.user,
      issuedByRole: v.actor.role,
      issuedByDevice: v.actor.device,
      issuedByAt: v.actor.at,
    } as any);
  }

  /** Desglose de IVA de la factura (una fila por tipo). */
  async insertInvoiceTaxes(tx: Tx, storeId: string, invoiceId: string, taxes: Invoice["taxes"]) {
    for (const t of taxes) {
      await tx.insert(s.invoiceTax).values({
        invoiceId,
        storeId,
        rate: t.rate.toFixed(2),
        base: t.base.toFixed(2),
        tax: t.tax.toFixed(2),
      } as any);
    }
  }

  /**
   * Registro anterior de la cadena VeriFactu = el último (el que aún no tiene sucesor); la base garantiza uno solo
   * (uq_verifactu_previous / uq_verifactu_genesis). undefined si la cadena está vacía.
   */
  async verifactuTail(tx: Tx, storeId: string): Promise<{ id: string; hash: string } | undefined> {
    const [prev] = (
      await tx.execute(sql`SELECT v.id::text id, v.hash FROM verifactu_record v WHERE v.store_id = ${storeId}
        AND NOT EXISTS (SELECT 1 FROM verifactu_record n WHERE n.store_id = v.store_id AND n.previous_record_id = v.id)
        ORDER BY v.generated_at DESC, v.id DESC LIMIT 1`)
    ).rows as { id: string; hash: string }[];
    return prev;
  }

  async insertVerifactuRecord(
    tx: Tx,
    v: {
      storeId: string;
      invoiceId: string;
      issuerTaxId: string;
      inv: Invoice;
      taxTotal: string;
      previous: { id: string; hash: string } | undefined;
      hash: string;
      generatedAt: string;
    },
  ) {
    await tx.insert(s.verifactuRecord).values({
      id: crypto.randomUUID(),
      storeId: v.storeId,
      invoiceId: v.invoiceId,
      issuerTaxId: v.issuerTaxId,
      invoiceNumber: v.inv.invoiceNumber,
      issuedOn: v.inv.issuedAt.slice(0, 10),
      invoiceType: v.inv.type,
      taxTotal: v.taxTotal,
      total: v.inv.total.toFixed(2),
      previousRecordId: v.previous?.id ?? null,
      previousHash: v.previous?.hash ?? null,
      hash: v.hash,
      generatedAt: v.generatedAt,
    } as any);
  }
}
