import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema as s, type Database } from "@japp/db";
import { assertDetailMatches, assertMainStation, cashDifference, fail, r2, voidsOf } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../common/tokens-di.js";
import { CurrentSession, type Session } from "../common/auth.js";
import { Authorization } from "../common/authorization.js";
import { ActiveSessions } from "../common/active-sessions.js";
import { parse } from "../common/validate.js";
import { PeriodsController, cashState } from "./periods.controller.js";
import { StoreRepo } from "../repos/store.repo.js";
import { OrdersService } from "./orders.service.js";
import { ClosingsService } from "./closings.service.js";

/** Consultas de Funciones (facturas, informes, caja) y Developer. Solo lectura salvo movimientos de caja. */
@Controller()
export class ReportsController {
  constructor(@Inject(DATABASE) private readonly database: Database, @Inject(Authorization) private readonly auth: Authorization, @Inject(CLOCK) private readonly clock: Clock, @Inject(OrdersService) private readonly orders: OrdersService, @Inject(ClosingsService) private readonly closings: ClosingsService, @Inject(ActiveSessions) private readonly active: ActiveSessions, @Inject(StoreRepo) private readonly stores: StoreRepo) {}

  /** Salir: la sesión deja de valer (app_session.ended_reason = logout). */
  @Delete("sessions/current") @HttpCode(200)
  async logout(@CurrentSession() se: Session) { await this.active.end(se.storeId, se.user.id, se.jti); }

  @Get("invoices")
  async invoices(@CurrentSession() se: Session, @Query("from") rawFrom?: string, @Query("to") rawTo?: string, @Query("q") q?: string) {
    await this.auth.require(se, "funciones.facturas");
    // AAAA-MM-DD (día entero en UTC; «hasta» incluye todo ese día) o fecha ISO completa
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const when = z.string().refine(v => (day.test(v) || /^\d{4}-\d{2}-\d{2}T/.test(v)) && !Number.isNaN(Date.parse(v)), "fecha no válida (AAAA-MM-DD o ISO 8601)");
    const f = parse(z.object({ from: when.optional(), to: when.optional() }), { from: rawFrom || undefined, to: rawTo || undefined });
    const from = f.from ? new Date(f.from).toISOString() : undefined;
    const to = f.to ? (day.test(f.to) ? new Date(Date.parse(f.to) + 864e5 - 1) : new Date(f.to)).toISOString() : undefined;
    const db = this.database.db;
    const rows = await db.select({ i: s.invoice, table: s.orders.tableName }).from(s.invoice).leftJoin(s.orders, eq(s.orders.id, s.invoice.orderId))
      .where(and(eq(s.invoice.storeId, se.storeId), ...(from ? [gte(s.invoice.issuedAt, from)] : []), ...(to ? [lte(s.invoice.issuedAt, to)] : []),
        ...(q ? [or(ilike(s.invoice.invoiceNumber, `%${q}%`), ilike(s.orders.tableName, `%${q}%`), ilike(s.invoice.customerName, `%${q}%`))!] : [])))
      .orderBy(desc(s.invoice.issuedAt)).limit(500);
    const accIds = rows.map(r => r.i.accountId!).filter(Boolean);
    const pays = accIds.length ? await db.select({ acc: s.payment.accountId, m: s.payment.method }).from(s.payment).where(and(eq(s.payment.storeId, se.storeId), inArray(s.payment.accountId, accIds), eq(s.payment.status, "confirmed"))) : [];
    return { items: rows.map(r => ({ id: r.i.id, invoiceNumber: r.i.invoiceNumber, type: r.i.type, table: r.table ?? "", issuedAt: new Date(r.i.issuedAt).toISOString(), total: Number(r.i.total), customer: r.i.customerName, methods: [...new Set(pays.filter(p => p.acc === r.i.accountId).map(p => p.m))] })) };
  }

  @Get("invoices/:invoiceId")
  async invoice(@CurrentSession() se: Session, @Param("invoiceId") id: string) {
    await this.auth.require(se, "funciones.facturas");
    const [i] = await this.database.db.select().from(s.invoice).where(and(eq(s.invoice.storeId, se.storeId), eq(s.invoice.id, parse(z.string().uuid(), id))));
    if (!i) fail("NOT_FOUND", "La factura no existe", { invoiceId: id });
    const taxes = await this.database.db.select().from(s.invoiceTax).where(and(eq(s.invoiceTax.storeId, se.storeId), eq(s.invoiceTax.invoiceId, i!.id)));
    return {
      id: i!.id, invoiceNumber: i!.invoiceNumber, type: i!.type, issuedAt: new Date(i!.issuedAt).toISOString(), total: Number(i!.total), taxBase: Number(i!.taxBase), taxTotal: Number(i!.taxTotal),
      customer: i!.customerTaxId ? { name: i!.customerName, taxId: i!.customerTaxId } : null, verifactuQr: i!.verifactuQr,
      taxes: taxes.map(t => ({ rate: Number(t.rate), base: Number(t.base), tax: Number(t.tax) })).sort((a, b) => a.rate - b.rate),
    };
  }

