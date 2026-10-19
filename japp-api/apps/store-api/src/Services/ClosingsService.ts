import { Inject, Injectable } from "@nestjs/common";
import type { Tx } from "@japp/db";
import {
  addDays,
  businessDate,
  D,
  fail,
  madridDay,
  paymentKind,
  r2,
  sum,
  staffKpi,
  summarizePeriod,
  voidsOf,
  weeksReport,
  weeksTotals,
  type PeriodSummary,
} from "@japp/domain";
import { CLOCK, type Clock } from "../Constants/Injection.js";
import { ClosingsApplication } from "../Applications/ClosingsApplication.js";

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** Día de negocio de una fila de period_summary (texto «AAAA-MM-DD…» o fecha). */
const dateOf = (v: unknown) => {
  if (typeof v === "string") {
    return v.slice(0, 10);
  }
  return new Date(v as string).toISOString().slice(0, 10);
};

/** Gestor de cierres: resumen de cada periodo (se guarda al cerrar), 52 semanas, venta en vivo y estado de la sincronización. */
@Injectable()
export class ClosingsService {
  constructor(
    @Inject(ClosingsApplication) private readonly data: ClosingsApplication,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Resumen de un periodo con lo que hay en la base (lo usa el cierre y la vista del periodo en curso). tx null = fuera de transacción. */
  async summarize(
    tx: Tx | null,
    storeId: string,
    periodId: string,
    cashDifference = 0,
  ): Promise<PeriodSummary & { openedAt: string }> {
    return (await this.compute(tx, storeId, periodId, cashDifference)).summary;
  }

  /** El resumen y lo que se usó para hacerlo (anulaciones con su camarero, ids de los camareros). */
  private async compute(tx: Tx | null, storeId: string, periodId: string, cashDifference: number) {
    const p = await this.data.periodOpenedAt(tx, storeId, periodId);
    if (!p) {
      fail("NOT_FOUND", "Ese periodo no existe", { periodId });
    }
    const { inv, pays, deleted, discountAmount } = await this.data.periodData(tx, storeId, periodId);
    // anulaciones: una sola regla (voidsOf en @japp/domain): eliminadas tras enviar, con modificadores, sin «Pasada a…» ni «Incluida en menú»
    const voids = voidsOf(
      deleted.map((l) => ({
        l,
        reason: l.delete_reason,
        stage: l.deleted_stage,
        printed: l.printed,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        modifiers: (l.mods as { unitPrice: string; quantity: string }[]).map((m) => ({
          unitPrice: Number(m.unitPrice),
          quantity: Number(m.quantity),
        })),
      })),
    );
    const s = summarizePeriod({
      openedAt: new Date(p!.opened_by_at),
      discountAmount,
      cashDifference,
      invoices: inv.map((i) => ({
        at: new Date(i.issued_at),
        total: i.total,
        base: i.base,
        tax: i.tax,
        type: i.type,
        waiter: i.waiter ?? "—",
        table: i.table_name,
        orderId: i.order_id,
        guests: Number(i.guests ?? 0),
      })),
      payments: pays.map((x) => ({
        method: x.method,
        kind: paymentKind(x.kind, x.method),
        amount: x.amount,
        tip: x.tip,
      })),
      voids: voids.map(({ l, quantity, amount }) => ({
        at: new Date(l.deleted_by_at ?? p!.opened_by_at),
        name: l.name,
        qty: quantity,
        amount,
        reason: l.delete_reason ?? "",
        by: l.deleted_by_user_name ?? "—",
        auth: l.delete_authorized_by_user_name ?? null,
      })),
    });
    const summary = { ...s, openedAt: new Date(p!.opened_by_at).toISOString() };
    // camarero (quien abrió la mesa) → su id de usuario, de las facturas y de las eliminadas
    const waiterIds: Record<string, string | null> = {};
    for (const r of [...inv, ...deleted]) {
      if (r.waiter && r.waiter_id) {
        waiterIds[r.waiter] = r.waiter_id;
      }
    }
    return { summary, voids, waiterIds };
  }

  /** Camareros · KPI del periodo: el resumen (summarizePeriod) + las anulaciones de sus mesas (regla staffKpi). */
  async staff(storeId: string, periodId: string) {
    const c = await this.compute(null, storeId, periodId, 0);
    return staffKpi(
      c.summary.byWaiter,
      c.voids.map(({ l, quantity, amount }) => ({ waiter: l.waiter ?? "—", qty: quantity, amount })),
      c.waiterIds,
    );
  }

  /** Al cerrar el periodo (misma transacción que el arqueo): guarda el resumen y lo deja en la cola hacia el Manager. */
  async persist(
    tx: Tx,
    storeId: string,
    periodId: string,
    cashDifference: number,
    closedAt: string,
    closedBy: string,
  ) {
    const s = await this.summarize(tx, storeId, periodId, cashDifference);
    await this.data.insertSummary(tx, storeId, periodId, s, closedAt, closedBy);
    await this.data.enqueuePeriodClosed(tx, storeId, periodId, { periodId, closedAt, closedBy, ...s });
    return s;
  }

  private view(r: any) {
    let avgTicket = 0;
    if (Number(r.tickets)) {
      avgTicket = r2(Number(r.gross_sales) / Number(r.tickets));
    }
    return {
      periodId: r.period_id,
      businessDate: dateOf(r.business_date),
      openedAt: iso(r.opened_at)!,
      closedAt: iso(r.closed_at),
      open: !!r.open,
      closedBy: r.closed_by_user_name ?? null,
      grossSales: Number(r.gross_sales),
      taxBase: Number(r.tax_base),
      taxTotal: Number(r.tax_total),
      tickets: Number(r.tickets),
      guests: Number(r.guests),
      avgTicket,
      cash: Number(r.cash_amount),
      card: Number(r.card_amount),
      other: Number(r.other_amount),
      tips: Number(r.tips),
      discounts: Number(r.discount_amount),
      voidsCount: Number(r.voids_count),
      voidsAmount: Number(r.voids_amount),
      cashDifference: Number(r.cash_difference),
    };
  }
  /** El periodo abierto, calculado al vuelo con la misma forma que un resumen guardado. */
  private async openRow(storeId: string) {
    const id = await this.data.openPeriodId(storeId);
    if (!id) {
      return null;
    }
    const s = await this.summarize(null, storeId, id);
    return {
      period_id: id,
      business_date: s.businessDate,
      opened_at: s.openedAt,
      closed_at: null,
      open: true,
      closed_by_user_name: null,
      gross_sales: s.grossSales,
      tax_base: s.taxBase,
      tax_total: s.taxTotal,
      tickets: s.tickets,
      guests: s.guests,
      cash_amount: s.cashAmount,
      card_amount: s.cardAmount,
      other_amount: s.otherAmount,
      tips: s.tips,
      discount_amount: s.discountAmount,
      voids_count: s.voidsCount,
      voids_amount: s.voidsAmount,
      cash_difference: 0,
      by_hour: s.byHour,
      by_waiter: s.byWaiter,
      by_payment: s.byPayment,
      voids: s.voids,
    };
  }

  async list(storeId: string, from?: string, to?: string) {
    const today = madridDay(this.clock()).date;
    const f = from ?? addDays(today, -29);
    const t = to ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || f > t) {
      fail("VALIDATION", "Rango de fechas no válido (AAAA-MM-DD, desde ≤ hasta)", { field: "from" });
    }
    const saved = await this.data.savedBetween(storeId, f, t);
    const open = await this.openRow(storeId);
    const all = [...(open && open.business_date >= f && open.business_date <= t ? [open] : []), ...saved];
    const prev = await this.data.salesByDay(storeId, addDays(f, -364), addDays(t, -364));
    const pm = new Map(prev.map((x) => [x.d, x.s]));
    const items = all.map((r) => {
      const v = this.view(r);
      const ly = addDays(v.businessDate, -364);
      return { ...v, lastYear: { businessDate: ly, grossSales: pm.get(ly) ?? null } };
    });
    const total = r2(sum(items.map((x) => x.grossSales)));
    const tickets = items.reduce((a, x) => a + x.tickets, 0);
    const prevTotal = r2(sum([...pm.values()]));
    return {
      from: f,
      to: t,
      items,
      totals: {
        grossSales: total,
        tickets,
        avgTicket: tickets ? r2(D(total).div(tickets)) : 0,
        voidsCount: items.reduce((a, x) => a + x.voidsCount, 0),
        voidsAmount: r2(sum(items.map((x) => x.voidsAmount))),
        lastYear: prevTotal,
        vsLastYearPct: prevTotal ? r2(D(total).minus(prevTotal).div(prevTotal).times(100)) : null,
      },
    };
  }

