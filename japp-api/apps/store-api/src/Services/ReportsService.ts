import { Inject, Injectable } from "@nestjs/common";
import { D, fail, r2, salesOutlook, sum, voidsOf } from "@japp/domain";
import { CLOCK, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { ClosingsService } from "./ClosingsService.js";
import { ReportsApplication } from "../Applications/ReportsApplication.js";
import { ClosingsApplication } from "../Applications/ClosingsApplication.js";
import { SystemApplication } from "../Applications/SystemApplication.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { PeriodQueryModel } from "../Models/ReportsModels.js";

/** Día de la semana ISO (1 = lunes) de una fecha AAAA-MM-DD. */
const isoDow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

/** Informes de Funciones y Developer, y el Gestor de cierres (con su permiso). Solo lectura. */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ClosingsService) private readonly closings: ClosingsService,
    @Inject(ReportsApplication) private readonly reports: ReportsApplication,
    @Inject(ClosingsApplication) private readonly closingsData: ClosingsApplication,
    @Inject(SystemApplication) private readonly system: SystemApplication,
  ) {}

  /** Eliminaciones: qué se quitó después de enviar, en qué momento (enviado o precuenta), quién, por qué y quién lo autorizó (regla voidsOf). */
  async deletions(se: Session) {
    await this.auth.require(se, "funciones.informes");
    const rows = await this.reports.deletedLines(se.storeId);
    const mods = await this.reports.lineModifiers(
      se.storeId,
      rows.map((r) => r.l.id),
    );
    const v = voidsOf(
      rows.map((r) => ({
        r,
        reason: r.l.deleteReason,
        stage: r.l.deletedStage,
        printed: r.l.printed,
        quantity: Number(r.l.quantity),
        unitPrice: Number(r.l.unitPrice),
        modifiers: mods
          .filter((m) => m.lineId === r.l.id)
          .map((m) => ({ unitPrice: Number(m.unitPrice), quantity: Number(m.quantity) })),
      })),
    );
    return {
      items: v.map(({ r, stage, amount }) => ({
        at: r.l.deletedByAt ? new Date(r.l.deletedByAt).toISOString() : "",
        table: r.table,
        product: r.l.name,
        stage,
        user: r.l.deletedByUserName ?? "",
        reason: r.l.deleteReason ?? "",
        authorizedBy: r.l.deleteAuthorizedByUserName ?? "",
        amount,
      })),
    };
  }

  /** Developer › Transacciones. */
  async transactions(se: Session, status?: string, q?: string) {
    await this.auth.require(se, "ajustes.devtx");
    const rows = await this.reports.orders(se.storeId, status, q);
    return {
      items: rows.map((r) => ({
        id: r.o.id,
        table: r.o.tableName,
        zone: (r.o.zone ?? "").toLowerCase(),
        status: r.o.status,
        version: r.o.version,
        total: Number(r.total),
      })),
    };
  }

  /** Gestor de cierres: un resumen por periodo (el abierto, calculado al vuelo) con el mismo día del año anterior. */
  async closingsList(se: Session, from?: string, to?: string) {
    await this.auth.require(se, "ajustes.cierres");
    return this.closings.list(se.storeId, from, to);
  }

  async closingDetail(se: Session, periodId: string) {
    await this.auth.require(se, "ajustes.cierres");
    return this.closings.detail(se.storeId, periodId);
  }

  /** 52 semanas: real, año anterior y proyección (objetivo de Ajustes › objetivos). Sin año, el de hoy. */
  async weeks(se: Session, year?: string) {
    await this.auth.require(se, "ajustes.cierres");
    let y = new Date(this.clock()).getUTCFullYear();
    if (year) {
      y = Number(year);
    }
    return this.closings.weeks(se.storeId, y);
  }

  /** Venta en vivo: el pulso que el agente manda al Manager cada minuto. */
  async live(se: Session) {
    await this.auth.require(se, "ajustes.cierres");
    return this.closings.live(se.storeId);
  }

  /** Developer › Sincronización: cola hacia el Manager. */
  async syncStatus(se: Session) {
    await this.auth.require(se, "ajustes.devsync");
    return this.closings.syncStatus(se.storeId);
  }

  /** El periodo pedido (UUID) o, sin él, el abierto (sin periodo abierto → PERIOD_CLOSED). */
  private async periodOf(se: Session, periodId?: string) {
    const q = parse(PeriodQueryModel, { periodId: periodId || undefined });
    if (q.periodId) {
      return q.periodId;
    }
    const open = await this.closingsData.openPeriodId(se.storeId);
    if (!open) {
      fail("PERIOD_CLOSED", "No hay periodo abierto");
    }
    return open!;
  }

  /**
   * Resumen de ventas del periodo: lo calcula summarizePeriod (ClosingsService.summarize, lo mismo que el cierre):
   * facturado con IVA (los abonos restan), base, tickets, comensales, por hora (Madrid) y por forma de pago;
   * más los productos más vendidos (lo abonado se descuenta).
   */
  async sales(se: Session, periodId?: string) {
    await this.auth.require(se, "funciones.informes");
    const pid = await this.periodOf(se, periodId);
    const s = await this.closings.summarize(null, se.storeId, pid);
    const top = await this.closingsData.topProducts(se.storeId, pid, 20);
    // v186 · lo marcado en mesas abiertas sin cobrar también cuenta en Venta del día
    const [openRows, openHours, cred] = await Promise.all([
      this.closingsData.openOrders(se.storeId, pid),
      this.closingsData.openByHour(se.storeId, pid),
      this.closingsData.creditsOf(se.storeId, pid),
    ]);
    const openAmount = r2(sum(openRows.map((o) => o.total)));
    const openPaid = r2(sum(openRows.map((o) => o.paid)));
    const byWaiterOpen = new Map<string, { amount: number; tables: number }>();
    for (const o of openRows) {
      const w = byWaiterOpen.get(o.waiter) ?? { amount: 0, tables: 0 };
      w.amount = r2(sum([w.amount, o.total]));
      w.tables++;
      byWaiterOpen.set(o.waiter, w);
    }
    const isOpenPeriod = (await this.closingsData.openPeriodId(se.storeId)) === pid;
    const bd = s.businessDate;
    const history = isOpenPeriod
      ? (await this.closingsData.historyByHour(se.storeId, isoDow(bd), bd)).map((h) => h.by_hour ?? {})
      : [];
    const outlook = salesOutlook({
      invoiced: s.grossSales,
      open: { amount: openAmount, tables: openRows.length },
      history,
      openedAt: new Date(s.openedAt),
      // periodo ya cerrado: el día entero está hecho (proyección = venta)
      now: isOpenPeriod ? this.clock() : new Date(new Date(s.openedAt).getTime() + 23.9 * 3600_000),
    });
    let avgTicket = 0;
    if (s.tickets) {
      avgTicket = r2(D(s.grossSales).div(s.tickets));
    }
    return {
      periodId: pid,
      sold: s.grossSales,
      net: s.taxBase,
      tickets: s.tickets,
      avgTicket,
      guests: s.guests,
      byHour: Object.entries(s.byHour)
        .map(([hour, amount]) => ({ hour: Number(hour), amount }))
        .sort((a, b) => a.hour - b.hour),
      byMethod: { cash: s.cashAmount, card: s.cardAmount, other: s.otherAmount },
      // facturas rectificativas (abonos) del periodo: ya restan en sold; aquí van aparte para enseñarlas
      credits: { count: cred.n, amount: r2(Math.abs(cred.amount)) },
      invoiced: r2(D(s.grossSales).plus(Math.abs(cred.amount))),
      open: {
        tables: openRows.length,
        amount: openAmount,
        paid: openPaid,
        pending: r2(D(openAmount).minus(openPaid)),
        guests: openRows.reduce((acc, o) => acc + (o.guests || 0), 0),
        // ya con precuenta (incluido en amount): el TPV lo pinta en rojo
        preBill: {
          tables: openRows.filter((o) => Number(o.pre_bill) > 0).length,
          amount: r2(sum(openRows.map((o) => Number(o.pre_bill)))),
        },
        byHour: openHours.map((h) => ({
          hour: Number(h.hour),
          amount: r2(Number(h.amount)),
          preBill: r2(Number(h.pre_bill)),
        })),
        byWaiter: [...byWaiterOpen.entries()]
          .map(([user, w]) => ({ user, tables: w.tables, amount: w.amount }))
          .sort((a, b) => b.amount - a.amount || a.user.localeCompare(b.user)),
      },
      outlook,
      topProducts: top.map((p) => ({
        plu: p.plu == null ? null : Number(p.plu),
        name: p.name,
        quantity: Number(p.quantity),
        amount: r2(Number(p.amount)),
      })),
    };
  }

  /** Camareros · KPI: por quien abrió la mesa (regla staffKpi sobre el resumen del periodo). */
  async staff(se: Session, periodId?: string) {
    await this.auth.require(se, "funciones.kpi");
    const pid = await this.periodOf(se, periodId);
    return { periodId: pid, items: await this.closings.staff(se.storeId, pid) };
  }

  /**
   * Enviar ahora al Manager: NOTIFY al canal que escucha el agente de sincronización (sync_outbox) para que mande
   * ya lo pendiente; responde cuántas transacciones (entity order) hay en cola.
   */
  async syncNow(se: Session) {
    await this.auth.require(se, "ajustes.devsync");
    await this.system.notifySync();
    return { queued: await this.system.pendingOrders(se.storeId) };
  }
}
