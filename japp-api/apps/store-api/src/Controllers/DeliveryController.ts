import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { AllowStoreKey, CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { DeliveryService } from "../Services/DeliveryService.js";

/** Pedidos de delivery: tablero, ficha, alta (integrador o encargado), siguiente paso y cancelar. Avisa delivery.changed. */
@Controller("delivery/orders")
export class DeliveryController {
  constructor(@Inject(DeliveryService) private readonly delivery: DeliveryService) {}

  @Get()
  list(
    @CurrentSession() se: Session,
    @Query("scope") scope?: string,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("date") date?: string,
  ) {
    return this.delivery.list(se, { scope, status, q, date });
  }

  @Get(":id")
  get(@CurrentSession() se: Session, @Param("id") id: string) {
    return this.delivery.get(se, id);
  }

  /** 201 si entra; 200 con el que había si el externalId ya estaba (no se duplica). */
  @AllowStoreKey()
  @Post()
  @HttpCode(201)
  async create(@Req() req: any, @Body() body: unknown, @Res({ passthrough: true }) reply: any) {
    const r = await this.delivery.create(req.integration ? null : req.session, body);
    if (!r.created) {
      req.statusOverride = 200;
      reply.status(200);
    }
    return r.order;
  }

  @Post(":id/advance")
  @HttpCode(200)
  advance(@CurrentSession() se: Session, @Param("id") id: string, @Body() body: unknown) {
    return this.delivery.advance(se, id, body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentSession() se: Session, @Param("id") id: string, @Body() body: unknown) {
    return this.delivery.cancel(se, id, body);
  }
}
