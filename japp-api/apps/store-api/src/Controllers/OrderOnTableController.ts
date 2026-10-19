import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IntegrationKeyGuard } from "../Helpers/IntegrationKeyGuard.js";
import { CurrentSession, Public, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { OrderOnTableService } from "../Services/OrderOnTableService.js";
import { CreateOot, OotLines, Uuid as uuid } from "../Models/OrderOnTableModels.js";

/** Order on Table desde el TPV y la PDA (con sesión): generar, reutilizar y anular el QR de la mesa. */
@Controller("orders")
export class OrderOnTableController {
  constructor(@Inject(OrderOnTableService) private readonly svc: OrderOnTableService) {}

  @Post(":orderId/oot") @HttpCode(201) create(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.create(se, parse(uuid, id), parse(CreateOot, b));
  }
  @Delete(":orderId/oot") @HttpCode(200) revoke(@CurrentSession() se: Session, @Param("orderId") id: string) {
    return this.svc.revoke(se, parse(uuid, id));
  }
}

/**
 * Lo que llama el sistema de pedidos del cliente: sin sesión de usuario (Public para el guard de sesión);
 * se autentica con la cabecera X-Integration-Key (IntegrationKeyGuard, antes de leer el cuerpo).
 */
@Public()
@UseGuards(IntegrationKeyGuard)
@Controller("oot")
export class OrderOnTablePublicController {
  constructor(@Inject(OrderOnTableService) private readonly svc: OrderOnTableService) {}

  @Get(":token") menu(@Param("token") token: string) {
    return this.svc.menu(token);
  }
  @Post(":token/lines") @HttpCode(201) order(
    @Headers("idempotency-key") idem: string | undefined,
    @Param("token") token: string,
    @Body() b: unknown,
  ) {
    return this.svc.order(token, parse(OotLines, b), idem);
  }
}
