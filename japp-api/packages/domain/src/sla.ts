import { fail } from "./errors.js";
import { TZ } from "./invoice.js";

/**
 * SLA de atención por mesa (25/10/2026, migración 0017).
 * Gestiones › Mesas en servicio mide en vivo cada mesa abierta con lo que la base ya guarda (apertura, cuándo se marca
 * cada línea, cuándo se envía a cocina, la precuenta y el cobro) y lo compara con estos límites:
 *   firstOrder  de abrir la mesa a marcar lo primero (la toma de nota)
 *   unsent      lo marcado más antiguo que sigue sin enviarse a cocina
 *   idle        desde el último envío a cocina, sin nada nuevo ni precuenta (¿alguien pasa por la mesa?)
 *   prebillPay  de la precuenta al cobro
 *   total       la mesa abierta en total
 * Los límites van por tienda, zona o mesa y, cada uno, para todos los turnos o para uno. Manda la regla más concreta
 * (mesa+turno > mesa > zona+turno > zona > tienda+turno > tienda) y lo que una regla deja vacío lo hereda.
 * La mesa cuenta en el turno en que se abrió (hora de Madrid).
 */
export const SLA_METRICS = ["firstOrder", "unsent", "idle", "prebillPay", "total"] as const;
export type SlaMetric = (typeof SLA_METRICS)[number];
export const SLA_FIELDS = [...SLA_METRICS, "warnPercent"] as const;
export type SlaField = (typeof SLA_FIELDS)[number];
export type SlaLimits = Record<SlaField, number>;
export type SlaStatus = "ok" | "warn" | "late";

export const SLA_MAX_MINUTES = 600;
export const SLA_MAX_SHIFTS = 8;
export const SLA_DEFAULTS: SlaLimits = {
  firstOrder: 10,
  unsent: 3,
  idle: 30,
  prebillPay: 6,
  total: 120,
  warnPercent: 80,
};

