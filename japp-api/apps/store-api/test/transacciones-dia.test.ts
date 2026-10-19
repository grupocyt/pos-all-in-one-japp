import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

let t: T;
let sis: string;
let mesero: string;
let mgr: Server;
const got: { headers: any; body: any }[] = [];
beforeAll(async () => {
  mgr = createServer((req, res) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      got.push({ headers: req.headers, body: JSON.parse(d) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => mgr.listen(0, "127.0.0.1", r));
  t = await setup({
    managerUrl: `http://127.0.0.1:${(mgr.address() as any).port}/api/manager/v1`,
    storeKey: "clave-de-prueba",
  });
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  mgr.close();
  await t.close();
});

describe("Transacciones del día (para el Manager)", () => {
  let facturada: string;
  let abierta: string;
  it("prepara: una cuenta cobrada y facturada (con eliminaciones en distintos momentos) y otra abierta", async () => {
    const o = await t.call("POST", "/orders", {
      token: mesero,
      body: { tableId: await freeTable(t, "TERRAZA"), guests: 3 },
    });
    const id = o.body._id;
    const acc = o.body.accounts[0].id;
    facturada = acc;
    await t.call("POST", `/orders/${id}/lines`, {
      token: mesero,
      body: { plu: PLU.tosta, comment: "bien tostada" },
    });
    const l2 = await t.call("POST", `/orders/${id}/lines`, { token: mesero, body: { plu: PLU.croquetas } });
    const l3 = await t.call("POST", `/orders/${id}/lines`, { token: mesero, body: { plu: PLU.redbull } });
    // sin enviar → se quita
    await t.call(
      "POST",
      `/orders/${id}/lines/${l3.body.accounts[0].lines.find((x: any) => x.productId === PLU.redbull).id}/delete`,
      { token: mesero, body: {} },
    );
    await t.call("POST", `/orders/${id}/send`, { token: mesero, body: {} });
    await t.call("POST", `/orders/${id}/accounts/${acc}/prebill`, { token: sis, body: {} });
    // en precuenta → motivo y encargado (Sistemas)
    const cro = l2.body.accounts[0].lines.find((x: any) => x.productId === PLU.croquetas).id;
    expect(
      (
        await t.call("POST", `/orders/${id}/lines/${cro}/delete`, {
          token: sis,
          body: { reason: "Error al marcar" },
        })
      ).status,
    ).toBe(200);
    const cur = (await t.call("GET", `/orders/${id}`, { token: sis })).body.accounts[0];
    await t.call("POST", `/orders/${id}/accounts/${acc}/payments`, {
      token: sis,
      body: { method: "cash", amount: cur.totals.pending, cashGiven: 20 },
    });
    expect((await t.call("POST", `/orders/${id}/accounts/${acc}/invoice`, { token: sis })).status).toBe(201);
    const o2 = await t.call("POST", "/orders", {
      token: mesero,
      body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
    });
    abierta = o2.body.accounts[0].id;
    await t.call("POST", `/orders/${o2.body._id}/lines`, { token: mesero, body: { plu: PLU.kaspirinha } });
  });
  it("todas: cuenta facturada con mesa, líneas (PLU, nombre, PVP, hora, quién), eliminaciones por momento, cobro, factura e historial", async () => {
    const r = await t.call("GET", "/transactions/day", { token: sis });
    expect(r.status).toBe(200);
    const inv = r.body.items.find((x: any) => x.accountId === facturada);
    expect(inv.kind).toBe("invoice");
    expect(inv.table).toMatchObject({ area: "TERRAZA", guests: 3 });
    expect(inv.table.openedBy.user).toBe("Mesero");
    const tosta = inv.lines.find((l: any) => l.plu === PLU.tosta);
    expect(tosta).toMatchObject({ comment: "bien tostada", quantity: 1 });
    expect(tosta.unitPrice).toBeGreaterThan(0);
    expect(tosta.createdBy.user).toBe("Mesero");
    expect(tosta.createdAt).toMatch(/T/);
    const del = Object.fromEntries(inv.deletedLines.map((d: any) => [d.plu, d]));
    expect(del[PLU.redbull]).toMatchObject({ stage: "pendingPrint", stageLabel: "sin enviar" });
    expect(del[PLU.croquetas]).toMatchObject({
      stage: "preBill",
      stageLabel: "precuenta",
      reason: "Error al marcar",
    });
    expect(del[PLU.croquetas].deletedBy.user).toBe("Sistemas");
    expect(inv.payments[0]).toMatchObject({ method: "cash", cashGiven: 20 });
    expect(inv.payments[0].collectedBy.user).toBe("Sistemas");
    expect(inv.invoice.number).toMatch(/^T2026-/);
    expect(inv.invoice.taxes.length).toBeGreaterThan(0);
    expect(inv.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(["preBill"]));
    expect(r.body.items.find((x: any) => x.accountId === abierta).kind).toBe("open");
    expect(r.body.counts.invoices).toBeGreaterThanOrEqual(1);
  });
  it("filtra por tipo y valida fecha y tipo; el mesero no tiene acceso", async () => {
    const f = await t.call("GET", "/transactions/day?type=invoices", { token: sis });
    expect(f.body.items.every((x: any) => x.kind === "invoice")).toBe(true);
    const a = await t.call("GET", "/transactions/day?type=open", { token: sis });
    expect(a.body.items.every((x: any) => x.kind === "open")).toBe(true);
    expect((await t.call("GET", "/transactions/day?date=2001-01-01", { token: sis })).body.items).toEqual([]);
    expect((await t.call("GET", "/transactions/day?date=ayer", { token: sis })).status).toBe(422);
    expect((await t.call("GET", "/transactions/day?type=raro", { token: sis })).status).toBe(422);
    expect((await t.call("GET", "/transactions/day", { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
  });
  it("enviar: a la cola sin duplicar y al Manager al momento (con su clave e Idempotency-Key)", async () => {
    const r = await t.call("POST", "/sync/transactions", { token: sis, body: { type: "invoices" } });
    expect(r.status).toBe(200);
    expect(r.body.queued).toBeGreaterThanOrEqual(1);
    expect(r.body.manager).toMatchObject({ ok: true, status: 200 });
    expect(got[0].headers.authorization).toBe("Bearer clave-de-prueba");
    expect(got[0].headers["idempotency-key"]).toMatch(/^tx-/);
    expect(got[0].body.items[0].invoice.number).toMatch(/^T2026-/);
    const again = await t.call("POST", "/sync/transactions", { token: sis, body: { type: "invoices" } });
    expect([again.body.queued, again.body.skipped]).toEqual([0, r.body.queued]);
    expect((await t.call("POST", "/sync/transactions", { token: mesero, body: {} })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
  });
});
