import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

let t: T;
let sis: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.close();
});
const list = async (m: string) =>
  (await t.call("GET", `/config/${m}?limit=500`, { token: sis })).body.items as any[];

describe("Canales de impresión: comanda con copias y tickets por área", () => {
  let barra: any;
  let copia: any;
  let tkChan: any;
  let terraza: any;
  let tkPrinter: any;
  it("los canales tienen tipo e impresora; el arranque deja un canal TICKET para todas las áreas", async () => {
    const chs = await list("canales");
    barra = chs.find((c) => c.name === "BARRA");
    expect(barra).toMatchObject({ kind: "kitchen" });
    expect(barra.printerId).toBeTruthy();
    expect(chs.find((c) => c.name === "TICKET")).toMatchObject({ kind: "ticket" });
    terraza = (await list("areas")).find((a) => a.name === "TERRAZA");
    expect(terraza.ticketChannelId).toBe(chs.find((c) => c.name === "TICKET").id);
  });
  it("copia de un canal de comanda en otra impresora (doble zona); reglas de las copias", async () => {
    const pr = await t.call("POST", "/config/impresoras", {
      token: sis,
      body: { name: "BARRA ZONA 2", connection: "192.168.1.61", kind: "bar" },
    });
    copia = (
      await t.call("POST", "/config/canales", {
        token: sis,
        body: { name: "COPIA BARRA", kind: "kitchen", copyOfId: barra.id, printerId: pr.body.id },
      })
    ).body.item;
    expect(copia.copyOfId).toBe(barra.id);
    expect(
      (
        await t.call("POST", "/config/canales", {
          token: sis,
          body: { name: "COPIA DE COPIA", copyOfId: copia.id },
        })
      ).error.field,
    ).toBe("copyOfId");
    expect(
      (
        await t.call("POST", "/config/canales", {
          token: sis,
          body: { name: "TK COPIA", kind: "ticket", copyOfId: barra.id },
        })
      ).error.field,
    ).toBe("copyOfId");
    expect(
      (
        await t.call("PATCH", `/config/canales/${barra.id}`, {
          token: sis,
          body: { copyOfId: barra.id, version: barra.version },
        })
      ).error.field,
    ).toBe("copyOfId");
    // un producto no va a una copia ni a un canal de tickets
    const p = (await t.call("GET", `/config/productos/${PLU.tosta}`, { token: sis })).body;
    expect(
      (
        await t.call("PATCH", `/config/productos/${p.id}`, {
          token: sis,
          body: { channels: [copia.id], version: p.version },
        })
      ).error.field,
    ).toBe("channels");
    // el canal original con copias no se desactiva
    expect(
      (await t.call("POST", `/config/canales/${barra.id}/deactivate`, { token: sis, body: {} })).error.code,
    ).toBe("IN_USE");
  });
  it("canal de tickets de terraza con su impresora; un área solo acepta canales de tickets", async () => {
    tkPrinter = (
      await t.call("POST", "/config/impresoras", {
        token: sis,
        body: { name: "TICKET TERRAZA", connection: "192.168.1.70:9100", kind: "ticket" },
      })
    ).body.item;
    tkChan = (
      await t.call("POST", "/config/canales", {
        token: sis,
        body: { name: "TICKET TERRAZA", kind: "ticket", printerId: tkPrinter.id },
      })
    ).body.item;
    expect(
      (
        await t.call("PATCH", `/config/areas/${terraza.id}`, {
          token: sis,
          body: { ticketChannelId: barra.id, version: terraza.version },
        })
      ).error.field,
    ).toBe("ticketChannelId");
    const r = await t.call("PATCH", `/config/areas/${terraza.id}`, {
      token: sis,
      body: { ticketChannelId: tkChan.id, version: terraza.version },
    });
    expect(r.body.item.ticketChannelId).toBe(tkChan.id);
  });
  it("una mesa de terraza: la comanda sale por BARRA y por su copia; la precuenta, en la impresora de tickets de terraza", async () => {
    t.printer.jobs.length = 0;
    const o = await t.call("POST", "/orders", {
      token: sis,
      body: { tableId: await freeTable(t, "TERRAZA"), guests: 2 },
    });
    await t.call("POST", `/orders/${o.body._id}/lines`, { token: sis, body: { plu: PLU.tosta } });
    const send = await t.call("POST", `/orders/${o.body._id}/send`, { token: sis, body: {} });
    expect(send.status).toBe(200);
    const kitchen = t.printer.jobs.filter((j) => j.kind === "kitchen");
    expect(kitchen.map((j) => [j.channel, j.printer])).toEqual(
      expect.arrayContaining([
        ["BARRA", expect.any(String)],
        ["COPIA BARRA", "BARRA ZONA 2"],
      ]),
    );
    expect(kitchen.find((j) => j.channel === "COPIA BARRA")!.text).toMatch(/TOSTA/i);
    const acc = o.body.accounts[0].id;
    await t.call("POST", `/orders/${o.body._id}/accounts/${acc}/prebill`, { token: sis, body: {} });
    const pre = t.printer.jobs.find((j) => j.kind === "prebill")!;
    expect([pre.printer, pre.channel, pre.connection]).toEqual([
      "TICKET TERRAZA",
      "TICKET TERRAZA",
      "192.168.1.70:9100",
    ]);
    // cobrar y facturar: la factura también en terraza
    const cur = (await t.call("GET", `/orders/${o.body._id}`, { token: sis })).body.accounts[0];
    await t.call("POST", `/orders/${o.body._id}/accounts/${acc}/payments`, {
      token: sis,
      body: { method: "card", amount: cur.totals.pending },
    });
    await t.call("POST", `/orders/${o.body._id}/accounts/${acc}/invoice`, { token: sis });
    expect(t.printer.jobs.find((j) => j.kind === "invoice")!.printer).toBe("TICKET TERRAZA");
  });
  it("una mesa de barra sigue con el canal TICKET de su área", async () => {
    t.printer.jobs.length = 0;
    const o = await t.call("POST", "/orders", {
      token: sis,
      body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
    });
    await t.call("POST", `/orders/${o.body._id}/lines`, { token: sis, body: { plu: PLU.tosta } });
    await t.call("POST", `/orders/${o.body._id}/accounts/${o.body.accounts[0].id}/prebill`, {
      token: sis,
      body: {},
    });
    expect(t.printer.jobs.find((j) => j.kind === "prebill")!.channel).toBe("TICKET");
    const tx = (await t.call("GET", `/orders/${o.body._id}`, { token: sis })).body;
    for (const l of tx.accounts[0].lines) {
      await t.call("POST", `/orders/${o.body._id}/lines/${l.id}/delete`, {
        token: sis,
        body: { reason: "Prueba" },
      });
    }
    await t.call("POST", `/orders/${o.body._id}/close`, { token: sis, body: {} });
  });
});
