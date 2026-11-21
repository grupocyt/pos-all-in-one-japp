import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** 1.2.296 (21/11/2026) · Formatos de ticket: solo se imprime lo que está activo, en todos los tickets. */
let t: T;
let sis: string;
let formats0: unknown = {};
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas, "CAJA1");
  await ensurePeriod(t, sis);
  const o = (await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })).body;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/checkout`, {
    token: sis,
    body: { payments: [{ method: "cash", amount: null, cashGiven: 50, tip: 2 }], print: false },
  });
  formats0 = (await params()).ticketFormats ?? {};
});
afterAll(async () => {
  // la base es compartida con las demás pruebas: los formatos vuelven a como estaban
  const cur = await params();
  await t.call("PATCH", "/config/parametros/current", { token: sis, body: { ticketFormats: formats0, version: cur.version } });
  await t.close();
});
const params = async () => (await t.call("GET", "/config/parametros/current", { token: sis })).body;
const setFormats = async (ticketFormats: unknown) => {
  const cur = await params();
  const r = await t.call("PATCH", "/config/parametros/current", { token: sis, body: { ticketFormats, version: cur.version } });
  expect(r.status, JSON.stringify(r.env)).toBe(200);
};
const cutX = async () => {
  const r = await t.call("POST", "/cash/counts", {
    token: sis,
    body: { countedCash: 100, type: "cortex", print: false, tipsConfirmed: true, note: "prueba de formato" },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(r.status, JSON.stringify(r.env)).toBe(201);
  return (r.body.ticket as any[]).map((l) => (l.k === "text" ? l.text : `[${l.k}]`)).join("\n");
};
const preview = async (kind: string) => (await t.call("POST", "/printers/preview", { token: sis, body: { kind } })).body.text as string;

describe("formatos: solo lo activo (1.2.296)", () => {
  it("corte X contado: cabecera, tarjetas, propinas y detalle de caja según Ajustes › Formatos › Corte X", async () => {
    await setFormats({ cutx: { logo: true, cadena: true, local: true, formasPago: true, propinas: true, caja: true } });
    const all = await cutX();
    expect(all).toContain("[logo]");
    expect(all).toContain("Cañas y Tapas");
    expect(all).toContain("TARJETAS (DATÁFONOS)");
    expect(all).toContain("PROPINAS");
    expect(all).toContain("  Base");
    await setFormats({ cutx: { logo: false, cadena: false, local: false, formasPago: false, propinas: false, caja: false } });
    const off = await cutX();
    expect(off).not.toContain("[logo]");
    expect(off).not.toContain("Cañas y Tapas");
    expect(off).not.toContain("TARJETAS");
    expect(off).not.toContain("PROPINAS");
    expect(off).not.toContain("  Base");
    // lo contado, lo esperado y la diferencia salen siempre
    expect(off).toMatch(/CORTE X · ARQUEO[\s\S]*Contado[\s\S]*Esperado[\s\S]*Diferencia/);
  });

  it("«Cadena» apagada: no sale aunque el nombre del local empiece por ella (precuenta, factura, cortes)", async () => {
    await setFormats({ prebill: { cadena: false }, invoice: { cadena: false }, cutx: { cadena: false }, cutz: { cadena: false } });
    for (const k of ["prebill", "invoice", "cutx", "cutz"]) {
      const txt = await preview(k);
      expect(txt, k).not.toContain("Cañas y Tapas");
      expect(txt, k).toContain("Sucursal Pruebas");
    }
    await setFormats({ prebill: { cadena: true, local: false } });
    const pb = await preview("prebill");
    expect(pb).toContain("Cañas y Tapas");
    expect(pb).not.toContain("Sucursal Pruebas");
  });

  it("transacciones del día: el descuento lleva los datos de su formulario (formData)", async () => {
    const o = (await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "TERRAZA"), guests: 1 } })).body;
    await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
    const ds = (await t.call("GET", "/config/descuentos", { token: sis })).body;
    const d = (ds.items ?? ds)[0];
    const form = [{ label: "NOMBRE", value: "Ana Pérez" }];
    expect((await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/discounts`, { token: sis, body: { discountId: d.id, formData: form } })).status).toBe(201);
    const day = (await t.call("GET", "/transactions/day", { token: sis })).body;
    const it2 = day.items.find((x: any) => x.accountId === o.accounts[0].id);
    expect(it2.discounts[0].formData).toEqual(form);
  });

  it("claves de 4 a 8 cifras: alta con 8, entrar, cambiar a 6 y volver a entrar; 3 o 9 cifras → 422", async () => {
    const prof = (await t.call("GET", "/config/perfiles?q=Mesero", { token: sis })).body.items[0];
    expect((await t.call("POST", "/config/usuarios", { token: sis, body: { name: "Corta", profileId: prof.id, pin: "123" } })).status).toBe(422);
    expect((await t.call("POST", "/config/usuarios", { token: sis, body: { name: "Larga", profileId: prof.id, pin: "123456789" } })).status).toBe(422);
    const u = await t.call("POST", "/config/usuarios", { token: sis, body: { name: "Ocho Cifras", profileId: prof.id, pin: "73917391" } });
    expect(u.status, JSON.stringify(u.env)).toBe(201);
    const tok = await t.login("73917391");
    const ch = await t.call("PUT", "/sessions/current/pin", { token: tok, body: { currentPin: "73917391", newPin: "482913" } });
    expect(ch.status, JSON.stringify(ch.env)).toBe(200);
    await t.login("482913");
    expect((await t.call("POST", "/sessions", { body: { pin: "123456789" } })).status).toBe(422);
  });
});

