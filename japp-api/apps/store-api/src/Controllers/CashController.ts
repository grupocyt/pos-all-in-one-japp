import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { CashCountModel, CashMovementModel, CashMovementsQueryModel, DrawerOpenModel, PettyCashModel } from "../Models/CashModels.js";
import { PeriodIdModel } from "../Models/PeriodsModels.js";
import { CashService } from "../Services/CashService.js";

/** Caja del periodo abierto (Funciones › Caja). */
@Controller()
export class CashController {
  constructor(@Inject(CashService) private readonly cash: CashService) {}

  @Get("cash/summary")
  async summary(@CurrentSession() session: Session) {
    return this.cash.summary(session);
  }

  /** 0037 · Movimiento de caja: la operativa (scope=ops) o los arqueos de auditoría (scope=audit). */
  @Get("cash/movements")
  async movements(@CurrentSession() se: Session, @Query() q: unknown) {
    const b = parse(CashMovementsQueryModel, q);
    return this.cash.movementsList(se, b.scope, b.periodId ?? null);
  }

  /** 0037 · Caja chica: fondo, saldo y apuntes. */
  @Get("cash/petty")
  async petty(@CurrentSession() se: Session) {
    return this.cash.petty(se);
  }

  /** 0037 · Gasto (con motivo) o reposición de la caja chica. */
  @Post("cash/petty")
  @HttpCode(201)
  async pettyMove(@CurrentSession() se: Session, @Body() body: unknown) {
    const b = parse(PettyCashModel, body);
    return this.cash.pettyMove(se, b);
  }

  /** Retiro (traslado a caja fuerte), fondo o ingreso a caja. */
  @Post("cash/movements")
  @HttpCode(201)
  async movement(@CurrentSession() se: Session, @Body() body: unknown) {
    const b = parse(CashMovementModel, body);
    return this.cash.movement(se, b);
  }

  /** Arqueo sin cierre (Gestiones › Arqueo de caja). Solo desde la caja principal; no cambia lo esperado. */
  @Post("cash/counts")
  @HttpCode(201)
  async count(@CurrentSession() se: Session, @Body() body: unknown) {
    const b = parse(CashCountModel, body);
    return this.cash.count(se, b);
  }

  /** Abrir cajón: pulso por la impresora de tickets de la estación. */
  @Post("cash/drawer/open")
  @HttpCode(200)
  async openDrawer(@CurrentSession() se: Session, @Body() body: unknown) {
    const b = parse(DrawerOpenModel, body);
    return this.cash.openDrawer(se, b);
  }

  /** Corte X: el cierre (Z) sin cerrar. */
  /** Corte X impreso: el ticket con los datos del servidor por la impresora de tickets de la estación. */
  @Post("cash/x-report/print")
  @HttpCode(200)
  async printX(@CurrentSession() se: Session) {
    return this.cash.cutReport(se, "X");
  }

  /** Corte Z de un periodo cerrado (reimprimir). */
  @Post("periods/:periodId/z-report/print")
  @HttpCode(200)
  async printZ(@CurrentSession() se: Session, @Param("periodId") periodId: string) {
    parse(PeriodIdModel, periodId);
    return this.cash.cutReport(se, "Z", periodId);
  }

  /** 11/11 (D2) · Resumen de un arqueo (todas las partes del corte y lo contado), para imprimirlo o reimprimirlo. */
  @Post("cash/counts/:countId/print")
  @HttpCode(200)
  async printCount(@CurrentSession() se: Session, @Param("countId") countId: string) {
    parse(PeriodIdModel, countId);
    return this.cash.countReport(se, countId);
  }

  @Get("cash/x-report")
  async xReport(@CurrentSession() se: Session) {
    return this.cash.xReport(se);
  }
}
