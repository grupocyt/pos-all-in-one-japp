import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { InvoicesService } from "../Services/InvoicesService.js";

/**
 * Funciones › Facturas. Aquí no se valida la entrada: el contrato pide comprobar antes el permiso,
 * y eso lo hace el servicio (que luego valida con InvoicesModels).
 */
@Controller()
export class InvoicesController {
  constructor(@Inject(InvoicesService) private readonly invoices: InvoicesService) {}

  @Get("invoices")
  async list(
    @CurrentSession() se: Session,
    @Query("from") rawFrom?: string,
    @Query("to") rawTo?: string,
    @Query("q") q?: string,
  ) {
    return this.invoices.list(se, rawFrom, rawTo, q);
  }

  @Get("invoices/:invoiceId")
  async invoice(@CurrentSession() se: Session, @Param("invoiceId") id: string) {
    return this.invoices.get(se, id);
  }

  /** Reimprimir el ticket de una factura (mismo formato; queda en el historial de la mesa). */
  @Post("invoices/:invoiceId/reprint")
  @HttpCode(200)
  async reprint(@CurrentSession() se: Session, @Param("invoiceId") id: string) {
    return this.invoices.reprint(se, id);
  }

  /** Abono (factura rectificativa por diferencias). */
  @Post("invoices/:invoiceId/credit")
  @HttpCode(201)
  async credit(@CurrentSession() se: Session, @Param("invoiceId") id: string, @Body() body: unknown) {
    return this.invoices.credit(se, id, body);
  }

  /** Estado VeriFactu del registro de la factura. */
  @Get("invoices/:invoiceId/verifactu")
  async verifactu(@CurrentSession() se: Session, @Param("invoiceId") id: string) {
    return this.invoices.verifactu(se, id);
  }
}
