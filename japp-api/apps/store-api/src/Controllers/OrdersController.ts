import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { OrdersService } from "../Services/OrdersService.js";
import {
  Absorb,
  AddLine,
  AuthOnly,
  Checkout,
  ChooseAnswers,
  CloseOrder,
  Customer,
  DeleteLine,
  Discount,
  FireCourse,
  ListQuery,
  MoveLines,
  NewAccount,
  OpenOrder,
  Pay,
  PatchLine,
  PatchOrder,
  Presence,
  RenameAccount,
  ReopenOrder,
  ReorderLines,
  SaveOrder,
  Send,
  Transfer,
  TransferAccount,
  Uuid as uuid,
} from "../Models/OrdersModels.js";

@Controller("orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly svc: OrdersService) {}

  @Get() list(
    @CurrentSession() se: Session,
    @Query("status") status?: string,
    @Query("tableId") tableId?: string,
  ) {
    const q = parse(ListQuery, { status: status || undefined, tableId: tableId || undefined });
    return this.svc.list(se, q.status, q.tableId);
  }
  @Post() @HttpCode(201) open(@CurrentSession() se: Session, @Body() b: unknown) {
    return this.svc.open(se, parse(OpenOrder, b));
  }
  @Get(":orderId") get(@CurrentSession() se: Session, @Param("orderId") id: string) {
    return this.svc.get(se, parse(uuid, id));
  }
  @Patch(":orderId") patch(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) {
    return this.svc.patch(se, parse(uuid, id), parse(PatchOrder, b));
  }
  @Post(":orderId/accounts") @HttpCode(201) account(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.addAccount(se, parse(uuid, id), parse(NewAccount, b));
  }

  @Post(":orderId/lines") @HttpCode(201) addLine(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.addLine(se, parse(uuid, id), parse(AddLine, b));
  }
  @Post(":orderId/lines/move") @HttpCode(200) move(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.moveLines(se, parse(uuid, id), parse(MoveLines, b));
  }
  @Patch(":orderId/lines/:lineId") patchLine(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("lineId") lid: string,
    @Body() b: unknown,
  ) {
    return this.svc.patchLine(se, parse(uuid, id), parse(uuid, lid), parse(PatchLine, b));
  }
  @Post(":orderId/lines/:lineId/delete") @HttpCode(200) del(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("lineId") lid: string,
    @Body() b: unknown,
  ) {
    return this.svc.deleteLine(se, parse(uuid, id), parse(uuid, lid), parse(DeleteLine, b));
  }

  @Post(":orderId/send") @HttpCode(200) send(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.send(se, parse(uuid, id), parse(Send, b));
  }
  @Post(":orderId/accounts/:accountId/prebill") @HttpCode(200) prebill(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
  ) {
    return this.svc.prebill(se, parse(uuid, id), parse(uuid, aid));
  }
  @Post(":orderId/accounts/:accountId/payments") @HttpCode(201) pay(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Body() b: unknown,
  ) {
    return this.svc.pay(se, parse(uuid, id), parse(uuid, aid), parse(Pay, b));
  }
  @Post(":orderId/accounts/:accountId/invoice") @HttpCode(201) invoice(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Body() b: unknown,
  ) {
    return this.svc.invoice(se, parse(uuid, id), parse(uuid, aid), parse(AuthOnly, b ?? {}));
  }
  @Post(":orderId/presence") @HttpCode(200) presence(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.presence(se, parse(uuid, id), parse(Presence, b).action);
  }

  @Delete(":orderId/accounts/:accountId") @HttpCode(200) removeAccount(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
  ) {
    return this.svc.removeAccount(se, parse(uuid, id), parse(uuid, aid));
  }
  @Post(":orderId/accounts/:accountId/discounts") @HttpCode(201) discount(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Body() b: unknown,
  ) {
    return this.svc.addDiscount(se, parse(uuid, id), parse(uuid, aid), parse(Discount, b));
  }
  @Delete(":orderId/accounts/:accountId/discounts/:discountId") @HttpCode(200) undiscount(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Param("discountId") did: string,
    @Body() b: unknown,
  ) {
    return this.svc.removeDiscount(
      se,
      parse(uuid, id),
      parse(uuid, aid),
      parse(uuid, did),
      parse(AuthOnly, b ?? {}),
    );
  }
  @Put(":orderId/accounts/:accountId/customer") @HttpCode(200) customer(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Body() b: unknown,
  ) {
    return this.svc.setCustomer(se, parse(uuid, id), parse(uuid, aid), parse(Customer, b));
  }
  @Put(":orderId/lines/:lineId/answers") @HttpCode(200) answers(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("lineId") lid: string,
    @Body() b: unknown,
  ) {
    return this.svc.chooseAnswers(se, parse(uuid, id), parse(uuid, lid), parse(ChooseAnswers, b));
  }
  @Post(":orderId/lines/:lineId/fire") @HttpCode(200) fire(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("lineId") lid: string,
    @Body() b: unknown,
  ) {
    return this.svc.fireCourse(se, parse(uuid, id), parse(uuid, lid), parse(FireCourse, b));
  }
  @Post(":orderId/lines/:lineId/absorb") @HttpCode(200) absorb(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("lineId") lid: string,
    @Body() b: unknown,
  ) {
    return this.svc.absorb(se, parse(uuid, id), parse(uuid, lid), parse(Absorb, b));
  }
  @Post(":orderId/lines/reorder") @HttpCode(200) reorder(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.reorderLines(se, parse(uuid, id), parse(ReorderLines, b));
  }
  @Post(":orderId/close") @HttpCode(200) close(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.close(se, parse(uuid, id), parse(CloseOrder, b ?? {}));
  }
  @Post(":orderId/transfer") @HttpCode(200) transfer(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.changeTable(se, parse(uuid, id), parse(Transfer, b));
  }
  @Post(":orderId/accounts/:accountId/transfer") @HttpCode(200) transferAccount(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Body() b: unknown,
  ) {
    return this.svc.transferAccount(se, parse(uuid, id), parse(uuid, aid), parse(TransferAccount, b));
  }
  @Post(":orderId/save") @HttpCode(200) save(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.saveAndLeave(se, parse(uuid, id), parse(SaveOrder, b ?? {}));
  }
  @Post(":orderId/reopen") @HttpCode(200) reopen(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Body() b: unknown,
  ) {
    return this.svc.reopen(se, parse(uuid, id), parse(ReopenOrder, b ?? {}));
  }
  @Patch(":orderId/accounts/:accountId") renameAccount(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Body() b: unknown,
  ) {
    return this.svc.renameAccount(se, parse(uuid, id), parse(uuid, aid), parse(RenameAccount, b));
  }
  @Post(":orderId/accounts/:accountId/checkout") @HttpCode(201) checkout(
    @CurrentSession() se: Session,
    @Param("orderId") id: string,
    @Param("accountId") aid: string,
    @Body() b: unknown,
  ) {
    return this.svc.checkout(se, parse(uuid, id), parse(uuid, aid), parse(Checkout, b ?? {}));
  }
  @Get(":orderId/events") events(@CurrentSession() se: Session, @Param("orderId") id: string) {
    return this.svc.events(se, parse(uuid, id));
  }
}
