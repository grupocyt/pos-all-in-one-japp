import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import {
  assertDetailMatches,
  assertMainStation,
  cashDifference,
  cutTicket,
  fail,
  r2,
  type TicketLine,
} from "@japp/domain";
import { CLOCK, DATABASE, PRINTER, type Clock } from "../Constants/Injection.js";
import type { PrinterPort } from "../Clases/Printers.js";
import { OrdersService } from "./OrdersService.js";
import { ClosingsService } from "./ClosingsService.js";
import { PrintersApplication } from "../Applications/PrintersApplication.js";
import { ClosingsApplication } from "../Applications/ClosingsApplication.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { PeriodsApplication } from "../Applications/PeriodsApplication.js";
import { CashApplication } from "../Applications/CashApplication.js";
import type { CashCountInput, CashMovementInput, DrawerOpenInput } from "../Models/CashModels.js";

/** Caja del periodo abierto: resumen, movimientos (retiro, fondo, depósito), arqueo sin cierre, abrir cajón y corte X. */
@Injectable()
export class CashService {
  constructor(
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PeriodsApplication) private readonly periods: PeriodsApplication,
    @Inject(CashApplication) private readonly cash: CashApplication,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(PRINTER) private readonly printer: PrinterPort,
    @Inject(PrintersApplication) private readonly printers: PrintersApplication,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ClosingsService) private readonly closings: ClosingsService,
    @Inject(ClosingsApplication) private readonly closingsData: ClosingsApplication,
  ) {}

  async summary(session: Session) {
    // quien cierra el periodo (funciones.periodo, p. ej. el cajero) necesita lo esperado para comparar (pruebas 27/10/2026)
    await this.auth.requireAny(session, ["funciones.caja", "funciones.periodo"]);
    const store = await this.stores.store();
    const p = await this.periods.current(null, session.storeId);
    if (!p) {
      fail("PERIOD_CLOSED", "No hay periodo abierto");
    }
    const c = await this.periods.cashState(null, session.storeId, p!.id, store.cashFloat);
    return {
      float: c.opening,
      cashSales: c.cashSales,
      withdrawals: c.withdrawals,
      // 11/11 (D2) · ingresos a caja (abonos desde la caja fuerte), propinas en efectivo, datáfonos del local y el fondo
      // que se propone para mañana (el de hoy − retiros + ingresos)
      deposits: c.deposits,
      cashTips: c.cashTips,
      expectedCash: c.expected,
      cardSales: c.card,
      otherSales: c.other,
      totalSales: c.totalSales,
      tickets: c.tickets,
      cardTerminals: store.cardTerminals,
      nextFloat: r2(c.opening - c.withdrawals + c.deposits),
    };
  }

  /** Retiro (a caja fuerte / banco), fondo o depósito. El retiro necesita motivo. */
  async movement(se: Session, b: CashMovementInput) {
    const g = await this.auth.require(se, "funciones.caja", b.authorization);
    assertMainStation(se.station);
    const p = await this.periods.current(null, se.storeId);
    if (!p) {
      fail("PERIOD_CLOSED", "No hay periodo abierto");
    }
    let reasonId: string | null = null;
    let note = b.note ?? null;
    if (b.reasonId) {
      const r = await this.cash.findReason(se.storeId, b.reasonId);
      reasonId = r?.id ?? null;
      note = note ?? r?.name ?? b.reasonId;
    }
    if (b.kind === "withdrawal" && !note?.trim()) {
      fail("VALIDATION", "El retiro necesita motivo", { field: "reasonId" });
    }
    // 11/11 (D2) · ingreso (abono de la caja fuerte a la caja chica): suma a lo esperado y al fondo de mañana
    if (b.kind === "deposit" && !note?.trim()) {
      note = "Ingreso a caja";
    }
    const a = se.actor(this.clock());
    const id = crypto.randomUUID();
    await this.cash.insertMovement(
      null,
      {
        id,
        storeId: se.storeId,
        periodId: p!.id,
        stationId: se.station.id,
        kind: b.kind,
        amount: b.amount,
        reasonId,
        note,
        authorizedBy: g.authorizerActor?.user ?? null,
      },
      a,
    );
    return { id };
  }

  /**
   * Arqueo sin cierre (Gestiones › Arqueo de caja): lo contado frente a lo esperado ahora mismo
   * (fondo + efectivo cobrado − retiros + ingresos, la misma cuenta que el cierre). Queda como cash_movement «count» con el detalle.
   * Solo desde la caja principal; no cambia lo esperado.
   */
  async count(se: Session, b: CashCountInput) {
    assertDetailMatches(b.detail, b.countedCash); // el desglose suma lo contado al céntimo
    const cards = (b.cards ?? []).map((x) => ({ name: x.name, amount: r2(x.amount) }));
    const countedCard = cards.length ? r2(cards.reduce((t, x) => t + x.amount, 0)) : null;
    const g = await this.auth.require(se, "funciones.caja", b.authorization);
    assertMainStation(se.station);
    const store = await this.stores.store();
    const p = await this.periods.current(null, se.storeId);
    if (!p) {
      fail("PERIOD_CLOSED", "No hay periodo abierto");
    }
    const c = await this.periods.cashState(null, se.storeId, p!.id, store.cashFloat);
    const d = cashDifference(b.countedCash, c.expected, store.cashDiffThreshold);
    const a = se.actor(this.clock());
    const id = crypto.randomUUID();
    await this.cash.insertMovement(
      null,
      {
        id,
        storeId: se.storeId,
        periodId: p!.id,
        stationId: se.station.id,
        kind: "count",
        amount: b.countedCash,
        countedDetail: b.detail ?? null,
        cardDetail: cards.length ? cards : null,
        countedCard,
        note: b.note ?? null,
        authorizedBy: g.authorizerActor?.user ?? null,
      },
      a,
    );
    const out = {
      id,
      countedCash: r2(b.countedCash),
      expectedCash: c.expected,
      difference: d.diff,
      countedCard,
      cardSales: c.card,
      cardDifference: countedCard == null ? null : r2(countedCard - c.card),
      at: a.at,
      by: { user: a.user, device: a.device ?? "" },
      printed: null as boolean | null,
      printer: null as string | null,
      error: null as string | null,
      ticket: null as TicketLine[] | null,
    };
    // 11/11 (D2) · resumen corto del arqueo en papel (todas las partes del corte y lo contado)
    if (b.print) {
      const r = await this.countReport(se, id, true, true);
      Object.assign(out, { printed: r.printed, printer: r.printer, error: r.error, ticket: r.ticket });
    }
    return out;
  }

  /**
   * 11/11 (D2, pruebas de la 1.2.268) · Resumen del arqueo («ARQUEO · RESUMEN DE CAJA»): lo mismo que el corte X con todas
   * sus partes (ventas, formas de pago, áreas, camareros, descuentos, eliminaciones, abonos, propinas y caja) y el arqueo:
   * efectivo contado, lo de cada datáfono y la diferencia con la tarjeta del sistema. POST /cash/counts/{id}/print.
   */
  async countReport(se: Session, countId: string, print = true, authorized = false) {
    if (!authorized) {
      await this.auth.require(se, "funciones.caja");
    }
    const m = await this.cash.countById(se.storeId, countId);
    if (!m) {
      fail("NOT_FOUND", "Ese arqueo no existe", { countId });
    }
    const cards = Array.isArray(m!.cardDetail) ? (m!.cardDetail as { name: string; amount: number }[]) : [];
    return this.cutReport(se, "X", m!.periodId, print, true, {
      at: new Date(m!.byAt),
      user: m!.byUserName,
      cash: Number(m!.amount),
      card: m!.countedCard == null ? null : Number(m!.countedCard),
      cards,
      note: m!.note ?? null,
    });
  }

  /**
   * Abrir cajón (sin venta): pulso por la impresora de tickets de la estación, la misma que abre el cajón al facturar
   * (OrdersService.ticketPrinter sin mesa). Estación sin cajón → 422; impresora caída → 503 PRINTER_OFFLINE.
   * No queda apunte en cash_movement: su CHECK de kind (float, withdrawal, count, deposit) no admite la apertura
   * y amount es obligatorio; hace falta una migración en japp-db para guardarlo.
   */
  async openDrawer(se: Session, b: DrawerOpenInput) {
    await this.auth.require(se, "funciones.abrirCajon", b.authorization);
    const p = await this.periods.current(null, se.storeId);
    if (!p) {
      fail("PERIOD_CLOSED", "No hay periodo abierto");
    }
    const { opens, printer } = await this.database.withTx(async (tx) => ({
      opens: await this.printers.stationOpensDrawer(tx, se.storeId, se.station.id),
      printer: await this.orders.ticketPrinter(tx, se),
    }));
    if (!opens) {
      fail("VALIDATION", `${se.station.name} no tiene cajón`, { field: "station", station: se.station.name });
    }
    const res = await this.printer.print({
      kind: "drawer",
      channel: printer.channel,
      printer: printer.name,
      connection: printer.connection,
      title: "Abrir cajón",
      ticket: [],
      openDrawer: true,
    });
    if (!res.ok) {
      fail("PRINTER_OFFLINE", `La impresora ${printer.name} no responde`, {
        printed: [{ printer: printer.name, ok: false }],
      });
    }
    return { opened: true, printer: printer.name };
  }

  /**
   * Corte X: lo mismo que el cierre (Z) sin cerrar. Venta, tickets y formas de pago salen del resumen del periodo
   * (ClosingsService.summarize → summarizePeriod), el efectivo esperado de cashState (la misma cuenta que el arqueo).
   */
  async xReport(se: Session) {
    await this.auth.require(se, "funciones.caja");
    const store = await this.stores.store();
    const p = await this.periods.current(null, se.storeId);
    if (!p) {
      fail("PERIOD_CLOSED", "No hay periodo abierto");
    }
    const s = await this.closings.summarize(null, se.storeId, p!.id);
    const c = await this.periods.cashState(null, se.storeId, p!.id, store.cashFloat);
    const open = await this.closingsData.openTables(se.storeId);
    return {
      periodId: p!.id,
      at: this.clock().toISOString(),
      sales: s.grossSales,
      tickets: s.tickets,
      byMethod: { cash: s.cashAmount, card: s.cardAmount, other: s.otherAmount },
      expectedCash: c.expected,
      openTables: { count: open?.tables ?? 0, amount: r2(open?.amount ?? 0) },
    };
  }
  /**
   * Corte X (periodo abierto, no cierra nada) o Z (un periodo ya cerrado): el ticket con los datos del servidor
   * (summarizePeriod + cashState, lo de todos los equipos) por la impresora de tickets de la estación.
   * Si la impresora no responde no falla: devuelve printed=false y el ticket, para que el TPV lo enseñe.
   */
  async cutReport(
    se: Session,
    kind: "X" | "Z",
    periodId?: string | null,
    print = true,
    authorized = false,
    arqueo?: {
      at: Date;
      user: string;
      cash: number;
      card: number | null;
      cards: { name: string; amount: number }[];
      note: string | null;
    },
  ) {
    if (!authorized) {
      // el Z del cierre ya pasó por el permiso del cierre (puede que con la clave de un encargado)
      await this.auth.require(se, kind === "X" ? "funciones.caja" : "funciones.periodo");
    }
    const store = await this.stores.store();
    let pid = periodId ?? null;
    if (!pid) {
      const p = await this.periods.current(null, se.storeId);
      if (!p) {
        fail("PERIOD_CLOSED", "No hay periodo abierto");
      }
      pid = p!.id;
    }
    const { summary: s, voids } = await this.closings.cutDetail(se.storeId, pid!);
    const extras = await this.closingsData.cutExtras(se.storeId, pid!);
    const c = await this.periods.cashState(null, se.storeId, pid!, store.cashFloat);
    const NAMES: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", other: "Otros" };
    const byMethod = (s.byPayment ?? []).length
      ? s.byPayment.map((m) => ({ name: NAMES[m.method] ?? m.method, amount: r2(m.amount), count: m.count }))
      : [
          { name: "Efectivo", amount: r2(s.cashAmount) },
          { name: "Tarjeta", amount: r2(s.cardAmount) },
          ...(s.otherAmount ? [{ name: "Otros", amount: r2(s.otherAmount) }] : []),
        ];
    const now = this.clock();
    // 11 (04/11): el Z lleva lo contado, la diferencia y el motivo del cierre (si el periodo ya está cerrado)
    const closing = kind === "Z" ? await this.periods.closingOf(se.storeId, pid!) : null;
    const zCards =
      closing && Array.isArray(closing.cardDetail)
        ? (closing.cardDetail as { name: string; amount: number }[])
        : [];
    const ticket: TicketLine[] = cutTicket({
      kind,
      // 05/11 · cabecera como la precuenta: logo del local (0031), cadena · local; el resto según Ajustes › Formatos
      store: {
        tradeName: store.name,
        legalName: store.issuerName,
        taxId: store.nif,
        chain: store.chainName ?? undefined,
        local: store.name,
        address: store.address ?? undefined,
        city: store.city ?? undefined,
        phone: store.phone ?? undefined,
        logoRaster: store.ticketLogo ?? undefined,
      },
      format: kind === "X" ? store.ticketFormats.cutx : store.ticketFormats.cutz,
      guests: s.guests,
      gross: r2(s.grossSales),
      tax: r2(s.taxTotal),
      byArea: extras.byArea,
      byWaiter: s.byWaiter.map((w) => ({ name: w.name, tickets: w.tickets, amount: w.sales })),
      discounts: extras.discounts,
      voids,
      credits: extras.credits,
      tips: r2(s.tips),
      cash: {
        float: c.opening,
        cashSales: c.cashSales,
        withdrawals: c.withdrawals,
        deposits: c.deposits,
        card: r2(c.card + c.other),
        creditsCash: extras.creditsCash,
      },
      station: se.station.name,
      from: new Date(s.openedAt),
      to: now,
      byMethod,
      tickets: s.tickets,
      expectedCash: c.expected,
      closingNumber: null,
      user: arqueo ? arqueo.user : se.user.name,
      cashTips: c.cashTips,
      arqueo: !!arqueo,
      counted: arqueo
        ? {
            cash: arqueo.cash,
            card: arqueo.card,
            cards: arqueo.cards,
            expectedCard: c.card,
            difference: r2(arqueo.cash - c.expected),
            note: arqueo.note,
          }
        : closing
          ? {
              cash: Number(closing.countedCash),
              card: closing.countedCard == null ? null : Number(closing.countedCard),
              cards: zCards,
              expectedCard: zCards.length > 1 ? c.card : null,
              difference: Number(closing.difference),
              note: closing.note ?? null,
              nextFloat: Number(closing.nextFloat),
              deposit: Number(closing.deposit),
            }
          : null,
    });
    const out = {
      kind,
      periodId: pid!,
      sales: r2(s.grossSales),
      tickets: s.tickets,
      expectedCash: c.expected,
      printed: false,
      printer: null as string | null,
      error: null as string | null,
      ticket,
    };
    if (!print) {
      return out;
    }
    try {
      const printer = await this.database.withTx((tx) => this.orders.ticketPrinter(tx, se));
      const res = await this.printer.print({
        kind: kind === "X" ? "cutx" : "cutz",
        channel: printer.channel,
        printer: printer.name,
        connection: printer.connection,
        title: arqueo ? "Arqueo" : `Corte ${kind}`,
        ticket,
      });
      out.printer = printer.name;
      out.printed = !!res.ok;
      out.error = res.ok ? null : `La impresora ${printer.name} no responde`;
    } catch (e: any) {
      out.error = e?.message ?? "No hay impresora de tickets para esta estación";
    }
    return out;
  }
}
