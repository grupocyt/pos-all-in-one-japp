import { Body, Controller, Get, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { TransactionsService } from "../Services/TransactionsService.js";

/**
 * Transacciones del día (para el Manager): consultar y enviar.
 * El cuerpo de POST /sync/transactions se valida en el servicio, después de comprobar el permiso (como siempre).
 */
@Controller()
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly svc: TransactionsService) {}

  @Get("transactions/day")
  async day(@CurrentSession() se: Session, @Query("date") date?: string, @Query("type") type?: string) {
    return this.svc.dayFor(se, date, type);
  }

  @Post("sync/transactions")
  @HttpCode(200)
  async send(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.svc.sendFor(se, body);
  }
}
