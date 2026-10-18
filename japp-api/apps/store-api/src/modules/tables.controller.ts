import { Controller, Get, Inject, Query } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type Database } from "@japp/db";
import { accountTotals, isCharging, liveHolder, r2, sum, tableClass } from "@japp/domain";
import { z } from "zod";
import { parse } from "../common/validate.js";
import { CLOCK, DATABASE, type Clock } from "../common/tokens-di.js";
import { CurrentSession, type Session } from "../common/auth.js";
import { OrderRepo } from "../repos/order.repo.js";

/** Plano: cada mesa con su estado (libre, mía, de otro, precuenta, dividida) y lo pendiente. */
@Controller("tables")
export class TablesController {
  constructor(@Inject(DATABASE) private readonly database: Database, @Inject(OrderRepo) private readonly orders: OrderRepo, @Inject(CLOCK) private readonly clock: Clock) {}

  @Get()
  async list(@CurrentSession() session: Session, @Query("areaId") rawArea?: string) {
    const areaId = rawArea ? parse(z.string().uuid(), rawArea) : undefined;
    const db = this.database.db;
    const tables = await db.select({ t: s.diningTable, a: s.area }).from(s.diningTable).innerJoin(s.area, eq(s.area.id, s.diningTable.areaId))
      .where(and(eq(s.diningTable.storeId, session.storeId), eq(s.diningTable.active, true), ...(areaId ? [eq(s.diningTable.areaId, areaId)] : [])));
    const open = await db.select().from(s.orders).where(and(eq(s.orders.storeId, session.storeId), inArray(s.orders.status, ["open", "billing"])));
    const at = this.clock(), now = at.getTime();
    return {
      items: await Promise.all(tables.map(async ({ t, a }) => {
        const o = open.find(x => x.tableId === t.id);
        if (!o) return { tableId: t.id, number: String(t.number), area: a.name, state: "free", orderId: null, pending: 0, waiter: null, openedMinutes: 0, presence: [], holder: null, charging: false };
        const { order, header } = await db.transaction(tx => this.orders.load(tx, session.storeId, o.id));
        const h = liveHolder(header.presence, at);
        const live = order.accounts.filter(x => x.status === "open");
        const lines = live.flatMap(x => x.lines);
        const st = live.length > 1 ? "split" : lines.length && lines.every(l => l.status === "preBill") ? "bill" : "open";
        return {
          tableId: t.id, number: String(t.number), area: a.name, state: tableClass({ state: st as any, waiter: o.openedByUserName }, session.user.name), orderId: o.id,
          pending: r2(sum(live.map(acc => accountTotals(acc).pending))), waiter: o.openedByUserName, openedMinutes: Math.floor((now - new Date(o.openedByAt).getTime()) / 60000), presence: [],
          // una persona por mesa: quién la tiene ahora (null si nadie o caducó) y si se está cobrando
          holder: h ? { userName: h.userName, stationName: h.stationName } : null, charging: isCharging(header.presence, at),
        };
      })),
    };
  }
}
