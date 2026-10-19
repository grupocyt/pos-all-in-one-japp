import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { ClosingIdModel } from "../Models/ReportsModels.js";
import { ReportsService } from "../Services/ReportsService.js";

/** Informes de Funciones y Developer y el Gestor de cierres. Solo lectura. */
@Controller()
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /** Eliminaciones: qué se quitó después de enviar, en qué momento, quién, por qué y quién lo autorizó. */
  @Get("reports/deletions")
  async deletions(@CurrentSession() se: Session) {
    return this.reports.deletions(se);
  }

  /** Developer › Transacciones. */
  @Get("transactions")
  async transactions(
    @CurrentSession() se: Session,
    @Query("status") status?: string,
    @Query("q") q?: string,
  ) {
    return this.reports.transactions(se, status, q);
  }

  /** Gestor de cierres: un resumen por periodo (el abierto, calculado al vuelo) con el mismo día del año anterior. */
  @Get("reports/closings")
  async closingsList(@CurrentSession() se: Session, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reports.closingsList(se, from, to);
  }

  @Get("reports/closings/:periodId")
  async closingDetail(@CurrentSession() se: Session, @Param("periodId") periodId: string) {
    parse(ClosingIdModel, periodId);
    return this.reports.closingDetail(se, periodId);
  }

  /** 52 semanas: real, año anterior y proyección (objetivo de Ajustes › objetivos). */
  @Get("reports/weeks")
  async weeks(@CurrentSession() se: Session, @Query("year") year?: string) {
    return this.reports.weeks(se, year);
  }

  /** Venta en vivo: el pulso que el agente manda al Manager cada minuto. */
  @Get("reports/live")
  async live(@CurrentSession() se: Session) {
    return this.reports.live(se);
  }

  /** Resumen de ventas del periodo (el abierto si no viene periodId). */
  @Get("reports/sales")
  async sales(@CurrentSession() se: Session, @Query("periodId") periodId?: string) {
    return this.reports.sales(se, periodId);
  }

  /** Camareros · KPI del periodo (el abierto si no viene periodId). */
  @Get("reports/staff")
  async staff(@CurrentSession() se: Session, @Query("periodId") periodId?: string) {
    return this.reports.staff(se, periodId);
  }
}
