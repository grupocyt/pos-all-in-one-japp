import { Body, Controller, Get, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { IncidentsService } from "../Services/IncidentsService.js";

/**
 * Ajustes › Incidencias de productos. La entrada la valida el servicio (con IncidentsModels) después de comprobar
 * el permiso, como en Funciones › Facturas.
 */
@Controller()
export class IncidentsController {
  constructor(@Inject(IncidentsService) private readonly incidents: IncidentsService) {}

  @Get("incidents")
  async list(@CurrentSession() se: Session, @Query("status") status?: string) {
    return this.incidents.list(se, status);
  }

  /** Enviar a Marketing las pendientes (todas o las de ids). */
  @Post("incidents/send")
  @HttpCode(201)
  async send(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.incidents.send(se, body);
  }
}
