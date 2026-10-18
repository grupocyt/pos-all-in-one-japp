import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { schema as s, type Database, type Tx } from "@japp/db";
import { cashDifference, expectedCash, fail, r2 } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../common/tokens-di.js";
import { CurrentSession, type Session } from "../common/auth.js";
import { Authorization } from "../common/authorization.js";
import { parse } from "../common/validate.js";
import { StoreRepo } from "../repos/store.repo.js";
import { ClosingsService } from "./closings.service.js";

/** Lo que dice la caja del periodo abierto (= cajaTeorico). Lo usan /cash/summary y el cierre. */
export async function cashState(tx: Tx | Database["db"], storeId: string, periodId: string, defaultFloat: number) {
  const pays = await tx.select({ method: s.payment.method, amount: s.payment.amount, tip: s.payment.tip })
    .from(s.payment).innerJoin(s.account, eq(s.account.id, s.payment.accountId)).innerJoin(s.orders, eq(s.orders.id, s.account.orderId))
    .where(and(eq(s.payment.storeId, storeId), eq(s.orders.periodId, periodId), eq(s.payment.status, "confirmed")));
  const moves = await tx.select().from(s.cashMovement).where(and(eq(s.cashMovement.storeId, storeId), eq(s.cashMovement.periodId, periodId)));
  const float = moves.filter(m => m.kind === "float").reduce((a, m) => a + Number(m.amount), 0) || defaultFloat;
  const r = expectedCash(float, pays.map(p => ({ kind: p.method === "cash" ? "cash" as const : "card" as const, amount: Number(p.amount) })),
    moves.filter(m => m.kind === "withdrawal" || m.kind === "deposit").map(m => ({ type: m.kind === "withdrawal" ? "retiro" as const : "ingreso" as const, amount: Number(m.amount), reason: m.note ?? "" })));
  const inv = await tx.select({ total: s.invoice.total, orderId: s.invoice.orderId }).from(s.invoice).innerJoin(s.orders, eq(s.orders.id, s.invoice.orderId))
    .where(and(eq(s.invoice.storeId, storeId), eq(s.orders.periodId, periodId), ne(s.invoice.status, "cancelled")));
  const orderIds = [...new Set(inv.map(i => i.orderId!).filter(Boolean))];
  const guests = orderIds.length ? (await tx.select({ g: sql<number>`coalesce(sum(${s.orders.guests}),0)` }).from(s.orders).where(inArray(s.orders.id, orderIds)))[0]!.g : 0;
  return { ...r, totalSales: r2(inv.reduce((a, i) => a + Number(i.total), 0)), tickets: inv.length, guests: Number(guests) };
}

@Controller()
export class PeriodsController {
  constructor(@Inject(DATABASE) private readonly database: Database, @Inject(StoreRepo) private readonly stores: StoreRepo, @Inject(Authorization) private readonly auth: Authorization, @Inject(CLOCK) private readonly clock: Clock, @Inject(ClosingsService) private readonly closings: ClosingsService) {}

  static async current(q: Tx | Database["db"], storeId: string) {
    const [p] = await q.select().from(s.salesPeriod).where(and(eq(s.salesPeriod.storeId, storeId), eq(s.salesPeriod.openFlag, 1)));
    return p ?? null;
  }
  private view = (p: typeof s.salesPeriod.$inferSelect) => ({ id: p.id, status: p.status, openedBy: { user: p.openedByUserName, device: p.openedByDevice ?? "", at: new Date(p.openedByAt).toISOString() } });

  @Get("periods/current")
  async getCurrent(@CurrentSession() session: Session) {
    const p = await PeriodsController.current(this.database.db, session.storeId);
    if (!p) fail("PERIOD_CLOSED", "No hay periodo abierto");
    return this.view(p!);
  }

