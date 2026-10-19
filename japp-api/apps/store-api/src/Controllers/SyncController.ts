import { Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { ReportsService } from "../Services/ReportsService.js";

/** Developer › Sincronización. El envío de transacciones (POST /sync/transactions) está en TransactionsController. */
@Controller()
export class SyncController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /** Cola hacia el Manager. */
  @Get("sync/status")
  async syncStatus(@CurrentSession() se: Session) {
    return this.reports.syncStatus(se);
  }

  /** Enviar ahora al Manager: despierta al agente de sincronización. */
  @Post("sync/now")
  @HttpCode(202)
  async syncNow(@CurrentSession() se: Session) {
    return this.reports.syncNow(se);
  }
}
