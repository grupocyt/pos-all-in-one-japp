import { Body, Controller, Get, Inject, Put } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { ServiceSlaService } from "../Services/ServiceSlaService.js";

/** Gestiones › Mesas en servicio y Ajustes › SLA de atención. */
@Controller()
export class ServiceSlaController {
  constructor(@Inject(ServiceSlaService) private readonly sla: ServiceSlaService) {}

  /** Mesas abiertas medidas contra su SLA, peor primero, con el resumen de hoy y por camarero. */
  @Get("service/live")
  async live(@CurrentSession() se: Session) {
    return this.sla.live(se);
  }

  @Get("service/sla")
  async get(@CurrentSession() se: Session) {
    return this.sla.get(se);
  }

  @Put("service/sla")
  async put(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.sla.put(se, body);
  }
}
