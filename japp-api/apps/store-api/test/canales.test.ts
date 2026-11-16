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

describe("Canales de impresión: solo COMIDA y BEBIDA (los del Manager) y tickets por área", () => {
  let barra: any;
  let tkChan: any;
  let terraza: any;
  let tkPrinter: any;
  it("los canales de comanda son COMIDA y BEBIDA (fijos, con impresora); el arranque deja un canal TICKET para todas las áreas", async () => {
    const chs = await list("canales");
    expect(chs.filter((c) => c.kind === "kitchen").map((c) => [c.name, c.code]).sort()).toEqual([
      ["BEBIDA", "BEBIDA"],
      ["COMIDA", "COMIDA"],
    ]);
    barra = chs.find((c) => c.code === "BEBIDA");
    expect(barra.printerId).toBeTruthy();
    expect(chs.find((c) => c.name === "TICKET")).toMatchObject({ kind: "ticket", code: null });
    terraza = (await list("areas")).find((a) => a.name === "TERRAZA");
    expect(terraza.ticketChannelId).toBe(chs.find((c) => c.name === "TICKET").id);
  });
  it("0035: ni canales de comanda nuevos, ni copias, ni renombrar o desactivar COMIDA y BEBIDA; su impresora sí se cambia", async () => {
    const pr = await t.call("POST", "/config/impresoras", {
      token: sis,
      body: { name: "BARRA ZONA 2", connection: "192.168.1.61", kind: "bar" },
    });
    const nuevo = await t.call("POST", "/config/canales", { token: sis, body: { name: "POSTRES", kind: "kitchen" } });
    expect([nuevo.status, nuevo.error.field]).toEqual([422, "kind"]);
    const copia = await t.call("POST", "/config/canales", {
      token: sis,
      body: { name: "COPIA BARRA", kind: "kitchen", copyOfId: barra.id, printerId: pr.body.item.id },
    });
    expect(copia.status).toBe(422);
    const ren = await t.call("PATCH", `/config/canales/${barra.id}`, {
      token: sis,
      body: { name: "BARRA", version: barra.version },
    });
    expect([ren.status, ren.error.field]).toEqual([422, "name"]);
    const off = await t.call("POST", `/config/canales/${barra.id}/deactivate`, { token: sis, body: {} });
    expect([off.status, off.error.code]).toEqual([422, "VALIDATION"]);
    const prt = await t.call("PATCH", `/config/canales/${barra.id}`, {
      token: sis,
      body: { printerId: pr.body.item.id, version: barra.version },
    });
    expect(prt.status, JSON.stringify(prt.env)).toBe(200);
    // vuelve a su impresora
    await t.call("PATCH", `/config/canales/${barra.id}`, {
      token: sis,
      body: { printerId: barra.printerId, version: prt.body.version },
    });
    barra = (await list("canales")).find((c) => c.code === "BEBIDA");
    // un producto no va a un canal de tickets
    const p = (await t.call("GET", `/config/productos/${PLU.tosta}`, { token: sis })).body;
    const tk = (await list("canales")).find((c) => c.name === "TICKET");
    expect(
      (
        await t.call("PATCH", `/config/productos/${p.id}`, {
          token: sis,
          body: { channels: [tk.id], version: p.version },
        })
      ).error.field,
    ).toBe("channels");
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
  it("una mesa de terraza: la comanda sale por BEBIDA; la precuenta, en la impresora de tickets de terraza", async () => {
    t.printer.jobs.length = 0;
    const o = await t.call("POST", "/orders", {
      token: sis,
      body: { tableId: await freeTable(t, "TERRAZA"), guests: 2 },
    });
    await t.call("POST", `/orders/${o.body._id}/lines`, { token: sis, body: { plu: PLU.tosta } });
    const send = await t.call("POST", `/orders/${o.body._id}/send`, { token: sis, body: {} });
    expect(send.status).toBe(200);
    const kitchen = t.printer.jobs.filter((j) => j.kind === "kitchen");
    expect(kitchen.map((j) => j.channel)).toEqual(["BEBIDA"]);
    expect(kitchen[0]!.text).toMatch(/TOSTA/i);
    expect(send.body.printed[0]).toMatchObject({ channel: "BEBIDA", ok: true, queued: false });
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
    await t.call("POST", `/orders/${o.body._id}/close`, { token: sis, body: { closeReason: "Prueba" } });
  });
});
