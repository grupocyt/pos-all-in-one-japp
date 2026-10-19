import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { CashCountModel, CashMovementModel, DrawerOpenModel } from "../Models/CashModels.js";
import { CashService } from "../Services/CashService.js";

/** Caja del periodo abierto (Funciones › Caja). */
@Controller()
export class CashController {
  constructor(@Inject(CashService) private readonly cash: CashService) {}

  @Get("cash/summary")
  async summary(@CurrentSession() session: Session) {
    return this.cash.summary(session);
  }

  /** Retiro (a caja fuerte / banco), fondo o depósito. El retiro necesita motivo. */
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
  @Get("cash/x-report")
  async xReport(@CurrentSession() se: Session) {
    return this.cash.xReport(se);
  }
}
