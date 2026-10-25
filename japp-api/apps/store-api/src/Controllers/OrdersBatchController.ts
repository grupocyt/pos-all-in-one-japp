import { Body, Controller, Headers, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { OrdersBatchService } from "../Services/OrdersBatchService.js";
import { BatchModel } from "../Models/OrdersBatchModels.js";
import { Uuid as uuid } from "../Models/OrdersModels.js";

@Controller("orders")
export class OrdersBatchController {
  constructor(@Inject(OrdersBatchService) private readonly svc: OrdersBatchService) {}

  @Post(":orderId/batch") @HttpCode(200) batch(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.svc.run(se, parse(uuid, id), parse(BatchModel, b).commands, headers);
  }
}
