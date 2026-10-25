import { describe, expect, it } from "vitest";
import {
  measureTable,
  resolveSla,
  shiftAt,
  slaSeverity,
  slaStatus,
  validateSlaConfig,
  DomainError,
  type SlaConfig,
  type SlaRule,
} from "../src/index.js";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("no falló");
};
const COMIDA = { id: "c", name: "Comida", start: "12:00", end: "16:30" };
const CENA = { id: "n", name: "Cena", start: "19:30", end: "00:30" };
const STORE: SlaRule = { firstOrder: 10, unsent: 3, idle: 30, prebillPay: 6, total: 120, warnPercent: 80 };

describe("turnos", () => {
  it("la mesa cuenta en el turno de su apertura, en hora de Madrid, también pasada la medianoche", () => {
    // 25/10/2026 es horario de invierno (UTC+1)
    expect(shiftAt([COMIDA, CENA], new Date("2026-10-25T13:00:00Z"))?.name).toBe("Comida"); // 14:00
    expect(shiftAt([COMIDA, CENA], new Date("2026-10-25T23:10:00Z"))?.name).toBe("Cena"); // 00:10
    expect(shiftAt([COMIDA, CENA], new Date("2026-10-25T16:00:00Z"))).toBeNull(); // 17:00
    expect(shiftAt([COMIDA, CENA], new Date("2026-07-01T10:30:00Z"))?.name).toBe("Comida"); // verano 12:30
  });
});

describe("qué límite manda", () => {
  const rules: SlaRule[] = [
    STORE,
    { shiftId: "n", total: 150 },
    { areaId: "TERRAZA", firstOrder: 12, idle: 40 },
    { areaId: "TERRAZA", shiftId: "n", firstOrder: 15 },
    { tableId: "M7", firstOrder: 5 },
    { tableId: "M7", shiftId: "c", prebillPay: 4 },
  ];
  it("la regla más concreta gana campo a campo y lo vacío se hereda", () => {
    const r = resolveSla(rules, { areaId: "TERRAZA", tableId: "M7", shiftId: "c" });
    expect(r.limits).toEqual({
      firstOrder: 5,
      unsent: 3,
      idle: 40,
      prebillPay: 4,
      total: 120,
      warnPercent: 80,
    });
    expect(r.source).toMatchObject({
      firstOrder: "mesa",
      idle: "zona",
      prebillPay: "mesa+turno",
      unsent: "tienda",
    });
  });
  it("zona+turno por encima de zona, y tienda+turno por encima de tienda", () => {
    const r = resolveSla(rules, { areaId: "TERRAZA", tableId: "M9", shiftId: "n" });
    expect([r.limits.firstOrder, r.limits.idle, r.limits.total]).toEqual([15, 40, 150]);
    expect(r.source.total).toBe("tienda+turno");
  });
  it("una mesa de otra zona fuera de turno solo usa la tienda", () => {
    expect(resolveSla(rules, { areaId: "SALON", tableId: "M1", shiftId: null }).limits.firstOrder).toBe(10);
  });
});

describe("validar la configuración", () => {
  const ok: SlaConfig = { shifts: [COMIDA, CENA], rules: [STORE, { areaId: "T", shiftId: "n", idle: 20 }] };
  it("una configuración buena pasa", () => {
    expect(() => validateSlaConfig(ok)).not.toThrow();
  });
  it("turnos que se pisan (también cruzando la medianoche)", () => {
    const e = err(() =>
      validateSlaConfig({
        shifts: [CENA, { id: "x", name: "Copas", start: "00:00", end: "03:00" }],
        rules: [STORE],
      }),
    );
    expect([e.code, e.details.field]).toEqual(["VALIDATION", "shifts[1].start"]);
  });
  it("horas mal escritas, nombre repetido o el mismo inicio y fin", () => {
    expect(
      err(() => validateSlaConfig({ shifts: [{ ...COMIDA, start: "25:00" }], rules: [STORE] })).details.field,
    ).toBe("shifts[0].start");
    expect(
      err(() => validateSlaConfig({ shifts: [COMIDA, { ...CENA, name: "comida" }], rules: [STORE] })).details
        .field,
    ).toBe("shifts[1].name");
    expect(
      err(() => validateSlaConfig({ shifts: [{ ...COMIDA, end: "12:00" }], rules: [STORE] })).details.field,
    ).toBe("shifts[0].end");
  });
  it("la tienda lleva todos los límites; las demás al menos uno; sin repetir sitio; minutos 1–600", () => {
    expect(
      err(() => validateSlaConfig({ shifts: [], rules: [{ ...STORE, total: null }] })).details.field,
    ).toBe("rules[0].total");
    expect(
      err(() => validateSlaConfig({ shifts: [], rules: [{ areaId: "T", idle: 5 }] })).details.field,
    ).toBe("rules");
    expect(err(() => validateSlaConfig({ shifts: [], rules: [STORE, { areaId: "T" }] })).details.field).toBe(
      "rules[1]",
    );
    expect(
      err(() =>
        validateSlaConfig({
          shifts: [],
          rules: [STORE, { areaId: "T", idle: 5 }, { areaId: "T", total: 9 }],
        }),
      ).details.field,
    ).toBe("rules[2]");
    expect(
      err(() => validateSlaConfig({ shifts: [], rules: [STORE, { tableId: "M", idle: 601 }] })).details.field,
    ).toBe("rules[1].idle");
    expect(
      err(() => validateSlaConfig({ shifts: [], rules: [STORE, { areaId: "A", tableId: "M", idle: 5 }] }))
        .details.field,
    ).toBe("rules[1].tableId");
    expect(
      err(() => validateSlaConfig({ shifts: [], rules: [STORE, { shiftId: "zz", idle: 5 }] })).details.field,
    ).toBe("rules[1].shiftId");
    expect(
      err(() => validateSlaConfig({ shifts: [], rules: [{ ...STORE, warnPercent: 40 }] })).details.field,
    ).toBe("rules[0].warnPercent");
  });
});

