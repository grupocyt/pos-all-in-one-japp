import { Controller, Get, Inject, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { CustomersService } from "../Services/CustomersService.js";
import { CustomerSearch } from "../Models/OrdersModels.js";

@Controller("customers")
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly svc: CustomersService) {}

  @Get() search(@CurrentSession() se: Session, @Query("q") q?: string) {
    return this.svc.search(se, parse(CustomerSearch, { q }).q);
  }
}
