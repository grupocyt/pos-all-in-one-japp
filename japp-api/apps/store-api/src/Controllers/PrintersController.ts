import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { PrintersService } from "../Services/PrintersService.js";

/**
 * Ajustes › Prueba de impresoras: vista previa, probar conexión, imprimir ejemplos y estado de todas.
 * Los cuerpos (Models/PrintersModels.ts) los valida el servicio después de comprobar el permiso, como antes.
 */
@Controller("printers")
export class PrintersController {
  constructor(@Inject(PrintersService) private readonly svc: PrintersService) {}

  @Post("preview")
  @HttpCode(200)
  preview(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.svc.preview(se, body);
  }

  @Post("ping")
  @HttpCode(200)
  ping(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.svc.ping(se, body);
  }

  @Post("print")
  @HttpCode(200)
  print(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.svc.print(se, body);
  }

  /** Estado de todas las impresoras activas (conecta con cada una, sin imprimir). */
  @Get("status")
  status(@CurrentSession() se: Session) {
    return this.svc.status(se);
  }

  /** Imprimir un ticket de ejemplo en una impresora dada de alta en Ajustes. */
  @Post(":printerId/test")
  @HttpCode(200)
  test(@CurrentSession() se: Session, @Param("printerId") id: string, @Body() body: unknown) {
    return this.svc.test(se, id, body);
  }
}