  /** Abrir periodo con el fondo de caja de Parámetros. Solo uno abierto por tienda (lo garantiza la base). */
  @Post("periods") @HttpCode(201)
  async open(@Body() body: unknown, @CurrentSession() session: Session) {
    const b = parse(z.object({ authorization: z.string().nullish() }).passthrough(), body);
    await this.auth.require(session, "funciones.periodo", b.authorization);
    const store = await this.stores.store();
    const now = this.clock(), a = session.actor(now);
    return this.database.withTx(async tx => {
      if (await PeriodsController.current(tx, session.storeId)) fail("VALIDATION", "Ya hay un periodo abierto", { field: "period" });
      const id = crypto.randomUUID();
      await tx.insert(s.salesPeriod).values({ id, storeId: session.storeId, status: "open", openFlag: 1, stationId: session.station.id, openedByUserId: a.userId, openedByUserName: a.user, openedByRole: a.role, openedByDevice: a.device, openedByAt: a.at } as any);
      await tx.insert(s.cashMovement).values({ id: crypto.randomUUID(), storeId: session.storeId, periodId: id, stationId: session.station.id, kind: "float", amount: store.cashFloat.toFixed(2), note: "Fondo inicial", byUserId: a.userId, byUserName: a.user, byRole: a.role, byDevice: a.device, byAt: a.at } as any);
      return this.view((await PeriodsController.current(tx, session.storeId))!);
    });
  }

  /** Cierre: arqueo ciego contra lo esperado; descuadre por encima del umbral exige nota. */
  @Post("periods/:periodId/close") @HttpCode(200)
  async close(@Param("periodId") periodId: string, @Body() body: unknown, @CurrentSession() session: Session) {
    const b = parse(z.object({ countedCash: z.number().min(0), countedCard: z.number().min(0).default(0), nextFloat: z.number().min(0), deposit: z.number().min(0).default(0), note: z.string().max(300).nullish(), authorization: z.string().nullish() }), body);
    await this.auth.require(session, "funciones.periodo", b.authorization);
    const store = await this.stores.store();
    const now = this.clock(), a = session.actor(now);
    return this.database.withTx(async tx => {
      const [p] = await tx.select().from(s.salesPeriod).where(and(eq(s.salesPeriod.id, periodId), eq(s.salesPeriod.storeId, session.storeId))).for("update");
      if (!p || p.status !== "open") fail("PERIOD_CLOSED", "Ese periodo no está abierto", { periodId });
      const [open] = await tx.select({ n: sql<number>`count(*)` }).from(s.orders).where(and(eq(s.orders.periodId, periodId), inArray(s.orders.status, ["open", "billing"])));
      if (Number(open!.n) > 0) fail("VALIDATION", "Quedan mesas abiertas: cóbralas o ciérralas antes", { openOrders: Number(open!.n) });
      const c = await cashState(tx, session.storeId, periodId, store.cashFloat);
      const d = cashDifference(b.countedCash, c.expected, store.cashDiffThreshold);
      if (d.needsReason && !b.note?.trim()) fail("VALIDATION", "El descuadre supera el umbral: escribe el motivo", { field: "note", difference: d.diff });
      await tx.insert(s.cashClosing).values({ id: crypto.randomUUID(), storeId: session.storeId, periodId, countedCash: b.countedCash.toFixed(2), countedCard: b.countedCard.toFixed(2), expectedCash: c.expected.toFixed(2), difference: d.diff.toFixed(2), nextFloat: b.nextFloat.toFixed(2), deposit: b.deposit.toFixed(2), grossSales: c.totalSales.toFixed(2), guests: c.guests, byUserId: a.userId, byUserName: a.user, byRole: a.role, byDevice: a.device, byAt: a.at } as any);
      await tx.update(s.salesPeriod).set({ status: "closed", openFlag: null, closedByUserId: a.userId, closedByUserName: a.user, closedByRole: a.role, closedByDevice: a.device, closedByAt: a.at } as any).where(eq(s.salesPeriod.id, periodId));
      // Gestor de cierres: resumen del periodo (y a la cola hacia el Manager) en la misma transacción
      const sum = await this.closings.persist(tx, session.storeId, periodId, d.diff, a.at, a.user);
      return { closing: { expectedCash: c.expected, difference: d.diff, grossSales: c.totalSales, guests: c.guests, tickets: sum.tickets, businessDate: sum.businessDate }, incidentRequest: null };
    });
  }

  @Get("cash/summary")
  async summary(@CurrentSession() session: Session) {
    await this.auth.require(session, "funciones.caja");
    const store = await this.stores.store();
    const p = await PeriodsController.current(this.database.db, session.storeId);
    if (!p) fail("PERIOD_CLOSED", "No hay periodo abierto");
    const c = await cashState(this.database.db, session.storeId, p!.id, store.cashFloat);
    return { float: c.opening, cashSales: c.cashSales, withdrawals: c.withdrawals, expectedCash: c.expected, cardSales: c.card, totalSales: c.totalSales, tickets: c.tickets };
  }
}
