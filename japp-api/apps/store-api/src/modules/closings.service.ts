import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import { addDays, businessDate, D, fail, madridDay, paymentKind, r2, sum, summarizePeriod, voidsOf, weeksReport, weeksTotals, type PeriodSummary } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../common/tokens-di.js";

type Q = Tx | Database["db"];
const rows = async <T = any>(q: Q, query: ReturnType<typeof sql>) => (await q.execute(query)).rows as T[];
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** Gestor de cierres: resumen de cada periodo (se guarda al cerrar), 52 semanas, venta en vivo y estado de la sincronización. */
@Injectable()
export class ClosingsService {
  constructor(@Inject(DATABASE) private readonly database: Database, @Inject(CLOCK) private readonly clock: Clock) {}

  /** Resumen de un periodo con lo que hay en la base (lo usa el cierre y la vista del periodo en curso). */
  async summarize(q: Q, storeId: string, periodId: string, cashDifference = 0): Promise<PeriodSummary & { openedAt: string }> {
    const [p] = await rows(q, sql`SELECT opened_by_at FROM sales_period WHERE id = ${periodId} AND store_id = ${storeId}`);
    if (!p) fail("NOT_FOUND", "Ese periodo no existe", { periodId });
    const inv = await rows(q, sql`SELECT i.issued_at, i.total::float8 total, i.tax_base::float8 base, i.tax_total::float8 tax, i.type, o.opened_by_user_name waiter, o.table_name, o.id::text order_id, o.guests
      FROM invoice i JOIN orders o ON o.id = i.order_id WHERE i.store_id = ${storeId} AND o.period_id = ${periodId} AND i.status <> 'cancelled' ORDER BY i.issued_at`);
    const pays = await rows(q, sql`SELECT p.method, pm.kind, p.amount::float8 amount, coalesce(p.tip, 0)::float8 tip FROM payment p
      JOIN account a ON a.id = p.account_id AND a.store_id = p.store_id JOIN orders o ON o.id = a.order_id AND o.store_id = p.store_id LEFT JOIN payment_method pm ON pm.id = p.payment_method_id AND pm.store_id = p.store_id
      WHERE p.store_id = ${storeId} AND o.period_id = ${periodId} AND p.status = 'confirmed'`);
    // anulaciones: una sola regla (voidsOf en @japp/domain): eliminadas tras enviar, con modificadores, sin «Pasada a…» ni «Incluida en menú»
    const deleted = await rows(q, sql`SELECT l.id::text id, l.deleted_by_at, l.name, l.quantity::text quantity, l.unit_price::text unit_price, l.delete_reason, l.deleted_stage, l.printed, l.deleted_by_user_name, l.delete_authorized_by_user_name,
        coalesce((SELECT json_agg(json_build_object('unitPrice', m.unit_price::text, 'quantity', m.quantity::text)) FROM order_line_modifier m WHERE m.line_id = l.id AND m.store_id = l.store_id), '[]') mods
      FROM order_line l JOIN orders o ON o.id = l.order_id AND o.store_id = l.store_id WHERE l.store_id = ${storeId} AND o.period_id = ${periodId} AND l.deleted ORDER BY l.deleted_by_at`);
    const voids = voidsOf(deleted.map(l => ({ l, reason: l.delete_reason, stage: l.deleted_stage, printed: l.printed, quantity: Number(l.quantity), unitPrice: Number(l.unit_price),
      modifiers: (l.mods as { unitPrice: string; quantity: string }[]).map(m => ({ unitPrice: Number(m.unitPrice), quantity: Number(m.quantity) })) })));
    const [disc] = await rows(q, sql`SELECT coalesce(sum(d.amount), 0)::float8 n FROM account_discount d JOIN account a ON a.id = d.account_id JOIN orders o ON o.id = a.order_id
      WHERE d.store_id = ${storeId} AND o.period_id = ${periodId} AND d.status = 'applied' AND a.status <> 'cancelled'`);
    const s = summarizePeriod({
      openedAt: new Date(p.opened_by_at), discountAmount: disc?.n ?? 0, cashDifference,
      invoices: inv.map(i => ({ at: new Date(i.issued_at), total: i.total, base: i.base, tax: i.tax, type: i.type, waiter: i.waiter ?? "—", table: i.table_name, orderId: i.order_id, guests: Number(i.guests ?? 0) })),
      payments: pays.map(x => ({ method: x.method, kind: paymentKind(x.kind, x.method), amount: x.amount, tip: x.tip })),
      voids: voids.map(({ l, quantity, amount }) => ({ at: new Date(l.deleted_by_at ?? p.opened_by_at), name: l.name, qty: quantity, amount, reason: l.delete_reason ?? "", by: l.deleted_by_user_name ?? "—", auth: l.delete_authorized_by_user_name ?? null })),
    });
    return { ...s, openedAt: new Date(p.opened_by_at).toISOString() };
  }

