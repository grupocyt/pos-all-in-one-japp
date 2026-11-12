import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** N1 (04/11/2026, API 1.2.268): Ajustes › Formatos de ticket se guarda en el servidor (0029) y la API lo aplica al imprimir. */
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

const params = async () => (await t.call("GET", "/config/parametros/current", { token: sis })).body;
const setFormats = async (ticketFormats: unknown) => {
  const cur = await params();
  return t.call("PATCH", "/config/parametros/current", { token: sis, body: { ticketFormats, version: cur.version } });
};
async function mesaCobrada() {
  const o = (await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 3 } })).body;
  const acc = o.accounts[0].id as string;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  return { id: o._id as string, acc };
}
const lastJob = (n: number, kind: string) => t.printer.jobs.slice(n).filter((j: any) => j.kind === kind).at(-1)!;

describe("formatos de ticket en el servidor (N1)", () => {
  it("se guardan en Parámetros (ticketFormats) y se validan", async () => {
    // 0033 · el corte X viene corto (ventas, formas de pago y propinas)
    expect((await params()).ticketFormats).toEqual({
      cutx: { comensales: false, ticketMedio: false, iva: false, areas: false, camareros: false, descuentos: false, eliminaciones: false, abonos: false, caja: false },
    });
    const bad = await setFormats({ invoice: { mesero: "no" } });
    expect(bad.status).toBe(422);
    const unk = await setFormats({ factura: {} });
    expect(unk.status).toBe(422);
    const ok = await setFormats({ prebill: { porPersona: false, despTxt: "Hasta pronto" }, invoice: { mesero: false } });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect((await params()).ticketFormats).toEqual({ prebill: { porPersona: false, despTxt: "Hasta pronto" }, invoice: { mesero: false } });
  });

  it("la precuenta y la factura salen con el formato; razón social y NIF siempre en la factura; sin cajón si se apaga", async () => {
    await setFormats({
      prebill: { porPersona: false, desglose: false, despTxt: "Hasta pronto", mesero: false },
      invoice: { mesero: false, desglose: false, razon: false, nif: false, cajon: false },
    });
    const m = await mesaCobrada();
    let n = t.printer.jobs.length;
    expect((await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/prebill`, { token: sis, body: {} })).status).toBe(200);
    const pb = lastJob(n, "prebill").text as string;
    expect(pb).not.toContain("Por persona");
    expect(pb).not.toContain("Base:");
    expect(pb).toContain("Hasta pronto");
    expect(pb).not.toContain("Sistemas");
    n = t.printer.jobs.length;
    const co = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, {
      token: sis,
      body: { payments: [{ method: "cash", amount: null, cashGiven: 50 }], print: true },
    });
    expect(co.status, JSON.stringify(co.env)).toBeLessThan(300);
    const inv = lastJob(n, "invoice");
    expect(inv.text).not.toContain("Base:");
    expect(inv.text).toMatch(/NIF: /);
    expect(inv.openDrawer).toBeFalsy();
    // de vuelta a todo encendido: el desglose vuelve
    await setFormats({});
    const m2 = await mesaCobrada();
    n = t.printer.jobs.length;
    await t.call("POST", `/orders/${m2.id}/accounts/${m2.acc}/prebill`, { token: sis, body: {} });
    const pb2 = lastJob(n, "prebill").text as string;
    expect(pb2).toContain("Base:");
    expect(pb2).toContain("Por persona");
  });

  it("0031: el logo del local (preparado por el TPV) sale en la precuenta en vez del de la cadena", async () => {
    // GS v 0 de 8 × 1 puntos (1 byte por fila, 1 fila) en base64
    const raster = Buffer.from([0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff]).toString("base64");
    const cur = await params();
    const bad = await t.call("PATCH", "/config/parametros/current", { token: sis, body: { ticketLogo: "data:image/png;base64,xx", version: cur.version } });
    expect(bad.status).toBe(422);
    const ok = await t.call("PATCH", "/config/parametros/current", { token: sis, body: { ticketLogo: raster, version: cur.version } });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    const m = await mesaCobrada();
    const n = t.printer.jobs.length;
    await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/prebill`, { token: sis, body: {} });
    const job = lastJob(n, "prebill");
    expect(job.ticket.find((l: any) => l.k === "logo")).toEqual({ k: "logo", raster });
    const back = await params();
    await t.call("PATCH", "/config/parametros/current", { token: sis, body: { ticketLogo: null, version: back.version } });
  });
});