  /** Reimprimir el ticket de una factura (mismo formato; queda en el historial de la mesa). */
  @Post("invoices/:invoiceId/reprint") @HttpCode(200)
  async reprint(@CurrentSession() se: Session, @Param("invoiceId") id: string) {
    await this.auth.require(se, "funciones.facturas");
    const [i] = await this.database.db.select({ orderId: s.invoice.orderId, accountId: s.invoice.accountId, num: s.invoice.invoiceNumber }).from(s.invoice)
      .where(and(eq(s.invoice.storeId, se.storeId), eq(s.invoice.id, parse(z.string().uuid(), id))));
    if (!i?.orderId || !i.accountId) fail("NOT_FOUND", "La factura no existe", { invoiceId: id });
    const printed = await this.orders.printInvoice(se, i!.orderId!, i!.accountId!);
    const a = se.actor(this.clock());
    await this.database.db.insert(s.orderEvent).values({ id: crypto.randomUUID(), storeId: se.storeId, orderId: i!.orderId, accountId: i!.accountId, type: "invoiceReprinted", description: `Reimpresión de ${i!.num}`, at: a.at, userId: a.userId, userName: a.user, role: a.role, device: a.device, origin: a.origin } as any);
    return { printed };
  }

  /** Retiro (a caja fuerte / banco), fondo o depósito. El retiro necesita motivo. */
  @Post("cash/movements") @HttpCode(201)
  async movement(@CurrentSession() se: Session, @Body() body: unknown) {
    const b = parse(z.object({ kind: z.enum(["withdrawal", "float", "deposit"]), amount: z.number().positive().max(100000), reasonId: z.string().nullish(), note: z.string().max(300).nullish(), authorization: z.string().nullish() }), body);
    const g = await this.auth.require(se, "funciones.caja", b.authorization);
    assertMainStation(se.station);
    const p = await PeriodsController.current(this.database.db, se.storeId);
    if (!p) fail("PERIOD_CLOSED", "No hay periodo abierto");
    let reasonId: string | null = null, note = b.note ?? null;
    if (b.reasonId) {
      const [r] = await this.database.db.select().from(s.reason).where(and(eq(s.reason.storeId, se.storeId), or(eq(s.reason.name, b.reasonId), sql`${s.reason.id}::text = ${b.reasonId}`)));
      reasonId = r?.id ?? null; note = note ?? r?.name ?? b.reasonId;
    }
    if (b.kind === "withdrawal" && !note?.trim()) fail("VALIDATION", "El retiro necesita motivo", { field: "reasonId" });
    const a = se.actor(this.clock()), id = crypto.randomUUID();
    await this.database.db.insert(s.cashMovement).values({ id, storeId: se.storeId, periodId: p!.id, stationId: se.station.id, kind: b.kind, amount: b.amount.toFixed(2), reasonId, note,
      byUserId: a.userId, byUserName: a.user, byRole: a.role, byDevice: a.device, byAt: a.at, authorizedBy: g.authorizerActor?.user ?? null } as any);
    return { id };
  }

  /**
   * Arqueo sin cierre (Gestiones › Arqueo de caja): lo contado frente a lo esperado ahora mismo
   * (fondo + efectivo cobrado − retiros + ingresos, la misma cuenta que el cierre). Queda como cash_movement «count» con el detalle.
   * Solo desde la caja principal; no cambia lo esperado.
   */
  @Post("cash/counts") @HttpCode(201)
  async count(@CurrentSession() se: Session, @Body() body: unknown) {
    const b = parse(z.object({
      countedCash: z.number().min(0).max(1_000_000),
      detail: z.record(z.string().max(10), z.number().int().min(0).max(100_000)).nullish(),
      note: z.string().max(200).nullish(), authorization: z.string().nullish(),
    }).strict(), body);
    assertDetailMatches(b.detail, b.countedCash); // el desglose suma lo contado al céntimo
    const g = await this.auth.require(se, "funciones.caja", b.authorization);
    assertMainStation(se.station);
    const store = await this.stores.store();
    const p = await PeriodsController.current(this.database.db, se.storeId);
    if (!p) fail("PERIOD_CLOSED", "No hay periodo abierto");
    const c = await cashState(this.database.db, se.storeId, p!.id, store.cashFloat);
    const d = cashDifference(b.countedCash, c.expected, store.cashDiffThreshold);
    const a = se.actor(this.clock()), id = crypto.randomUUID();
    await this.database.db.insert(s.cashMovement).values({ id, storeId: se.storeId, periodId: p!.id, stationId: se.station.id, kind: "count", amount: b.countedCash.toFixed(2),
      countedDetail: b.detail ?? null, note: b.note ?? null, byUserId: a.userId, byUserName: a.user, byRole: a.role, byDevice: a.device, byAt: a.at, authorizedBy: g.authorizerActor?.user ?? null } as any);
    return { id, countedCash: r2(b.countedCash), expectedCash: c.expected, difference: d.diff, at: a.at, by: { user: a.user, device: a.device ?? "" } };
  }

