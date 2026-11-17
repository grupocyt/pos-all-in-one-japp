import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import { assertDetailMatches, assertMainStation, cashDifference, fail, r2 } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { ClosingsService } from "./ClosingsService.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { PeriodsApplication, type PeriodRow } from "../Applications/PeriodsApplication.js";
import { CashService } from "./CashService.js";
import { IncidentsService } from "./IncidentsService.js";
import { OrdersService } from "./OrdersService.js";
import { CashApplication } from "../Applications/CashApplication.js";
import type { ClosePeriodInput, OpenPeriodInput } from "../Models/PeriodsModels.js";

/** Periodo de venta: consultar el abierto, abrir (con su fondo) y cerrar (arqueo ciego). */
@Injectable()
export class PeriodsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ClosingsService) private readonly closings: ClosingsService,
    @Inject(PeriodsApplication) private readonly periods: PeriodsApplication,
    @Inject(CashApplication) private readonly cash: CashApplication,
    @Inject(CashService) private readonly cashSvc: CashService,
    @Inject(IncidentsService) private readonly incidentsSvc: IncidentsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  private view(p: PeriodRow) {
    return {
      id: p.id,
      status: p.status,
      openedBy: {
        user: p.openedByUserName,
        device: p.openedByDevice ?? "",
        at: new Date(p.openedByAt).toISOString(),
      },
    };
  }

  async current(session: Session) {
    const p = await this.periods.current(null, session.storeId);
    if (!p) {
      fail("PERIOD_CLOSED", "No hay periodo abierto");
    }
    return this.view(p!);
  }

  /** Abrir periodo con el fondo de caja de Parámetros. Solo uno abierto por tienda (lo garantiza la base). */
  async open(b: OpenPeriodInput, session: Session) {
    // 0036 · abre quien tenga «Iniciar el día» (el Cajero) o funciones.periodo (o con la clave de quien lo tenga)
    await this.auth.requireAny(session, ["funciones.periodo", "funciones.iniciarDia"], b.authorization);
    const store = await this.stores.store();
    const now = this.clock();
    const a = session.actor(now);
    return this.database.withTx(async (tx) => {
      if (await this.periods.current(tx, session.storeId)) {
        fail("PERIOD_ALREADY_OPEN", "Ya hay un periodo abierto", { field: "period" });
      }
      const id = crypto.randomUUID();
      await this.periods.insert(tx, id, session.storeId, session.station.id, a);
      // 11/11 (D2) · el fondo es el que se dejó en el último cierre (con sus retiros e ingresos); sin cierres, el de Parámetros
      const last = await this.periods.lastClosing(tx, session.storeId);
      const float = last ? Number(last.nextFloat) : store.cashFloat;
      // 0037 (auditoría) · la base se confirma contando los billetes: si no cuadra (por encima del umbral), con motivo
      let opening: { expected: number; counted: number; difference: number } | null = null;
      if (b.countedFloat != null) {
        assertDetailMatches(b.detail, b.countedFloat);
        const d = cashDifference(b.countedFloat, float, store.cashDiffThreshold);
        if (d.needsReason && !b.note?.trim()) {
          fail("VALIDATION", "La base contada no cuadra con la del cierre anterior: escribe el motivo", {
            field: "note",
            expectedFloat: r2(float),
            countedFloat: r2(b.countedFloat),
            difference: d.diff,
            threshold: store.cashDiffThreshold,
          });
        }
        opening = { expected: r2(float), counted: r2(b.countedFloat), difference: d.diff };
      }
      await this.cash.insertMovement(
        tx,
        {
          id: crypto.randomUUID(),
          storeId: session.storeId,
          periodId: id,
          stationId: session.station.id,
          kind: "float",
          amount: float,
          note: last ? "Fondo del cierre anterior" : "Fondo inicial",
        },
        a,
      );
      if (opening) {
        await this.cash.insertMovement(
          tx,
          {
            id: crypto.randomUUID(),
            storeId: session.storeId,
            periodId: id,
            stationId: session.station.id,
            kind: "count",
            amount: opening.counted,
            countedDetail: b.detail ?? null,
            note: b.note?.trim() || null,
            countType: "apertura",
            expectedCash: opening.expected,
            difference: opening.difference,
          },
          a,
        );
      }
      return { ...this.view((await this.periods.current(tx, session.storeId))!), opening };
    });
  }

  /** Cierre: arqueo ciego contra lo esperado; descuadre por encima del umbral exige nota. */
  async close(periodId: string, b: ClosePeriodInput, session: Session) {
    await this.auth.require(session, "funciones.periodo", b.authorization);
    assertMainStation(session.station);
    const store = await this.stores.store();
    const now = this.clock();
    const a = session.actor(now);
    // las mesas abiertas vacías (sin productos ni cobros) no bloquean el cierre: se cierran solas antes
    await this.orders.closeEmptyOfPeriod(session, periodId);
    const res = await this.database.withTx(async (tx) => {
      const p = await this.periods.lockForUpdate(tx, session.storeId, periodId);
      if (!p || p.status !== "open") {
        fail("PERIOD_CLOSED", "Ese periodo no está abierto", { periodId });
      }
      const openOrders = await this.periods.countOpenOrders(tx, session.storeId, periodId);
      if (openOrders > 0) {
        fail("VALIDATION", "Quedan mesas abiertas: cóbralas o ciérralas antes", {
          openOrders,
        });
      }
      const c = await this.periods.cashState(tx, session.storeId, periodId, store.cashFloat);
      const d = cashDifference(b.countedCash, c.expected, store.cashDiffThreshold);
      if (d.needsReason && !b.note?.trim()) {
        // con los datos de la API, para que el TPV enseñe lo esperado, lo contado y el umbral sin calcularlos él
        fail("VALIDATION", "El descuadre supera el umbral: escribe el motivo", {
          field: "note",
          expectedCash: c.expected,
          countedCash: b.countedCash,
          difference: d.diff,
          threshold: store.cashDiffThreshold,
        });
      }
      // 11/11 (D2) · fondo para mañana: el que diga el equipo o el de hoy − retiros + ingresos (sin pasar de lo contado);
      // a depositar: siempre lo contado − ese fondo (lo calcula la API, así no hay dos cifras distintas)
      const cards = (b.cards ?? []).map((x) => ({ name: x.name, amount: r2(x.amount) }));
      const countedCard = cards.length ? r2(cards.reduce((t, x) => t + x.amount, 0)) : b.countedCard;
      const proposed = r2(c.opening - c.withdrawals + c.deposits);
      const nextFloat = r2(Math.min(b.countedCash, Math.max(0, b.nextFloat ?? proposed)));
      const deposit = r2(Math.max(0, b.countedCash - nextFloat));
      await this.periods.insertClosing(
        tx,
        session.storeId,
        periodId,
        {
          countedCash: b.countedCash,
          countedCard,
          cardDetail: cards.length ? cards : null,
          expectedCash: c.expected,
          difference: d.diff,
          nextFloat,
          deposit,
          grossSales: c.totalSales,
          guests: c.guests,
          note: b.note ?? null,
        },
        a,
      );
      await this.periods.close(tx, session.storeId, periodId, a);
      // Gestor de cierres: resumen del periodo (y a la cola hacia el Manager) en la misma transacción
      const sum = await this.closings.persist(tx, session.storeId, periodId, d.diff, a.at, a.user);
      // incidencias de productos pendientes → una solicitud para Marketing (REQ-nnnn) en la misma transacción
      const inc = await this.incidentsSvc.sendPending(tx, session.storeId, a, "period_close", null, null);
      return {
        closing: {
          expectedCash: c.expected,
          difference: d.diff,
          nextFloat,
          deposit,
          grossSales: c.totalSales,
          guests: c.guests,
          tickets: sum.tickets,
          businessDate: sum.businessDate,
        },
        incidentRequest: inc.code,
      };
    });
    // Corte Z por la impresora de tickets, después del COMMIT: si la impresora falla el periodo queda cerrado igual
    const z = await this.cashSvc.cutReport(session, "Z", periodId, true, true).catch((e: any) => ({
      printed: false,
      printer: null,
      error: e?.message ?? "No se pudo imprimir el corte Z",
      ticket: [],
    }));
    return { ...res, zReport: { printed: z.printed, printer: z.printer, error: z.error, ticket: z.ticket } };
  }
}
