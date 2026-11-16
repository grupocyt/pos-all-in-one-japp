import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { PrintQueueService } from "../Services/PrintQueueService.js";

/** 16/11 · Cola de impresión (Gestiones › Impresiones): lo pendiente, lo fallido y lo último impreso. */
@Controller("print-jobs")
export class PrintJobsController {
  constructor(@Inject(PrintQueueService) private readonly queue: PrintQueueService) {}

  @Get()
  list(@CurrentSession() se: Session, @Query("status") status?: string, @Query("limit") limit?: string) {
    return this.queue.list(se, status, limit);
  }

  @Post(":id/retry")
  @HttpCode(200)
  retry(@CurrentSession() se: Session, @Param("id") id: string) {
    return this.queue.retry(se, id);
  }

  @Post(":id/reassign")
  @HttpCode(200)
  reassign(@CurrentSession() se: Session, @Param("id") id: string, @Body() body: unknown) {
    return this.queue.reassign(se, id, body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentSession() se: Session, @Param("id") id: string, @Body() body: unknown) {
    return this.queue.cancel(se, id, body);
  }
}
