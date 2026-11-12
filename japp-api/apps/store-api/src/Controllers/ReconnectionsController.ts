import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { ReconnectionsService } from "../Services/ReconnectionsService.js";

/** Reconexiones de la orden: lo ticado sin conexión espera aquí a que alguien con permiso lo valide o lo descarte. */
@Controller()
export class ReconnectionsController {
  constructor(@Inject(ReconnectionsService) private readonly svc: ReconnectionsService) {}

  @Post("orders/:orderId/reconnections")
  @HttpCode(201)
  async create(@CurrentSession() se: Session, @Param("orderId") orderId: string, @Body() body: unknown) {
    return this.svc.create(se, orderId, body);
  }

  @Get("reconnections")
  async list(
    @CurrentSession() se: Session,
    @Query("status") status?: string,
    @Query("orderId") orderId?: string,
  ) {
    return this.svc.list(se, status, orderId);
  }

  @Post("reconnections/:reconnectionId/accept")
  @HttpCode(200)
  async accept(@CurrentSession() se: Session, @Param("reconnectionId") id: string, @Body() body: unknown) {
    return this.svc.accept(se, id, body);
  }

  @Post("reconnections/:reconnectionId/discard")
  @HttpCode(200)
  async discard(@CurrentSession() se: Session, @Param("reconnectionId") id: string, @Body() body: unknown) {
    return this.svc.discard(se, id, body);
  }
}
