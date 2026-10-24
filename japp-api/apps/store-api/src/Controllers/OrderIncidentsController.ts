import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { OrderIncidentsService } from "../Services/OrderIncidentsService.js";

/** Incidencias de mesa: el equipo las guarda solo y una persona las resuelve en ese equipo. */
@Controller()
export class OrderIncidentsController {
  constructor(@Inject(OrderIncidentsService) private readonly incidents: OrderIncidentsService) {}

  @Get("order-incidents")
  async list(
    @CurrentSession() se: Session,
    @Query("status") status?: string,
    @Query("orderId") orderId?: string,
  ) {
    return this.incidents.list(se, status, orderId);
  }

  @Post("order-incidents")
  @HttpCode(201)
  async create(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.incidents.create(se, body);
  }

  @Post("order-incidents/:incidentId/resolve")
  @HttpCode(200)
  async resolve(@CurrentSession() se: Session, @Param("incidentId") id: string, @Body() body: unknown) {
    return this.incidents.resolve(se, id, body);
  }
}
