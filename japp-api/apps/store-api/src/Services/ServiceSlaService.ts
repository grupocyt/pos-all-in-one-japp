import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import {
  fail,
  measureTable,
  resolveSla,
  shiftAt,
  slaSeverity,
  slaStatus,
  validateSlaConfig,
  type SlaLimits,
  type SlaRule,
} from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { ServiceSlaApplication } from "../Applications/ServiceSlaApplication.js";
import { PutSlaModel } from "../Models/ServiceSlaModels.js";
import { AuthorizationService } from "./AuthorizationService.js";

const r1 = (x: number) => Math.round(x * 10) / 10;
const minBetween = (a: string, b: string) =>
  Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);
const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const pct = (ok: number, n: number) => (n ? Math.round((ok / n) * 100) : null);

/** Un paso medido de una mesa cerrada: minutos y si quedó dentro del límite. */
interface Step {
  minutes: number;
  ok: boolean;
}

/**
 * SLA de atención (25/10/2026). Mide las mesas abiertas con lo que ya guarda la base y lo compara con los límites
 * de Ajustes › SLA de atención (por tienda, zona o mesa, y por turno; regla resolveSla de @japp/domain).
 * Ver: funciones.kpi. Configurar: ajustes.parametros (leer la configuración vale también con funciones.kpi).
 */
