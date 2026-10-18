import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { schema as s, type Database, type Tx } from "@japp/db";
import {
  addProduct, applyDiscount, removeDiscount, setCustomer, removeEmptyAccount, assertVersion, changeQuantity, deleteLine, fail, fastFoodTableId, issueInvoice, moveUnits, preBill, registerPayment, sendOrder,
  accountTotals, kitchenTicket, preBillTicket, invoiceTicket, type TicketContext, type Account, type Ctx, type Modifier, type Order, type Product,
  checkAnswers, reorderPending, planCourses, courseOfAnswer, chooseCourse, absorbIntoMenu, sendWithCourses, courseLabel, MENU_ABSORB_REASON, type QuestionRule, type KitchenItem,
} from "@japp/domain";
import { CLOCK, DATABASE, PRINTER, type Clock } from "../common/tokens-di.js";
import type { Session } from "../common/auth.js";
import { Authorization } from "../common/authorization.js";
import { OrderRepo, type Loaded, type OrderEvent, type OrderHeader } from "../repos/order.repo.js";
import { StoreRepo } from "../repos/store.repo.js";
import { PeriodsController } from "./periods.controller.js";
import type { PrinterPort } from "../ports/printer.js";

type Result<T> = { loaded: Loaded; next: Order; events: OrderEvent[]; extra?: T; movedReason?: string };

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

  /** Esqueleto común de los comandos sobre una orden. */
  private async command<T = undefined>(session: Session, orderId: string, version: number | null | undefined,
    fn: (l: Loaded, ctx: Ctx, tx: Tx) => Promise<Omit<Result<T>, "loaded">> | Omit<Result<T>, "loaded">) {
    const ctx = this.ctx(session);
    return this.database.withTx(async tx => {
      const loaded = await this.repo.load(tx, session.storeId, orderId, { lock: true });
      if (loaded.header.status === "closed" || loaded.header.status === "cancelled") fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
      if (version != null) assertVersion(loaded.header.version, version);
      const r = await fn(loaded, ctx, tx);
      const v = await this.repo.save(tx, session.storeId, loaded.order, r.next, loaded.header, { actor: ctx.actor, events: r.events, movedReason: r.movedReason });
      const after = await this.repo.load(tx, session.storeId, orderId);
      return { transaction: await this.repo.transaction(tx, { ...after.header, version: v }, after.order), extra: r.extra as T, order: after.order };
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
        zone: table.zone, priceList: table.priceList, guests: b.guests, note: null, openedBy: ctx.actor, lastEntry: ctx.actor };
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
    })).transaction;
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
        reason = r?.name ?? b.reasonId;
      }
      const perm = line.status === "pendingPrint" ? null : line.status === "printed" ? "pedido.elimEnviado" : "pedido.elimPrecuenta";
      const g = perm && reason?.trim() ? await this.auth.require(session, perm, b.authorization, ctx.now) : { authorizer: null, authorizerActor: null };
      const me = { id: session.user.id, profileId: session.user.profileId, overrides: session.user.overrides };
      // si autorizó un encargado, el dominio lo comprueba con su perfil; si no, con el de quien pulsa
      const next = deleteLine(acc, { lineId, reason, quantity: b.quantity, actor: me, authorizer: g.authorizer, authorizerActor: g.authorizerActor, profiles }, ctx);
      return { next: this.replace(l.order, next), events: [this.ev("lineDeleted", `Se elimina ${line.name} x${b.quantity ?? line.quantity}${reason ? ` · ${reason}` : " (sin enviar)"}`, ctx, acc.id)] };
    })).transaction;
  }

  async moveLines(session: Session, orderId: string, b: { lines: { lineId: string; quantity: number }[]; toAccountId?: string | null; newAccountName?: string | null; version?: number }) {
    await this.auth.require(session, "pedido.separar");
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

  /** Enviar a cocina/barra: agrupa por canal de impresión del producto y la impresora de la estación. */
  async send(session: Session, orderId: string, b: { accountId?: string | null; version?: number }) {
    await this.auth.require(session, "pedido.enviar");
    const r = await this.command<{ printed: { channel: string; printer: string; lines: number; ok: boolean }[] }>(session, orderId, b.version, async (l, ctx, tx) => {
      let next = l.order; const items: KitchenItem[] = []; let n = 0;
      for (const acc of l.order.accounts.filter(a => a.status === "open" && (!b.accountId || a.id === b.accountId))) {
        const res = sendWithCourses(acc, { now: ctx.now }); next = this.replace(next, res.account);
        items.push(...res.items); n += res.sent.length;
      }
      if (!items.length) return { next, events: [], extra: { printed: [] } };
      const printed = await this.printKitchen(tx, session, l, ctx, items);
      return { next, events: [this.ev("linePrinted", `Se envían ${n} líneas`, ctx)], extra: { printed } };
    });
    return { printed: r.extra.printed, order: r.transaction };
  }

  /** Comandas por canal: cada pieza sale por las impresoras de su PLU (la bebida del menú a barra, el 1.º a cocina…). */
  private async printKitchen(tx: Tx, session: Session, l: Loaded, ctx: Ctx, items: KitchenItem[]) {
    const routes = await tx.select({ plu: s.product.plu, channel: s.printChannel.name, printer: s.printer.name, connection: s.printer.connection })
      .from(s.product).innerJoin(s.productChannel, eq(s.productChannel.productId, s.product.id)).innerJoin(s.printChannel, eq(s.printChannel.id, s.productChannel.channelId))
      .leftJoin(s.stationChannelPrinter, and(eq(s.stationChannelPrinter.channelId, s.printChannel.id), eq(s.stationChannelPrinter.stationId, session.station.id)))
      .leftJoin(s.printer, eq(s.printer.id, s.stationChannelPrinter.printerId))
      .where(and(eq(s.product.storeId, session.storeId), inArray(s.product.plu, [...new Set(items.map(x => x.plu))])));
    const jobs = new Map<string, { channel: string; printer: string; connection: string; lines: KitchenItem[] }>();
    for (const it of items) for (const rt of routes.filter(x => x.plu === it.plu)) {
      const k = `${rt.channel}|${rt.printer ?? ""}`;
      if (!jobs.has(k)) jobs.set(k, { channel: rt.channel, printer: rt.printer ?? rt.channel, connection: rt.connection ?? "", lines: [] });
      jobs.get(k)!.lines.push(it);
    }
    const printed = [];
    for (const j of jobs.values()) {
      const ticket = kitchenTicket(j.lines, { channel: j.channel, waiter: ctx.actor.user, guests: l.order.guests, table: { name: l.header.tableName, area: l.header.zone ?? "" }, at: ctx.now });
      const res = await this.printer.print({ kind: "kitchen", channel: j.channel, printer: j.printer, connection: j.connection, title: `Mesa ${l.header.tableName}`, ticket });
      printed.push({ channel: j.channel, printer: j.printer, lines: j.lines.length, ok: res.ok });
    }
    if (printed.some(p => !p.ok)) fail("PRINTER_OFFLINE", "Una impresora no responde; las líneas siguen «Por enviar»", { printed });
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
    const r = await this.command<{ printed: { channel: string; printer: string; lines: number; ok: boolean }[] }>(session, orderId, b.version, async (l, ctx, tx) => {
      const acc = l.order.accounts.find(a => a.lines.some(x => x.id === lineId)) ?? fail("NOT_FOUND", "La línea no existe", { lineId });
      const res = sendWithCourses(acc!, { now: ctx.now, force: { lineId, course: b.course } });
      const printed = res.items.length ? await this.printKitchen(tx, session, l, ctx, res.items) : [];
      const name = acc!.lines.find(x => x.id === lineId)!.name;
      return { next: this.replace(l.order, res.account), events: [this.ev("courseFired", `Marcha ${courseLabel(b.course)} de ${name}`, ctx, acc!.id)], extra: { printed } };
    });
    return { printed: r.extra.printed, order: r.transaction };
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
    return (await this.command(session, orderId, null, async (l, ctx, tx) => {
      const acc = this.account(l.order, accountId);
      const next = preBill(acc);
      const p = await this.ticketPrinter(tx, session);
      const res = await this.printer.print({ kind: "prebill", channel: "TICKET", printer: p.name, connection: p.connection, title: `Precuenta mesa ${l.header.tableName}`, ticket: preBillTicket(next, await this.ticketCtx(tx, session, l, ctx.now)) });
      if (!res.ok) fail("PRINTER_OFFLINE", "La impresora de tickets no responde; la precuenta no se ha impreso", { printer: p.name, error: res.error });
      return { next: this.replace(l.order, next), events: [this.ev("preBill", `Precuenta de la ${acc.name}: ${accountTotals(acc).total.toFixed(2)} €`, ctx, acc.id)] };
    })).transaction;
  }

  async pay(session: Session, orderId: string, accountId: string, b: { id?: string; method: string; amount: number; tip?: number; cashGiven?: number | null; authorization?: string | null }) {
    await this.auth.require(session, "cobro.cobrar", b.authorization);
    const r = await this.command<{ payment: { id: string; status: string; change: number | null } }>(session, orderId, null, async (l, ctx, tx) => {
      const [m] = await tx.select().from(s.paymentMethod).where(and(eq(s.paymentMethod.storeId, session.storeId), eq(s.paymentMethod.code, b.method), eq(s.paymentMethod.active, true)));
      if (!m) fail("VALIDATION", "Forma de pago no disponible", { field: "method" });
      const kind = m!.kind === "cash" ? "cash" : m!.kind === "card" ? "card" : "other";
      if ((b.tip ?? 0) > 0 && !m!.allowsTip) fail("VALIDATION", "Esta forma de pago no admite propina", { field: "tip" });
      const acc = this.account(l.order, accountId);
      const c = b.id ? { ...ctx, newId: () => b.id! } : ctx;
      const res = registerPayment(acc, { method: b.method, kind, amount: b.amount, tip: b.tip, cashGiven: b.cashGiven }, c);
      return { next: this.replace(l.order, res.account), events: [this.ev("paymentAdded", `Cobro ${m!.name} ${res.payment.amount.toFixed(2)} €`, ctx, acc.id)], extra: { payment: { id: res.payment.id, status: res.payment.status, change: res.payment.change } } };
    });
    const acc = r.order.accounts.find(a => a.id === accountId)!;
    const T = accountTotals(acc);
    return { payment: r.extra.payment, totals: { total: T.total, paid: T.paid, pending: T.pending } };
  }

  /**
   * Factura: número reservado con SELECT … FOR UPDATE en invoice_series dentro de la misma transacción,
   * factura + desglose de IVA + registro VeriFactu encadenado al anterior de la tienda.
   */
  async invoice(session: Session, orderId: string, accountId: string) {
    const store = await this.stores.store();
    const r = await this.command<{ invoice: NonNullable<Account["invoice"]> }>(session, orderId, null, async (l, ctx, tx) => {
      const acc = this.account(l.order, accountId);
      if (acc.status !== "open") fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId });
      // cadena VeriFactu: una factura de la tienda cada vez (las series F y T comparten cadena)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.storeId}))`);
      const series = acc.customerData ? store.serieF : store.serieT;
      const [row] = await tx.select().from(s.invoiceSeries).where(and(eq(s.invoiceSeries.storeId, session.storeId), eq(s.invoiceSeries.series, series))).for("update");
      if (!row) fail("NOT_FOUND", `No existe la serie ${series}`, { series });
      const next = issueInvoice(acc, row!.lastSequence + 1, { serieF: store.serieF, serieT: store.serieT, nif: store.nif }, ctx);
      const inv = next.invoice!;
      await tx.update(s.invoiceSeries).set({ lastSequence: inv.sequence } as any).where(and(eq(s.invoiceSeries.storeId, session.storeId), eq(s.invoiceSeries.series, series)));
      const id = crypto.randomUUID();
      const base = inv.taxes.reduce((a, t) => a + t.base, 0), tax = inv.taxes.reduce((a, t) => a + t.tax, 0);
      await tx.insert(s.invoice).values({
        id, storeId: session.storeId, accountId: acc.id, orderId: l.order.id, type: inv.type, series: inv.series, sequence: inv.sequence, invoiceNumber: inv.invoiceNumber, issuedAt: inv.issuedAt,
        issuerTaxId: store.nif, issuerName: store.issuerName, customerId: inv.customer?.id ?? null, customerType: inv.customer?.type ?? null, customerTaxId: inv.customer?.taxId ?? null,
        customerName: inv.customer?.name ?? null, customerEmail: inv.customer?.email ?? null, customerStreet: inv.customer?.street ?? null, customerPostalCode: inv.customer?.postalCode ?? null,
        customerCity: inv.customer?.city ?? null, customerProvince: inv.customer?.province ?? null, customerCountry: inv.customer?.country ?? null,
        taxBase: base.toFixed(2), taxTotal: tax.toFixed(2), total: inv.total.toFixed(2), verifactuQr: inv.verifactuQr,
        issuedByUserId: ctx.actor.userId, issuedByUserName: ctx.actor.user, issuedByRole: ctx.actor.role, issuedByDevice: ctx.actor.device, issuedByAt: ctx.actor.at,
      } as any);
      for (const t of inv.taxes) await tx.insert(s.invoiceTax).values({ invoiceId: id, storeId: session.storeId, rate: t.rate.toFixed(2), base: t.base.toFixed(2), tax: t.tax.toFixed(2) } as any);
      const [prev] = await tx.select().from(s.verifactuRecord).where(eq(s.verifactuRecord.storeId, session.storeId)).orderBy(desc(s.verifactuRecord.generatedAt)).limit(1).for("update");
      const hash = createHash("sha256").update([store.nif, inv.invoiceNumber, inv.issuedAt.slice(0, 10), inv.type, tax.toFixed(2), inv.total.toFixed(2), prev?.hash ?? "", ctx.actor.at].join("&")).digest("hex").toUpperCase();
      await tx.insert(s.verifactuRecord).values({
        id: crypto.randomUUID(), storeId: session.storeId, invoiceId: id, issuerTaxId: store.nif, invoiceNumber: inv.invoiceNumber, issuedOn: inv.issuedAt.slice(0, 10), invoiceType: inv.type,
        taxTotal: tax.toFixed(2), total: inv.total.toFixed(2), previousRecordId: prev?.id ?? null, previousHash: prev?.hash ?? null, hash, generatedAt: ctx.actor.at,
      } as any);
      return { next: this.replace(l.order, next), events: [this.ev("invoiceIssued", `Factura ${inv.type} ${inv.invoiceNumber} · ${inv.total.toFixed(2)} €`, ctx, acc.id)], extra: { invoice: inv } };
    });
    const tableClosed = r.order.accounts.every(a => a.status === "invoiced");
    const printed = await this.printInvoice(session, orderId, accountId).catch(() => false);
    const { taxes: _t, customer: _c, ...invoice } = r.extra.invoice;
    return { invoice, tableClosed, printed };
  }

  /** Impresora de tickets de la estación: la de tipo «ticket» o, si no hay, la primera que tenga asignada. */
  private async ticketPrinter(tx: Tx, session: Session) {
    const [t] = await tx.select({ name: s.printer.name, connection: s.printer.connection }).from(s.printer)
      .where(and(eq(s.printer.storeId, session.storeId), eq(s.printer.kind, "ticket"), eq(s.printer.active, true))).limit(1);
    if (t) return t;
    const [f] = await tx.select({ name: s.printer.name, connection: s.printer.connection }).from(s.stationChannelPrinter)
      .innerJoin(s.printer, eq(s.printer.id, s.stationChannelPrinter.printerId)).where(eq(s.stationChannelPrinter.stationId, session.station.id)).limit(1);
    return f ?? { name: "TICKET", connection: "" };
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
      const p = await this.ticketPrinter(tx, session);
      const cash = acc.payments.some(x => x.status === "confirmed" && x.kind === "cash");
      const [stn] = await tx.select({ opens: s.station.opensDrawer }).from(s.station).where(eq(s.station.id, session.station.id));
      const res = await this.printer.print({ kind: "invoice", channel: "TICKET", printer: p.name, connection: p.connection, title: acc.invoice.invoiceNumber,
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

  async removeDiscount(session: Session, orderId: string, accountId: string, discountId: string) {
    await this.auth.require(session, "cobro.descuentos");
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
      const busy = await tx.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.tableId, b.toTableId), inArray(s.orders.status, ["open", "billing"])));
      if (busy.length) fail("TABLE_BUSY", "La mesa de destino está ocupada", { orderId: busy[0]!.id });
      const from = l.header.tableName;
      await tx.update(s.orders).set({ tableId: t!.t.id, tableName: String(t!.t.number), zone: t!.a.name, priceList: t!.a.priceList } as any).where(eq(s.orders.id, orderId));
      Object.assign(l.header, { tableId: t!.t.id, tableName: String(t!.t.number), zone: t!.a.name, priceList: t!.a.priceList });
      return { next: { ...l.order, tableId: t!.t.id }, events: [this.ev("tableTransferred", `Mesa ${from} → ${t!.t.number}`, ctx)] };
    })).transaction;
  }

  async events(session: Session, orderId: string) {
    await this.auth.require(session, "pedido.historial");
    const rows = await this.database.db.select().from(s.orderEvent).where(and(eq(s.orderEvent.orderId, orderId), eq(s.orderEvent.storeId, session.storeId))).orderBy(s.orderEvent.at);
    return { items: rows.map(e => ({ type: e.type, at: new Date(e.at).toISOString(), description: e.description, user: e.userName ?? "", device: e.device ?? "", role: e.role ?? "" })) };
  }
}
