import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import type { SlaRule, SlaShift } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

type Row = Record<string, any>;
const iso = (d: unknown) => (d == null ? null : new Date(d as string).toISOString());
const num = (v: unknown) => (v == null ? null : Number(v));

export interface StoredRule extends SlaRule {
  id: string;
}
export interface LiveRow {
  orderId: string;
  tableId: string | null;
  tableName: string;
  areaId: string | null;
  areaName: string | null;
  guests: number;
  waiter: string;
  lastUser: string | null;
  status: string;
  openedAt: string;
  firstLineAt: string | null;
  oldestUnsentAt: string | null;
  lastSentAt: string | null;
  prebillAt: string | null;
  total: number;
}
export interface ClosedRow {
  orderId: string;
  tableId: string | null;
  areaId: string | null;
  waiter: string;
  openedAt: string;
  firstLineAt: string | null;
  prebillAt: string | null;
  closedAt: string;
}

/** SLA de atención (service_shift y service_sla, migración 0017) y lo que se mide de las mesas. */
@Injectable()
export class ServiceSlaApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async shifts(storeId: string, q: Tx | null = null): Promise<SlaShift[]> {
    const r = await (q ?? this.database.db).execute(
      sql`SELECT id::text, name, to_char(starts_at, 'HH24:MI') AS start, to_char(ends_at, 'HH24:MI') AS "end"
          FROM service_shift WHERE store_id = ${storeId} ORDER BY sort_order, starts_at`,
    );
    return (r.rows as Row[]).map((x) => ({ id: x.id, name: x.name, start: x.start, end: x.end }));
  }

  async rules(storeId: string, q: Tx | null = null): Promise<StoredRule[]> {
    const r = await (q ?? this.database.db).execute(
      sql`SELECT id::text, area_id::text, table_id::text, shift_id::text, first_order_minutes, unsent_minutes, idle_minutes,
                 prebill_pay_minutes, total_minutes, warn_percent
          FROM service_sla WHERE store_id = ${storeId}
          ORDER BY (area_id IS NOT NULL OR table_id IS NOT NULL), area_id NULLS FIRST, table_id NULLS FIRST, shift_id NULLS FIRST`,
    );
    return (r.rows as Row[]).map((x) => ({
      id: x.id,
      areaId: x.area_id,
      tableId: x.table_id,
      shiftId: x.shift_id,
      firstOrder: num(x.first_order_minutes),
      unsent: num(x.unsent_minutes),
      idle: num(x.idle_minutes),
      prebillPay: num(x.prebill_pay_minutes),
      total: num(x.total_minutes),
      warnPercent: num(x.warn_percent),
    }));
  }

  /** Versión de la configuración (la lleva la regla de la tienda). null si la tienda aún no tiene regla. */
  async version(storeId: string, q: Tx | null = null, lock = false): Promise<number | null> {
    const r = await (q ?? this.database.db).execute(
      sql`SELECT version FROM service_sla WHERE store_id = ${storeId} AND area_id IS NULL AND table_id IS NULL AND shift_id IS NULL
          ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    return num((r.rows as Row[])[0]?.version);
  }

  /** Crea la regla de la tienda si falta (tienda creada después de la migración), con los tiempos de Parámetros. */
  async ensureDefault(storeId: string, id: string): Promise<void> {
    await this.database.db.execute(
      sql`INSERT INTO service_sla (id, store_id, first_order_minutes, unsent_minutes, idle_minutes, prebill_pay_minutes, total_minutes, warn_percent)
          SELECT ${id}, ${storeId}, 10, 3, LEAST(GREATEST(COALESCE(p.idle_table_minutes, 30), 1), 600),
                 LEAST(GREATEST(COALESCE(p.prebill_to_pay_minutes, 6), 1), 600), 120, 80
          FROM store s LEFT JOIN store_parameters p ON p.store_id = s.id
          WHERE s.id = ${storeId}
            AND NOT EXISTS (SELECT 1 FROM service_sla x WHERE x.store_id = s.id AND x.area_id IS NULL AND x.table_id IS NULL AND x.shift_id IS NULL)`,
    );
  }

  /** Zonas y mesas activas, para elegir dónde va cada regla en Ajustes › SLA de atención. */
  async catalog(storeId: string) {
    const a = await this.database.db.execute(
      sql`SELECT id::text, name FROM area WHERE store_id = ${storeId} AND active ORDER BY sort_order, name`,
    );
    const t = await this.database.db.execute(
      sql`SELECT t.id::text, t.number, t.area_id::text FROM dining_table t JOIN area a ON a.id = t.area_id
          WHERE t.store_id = ${storeId} AND t.active AND a.active
          ORDER BY a.sort_order, (CASE WHEN t.number ~ '^[0-9]+$' THEN t.number::int END) NULLS LAST, t.number`,
    );
    return {
      areas: (a.rows as Row[]).map((x) => ({ id: x.id as string, name: x.name as string })),
      tables: (t.rows as Row[]).map((x) => ({
        id: x.id as string,
        number: x.number as string,
        areaId: x.area_id as string,
      })),
    };
  }

  /** Ids de las zonas y mesas de la tienda (para validar las reglas). */
  async places(tx: Tx, storeId: string): Promise<{ areas: Set<string>; tables: Set<string> }> {
    const a = await tx.execute(sql`SELECT id::text FROM area WHERE store_id = ${storeId}`);
    const t = await tx.execute(sql`SELECT id::text FROM dining_table WHERE store_id = ${storeId}`);
    return {
      areas: new Set((a.rows as Row[]).map((x) => x.id)),
      tables: new Set((t.rows as Row[]).map((x) => x.id)),
    };
  }

  /** Sustituye la configuración entera: turnos y reglas. La regla de la tienda se actualiza y sube de versión. */
  async replace(
    tx: Tx,
    storeId: string,
    shifts: SlaShift[],
    rules: (SlaRule & { id: string })[],
    version: number,
  ) {
    // reglas fuera primero (las de un turno que se quita se irían en cascada, pero así queda explícito)
    await tx.execute(
      sql`DELETE FROM service_sla WHERE store_id = ${storeId} AND NOT (area_id IS NULL AND table_id IS NULL AND shift_id IS NULL)`,
    );
    const keep = shifts.map((s) => s.id);
    await tx.execute(
      keep.length
        ? sql`DELETE FROM service_shift WHERE store_id = ${storeId} AND id::text NOT IN (${sql.join(
            keep.map((k) => sql`${k}`),
            sql`, `,
          )})`
        : sql`DELETE FROM service_shift WHERE store_id = ${storeId}`,
    );
    // dos pasos para poder intercambiar nombres entre turnos sin chocar con el UNIQUE (store_id, name)
    await tx.execute(sql`UPDATE service_shift SET name = '~' || id::text WHERE store_id = ${storeId}`);
    for (const [i, s] of shifts.entries()) {
      await tx.execute(
        sql`INSERT INTO service_shift (id, store_id, name, starts_at, ends_at, sort_order)
            VALUES (${s.id}, ${storeId}, ${s.name.trim()}, ${s.start}::time, ${s.end}::time, ${i + 1})
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
              sort_order = EXCLUDED.sort_order`,
      );
    }
    for (const r of rules) {
      const isDefault = !r.areaId && !r.tableId && !r.shiftId;
      if (isDefault) {
        await tx.execute(
          sql`UPDATE service_sla SET first_order_minutes = ${r.firstOrder}, unsent_minutes = ${r.unsent}, idle_minutes = ${r.idle},
                prebill_pay_minutes = ${r.prebillPay}, total_minutes = ${r.total}, warn_percent = ${r.warnPercent}, version = ${version + 1}
              WHERE store_id = ${storeId} AND area_id IS NULL AND table_id IS NULL AND shift_id IS NULL`,
        );
      } else {
        await tx.execute(
          sql`INSERT INTO service_sla (id, store_id, area_id, table_id, shift_id, first_order_minutes, unsent_minutes, idle_minutes,
                prebill_pay_minutes, total_minutes, warn_percent)
              VALUES (${r.id}, ${storeId}, ${r.areaId ?? null}, ${r.tableId ?? null}, ${r.shiftId ?? null}, ${r.firstOrder ?? null},
                ${r.unsent ?? null}, ${r.idle ?? null}, ${r.prebillPay ?? null}, ${r.total ?? null}, ${r.warnPercent ?? null})`,
        );
      }
    }
  }

  /**
   * Mesas abiertas con sus horas: apertura, primera línea marcada (aunque se quitara), lo vivo más antiguo sin enviar,
   * último envío a cocina (linePrinted o un pase marchado) y la precuenta más antigua de una cuenta sin cobrar.
   */
  async live(storeId: string): Promise<LiveRow[]> {
    const r = await this.database.db.execute(sql`
      SELECT o.id::text AS order_id, o.table_id::text, o.table_name, t.area_id::text, a.name AS area_name, o.guests,
             o.opened_by_user_name, o.last_entry_user_name, o.status, o.opened_by_at,
             (SELECT min(l.created_by_at) FROM order_line l WHERE l.order_id = o.id) AS first_line_at,
             (SELECT min(l.created_by_at) FROM order_line l
               WHERE l.order_id = o.id AND NOT l.deleted AND l.status = 'pendingPrint') AS oldest_unsent_at,
             (SELECT max(e.at) FROM order_event e WHERE e.order_id = o.id AND e.type IN ('linePrinted', 'courseFired')) AS last_sent_at,
             (SELECT min(e.at) FROM order_event e JOIN account ac ON ac.id = e.account_id
               WHERE e.order_id = o.id AND e.type = 'preBill' AND ac.status <> 'invoiced' AND ac.status <> 'cancelled') AS prebill_at,
             (SELECT coalesce(sum(ac.total), 0) FROM account ac WHERE ac.order_id = o.id AND ac.status <> 'cancelled') AS total
      FROM orders o
      LEFT JOIN dining_table t ON t.id = o.table_id
      LEFT JOIN area a ON a.id = t.area_id
      WHERE o.store_id = ${storeId} AND o.status IN ('open', 'billing')
      ORDER BY o.opened_by_at`);
    return (r.rows as Row[]).map((x) => ({
      orderId: x.order_id,
      tableId: x.table_id,
      tableName: x.table_name,
      areaId: x.area_id,
      areaName: x.area_name,
      guests: Number(x.guests),
      waiter: x.opened_by_user_name,
      lastUser: x.last_entry_user_name,
      status: x.status,
      openedAt: iso(x.opened_by_at)!,
      firstLineAt: iso(x.first_line_at),
      oldestUnsentAt: iso(x.oldest_unsent_at),
      lastSentAt: iso(x.last_sent_at),
      prebillAt: iso(x.prebill_at),
      total: Number(x.total),
    }));
  }

  /** Mesas ya cerradas del periodo abierto (para las medias de hoy). */
  async closedInOpenPeriod(storeId: string): Promise<ClosedRow[]> {
    const r = await this.database.db.execute(sql`
      SELECT o.id::text AS order_id, o.table_id::text, t.area_id::text, o.opened_by_user_name, o.opened_by_at, o.closed_at,
             (SELECT min(l.created_by_at) FROM order_line l WHERE l.order_id = o.id) AS first_line_at,
             (SELECT min(e.at) FROM order_event e WHERE e.order_id = o.id AND e.type = 'preBill') AS prebill_at
      FROM orders o
      JOIN sales_period p ON p.id = o.period_id AND p.status = 'open'
      LEFT JOIN dining_table t ON t.id = o.table_id
      WHERE o.store_id = ${storeId} AND o.status = 'closed' AND o.closed_at IS NOT NULL`);
    return (r.rows as Row[]).map((x) => ({
      orderId: x.order_id,
      tableId: x.table_id,
      areaId: x.area_id,
      waiter: x.opened_by_user_name,
      openedAt: iso(x.opened_by_at)!,
      firstLineAt: iso(x.first_line_at),
      prebillAt: iso(x.prebill_at),
      closedAt: iso(x.closed_at)!,
    }));
  }
}
