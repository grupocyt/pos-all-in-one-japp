import { Inject, Injectable } from "@nestjs/common";
import type { Database, Tx } from "@japp/db";
import {
  addProduct,
  applyDiscount,
  removeDiscount,
  setCustomer,
  removeEmptyAccount,
  assertVersion,
  changeQuantity,
  deleteLine,
  fail,
  DomainError,
  fastFoodTableId,
  issueInvoice,
  moveUnits,
  preBill,
  registerPayment,
  accountTotals,
  kitchenTicket,
  preBillTicket,
  invoiceTicket,
  type TicketContext,
  type Account,
  type Ctx,
  type Modifier,
  type Order,
  type Product,
  checkAnswers,
  reorderPending,
  planCourses,
  courseOfAnswer,
  chooseCourse,
  absorbIntoMenu,
  sendWithCourses,
  courseLabel,
  MENU_ABSORB_REASON,
  type QuestionRule,
  type KitchenItem,
  applyPresence,
  assertCanCommand,
  kitchenItemOf,
  canEnterTable,
  transferAccount,
  mergeOrders,
  newAccountName,
  changeFiredCourse,
  assertMethodAllowed,
  presenceView,
  paymentKind,
  r2,
  sum,
  PRESENCE_LEASE_SECONDS,
  liveHolder,
  liveContentOf,
  assertNothingLive,
  renameAccount,
  planReopen,
  checkout,
  type Payment,
  type PaymentInput,
  type CommandKind,
  type PresenceAction,
  type PresenceState,
} from "@japp/domain";
import { CLOCK, DATABASE, PRINTER, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { verifactuHash } from "../Helpers/VerifactuHelper.js";
import { AuthorizationService } from "./AuthorizationService.js";
import {
  OrdersApplication,
  type Loaded,
  type OrderEvent,
  type OrderHeader,
} from "../Applications/OrdersApplication.js";
import { PeriodsApplication } from "../Applications/PeriodsApplication.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { CartaApplication } from "../Applications/CartaApplication.js";
import { OrderOnTableApplication } from "../Applications/OrderOnTableApplication.js";
import { TablesApplication } from "../Applications/TablesApplication.js";
import { PrintersApplication, type TicketPrinter } from "../Applications/PrintersApplication.js";
import type { PrinterPort } from "../Clases/Printers.js";

type Result<T> = {
  loaded: Loaded;
  next: Order;
  events: OrderEvent[];
  extra?: T;
  movedReason?: string;
  /** nada cambió: no se guarda, no sube la versión ni va a la cola */
  noop?: boolean;
  /** se cerró el cobro abierto de la mesa (pendiente a 0 o factura) */
  clearCharging?: boolean;
  /** después de guardar, en la misma transacción (p. ej. apuntar a qué impresora va cada línea) */
  afterSave?: (tx: Tx) => Promise<void>;
  /** presencia final de la mesa (p. ej. «Guardar y salir» la suelta); sustituye a la renovación de quien llama */
  presence?: PresenceState;
};
/** Comanda para una impresora; rows = filas de order_line_printer que marca al imprimir. */
interface KitchenJob {
  channel: string;
  printer: string;
  printerId: string | null;
  connection: string;
  items: KitchenItem[];
  rows: string[];
  table: { name: string; area: string };
  guests: number;
  waiter: string;
  at: Date;
}
/** Permiso para eliminar según dónde está la línea: lo «Por enviar» no pide nada; lo enviado o en precuenta, el suyo. */
function deletePermission(status: string): string | null {
  if (status === "pendingPrint") {
    return null;
  }
  if (status === "printed") {
    return "pedido.elimEnviado";
  }
  return "pedido.elimPrecuenta";
}
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
    @Inject(OrdersApplication) private readonly repo: OrdersApplication,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(CartaApplication) private readonly carta: CartaApplication,
    @Inject(TablesApplication) private readonly tables: TablesApplication,
    @Inject(PrintersApplication) private readonly printers: PrintersApplication,
    @Inject(PeriodsApplication) private readonly periods: PeriodsApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(PRINTER) private readonly printer: PrinterPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OrderOnTableApplication) private readonly oot: OrderOnTableApplication,
  ) {}

  ctx(session: Session): Ctx {
    const now = this.clock();
    return { now, newId: () => crypto.randomUUID(), actor: session.actor(now) };
  }

  /**
   * Esqueleto común de los comandos sobre una orden.
   * Una persona por mesa: si otra persona (u otro equipo) tiene la mesa, solo pasan los comandos «save» (añadir y enviar);
   * si quien llama la tiene, cada comando aceptado le renueva el plazo. Sin presencia, todo como siempre.
   */
  private async command<T = undefined>(
    session: Session,
    orderId: string,
    version: number | null | undefined,
    fn: (l: Loaded, ctx: Ctx, tx: Tx) => Promise<Omit<Result<T>, "loaded">> | Omit<Result<T>, "loaded">,
    opts: { kind?: CommandKind } = {},
  ) {
    const ctx = this.ctx(session);
    return this.database.withTx((tx) => this.commandIn(tx, session, orderId, version, fn, ctx, opts));
  }

  /**
   * El cuerpo de command() dentro de una transacción ya abierta: para los casos de uso que tienen que bloquear algo
   * ANTES que la orden (p. ej. la mesa de destino al transferir: mismo orden que abrir mesa, sin interbloqueos).
   */
  private async commandIn<T = undefined>(
    tx: Tx,
    session: Session,
    orderId: string,
    version: number | null | undefined,
    fn: (l: Loaded, ctx: Ctx, tx: Tx) => Promise<Omit<Result<T>, "loaded">> | Omit<Result<T>, "loaded">,
    ctx: Ctx,
    opts: { kind?: CommandKind } = {},
  ) {
    const loaded = await this.repo.load(tx, session.storeId, orderId, { lock: true });
    if (loaded.header.status === "closed" || loaded.header.status === "cancelled") {
      fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
    }
    if (version != null) {
      assertVersion(loaded.header.version, version);
    }
    const g = assertCanCommand(
      loaded.header.presence,
      { userId: session.user.id, stationId: session.station.id },
      opts.kind ?? "other",
      ctx.now,
    );
    const r = await fn(loaded, ctx, tx);
    let v = loaded.header.version;
    if (!r.noop) {
      v = await this.repo.save(tx, session.storeId, loaded.order, r.next, loaded.header, {
        actor: ctx.actor,
        events: r.events,
        movedReason: r.movedReason,
      });
      await r.afterSave?.(tx);
    }
    const p = loaded.header.presence;
    if (r.presence) {
      if (JSON.stringify(r.presence) !== JSON.stringify(p)) {
        await this.repo.savePresence(tx, session.storeId, orderId, r.presence);
      }
    } else if (g.holds || (r.clearCharging && p.chargingUntil)) {
      const holder =
        g.holds && p.holder
          ? {
              ...p.holder,
              until: new Date(ctx.now.getTime() + PRESENCE_LEASE_SECONDS * 1000).toISOString(),
            }
          : p.holder;
      await this.repo.savePresence(tx, session.storeId, orderId, {
        holder,
        chargingUntil: r.clearCharging ? null : p.chargingUntil,
      });
    }
    const after = await this.repo.load(tx, session.storeId, orderId);
    return {
      transaction: await this.repo.transaction(tx, { ...after.header, version: v }, after.order),
      extra: r.extra as T,
      order: after.order,
    };
  }

  /**
   * Una persona por mesa: entrar, renovar, salir, abrir y cerrar el cobro (regla en @japp/domain → applyPresence).
   * No cambia la versión de la orden. Si alguien con mesas.entrarOcupada desplaza a otro, queda en el historial.
   */
  async presence(session: Session, orderId: string, action: PresenceAction) {
    const now = this.clock();
    const a = session.actor(now);
    const me = {
      userId: session.user.id,
      userName: session.user.name,
      stationId: session.station.id,
      stationName: session.station.name,
      canTakeOver: session.can("mesas.entrarOcupada"),
    };
    return this.database.withTx(async (tx) => {
      const o = await this.repo.lockRow(tx, session.storeId, orderId);
      if (!o) {
        fail("NOT_FOUND", "La orden no existe", { orderId });
      }
      if (o!.status === "closed" || o!.status === "cancelled") {
        fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
      }
      const before = OrdersApplication.presenceOf(o!);
      const r = applyPresence(before, action, me, now);
      if (JSON.stringify(r.state) !== JSON.stringify(before)) {
        await this.repo.savePresence(tx, session.storeId, orderId, r.state);
      }
      if (r.displaced) {
        await this.repo.insertEvent(tx, session.storeId, orderId, {
          type: "tableTakenOver",
          description: `${me.userName} entra en la mesa; ${r.displaced.userName} pasa a solo guardar`,
          actor: a,
        });
      }
      return presenceView(r.state, me, now);
    });
  }

  private account(order: Order, accountId?: string | null): Account {
    const a = accountId
      ? order.accounts.find((x) => x.id === accountId)
      : order.accounts.find((x) => x.status === "open");
    if (!a) {
      fail(
        accountId ? "NOT_FOUND" : "ACCOUNT_CLOSED",
        accountId ? "La cuenta no existe" : "No hay ninguna cuenta abierta",
        { accountId },
      );
    }
    return a!;
  }
  private replace(order: Order, acc: Account): Order {
    return { ...order, accounts: order.accounts.map((a) => (a.id === acc.id ? acc : a)) };
  }
  private ev(type: string, description: string, ctx: Ctx, accountId?: string): OrderEvent {
    return { type, description, actor: ctx.actor, accountId };
  }

  async get(session: Session, orderId: string) {
    return this.database.withTx(async (tx) => {
      const l = await this.repo.load(tx, session.storeId, orderId);
      return this.repo.transaction(tx, l.header, l.order);
    });
  }

  async list(session: Session, status?: string, tableId?: string) {
    const rows = await this.repo.list(session.storeId, status, tableId);
    return { items: rows };
  }

  /** Abrir mesa (o el pedido fast food FF-<estación>). Una mesa solo puede tener una orden abierta. */
  async open(
    session: Session,
    b: {
      id?: string;
      accountId?: string;
      accountName?: string;
      tableId: string;
      guests: number;
      authorization?: string | null;
    },
  ) {
    await this.auth.require(session, "mesas.abrirMesa", b.authorization);
    const ctx = this.ctx(session);
    const store = await this.stores.store();
    return this.database.withTx(async (tx) => {
      const period = await this.periods.current(tx, session.storeId);
      if (!period) {
        fail("PERIOD_CLOSED", "No hay periodo abierto");
      }
      const ff = b.tableId.startsWith("FF-");
      if (ff && store.serviceType !== "fastfood") {
        fail("VALIDATION", "La tienda no está en modo fast food", { field: "tableId" });
      }
      let table: { id: string | null; name: string; zone: string | null; priceList: "general" | "terrace" };
      if (ff) {
        table = {
          id: null,
          name: fastFoodTableId(session.station.name),
          zone: "FASTFOOD",
          priceList: "general",
        };
      } else {
        const t = await this.tables.lockWithArea(tx, session.storeId, b.tableId);
        if (!t) {
          fail("NOT_FOUND", "La mesa no existe", { tableId: b.tableId });
        }
        table = {
          id: t!.t.id,
          name: String(t!.t.number),
          zone: t!.a.name,
          priceList: t!.a.priceList === "terrace" ? "terrace" : "general",
        };
      }
      const busy = await this.repo.liveOnTable(tx, session.storeId, {
        tableId: table.id,
        tableName: table.name,
      });
      if (busy.length) {
        if (ff) {
          return this.get(session, busy[0]!.id);
        } // fast food: siempre se vuelve al mismo pedido
        fail("TABLE_BUSY", "La mesa ya está abierta", { orderId: busy[0]!.id });
      }
      const header: OrderHeader = {
        id: b.id ?? crypto.randomUUID(),
        storeId: session.storeId,
        periodId: period!.id,
        status: "open",
        version: 1,
        tableId: table.id,
        tableName: table.name,
        zone: table.zone,
        priceList: table.priceList,
        guests: b.guests,
        note: null,
        openedBy: ctx.actor,
        lastEntry: ctx.actor,
        presence: { holder: null, chargingUntil: null },
      };
      await this.repo.insertHeader(tx, header);
      const empty: Order = {
        id: header.id,
        tableId: table.id ?? "",
        guests: b.guests,
        version: 1,
        accounts: [],
      };
      const acc: Account = {
        id: b.accountId ?? crypto.randomUUID(),
        name: b.accountName?.trim() || "Cuenta 1",
        status: "open",
        lines: [],
        deletedLines: [],
        discounts: [],
        payments: [],
        customerData: null,
        invoice: null,
      };
      const next = { ...empty, accounts: [acc] };
      const v = await this.repo.save(tx, session.storeId, empty, next, header, {
        actor: ctx.actor,
        events: [this.ev("tableOpened", `Se abre la mesa ${table.name} con ${b.guests} comensales`, ctx)],
      });
      const l = await this.repo.load(tx, session.storeId, header.id);
      return this.repo.transaction(tx, { ...l.header, version: v }, l.order);
    });
  }

  async patch(
    session: Session,
    orderId: string,
    b: { guests?: number; note?: string | null; version?: number },
  ) {
    if (b.guests != null) {
      await this.auth.require(session, "pedido.comensales");
    }
    if (b.note !== undefined) {
      await this.auth.require(session, "pedido.notaMesa");
    }
    return (
      await this.command(session, orderId, b.version, (l, ctx) => {
        if (b.note !== undefined) {
          l.header.note = b.note;
        }
        return {
          next: { ...l.order, guests: b.guests ?? l.order.guests },
          events: [
            this.ev(
              "tableUpdated",
              `Comensales ${b.guests ?? l.order.guests}${b.note ? ` · nota: ${b.note}` : ""}`,
              ctx,
            ),
          ],
        };
      })
    ).transaction;
  }

  async addAccount(session: Session, orderId: string, b: { id?: string; name?: string; version?: number }) {
    await this.auth.require(session, "pedido.cuentas");
    return (
      await this.command(session, orderId, b.version, async (l, ctx, tx) => {
        // sin nombre: el siguiente «Cuenta N» sin reutilizar números (también los de cuentas ya anuladas);
        // con nombre: se respeta, y si repite el de otra cuenta de la mesa → 409 DUPLICATE (como al renombrar)
        const names = await this.repo.accountNames(tx, session.storeId, orderId);
        const name = newAccountName(l.order, b.name, names);
        const acc: Account = {
          id: b.id ?? ctx.newId(),
          name,
          status: "open",
          lines: [],
          deletedLines: [],
          discounts: [],
          payments: [],
          customerData: null,
          invoice: null,
        };
        return {
          next: { ...l.order, accounts: [...l.order.accounts, acc] },
          events: [this.ev("accountOpened", `Se abre la ${name}`, ctx, acc.id)],
        };
      })
    ).transaction;
  }

  /** Producto + modificadores desde la carta (precio general y terraza, IVA). */
  private async product(tx: Tx, storeId: string, plu: number): Promise<Product> {
    const p = await this.carta.product(tx, storeId, plu);
    if (!p) {
      fail("NOT_FOUND", "Ese producto no está en la carta", { plu });
    }
    if (p!.p.soldOut) {
      fail("VALIDATION", `${p!.p.name} está agotado`, { plu });
    }
    return {
      plu,
      name: p!.p.ticketName || p!.p.name,
      price: Number(p!.p.price),
      terracePrice: p!.p.priceTerrace == null ? undefined : Number(p!.p.priceTerrace),
      taxRate: Number(p!.rate),
    };
  }
  /** Preguntas activas del producto con sus respuestas (PLU), para comprobar las obligatorias. */
  private async questionRules(tx: Tx, storeId: string, plu: number): Promise<QuestionRule[]> {
    return this.carta.questionRules(tx, storeId, plu);
  }
  private async modifiers(
    tx: Tx,
    storeId: string,
    mods: { questionId?: string | null; plu: number; quantity?: number }[],
  ): Promise<Modifier[]> {
    const out: Modifier[] = [];
    for (const m of mods) {
      const r = await this.carta.answer(tx, storeId, m.plu, m.questionId);
      if (!r) {
        fail("NOT_FOUND", "Esa respuesta no existe para el producto", {
          plu: m.plu,
          questionId: m.questionId,
        });
      }
      out.push({
        name: r!.a.label || r!.p.ticketName || r!.p.name,
        unitPrice: Number(r!.a.extraPrice ?? 0),
        quantity: m.quantity ?? 1,
      });
    }
    return out;
  }

  async addLine(
    session: Session,
    orderId: string,
    b: {
      id?: string;
      accountId?: string | null;
      plu: number;
      quantity: number;
      comment?: string | null;
      modifiers?: { questionId?: string | null; plu: number; quantity?: number }[];
      force?: boolean;
      version?: number;
    },
  ) {
    if (b.comment) {
      await this.auth.require(session, "pedido.comentarios");
    }
    const store = await this.stores.store();
    return (
      await this.command(
        session,
        orderId,
        b.version,
        async (l, ctx, tx) => {
          const { product, modifiers, courses } = await this.lineInput(tx, session.storeId, b);
          const acc = this.account(l.order, b.accountId);
          const c = b.id ? { ...ctx, newId: () => b.id! } : ctx;
          const next = addProduct(
            acc,
            {
              product,
              area: { id: "", name: l.header.zone ?? "", priceList: l.header.priceList },
              quantity: b.quantity,
              modifiers,
              courses,
              comment: b.comment ?? "",
              force: b.force,
              dupWindowMin: store.duplicateMinutes,
            },
            c,
          );
          return {
            next: this.replace(l.order, next),
            events: [this.ev("lineAdded", `Se añade ${product.name} x${b.quantity}`, ctx, acc.id)],
          };
        },
        { kind: "save" },
      )
    ).transaction;
  }

  /**
   * Lo que necesita addProduct para una línea nueva (lo mismo en POST …/lines y en Order on Table): el producto de la carta,
   * las preguntas obligatorias respondidas (los pases de comida pueden quedar por elegir), las respuestas y los pases.
   */
  private async lineInput(
    tx: Tx,
    storeId: string,
    b: { plu: number; modifiers?: { questionId?: string | null; plu: number; quantity?: number }[] },
  ) {
    const product = await this.product(tx, storeId, b.plu);
    const rules = await this.questionRules(tx, storeId, b.plu);
    checkAnswers(rules, b.modifiers ?? []);
    const modifiers = (await this.modifiers(tx, storeId, b.modifiers ?? []))
      .map((m, i) => ({
        ...m,
        plu: b.modifiers![i]!.plu,
        ...(rules.length ? courseOfAnswer(rules, b.modifiers![i]!) : {}),
      }))
      .map((m) =>
        m.course == null ? { name: m.name, unitPrice: m.unitPrice, quantity: m.quantity, plu: m.plu } : m,
      );
    const courses = planCourses(rules, b.modifiers ?? []);
    return { product, modifiers, courses };
  }

  async patchLine(
    session: Session,
    orderId: string,
    lineId: string,
    b: { quantity?: number; comment?: string | null; version?: number },
  ) {
    if (b.comment !== undefined) {
      await this.auth.require(session, "pedido.comentarios");
    }
    return (
      await this.command(session, orderId, b.version, (l, ctx) => {
        const acc =
          l.order.accounts.find((a) => a.lines.some((x) => x.id === lineId)) ??
          fail("NOT_FOUND", "La línea no existe", { lineId });
        const line = acc.lines.find((x) => x.id === lineId)!;
        let next = acc;
        if (b.quantity != null && b.quantity !== line.quantity) {
          next = changeQuantity(next, lineId, b.quantity - line.quantity);
        }
        if (b.comment !== undefined) {
          if (line.status !== "pendingPrint") {
            fail("VALIDATION", "Solo se comenta lo que aún no se ha enviado", { lineId });
          }
          next = {
            ...next,
            lines: next.lines.map((x) => (x.id === lineId ? { ...x, comment: b.comment ?? "" } : x)),
          };
        }
        return {
          next: this.replace(l.order, next),
          events: [
            this.ev("lineUpdated", `${line.name}: cantidad ${b.quantity ?? line.quantity}`, ctx, acc.id),
          ],
        };
      })
    ).transaction;
  }

  async deleteLine(
    session: Session,
    orderId: string,
    lineId: string,
    b: {
      reasonId?: string | null;
      reason?: string | null;
      quantity?: number;
      authorization?: string | null;
      version?: number;
    },
  ) {
    const profiles = await this.stores.profiles(session.storeId);
    return (
      await this.command(session, orderId, b.version, async (l, ctx, tx) => {
        const acc =
          l.order.accounts.find((a) => a.lines.some((x) => x.id === lineId)) ??
          fail("NOT_FOUND", "La línea no existe", { lineId });
        const line = acc.lines.find((x) => x.id === lineId)!;
        let reason = b.reason ?? undefined;
        if (b.reasonId) {
          const r = await this.carta.reason(tx, session.storeId, b.reasonId);
          if (!r) {
            fail("VALIDATION", "Ese motivo no existe", { field: "reasonId" });
          }
          reason = r!.name;
        }
        const perm = deletePermission(line.status);
        const g =
          perm && reason?.trim()
            ? await this.auth.require(session, perm, b.authorization, ctx.now)
            : { authorizer: null, authorizerActor: null };
        const me = {
          id: session.user.id,
          profileId: session.user.profileId,
          overrides: session.user.overrides,
        };
        // si autorizó un encargado, el dominio lo comprueba con su perfil; si no, con el de quien pulsa
        const next = deleteLine(
          acc,
          {
            lineId,
            reason,
            quantity: b.quantity,
            actor: me,
            authorizer: g.authorizer,
            authorizerActor: g.authorizerActor,
            profiles,
          },
          ctx,
        );
        return {
          next: this.replace(l.order, next),
          events: [
            this.ev(
              "lineDeleted",
              `Se elimina ${line.name} x${b.quantity ?? line.quantity}${reason ? ` · ${reason}` : " (sin enviar)"}`,
              ctx,
              acc.id,
            ),
          ],
        };
      })
    ).transaction;
  }

  async moveLines(
    session: Session,
    orderId: string,
    b: {
      lines: { lineId: string; quantity: number }[];
      toAccountId?: string | null;
      newAccountName?: string | null;
      authorization?: string | null;
      version?: number;
    },
  ) {
    await this.auth.requireAny(session, ["pedido.pasarCuenta", "pedido.separar"], b.authorization);
    return (
      await this.command(session, orderId, b.version, async (l, ctx, tx) => {
        const from =
          l.order.accounts.find((a) => a.lines.some((x) => x.id === b.lines[0]?.lineId)) ??
          fail("NOT_FOUND", "La línea no existe");
        if (b.lines.some((x) => !from.lines.some((y) => y.id === x.lineId))) {
          fail("VALIDATION", "Todas las líneas deben ser de la misma cuenta");
        }
        const pick = Object.fromEntries(b.lines.map((x) => [x.lineId, x.quantity]));
        // a cuenta nueva: «Cuenta N» sin repetir números de cuentas ya anuladas de la mesa
        const names = b.toAccountId ? [] : await this.repo.accountNames(tx, session.storeId, orderId);
        const r = moveUnits(l.order, from.id, b.toAccountId ?? "new", pick, ctx, names);
        let next = r.order;
        if (!b.toAccountId && b.newAccountName) {
          next = {
            ...next,
            accounts: next.accounts.map((a) => (a.id === r.destId ? { ...a, name: b.newAccountName! } : a)),
          };
        }
        const dest = next.accounts.find((a) => a.id === r.destId)!;
        return {
          next,
          movedReason: `Pasada a ${dest.name}`,
          events: [
            this.ev(
              "accountsSplit",
              `Se pasan ${b.lines.reduce((a, x) => a + x.quantity, 0)} uds de ${from.name} a ${dest.name}`,
              ctx,
              from.id,
            ),
          ],
        };
      })
    ).transaction;
  }

  /**
   * Enviar a cocina/barra («Guardar»): agrupa por canal de impresión del producto y la impresora de la estación.
   * Se guarda primero (líneas enviadas + order_line_printer pendiente de imprimir) y se imprime DESPUÉS del COMMIT, sin bloquear la mesa.
   * Lo que no salió por una impresora queda pendiente y el siguiente envío lo imprime solo ahí (lo que ya salió no se repite).
   * Sin nada que enviar ni que reimprimir: no cambia la versión ni va a la cola.
   */
  async send(session: Session, orderId: string, b: { accountId?: string | null; version?: number }) {
    await this.auth.require(session, "pedido.enviar");
    const r = await this.command<{ jobs: KitchenJob[] }>(
      session,
      orderId,
      b.version,
      async (l, ctx, tx) => {
        const s = await this.planSend(tx, session, l, ctx, b.accountId);
        if (!s.sent) {
          return { next: s.next, events: [], noop: true, extra: { jobs: s.jobs } };
        }
        return {
          next: s.next,
          events: [this.ev("linePrinted", `Se envían ${s.sent} líneas`, ctx)],
          extra: { jobs: s.jobs },
          afterSave: s.record,
        };
      },
      { kind: "save" },
    );
    const printed = await this.printKitchen(session, r.extra.jobs);
    return { printed, order: r.transaction };
  }

  /**
   * Lo que hace «Enviar» dentro de la transacción (con la orden bloqueada): marca enviado lo «Por enviar» de las cuentas
   * abiertas (o de una), decide las comandas nuevas y reserva las que no salieron antes. No imprime: eso va después del COMMIT.
   */
  private async planSend(tx: Tx, session: Session, l: Loaded, ctx: Ctx, accountId?: string | null) {
    let next = l.order;
    const items: KitchenItem[] = [];
    let sent = 0;
    for (const acc of l.order.accounts.filter(
      (a) => a.status === "open" && (!accountId || a.id === accountId),
    )) {
      const res = sendWithCourses(acc, { now: ctx.now });
      next = this.replace(next, res.account);
      items.push(...res.items);
      sent += res.sent.length;
    }
    const retry = await this.pendingKitchenJobs(tx, session, l, ctx);
    if (!sent) {
      return { next, sent, jobs: retry, record: undefined };
    }
    const plan = await this.planKitchen(tx, session, l, ctx, items);
    return { next, sent, jobs: [...plan.jobs, ...retry], record: plan.record };
  }

  /**
   * «Guardar y salir» (botón Guardar del TPV y la PDA): envía lo «Por enviar» como POST …/send, suelta la presencia de quien
   * llama (como presence leave) y, si a la mesa no le queda nada vivo, la cierra sin venta como POST …/close (released).
   * Todo en una transacción; las comandas se imprimen DESPUÉS del COMMIT (si una impresora falla, 503 PRINTER_OFFLINE
   * y la mesa queda guardada igual).
   */
  async saveAndLeave(session: Session, orderId: string, b: { version?: number | null }) {
    const me = {
      userId: session.user.id,
      userName: session.user.name,
      stationId: session.station.id,
      stationName: session.station.name,
    };
    const r = await this.command<{ jobs: KitchenJob[]; sent: number; released: boolean }>(
      session,
      orderId,
      b.version,
      async (l, ctx, tx) => {
        const s = await this.planSend(tx, session, l, ctx);
        if (s.sent) {
          // enviar pide su permiso, como POST …/send (salir de una mesa sin nada nuevo no pide nada)
          await this.auth.require(session, "pedido.enviar", null, ctx.now);
        }
        const left = applyPresence(l.header.presence, "leave", me, ctx.now).state;
        // otra persona con la mesa viva: quien solo guarda no se la cierra
        const other = liveHolder(left, ctx.now);
        const released = !other && !liveContentOf(s.next);
        const events: OrderEvent[] = [];
        if (s.sent) {
          events.push(this.ev("linePrinted", `Se envían ${s.sent} líneas`, ctx));
        }
        let next = s.next;
        if (released) {
          next = this.closeEmpty(l, s.next);
          events.push(this.ev("tableClosed", "Se cierra la mesa sin venta", ctx));
        }
        return {
          next,
          events,
          noop: !events.length,
          extra: { jobs: s.jobs, sent: s.sent, released },
          afterSave: s.record,
          presence: released ? { holder: null, chargingUntil: null } : left,
        };
      },
      { kind: "save" },
    );
    await this.printKitchen(session, r.extra.jobs);
    return {
      released: r.extra.released,
      sent: r.extra.sent,
      version: r.transaction.version,
      order: r.transaction,
    };
  }

  /** Comandas por canal: cada pieza sale por las impresoras de su PLU (la bebida del menú a barra, el 1.º a cocina…). Solo decide; no imprime. */
  private async planKitchen(tx: Tx, session: Session, l: Loaded, ctx: Ctx, items: KitchenItem[]) {
    // canales de comanda de cada producto + sus copias (doble zona); impresora = la de esta estación para el canal o la del canal
    const plus = [...new Set(items.map((x) => x.plu))];
    const S = session.storeId;
    const routes = await this.printers.kitchenRoutes(tx, S, session.station.id, plus);
    const jobs = new Map<string, KitchenJob>();
    const rows: { id: string; lineId: string; channel: string; job: KitchenJob }[] = [];
    for (const it of items) {
      for (const rt of routes.filter((x) => x.plu === it.plu)) {
        const k = `${rt.channel}|${rt.printer ?? ""}`;
        if (!jobs.has(k)) {
          jobs.set(k, {
            channel: rt.channel,
            printer: rt.printer ?? rt.channel,
            printerId: rt.printer_id,
            connection: rt.connection ?? "",
            items: [],
            rows: [],
            table: { name: l.header.tableName, area: l.header.zone ?? "" },
            guests: l.order.guests,
            waiter: ctx.actor.user,
            at: ctx.now,
          });
        }
        const job = jobs.get(k)!;
        job.items.push(it);
        if (it.lineId) {
          const id = crypto.randomUUID();
          job.rows.push(id);
          rows.push({ id, lineId: it.lineId, channel: it.tag ? `${rt.channel}|${it.tag}` : rt.channel, job });
        }
      }
    }
    // a qué impresora va cada línea; printed_at con printed = false = intento en curso (otro envío no lo repite mientras dura)
    const record = async (t: Tx) => {
      for (const r of rows) {
        await this.printers.insertLinePrinter(t, {
          id: r.id,
          storeId: S,
          lineId: r.lineId,
          channelName: r.channel.slice(0, 40),
          printerId: r.job.printerId,
          printerName: r.job.printer.slice(0, 40),
          interface: r.job.connection.slice(0, 120) || null,
          printedAt: ctx.now.toISOString(),
        });
      }
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
    const rows = await this.printers.pendingLinePrinters(
      tx,
      S,
      l.order.id,
      new Date(ctx.now.getTime() - PRINT_CLAIM_SECONDS * 1000),
    );
    if (!rows.length) {
      return [];
    }
    const lines = new Map(l.order.accounts.flatMap((a) => a.lines.map((x) => [x.id, x] as const)));
    const jobs = new Map<string, KitchenJob>();
    const claimed: string[] = [];
    for (const r of rows) {
      const line = lines.get(r.line_id);
      if (!line) {
        continue;
      }
      const [channel, tag] = r.channel_name.split("|") as [string, string | undefined];
      const k = `${channel}|${r.printer_name ?? ""}`;
      if (!jobs.has(k)) {
        jobs.set(k, {
          channel,
          printer: r.printer_name ?? channel,
          printerId: r.printer_id,
          connection: r.interface ?? "",
          items: [],
          rows: [],
          table: { name: l.header.tableName, area: l.header.zone ?? "" },
          guests: l.order.guests,
          waiter: line.createdBy.user,
          at: ctx.now,
        });
      }
      jobs.get(k)!.items.push(kitchenItemOf(line, tag));
      jobs.get(k)!.rows.push(r.id);
      claimed.push(r.id);
    }
    if (claimed.length) {
      await this.printers.claimLinePrinters(tx, S, claimed, ctx.now);
    }
    return [...jobs.values()];
  }

  /** Imprime después del COMMIT y apunta qué salió. Si una impresora falla → 503 PRINTER_OFFLINE (lo que falló queda para el siguiente envío). */
  private async printKitchen(session: Session, jobs: KitchenJob[]): Promise<Printed[]> {
    const printed: Printed[] = [];
    for (const j of jobs) {
      const ticket = kitchenTicket(j.items, {
        channel: j.channel,
        waiter: j.waiter,
        guests: j.guests,
        table: j.table,
        at: j.at,
      });
      const res = await this.printer
        .print({
          kind: "kitchen",
          channel: j.channel,
          printer: j.printer,
          connection: j.connection,
          title: `Mesa ${j.table.name}`,
          ticket,
        })
        .catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      printed.push({ channel: j.channel, printer: j.printer, lines: j.items.length, ok: res.ok });
      if (j.rows.length) {
        await this.printers.markLinePrinters(
          session.storeId,
          j.rows,
          res.ok,
          res.ok ? this.clock().toISOString() : null,
        );
      }
    }
    if (printed.some((p) => !p.ok)) {
      fail("PRINTER_OFFLINE", "Una impresora no responde: lo que no salió se imprimirá al volver a enviar", {
        printed,
      });
    }
    return printed;
  }

  /**
   * Menú por pases: elegir (o cambiar) un pase que aún no ha salido. Sale al guardar (send) si toca.
   * Un pase YA MARCHADO también se puede cambiar (falta de stock, decidido tras las pruebas en tienda, 23/10/2026),
   * como quien elimina algo enviado: con motivo (reasonId o reason; sin él → 422 field reason) y pedido.elimEnviado
   * (o authorization de encargado; sin él → 403). Queda en el historial lo que había, el pase sigue marchado con la
   * respuesta nueva y su comanda «>> CAMBIO 1.º» (nota «ANTES: …») sale DESPUÉS del COMMIT por las impresoras de la
   * respuesta nueva, con las filas de order_line_printer como «Marchar».
   */
  async chooseAnswers(
    session: Session,
    orderId: string,
    lineId: string,
    b: {
      course: number;
      modifiers: { plu: number; quantity?: number }[];
      reasonId?: string | null;
      reason?: string | null;
      authorization?: string | null;
      version?: number | null;
    },
  ) {
    const r = await this.command<{ jobs: KitchenJob[] }>(session, orderId, b.version, async (l, ctx, tx) => {
      const acc =
        l.order.accounts.find((a) => a.lines.some((x) => x.id === lineId)) ??
        fail("NOT_FOUND", "La línea no existe", { lineId });
      const line = acc!.lines.find((x) => x.id === lineId)!;
      const rules = await this.questionRules(tx, session.storeId, line.productId);
      const rule =
        rules.find((q) => q.course === b.course) ??
        fail("VALIDATION", "Ese producto no tiene ese pase", { field: "course" });
      const bad = b.modifiers.find((m) => !rule!.answers.includes(m.plu));
      if (bad) {
        fail("VALIDATION", `Esa respuesta no es de «${rule!.name}»`, {
          field: "modifiers",
          plu: bad.plu,
          questionId: rule!.id,
        });
      }
      const input = b.modifiers.map((m) => ({ ...m, questionId: rule!.id }));
      checkAnswers([rule!], input, { only: rule!.id });
      const mods = (await this.modifiers(tx, session.storeId, input)).map((m, i) => ({
        ...m,
        plu: input[i]!.plu,
        course: b.course,
        questionId: rule!.id,
      }));
      const state = line.courses?.find((c) => c.course === b.course)?.state;
      if (state !== "fired") {
        const next = chooseCourse(acc!, lineId, b.course, mods);
        return {
          next: this.replace(l.order, next),
          events: [
            this.ev(
              "courseChosen",
              `${line.name}: ${courseLabel(b.course)} ${mods.map((m) => m.name).join(", ")}`,
              ctx,
              acc!.id,
            ),
          ],
          extra: { jobs: [] },
        };
      }
      const reason = await this.changeReason(tx, session, b);
      const g = await this.auth.require(session, "pedido.elimEnviado", b.authorization, ctx.now);
      const ch = changeFiredCourse(acc!, lineId, b.course, mods, ctx.now);
      const plan = await this.planKitchen(tx, session, l, ctx, [ch.item]);
      const upper = (ms: Modifier[]) => ms.map((m) => m.name.toUpperCase()).join(", ");
      let who = ctx.actor.user;
      if (g.authorizerActor) {
        who = `${who}/${g.authorizerActor.user}`;
      }
      return {
        next: this.replace(l.order, ch.account),
        events: [
          this.ev(
            "courseChanged",
            `Cambio ${courseLabel(b.course)}: ${upper(ch.before)} → ${upper(mods)} · ${reason} · ${who}`,
            ctx,
            acc!.id,
          ),
        ],
        extra: { jobs: plan.jobs },
        afterSave: plan.record,
      };
    });
    if (r.extra.jobs.length) {
      await this.printKitchen(session, r.extra.jobs);
    }
    return r.transaction;
  }

  /** Motivo de un cambio de pase marchado: el de la lista (reasonId) o el texto; sin ninguno → 422 field reason. */
  private async changeReason(
    tx: Tx,
    session: Session,
    b: { reasonId?: string | null; reason?: string | null },
  ): Promise<string> {
    if (b.reasonId) {
      const r = await this.carta.reason(tx, session.storeId, b.reasonId);
      if (!r) {
        fail("VALIDATION", "Ese motivo no existe", { field: "reasonId" });
      }
      return r!.name;
    }
    const text = b.reason?.trim();
    if (!text) {
      fail("VALIDATION", "Ese pase ya está marchado: indica el motivo del cambio", { field: "reason" });
    }
    return text!;
  }

  /** Menú por pases: «Marchar» un pase en espera (o elegido) ahora mismo. */
  async fireCourse(
    session: Session,
    orderId: string,
    lineId: string,
    b: { course: number; version?: number | null },
  ) {
    await this.auth.require(session, "pedido.enviar");
    const r = await this.command<{ jobs: KitchenJob[] }>(session, orderId, b.version, async (l, ctx, tx) => {
      const acc =
        l.order.accounts.find((a) => a.lines.some((x) => x.id === lineId)) ??
        fail("NOT_FOUND", "La línea no existe", { lineId });
      const res = sendWithCourses(acc!, { now: ctx.now, force: { lineId, course: b.course } });
      const plan = res.items.length
        ? await this.planKitchen(tx, session, l, ctx, res.items)
        : { jobs: [], record: undefined };
      const name = acc!.lines.find((x) => x.id === lineId)!.name;
      return {
        next: this.replace(l.order, res.account),
        events: [this.ev("courseFired", `Marcha ${courseLabel(b.course)} de ${name}`, ctx, acc!.id)],
        extra: { jobs: plan.jobs },
        afterSave: plan.record,
      };
    });
    const printed = await this.printKitchen(session, r.extra.jobs);
    return { printed, order: r.transaction };
  }

  /** «Inclúyeme la bebida en el menú»: una bebida ya pedida pasa a ser la del pase (sin encargado; queda con motivo). */
  async absorb(
    session: Session,
    orderId: string,
    lineId: string,
    b: { course: number; sourceLineId: string; version?: number | null },
  ) {
    return (
      await this.command(session, orderId, b.version, async (l, ctx, tx) => {
        const acc =
          l.order.accounts.find((a) => a.lines.some((x) => x.id === lineId)) ??
          fail("NOT_FOUND", "La línea no existe", { lineId });
        const menu = acc!.lines.find((x) => x.id === lineId)!;
        const src =
          acc!.lines.find((x) => x.id === b.sourceLineId) ??
          fail("NOT_FOUND", "La bebida no está en esta cuenta", { lineId: b.sourceLineId });
        const rule =
          (await this.questionRules(tx, session.storeId, menu.productId)).find(
            (q) => q.course === b.course,
          ) ?? fail("VALIDATION", "Ese menú no tiene ese pase", { field: "course" });
        if (!rule!.answers.includes(src!.productId)) {
          fail("VALIDATION", `${src!.name} no es una respuesta de «${rule!.name}»`, {
            field: "sourceLineId",
          });
        }
        const [ans] = await this.modifiers(tx, session.storeId, [
          { plu: src!.productId, questionId: rule!.id },
        ]);
        const next = absorbIntoMenu(
          acc!,
          {
            menuLineId: lineId,
            course: b.course,
            sourceLineId: src!.id,
            answer: { ...ans!, plu: src!.productId },
          },
          ctx,
        );
        return {
          next: this.replace(l.order, next),
          events: [
            this.ev("menuAbsorb", `${src!.name} pasa a ${menu.name} (${MENU_ABSORB_REASON})`, ctx, acc!.id),
          ],
        };
      })
    ).transaction;
  }

  async prebill(session: Session, orderId: string, accountId: string) {
    await this.auth.require(session, "pedido.precuenta");
    // se guarda y se imprime después del COMMIT (sin bloquear la mesa durante la conexión con la impresora)
    const r = await this.command<{
      job: {
        p: { name: string; connection: string; channel: string };
        title: string;
        ticket: ReturnType<typeof preBillTicket>;
      };
    }>(session, orderId, null, async (l, ctx, tx) => {
      const acc = this.account(l.order, accountId);
      const next = preBill(acc);
      const p = await this.ticketPrinter(tx, session, orderId);
      const ticket = preBillTicket(next, await this.ticketCtx(tx, session, l, ctx.now));
      return {
        next: this.replace(l.order, next),
        events: [
          this.ev(
            "preBill",
            `Precuenta de la ${acc.name}: ${accountTotals(acc).total.toFixed(2)} €`,
            ctx,
            acc.id,
          ),
        ],
        extra: { job: { p, title: `Precuenta mesa ${l.header.tableName}`, ticket } },
      };
    });
    const { p, title, ticket } = r.extra.job;
    const res = await this.printer
      .print({
        kind: "prebill",
        channel: p.channel,
        printer: p.name,
        connection: p.connection,
        title,
        ticket,
      })
      .catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res.ok) {
      fail(
        "PRINTER_OFFLINE",
        "La impresora de tickets no responde; la precuenta no se ha impreso (vuelve a pedirla)",
        {
          printer: p.name,
          error: res.error,
          printed: [{ channel: p.channel, printer: p.name, lines: 0, ok: false }],
        },
      );
    }
    return r.transaction;
  }

  async pay(
    session: Session,
    orderId: string,
    accountId: string,
    b: {
      id?: string;
      method: string;
      amount?: number | null;
      tip?: number;
      cashGiven?: number | null;
      authorization?: string | null;
    },
  ) {
    await this.auth.require(session, "cobro.cobrar", b.authorization);
    const r = await this.command<{ payment: { id: string; status: string; change: number | null } }>(
      session,
      orderId,
      null,
      async (l, ctx, tx) => {
        const pm = await this.paymentInput(tx, session, b);
        const acc = this.account(l.order, accountId);
        const c = b.id ? { ...ctx, newId: () => b.id! } : ctx;
        const res = registerPayment(acc, pm.input, c);
        return {
          next: this.replace(l.order, res.account),
          events: [
            this.ev("paymentAdded", `Cobro ${pm.name} ${res.payment.amount.toFixed(2)} €`, ctx, acc.id),
          ],
          extra: { payment: { id: res.payment.id, status: res.payment.status, change: res.payment.change } },
          clearCharging: res.settled,
        };
      },
    );
    const acc = r.order.accounts.find((a) => a.id === accountId)!;
    const T = accountTotals(acc);
    return { payment: r.extra.payment, totals: { total: T.total, paid: T.paid, pending: T.pending } };
  }

  /**
   * Forma de pago de Ajustes (cualquier código: glovo, efectivo2…), permitida en esta estación (regla en @japp/domain),
   * con su tipo (paymentKind) y la propina solo si la admite. Devuelve la entrada de registerPayment y el nombre para el evento.
   */
  private async paymentInput(
    tx: Tx,
    session: Session,
    b: { method: string; amount?: number | null; tip?: number; cashGiven?: number | null },
  ): Promise<{ input: PaymentInput; name: string }> {
    const row = await this.carta.paymentMethod(tx, session.storeId, b.method);
    const allowed = await this.carta.stationPaymentMethodIds(tx, session.storeId, session.station.id);
    const m = assertMethodAllowed(
      row ? { id: row.id, code: row.code, kind: row.kind, active: row.active } : null,
      { name: session.station.name, kind: session.station.kind, methodIds: allowed },
      b.method,
    );
    const kind = paymentKind(m.kind, m.code);
    if ((b.tip ?? 0) > 0 && !row!.allowsTip) {
      fail("VALIDATION", "Esta forma de pago no admite propina", { field: "tip" });
    }
    return {
      input: {
        method: m.code,
        methodId: m.id,
        kind,
        amount: b.amount ?? null,
        tip: b.tip,
        cashGiven: b.cashGiven,
      },
      name: row!.name,
    };
  }

  /**
   * Factura: número reservado con SELECT … FOR UPDATE en invoice_series dentro de la misma transacción,
   * factura + desglose de IVA + registro VeriFactu encadenado al anterior de la tienda.
   */
  async invoice(
    session: Session,
    orderId: string,
    accountId: string,
    b: { authorization?: string | null } = {},
  ) {
    await this.auth.require(session, "cobro.cobrar", b.authorization);
    const store = await this.stores.store();
    const r = await this.command<{ invoice: NonNullable<Account["invoice"]> }>(
      session,
      orderId,
      null,
      async (l, ctx0, tx) => {
        const acc = this.openAccount(l.order, accountId);
        const { made, inv, ctx } = await this.emitInvoice(
          tx,
          session,
          store,
          l,
          acc,
          ctx0,
          (seq, cfg, c) => ({
            account: issueInvoice(acc, seq, cfg, c),
          }),
        );
        return {
          next: this.replace(l.order, made.account),
          events: [this.invoiceEvent(inv, ctx, acc.id)],
          extra: { invoice: inv },
          clearCharging: true,
        };
      },
    );
    const tableClosed = r.order.accounts.every((a) => a.status === "invoiced");
    const printed = await this.printInvoice(session, orderId, accountId).catch(() => false);
    const { taxes: _t, customer: _c, ...invoice } = r.extra.invoice;
    return { invoice, tableClosed, printed };
  }

  /** La cuenta a facturar: tiene que existir y seguir abierta (si no, ACCOUNT_CLOSED). */
  private openAccount(order: Order, accountId: string): Account {
    const acc = this.account(order, accountId);
    if (acc.status !== "open") {
      fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId });
    }
    return acc;
  }

  private invoiceEvent(inv: NonNullable<Account["invoice"]>, ctx: Ctx, accountId: string): OrderEvent {
    return this.ev(
      "invoiceIssued",
      `Factura ${inv.type} ${inv.invoiceNumber} · ${inv.total.toFixed(2)} €`,
      ctx,
      accountId,
    );
  }

  /**
   * Emite la factura de una cuenta dentro de la transacción del comando: número reservado con SELECT … FOR UPDATE en
   * invoice_series, factura + desglose de IVA + registro VeriFactu encadenado al anterior de la tienda.
   * `make` decide la cuenta facturada con el número reservado (issueInvoice, o checkout con sus pagos).
   * Devuelve lo que decidió `make`, la factura y el contexto con la hora tomada después del bloqueo.
   */
  private async emitInvoice<R extends { account: Account }>(
    tx: Tx,
    session: Session,
    store: Awaited<ReturnType<StoreApplication["store"]>>,
    l: Loaded,
    acc: Account,
    ctx0: Ctx,
    make: (seq: number, cfg: { serieF: string; serieT: string; nif: string }, ctx: Ctx) => R,
  ) {
    // cadena VeriFactu: una factura de la tienda cada vez (las series F y T comparten cadena).
    // La hora se toma DESPUÉS de tener el bloqueo: así la cadena va en orden de tiempo.
    await this.repo.lockInvoiceChain(tx, session.storeId);
    const now = this.clock();
    const ctx: Ctx = { ...ctx0, now, actor: session.actor(now) };
    const series = acc.customerData ? store.serieF : store.serieT;
    const row = await this.repo.lockSeries(tx, session.storeId, series);
    if (!row) {
      fail("NOT_FOUND", `No existe la serie ${series}`, { series });
    }
    const made = make(
      row!.lastSequence + 1,
      { serieF: store.serieF, serieT: store.serieT, nif: store.nif },
      ctx,
    );
    const inv = made.account.invoice!;
    await this.repo.setSeriesSequence(tx, session.storeId, series, inv.sequence);
    const id = crypto.randomUUID();
    const base = r2(sum(inv.taxes.map((t) => t.base)));
    const tax = r2(sum(inv.taxes.map((t) => t.tax)));
    await this.repo.insertInvoice(tx, {
      id,
      storeId: session.storeId,
      accountId: acc.id,
      orderId: l.order.id,
      inv,
      issuer: { nif: store.nif, name: store.issuerName },
      taxBase: base.toFixed(2),
      taxTotal: tax.toFixed(2),
      actor: ctx.actor,
    });
    await this.repo.insertInvoiceTaxes(tx, session.storeId, id, inv.taxes);
    // registro anterior = el último de la cadena (el que aún no tiene sucesor); la base garantiza uno solo (uq_verifactu_previous / uq_verifactu_genesis)
    const prev = await this.repo.verifactuTail(tx, session.storeId);
    const hash = verifactuHash({
      nif: store.nif,
      invoiceNumber: inv.invoiceNumber,
      issuedAt: inv.issuedAt,
      type: inv.type,
      taxTotal: tax.toFixed(2),
      total: inv.total.toFixed(2),
      previousHash: prev?.hash ?? "",
      generatedAt: ctx.actor.at,
    });
    await this.repo.insertVerifactuRecord(tx, {
      storeId: session.storeId,
      invoiceId: id,
      issuerTaxId: store.nif,
      inv,
      taxTotal: tax.toFixed(2),
      previous: prev,
      hash,
      generatedAt: ctx.actor.at,
    });
    return { made, inv, ctx };
  }

  /**
   * «Cobrar y facturar» en una sola transacción (regla checkout() en @japp/domain): cada pago con las reglas de
   * POST …/payments y la factura con las de POST …/invoice (mismo bloqueo de la cadena, misma serie). Todo o nada:
   * si los pagos no dejan lo pendiente a 0 → 409 PENDING_NOT_ZERO y no queda ningún pago (se deshace la transacción).
   * Si era la última cuenta, la mesa se cierra (save() la deja closed). Imprime DESPUÉS del COMMIT si print.
   */
  async checkout(
    session: Session,
    orderId: string,
    accountId: string,
    b: {
      payments: { method: string; amount?: number | null; tip?: number; cashGiven?: number | null }[];
      print?: boolean;
      version?: number | null;
      authorization?: string | null;
    },
  ) {
    await this.auth.require(session, "cobro.cobrar", b.authorization);
    const store = await this.stores.store();
    const r = await this.command<{
      invoice: NonNullable<Account["invoice"]>;
      payments: Payment[];
      change: number;
    }>(session, orderId, b.version, async (l, ctx0, tx) => {
      const acc = this.openAccount(l.order, accountId);
      const inputs: { input: PaymentInput; name: string }[] = [];
      for (const [i, p] of b.payments.entries()) {
        inputs.push(await this.atRow(i, () => this.paymentInput(tx, session, p)));
      }
      const {
        made: done,
        inv,
        ctx,
      } = await this.emitInvoice(tx, session, store, l, acc, ctx0, (seq, cfg, c) =>
        checkout(
          acc,
          inputs.map((x) => x.input),
          seq,
          cfg,
          c,
        ),
      );
      const events = done.payments.map((p, i) =>
        this.ev("paymentAdded", `Cobro ${inputs[i]!.name} ${p.amount.toFixed(2)} €`, ctx, acc.id),
      );
      events.push(this.invoiceEvent(inv, ctx, acc.id));
      return {
        next: this.replace(l.order, done.account),
        events,
        extra: { invoice: inv, payments: done.payments, change: done.change },
        clearCharging: true,
      };
    });
    const tableClosed = r.order.accounts.every((a) => a.status === "invoiced");
    let printed = false;
    if (b.print !== false) {
      printed = await this.printInvoice(session, orderId, accountId).catch(() => false);
    }
    const { taxes: _t, customer: _c, ...invoice } = r.extra.invoice;
    return {
      invoice,
      payments: r.extra.payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        tip: p.tip,
        cashGiven: p.cashGiven,
        change: p.change,
      })),
      change: r.extra.change,
      tableClosed,
      printed,
    };
  }

  /** Un error de la fila i de una lista de pagos lleva el campo de esa fila (method → payments[1].method), como checkout(). */
  private async atRow<T>(i: number, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof DomainError)) {
        throw e;
      }
      const field =
        typeof e.details.field === "string" ? `payments[${i}].${e.details.field}` : `payments[${i}]`;
      throw new DomainError(e.code, e.message, { ...e.details, field });
    }
  }

  /**
   * Impresora de tickets (precuenta y factura): la del canal de tickets del ÁREA de la mesa, sea cual sea el equipo
   * (terraza → impresora de terraza). Si el área no tiene canal: impresora de tipo «ticket» y, si no, la primera de la estación.
   */
  async ticketPrinter(tx: Tx, session: Session, orderId?: string): Promise<TicketPrinter> {
    if (orderId) {
      const r = await this.printers.areaTicketPrinter(tx, session.storeId, orderId);
      if (r) {
        return r;
      }
    }
    const t = await this.printers.firstTicketPrinter(tx, session.storeId);
    if (t) {
      return { ...t, channel: "TICKET" };
    }
    const f = await this.printers.firstStationPrinter(tx, session.storeId, session.station.id);
    return { ...(f ?? { name: "TICKET", connection: "" }), channel: "TICKET" };
  }

  async ticketCtx(tx: Tx, session: Session, l: Loaded, at: Date): Promise<TicketContext> {
    const st = await this.stores.store();
    const paymentNames = await this.carta.paymentMethodNames(tx, session.storeId);
    return {
      store: {
        legalName: st.issuerName,
        tradeName: st.name,
        taxId: st.nif,
        address: st.address ?? undefined,
        city: st.city ?? undefined,
        phone: st.phone ?? undefined,
        header: st.ticketHeader ?? undefined,
        footer: st.ticketFooter ?? undefined,
      },
      table: { name: l.header.tableName, area: l.header.zone ?? "" },
      waiter: l.header.openedBy.user,
      guests: l.order.guests,
      at,
      paymentNames,
    };
  }

  /** Imprime (o reimprime) la factura de una cuenta en la impresora de tickets; abre el cajón si hubo efectivo. */
  async printInvoice(session: Session, orderId: string, accountId: string): Promise<boolean> {
    return this.database.withTx(async (tx) => {
      const l = await this.repo.load(tx, session.storeId, orderId);
      const acc = l.order.accounts.find((a) => a.id === accountId);
      if (!acc?.invoice) {
        return false;
      }
      const p = await this.ticketPrinter(tx, session, orderId);
      const cash = acc.payments.some((x) => x.status === "confirmed" && x.kind === "cash");
      const opens = await this.printers.stationOpensDrawer(tx, session.storeId, session.station.id);
      const res = await this.printer.print({
        kind: "invoice",
        channel: p.channel,
        printer: p.name,
        connection: p.connection,
        title: acc.invoice.invoiceNumber,
        ticket: invoiceTicket(acc, await this.ticketCtx(tx, session, l, new Date(acc.invoice.issuedAt))),
        openDrawer: cash && opens,
      });
      return res.ok;
    });
  }

  /** Descuento configurado (Ajustes › Descuentos, por id) o manual (tipo, valor y motivo). */
  async addDiscount(
    session: Session,
    orderId: string,
    accountId: string,
    b: {
      discountId?: string | null;
      type?: "percentage" | "fixed";
      value?: number;
      reason?: string | null;
      authorization?: string | null;
    },
  ) {
    if (session.origin === "pda") {
      fail("NOT_ALLOWED", "La PDA no aplica descuentos", { permission: "cobro.descuentos" });
    }
    let needsAuth = false;
    return (
      await this.command(session, orderId, null, async (l, ctx, tx) => {
        let d: { type: "percentage" | "fixed"; value: number; reason: string };
        if (b.discountId) {
          const row = await this.carta.activeDiscount(tx, session.storeId, b.discountId);
          if (!row) {
            fail("NOT_FOUND", "Ese descuento no existe", { discountId: b.discountId });
          }
          d = { type: "percentage", value: Number(row!.percent), reason: row!.name };
          needsAuth = row!.needsAuthorization;
        } else {
          if (!b.type || b.value == null) {
            fail("VALIDATION", "Indica discountId, o tipo y valor", { field: "discountId" });
          }
          d = { type: b.type!, value: b.value!, reason: b.reason ?? "" };
          needsAuth = true;
        }
        if (needsAuth || !session.can("cobro.descuentos")) {
          await this.auth.require(session, "cobro.descuentos", b.authorization, ctx.now);
        }
        const acc = this.account(l.order, accountId);
        const next = applyDiscount(acc, d!, ctx);
        return {
          next: this.replace(l.order, next),
          events: [
            this.ev(
              "discountApplied",
              `Descuento ${d!.type === "percentage" ? d!.value + " %" : d!.value.toFixed(2) + " €"} · ${d!.reason}`,
              ctx,
              acc.id,
            ),
          ],
        };
      })
    ).transaction;
  }

  async removeDiscount(
    session: Session,
    orderId: string,
    accountId: string,
    discountId: string,
    b: { authorization?: string | null } = {},
  ) {
    await this.auth.require(session, "cobro.descuentos", b.authorization);
    return (
      await this.command(session, orderId, null, (l, ctx) => {
        const acc = this.account(l.order, accountId);
        const next = removeDiscount(acc, discountId);
        return {
          next: this.replace(l.order, next),
          events: [this.ev("discountRemoved", "Se quita el descuento", ctx, acc.id)],
        };
      })
    ).transaction;
  }

  /** Datos fiscales del cliente (factura F1). Con saveToFile se guardan en el fichero de clientes. */
  async setCustomer(
    session: Session,
    orderId: string,
    accountId: string,
    b: {
      type: "person" | "company";
      taxId: string;
      name: string;
      email?: string | null;
      address?: {
        street?: string;
        postalCode?: string;
        city?: string;
        province?: string;
        country?: string;
      } | null;
      saveToFile?: boolean;
    },
  ) {
    await this.auth.require(session, "cobro.clientes");
    return (
      await this.command(session, orderId, null, async (l, ctx, tx) => {
        const acc = this.account(l.order, accountId);
        let next = setCustomer(acc, {
          type: b.type,
          taxId: b.taxId,
          name: b.name,
          email: b.email ?? undefined,
          ...(b.address ?? {}),
        });
        const c = next.customerData!;
        const row = {
          storeId: session.storeId,
          type: b.type,
          taxId: c.taxId,
          name: c.name,
          email: c.email ?? null,
          street: c.street ?? null,
          postalCode: c.postalCode ?? null,
          city: c.city ?? null,
          province: c.province ?? null,
          country: c.country ?? "ES",
        };
        const savedId = await this.repo.upsertCustomer(tx, row, b.saveToFile !== false);
        next = { ...next, customerData: { ...c, id: savedId } };
        return {
          next: this.replace(l.order, next),
          events: [this.ev("customerSet", `Factura a nombre de ${c.name} (${c.taxId})`, ctx, acc.id)],
        };
      })
    ).transaction;
  }

  async removeAccount(session: Session, orderId: string, accountId: string) {
    await this.auth.require(session, "pedido.cuentas");
    return (
      await this.command(session, orderId, null, (l, ctx) => {
        const name = l.order.accounts.find((a) => a.id === accountId)?.name ?? "";
        return {
          next: removeEmptyAccount(l.order, accountId),
          events: [this.ev("accountRemoved", `Se quita la ${name}`, ctx)],
        };
      })
    ).transaction;
  }

  /** Renombrar una cuenta (regla renameAccount en @japp/domain: 1–40, sin repetir en la mesa, nunca una facturada). */
  async renameAccount(
    session: Session,
    orderId: string,
    accountId: string,
    b: { name: string; version?: number | null },
  ) {
    await this.auth.require(session, "pedido.cuentas");
    return (
      await this.command(session, orderId, b.version, (l, ctx) => {
        const before = this.account(l.order, accountId).name;
        const next = renameAccount(l.order, accountId, b.name);
        const after = next.accounts.find((a) => a.id === accountId)!.name;
        if (after === before) {
          return { next, events: [], noop: true };
        }
        return {
          next,
          events: [this.ev("accountRenamed", `${before} pasa a llamarse ${after}`, ctx, accountId)],
        };
      })
    ).transaction;
  }

  /**
   * Reabrir mesa (regla planReopen en @japp/domain): una orden cerrada o cerrada sin venta del periodo abierto vuelve a open
   * en su misma mesa, si está libre. Las cuentas anuladas sin factura vuelven a open; las facturadas no se tocan.
   * Bloqueos en el orden de abrir mesa: primero la mesa (FOR UPDATE de dining_table) y luego la orden.
   */
  async reopen(session: Session, orderId: string, b: { authorization?: string | null }) {
    await this.auth.require(session, "cobro.reabrir", b.authorization);
    const ctx = this.ctx(session);
    const S = session.storeId;
    return this.database.withTx(async (tx) => {
      const period = await this.periods.current(tx, S);
      const head = await this.repo.load(tx, S, orderId);
      if (head.header.tableId) {
        await this.tables.lockWithArea(tx, S, head.header.tableId);
      }
      const l = await this.repo.load(tx, S, orderId, { lock: true });
      const accounts = await this.repo.accountStates(tx, S, orderId);
      const plan = planReopen(
        { id: l.header.id, status: l.header.status, periodId: l.header.periodId },
        accounts,
        period?.id ?? null,
      );
      const busy = await this.repo.liveOnTable(tx, S, {
        tableId: l.header.tableId,
        tableName: l.header.tableName,
      });
      if (busy.length) {
        fail("TABLE_BUSY", "La mesa está ocupada: no se puede reabrir", { orderId: busy[0]!.id });
      }
      await this.repo.reopenAccounts(tx, S, orderId, plan.reopen);
      await this.repo.markReopened(tx, S, orderId);
      // se vuelve a cargar con las cuentas ya abiertas; save() sube la versión, deja el evento y la manda a la cola
      const re = await this.repo.load(tx, S, orderId, { lock: true });
      const header: OrderHeader = { ...re.header, status: "open" };
      const v = await this.repo.save(tx, S, re.order, re.order, header, {
        actor: ctx.actor,
        events: [this.ev("tableReopened", "Mesa reabierta", ctx)],
      });
      const after = await this.repo.load(tx, S, orderId);
      return this.repo.transaction(tx, { ...after.header, version: v }, after.order);
    });
  }

  /**
   * Cerrar la mesa sin venta: solo si no le queda nada vivo (sin productos ni cobros en las cuentas sin facturar).
   * Es la salida de una cuenta a 0,00 €: se eliminan sus líneas con motivo (p. ej. Invitación) y se cierra aquí.
   * Las cuentas sin facturar se anulan (nunca se borran); la mesa queda libre.
   */
  async close(session: Session, orderId: string, b: { version?: number | null }) {
    await this.auth.require(session, "mesas.abrirMesa");
    return (
      await this.command(session, orderId, b.version, (l, ctx) => {
        assertNothingLive(l.order);
        return {
          next: this.closeEmpty(l, l.order),
          events: [this.ev("tableClosed", "Se cierra la mesa sin venta", ctx)],
        };
      })
    ).transaction;
  }

  /**
   * Cierre sin venta de una mesa sin nada vivo: las cuentas sin facturar se anulan (desaparecen de la orden y save() las
   * marca cancelled, nunca se borran). Sin ninguna facturada la orden queda cancelled; con alguna, save() la deja closed.
   */
  private closeEmpty(l: Loaded, order: Order): Order {
    const invoiced = order.accounts.filter((a) => a.status === "invoiced");
    if (!invoiced.length) {
      l.header.status = "cancelled";
    }
    return { ...order, accounts: invoiced };
  }

  /** Ordenar lo «Por enviar» de una cuenta: lo que sale primero en la comanda. */
  async reorderLines(
    session: Session,
    orderId: string,
    b: { accountId?: string | null; lineIds: string[]; version?: number | null },
  ) {
    return (
      await this.command(session, orderId, b.version, (l, ctx) => {
        const acc = this.account(l.order, b.accountId);
        const next = reorderPending(acc, b.lineIds);
        const names = next.lines
          .filter((x) => x.status === "pendingPrint")
          .map((x) => x.name)
          .join(", ");
        return {
          next: this.replace(l.order, next),
          events: [this.ev("linesReordered", `Nuevo orden de lo por enviar: ${names}`, ctx, acc.id)],
        };
      })
    ).transaction;
  }

  /**
   * Transferir la mesa entera (la cuenta suelta se pasa con «Separar cuenta»). Los precios ya marcados se mantienen.
   * - Mesa de destino libre: la orden cambia de mesa, como siempre.
   * - Mesa de destino ocupada (decidido tras las pruebas en tienda, 23/10/2026): se juntan → mergeTables.
   * La mesa de destino se bloquea ANTES que la orden, como en transferAccount y reopen (y al abrir mesa): con el orden
   * al revés, dos cambios de mesa cruzados (A → B y B → A) se esperarían el uno al otro.
   */
  async transfer(
    session: Session,
    orderId: string,
    b: { toTableId: string; accountId?: string | null; version?: number; authorization?: string | null },
  ) {
    await this.auth.require(session, "mesas.transferir", b.authorization);
    if (b.accountId) {
      fail(
        "VALIDATION",
        "Para pasar una sola cuenta usa «Separar cuenta»; aquí se transfiere la mesa entera",
        { field: "accountId" },
      );
    }
    const ctx = this.ctx(session);
    return this.database.withTx(async (tx) => {
      const t = await this.tables.lockWithArea(tx, session.storeId, b.toTableId);
      const [busy] = t ? await this.repo.liveOnTable(tx, session.storeId, { tableId: b.toTableId }) : [];
      if (busy && busy.id !== orderId) {
        return this.mergeTables(tx, session, ctx, orderId, busy.id, b);
      }
      const r = await this.commandIn(
        tx,
        session,
        orderId,
        b.version,
        async (l, c, q) => {
          if (!l.order.accounts.some((a) => a.status !== "invoiced" && a.lines.length)) {
            fail("VALIDATION", "La mesa no tiene productos: no hay nada que transferir", {
              field: "orderId",
            });
          }
          if (!t) {
            fail("NOT_FOUND", "La mesa de destino no existe", { tableId: b.toTableId });
          }
          // la propia orden ya está en esa mesa
          if (busy) {
            fail("TABLE_BUSY", "La mesa de destino está ocupada", { orderId: busy.id });
          }
          const from = l.header.tableName;
          const dest = {
            tableId: t!.t.id,
            tableName: String(t!.t.number),
            zone: t!.a.name,
            priceList: t!.a.priceList,
          };
          await this.repo.moveToTable(q, session.storeId, orderId, dest);
          // el QR de Order on Table era de la mesa vieja: se anula en la misma transacción (el camarero saca otro)
          await this.oot.revoke(q, session.storeId, orderId, "transferred");
          Object.assign(l.header, dest);
          return {
            next: { ...l.order, tableId: t!.t.id },
            events: [this.ev("tableTransferred", `Mesa ${from} → ${t!.t.number}`, c)],
          };
        },
        ctx,
      );
      return r.transaction;
    });
  }

  /**
   * Juntar mesas (regla mergeOrders en @japp/domain): cada cuenta viva del origen pasa entera a la orden de la mesa
   * de destino, como transferAccount (líneas con su historia, descuentos, cobros parciales, cliente y pases, con sus
   * precios; nombres repetidos → siguiente «Cuenta N» del destino). Se suman los comensales y se une la nota.
   * El origen queda cancelled (closed si tenía facturadas), su mesa libre y su QR de Order on Table anulado ('transferred').
   * Mismos bloqueos que transferAccount: la mesa de destino (ya bloqueada por transfer) y luego las dos órdenes por id.
   * Responde la transacción de destino.
   */
  private async mergeTables(
    tx: Tx,
    session: Session,
    ctx: Ctx,
    orderId: string,
    destId: string,
    b: { version?: number },
  ) {
    const S = session.storeId;
    const me = {
      userId: session.user.id,
      userName: session.user.name,
      stationId: session.station.id,
      stationName: session.station.name,
      canTakeOver: session.can("mesas.entrarOcupada"),
    };
    // las dos órdenes, bloqueadas siempre en el mismo orden (por id)
    await this.repo.lockByIds(tx, S, [orderId, destId]);
    const src = await this.repo.load(tx, S, orderId, { lock: true });
    if (src.header.status === "closed" || src.header.status === "cancelled") {
      fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
    }
    if (b.version != null) {
      assertVersion(src.header.version, b.version);
    }
    assertCanCommand(src.header.presence, me, "other", ctx.now);
    const dst = await this.repo.load(tx, S, destId, { lock: true });
    // cobro abierto → TABLE_CHARGING; otra persona dentro → TABLE_TAKEN (salvo mesas.entrarOcupada)
    canEnterTable(dst.header.presence, me, ctx.now);
    const names = await this.repo.accountNames(tx, S, destId);
    const r = mergeOrders(src.order, dst.order, {
      knownNames: names,
      fromNote: src.header.note,
      toNote: dst.header.note,
    });
    // cada cuenta y TODAS sus líneas (también las eliminadas) cambian de orden; cobros, descuentos y respuestas cuelgan de ellas
    for (const m of r.moved) {
      await this.repo.moveAccount(tx, S, m.account.id, orderId, destId, m.account.name);
    }
    // el QR de la mesa vieja deja de pedir en ella (antes de save(), que lo anularía como 'closed')
    await this.oot.revoke(tx, S, orderId, "transferred");
    const movedIds = new Set(r.moved.map((m) => m.account.id));
    // las cuentas que se van ya no son del origen: save() no las anula; las vivas vacías sí (desaparecen de la orden)
    const srcBefore: Order = {
      ...src.order,
      accounts: src.order.accounts.filter((a) => !movedIds.has(a.id)),
    };
    if (r.sourceStatus === "cancelled") {
      src.header.status = "cancelled";
    }
    const srcName = src.header.tableName;
    const dstName = dst.header.tableName;
    const list = r.moved.map((m) => m.account.name).join(", ");
    await this.repo.save(tx, S, srcBefore, r.from, src.header, {
      actor: ctx.actor,
      events: [this.ev("tablesMerged", `La mesa ${srcName} se junta con la mesa ${dstName} (${list})`, ctx)],
    });
    await this.repo.savePresence(tx, S, orderId, { holder: null, chargingUntil: null });
    const renamed = r.moved
      .filter((m) => m.renamedFrom)
      .map((m) => `${m.renamedFrom} ahora ${m.account.name}`)
      .join(", ");
    dst.header.note = r.note;
    const vTo = await this.repo.save(tx, S, r.to, r.to, dst.header, {
      actor: ctx.actor,
      events: [
        this.ev(
          "tablesMerged",
          `Se junta la mesa ${srcName}: ${list}${renamed ? ` (${renamed})` : ""} · ${r.to.guests} comensales`,
          ctx,
        ),
      ],
    });
    const d = await this.repo.load(tx, S, destId);
    return this.repo.transaction(tx, { ...d.header, version: vTo }, d.order);
  }

  /**
   * «Cambiar de mesa» unificado (POST /orders/{id}/transfer): scope = table (por defecto) transfiere la mesa entera como
   * siempre; scope = account pasa la cuenta accountId como POST …/accounts/{accountId}/transfer y responde solo la
   * transacción de destino (la de origen, el equipo la vuelve a pedir).
   */
  async changeTable(
    session: Session,
    orderId: string,
    b: {
      scope: "table" | "account";
      accountId?: string | null;
      toTableId: string;
      version?: number;
      authorization?: string | null;
    },
  ) {
    if (b.scope === "table") {
      return this.transfer(session, orderId, b);
    }
    if (!b.accountId) {
      fail("VALIDATION", "Indica la cuenta que pasa a la otra mesa", { field: "accountId" });
    }
    if (b.version == null) {
      fail("VALIDATION", "Falta la versión de la orden de origen", { field: "version" });
    }
    const r = await this.transferAccount(session, orderId, b.accountId!, {
      toTableId: b.toTableId,
      version: b.version!,
      authorization: b.authorization,
    });
    return r.to;
  }

  /**
   * Pasar UNA cuenta a otra mesa (regla en @japp/domain → transferAccount). Va entera (líneas con su historia, descuentos,
   * cobros parciales, cliente y pases) y con sus precios. Mesa libre → se abre con la cuenta; ocupada → una cuenta más.
   * Bloqueos en orden fijo: la mesa de destino y luego las dos órdenes por id (sin interbloqueos con otros comandos).
   */
  async transferAccount(
    session: Session,
    orderId: string,
    accountId: string,
    b: { toTableId: string; version: number; authorization?: string | null },
  ) {
    await this.auth.require(session, "mesas.transferir", b.authorization);
    const ctx = this.ctx(session);
    const S = session.storeId;
    const me = {
      userId: session.user.id,
      userName: session.user.name,
      stationId: session.station.id,
      stationName: session.station.name,
      canTakeOver: session.can("mesas.entrarOcupada"),
    };
    return this.database.withTx(async (tx) => {
      const period = await this.periods.current(tx, S);
      if (!period) {
        fail("PERIOD_CLOSED", "No hay periodo abierto");
      }
      const t = await this.tables.lockWithArea(tx, S, b.toTableId);
      if (!t) {
        fail("NOT_FOUND", "La mesa de destino no existe", { tableId: b.toTableId });
      }
      const [busy] = await this.repo.liveOnTable(tx, S, { tableId: b.toTableId });
      // las dos órdenes, bloqueadas siempre en el mismo orden (por id)
      await this.repo.lockByIds(tx, S, [orderId, ...(busy ? [busy.id] : [])]);
      const src = await this.repo.load(tx, S, orderId, { lock: true });
      if (src.header.status === "closed" || src.header.status === "cancelled") {
        fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
      }
      assertVersion(src.header.version, b.version);
      assertCanCommand(src.header.presence, me, "other", ctx.now);
      if (busy?.id === orderId || src.header.tableId === b.toTableId) {
        fail("VALIDATION", "La cuenta ya está en esa mesa", { field: "toTableId" });
      }
      const toName = String(t!.t.number);
      let dst: Loaded;
      if (busy) {
        dst = await this.repo.load(tx, S, busy.id, { lock: true });
        canEnterTable(dst.header.presence, me, ctx.now); // cobro abierto → TABLE_CHARGING; otra persona dentro → TABLE_TAKEN (salvo mesas.entrarOcupada)
      } else {
        const header: OrderHeader = {
          id: crypto.randomUUID(),
          storeId: S,
          periodId: period!.id,
          status: "open",
          version: 1,
          tableId: t!.t.id,
          tableName: toName,
          zone: t!.a.name,
          priceList: t!.a.priceList === "terrace" ? "terrace" : "general",
          guests: 1,
          note: null,
          openedBy: ctx.actor,
          lastEntry: ctx.actor,
          presence: { holder: null, chargingUntil: null },
        };
        await this.repo.insertHeader(tx, header);
        dst = {
          header,
          order: { id: header.id, tableId: header.tableId!, guests: 1, version: 1, accounts: [] },
          meta: new Map(),
        };
      }
      // nombre repetido en el destino → siguiente «Cuenta N» de allí, sin reutilizar los de sus cuentas anuladas
      const names = busy ? await this.repo.accountNames(tx, S, busy.id) : [];
      const r = transferAccount(src.order, accountId, dst.order, names);
      const name = r.account.name;
      const oldName = r.renamedFrom ?? name;
      // la cuenta y TODAS sus líneas (también las eliminadas) cambian de orden; cobros, descuentos y respuestas cuelgan de ellas
      await this.repo.moveAccount(tx, S, accountId, orderId, dst.header.id, name);
      // origen: sin la cuenta (ya no es suya); si no le queda ninguna viva se cierra como «cerrar mesa sin venta»
      if (!r.sourceLive && !r.from.accounts.some((a) => a.status === "invoiced")) {
        src.header.status = "cancelled";
      }
      const vFrom = await this.repo.save(tx, S, r.from, r.from, src.header, {
        actor: ctx.actor,
        events: [this.ev("accountTransferred", `${oldName} pasa a la mesa ${toName}`, ctx)],
      });
      if (!r.sourceLive) {
        await this.repo.savePresence(tx, S, orderId, { holder: null, chargingUntil: null });
      }
      const vTo = await this.repo.save(tx, S, r.to, r.to, dst.header, {
        actor: ctx.actor,
        events: [
          this.ev(
            "accountArrived",
            `Llega ${oldName} desde la mesa ${src.header.tableName}${r.renamedFrom ? ` (ahora ${name})` : ""}`,
            ctx,
            accountId,
          ),
        ],
      });
      const a = await this.repo.load(tx, S, orderId);
      const d = await this.repo.load(tx, S, dst.header.id);
      return {
        from: await this.repo.transaction(tx, { ...a.header, version: vFrom }, a.order),
        to: await this.repo.transaction(tx, { ...d.header, version: vTo }, d.order),
      };
    });
  }

  async events(session: Session, orderId: string) {
    await this.auth.require(session, "pedido.historial");
    const rows = await this.repo.events(session.storeId, orderId);
    return {
      items: rows.map((e) => ({
        type: e.type,
        at: new Date(e.at).toISOString(),
        description: e.description,
        user: e.userName ?? "",
        device: e.device ?? "",
        role: e.role ?? "",
      })),
    };
  }

  // ── Order on Table (bloque nuevo): añadir y enviar como otro actor ─────────────────────────────

  /**
   * Añade varias líneas a la cuenta `accountName` de la orden (se crea si no existe) y las envía en el mismo comando,
   * como si `caller` hiciera POST …/lines y POST …/send de esa cuenta (lo usa Order on Table con el actor «cliente»).
   * - Sin version: el servidor serializa con el FOR UPDATE de la orden. Es un comando «save»: que otra persona tenga la mesa no lo bloquea.
   * - Sin DUPLICATE_SUSPECTED (force): el cliente no se confunde con otro camarero.
   * - `check` corre dentro de la transacción, con la orden ya bloqueada y antes de tocar nada: si devuelve algo
   *   (un pedido ya hecho), no se cambia nada y se devuelve eso. `record` corre tras guardar, en la misma transacción.
   * - Imprime DESPUÉS del COMMIT; si una impresora falla no lanza 503: lo dice printed (lo que no salió queda pendiente).
   */
  async addAndSendAs<R>(
    caller: Session,
    orderId: string,
    b: {
      accountName: string;
      items: {
        plu: number;
        quantity: number;
        comment?: string | null;
        modifiers?: { questionId?: string | null; plu: number; quantity?: number }[];
      }[];
    },
    hooks: {
      check?: (tx: Tx, l: Loaded) => Promise<R | undefined>;
      record?: (tx: Tx, out: { accountId: string; accepted: number; version: number }) => Promise<void>;
    } = {},
  ): Promise<{ replay: R } | { accountId: string; accepted: number; version: number; printed: Printed[] }> {
    const r = await this.command<{ replay?: R; accountId: string; accepted: number; jobs: KitchenJob[] }>(
      caller,
      orderId,
      null,
      async (l, ctx, tx) => {
        const replay = await hooks.check?.(tx, l);
        if (replay !== undefined) {
          return {
            next: l.order,
            events: [],
            noop: true,
            extra: { replay, accountId: "", accepted: 0, jobs: [] },
          };
        }
        const events: OrderEvent[] = [];
        let order = l.order;
        let acc = order.accounts.find((a) => a.status === "open" && a.name === b.accountName);
        if (!acc) {
          acc = {
            id: ctx.newId(),
            name: b.accountName,
            status: "open",
            lines: [],
            deletedLines: [],
            discounts: [],
            payments: [],
            customerData: null,
            invoice: null,
          };
          order = { ...order, accounts: [...order.accounts, acc] };
          events.push(this.ev("accountOpened", `Se abre la ${b.accountName}`, ctx, acc.id));
        }
        let accepted = 0;
        for (const it of b.items) {
          const { product, modifiers, courses } = await this.lineInput(tx, caller.storeId, it);
          acc = addProduct(
            acc,
            {
              product,
              area: { id: "", name: l.header.zone ?? "", priceList: l.header.priceList },
              quantity: it.quantity,
              modifiers,
              courses,
              comment: it.comment ?? "",
              force: true,
              dupWindowMin: 0,
            },
            ctx,
          );
          accepted += it.quantity;
          events.push(this.ev("lineAdded", `Se añade ${product.name} x${it.quantity}`, ctx, acc.id));
        }
        // enviar = lo mismo que POST …/send de esta cuenta: lo nuevo sale, y lo que quedó pendiente de otra impresora se reintenta
        const sent = sendWithCourses(acc, { now: ctx.now });
        order = this.replace(order, sent.account);
        const retry = await this.pendingKitchenJobs(tx, caller, l, ctx);
        const plan = await this.planKitchen(tx, caller, l, ctx, sent.items);
        events.push(this.ev("linePrinted", `Se envían ${sent.sent.length} líneas`, ctx, acc.id));
        const accountId = acc.id;
        return {
          next: order,
          events,
          extra: { accountId, accepted, jobs: [...plan.jobs, ...retry] },
          afterSave: async (t: Tx) => {
            await plan.record(t);
            // save() deja la orden en version + 1
            await hooks.record?.(t, { accountId, accepted, version: l.header.version + 1 });
          },
        };
      },
      { kind: "save" },
    );
    if (r.extra.replay !== undefined) {
      return { replay: r.extra.replay };
    }
    const printed = await this.printKitchen(caller, r.extra.jobs).catch((e) => {
      if (e instanceof DomainError && e.code === "PRINTER_OFFLINE") {
        return e.details.printed as Printed[];
      }
      throw e;
    });
    return {
      accountId: r.extra.accountId,
      accepted: r.extra.accepted,
      version: r.transaction.version,
      printed,
    };
  }
}
