import { describe, expect, it } from "vitest";
import { assertMethodAllowed, chargeable, stationMethods } from "../src/index.js";

const st = { name: "CAJA1", kind: "station", methodIds: [] as string[] };
const card = { id: "c", code: "card", kind: "card", active: true };
const desc = { id: "d", code: "descuentos", kind: "discount", active: true, showInTpv: false };
const hidden = { id: "h", code: "glovo", kind: "platform", active: true, showInTpv: false };

describe("formas de pago que no se ven en el TPV (migración 0020)", () => {
  it("las de tipo descuento o «no mostrar en el TPV» no se cobran ni salen en el equipo", () => {
    expect(chargeable(card)).toBe(true);
    expect(chargeable(desc)).toBe(false);
    expect(chargeable({ ...desc, showInTpv: true })).toBe(false);
    expect(chargeable(hidden)).toBe(false);
    expect(stationMethods([card, desc, hidden], st).map((m) => m.id)).toEqual(["c"]);
    expect(() => assertMethodAllowed(desc, st, "descuentos")).toThrow(/no se cobra/);
    expect(() => assertMethodAllowed(hidden, st, "glovo")).toThrow(/no se cobra/);
    expect(assertMethodAllowed(card, st, "card")).toBe(card);
  });
});