  async detail(storeId: string, periodId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(periodId)) {
      fail("VALIDATION", "periodId no válido", { field: "periodId" });
    }
    let r = await this.data.savedOf(storeId, periodId);
    if (!r) {
      const o = await this.openRow(storeId);
      if (o?.period_id === periodId) {
        r = o;
      }
    }
    if (!r) {
      fail("NOT_FOUND", "Ese cierre no existe", { periodId });
    }
    const v = this.view(r);
    const ly = addDays(v.businessDate, -364);
    const p = await this.data.dayTotals(storeId, ly);
    return {
      ...v,
      byHour: r.by_hour ?? {},
      byWaiter: r.by_waiter ?? [],
      byPayment: r.by_payment ?? [],
      voids: r.voids ?? [],
      lastYear: { businessDate: ly, grossSales: p?.s ?? null, tickets: p?.t ?? null },
    };
  }

  /** 52 (o 53) semanas: real, año anterior, proyección con el objetivo de sales_target. */
  async weeks(storeId: string, year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      fail("VALIDATION", "Año no válido", { field: "year" });
    }
    const today = madridDay(this.clock()).date;
    const days = (await this.data.salesForWeeks(storeId, year)).map((d) => ({
      date: d.date,
      sales: d.sales,
    }));
    const open = await this.openRow(storeId);
    if (open) {
      const d = days.find((x) => x.date === open.business_date);
      if (d) {
        d.sales = r2(d.sales + open.gross_sales);
      } else {
        days.push({ date: open.business_date, sales: open.gross_sales });
      }
    }
    const targets = (await this.data.targets(storeId, year)).map((t) => ({
      week: Number(t.week),
      growthPct: t.g,
      amount: t.a,
    }));
    const r = weeksReport(year, days, targets, today);
    return {
      year,
      growthPct: targets.find((t) => t.week === 0)?.growthPct ?? 0,
      weeks: r,
      totals: weeksTotals(r),
    };
  }

  /** Pulso de cada minuto para el Manager: lo cobrado del periodo + lo que hay en mesas abiertas. */
  async live(storeId: string) {
    const at = this.clock().toISOString();
    const o = await this.openRow(storeId);
    const open = await this.data.openTables(storeId);
    const pend = await this.data.outboxPending(storeId);
    return {
      at,
      periodId: o?.period_id ?? null,
      openedAt: o?.opened_at ?? null,
      businessDate: o?.business_date ?? businessDate(this.clock()),
      invoiced: { total: o?.gross_sales ?? 0, tickets: o?.tickets ?? 0, guests: o?.guests ?? 0 },
      open: { tables: open?.tables ?? 0, amount: r2(open?.amount ?? 0) },
      byHour: o?.by_hour ?? {},
      byWaiter: o?.by_waiter ?? [],
      voids: { count: o?.voids_count ?? 0, amount: o?.voids_amount ?? 0 },
      pays: { cash: o?.cash_amount ?? 0, card: o?.card_amount ?? 0, other: o?.other_amount ?? 0 },
      outboxPending: pend?.n ?? 0,
    };
  }

  /** Developer › Sincronización: cola pendiente, apartados y último envío. */
  async syncStatus(storeId: string) {
    const q = await this.data.outboxCounts(storeId);
    const byEntity = await this.data.outboxByEntity(storeId);
    const s = await this.data.syncState(storeId);
    const last = await this.data.outboxLatest(storeId);
    let oldestAgeSeconds = 0;
    if (q?.oldest) {
      oldestAgeSeconds = Math.max(
        0,
        Math.round((this.clock().getTime() - new Date(q.oldest).getTime()) / 1000),
      );
    }
    return {
      outboxPending: q?.pending ?? 0,
      parked: q?.parked ?? 0,
      sent: q?.sent ?? 0,
      oldestPendingAt: iso(q?.oldest),
      oldestAgeSeconds,
      delayed: oldestAgeSeconds > 300,
      byEntity,
      lastSentAt: iso(s?.last_sent_at),
      lastLiveAt: iso(s?.last_live_at),
      lastHeartbeatAt: iso(s?.last_heartbeat_at),
      lastError: s?.last_error ?? null,
      lastErrorAt: iso(s?.last_error_at),
      latest: last.map((x) => ({
        seq: x.seq,
        eventId: x.eventId,
        entity: x.entity,
        createdAt: iso(x.created_at)!,
        sentAt: iso(x.sent_at),
        attempts: Number(x.attempts),
        lastError: x.last_error ?? null,
        parkedAt: iso(x.parked_at),
      })),
    };
  }
}
