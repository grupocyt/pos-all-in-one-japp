import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { schema as s, type Database, type Db, type Tx } from "@japp/db";
import { D, expectedCash, paymentKind, r2, sum, type Actor } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;
export type PeriodRow = typeof s.salesPeriod.$inferSelect;

/**
 * Periodos de venta (sales_period), su cierre (cash_closing) y lo que dice la caja del periodo.
 * Lo que lee recibe la transacción, la base o null (= fuera de transacción, con la base inyectada).
 */
/**
 * 1.2.292 · Efectivo devuelto en los abonos emitidos durante el periodo (entre su apertura y su cierre): la parte en
 * efectivo de lo que se cobró en la factura abonada (si se pagó con efectivo y tarjeta, en proporción). Sale del cajón.
 */
export async function cashRefunds(q: Tx | Database["db"], storeId: string, periodId: string): Promise<number> {
  const r = (
    await q.execute(sql`SELECT abs(i.total)::float8 total,
        coalesce((SELECT sum(p.amount) FROM payment p LEFT JOIN payment_method pm ON pm.id = p.payment_method_id
          WHERE p.account_id = o.account_id AND p.status = 'confirmed' AND p.amount > 0 AND (pm.kind = 'cash' OR p.method = 'cash')), 0)::float8 cash,
        coalesce((SELECT sum(p.amount) FROM payment p WHERE p.account_id = o.account_id AND p.status = 'confirmed' AND p.amount > 0), 0)::float8 paid
      FROM invoice i JOIN invoice o ON o.id = i.rectified_invoice_id JOIN sales_period sp ON sp.id = ${periodId}
      WHERE i.store_id = ${storeId} AND i.type LIKE 'R%' AND i.status <> 'cancelled'
        AND i.issued_at >= sp.opened_by_at AND (sp.closed_by_at IS NULL OR i.issued_at <= sp.closed_by_at)`)
  ).rows as { total: number; cash: number; paid: number }[];
  return r2(r.reduce((t, x) => t + (x.paid > 0 ? Math.min(x.total, (x.total * x.cash) / x.paid, x.cash) : 0), 0));
}

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
   * Mesas abiertas (open o billing) del periodo sin nada vivo: sin productos ni cobros en las cuentas sin facturar
   * (vacías, o con todo facturado y solo cuentas vacías), sin tocar desde hace `idleSeconds` (una recién abierta sí
   * cuenta: alguien va a marcar).
   */
  async emptyOpenOrderIds(storeId: string, periodId: string, idleSeconds = 120): Promise<string[]> {
    const r = await this.database.db.execute(sql`
      SELECT o.id FROM orders o
      WHERE o.store_id = ${storeId} AND o.period_id = ${periodId} AND o.status IN ('open', 'billing')
        AND o.updated_at < now() - make_interval(secs => ${idleSeconds}::int)
        AND NOT EXISTS (SELECT 1 FROM order_line l JOIN account a ON a.id = l.account_id
                        WHERE l.order_id = o.id AND NOT l.deleted AND a.status NOT IN ('invoiced', 'cancelled'))
        AND NOT EXISTS (SELECT 1 FROM payment y JOIN account a ON a.id = y.account_id
                        WHERE a.order_id = o.id AND y.status = 'confirmed' AND a.status NOT IN ('invoiced', 'cancelled'))`);
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
      /** 11 (04/11): motivo del descuadre, para el corte Z */
      note?: string | null;
      /** 0033 · lo que marcó cada datáfono */
      cardDetail?: { name: string; amount: number }[] | null;
      /** 0043 · lo contado de cada forma de pago */
      methodDetail?: { method: string; name: string; counted: number; expected: number | null }[] | null;
    },
    a: Actor,
  ) {
    await tx.insert(s.cashClosing).values({
      id: crypto.randomUUID(),
      storeId,
      periodId,
      countedCash: c.countedCash.toFixed(2),
      countedCard: c.countedCard.toFixed(2),
      cardDetail: c.cardDetail ?? null,
      methodDetail: c.methodDetail ?? null,
      expectedCash: c.expectedCash.toFixed(2),
      difference: c.difference.toFixed(2),
      nextFloat: c.nextFloat.toFixed(2),
      deposit: c.deposit.toFixed(2),
      grossSales: c.grossSales.toFixed(2),
      guests: c.guests,
      note: c.note?.trim() ? c.note.trim().slice(0, 300) : null,
      byUserId: a.userId,
      byUserName: a.user,
      byRole: a.role,
      byDevice: a.device,
      byAt: a.at,
    } as any);
  }

  /** 11 (04/11): el cierre de caja del periodo (lo contado, la diferencia y el motivo), o null si aún no se ha cerrado. */
  /** 11/11 (D2) · el último cierre de la tienda: su «fondo para el día siguiente» es el fondo del periodo que se abre. */
  async lastClosing(tx: Tx | null, storeId: string) {
    const [r] = await this.q(tx)
      .select({ nextFloat: s.cashClosing.nextFloat })
      .from(s.cashClosing)
      .where(eq(s.cashClosing.storeId, storeId))
      .orderBy(desc(s.cashClosing.byAt))
      .limit(1);
    return r ?? null;
  }

  async closingOf(storeId: string, periodId: string) {
    const [r] = await this.database.db
      .select()
      .from(s.cashClosing)
      .where(and(eq(s.cashClosing.storeId, storeId), eq(s.cashClosing.periodId, periodId)));
    return r ?? null;
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
      pays.map((p) => ({
        kind: paymentKind(p.kind, p.method),
        amount: Number(p.amount),
        tip: Number(p.tip ?? 0),
      })),
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
          notInArray(s.invoice.status, ["cancelled", "substituted"]), // F3 (04/11): la sustituida no cuenta dos veces
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
    // 1.2.283 · por forma de pago (lo que dice el sistema en el corte X y el cierre): importe y propinas de cada una
    const byPay = new Map<string, { code: string; kind: string; amount: number; tips: number; count: number }>();
    for (const p of pays) {
      const kind = paymentKind(p.kind, p.method);
      const m = byPay.get(p.method) ?? { code: p.method, kind, amount: 0, tips: 0, count: 0 };
      m.amount = r2(D(m.amount).plus(Number(p.amount)));
      m.tips = r2(D(m.tips).plus(Number(p.tip ?? 0)));
      m.count += 1;
      byPay.set(p.method, m);
    }
    // 1.2.292 · abonos en efectivo: lo devuelto sale del cajón (decidido el 20/11), así que resta de lo esperado
    const refunds = await cashRefunds(q, storeId, periodId);
    return {
      ...r,
      cashSales: r2(D(r.cashSales).minus(refunds)),
      expected: r2(D(r.expected).minus(refunds)),
      cashRefunds: refunds,
      card,
      byPayment: [...byPay.values()].sort((a, b) => b.amount - a.amount),
      other: r2(D(r.card).minus(card)),
      totalSales: r2(sum(inv.map((i) => i.total))),
      tickets: inv.length,
      guests: Number(guests),
    };
  }
}
