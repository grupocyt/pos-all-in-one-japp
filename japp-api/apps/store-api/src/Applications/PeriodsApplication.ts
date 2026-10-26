import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema as s, type Database, type Db, type Tx } from "@japp/db";
import { D, expectedCash, paymentKind, r2, sum, type Actor } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;
export type PeriodRow = typeof s.salesPeriod.$inferSelect;

/**
 * Periodos de venta (sales_period), su cierre (cash_closing) y lo que dice la caja del periodo.
 * Lo que lee recibe la transacción, la base o null (= fuera de transacción, con la base inyectada).
 */
@Injectable()
export class PeriodsApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** La transacción, o la base si no hay. */
  private q(q: Q | null): Q {
    return q ?? this.database.db;
  }

  /** El periodo abierto de la tienda (solo uno, lo garantiza la base), o null. */
  async current(q: Q | null, storeId: string): Promise<PeriodRow | null> {
    const [p] = await this.q(q)
      .select()
      .from(s.salesPeriod)
      .where(and(eq(s.salesPeriod.storeId, storeId), eq(s.salesPeriod.openFlag, 1)));
    return p ?? null;
  }

  /** Abre el periodo. */
  async insert(tx: Tx, id: string, storeId: string, stationId: string, a: Actor) {
    await tx.insert(s.salesPeriod).values({
      id,
      storeId,
      status: "open",
      openFlag: 1,
      stationId,
      openedByUserId: a.userId,
      openedByUserName: a.user,
      openedByRole: a.role,
      openedByDevice: a.device,
      openedByAt: a.at,
    } as any);
  }

  /** El periodo bloqueado (FOR UPDATE) para cerrarlo. */
  async lockForUpdate(tx: Tx, storeId: string, periodId: string): Promise<PeriodRow | undefined> {
    const [p] = await tx
      .select()
      .from(s.salesPeriod)
      .where(and(eq(s.salesPeriod.id, periodId), eq(s.salesPeriod.storeId, storeId)))
      .for("update");
    return p;
  }

  /** Mesas del periodo aún abiertas o cobrándose. */
  /**
   * Mesas abiertas (open o billing) del periodo totalmente vacías: ninguna línea (ni eliminada), ningún cobro y ninguna
   * cuenta facturada, sin tocar desde hace `idleSeconds` (una recién abierta sí cuenta: alguien va a marcar).
   */
  async emptyOpenOrderIds(storeId: string, periodId: string, idleSeconds = 120): Promise<string[]> {
    const r = await this.database.db.execute(sql`
      SELECT o.id FROM orders o
      WHERE o.store_id = ${storeId} AND o.period_id = ${periodId} AND o.status IN ('open', 'billing')
        AND o.updated_at < now() - make_interval(secs => ${idleSeconds}::int)
        AND NOT EXISTS (SELECT 1 FROM order_line l WHERE l.order_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM account a WHERE a.order_id = o.id AND a.status = 'invoiced')
        AND NOT EXISTS (SELECT 1 FROM payment y JOIN account a ON a.id = y.account_id WHERE a.order_id = o.id)`);
    return ((r as any).rows ?? r).map((x: any) => String(x.id));
  }

  async countOpenOrders(tx: Tx, storeId: string, periodId: string) {
    const [open] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(s.orders)
      .where(
        and(
          eq(s.orders.storeId, storeId),
          eq(s.orders.periodId, periodId),
          inArray(s.orders.status, ["open", "billing"]),
        ),
      );
    return Number(open!.n);
  }

  /** Arqueo del cierre (cash_closing). */
  async insertClosing(
    tx: Tx,
    storeId: string,
    periodId: string,
    c: {
      countedCash: number;
      countedCard: number;
      expectedCash: number;
      difference: number;
      nextFloat: number;
      deposit: number;
      grossSales: number;
      guests: number;
    },
    a: Actor,
  ) {
    await tx.insert(s.cashClosing).values({
      id: crypto.randomUUID(),
      storeId,
      periodId,
      countedCash: c.countedCash.toFixed(2),
      countedCard: c.countedCard.toFixed(2),
      expectedCash: c.expectedCash.toFixed(2),
      difference: c.difference.toFixed(2),
      nextFloat: c.nextFloat.toFixed(2),
      deposit: c.deposit.toFixed(2),
      grossSales: c.grossSales.toFixed(2),
      guests: c.guests,
      byUserId: a.userId,
      byUserName: a.user,
      byRole: a.role,
      byDevice: a.device,
      byAt: a.at,
    } as any);
  }

  /** Marca el periodo como cerrado (open_flag NULL deja abrir otro). */
  async close(tx: Tx, storeId: string, periodId: string, a: Actor) {
    await tx
      .update(s.salesPeriod)
      .set({
        status: "closed",
        openFlag: null,
        closedByUserId: a.userId,
        closedByUserName: a.user,
        closedByRole: a.role,
        closedByDevice: a.device,
        closedByAt: a.at,
      } as any)
      .where(and(eq(s.salesPeriod.id, periodId), eq(s.salesPeriod.storeId, storeId)));
  }

  /**
   * Lo que dice la caja del periodo abierto (= cajaTeorico). Lo usan /cash/summary, el arqueo y el cierre.
   * Las cuentas las hace @japp/domain (expectedCash); aquí solo se leen cobros, movimientos y facturas.
   */
  async cashState(tx: Tx | null, storeId: string, periodId: string, defaultFloat: number) {
    const q = this.q(tx);
    const pays = await q
      .select({
        method: s.payment.method,
        kind: s.paymentMethod.kind,
        amount: s.payment.amount,
        tip: s.payment.tip,
      })
      .from(s.payment)
      .innerJoin(s.account, eq(s.account.id, s.payment.accountId))
      .innerJoin(s.orders, eq(s.orders.id, s.account.orderId))
      .leftJoin(s.paymentMethod, eq(s.paymentMethod.id, s.payment.paymentMethodId))
      .where(
        and(
          eq(s.payment.storeId, storeId),
          eq(s.orders.storeId, storeId),
          eq(s.orders.periodId, periodId),
          eq(s.payment.status, "confirmed"),
        ),
      );
    const moves = await q
      .select()
      .from(s.cashMovement)
      .where(and(eq(s.cashMovement.storeId, storeId), eq(s.cashMovement.periodId, periodId)));
    // fondo apuntado (aunque sea 0) o, si no hay, el de Parámetros
    const floats = moves.filter((m) => m.kind === "float");
    const float = floats.length ? r2(sum(floats.map((m) => m.amount))) : defaultFloat;
    const r = expectedCash(
      float,
      pays.map((p) => ({ kind: paymentKind(p.kind, p.method), amount: Number(p.amount) })),
      moves
        .filter((m) => m.kind === "withdrawal" || m.kind === "deposit")
        .map((m) => ({
          type: m.kind === "withdrawal" ? ("retiro" as const) : ("ingreso" as const),
          amount: Number(m.amount),
          reason: m.note ?? "",
        })),
    );
    const inv = await q
      .select({ total: s.invoice.total, orderId: s.invoice.orderId })
      .from(s.invoice)
      .innerJoin(s.orders, eq(s.orders.id, s.invoice.orderId))
      .where(
        and(
          eq(s.invoice.storeId, storeId),
          eq(s.orders.periodId, periodId),
          ne(s.invoice.status, "cancelled"),
        ),
      );
    const orderIds = [...new Set(inv.map((i) => i.orderId!).filter(Boolean))];
    let guests: number = 0;
    if (orderIds.length) {
      guests = (
        await q
          .select({ g: sql<number>`coalesce(sum(${s.orders.guests}),0)` })
          .from(s.orders)
          .where(and(eq(s.orders.storeId, storeId), inArray(s.orders.id, orderIds)))
      )[0]!.g;
    }
    const card = r2(sum(pays.filter((p) => paymentKind(p.kind, p.method) === "card").map((p) => p.amount)));
    return {
      ...r,
      card,
      other: r2(D(r.card).minus(card)),
      totalSales: r2(sum(inv.map((i) => i.total))),
      tickets: inv.length,
      guests: Number(guests),
    };
  }
}
