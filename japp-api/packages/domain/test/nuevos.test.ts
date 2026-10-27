import { DomainError } from "../src/errors.js";
import { identifyDevice, planClaimMain, isDeviceUuid, deviceTypeOf } from "../src/devices.js";
import {
  planSync,
  assertNoRepeats,
  assertSyncSize,
  resolveRef,
  assertNotInUse,
  syncCounts,
} from "../src/cartaSync.js";
import {
  ootToken,
  ootUrl,
  isOotToken,
  assertOotTokenLive,
  assertOotProduct,
  isOotProduct,
} from "../src/oot.js";
import { assertWholeCredit, creditTypeFor, planCredit, type CreditSource } from "../src/credit.js";
import { checkout } from "../src/checkout.js";
import { registerPayment } from "../src/payments.js";
import { accountTotals } from "../src/totals.js";
import { account, line, ctx } from "./helpers.js";

/** Errores: devuelve el código (y los detalles) o «OK». */
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return { code: (e as DomainError).code, details: (e as DomainError).details };
  }
  return { code: "OK", details: {} as Record<string, unknown> };
};
const code = (fn: () => unknown) => err(fn).code;

const U1 = "2a6c930e-b2a3-4f71-9281-e06f4d425746";
const U2 = "9f1d0c4e-1111-4222-8333-944455556666";
const ST = [
  { id: "c1", name: "CAJA1", kind: "station", isMain: true, deviceUuid: null, active: true },
  { id: "c2", name: "CAJA2", kind: "station", isMain: false, deviceUuid: U1.toUpperCase(), active: true },
  { id: "p1", name: "PDA1", kind: "pda", isMain: false, deviceUuid: U2, active: true },
  { id: "x", name: "VIEJA", kind: "station", isMain: false, deviceUuid: "0000", active: false },
];

describe("equipos: primer arranque", () => {
  it("reconoce el equipo por su UUID, sin mayúsculas", () => {
    expect(identifyDevice(ST, U1, "desktop").name).toBe("CAJA2");
    expect(identifyDevice(ST, ` ${U2.toUpperCase()} `, "mobile").name).toBe("PDA1");
  });
  it("sin estación con ese UUID → DEVICE_NOT_REGISTERED; una desactivada no cuenta", () => {
    expect(code(() => identifyDevice(ST, "11111111-2222-4333-8444-555555555555", "desktop"))).toBe(
      "DEVICE_NOT_REGISTERED",
    );
    expect(code(() => identifyDevice(ST, "0000", "desktop"))).toBe("DEVICE_NOT_REGISTERED");
  });
  it("PDA como escritorio (o al revés) → DEVICE_TYPE_MISMATCH con el tipo real", () => {
    const e = err(() => identifyDevice(ST, U2, "desktop"));
    expect(e.code).toBe("DEVICE_TYPE_MISMATCH");
    expect(e.details).toMatchObject({ expected: "desktop", actual: "mobile", station: "PDA1" });
    expect(code(() => identifyDevice(ST, U1, "mobile"))).toBe("DEVICE_TYPE_MISMATCH");
  });
  it("tipo de equipo y formato del UUID", () => {
    expect(deviceTypeOf({ kind: "pda" })).toBe("mobile");
    expect(deviceTypeOf({ kind: "station" })).toBe("desktop");
    expect(isDeviceUuid(U1)).toBe(true);
    expect(isDeviceUuid("CAJA1")).toBe(false);
  });
  it("caja principal: guarda el UUID en la principal y lo quita de la otra que lo tenía", () => {
    const p = planClaimMain(ST, U1);
    expect(p.main.name).toBe("CAJA1");
    expect(p.previousUuid).toBeNull();
    expect(p.clearFrom.map((s) => s.name)).toEqual(["CAJA2"]);
    expect(p.unchanged).toBe(false);
    const again = planClaimMain([{ ...ST[0]!, deviceUuid: U1 }, ST[2]!], U1.toUpperCase());
    expect(again.unchanged).toBe(true);
  });
  it("sin caja principal → NOT_FOUND", () => {
    expect(code(() => planClaimMain(ST.slice(1), U1))).toBe("NOT_FOUND");
  });
});

const E = (id: string, naturalKey: string, externalId: string | null = null, active = true) => ({
  id,
  naturalKey,
  externalId,
  active,
});

