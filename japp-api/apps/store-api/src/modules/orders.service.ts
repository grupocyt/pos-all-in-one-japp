import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { schema as s, type Database, type Tx } from "@japp/db";
import {
  addProduct, applyDiscount, removeDiscount, setCustomer, removeEmptyAccount, assertVersion, changeQuantity, deleteLine, fail, fastFoodTableId, issueInvoice, moveUnits, preBill, registerPayment,
  accountTotals, kitchenTicket, preBillTicket, invoiceTicket, type TicketContext, type Account, type Ctx, type Modifier, type Order, type Product,
  checkAnswers, reorderPending, planCourses, courseOfAnswer, chooseCourse, absorbIntoMenu, sendWithCourses, courseLabel, MENU_ABSORB_REASON, type QuestionRule, type KitchenItem,
  applyPresence, assertCanCommand, kitchenItemOf, canEnterTable, transferAccount, assertMethodAllowed, presenceView, paymentKind, r2, sum, PRESENCE_LEASE_SECONDS, type CommandKind, type PresenceAction, type PresenceState,
} from "@japp/domain";
import { CLOCK, DATABASE, PRINTER, type Clock } from "../common/tokens-di.js";
import type { Session } from "../common/auth.js";
import { Authorization } from "../common/authorization.js";
import { OrderRepo, type Loaded, type OrderEvent, type OrderHeader } from "../repos/order.repo.js";
import { StoreRepo } from "../repos/store.repo.js";
import { PeriodsController } from "./periods.controller.js";
import type { PrinterPort } from "../ports/printer.js";

type Result<T> = {
  loaded: Loaded; next: Order; events: OrderEvent[]; extra?: T; movedReason?: string;
  /** nada cambió: no se guarda, no sube la versión ni va a la cola */
  noop?: boolean;
  /** se cerró el cobro abierto de la mesa (pendiente a 0 o factura) */
  clearCharging?: boolean;
  /** después de guardar, en la misma transacción (p. ej. apuntar a qué impresora va cada línea) */
  afterSave?: (tx: Tx) => Promise<void>;
};
/** Comanda para una impresora; rows = filas de order_line_printer que marca al imprimir. */
interface KitchenJob { channel: string; printer: string; printerId: string | null; connection: string; items: KitchenItem[]; rows: string[]; table: { name: string; area: string }; guests: number; waiter: string; at: Date; }
type Printed = { channel: string; printer: string; lines: number; ok: boolean };
/** Un intento de impresión en curso «reserva» sus filas este tiempo (printed_at con printed = false); pasado, otro envío las reintenta. */
const PRINT_CLAIM_SECONDS = 60;