  /** Eliminaciones: qué se quitó después de enviar, en qué momento (enviado o precuenta), quién, por qué y quién lo autorizó (regla voidsOf). */
  @Get("reports/deletions")
  async deletions(@CurrentSession() se: Session) {
    await this.auth.require(se, "funciones.informes");
    const db = this.database.db;
    const rows = await db.select({ l: s.orderLine, table: s.orders.tableName }).from(s.orderLine).innerJoin(s.orders, and(eq(s.orders.id, s.orderLine.orderId), eq(s.orders.storeId, se.storeId)))
      .where(and(eq(s.orderLine.storeId, se.storeId), eq(s.orderLine.deleted, true), or(eq(s.orderLine.printed, true), inArray(s.orderLine.deletedStage, ["printed", "preBill"])))).orderBy(desc(s.orderLine.deletedByAt)).limit(500);
    const ids = rows.map(r => r.l.id);
    const mods = ids.length ? await db.select({ lineId: s.orderLineModifier.lineId, unitPrice: s.orderLineModifier.unitPrice, quantity: s.orderLineModifier.quantity }).from(s.orderLineModifier)
      .where(and(eq(s.orderLineModifier.storeId, se.storeId), inArray(s.orderLineModifier.lineId, ids))) : [];
    const v = voidsOf(rows.map(r => ({ r, reason: r.l.deleteReason, stage: r.l.deletedStage, printed: r.l.printed, quantity: Number(r.l.quantity), unitPrice: Number(r.l.unitPrice),
      modifiers: mods.filter(m => m.lineId === r.l.id).map(m => ({ unitPrice: Number(m.unitPrice), quantity: Number(m.quantity) })) })));
    return { items: v.map(({ r, stage, amount }) => ({
      at: r.l.deletedByAt ? new Date(r.l.deletedByAt).toISOString() : "", table: r.table, product: r.l.name, stage, user: r.l.deletedByUserName ?? "",
      reason: r.l.deleteReason ?? "", authorizedBy: r.l.deleteAuthorizedByUserName ?? "", amount,
    })) };
  }

  /** Developer › Transacciones. */
  @Get("transactions")
  async transactions(@CurrentSession() se: Session, @Query("status") status?: string, @Query("q") q?: string) {
    await this.auth.require(se, "ajustes.devtx");
    const rows = await this.database.db.select({ o: s.orders, total: sql<string>`coalesce((select sum(a.total) from account a where a.order_id = "orders"."id" and a.status <> 'cancelled'), 0)` })
      .from(s.orders).where(and(eq(s.orders.storeId, se.storeId), ...(status === "open" ? [inArray(s.orders.status, ["open", "billing"])] : status === "closed" ? [eq(s.orders.status, "closed")] : []),
        ...(q ? [or(ilike(s.orders.tableName, `%${q}%`), ilike(s.orders.zone, `%${q}%`), sql`${s.orders.id}::text ilike ${"%" + q + "%"}`)!] : [])))
      .orderBy(desc(s.orders.openedByAt)).limit(300);
    return { items: rows.map(r => ({ id: r.o.id, table: r.o.tableName, zone: (r.o.zone ?? "").toLowerCase(), status: r.o.status, version: r.o.version, total: Number(r.total) })) };
  }

  /** Gestor de cierres: un resumen por periodo (el abierto, calculado al vuelo) con el mismo día del año anterior. */
  @Get("reports/closings")
  async closingsList(@CurrentSession() se: Session, @Query("from") from?: string, @Query("to") to?: string) {
    await this.auth.require(se, "ajustes.cierres");
    return this.closings.list(se.storeId, from, to);
  }

  @Get("reports/closings/:periodId")
  async closingDetail(@CurrentSession() se: Session, @Param("periodId") periodId: string) {
    parse(z.string().uuid(), periodId);
    await this.auth.require(se, "ajustes.cierres");
    return this.closings.detail(se.storeId, periodId);
  }

  /** 52 semanas: real, año anterior y proyección (objetivo de Ajustes › objetivos). */
  @Get("reports/weeks")
  async weeks(@CurrentSession() se: Session, @Query("year") year?: string) {
    await this.auth.require(se, "ajustes.cierres");
    return this.closings.weeks(se.storeId, year ? Number(year) : new Date(this.clock()).getUTCFullYear());
  }

  /** Venta en vivo: el pulso que el agente manda al Manager cada minuto. */
  @Get("reports/live")
  async live(@CurrentSession() se: Session) {
    await this.auth.require(se, "ajustes.cierres");
    return this.closings.live(se.storeId);
  }

  /** Developer › Sincronización: cola hacia el Manager. */
  @Get("sync/status")
  async syncStatus(@CurrentSession() se: Session) {
    await this.auth.require(se, "ajustes.devsync");
    return this.closings.syncStatus(se.storeId);
  }
}