describe("sync de la carta desde el App Manager", () => {
  const existing = [
    E("a", "BEBIDAS", "MGR-1"),
    E("b", "TAPAS"),
    E("c", "VINOS"),
    E("d", "POSTRES", "MGR-9", false),
    E("e", "CAFES", "MGR-5"),
  ];
  it("casa por externalId (aunque cambie el nombre), luego por nombre; crea lo nuevo y quita lo que no viene", () => {
    const plan = planSync(existing, [
      { externalId: "MGR-1", naturalKey: "BEBIDAS FRIAS" },
      { externalId: "MGR-2", naturalKey: "tapas" },
      { externalId: "MGR-9", naturalKey: "POSTRES" },
      { externalId: "MGR-3", naturalKey: "NUEVA" },
    ]);
    expect(plan.items.map((x) => [x.existing?.id ?? null, x.action])).toEqual([
      ["a", "updated"],
      ["b", "updated"],
      ["d", "reactivated"],
      [null, "created"],
    ]);
    expect(plan.deactivate.map((x) => x.id)).toEqual(["c", "e"]);
  });
  it("por nombre no casa con uno que tiene otro externalId (es otro registro del Manager)", () => {
    const plan = planSync(existing, [{ externalId: "MGR-7", naturalKey: "CAFES" }]);
    expect(plan.items[0]!.action).toBe("created");
    expect(plan.deactivate.map((x) => x.id)).toContain("e");
  });
  it("keyFirst (productos): la clave natural manda sobre el externalId, primero todo lo que trae clave", () => {
    const existing = [
      { id: "p1", externalId: "MGR-A", naturalKey: "100", active: true },
      { id: "p2", externalId: null, naturalKey: "200", active: true },
    ];
    // el Manager manda el PLU 200 con el id que tenía el 100, y el 100 con otro id
    const plan = planSync(
      existing,
      [
        { externalId: "MGR-A", naturalKey: "200" },
        { externalId: "MGR-B", naturalKey: "100" },
      ],
      { keyFirst: true },
    );
    expect(plan.items.map((m) => [m.existing?.id, m.action])).toEqual([
      ["p2", "updated"],
      ["p1", "updated"],
    ]);
    expect(plan.deactivate).toEqual([]);
    // sin keyFirst gana el externalId
    expect(planSync(existing, [{ externalId: "MGR-A", naturalKey: "200" }]).items[0]!.existing?.id).toBe(
      "p1",
    );
  });
  it("producto nuevo sin PLU: solo por externalId", () => {
    const plan = planSync([E("p", "1042", "MGR-P-1")], [{ externalId: "MGR-P-2", naturalKey: null }]);
    expect(plan.items[0]!.action).toBe("created");
  });
  it("repetidos en la lista → DUPLICATE con la fila", () => {
    const e = err(() =>
      assertNoRepeats(
        [
          { externalId: "X", naturalKey: "A" },
          { externalId: "X", naturalKey: "B" },
        ],
        "name",
      ),
    );
    expect(e.code).toBe("DUPLICATE");
    expect(e.details.field).toBe("items[1].externalId");
    expect(
      err(() => assertNoRepeats([{ naturalKey: "A" }, { naturalKey: " a" }], "name")).details.field,
    ).toBe("items[1].name");
  });
  it("límites, referencias e IN_USE", () => {
    expect(code(() => assertSyncSize("productos", 2001, 2000))).toBe("TOO_LARGE");
    expect(code(() => assertSyncSize("productos", 2000, 2000))).toBe("OK");
    const m = new Map([["MGR-CAT-01", "id1"]]);
    expect(resolveRef(m, "MGR-CAT-01", "items[0].categoryExternalId", "la categoría")).toBe("id1");
    const r = err(() => resolveRef(m, "MGR-X", "items[3].categoryExternalId", "la categoría"));
    expect(r.code).toBe("REF_NOT_FOUND");
    expect(r.details.field).toBe("items[3].categoryExternalId");
    expect(code(() => assertNotInUse([{ name: "VINOS", count: 0 }], "la categoría"))).toBe("OK");
    expect(code(() => assertNotInUse([{ name: "VINOS", count: 3 }], "la categoría"))).toBe("IN_USE");
  });
  it("resumen", () => {
    expect(syncCounts(["created", "updated", "reactivated", "unchanged"], 2)).toEqual({
      created: 1,
      updated: 2,
      deactivated: 2,
      unchanged: 1,
    });
  });
});

