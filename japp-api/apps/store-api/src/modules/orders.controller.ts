import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { PRESENCE_ACTIONS, type PresenceAction } from "@japp/domain";
import { CurrentSession, type Session } from "../common/auth.js";
import { parse } from "../common/validate.js";
import { OrdersService } from "./orders.service.js";

const uuid = z.string().uuid();
const version = z.number().int().positive().optional();
const auth = z.string().nullish();

const OpenOrder = z.object({ id: uuid.optional(), accountId: uuid.optional(), accountName: z.string().max(40).optional(), tableId: z.string().min(1), guests: z.number().int().min(1).max(99), authorization: auth });
const PatchOrder = z.object({ guests: z.number().int().min(1).max(99).optional(), note: z.string().max(300).nullish(), version });
const NewAccount = z.object({ id: uuid.optional(), name: z.string().max(40).optional(), version });
const AddLine = z.object({
  id: uuid.optional(), accountId: uuid.nullish(), plu: z.number().int().positive(), quantity: z.number().int().min(1).max(999).default(1), comment: z.string().max(300).nullish(),
  modifiers: z.array(z.object({ questionId: z.string().nullish(), plu: z.number().int().positive(), quantity: z.number().int().min(1).max(99).optional() })).max(30).default([]),
  force: z.boolean().default(false), version,
});
const PatchLine = z.object({ quantity: z.number().int().min(0).max(999).optional(), comment: z.string().max(300).nullish(), version });
const DeleteLine = z.object({ reasonId: uuid.nullish(), reason: z.string().max(120).nullish(), quantity: z.number().int().min(1).optional(), authorization: auth, version });
const MoveLines = z.object({ lines: z.array(z.object({ lineId: uuid, quantity: z.number().int().min(1) })).min(1), toAccountId: uuid.nullish(), newAccountName: z.string().max(40).nullish(), authorization: auth, version });
const Send = z.object({ accountId: uuid.nullish(), version });
const Discount = z.object({ discountId: uuid.nullish(), type: z.enum(["percentage", "fixed"]).optional(), value: z.number().positive().optional(), reason: z.string().max(120).nullish(), authorization: auth });
const Customer = z.object({
  type: z.enum(["person", "company"]), taxId: z.string().min(5).max(20), name: z.string().min(1).max(120), email: z.string().email().nullish(),
  address: z.object({ street: z.string().max(120).optional(), postalCode: z.string().max(10).optional(), city: z.string().max(60).optional(), province: z.string().max(60).optional(), country: z.string().length(2).optional() }).nullish(),
  saveToFile: z.boolean().default(true),
});
const Transfer = z.object({ toTableId: uuid, accountId: uuid.nullish(), version });
const Pay = z.object({ id: uuid.optional(), method: z.string().min(1).max(30), amount: z.number().positive().nullish(), tip: z.number().min(0).default(0), cashGiven: z.number().min(0).nullish(), authorization: auth });

const Presence = z.object({ action: z.enum(PRESENCE_ACTIONS as [PresenceAction, ...PresenceAction[]]) });
const ListQuery = z.object({ status: z.enum(["open", "billing", "closed", "cancelled"]).optional(), tableId: uuid.optional() });
const AuthOnly = z.object({ authorization: auth, print: z.boolean().optional() });