@Injectable()
export class ServiceSlaService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(ServiceSlaApplication) private readonly sla: ServiceSlaApplication,
  ) {}

  private async config(storeId: string) {
    await this.sla.ensureDefault(storeId, randomUUID());
    const [shifts, rules, version, places] = await Promise.all([
      this.sla.shifts(storeId),
      this.sla.rules(storeId),
      this.sla.version(storeId),
      this.sla.catalog(storeId),
    ]);
    return { version: version ?? 1, shifts, rules, ...places };
  }

  async get(se: Session) {
    await this.auth.requireAny(se, ["ajustes.parametros", "funciones.kpi"]);
    return this.config(se.storeId);
  }

  async put(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.parametros");
    const b = parse(PutSlaModel, body);
    const rules = b.rules.map((r) => ({ ...r, id: r.id ?? randomUUID() }));
    validateSlaConfig({ shifts: b.shifts, rules });
    await this.sla.ensureDefault(se.storeId, randomUUID());
    await this.database.withTx(async (tx) => {
      const cur = await this.sla.version(se.storeId, tx, true);
      if (cur !== b.version) {
        fail("VERSION_CONFLICT", "Otra persona cambió los SLA mientras los editabas: vuelve a abrirlos", {
          field: "version",
          current: cur,
        });
      }
      const { areas, tables } = await this.sla.places(tx, se.storeId);
      rules.forEach((r, i) => {
        if (r.areaId && !areas.has(r.areaId)) {
          fail("VALIDATION", "Esa zona no existe", { field: `rules[${i}].areaId` });
        }
        if (r.tableId && !tables.has(r.tableId)) {
          fail("VALIDATION", "Esa mesa no existe", { field: `rules[${i}].tableId` });
        }
      });
      await this.sla.replace(tx, se.storeId, b.shifts, rules, cur!);
    });
    return this.config(se.storeId);
  }

  /** Gestiones › Mesas en servicio. */
  async live(se: Session) {
    await this.auth.require(se, "funciones.kpi");
    const now = this.clock();
    const { shifts, rules } = await this.config(se.storeId);
    const [open, closed] = await Promise.all([
      this.sla.live(se.storeId),
      this.sla.closedInOpenPeriod(se.storeId),
    ]);
    const limitsOf = (x: { areaId: string | null; tableId: string | null; openedAt: string }) => {
      const sh = shiftAt(shifts, new Date(x.openedAt));
      return {
        shift: sh,
        ...resolveSla(rules as SlaRule[], { areaId: x.areaId, tableId: x.tableId, shiftId: sh?.id }),
      };
    };

    const items = open
      .map((o) => {
        const { shift, limits, source } = limitsOf(o);
        const m = measureTable(o, now, limits);
        return {
          orderId: o.orderId,
          tableId: o.tableId,
          tableName: o.tableName,
          areaId: o.areaId,
          areaName: o.areaName,
          guests: o.guests,
          waiter: o.waiter,
          lastUser: o.lastUser,
          total: o.total,
          openedAt: o.openedAt,
          shift: shift?.name ?? null,
          stage: m.stage,
          status: m.status,
          metrics: m.metrics,
          limits,
          source,
          severity: slaSeverity(m),
        };
      })
      .sort((a, b) => b.severity - a.severity)
      .map(({ severity: _s, ...x }) => x);

    // Medias de hoy: lo ya hecho en las mesas cerradas del periodo y la toma de las abiertas que ya marcaron.
    const steps = { firstOrder: [] as Step[], prebillPay: [] as Step[], total: [] as Step[] };
    const byWaiter = new Map<string, { firstOrder: Step[]; all: Step[]; closed: number }>();
    const w = (n: string) => {
      if (!byWaiter.has(n)) {
        byWaiter.set(n, { firstOrder: [], all: [], closed: 0 });
      }
      return byWaiter.get(n)!;
    };
    const push = (waiter: string, k: keyof typeof steps, minutes: number, limits: SlaLimits) => {
      const s = { minutes, ok: slaStatus(minutes, limits[k], limits.warnPercent) !== "late" };
      steps[k].push(s);
      w(waiter).all.push(s);
      if (k === "firstOrder") {
        w(waiter).firstOrder.push(s);
      }
    };
    for (const c of closed) {
      const { limits } = limitsOf(c);
      w(c.waiter).closed++;
      if (c.firstLineAt) {
        push(c.waiter, "firstOrder", minBetween(c.openedAt, c.firstLineAt), limits);
      }
      if (c.prebillAt) {
        push(c.waiter, "prebillPay", minBetween(c.prebillAt, c.closedAt), limits);
      }
      push(c.waiter, "total", minBetween(c.openedAt, c.closedAt), limits);
    }
    for (const i of items) {
      const f = i.metrics.firstOrder;
      if (f?.done) {
        push(i.waiter, "firstOrder", f.minutes, i.limits);
      }
    }
    const today = Object.fromEntries(
      Object.entries(steps).map(([k, xs]) => [
        k,
        {
          avg: avg(xs.map((x) => x.minutes)),
          onTimePct: pct(xs.filter((x) => x.ok).length, xs.length),
          n: xs.length,
        },
      ]),
    );

    const waiters = new Set([...items.map((i) => i.waiter), ...byWaiter.keys()]);
    const staff = [...waiters]
      .map((name) => {
        const mine = items.filter((i) => i.waiter === name);
        const h = byWaiter.get(name) ?? { firstOrder: [], all: [], closed: 0 };
        return {
          name,
          open: mine.length,
          late: mine.filter((i) => i.status === "late").length,
          warn: mine.filter((i) => i.status === "warn").length,
          closed: h.closed,
          firstOrderAvg: avg(h.firstOrder.map((x) => x.minutes)),
          onTimePct: pct(h.all.filter((x) => x.ok).length, h.all.length),
        };
      })
      .sort((a, b) => b.late - a.late || b.warn - a.warn || a.name.localeCompare(b.name));

    return {
      at: now.toISOString(),
      shift: shiftAt(shifts, now)?.name ?? null,
      summary: {
        open: items.length,
        late: items.filter((i) => i.status === "late").length,
        warn: items.filter((i) => i.status === "warn").length,
        ok: items.filter((i) => i.status === "ok").length,
        stages: {
          waiting: items.filter((i) => i.stage === "waiting").length,
          ordering: items.filter((i) => i.stage === "ordering").length,
          service: items.filter((i) => i.stage === "service").length,
          billing: items.filter((i) => i.stage === "billing").length,
        },
      },
      today: { closed: closed.length, ...today },
      staff,
      items,
    };
  }
}
