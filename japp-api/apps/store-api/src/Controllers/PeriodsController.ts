import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { ClosePeriodModel, OpenPeriodModel, PeriodIdModel } from "../Models/PeriodsModels.js";
import { PeriodsService } from "../Services/PeriodsService.js";

@Controller()
export class PeriodsController {
  constructor(@Inject(PeriodsService) private readonly periods: PeriodsService) {}

  @Get("periods/current")
  async getCurrent(@CurrentSession() session: Session) {
    return this.periods.current(session);
  }

  /** Abrir periodo con el fondo de caja de Parámetros. Solo uno abierto por tienda (lo garantiza la base). */
  @Post("periods")
  @HttpCode(201)
  async open(@Body() body: unknown, @CurrentSession() session: Session) {
    const b = parse(OpenPeriodModel, body);
    return this.periods.open(b, session);
  }

  /** Cierre: arqueo ciego contra lo esperado; descuadre por encima del umbral exige nota. */
  @Post("periods/:periodId/close")
  @HttpCode(200)
  async close(@Param("periodId") rawId: string, @Body() body: unknown, @CurrentSession() session: Session) {
    const periodId = parse(PeriodIdModel, rawId);
    const b = parse(ClosePeriodModel, body);
    return this.periods.close(periodId, b, session);
  }
}
