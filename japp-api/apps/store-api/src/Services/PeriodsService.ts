import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import { assertMainStation, cashDifference, fail } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { ClosingsService } from "./ClosingsService.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { PeriodsApplication, type PeriodRow } from "../Applications/PeriodsApplication.js";
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
    await this.auth.require(session, "funciones.periodo", b.authorization);
    const store = await this.stores.store();
    const now = this.clock();
    const a = session.actor(now);
    return this.database.withTx(async (tx) => {
      if (await this.periods.current(tx, session.storeId)) {
        fail("PERIOD_ALREADY_OPEN", "Ya hay un periodo abierto", { field: "period" });
      }
      const id = crypto.randomUUID();
      await this.periods.insert(tx, id, session.storeId, session.station.id, a);
      await this.cash.insertMovement(
        tx,
        {
          id: crypto.randomUUID(),
          storeId: session.storeId,
          periodId: id,
          stationId: session.station.id,
          kind: "float",
          amount: store.cashFloat,
          note: "Fondo inicial",
        },
        a,
      );
      return this.view((await this.periods.current(tx, session.storeId))!);
    });
  }

  /** Cierre: arqueo ciego contra lo esperado; descuadre por encima del umbral exige nota. */
  async close(periodId: string, b: ClosePeriodInput, session: Session) {
    await this.auth.require(session, "funciones.periodo", b.authorization);
    assertMainStation(session.station);
    const store = await this.stores.store();
    const now = this.clock();
    const a = session.actor(now);
    return this.database.withTx(async (tx) => {
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
      await this.periods.insertClosing(
        tx,
        session.storeId,
        periodId,
        {
          countedCash: b.countedCash,
          countedCard: b.countedCard,
          expectedCash: c.expected,
          difference: d.diff,
          nextFloat: b.nextFloat,
          deposit: b.deposit,
          grossSales: c.totalSales,
          guests: c.guests,
        },
        a,
      );
      await this.periods.close(tx, session.storeId, periodId, a);
      // Gestor de cierres: resumen del periodo (y a la cola hacia el Manager) en la misma transacción
      const sum = await this.closings.persist(tx, session.storeId, periodId, d.diff, a.at, a.user);
      return {
        closing: {
          expectedCash: c.expected,
          difference: d.diff,
          grossSales: c.totalSales,
          guests: c.guests,
          tickets: sum.tickets,
          businessDate: sum.businessDate,
        },
        incidentRequest: null,
      };
    });
  }
}