@Controller("orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly svc: OrdersService) {}

  @Get() list(@CurrentSession() se: Session, @Query("status") status?: string, @Query("tableId") tableId?: string) { const q = parse(ListQuery, { status: status || undefined, tableId: tableId || undefined }); return this.svc.list(se, q.status, q.tableId); }
  @Post() @HttpCode(201) open(@CurrentSession() se: Session, @Body() b: unknown) { return this.svc.open(se, parse(OpenOrder, b)); }
  @Get(":orderId") get(@CurrentSession() se: Session, @Param("orderId") id: string) { return this.svc.get(se, parse(uuid, id)); }
  @Patch(":orderId") patch(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.patch(se, parse(uuid, id), parse(PatchOrder, b)); }
  @Post(":orderId/accounts") @HttpCode(201) account(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.addAccount(se, parse(uuid, id), parse(NewAccount, b)); }

  @Post(":orderId/lines") @HttpCode(201) addLine(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.addLine(se, parse(uuid, id), parse(AddLine, b)); }
  @Post(":orderId/lines/move") @HttpCode(200) move(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.moveLines(se, parse(uuid, id), parse(MoveLines, b)); }
  @Patch(":orderId/lines/:lineId") patchLine(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("lineId") lid: string, @Body() b: unknown) { return this.svc.patchLine(se, parse(uuid, id), parse(uuid, lid), parse(PatchLine, b)); }
  @Post(":orderId/lines/:lineId/delete") @HttpCode(200) del(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("lineId") lid: string, @Body() b: unknown) { return this.svc.deleteLine(se, parse(uuid, id), parse(uuid, lid), parse(DeleteLine, b)); }

  @Post(":orderId/send") @HttpCode(200) send(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.send(se, parse(uuid, id), parse(Send, b)); }
  @Post(":orderId/accounts/:accountId/prebill") @HttpCode(200) prebill(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string) { return this.svc.prebill(se, parse(uuid, id), parse(uuid, aid)); }
  @Post(":orderId/accounts/:accountId/payments") @HttpCode(201) pay(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string, @Body() b: unknown) { return this.svc.pay(se, parse(uuid, id), parse(uuid, aid), parse(Pay, b)); }
  @Post(":orderId/accounts/:accountId/invoice") @HttpCode(201) invoice(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string, @Body() b: unknown) { return this.svc.invoice(se, parse(uuid, id), parse(uuid, aid), parse(AuthOnly, b ?? {})); }
  @Post(":orderId/presence") @HttpCode(200) presence(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.presence(se, parse(uuid, id), parse(Presence, b).action); }

  @Delete(":orderId/accounts/:accountId") @HttpCode(200) removeAccount(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string) { return this.svc.removeAccount(se, parse(uuid, id), parse(uuid, aid)); }
  @Post(":orderId/accounts/:accountId/discounts") @HttpCode(201) discount(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string, @Body() b: unknown) { return this.svc.addDiscount(se, parse(uuid, id), parse(uuid, aid), parse(Discount, b)); }
  @Delete(":orderId/accounts/:accountId/discounts/:discountId") @HttpCode(200) undiscount(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string, @Param("discountId") did: string, @Body() b: unknown) { return this.svc.removeDiscount(se, parse(uuid, id), parse(uuid, aid), parse(uuid, did), parse(AuthOnly, b ?? {})); }
  @Put(":orderId/accounts/:accountId/customer") @HttpCode(200) customer(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string, @Body() b: unknown) { return this.svc.setCustomer(se, parse(uuid, id), parse(uuid, aid), parse(Customer, b)); }
  @Put(":orderId/lines/:lineId/answers") @HttpCode(200) answers(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("lineId") lid: string, @Body() b: unknown) { return this.svc.chooseAnswers(se, parse(uuid, id), parse(uuid, lid), parse(z.object({ course: z.number().int().min(0).max(9), modifiers: z.array(z.object({ plu: z.number().int().positive(), quantity: z.number().int().min(1).max(99).optional() })).max(30), version }).strict(), b)); }
  @Post(":orderId/lines/:lineId/fire") @HttpCode(200) fire(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("lineId") lid: string, @Body() b: unknown) { return this.svc.fireCourse(se, parse(uuid, id), parse(uuid, lid), parse(z.object({ course: z.number().int().min(0).max(9), version }).strict(), b)); }
  @Post(":orderId/lines/:lineId/absorb") @HttpCode(200) absorb(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("lineId") lid: string, @Body() b: unknown) { return this.svc.absorb(se, parse(uuid, id), parse(uuid, lid), parse(z.object({ course: z.number().int().min(0).max(9), sourceLineId: uuid, version }).strict(), b)); }
  @Post(":orderId/lines/reorder") @HttpCode(200) reorder(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.reorderLines(se, parse(uuid, id), parse(z.object({ accountId: uuid.nullish(), lineIds: z.array(uuid).min(1).max(200), version }).strict(), b)); }
  @Post(":orderId/close") @HttpCode(200) close(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.close(se, parse(uuid, id), parse(z.object({ version: z.number().int().nullable().optional() }).strict(), b ?? {})); }
  @Post(":orderId/transfer") @HttpCode(200) transfer(@CurrentSession() se: Session, @Param("orderId") id: string, @Body() b: unknown) { return this.svc.transfer(se, parse(uuid, id), parse(Transfer, b)); }
  @Post(":orderId/accounts/:accountId/transfer") @HttpCode(200) transferAccount(@CurrentSession() se: Session, @Param("orderId") id: string, @Param("accountId") aid: string, @Body() b: unknown) {
    return this.svc.transferAccount(se, parse(uuid, id), parse(uuid, aid), parse(z.object({ version: z.number().int().positive(), toTableId: uuid, authorization: auth }).strict(), b));
  }
  @Get(":orderId/events") events(@CurrentSession() se: Session, @Param("orderId") id: string) { return this.svc.events(se, parse(uuid, id)); }
}