describe("Order on Table", () => {
  const bytes = new Uint8Array(32).map((_, i) => i * 7);
  it("token opaco con prefijo y URL del QR", () => {
    const t = ootToken(bytes);
    expect(t.startsWith("oot_")).toBe(true);
    expect(t).toHaveLength(36);
    expect(isOotToken(t)).toBe(true);
    expect(isOotToken("oot_x")).toBe(false);
    expect(ootUrl("https://pedir.canasytapas.com/", t)).toBe(`https://pedir.canasytapas.com/t/${t}`);
    expect(() => ootToken(new Uint8Array(8))).toThrow();
  });
  it("sin URL en Restaurante → OOT_NOT_CONFIGURED", () => {
    expect(code(() => ootUrl(null, "oot_x"))).toBe("OOT_NOT_CONFIGURED");
    expect(code(() => ootUrl("  ", "oot_x"))).toBe("OOT_NOT_CONFIGURED");
  });
  it("token anulado o mesa cerrada → OOT_TOKEN_INVALID", () => {
    expect(code(() => assertOotTokenLive(null))).toBe("OOT_TOKEN_INVALID");
    expect(code(() => assertOotTokenLive({ orderStatus: "open", revokedAt: new Date() }))).toBe(
      "OOT_TOKEN_INVALID",
    );
    expect(code(() => assertOotTokenLive({ orderStatus: "closed", revokedAt: null }))).toBe(
      "OOT_TOKEN_INVALID",
    );
    expect(code(() => assertOotTokenLive({ orderStatus: "open", revokedAt: null }))).toBe("OK");
  });
  it("solo productos de Order on Table con su categoría marcada; agotado no", () => {
    const p = {
      plu: 1042,
      name: "Caña",
      active: true,
      soldOut: false,
      answerOnly: false,
      orderOnTable: true,
      category: { orderOnTable: true, hidden: false, active: true },
    };
    expect(isOotProduct(p)).toBe(true);
    expect(code(() => assertOotProduct(p, 1042, 0))).toBe("OK");
    expect(
      code(() => assertOotProduct({ ...p, category: { ...p.category, orderOnTable: false } }, 1042, 0)),
    ).toBe("PRODUCT_NOT_OOT");
    expect(code(() => assertOotProduct({ ...p, orderOnTable: false }, 1042, 0))).toBe("PRODUCT_NOT_OOT");
    expect(code(() => assertOotProduct(null, 9, 2))).toBe("PRODUCT_NOT_OOT");
    expect(err(() => assertOotProduct({ ...p, soldOut: true }, 1042, 1)).details).toMatchObject({
      field: "items[1].plu",
      soldOut: true,
    });
  });
});

describe("abono (rectificativa)", () => {
  const src = (over: Partial<CreditSource> = {}): CreditSource => ({
    lines: [
      { lineId: "l1", name: "Caña", quantity: 3, unitPrice: 2.5, taxRate: 10, modifiers: [] },
      { lineId: "l2", name: "Camiseta", quantity: 1, unitPrice: 15, taxRate: 21, modifiers: [] },
    ],
    sub: 22.5,
    total: 22.5,
    taxes: [
      { rate: 10, base: 6.82, tax: 0.68 },
      { rate: 21, base: 12.4, tax: 2.6 },
    ],
    creditedQty: {},
    creditedTotal: 0,
    creditedTaxes: [],
    ...over,
  });
  it("solo abono total (27/10/2026): con líneas → VALIDATION en lines", () => {
    expect(() => assertWholeCredit(null)).not.toThrow();
    expect(() => assertWholeCredit([])).not.toThrow();
    expect(code(() => assertWholeCredit([{ lineId: "l1", quantity: 1 }]))).toBe("VALIDATION");
  });
  it("tipo: simplificada → R5, completa → R1; una rectificativa no se abona", () => {
    expect(creditTypeFor("F2")).toBe("R5");
    expect(creditTypeFor("F1")).toBe("R1");
    expect(code(() => creditTypeFor("R5"))).toBe("VALIDATION");
  });
  it("total: todo lo que queda, con el IVA exacto de la factura", () => {
    const p = planCredit(src(), null);
    expect(p.full).toBe(true);
    expect(p.total).toBe(22.5);
    expect(p.taxes).toEqual(src().taxes);
    expect(p.lines.map((l) => [l.lineId, l.quantity, l.amount])).toEqual([
      ["l1", 3, 7.5],
      ["l2", 1, 15],
    ]);
  });
  it("parcial: unidades de una línea, con su parte del descuento", () => {
    const p = planCredit(src({ total: 20.25 }), [{ lineId: "l1", quantity: 2 }]);
    expect(p.full).toBe(false);
    expect(p.total).toBe(4.5); // 5,00 × 0,9
    expect(p.taxes).toEqual([{ rate: 10, base: 4.09, tax: 0.41 }]);
  });
  it("lo ya abonado no se abona otra vez → QUANTITY_EXCEEDS", () => {
    const s = src({
      creditedQty: { l1: 2 },
      creditedTotal: 5,
      creditedTaxes: [{ rate: 10, base: 4.55, tax: 0.45 }],
    });
    expect(code(() => planCredit(s, [{ lineId: "l1", quantity: 2 }]))).toBe("QUANTITY_EXCEEDS");
    const rest = planCredit(s, null);
    expect(rest.full).toBe(true);
    expect(rest.total).toBe(17.5);
    expect(rest.taxes).toEqual([
      { rate: 10, base: 2.27, tax: 0.23 },
      { rate: 21, base: 12.4, tax: 2.6 },
    ]);
    const all = src({ creditedQty: { l1: 3, l2: 1 }, creditedTotal: 22.5 });
    expect(code(() => planCredit(all, null))).toBe("QUANTITY_EXCEEDS");
  });
  it("línea que no es de la factura, repetida o cantidad 0 → VALIDATION", () => {
    expect(code(() => planCredit(src(), [{ lineId: "zz", quantity: 1 }]))).toBe("VALIDATION");
    expect(
      code(() =>
        planCredit(src(), [
          { lineId: "l1", quantity: 1 },
          { lineId: "l1", quantity: 1 },
        ]),
      ),
    ).toBe("VALIDATION");
    expect(code(() => planCredit(src(), [{ lineId: "l1", quantity: 0 }]))).toBe("VALIDATION");
  });
  it("Σ abonos = factura: tres abonos de una unidad cuadran al céntimo", () => {
    const s = src({
      lines: [{ lineId: "l1", name: "x", quantity: 3, unitPrice: 3.33, taxRate: 10, modifiers: [] }],
    });
    s.sub = 9.99;
    s.total = 9.0; // descuento de 0,99
    s.taxes = [{ rate: 10, base: 8.18, tax: 0.82 }];
    const a = planCredit(s, [{ lineId: "l1", quantity: 1 }]);
    const b = planCredit({ ...s, creditedQty: { l1: 1 }, creditedTotal: a.total, creditedTaxes: a.taxes }, [
      { lineId: "l1", quantity: 1 },
    ]);
    const c = planCredit(
      {
        ...s,
        creditedQty: { l1: 2 },
        creditedTotal: a.total + b.total,
        creditedTaxes: [
          { rate: 10, base: a.taxes[0]!.base + b.taxes[0]!.base, tax: a.taxes[0]!.tax + b.taxes[0]!.tax },
        ],
      },
      null,
    );
    expect(Math.round((a.total + b.total + c.total) * 100)).toBe(900);
    expect(c.full).toBe(true);
  });
});