describe("medir una mesa", () => {
  const L = { firstOrder: 10, unsent: 3, idle: 30, prebillPay: 6, total: 120, warnPercent: 80 };
  const now = new Date("2026-10-25T14:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();

  it("verde, ámbar desde el % de aviso y rojo pasado el límite", () => {
    expect([
      slaStatus(7, 10, 80),
      slaStatus(8, 10, 80),
      slaStatus(10, 10, 80),
      slaStatus(10.1, 10, 80),
    ]).toEqual(["ok", "warn", "warn", "late"]);
  });
  it("sin marcar nada: el reloj de la toma corre desde la apertura", () => {
    const r = measureTable(
      { openedAt: ago(12), firstLineAt: null, oldestUnsentAt: null, lastSentAt: null, prebillAt: null },
      now,
      L,
    );
    expect(r.stage).toBe("waiting");
    expect(r.metrics.firstOrder).toEqual({ minutes: 12, limit: 10, status: "late", done: false });
    expect([r.metrics.unsent, r.metrics.idle, r.metrics.prebillPay]).toEqual([null, null, null]);
    expect(r.status).toBe("late");
  });
  it("marcado sin enviar: cuenta lo más antiguo pendiente y no hay tiempo sin atender", () => {
    const r = measureTable(
      {
        openedAt: ago(20),
        firstLineAt: ago(15),
        oldestUnsentAt: ago(2.5),
        lastSentAt: ago(10),
        prebillAt: null,
      },
      now,
      L,
    );
    expect(r.stage).toBe("ordering");
    expect(r.metrics.firstOrder).toMatchObject({ minutes: 5, status: "ok", done: true });
    expect(r.metrics.unsent).toMatchObject({ minutes: 2.5, status: "warn" });
    expect(r.metrics.idle).toBeNull();
    expect(r.status).toBe("warn");
  });
  it("todo enviado: tiempo desde el último envío; en precuenta solo cuenta la espera del cobro", () => {
    const a = measureTable(
      { openedAt: ago(60), firstLineAt: ago(55), oldestUnsentAt: null, lastSentAt: ago(35), prebillAt: null },
      now,
      L,
    );
    expect([a.stage, a.metrics.idle?.status, a.status]).toEqual(["service", "late", "late"]);
    const b = measureTable(
      {
        openedAt: ago(60),
        firstLineAt: ago(55),
        oldestUnsentAt: null,
        lastSentAt: ago(35),
        prebillAt: ago(4),
      },
      now,
      L,
    );
    expect([b.stage, b.metrics.idle, b.metrics.prebillPay?.status, b.status]).toEqual([
      "billing",
      null,
      "ok",
      "ok",
    ]);
  });
  it("las mesas fuera de SLA van primero, y entre ellas la que más se pasa", () => {
    const f = (o: number) =>
      measureTable(
        { openedAt: ago(o), firstLineAt: null, oldestUnsentAt: null, lastSentAt: null, prebillAt: null },
        now,
        L,
      );
    const xs = [f(5), f(30), f(9), f(14)].sort((a, b) => slaSeverity(b) - slaSeverity(a));
    expect(xs.map((x) => x.metrics.firstOrder!.minutes)).toEqual([30, 14, 9, 5]);
  });
});