/**
 * Casos de uso de la orden. Todos siguen el mismo patrón (ver CLAUDE.md):
 * transacción → cargar con FOR UPDATE → comprobar versión → dominio → guardar + outbox → responder.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OrderRepo) private readonly repo: OrderRepo,
    @Inject(StoreRepo) private readonly stores: StoreRepo,
    @Inject(Authorization) private readonly auth: Authorization,
    @Inject(PRINTER) private readonly printer: PrinterPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  ctx(session: Session): Ctx { const now = this.clock(); return { now, newId: () => crypto.randomUUID(), actor: session.actor(now) }; }

  /**
   * Esqueleto común de los comandos sobre una orden.
   * Una persona por mesa: si otra persona (u otro equipo) tiene la mesa, solo pasan los comandos «save» (añadir y enviar);
   * si quien llama la tiene, cada comando aceptado le renueva el plazo. Sin presencia, todo como siempre.
   */
  private async command<T = undefined>(session: Session, orderId: string, version: number | null | undefined,
    fn: (l: Loaded, ctx: Ctx, tx: Tx) => Promise<Omit<Result<T>, "loaded">> | Omit<Result<T>, "loaded">, opts: { kind?: CommandKind } = {}) {
    const ctx = this.ctx(session);
    return this.database.withTx(async tx => {
      const loaded = await this.repo.load(tx, session.storeId, orderId, { lock: true });
      if (loaded.header.status === "closed" || loaded.header.status === "cancelled") fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
      if (version != null) assertVersion(loaded.header.version, version);
      const g = assertCanCommand(loaded.header.presence, { userId: session.user.id, stationId: session.station.id }, opts.kind ?? "other", ctx.now);
      const r = await fn(loaded, ctx, tx);
      let v = loaded.header.version;
      if (!r.noop) {
        v = await this.repo.save(tx, session.storeId, loaded.order, r.next, loaded.header, { actor: ctx.actor, events: r.events, movedReason: r.movedReason });
        await r.afterSave?.(tx);
      }
      const p = loaded.header.presence;
      if (g.holds || (r.clearCharging && p.chargingUntil)) {
        const holder = g.holds && p.holder ? { ...p.holder, until: new Date(ctx.now.getTime() + PRESENCE_LEASE_SECONDS * 1000).toISOString() } : p.holder;
        await this.repo.savePresence(tx, session.storeId, orderId, { holder, chargingUntil: r.clearCharging ? null : p.chargingUntil });
      }
      const after = await this.repo.load(tx, session.storeId, orderId);
      return { transaction: await this.repo.transaction(tx, { ...after.header, version: v }, after.order), extra: r.extra as T, order: after.order };
    });
  }

  /**
   * Una persona por mesa: entrar, renovar, salir, abrir y cerrar el cobro (regla en @japp/domain → applyPresence).
   * No cambia la versión de la orden. Si alguien con mesas.entrarOcupada desplaza a otro, queda en el historial.
   */
  async presence(session: Session, orderId: string, action: PresenceAction) {
    const now = this.clock(), a = session.actor(now);
    const me = { userId: session.user.id, userName: session.user.name, stationId: session.station.id, stationName: session.station.name, canTakeOver: session.can("mesas.entrarOcupada") };
    return this.database.withTx(async tx => {
      const [o] = await tx.select().from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, session.storeId))).for("update");
      if (!o) fail("NOT_FOUND", "La orden no existe", { orderId });
      if (o!.status === "closed" || o!.status === "cancelled") fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
      const before = OrderRepo.presenceOf(o!);
      const r = applyPresence(before, action, me, now);
      if (JSON.stringify(r.state) !== JSON.stringify(before)) await this.repo.savePresence(tx, session.storeId, orderId, r.state);
      if (r.displaced) {
        await tx.insert(s.orderEvent).values({ id: crypto.randomUUID(), storeId: session.storeId, orderId, type: "tableTakenOver",
          description: `${me.userName} entra en la mesa; ${r.displaced.userName} pasa a solo guardar`, at: a.at, userId: a.userId, userName: a.user, role: a.role, device: a.device, origin: a.origin } as any);
      }
      return presenceView(r.state, me, now);
    });
  }

  private account(order: Order, accountId?: string | null): Account {
    const a = accountId ? order.accounts.find(x => x.id === accountId) : order.accounts.find(x => x.status === "open");
    if (!a) fail(accountId ? "NOT_FOUND" : "ACCOUNT_CLOSED", accountId ? "La cuenta no existe" : "No hay ninguna cuenta abierta", { accountId });
    return a!;
  }
  private replace(order: Order, acc: Account): Order { return { ...order, accounts: order.accounts.map(a => (a.id === acc.id ? acc : a)) }; }
  private ev(type: string, description: string, ctx: Ctx, accountId?: string): OrderEvent { return { type, description, actor: ctx.actor, accountId }; }

  async get(session: Session, orderId: string) {
    return this.database.withTx(async tx => { const l = await this.repo.load(tx, session.storeId, orderId); return this.repo.transaction(tx, l.header, l.order); });
  }

  async list(session: Session, status?: string, tableId?: string) {
    const rows = await this.database.db.select({ id: s.orders.id, tableName: s.orders.tableName, status: s.orders.status, version: s.orders.version }).from(s.orders)
      .where(and(eq(s.orders.storeId, session.storeId), ...(status ? [eq(s.orders.status, status)] : [inArray(s.orders.status, ["open", "billing"])]), ...(tableId ? [eq(s.orders.tableId, tableId)] : [])))
      .orderBy(desc(s.orders.openedByAt)).limit(500);
    return { items: rows };
  }

  /** Abrir mesa (o el pedido fast food FF-<estación>). Una mesa solo puede tener una orden abierta. */
  async open(session: Session, b: { id?: string; accountId?: string; accountName?: string; tableId: string; guests: number; authorization?: string | null }) {
    await this.auth.require(session, "mesas.abrirMesa", b.authorization);
    const ctx = this.ctx(session);
    const store = await this.stores.store();
    return this.database.withTx(async tx => {
      const period = await PeriodsController.current(tx, session.storeId);
      if (!period) fail("PERIOD_CLOSED", "No hay periodo abierto");
      const ff = b.tableId.startsWith("FF-");
      if (ff && store.serviceType !== "fastfood") fail("VALIDATION", "La tienda no está en modo fast food", { field: "tableId" });
      let table: { id: string | null; name: string; zone: string | null; priceList: "general" | "terrace" };
      if (ff) table = { id: null, name: fastFoodTableId(session.station.name), zone: "FASTFOOD", priceList: "general" };
      else {
        const [t] = await tx.select({ t: s.diningTable, a: s.area }).from(s.diningTable).innerJoin(s.area, eq(s.area.id, s.diningTable.areaId))
          .where(and(eq(s.diningTable.id, b.tableId), eq(s.diningTable.storeId, session.storeId))).for("update", { of: s.diningTable });
        if (!t) fail("NOT_FOUND", "La mesa no existe", { tableId: b.tableId });
        table = { id: t!.t.id, name: String(t!.t.number), zone: t!.a.name, priceList: t!.a.priceList === "terrace" ? "terrace" : "general" };
      }
      const busy = await tx.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.storeId, session.storeId), inArray(s.orders.status, ["open", "billing"]),
        table.id ? eq(s.orders.tableId, table.id) : eq(s.orders.tableName, table.name)));
      if (busy.length) {
        if (ff) return this.get(session, busy[0]!.id); // fast food: siempre se vuelve al mismo pedido
        fail("TABLE_BUSY", "La mesa ya está abierta", { orderId: busy[0]!.id });
      }
      const header: OrderHeader = { id: b.id ?? crypto.randomUUID(), storeId: session.storeId, periodId: period!.id, status: "open", version: 1, tableId: table.id, tableName: table.name,
        zone: table.zone, priceList: table.priceList, guests: b.guests, note: null, openedBy: ctx.actor, lastEntry: ctx.actor, presence: { holder: null, chargingUntil: null } };
      await this.repo.insertHeader(tx, header);
      const empty: Order = { id: header.id, tableId: table.id ?? "", guests: b.guests, version: 1, accounts: [] };
      const acc: Account = { id: b.accountId ?? crypto.randomUUID(), name: b.accountName?.trim() || "Cuenta 1", status: "open", lines: [], deletedLines: [], discounts: [], payments: [], customerData: null, invoice: null };
      const next = { ...empty, accounts: [acc] };
      const v = await this.repo.save(tx, session.storeId, empty, next, header, { actor: ctx.actor, events: [this.ev("tableOpened", `Se abre la mesa ${table.name} con ${b.guests} comensales`, ctx)] });
      const l = await this.repo.load(tx, session.storeId, header.id);
      return this.repo.transaction(tx, { ...l.header, version: v }, l.order);
    });
  }

  async patch(session: Session, orderId: string, b: { guests?: number; note?: string | null; version?: number }) {
    if (b.guests != null) await this.auth.require(session, "pedido.comensales");
    if (b.note !== undefined) await this.auth.require(session, "pedido.notaMesa");
    return (await this.command(session, orderId, b.version, (l, ctx) => {
      if (b.note !== undefined) l.header.note = b.note;
      return { next: { ...l.order, guests: b.guests ?? l.order.guests }, events: [this.ev("tableUpdated", `Comensales ${b.guests ?? l.order.guests}${b.note ? ` · nota: ${b.note}` : ""}`, ctx)] };
    })).transaction;
  }

  async addAccount(session: Session, orderId: string, b: { id?: string; name?: string; version?: number }) {
    await this.auth.require(session, "pedido.cuentas");
    return (await this.command(session, orderId, b.version, (l, ctx) => {
      const name = b.name?.trim() || `Cuenta ${l.order.accounts.length + 1}`;
      const acc: Account = { id: b.id ?? ctx.newId(), name, status: "open", lines: [], deletedLines: [], discounts: [], payments: [], customerData: null, invoice: null };
      return { next: { ...l.order, accounts: [...l.order.accounts, acc] }, events: [this.ev("accountOpened", `Se abre la ${name}`, ctx, acc.id)] };
    })).transaction;
  }

  /** Producto + modificadores desde la carta (precio general y terraza, IVA). */
  private async product(tx: Tx, storeId: string, plu: number): Promise<Product> {
    const [p] = await tx.select({ p: s.product, rate: s.tax.rate }).from(s.product).innerJoin(s.tax, eq(s.tax.id, s.product.taxId))
      .where(and(eq(s.product.storeId, storeId), eq(s.product.plu, plu), eq(s.product.active, true)));
    if (!p) fail("NOT_FOUND", "Ese producto no está en la carta", { plu });
    if (p!.p.soldOut) fail("VALIDATION", `${p!.p.name} está agotado`, { plu });
    return { plu, name: p!.p.ticketName || p!.p.name, price: Number(p!.p.price), terracePrice: p!.p.priceTerrace == null ? undefined : Number(p!.p.priceTerrace), taxRate: Number(p!.rate) };
  }
  /** Preguntas activas del producto con sus respuestas (PLU), para comprobar las obligatorias. */
  private async questionRules(tx: Tx, storeId: string, plu: number): Promise<QuestionRule[]> {
    const qs = await tx.select({ q: s.question }).from(s.productQuestion)
      .innerJoin(s.product, eq(s.product.id, s.productQuestion.productId))
      .innerJoin(s.question, eq(s.question.id, s.productQuestion.questionId))
      .where(and(eq(s.productQuestion.storeId, storeId), eq(s.product.plu, plu), eq(s.question.active, true)));
    if (!qs.length) return [];
    const ans = await tx.select({ qid: s.questionAnswer.questionId, plu: s.product.plu }).from(s.questionAnswer)
      .innerJoin(s.product, eq(s.product.id, s.questionAnswer.productId))
      .where(and(eq(s.questionAnswer.storeId, storeId), inArray(s.questionAnswer.questionId, qs.map(x => x.q.id))));
    return qs.map(({ q }) => ({ id: q.id, name: q.name, min: Number(q.minAnswers ?? 0), max: Number(q.maxAnswers ?? 0), course: q.course ?? null, answers: ans.filter(a => a.qid === q.id).map(a => a.plu) }));
  }
  private async modifiers(tx: Tx, storeId: string, mods: { questionId?: string | null; plu: number; quantity?: number }[]): Promise<Modifier[]> {
    const out: Modifier[] = [];
    for (const m of mods) {
      const rows = await tx.select({ a: s.questionAnswer, p: s.product }).from(s.questionAnswer).innerJoin(s.product, eq(s.product.id, s.questionAnswer.productId))
        .where(and(eq(s.questionAnswer.storeId, storeId), eq(s.product.plu, m.plu), ...(m.questionId ? [eq(s.questionAnswer.questionId, m.questionId)] : [])));
      const r = rows[0];
      if (!r) fail("NOT_FOUND", "Esa respuesta no existe para el producto", { plu: m.plu, questionId: m.questionId });
      out.push({ name: r!.a.label || r!.p.ticketName || r!.p.name, unitPrice: Number(r!.a.extraPrice ?? 0), quantity: m.quantity ?? 1 });
    }
    return out;
  }

  async addLine(session: Session, orderId: string, b: { id?: string; accountId?: string | null; plu: number; quantity: number; comment?: string | null; modifiers?: { questionId?: string | null; plu: number; quantity?: number }[]; force?: boolean; version?: number }) {
    if (b.comment) await this.auth.require(session, "pedido.comentarios");
    const store = await this.stores.store();
    return (await this.command(session, orderId, b.version, async (l, ctx, tx) => {
      const product = await this.product(tx, session.storeId, b.plu);
      const rules = await this.questionRules(tx, session.storeId, b.plu);
      checkAnswers(rules, b.modifiers ?? []); // preguntas obligatorias respondidas (los pases de comida pueden quedar por elegir)
      const modifiers = (await this.modifiers(tx, session.storeId, b.modifiers ?? [])).map((m, i) => ({ ...m, plu: b.modifiers![i]!.plu, ...(rules.length ? courseOfAnswer(rules, b.modifiers![i]!) : {}) }))
        .map(m => (m.course == null ? { name: m.name, unitPrice: m.unitPrice, quantity: m.quantity, plu: m.plu } : m));
      const courses = planCourses(rules, b.modifiers ?? []);
      const acc = this.account(l.order, b.accountId);
      const c = b.id ? { ...ctx, newId: () => b.id! } : ctx;
      const next = addProduct(acc, { product, area: { id: "", name: l.header.zone ?? "", priceList: l.header.priceList }, quantity: b.quantity, modifiers, courses, comment: b.comment ?? "", force: b.force, dupWindowMin: store.duplicateMinutes }, c);
      return { next: this.replace(l.order, next), events: [this.ev("lineAdded", `Se añade ${product.name} x${b.quantity}`, ctx, acc.id)] };
    }, { kind: "save" })).transaction;
  }

  async patchLine(session: Session, orderId: string, lineId: string, b: { quantity?: number; comment?: string | null; version?: number }) {
    if (b.comment !== undefined) await this.auth.require(session, "pedido.comentarios");
    return (await this.command(session, orderId, b.version, (l, ctx) => {
      const acc = l.order.accounts.find(a => a.lines.some(x => x.id === lineId)) ?? fail("NOT_FOUND", "La línea no existe", { lineId });
      const line = acc.lines.find(x => x.id === lineId)!;
      let next = acc;
      if (b.quantity != null && b.quantity !== line.quantity) next = changeQuantity(next, lineId, b.quantity - line.quantity);
      if (b.comment !== undefined) {
        if (line.status !== "pendingPrint") fail("VALIDATION", "Solo se comenta lo que aún no se ha enviado", { lineId });
        next = { ...next, lines: next.lines.map(x => (x.id === lineId ? { ...x, comment: b.comment ?? "" } : x)) };
      }
      return { next: this.replace(l.order, next), events: [this.ev("lineUpdated", `${line.name}: cantidad ${b.quantity ?? line.quantity}`, ctx, acc.id)] };
    })).transaction;
  }

  async deleteLine(session: Session, orderId: string, lineId: string, b: { reasonId?: string | null; reason?: string | null; quantity?: number; authorization?: string | null; version?: number }) {
    const profiles = await this.stores.profiles(session.storeId);
    return (await this.command(session, orderId, b.version, async (l, ctx, tx) => {
      const acc = l.order.accounts.find(a => a.lines.some(x => x.id === lineId)) ?? fail("NOT_FOUND", "La línea no existe", { lineId });
      const line = acc.lines.find(x => x.id === lineId)!;
      let reason = b.reason ?? undefined;
      if (b.reasonId) {
        const [r] = await tx.select().from(s.reason).where(and(eq(s.reason.storeId, session.storeId), eq(s.reason.id, b.reasonId)));
        if (!r) fail("VALIDATION", "Ese motivo no existe", { field: "reasonId" });
        reason = r!.name;
      }
      const perm = line.status === "pendingPrint" ? null : line.status === "printed" ? "pedido.elimEnviado" : "pedido.elimPrecuenta";
      const g = perm && reason?.trim() ? await this.auth.require(session, perm, b.authorization, ctx.now) : { authorizer: null, authorizerActor: null };
      const me = { id: session.user.id, profileId: session.user.profileId, overrides: session.user.overrides };
      // si autorizó un encargado, el dominio lo comprueba con su perfil; si no, con el de quien pulsa
      const next = deleteLine(acc, { lineId, reason, quantity: b.quantity, actor: me, authorizer: g.authorizer, authorizerActor: g.authorizerActor, profiles }, ctx);
      return { next: this.replace(l.order, next), events: [this.ev("lineDeleted", `Se elimina ${line.name} x${b.quantity ?? line.quantity}${reason ? ` · ${reason}` : " (sin enviar)"}`, ctx, acc.id)] };
    })).transaction;
  }

  async moveLines(session: Session, orderId: string, b: { lines: { lineId: string; quantity: number }[]; toAccountId?: string | null; newAccountName?: string | null; authorization?: string | null; version?: number }) {
    await this.auth.requireAny(session, ["pedido.pasarCuenta", "pedido.separar"], b.authorization);
    return (await this.command(session, orderId, b.version, (l, ctx) => {
      const from = l.order.accounts.find(a => a.lines.some(x => x.id === b.lines[0]?.lineId)) ?? fail("NOT_FOUND", "La línea no existe");
      if (b.lines.some(x => !from.lines.some(y => y.id === x.lineId))) fail("VALIDATION", "Todas las líneas deben ser de la misma cuenta");
      const pick = Object.fromEntries(b.lines.map(x => [x.lineId, x.quantity]));
      const r = moveUnits(l.order, from.id, b.toAccountId ?? "new", pick, ctx);
      let next = r.order;
      if (!b.toAccountId && b.newAccountName) next = { ...next, accounts: next.accounts.map(a => (a.id === r.destId ? { ...a, name: b.newAccountName! } : a)) };
      const dest = next.accounts.find(a => a.id === r.destId)!;
      return { next, movedReason: `Pasada a ${dest.name}`, events: [this.ev("accountsSplit", `Se pasan ${b.lines.reduce((a, x) => a + x.quantity, 0)} uds de ${from.name} a ${dest.name}`, ctx, from.id)] };
    })).transaction;
  }

  /**
   * Enviar a cocina/barra («Guardar»): agrupa por canal de impresión del producto y la impresora de la estación.
   * Se guarda primero (líneas enviadas + order_line_printer pendiente de imprimir) y se imprime DESPUÉS del COMMIT, sin bloquear la mesa.
   * Lo que no salió por una impresora queda pendiente y el siguiente envío lo imprime solo ahí (lo que ya salió no se repite).
   * Sin nada que enviar ni que reimprimir: no cambia la versión ni va a la cola.
   */
  async send(session: Session, orderId: string, b: { accountId?: string | null; version?: number }) {
    await this.auth.require(session, "pedido.enviar");
    const r = await this.command<{ jobs: KitchenJob[] }>(session, orderId, b.version, async (l, ctx, tx) => {
      let next = l.order; const items: KitchenItem[] = []; let n = 0;
      for (const acc of l.order.accounts.filter(a => a.status === "open" && (!b.accountId || a.id === b.accountId))) {
        const res = sendWithCourses(acc, { now: ctx.now }); next = this.replace(next, res.account);
        items.push(...res.items); n += res.sent.length;
      }
      const retry = await this.pendingKitchenJobs(tx, session, l, ctx);
      if (!n) return { next, events: [], noop: true, extra: { jobs: retry } };
      const plan = await this.planKitchen(tx, session, l, ctx, items);
      return { next, events: [this.ev("linePrinted", `Se envían ${n} líneas`, ctx)], extra: { jobs: [...plan.jobs, ...retry] }, afterSave: plan.record };
    }, { kind: "save" });
    const printed = await this.printKitchen(session, r.extra.jobs);
    return { printed, order: r.transaction };
  }

  /** Comandas por canal: cada pieza sale por las impresoras de su PLU (la bebida del menú a barra, el 1.º a cocina…). Solo decide; no imprime. */
  private async planKitchen(tx: Tx, session: Session, l: Loaded, ctx: Ctx, items: KitchenItem[]) {
    // canales de comanda de cada producto + sus copias (doble zona); impresora = la de esta estación para el canal o la del canal
    const plus = [...new Set(items.map(x => x.plu))], S = session.storeId;
    const routes = (await tx.execute(sql`WITH base AS (
        SELECT p.plu, ch.id ch_id FROM product p JOIN product_channel pc ON pc.product_id = p.id AND pc.store_id = ${S}
          JOIN print_channel ch ON ch.id = pc.channel_id AND ch.active AND ch.store_id = ${S}
        WHERE p.store_id = ${S} AND p.plu = ANY(${"{" + plus.join(",") + "}"}::int[])
      ), todos AS (SELECT plu, ch_id FROM base UNION SELECT b.plu, c.id FROM base b JOIN print_channel c ON c.copy_of_id = b.ch_id AND c.active AND c.store_id = ${S})
      SELECT t.plu, ch.name channel, pr.id::text printer_id, pr.name printer, pr.connection FROM todos t JOIN print_channel ch ON ch.id = t.ch_id AND ch.store_id = ${S}
        LEFT JOIN station_channel_printer scp ON scp.channel_id = ch.id AND scp.station_id = ${session.station.id} AND scp.store_id = ${S}
        LEFT JOIN printer pr ON pr.id = coalesce(scp.printer_id, ch.printer_id) AND pr.store_id = ${S}
      ORDER BY ch.copy_of_id NULLS FIRST, ch.name`)).rows as { plu: number; channel: string; printer_id: string | null; printer: string | null; connection: string | null }[];
    const jobs = new Map<string, KitchenJob>(), rows: { id: string; lineId: string; channel: string; job: KitchenJob }[] = [];
    for (const it of items) for (const rt of routes.filter(x => x.plu === it.plu)) {
      const k = `${rt.channel}|${rt.printer ?? ""}`;
      if (!jobs.has(k)) jobs.set(k, { channel: rt.channel, printer: rt.printer ?? rt.channel, printerId: rt.printer_id, connection: rt.connection ?? "", items: [], rows: [], table: { name: l.header.tableName, area: l.header.zone ?? "" }, guests: l.order.guests, waiter: ctx.actor.user, at: ctx.now });
      const job = jobs.get(k)!;
      job.items.push(it);
      if (it.lineId) { const id = crypto.randomUUID(); job.rows.push(id); rows.push({ id, lineId: it.lineId, channel: it.tag ? `${rt.channel}|${it.tag}` : rt.channel, job }); }
    }
    // a qué impresora va cada línea; printed_at con printed = false = intento en curso (otro envío no lo repite mientras dura)
    const record = async (t: Tx) => {
      for (const r of rows) await t.insert(s.orderLinePrinter).values({ id: r.id, storeId: S, lineId: r.lineId, channelName: r.channel.slice(0, 40), printerId: r.job.printerId,
        printerName: r.job.printer.slice(0, 40), interface: r.job.connection.slice(0, 120) || null, printed: false, printedAt: ctx.now.toISOString() } as any);
    };
    return { jobs: [...jobs.values()], record };
  }

  /**
   * Comandas que no salieron (impresora apagada) y que nadie está imprimiendo ahora: se reservan y se rehacen desde la línea.
   * Va dentro de command(), con la orden bloqueada (FOR UPDATE): dos reintentos a la vez se ponen en fila y el segundo ya ve
   * las filas reservadas (printed_at reciente) por el primero, así que no imprime dos veces.
   */
  private async pendingKitchenJobs(tx: Tx, session: Session, l: Loaded, ctx: Ctx): Promise<KitchenJob[]> {
    const S = session.storeId;
    const rows = (await tx.execute(sql`SELECT olp.id::text id, olp.line_id::text line_id, olp.channel_name, olp.printer_id::text printer_id, olp.printer_name, olp.interface
      FROM order_line_printer olp JOIN order_line ol ON ol.id = olp.line_id AND ol.store_id = ${S}
      WHERE olp.store_id = ${S} AND ol.order_id = ${l.order.id} AND NOT olp.printed AND NOT ol.deleted
        AND (olp.printed_at IS NULL OR olp.printed_at < ${new Date(ctx.now.getTime() - PRINT_CLAIM_SECONDS * 1000).toISOString()}::timestamptz)
      ORDER BY olp.channel_name, olp.printer_name`)).rows as { id: string; line_id: string; channel_name: string; printer_id: string | null; printer_name: string | null; interface: string | null }[];
    if (!rows.length) return [];
    const lines = new Map(l.order.accounts.flatMap(a => a.lines.map(x => [x.id, x] as const)));
    const jobs = new Map<string, KitchenJob>(), claimed: string[] = [];
    for (const r of rows) {
      const line = lines.get(r.line_id);
      if (!line) continue;
      const [channel, tag] = r.channel_name.split("|") as [string, string | undefined];
      const k = `${channel}|${r.printer_name ?? ""}`;
      if (!jobs.has(k)) jobs.set(k, { channel, printer: r.printer_name ?? channel, printerId: r.printer_id, connection: r.interface ?? "", items: [], rows: [], table: { name: l.header.tableName, area: l.header.zone ?? "" }, guests: l.order.guests, waiter: line.createdBy.user, at: ctx.now });
      jobs.get(k)!.items.push(kitchenItemOf(line, tag)); jobs.get(k)!.rows.push(r.id); claimed.push(r.id);
    }
    if (claimed.length) await tx.execute(sql`UPDATE order_line_printer SET printed_at = ${ctx.now.toISOString()}::timestamptz WHERE store_id = ${S} AND id = ANY(${"{" + claimed.join(",") + "}"}::uuid[])`);
    return [...jobs.values()];
  }

  /** Imprime después del COMMIT y apunta qué salió. Si una impresora falla → 503 PRINTER_OFFLINE (lo que falló queda para el siguiente envío). */
  private async printKitchen(session: Session, jobs: KitchenJob[]): Promise<Printed[]> {
    const printed: Printed[] = [];
    for (const j of jobs) {
      const ticket = kitchenTicket(j.items, { channel: j.channel, waiter: j.waiter, guests: j.guests, table: j.table, at: j.at });
      const res = await this.printer.print({ kind: "kitchen", channel: j.channel, printer: j.printer, connection: j.connection, title: `Mesa ${j.table.name}`, ticket }).catch(e => ({ ok: false, error: String(e?.message ?? e) }));
      printed.push({ channel: j.channel, printer: j.printer, lines: j.items.length, ok: res.ok });
      if (j.rows.length) await this.database.db.execute(sql`UPDATE order_line_printer SET printed = ${res.ok}, printed_at = ${res.ok ? this.clock().toISOString() : null}::timestamptz
        WHERE store_id = ${session.storeId} AND id = ANY(${"{" + j.rows.join(",") + "}"}::uuid[])`);
    }
    if (printed.some(p => !p.ok)) fail("PRINTER_OFFLINE", "Una impresora no responde: lo que no salió se imprimirá al volver a enviar", { printed });
    return printed;
  }

  /** Menú por pases: elegir (o cambiar) un pase que aún no ha salido. Sale al guardar (send) si toca. */
  async chooseAnswers(session: Session, orderId: string, lineId: string, b: { course: number; modifiers: { plu: number; quantity?: number }[]; version?: number | null }) {
    return (await this.command(session, orderId, b.version, async (l, ctx, tx) => {
      const acc = l.order.accounts.find(a => a.lines.some(x => x.id === lineId)) ?? fail("NOT_FOUND", "La línea no existe", { lineId });
      const line = acc!.lines.find(x => x.id === lineId)!;
      const rules = await this.questionRules(tx, session.storeId, line.productId);
      const rule = rules.find(q => q.course === b.course) ?? fail("VALIDATION", "Ese producto no tiene ese pase", { field: "course" });
      const bad = b.modifiers.find(m => !rule!.answers.includes(m.plu));
      if (bad) fail("VALIDATION", `Esa respuesta no es de «${rule!.name}»`, { field: "modifiers", plu: bad.plu, questionId: rule!.id });
      const input = b.modifiers.map(m => ({ ...m, questionId: rule!.id }));
      checkAnswers([rule!], input, { only: rule!.id });
      const mods = (await this.modifiers(tx, session.storeId, input)).map((m, i) => ({ ...m, plu: input[i]!.plu, course: b.course, questionId: rule!.id }));
      const next = chooseCourse(acc!, lineId, b.course, mods);
      return { next: this.replace(l.order, next), events: [this.ev("courseChosen", `${line.name}: ${courseLabel(b.course)} ${mods.map(m => m.name).join(", ")}`, ctx, acc!.id)] };
    })).transaction;
  }

  /** Menú por pases: «Marchar» un pase en espera (o elegido) ahora mismo. */
  async fireCourse(session: Session, orderId: string, lineId: string, b: { course: number; version?: number | null }) {
    await this.auth.require(session, "pedido.enviar");
    const r = await this.command<{ jobs: KitchenJob[] }>(session, orderId, b.version, async (l, ctx, tx) => {
      const acc = l.order.accounts.find(a => a.lines.some(x => x.id === lineId)) ?? fail("NOT_FOUND", "La línea no existe", { lineId });
      const res = sendWithCourses(acc!, { now: ctx.now, force: { lineId, course: b.course } });
      const plan = res.items.length ? await this.planKitchen(tx, session, l, ctx, res.items) : { jobs: [], record: undefined };
      const name = acc!.lines.find(x => x.id === lineId)!.name;
      return { next: this.replace(l.order, res.account), events: [this.ev("courseFired", `Marcha ${courseLabel(b.course)} de ${name}`, ctx, acc!.id)], extra: { jobs: plan.jobs }, afterSave: plan.record };
    });
    const printed = await this.printKitchen(session, r.extra.jobs);
    return { printed, order: r.transaction };
  }

  /** «Inclúyeme la bebida en el menú»: una bebida ya pedida pasa a ser la del pase (sin encargado; queda con motivo). */
  async absorb(session: Session, orderId: string, lineId: string, b: { course: number; sourceLineId: string; version?: number | null }) {
    return (await this.command(session, orderId, b.version, async (l, ctx, tx) => {
      const acc = l.order.accounts.find(a => a.lines.some(x => x.id === lineId)) ?? fail("NOT_FOUND", "La línea no existe", { lineId });
      const menu = acc!.lines.find(x => x.id === lineId)!, src = acc!.lines.find(x => x.id === b.sourceLineId) ?? fail("NOT_FOUND", "La bebida no está en esta cuenta", { lineId: b.sourceLineId });
      const rule = (await this.questionRules(tx, session.storeId, menu.productId)).find(q => q.course === b.course) ?? fail("VALIDATION", "Ese menú no tiene ese pase", { field: "course" });
      if (!rule!.answers.includes(src!.productId)) fail("VALIDATION", `${src!.name} no es una respuesta de «${rule!.name}»`, { field: "sourceLineId" });
      const [ans] = await this.modifiers(tx, session.storeId, [{ plu: src!.productId, questionId: rule!.id }]);
      const next = absorbIntoMenu(acc!, { menuLineId: lineId, course: b.course, sourceLineId: src!.id, answer: { ...ans!, plu: src!.productId } }, ctx);
      return { next: this.replace(l.order, next), events: [this.ev("menuAbsorb", `${src!.name} pasa a ${menu.name} (${MENU_ABSORB_REASON})`, ctx, acc!.id)] };
    })).transaction;
  }

  async prebill(session: Session, orderId: string, accountId: string) {
    await this.auth.require(session, "pedido.precuenta");
    // se guarda y se imprime después del COMMIT (sin bloquear la mesa durante la conexión con la impresora)
    const r = await this.command<{ job: { p: { name: string; connection: string; channel: string }; title: string; ticket: ReturnType<typeof preBillTicket> } }>(session, orderId, null, async (l, ctx, tx) => {
      const acc = this.account(l.order, accountId);
      const next = preBill(acc);
      const p = await this.ticketPrinter(tx, session, orderId);
      const ticket = preBillTicket(next, await this.ticketCtx(tx, session, l, ctx.now));
      return { next: this.replace(l.order, next), events: [this.ev("preBill", `Precuenta de la ${acc.name}: ${accountTotals(acc).total.toFixed(2)} €`, ctx, acc.id)], extra: { job: { p, title: `Precuenta mesa ${l.header.tableName}`, ticket } } };
    });
    const { p, title, ticket } = r.extra.job;
    const res = await this.printer.print({ kind: "prebill", channel: p.channel, printer: p.name, connection: p.connection, title, ticket }).catch(e => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res.ok) fail("PRINTER_OFFLINE", "La impresora de tickets no responde; la precuenta no se ha impreso (vuelve a pedirla)", { printer: p.name, error: res.error, printed: [{ channel: p.channel, printer: p.name, lines: 0, ok: false }] });
    return r.transaction;
  }

  async pay(session: Session, orderId: string, accountId: string, b: { id?: string; method: string; amount?: number | null; tip?: number; cashGiven?: number | null; authorization?: string | null }) {
    await this.auth.require(session, "cobro.cobrar", b.authorization);
    const r = await this.command<{ payment: { id: string; status: string; change: number | null } }>(session, orderId, null, async (l, ctx, tx) => {
      // forma de pago de Ajustes (cualquier código: glovo, efectivo2…), permitida en esta estación (regla en @japp/domain)
      const [row] = await tx.select().from(s.paymentMethod).where(and(eq(s.paymentMethod.storeId, session.storeId), eq(s.paymentMethod.code, b.method)));
      const allowed = (await tx.select({ id: s.stationPaymentMethod.paymentMethodId }).from(s.stationPaymentMethod)
        .where(and(eq(s.stationPaymentMethod.storeId, session.storeId), eq(s.stationPaymentMethod.stationId, session.station.id)))).map(x => x.id);
      const m = assertMethodAllowed(row ? { id: row.id, code: row.code, kind: row.kind, active: row.active } : null, { name: session.station.name, kind: session.station.kind, methodIds: allowed }, b.method);
      const kind = paymentKind(m.kind, m.code);
      if ((b.tip ?? 0) > 0 && !row!.allowsTip) fail("VALIDATION", "Esta forma de pago no admite propina", { field: "tip" });
      const acc = this.account(l.order, accountId);
      const c = b.id ? { ...ctx, newId: () => b.id! } : ctx;
      const res = registerPayment(acc, { method: m.code, methodId: m.id, kind, amount: b.amount ?? null, tip: b.tip, cashGiven: b.cashGiven }, c);
      return { next: this.replace(l.order, res.account), events: [this.ev("paymentAdded", `Cobro ${row!.name} ${res.payment.amount.toFixed(2)} €`, ctx, acc.id)], extra: { payment: { id: res.payment.id, status: res.payment.status, change: res.payment.change } }, clearCharging: res.settled };
    });
    const acc = r.order.accounts.find(a => a.id === accountId)!;
    const T = accountTotals(acc);
    return { payment: r.extra.payment, totals: { total: T.total, paid: T.paid, pending: T.pending } };
  }

  /**
   * Factura: número reservado con SELECT … FOR UPDATE en invoice_series dentro de la misma transacción,
   * factura + desglose de IVA + registro VeriFactu encadenado al anterior de la tienda.
   */
  async invoice(session: Session, orderId: string, accountId: string, b: { authorization?: string | null } = {}) {
    await this.auth.require(session, "cobro.cobrar", b.authorization);
    const store = await this.stores.store();
    const r = await this.command<{ invoice: NonNullable<Account["invoice"]> }>(session, orderId, null, async (l, ctx0, tx) => {
      const acc = this.account(l.order, accountId);
      if (acc.status !== "open") fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId });
      // cadena VeriFactu: una factura de la tienda cada vez (las series F y T comparten cadena).
      // La hora se toma DESPUÉS de tener el bloqueo: así la cadena va en orden de tiempo.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.storeId}))`);
      const now = this.clock(), ctx: Ctx = { ...ctx0, now, actor: session.actor(now) };
      const series = acc.customerData ? store.serieF : store.serieT;
      const [row] = await tx.select().from(s.invoiceSeries).where(and(eq(s.invoiceSeries.storeId, session.storeId), eq(s.invoiceSeries.series, series))).for("update");
      if (!row) fail("NOT_FOUND", `No existe la serie ${series}`, { series });
      const next = issueInvoice(acc, row!.lastSequence + 1, { serieF: store.serieF, serieT: store.serieT, nif: store.nif }, ctx);
      const inv = next.invoice!;
      await tx.update(s.invoiceSeries).set({ lastSequence: inv.sequence } as any).where(and(eq(s.invoiceSeries.storeId, session.storeId), eq(s.invoiceSeries.series, series)));
      const id = crypto.randomUUID();
      const base = r2(sum(inv.taxes.map(t => t.base))), tax = r2(sum(inv.taxes.map(t => t.tax)));
      await tx.insert(s.invoice).values({
        id, storeId: session.storeId, accountId: acc.id, orderId: l.order.id, type: inv.type, series: inv.series, sequence: inv.sequence, invoiceNumber: inv.invoiceNumber, issuedAt: inv.issuedAt,
        issuerTaxId: store.nif, issuerName: store.issuerName, customerId: inv.customer?.id ?? null, customerType: inv.customer?.type ?? null, customerTaxId: inv.customer?.taxId ?? null,
        customerName: inv.customer?.name ?? null, customerEmail: inv.customer?.email ?? null, customerStreet: inv.customer?.street ?? null, customerPostalCode: inv.customer?.postalCode ?? null,
        customerCity: inv.customer?.city ?? null, customerProvince: inv.customer?.province ?? null, customerCountry: inv.customer?.country ?? null,
        taxBase: base.toFixed(2), taxTotal: tax.toFixed(2), total: inv.total.toFixed(2), verifactuQr: inv.verifactuQr,
        issuedByUserId: ctx.actor.userId, issuedByUserName: ctx.actor.user, issuedByRole: ctx.actor.role, issuedByDevice: ctx.actor.device, issuedByAt: ctx.actor.at,
      } as any);
      for (const t of inv.taxes) await tx.insert(s.invoiceTax).values({ invoiceId: id, storeId: session.storeId, rate: t.rate.toFixed(2), base: t.base.toFixed(2), tax: t.tax.toFixed(2) } as any);
      // registro anterior = el último de la cadena (el que aún no tiene sucesor); la base garantiza uno solo (uq_verifactu_previous / uq_verifactu_genesis)
      const [prev] = (await tx.execute(sql`SELECT v.id::text id, v.hash FROM verifactu_record v WHERE v.store_id = ${session.storeId}
        AND NOT EXISTS (SELECT 1 FROM verifactu_record n WHERE n.store_id = v.store_id AND n.previous_record_id = v.id)
        ORDER BY v.generated_at DESC, v.id DESC LIMIT 1`)).rows as { id: string; hash: string }[];
      const hash = createHash("sha256").update([store.nif, inv.invoiceNumber, inv.issuedAt.slice(0, 10), inv.type, tax.toFixed(2), inv.total.toFixed(2), prev?.hash ?? "", ctx.actor.at].join("&")).digest("hex").toUpperCase();
      await tx.insert(s.verifactuRecord).values({
        id: crypto.randomUUID(), storeId: session.storeId, invoiceId: id, issuerTaxId: store.nif, invoiceNumber: inv.invoiceNumber, issuedOn: inv.issuedAt.slice(0, 10), invoiceType: inv.type,
        taxTotal: tax.toFixed(2), total: inv.total.toFixed(2), previousRecordId: prev?.id ?? null, previousHash: prev?.hash ?? null, hash, generatedAt: ctx.actor.at,
      } as any);
      return { next: this.replace(l.order, next), events: [this.ev("invoiceIssued", `Factura ${inv.type} ${inv.invoiceNumber} · ${inv.total.toFixed(2)} €`, ctx, acc.id)], extra: { invoice: inv }, clearCharging: true };
    });
    const tableClosed = r.order.accounts.every(a => a.status === "invoiced");
    const printed = await this.printInvoice(session, orderId, accountId).catch(() => false);
    const { taxes: _t, customer: _c, ...invoice } = r.extra.invoice;
    return { invoice, tableClosed, printed };
  }

  /**
   * Impresora de tickets (precuenta y factura): la del canal de tickets del ÁREA de la mesa, sea cual sea el equipo
   * (terraza → impresora de terraza). Si el área no tiene canal: impresora de tipo «ticket» y, si no, la primera de la estación.
   */
  private async ticketPrinter(tx: Tx, session: Session, orderId?: string): Promise<{ name: string; connection: string; channel: string }> {
    if (orderId) {
      const r = (await tx.execute(sql`SELECT ch.name channel, pr.name, pr.connection FROM orders o JOIN dining_table dt ON dt.id = o.table_id AND dt.store_id = o.store_id JOIN area a ON a.id = dt.area_id AND a.store_id = o.store_id
        JOIN print_channel ch ON ch.id = a.ticket_channel_id AND ch.active AND ch.store_id = o.store_id JOIN printer pr ON pr.id = ch.printer_id AND pr.active AND pr.store_id = o.store_id
        WHERE o.id = ${orderId} AND o.store_id = ${session.storeId}`)).rows[0] as any;
      if (r) return { name: r.name, connection: r.connection, channel: r.channel };
    }
    const [t] = await tx.select({ name: s.printer.name, connection: s.printer.connection }).from(s.printer)
      .where(and(eq(s.printer.storeId, session.storeId), eq(s.printer.kind, "ticket"), eq(s.printer.active, true))).limit(1);
    if (t) return { ...t, channel: "TICKET" };
    const [f] = await tx.select({ name: s.printer.name, connection: s.printer.connection }).from(s.stationChannelPrinter)
      .innerJoin(s.printer, and(eq(s.printer.id, s.stationChannelPrinter.printerId), eq(s.printer.storeId, session.storeId)))
      .where(and(eq(s.stationChannelPrinter.storeId, session.storeId), eq(s.stationChannelPrinter.stationId, session.station.id))).limit(1);
    return { ...(f ?? { name: "TICKET", connection: "" }), channel: "TICKET" };
  }

  private async ticketCtx(tx: Tx, session: Session, l: Loaded, at: Date): Promise<TicketContext> {
    const st = await this.stores.store();
    const methods = await tx.select({ code: s.paymentMethod.code, name: s.paymentMethod.name }).from(s.paymentMethod).where(eq(s.paymentMethod.storeId, session.storeId));
    return {
      store: { legalName: st.issuerName, tradeName: st.name, taxId: st.nif, address: st.address ?? undefined, city: st.city ?? undefined, phone: st.phone ?? undefined, header: st.ticketHeader ?? undefined, footer: st.ticketFooter ?? undefined },
      table: { name: l.header.tableName, area: l.header.zone ?? "" }, waiter: l.header.openedBy.user, guests: l.order.guests, at,
      paymentNames: Object.fromEntries(methods.map(m => [m.code, m.name])),
    };
  }

  /** Imprime (o reimprime) la factura de una cuenta en la impresora de tickets; abre el cajón si hubo efectivo. */
  async printInvoice(session: Session, orderId: string, accountId: string): Promise<boolean> {
    return this.database.withTx(async tx => {
      const l = await this.repo.load(tx, session.storeId, orderId);
      const acc = l.order.accounts.find(a => a.id === accountId);
      if (!acc?.invoice) return false;
      const p = await this.ticketPrinter(tx, session, orderId);
      const cash = acc.payments.some(x => x.status === "confirmed" && x.kind === "cash");
      const [stn] = await tx.select({ opens: s.station.opensDrawer }).from(s.station).where(and(eq(s.station.storeId, session.storeId), eq(s.station.id, session.station.id)));
      const res = await this.printer.print({ kind: "invoice", channel: p.channel, printer: p.name, connection: p.connection, title: acc.invoice.invoiceNumber,
        ticket: invoiceTicket(acc, await this.ticketCtx(tx, session, l, new Date(acc.invoice.issuedAt))), openDrawer: cash && !!stn?.opens });
      return res.ok;
    });
  }

  /** Descuento configurado (Ajustes › Descuentos, por id) o manual (tipo, valor y motivo). */
  async addDiscount(session: Session, orderId: string, accountId: string, b: { discountId?: string | null; type?: "percentage" | "fixed"; value?: number; reason?: string | null; authorization?: string | null }) {
    if (session.origin === "pda") fail("NOT_ALLOWED", "La PDA no aplica descuentos", { permission: "cobro.descuentos" });
    let needsAuth = false;
    return (await this.command(session, orderId, null, async (l, ctx, tx) => {
      let d: { type: "percentage" | "fixed"; value: number; reason: string };
      if (b.discountId) {
        const [row] = await tx.select().from(s.discount).where(and(eq(s.discount.storeId, session.storeId), eq(s.discount.id, b.discountId), eq(s.discount.active, true)));
        if (!row) fail("NOT_FOUND", "Ese descuento no existe", { discountId: b.discountId });
        d = { type: "percentage", value: Number(row!.percent), reason: row!.name }; needsAuth = row!.needsAuthorization;
      } else {
        if (!b.type || b.value == null) fail("VALIDATION", "Indica discountId, o tipo y valor", { field: "discountId" });
        d = { type: b.type!, value: b.value!, reason: b.reason ?? "" }; needsAuth = true;
      }
      if (needsAuth || !session.can("cobro.descuentos")) await this.auth.require(session, "cobro.descuentos", b.authorization, ctx.now);
      const acc = this.account(l.order, accountId);
      const next = applyDiscount(acc, d!, ctx);
      return { next: this.replace(l.order, next), events: [this.ev("discountApplied", `Descuento ${d!.type === "percentage" ? d!.value + " %" : d!.value.toFixed(2) + " €"} · ${d!.reason}`, ctx, acc.id)] };
    })).transaction;
  }

  async removeDiscount(session: Session, orderId: string, accountId: string, discountId: string, b: { authorization?: string | null } = {}) {
    await this.auth.require(session, "cobro.descuentos", b.authorization);
    return (await this.command(session, orderId, null, (l, ctx) => {
      const acc = this.account(l.order, accountId);
      const next = removeDiscount(acc, discountId);
      return { next: this.replace(l.order, next), events: [this.ev("discountRemoved", "Se quita el descuento", ctx, acc.id)] };
    })).transaction;
  }

  /** Datos fiscales del cliente (factura F1). Con saveToFile se guardan en el fichero de clientes. */
  async setCustomer(session: Session, orderId: string, accountId: string, b: { type: "person" | "company"; taxId: string; name: string; email?: string | null; address?: { street?: string; postalCode?: string; city?: string; province?: string; country?: string } | null; saveToFile?: boolean }) {
    await this.auth.require(session, "cobro.clientes");
    return (await this.command(session, orderId, null, async (l, ctx, tx) => {
      const acc = this.account(l.order, accountId);
      let next = setCustomer(acc, { type: b.type, taxId: b.taxId, name: b.name, email: b.email ?? undefined, ...(b.address ?? {}) });
      const c = next.customerData!;
      const row = { storeId: session.storeId, type: b.type, taxId: c.taxId, name: c.name, email: c.email ?? null, street: c.street ?? null, postalCode: c.postalCode ?? null, city: c.city ?? null, province: c.province ?? null, country: c.country ?? "ES" };
      const [saved] = await tx.insert(s.customerRef).values({ id: crypto.randomUUID(), ...row, active: b.saveToFile !== false } as any)
        .onConflictDoUpdate({ target: [s.customerRef.storeId, s.customerRef.taxId], set: { ...row, updatedAt: sql`now()` } as any }).returning({ id: s.customerRef.id });
      next = { ...next, customerData: { ...c, id: saved!.id } };
      return { next: this.replace(l.order, next), events: [this.ev("customerSet", `Factura a nombre de ${c.name} (${c.taxId})`, ctx, acc.id)] };
    })).transaction;
  }

  async removeAccount(session: Session, orderId: string, accountId: string) {
    await this.auth.require(session, "pedido.cuentas");
    return (await this.command(session, orderId, null, (l, ctx) => {
      const name = l.order.accounts.find(a => a.id === accountId)?.name ?? "";
      return { next: removeEmptyAccount(l.order, accountId), events: [this.ev("accountRemoved", `Se quita la ${name}`, ctx)] };
    })).transaction;
  }

  /**
   * Cerrar la mesa sin venta: solo si no le queda nada vivo (sin productos ni cobros en las cuentas sin facturar).
   * Es la salida de una cuenta a 0,00 €: se eliminan sus líneas con motivo (p. ej. Invitación) y se cierra aquí.
   * Las cuentas sin facturar se anulan (nunca se borran); la mesa queda libre.
   */
  async close(session: Session, orderId: string, b: { version?: number | null }) {
    await this.auth.require(session, "mesas.abrirMesa");
    return (await this.command(session, orderId, b.version, (l, ctx) => {
      for (const a of l.order.accounts) {
        if (a.status === "invoiced") continue;
        if (a.lines.length) fail("ORDER_NOT_EMPTY", "La mesa tiene productos: elimínalos con motivo o cóbralos antes de cerrarla", { accountId: a.id, lines: a.lines.length });
        if (a.payments.some(p => p.status === "confirmed")) fail("ORDER_NOT_EMPTY", "La mesa tiene cobros registrados", { accountId: a.id });
      }
      const invoiced = l.order.accounts.filter(a => a.status === "invoiced");
      if (!invoiced.length) (l.header as any).status = "cancelled";
      return { next: { ...l.order, accounts: invoiced }, events: [this.ev("tableClosed", "Se cierra la mesa sin venta", ctx)] };
    })).transaction;
  }

  /** Ordenar lo «Por enviar» de una cuenta: lo que sale primero en la comanda. */
  async reorderLines(session: Session, orderId: string, b: { accountId?: string | null; lineIds: string[]; version?: number | null }) {
    return (await this.command(session, orderId, b.version, (l, ctx) => {
      const acc = this.account(l.order, b.accountId);
      const next = reorderPending(acc, b.lineIds);
      const names = next.lines.filter(x => x.status === "pendingPrint").map(x => x.name).join(", ");
      return { next: this.replace(l.order, next), events: [this.ev("linesReordered", `Nuevo orden de lo por enviar: ${names}`, ctx, acc.id)] };
    })).transaction;
  }

  /** Transferir la mesa entera a otra libre (la cuenta suelta se pasa con «Separar cuenta»). Los precios ya marcados se mantienen. */
  async transfer(session: Session, orderId: string, b: { toTableId: string; accountId?: string | null; version?: number }) {
    await this.auth.require(session, "mesas.transferir");
    if (b.accountId) fail("VALIDATION", "Para pasar una sola cuenta usa «Separar cuenta»; aquí se transfiere la mesa entera", { field: "accountId" });
    return (await this.command(session, orderId, b.version, async (l, ctx, tx) => {
      if (!l.order.accounts.some(a => a.status !== "invoiced" && a.lines.length)) fail("VALIDATION", "La mesa no tiene productos: no hay nada que transferir", { field: "orderId" });
      const [t] = await tx.select({ t: s.diningTable, a: s.area }).from(s.diningTable).innerJoin(s.area, eq(s.area.id, s.diningTable.areaId))
        .where(and(eq(s.diningTable.id, b.toTableId), eq(s.diningTable.storeId, session.storeId))).for("update", { of: s.diningTable });
      if (!t) fail("NOT_FOUND", "La mesa de destino no existe", { tableId: b.toTableId });
      const busy = await tx.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.storeId, session.storeId), eq(s.orders.tableId, b.toTableId), inArray(s.orders.status, ["open", "billing"])));
      if (busy.length) fail("TABLE_BUSY", "La mesa de destino está ocupada", { orderId: busy[0]!.id });
      const from = l.header.tableName;
      await tx.update(s.orders).set({ tableId: t!.t.id, tableName: String(t!.t.number), zone: t!.a.name, priceList: t!.a.priceList } as any).where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, session.storeId)));
      Object.assign(l.header, { tableId: t!.t.id, tableName: String(t!.t.number), zone: t!.a.name, priceList: t!.a.priceList });
      return { next: { ...l.order, tableId: t!.t.id }, events: [this.ev("tableTransferred", `Mesa ${from} → ${t!.t.number}`, ctx)] };
    })).transaction;
  }

  /**
   * Pasar UNA cuenta a otra mesa (regla en @japp/domain → transferAccount). Va entera (líneas con su historia, descuentos,
   * cobros parciales, cliente y pases) y con sus precios. Mesa libre → se abre con la cuenta; ocupada → una cuenta más.
   * Bloqueos en orden fijo: la mesa de destino y luego las dos órdenes por id (sin interbloqueos con otros comandos).
   */
  async transferAccount(session: Session, orderId: string, accountId: string, b: { toTableId: string; version: number; authorization?: string | null }) {
    await this.auth.require(session, "mesas.transferir", b.authorization);
    const ctx = this.ctx(session), S = session.storeId;
    const me = { userId: session.user.id, userName: session.user.name, stationId: session.station.id, stationName: session.station.name, canTakeOver: session.can("mesas.entrarOcupada") };
    return this.database.withTx(async tx => {
      const period = await PeriodsController.current(tx, S);
      if (!period) fail("PERIOD_CLOSED", "No hay periodo abierto");
      const [t] = await tx.select({ t: s.diningTable, a: s.area }).from(s.diningTable).innerJoin(s.area, eq(s.area.id, s.diningTable.areaId))
        .where(and(eq(s.diningTable.id, b.toTableId), eq(s.diningTable.storeId, S))).for("update", { of: s.diningTable });
      if (!t) fail("NOT_FOUND", "La mesa de destino no existe", { tableId: b.toTableId });
      const [busy] = await tx.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.storeId, S), eq(s.orders.tableId, b.toTableId), inArray(s.orders.status, ["open", "billing"])));
      // las dos órdenes, bloqueadas siempre en el mismo orden (por id)
      await tx.execute(sql`SELECT id FROM orders WHERE store_id = ${S} AND id = ANY(${"{" + [orderId, ...(busy ? [busy.id] : [])].join(",") + "}"}::uuid[]) ORDER BY id FOR UPDATE`);
      const src = await this.repo.load(tx, S, orderId, { lock: true });
      if (src.header.status === "closed" || src.header.status === "cancelled") fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
      assertVersion(src.header.version, b.version);
      assertCanCommand(src.header.presence, me, "other", ctx.now);
      if (busy?.id === orderId || src.header.tableId === b.toTableId) fail("VALIDATION", "La cuenta ya está en esa mesa", { field: "toTableId" });
      const toName = String(t!.t.number);
      let dst: Loaded;
      if (busy) {
        dst = await this.repo.load(tx, S, busy.id, { lock: true });
        canEnterTable(dst.header.presence, me, ctx.now); // cobro abierto → TABLE_CHARGING; otra persona dentro → TABLE_TAKEN (salvo mesas.entrarOcupada)
      } else {
        const header: OrderHeader = { id: crypto.randomUUID(), storeId: S, periodId: period!.id, status: "open", version: 1, tableId: t!.t.id, tableName: toName, zone: t!.a.name,
          priceList: t!.a.priceList === "terrace" ? "terrace" : "general", guests: 1, note: null, openedBy: ctx.actor, lastEntry: ctx.actor, presence: { holder: null, chargingUntil: null } };
        await this.repo.insertHeader(tx, header);
        dst = { header, order: { id: header.id, tableId: header.tableId!, guests: 1, version: 1, accounts: [] }, meta: new Map() };
      }
      const r = transferAccount(src.order, accountId, dst.order);
      const name = r.account.name, oldName = r.renamedFrom ?? name;
      // la cuenta y TODAS sus líneas (también las eliminadas) cambian de orden; cobros, descuentos y respuestas cuelgan de ellas
      await tx.execute(sql`UPDATE account SET order_id = ${dst.header.id}, name = ${name}, updated_at = now() WHERE store_id = ${S} AND id = ${accountId} AND order_id = ${orderId}`);
      await tx.execute(sql`UPDATE order_line SET order_id = ${dst.header.id}, updated_at = now() WHERE store_id = ${S} AND account_id = ${accountId} AND order_id = ${orderId}`);
      // origen: sin la cuenta (ya no es suya); si no le queda ninguna viva se cierra como «cerrar mesa sin venta»
      if (!r.sourceLive && !r.from.accounts.some(a => a.status === "invoiced")) src.header.status = "cancelled";
      const vFrom = await this.repo.save(tx, S, r.from, r.from, src.header, { actor: ctx.actor, events: [this.ev("accountTransferred", `${oldName} pasa a la mesa ${toName}`, ctx)] });
      if (!r.sourceLive) await this.repo.savePresence(tx, S, orderId, { holder: null, chargingUntil: null });
      const vTo = await this.repo.save(tx, S, r.to, r.to, dst.header, { actor: ctx.actor, events: [this.ev("accountArrived", `Llega ${oldName} desde la mesa ${src.header.tableName}${r.renamedFrom ? ` (ahora ${name})` : ""}`, ctx, accountId)] });
      const a = await this.repo.load(tx, S, orderId), d = await this.repo.load(tx, S, dst.header.id);
      return { from: await this.repo.transaction(tx, { ...a.header, version: vFrom }, a.order), to: await this.repo.transaction(tx, { ...d.header, version: vTo }, d.order) };
    });
  }

  async events(session: Session, orderId: string) {
    await this.auth.require(session, "pedido.historial");
    const rows = await this.database.db.select().from(s.orderEvent).where(and(eq(s.orderEvent.orderId, orderId), eq(s.orderEvent.storeId, session.storeId))).orderBy(s.orderEvent.at);
    return { items: rows.map(e => ({ type: e.type, at: new Date(e.at).toISOString(), description: e.description, user: e.userName ?? "", device: e.device ?? "", role: e.role ?? "" })) };
  }
}