describe("cobrar y facturar en una llamada (checkout)", () => {
  const CFG = { serieF: "F2026", serieT: "T2026", nif: "B12345678" };
  const acc = () => account({ lines: [line({ unitPrice: 24.3, quantity: 2, taxRate: 10 })] });
  it("efectivo + tarjeta → factura F2, cambio del efectivo", () => {
    const r = checkout(
      acc(),
      [
        { method: "cash", kind: "cash", amount: 30, cashGiven: 50 },
        { method: "card", kind: "card", amount: 18.6 },
      ],
      412,
      CFG,
      ctx(),
    );
    expect(r.account.status).toBe("invoiced");
    expect(r.account.invoice?.invoiceNumber).toBe("T2026-000412");
    expect(r.change).toBe(20);
    expect(r.payments).toHaveLength(2);
  });
  it("sin importe = lo pendiente; tras pagos parciales solo cobra lo que falta", () => {
    const partial = registerPayment(acc(), { method: "card", kind: "card", amount: 10 }, ctx()).account;
    const r = checkout(partial, [{ method: "cash", kind: "cash" }], 1, CFG, ctx());
    expect(r.payments[0]!.amount).toBe(38.6);
    expect(accountTotals(r.account).pending).toBe(0);
  });
  it("no llega a 0 → PENDING_NOT_ZERO (no se guarda nada)", () => {
    const e = err(() => checkout(acc(), [{ method: "card", kind: "card", amount: 10 }], 1, CFG, ctx()));
    expect(e.code).toBe("PENDING_NOT_ZERO");
    expect(e.details.pending).toBe(38.6);
  });
  it("el error de un pago dice su fila", () => {
    const e = err(() =>
      checkout(
        acc(),
        [
          { method: "card", kind: "card", amount: 10 },
          { method: "cash", kind: "cash", amount: 38.6, cashGiven: 5 },
        ],
        1,
        CFG,
        ctx(),
      ),
    );
    expect(e.code).toBe("VALIDATION");
    expect(e.details.field).toBe("payments[1].cashGiven");
    expect(code(() => checkout(acc(), [{ method: "card", kind: "card", amount: 99 }], 1, CFG, ctx()))).toBe(
      "AMOUNT_EXCEEDS_PENDING",
    );
  });
});
