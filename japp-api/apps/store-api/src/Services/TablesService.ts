import { Inject, Injectable } from "@nestjs/common";
import { accountTotals, isCharging, liveHolder, r2, sum, tableClass } from "@japp/domain";
import { CLOCK, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { OrdersApplication } from "../Applications/OrdersApplication.js";
import { TablesApplication } from "../Applications/TablesApplication.js";

/** Plano: cada mesa con su estado (libre, mía, de otro, precuenta, dividida) y lo pendiente. */
@Injectable()
export class TablesService {
  constructor(
    @Inject(TablesApplication) private readonly tables: TablesApplication,
    @Inject(OrdersApplication) private readonly orders: OrdersApplication,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(session: Session, areaId?: string) {
    const tables = await this.tables.listWithArea(session.storeId, areaId);
    const open = await this.orders.listLive(session.storeId);
    const at = this.clock();
    const now = at.getTime();
    return {
      items: await Promise.all(
        tables.map(async ({ t, a }) => {
          const o = open.find((x) => x.tableId === t.id);
          if (!o) {
            return {
              tableId: t.id,
              number: String(t.number),
              area: a.name,
              state: "free",
              orderId: null,
              pending: 0,
              waiter: null,
              openedMinutes: 0,
              presence: [],
              holder: null,
              charging: false,
            };
          }
          const { order, header } = await this.orders.loadSnapshot(session.storeId, o.id);
          const h = liveHolder(header.presence, at);
          const live = order.accounts.filter((x) => x.status === "open");
          const lines = live.flatMap((x) => x.lines);
          const st = this.state(live.length, lines);
          return {
            tableId: t.id,
            number: String(t.number),
            area: a.name,
            state: tableClass({ state: st as any, waiter: o.openedByUserName }, session.user.name),
            orderId: o.id,
            pending: r2(sum(live.map((acc) => accountTotals(acc).pending))),
            waiter: o.openedByUserName,
            openedMinutes: Math.floor((now - new Date(o.openedByAt).getTime()) / 60000),
            presence: [],
            // una persona por mesa: quién la tiene ahora (null si nadie o caducó) y si se está cobrando
            holder: h ? { userName: h.userName, stationName: h.stationName } : null,
            charging: isCharging(header.presence, at),
          };
        }),
      ),
    };
  }

  /** Dividida si tiene más de una cuenta viva; precuenta solo mientras todas sus líneas están en precuenta. */
  private state(liveAccounts: number, lines: { status: string }[]): "split" | "bill" | "open" {
    if (liveAccounts > 1) {
      return "split";
    }
    if (lines.length && lines.every((l) => l.status === "preBill")) {
      return "bill";
    }
    return "open";
  }
}
