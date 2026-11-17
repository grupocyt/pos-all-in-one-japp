import { beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, PIN, type T } from "./helpers.js";

/**
 * 1.2.274 (16/11/2026): lo que pidió auditoría para el arqueo (reunión con Julián y Francisco): base contada al abrir,
 * corte X contado en pantalla con las propinas confirmadas y ticket corto, ticket detallado desde Movimiento de caja,
 * retiro = traslado a caja fuerte, caja chica de 50 € aparte y arqueos de auditoría separados.
 */
let t: T;
let sis: string;
const cents = (x: number) => ({ "0.01": Math.round(x * 100) }); // desglose que suma justo x
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
});

describe("apertura con la base contada", () => {
  it("sin motivo y con descuadre grande → 422 note con lo esperado; contada bien → abre y queda «apertura» en Movimiento de caja", async () => {
    await t.sql.query("UPDATE sales_period SET status = 'closed', open_flag = NULL, closed_by_user_name = 'Prueba', closed_by_at = now() WHERE open_flag = 1");
    const bad = await t.call("POST", "/periods", { token: sis, body: { countedFloat: 1, detail: { "1": 1 } } });
    expect([bad.status, bad.error.field]).toEqual([422, "note"]);
    const exp = bad.error.details.expectedFloat as number;
    expect(typeof exp).toBe("number");
    const sum = await t.call("POST", "/periods", { token: sis, body: { countedFloat: exp, detail: { "1": 1 } } });
    expect([sum.status, sum.error.field]).toEqual([422, "detail"]); // el desglose no suma lo contado
    const ok = await t.call("POST", "/periods", { token: sis, body: { countedFloat: exp, detail: cents(exp) } });
    expect(ok.status).toBe(201);
    expect(ok.body.opening).toEqual({ expected: exp, counted: exp, difference: 0 });
    const mv = await t.call("GET", "/cash/movements", { token: sis });
    const ap = mv.body.items.find((x: any) => x.type === "apertura");
    expect(ap).toMatchObject({ kind: "count", amount: exp, difference: 0, printable: false, expected: { cash: exp } });
  });
});

describe("corte X contado en pantalla", () => {
  it("sin confirmar las propinas → 422; cuadrado → ticket corto impreso y en Movimiento de caja con propinas; el detallado se imprime aparte", async () => {
    await ensurePeriod(t, sis);
    const s = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(s).toHaveProperty("cardTips");
    expect(s.expectedCard).toBe(Math.round((s.cardSales + s.cardTips) * 100) / 100);
    const base = { type: "cortex", countedCash: s.expectedCash, detail: cents(s.expectedCash), cards: [{ name: "Datáfono 1", amount: s.expectedCard }] };
    const noTips = await t.call("POST", "/cash/counts", { token: sis, body: base });
    expect([noTips.status, noTips.error.field]).toEqual([422, "tipsConfirmed"]);
    const big = await t.call("POST", "/cash/counts", { token: sis, body: { ...base, countedCash: s.expectedCash + 50, detail: cents(s.expectedCash + 50), tipsConfirmed: true } });
    expect([big.status, big.error.field, big.error.details.difference]).toEqual([422, "note", 50]);
    t.printer.jobs.length = 0;
    const ok = await t.call("POST", "/cash/counts", { token: sis, body: { ...base, tipsConfirmed: true } });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ type: "cortex", difference: 0, cardDifference: 0, tips: { confirmed: true } });
    const txt = JSON.stringify(ok.body.ticket);
    expect(txt).toContain("CORTE X · ARQUEO");
    expect(txt).toContain("PROPINAS");
    expect(txt).toContain("Datáfono 1");
    expect(t.printer.jobs.at(-1)!.title).toBe("Corte X");
    const mv = (await t.call("GET", "/cash/movements", { token: sis })).body.items.find((x: any) => x.id === ok.body.id);
    expect(mv).toMatchObject({ type: "cortex", difference: 0, printable: true, tips: { confirmed: true } });
    const det = await t.call("POST", `/cash/counts/${ok.body.id}/print`, { token: sis });
    expect(JSON.stringify(det.body.ticket)).toContain("ARQUEO · RESUMEN DE CAJA");
  });
});