  /** Al cerrar el periodo (misma transacción que el arqueo): guarda el resumen y lo deja en la cola hacia el Manager. */
  async persist(tx: Tx, storeId: string, periodId: string, cashDifference: number, closedAt: string, closedBy: string) {
    const s = await this.summarize(tx, storeId, periodId, cashDifference), id = crypto.randomUUID();
    await tx.execute(sql`INSERT INTO period_summary (id, store_id, period_id, business_date, opened_at, closed_at, gross_sales, tax_base, tax_total, tickets, guests, cash_amount, card_amount, other_amount, tips,
      discount_amount, voids_count, voids_amount, cash_difference, by_hour, by_waiter, by_payment, voids, closed_by_user_name)
      VALUES (${id}, ${storeId}, ${periodId}, ${s.businessDate}, ${s.openedAt}, ${closedAt}, ${s.grossSales.toFixed(2)}, ${s.taxBase.toFixed(2)}, ${s.taxTotal.toFixed(2)}, ${s.tickets}, ${s.guests},
        ${s.cashAmount.toFixed(2)}, ${s.cardAmount.toFixed(2)}, ${s.otherAmount.toFixed(2)}, ${s.tips.toFixed(2)}, ${s.discountAmount.toFixed(2)}, ${s.voidsCount}, ${s.voidsAmount.toFixed(2)}, ${s.cashDifference.toFixed(2)},
        ${JSON.stringify(s.byHour)}::jsonb, ${JSON.stringify(s.byWaiter)}::jsonb, ${JSON.stringify(s.byPayment)}::jsonb, ${JSON.stringify(s.voids)}::jsonb, ${closedBy})`);
    await tx.execute(sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES (${storeId}, 'period.closed', ${periodId}, 'upsert', ${JSON.stringify({ periodId, closedAt, closedBy, ...s })}::jsonb)`);
    return s;
  }

  private view(r: any) {
    return {
      periodId: r.period_id, businessDate: typeof r.business_date === "string" ? r.business_date.slice(0, 10) : new Date(r.business_date).toISOString().slice(0, 10),
      openedAt: iso(r.opened_at)!, closedAt: iso(r.closed_at), open: !!r.open, closedBy: r.closed_by_user_name ?? null,
      grossSales: Number(r.gross_sales), taxBase: Number(r.tax_base), taxTotal: Number(r.tax_total), tickets: Number(r.tickets), guests: Number(r.guests),
      avgTicket: Number(r.tickets) ? r2(Number(r.gross_sales) / Number(r.tickets)) : 0,
      cash: Number(r.cash_amount), card: Number(r.card_amount), other: Number(r.other_amount), tips: Number(r.tips), discounts: Number(r.discount_amount),
      voidsCount: Number(r.voids_count), voidsAmount: Number(r.voids_amount), cashDifference: Number(r.cash_difference),
    };
  }
  /** El periodo abierto, calculado al vuelo con la misma forma que un resumen guardado. */
  private async openRow(storeId: string) {
    const db = this.database.db;
    const [p] = await rows(db, sql`SELECT id::text FROM sales_period WHERE store_id = ${storeId} AND open_flag = 1`);
    if (!p) return null;
    const s = await this.summarize(db, storeId, p.id);
    return { period_id: p.id, business_date: s.businessDate, opened_at: s.openedAt, closed_at: null, open: true, closed_by_user_name: null, gross_sales: s.grossSales, tax_base: s.taxBase, tax_total: s.taxTotal,
      tickets: s.tickets, guests: s.guests, cash_amount: s.cashAmount, card_amount: s.cardAmount, other_amount: s.otherAmount, tips: s.tips, discount_amount: s.discountAmount,
      voids_count: s.voidsCount, voids_amount: s.voidsAmount, cash_difference: 0, by_hour: s.byHour, by_waiter: s.byWaiter, by_payment: s.byPayment, voids: s.voids };
  }

  async list(storeId: string, from?: string, to?: string) {
    const today = madridDay(this.clock()).date, f = from ?? addDays(today, -29), t = to ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || f > t) fail("VALIDATION", "Rango de fechas no válido (AAAA-MM-DD, desde ≤ hasta)", { field: "from" });
    const db = this.database.db;
    const saved = await rows(db, sql`SELECT ps.*, ps.period_id::text period_id, ps.business_date::text business_date FROM period_summary ps WHERE ps.store_id = ${storeId} AND ps.business_date BETWEEN ${f} AND ${t} ORDER BY ps.business_date DESC, ps.closed_at DESC`);
    const open = await this.openRow(storeId);
    const all = [...(open && open.business_date >= f && open.business_date <= t ? [open] : []), ...saved];
    const prev = await rows(db, sql`SELECT business_date::text d, sum(gross_sales)::float8 s FROM period_summary WHERE store_id = ${storeId} AND business_date BETWEEN ${addDays(f, -364)} AND ${addDays(t, -364)} GROUP BY business_date`);
    const pm = new Map(prev.map(x => [x.d, x.s]));
    const items = all.map(r => { const v = this.view(r), ly = addDays(v.businessDate, -364); return { ...v, lastYear: { businessDate: ly, grossSales: pm.get(ly) ?? null } }; });
    const total = r2(sum(items.map(x => x.grossSales))), tickets = items.reduce((a, x) => a + x.tickets, 0), prevTotal = r2(sum([...pm.values()]));
    return { from: f, to: t, items, totals: { grossSales: total, tickets, avgTicket: tickets ? r2(D(total).div(tickets)) : 0, voidsCount: items.reduce((a, x) => a + x.voidsCount, 0), voidsAmount: r2(sum(items.map(x => x.voidsAmount))),
      lastYear: prevTotal, vsLastYearPct: prevTotal ? r2(D(total).minus(prevTotal).div(prevTotal).times(100)) : null } };
  }

  async detail(storeId: string, periodId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(periodId)) fail("VALIDATION", "periodId no válido", { field: "periodId" });
    const db = this.database.db;
    let [r] = await rows(db, sql`SELECT ps.*, ps.period_id::text period_id, ps.business_date::text business_date FROM period_summary ps WHERE ps.store_id = ${storeId} AND ps.period_id = ${periodId}`);
    if (!r) { const o = await this.openRow(storeId); if (o?.period_id === periodId) r = o; }
    if (!r) fail("NOT_FOUND", "Ese cierre no existe", { periodId });
    const v = this.view(r), ly = addDays(v.businessDate, -364);
    const [p] = await rows(db, sql`SELECT sum(gross_sales)::float8 s, sum(tickets)::int t FROM period_summary WHERE store_id = ${storeId} AND business_date = ${ly}`);
    return { ...v, byHour: r.by_hour ?? {}, byWaiter: r.by_waiter ?? [], byPayment: r.by_payment ?? [], voids: r.voids ?? [], lastYear: { businessDate: ly, grossSales: p?.s ?? null, tickets: p?.t ?? null } };
  }

  /** 52 (o 53) semanas: real, año anterior, proyección con el objetivo de sales_target. */
  async weeks(storeId: string, year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) fail("VALIDATION", "Año no válido", { field: "year" });
    const db = this.database.db, today = madridDay(this.clock()).date;
    const days = (await rows(db, sql`SELECT business_date::text date, sum(gross_sales)::float8 sales FROM period_summary WHERE store_id = ${storeId}
      AND business_date BETWEEN ${`${year - 1}-01-01`}::date - 7 AND ${`${year}-12-31`}::date + 7 GROUP BY business_date`)).map(d => ({ date: d.date, sales: d.sales }));
    const open = await this.openRow(storeId);
    if (open) { const d = days.find(x => x.date === open.business_date); if (d) d.sales = r2(d.sales + open.gross_sales); else days.push({ date: open.business_date, sales: open.gross_sales }); }
    const targets = (await rows(db, sql`SELECT week, growth_pct::float8 g, amount::float8 a FROM sales_target WHERE store_id = ${storeId} AND year = ${year}`)).map(t => ({ week: Number(t.week), growthPct: t.g, amount: t.a }));
    const r = weeksReport(year, days, targets, today);
    return { year, growthPct: targets.find(t => t.week === 0)?.growthPct ?? 0, weeks: r, totals: weeksTotals(r) };
  }

  /** Pulso de cada minuto para el Manager: lo cobrado del periodo + lo que hay en mesas abiertas. */
  async live(storeId: string) {
    const db = this.database.db, at = this.clock().toISOString();
    const o = await this.openRow(storeId);
    const [open] = await rows(db, sql`SELECT count(DISTINCT o.id)::int tables, coalesce(sum(a.pending), 0)::float8 amount FROM orders o JOIN account a ON a.order_id = o.id
      WHERE o.store_id = ${storeId} AND o.status IN ('open','billing') AND a.status NOT IN ('cancelled','invoiced')`);
    const [pend] = await rows(db, sql`SELECT count(*)::int n FROM sync_outbox WHERE store_id = ${storeId} AND sent_at IS NULL AND parked_at IS NULL`);
    return {
      at, periodId: o?.period_id ?? null, openedAt: o?.opened_at ?? null, businessDate: o?.business_date ?? businessDate(this.clock()),
      invoiced: { total: o?.gross_sales ?? 0, tickets: o?.tickets ?? 0, guests: o?.guests ?? 0 },
      open: { tables: open?.tables ?? 0, amount: r2(open?.amount ?? 0) },
      byHour: o?.by_hour ?? {}, byWaiter: o?.by_waiter ?? [], voids: { count: o?.voids_count ?? 0, amount: o?.voids_amount ?? 0 },
      pays: { cash: o?.cash_amount ?? 0, card: o?.card_amount ?? 0, other: o?.other_amount ?? 0 }, outboxPending: pend?.n ?? 0,
    };
  }

  /** Developer › Sincronización: cola pendiente, apartados y último envío. */
  async syncStatus(storeId: string) {
    const db = this.database.db;
    const [q] = await rows(db, sql`SELECT count(*) FILTER (WHERE sent_at IS NULL AND parked_at IS NULL)::int pending, count(*) FILTER (WHERE parked_at IS NOT NULL)::int parked,
      count(*) FILTER (WHERE sent_at IS NOT NULL)::int sent, min(created_at) FILTER (WHERE sent_at IS NULL AND parked_at IS NULL) oldest FROM sync_outbox WHERE store_id = ${storeId}`);
    const byEntity = await rows(db, sql`SELECT entity, count(*)::int count FROM sync_outbox WHERE store_id = ${storeId} AND sent_at IS NULL AND parked_at IS NULL GROUP BY entity ORDER BY entity`);
    const [s] = await rows(db, sql`SELECT * FROM sync_state WHERE store_id = ${storeId}`);
    const last = await rows(db, sql`SELECT id::int seq, event_id::text "eventId", entity, created_at, sent_at, attempts, last_error, parked_at FROM sync_outbox WHERE store_id = ${storeId} ORDER BY id DESC LIMIT 20`);
    const oldestAgeSeconds = q?.oldest ? Math.max(0, Math.round((this.clock().getTime() - new Date(q.oldest).getTime()) / 1000)) : 0;
    return {
      outboxPending: q?.pending ?? 0, parked: q?.parked ?? 0, sent: q?.sent ?? 0, oldestPendingAt: iso(q?.oldest), oldestAgeSeconds, delayed: oldestAgeSeconds > 300, byEntity,
      lastSentAt: iso(s?.last_sent_at), lastLiveAt: iso(s?.last_live_at), lastHeartbeatAt: iso(s?.last_heartbeat_at), lastError: s?.last_error ?? null, lastErrorAt: iso(s?.last_error_at),
      latest: last.map(x => ({ seq: x.seq, eventId: x.eventId, entity: x.entity, createdAt: iso(x.created_at)!, sentAt: iso(x.sent_at), attempts: Number(x.attempts), lastError: x.last_error ?? null, parkedAt: iso(x.parked_at) })),
    };
  }
}