export interface SlaShift {
  id: string;
  name: string;
  /** HH:MM, hora de Madrid. Si end < start, el turno pasa de medianoche. */
  start: string;
  end: string;
}
export interface SlaRule {
  areaId?: string | null;
  tableId?: string | null;
  shiftId?: string | null;
  firstOrder?: number | null;
  unsent?: number | null;
  idle?: number | null;
  prebillPay?: number | null;
  total?: number | null;
  warnPercent?: number | null;
}
export interface SlaConfig {
  shifts: SlaShift[];
  rules: SlaRule[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Tramos [desde, hasta) del día (0–1440) que cubre un turno; uno que pasa de medianoche son dos. */
function spans(s: SlaShift): [number, number][] {
  const a = mins(s.start);
  const b = mins(s.end);
  return a < b
    ? [[a, b]]
    : [
        [a, 1440],
        [0, b],
      ];
}

/** Minuto del día en Madrid. */
export function localMinute(at: Date, tz = TZ): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Turno al que pertenece una hora (el de la apertura de la mesa); null si cae fuera de todos. */
export function shiftAt(shifts: SlaShift[], at: Date, tz = TZ): SlaShift | null {
  const m = localMinute(at, tz);
  return shifts.find((s) => spans(s).some(([a, b]) => m >= a && m < b)) ?? null;
}

const isStore = (r: SlaRule) => !r.areaId && !r.tableId;
const scopeKey = (r: SlaRule) => `${r.areaId ?? "-"}|${r.tableId ?? "-"}|${r.shiftId ?? "-"}`;

/** Ámbito legible de una regla: «tienda», «zona», «mesa», con «+turno» si es de un turno. */
export function slaScope(r: SlaRule): string {
  const base = r.tableId ? "mesa" : r.areaId ? "zona" : "tienda";
  return r.shiftId ? `${base}+turno` : base;
}

/**
 * Límites que valen para una mesa: de la regla más concreta a la menos, campo a campo.
 * source dice de qué ámbito sale cada límite (para enseñar «heredado de la zona», por ejemplo).
 */
export function resolveSla(
  rules: SlaRule[],
  at: { areaId?: string | null; tableId?: string | null; shiftId?: string | null },
): { limits: SlaLimits; source: Record<SlaField, string> } {
  const sh = at.shiftId ?? null;
  const chain = [
    (r: SlaRule) => !!at.tableId && r.tableId === at.tableId && !!sh && r.shiftId === sh,
    (r: SlaRule) => !!at.tableId && r.tableId === at.tableId && !r.shiftId,
    (r: SlaRule) => !!at.areaId && r.areaId === at.areaId && !r.tableId && !!sh && r.shiftId === sh,
    (r: SlaRule) => !!at.areaId && r.areaId === at.areaId && !r.tableId && !r.shiftId,
    (r: SlaRule) => isStore(r) && !!sh && r.shiftId === sh,
    (r: SlaRule) => isStore(r) && !r.shiftId,
  ]
    .map((f) => rules.find(f))
    .filter((r): r is SlaRule => !!r);
  const limits = { ...SLA_DEFAULTS };
  const source = Object.fromEntries(SLA_FIELDS.map((f) => [f, "defecto"])) as Record<SlaField, string>;
  for (const f of SLA_FIELDS) {
    const r = chain.find((x) => x[f] != null);
    if (r) {
      limits[f] = r[f]!;
      source[f] = slaScope(r);
    }
  }
  return { limits, source };
}

/** Comprueba la configuración entera antes de guardarla (PUT /service/sla). VALIDATION con el campo que falla. */
export function validateSlaConfig(cfg: SlaConfig): void {
  const { shifts, rules } = cfg;
  if (shifts.length > SLA_MAX_SHIFTS) {
    fail("VALIDATION", `Como mucho ${SLA_MAX_SHIFTS} turnos`, { field: "shifts" });
  }
  const names = new Set<string>();
  shifts.forEach((s, i) => {
    const f = `shifts[${i}]`;
    const n = s.name.trim().toLowerCase();
    if (!n) {
      fail("VALIDATION", "El turno necesita un nombre", { field: `${f}.name` });
    }
    if (names.has(n)) {
      fail("VALIDATION", `Hay dos turnos que se llaman «${s.name.trim()}»`, { field: `${f}.name` });
    }
    names.add(n);
    for (const k of ["start", "end"] as const) {
      if (!HHMM.test(s[k])) {
        fail("VALIDATION", "La hora va como HH:MM", { field: `${f}.${k}` });
      }
    }
    if (s.start === s.end) {
      fail("VALIDATION", "El turno no puede empezar y acabar a la misma hora", { field: `${f}.end` });
    }
  });
  for (let i = 0; i < shifts.length; i++) {
    for (let j = 0; j < i; j++) {
      const cross = spans(shifts[i]!).some(([a, b]) => spans(shifts[j]!).some(([c, d]) => a < d && c < b));
      if (cross) {
        fail("VALIDATION", `Los turnos «${shifts[j]!.name}» y «${shifts[i]!.name}» se pisan`, {
          field: `shifts[${i}].start`,
        });
      }
    }
  }
  const ids = new Set(shifts.map((s) => s.id));
  const seen = new Set<string>();
  let defaults = 0;
  rules.forEach((r, i) => {
    const f = `rules[${i}]`;
    if (r.areaId && r.tableId) {
      fail("VALIDATION", "Una regla es de una zona o de una mesa, no de las dos", { field: `${f}.tableId` });
    }
    if (r.shiftId && !ids.has(r.shiftId)) {
      fail("VALIDATION", "Ese turno no existe", { field: `${f}.shiftId` });
    }
    const k = scopeKey(r);
    if (seen.has(k)) {
      fail("VALIDATION", "Hay dos reglas para el mismo sitio y turno", { field: f });
    }
    seen.add(k);
    for (const m of SLA_METRICS) {
      const v = r[m];
      if (v != null && (!Number.isInteger(v) || v < 1 || v > SLA_MAX_MINUTES)) {
        fail("VALIDATION", `Los minutos van de 1 a ${SLA_MAX_MINUTES}`, { field: `${f}.${m}` });
      }
    }
    if (
      r.warnPercent != null &&
      (!Number.isInteger(r.warnPercent) || r.warnPercent < 50 || r.warnPercent > 99)
    ) {
      fail("VALIDATION", "El aviso en ámbar va del 50 al 99 % del límite", { field: `${f}.warnPercent` });
    }
    const isDefault = isStore(r) && !r.shiftId;
    if (isDefault) {
      defaults++;
      const miss = SLA_FIELDS.find((x) => r[x] == null);
      if (miss) {
        fail("VALIDATION", "La regla de la tienda lleva todos los límites", { field: `${f}.${miss}` });
      }
    } else if (SLA_FIELDS.every((x) => r[x] == null)) {
      fail("VALIDATION", "La regla no cambia nada: pon al menos un límite o quítala", { field: f });
    }
  });
  if (defaults !== 1) {
    fail("VALIDATION", "Falta la regla de la tienda", { field: "rules" });
  }
}

/** Lo que la base sabe de una mesa abierta (todas las horas en ISO). */
export interface TableFacts {
  openedAt: string;
  /** Primera línea marcada (aunque luego se quitara). */
  firstLineAt: string | null;
  /** Línea viva más antigua aún sin enviar a cocina. */
  oldestUnsentAt: string | null;
  /** Último envío a cocina. */
  lastSentAt: string | null;
  /** Precuenta más antigua de una cuenta aún sin cobrar. */
  prebillAt: string | null;
}
export interface SlaReading {
  minutes: number;
  limit: number;
  status: SlaStatus;
  /** false = el reloj sigue corriendo; true = ese paso ya se hizo (p. ej. la toma ya está marcada). */
  done: boolean;
}
export type TableStage = "waiting" | "ordering" | "service" | "billing";

/** ok por debajo del aviso, warn desde el % de aviso, late pasado el límite. */
export function slaStatus(minutes: number, limit: number, warnPercent: number): SlaStatus {
  if (minutes > limit) {
    return "late";
  }
  return minutes >= (limit * warnPercent) / 100 ? "warn" : "ok";
}
const worst = (xs: SlaStatus[]): SlaStatus =>
  xs.includes("late") ? "late" : xs.includes("warn") ? "warn" : "ok";

/** Mide una mesa abierta contra sus límites. Cada paso sale null si no aplica todavía. */
export function measureTable(
  f: TableFacts,
  now: Date,
  limits: SlaLimits,
): { stage: TableStage; status: SlaStatus; metrics: Record<SlaMetric, SlaReading | null> } {
  const t = (x: string) => new Date(x).getTime();
  const m = (a: number, b: number) => Math.max(0, Math.round(((b - a) / 60000) * 10) / 10);
  const n = now.getTime();
  const read = (minutes: number, k: SlaMetric, done = false): SlaReading => ({
    minutes,
    limit: limits[k],
    status: slaStatus(minutes, limits[k], limits.warnPercent),
    done,
  });
  const metrics: Record<SlaMetric, SlaReading | null> = {
    firstOrder: f.firstLineAt
      ? read(m(t(f.openedAt), t(f.firstLineAt)), "firstOrder", true)
      : read(m(t(f.openedAt), n), "firstOrder"),
    unsent: f.oldestUnsentAt ? read(m(t(f.oldestUnsentAt), n), "unsent") : null,
    idle: f.lastSentAt && !f.oldestUnsentAt && !f.prebillAt ? read(m(t(f.lastSentAt), n), "idle") : null,
    prebillPay: f.prebillAt ? read(m(t(f.prebillAt), n), "prebillPay") : null,
    total: read(m(t(f.openedAt), n), "total"),
  };
  const stage: TableStage = f.prebillAt
    ? "billing"
    : f.oldestUnsentAt
      ? "ordering"
      : f.lastSentAt
        ? "service"
        : "waiting";
  const status = worst(
    Object.values(metrics)
      .filter((x): x is SlaReading => !!x)
      .map((x) => x.status),
  );
  return { stage, status, metrics };
}

/** Orden de la pantalla: primero lo que va peor (fuera de SLA, luego en aviso) y, dentro, lo que más se pasa. */
export function slaSeverity(r: { status: SlaStatus; metrics: Record<SlaMetric, SlaReading | null> }): number {
  const over = Math.max(
    ...Object.values(r.metrics)
      .filter((x): x is SlaReading => !!x && !x.done)
      .map((x) => x.minutes / x.limit),
    0,
  );
  return (r.status === "late" ? 2 : r.status === "warn" ? 1 : 0) * 1000 + over;
}