describe("arqueos de auditoría", () => {
  it("solo con funciones.arqueoAuditoria; van a scope=audit y no a la operativa", async () => {
    const s = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const barra = await t.login(PIN.barra);
    const no = await t.call("POST", "/cash/counts", { token: barra, body: { type: "auditoria", countedCash: s.expectedCash } });
    expect(no.error.code).toBe("PERMISSION_REQUIRED");
    expect((await t.call("GET", "/cash/movements?scope=audit", { token: barra })).error.code).toBe("PERMISSION_REQUIRED");
    const sis2 = await t.login(PIN.sistemas);
    const ok = await t.call("POST", "/cash/counts", { token: sis2, body: { type: "auditoria", countedCash: s.expectedCash, cards: [{ name: "Datáfono 1", amount: s.expectedCard }] } });
    expect(ok.status).toBe(201);
    expect(JSON.stringify(ok.body.ticket)).toContain("ARQUEO DE AUDITORÍA");
    const audit = (await t.call("GET", "/cash/movements?scope=audit", { token: sis2 })).body.items.map((x: any) => x.id);
    const ops = (await t.call("GET", "/cash/movements?scope=ops", { token: sis2 })).body.items.map((x: any) => x.id);
    expect(audit).toContain(ok.body.id);
    expect(ops).not.toContain(ok.body.id);
    sis = sis2;
  });
});

describe("retiro = traslado a caja fuerte", () => {
  it("sin motivo queda «Traslado a caja fuerte» y resta de lo esperado", async () => {
    const before = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const r = await t.call("POST", "/cash/movements", { token: sis, body: { kind: "withdrawal", amount: 5 } });
    expect(r.status).toBe(201);
    const after = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(after.expectedCash).toBe(Math.round((before.expectedCash - 5) * 100) / 100);
    const mv = (await t.call("GET", "/cash/movements", { token: sis })).body.items.find((x: any) => x.id === r.body.id);
    expect(mv).toMatchObject({ kind: "withdrawal", amount: 5, note: "Traslado a caja fuerte" });
  });
});

describe("caja chica (1.2.281: ingresos libres y gastos con foto, aparte del cajón)", () => {
  it("ingreso libre; gasto con descripción hasta el saldo y con foto; más → 422 PETTY_CASH_LIMIT; en el corte X; no toca lo esperado; sin permiso → 403", async () => {
    const p0 = (await t.call("GET", "/cash/petty", { token: sis })).body;
    const b0 = p0.balance as number;
    const cash0 = (await t.call("GET", "/cash/summary", { token: sis })).body.expectedCash;
    const dep = await t.call("POST", "/cash/petty", { token: sis, body: { kind: "deposit", amount: 100 } });
    expect([dep.status, dep.body.balance]).toEqual([201, b0 + 100]);
    const noReason = await t.call("POST", "/cash/petty", { token: sis, body: { kind: "expense", amount: 5 } });
    expect([noReason.status, noReason.error.field]).toEqual([422, "reason"]);
    const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    const e1 = await t.call("POST", "/cash/petty", { token: sis, body: { kind: "expense", amount: 12.5, reason: "Hielo urgente", photo } });
    expect([e1.status, e1.body.balance]).toEqual([201, b0 + 87.5]);
    const badPhoto = await t.call("POST", "/cash/petty", { token: sis, body: { kind: "expense", amount: 1, reason: "x", photo: "javascript:alert(1)" } });
    expect(badPhoto.status).toBe(422);
    const over = await t.call("POST", "/cash/petty", { token: sis, body: { kind: "expense", amount: b0 + 88, reason: "Bombona" } });
    expect([over.status, over.error.code]).toEqual([422, "PETTY_CASH_LIMIT"]);
    expect((await t.call("POST", "/cash/petty", { token: sis, body: { kind: "replenish" } })).status).toBe(422); // ya no existe
    const p1 = (await t.call("GET", "/cash/petty", { token: sis })).body;
    expect(p1.items.slice(0, 2).map((x: any) => [x.kind, x.amount])).toEqual([["expense", 12.5], ["deposit", 100]]);
    expect(p1.items[0]).toMatchObject({ reason: "Hielo urgente", photo, by: { user: "Sistemas" } });
    expect((await t.call("GET", "/cash/summary", { token: sis })).body.expectedCash).toBe(cash0); // aparte del cajón
    const x = await t.call("POST", "/cash/x-report/print", { token: sis });
    const txt = JSON.stringify(x.body?.ticket ?? []);
    expect(x.status).toBe(200);
    expect(txt).toContain("CAJA CHICA");
    expect(txt).toContain("Hielo urgente");
    const barra = await t.login(PIN.barra);
    expect((await t.call("GET", "/cash/petty", { token: barra })).error.code).toBe("PERMISSION_REQUIRED");
  });
});
