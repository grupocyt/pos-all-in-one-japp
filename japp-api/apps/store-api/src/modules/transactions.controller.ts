import { Body, Controller, Get, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentSession, type Session } from "../common/auth.js";
import { Authorization } from "../common/authorization.js";
import { parse } from "../common/validate.js";
import { TransactionsService, type DayType } from "./transactions.service.js";

/** Transacciones del día (para el Manager): consultar y enviar. */
@Controller()
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly svc: TransactionsService, @Inject(Authorization) private readonly auth: Authorization) {}

  @Get("transactions/day")
  async day(@CurrentSession() se: Session, @Query("date") date?: string, @Query("type") type?: string) {
    await this.auth.require(se, "funciones.informes");
    return this.svc.day(se.storeId, date, (type ?? "all") as DayType);
  }

  @Post("sync/transactions") @HttpCode(200)
  async send(@CurrentSession() se: Session, @Body() body: unknown) {
    await this.auth.require(se, "ajustes.devsync");
    const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), type: z.enum(["all", "invoices", "credits", "open", "cancelled"]).default("all") }), body);
    return this.svc.send(se.storeId, b.date, b.type);
  }
}
