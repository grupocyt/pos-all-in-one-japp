import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Pruebas en JC01 del 04/11 (tarde), decidido con el dueño el 05/11 (API 1.2.268, migración 0032):
 * 2 varias notas por mesa con quién y cuándo (no se borran) · 1 Historial › Developer con su permiso ·
 * 11 un permiso por botón de Gestiones con el reparto por rol · 9 y 10 cortes X/Z con logo y formato, anulación con formato.
 */
let t: T;
let sis: string;
let jeison: string;
let barra: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  jeison = await t.login(PIN.jeison);
  barra = await t.login(PIN.barra);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.close();
});
const code = (r: any) => [r.status, r.error?.code];
async function mesa(tok = sis) {
  const o = (await t.call("POST", "/orders", { token: tok, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })).body;
  await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu: PLU.tosta, force: true } });
  await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} });
  return o._id as string;
}
const textOf = (lines: any[]) => lines.filter((l) => l.k === "text").map((l) => l.text).join("\n");

describe("2 · notas de la mesa", () => {
  it("cada nota se añade con quién y cuándo; note las junta todas", async () => {
    const id = await mesa();
    await t.call("PATCH", `/orders/${id}`, { token: sis, body: { note: "Alérgico a frutos secos", noteId: "n-1" } });
    const r = await t.call("PATCH", `/orders/${id}`, { token: barra, body: { note: "Trona para el bebé" } });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    const td = r.body.tableData;
    expect(td.notes.map((n: any) => [n.text, n.user])).toEqual([
      ["Alérgico a frutos secos", "Sistemas"],
      ["Trona para el bebé", "Barra"],
    ]);
    expect(td.notes.every((n: any) => n.id && n.at && n.device !== undefined)).toBe(true);
    expect(td.note).toBe("Alérgico a frutos secos · Trona para el bebé");
    expect(r.body.events.some((e: any) => e.type === "noteAdded" && /Trona/.test(e.description))).toBe(true);
  });

  it("la misma nota reintentada (mismo noteId) no se repite", async () => {
    const id = await mesa();
    await t.call("PATCH", `/orders/${id}`, { token: sis, body: { note: "Mesa VIP", noteId: "n-vip" } });
    const r = await t.call("PATCH", `/orders/${id}`, { token: sis, body: { note: "Mesa VIP", noteId: "n-vip" } });
    expect(r.body.tableData.notes).toHaveLength(1);
  });

  it("no se borran: nota vacía → 422 VALIDATION", async () => {
    const id = await mesa();
    await t.call("PATCH", `/orders/${id}`, { token: sis, body: { note: "Cumpleaños" } });
    const r = await t.call("PATCH", `/orders/${id}`, { token: sis, body: { note: "" } });
    expect([...code(r), r.error.field]).toEqual([422, "VALIDATION", "note"]);
    expect((await t.call("GET", `/orders/${id}`, { token: sis })).body.tableData.notes).toHaveLength(1);
  });

  it("al juntar mesas llegan las notas de las dos, cada una con su autor", async () => {
    const a = await mesa();
    const b = await mesa();
    await t.call("PATCH", `/orders/${a}`, { token: sis, body: { note: "Alérgico" } });
    await t.call("PATCH", `/orders/${b}`, { token: barra, body: { note: "Cumpleaños" } });
    const dst = (await t.call("GET", `/orders/${b}`, { token: sis })).body;
    const r = await t.call("POST", `/orders/${a}/transfer`, {
      token: sis,
      body: { scope: "table", toTableId: dst.tableData.tableId },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.tableData.notes.map((n: any) => `${n.text}/${n.user}`)).toEqual(["Cumpleaños/Barra", "Alérgico/Sistemas"]);
  });
});

describe("1 y 11 · permisos de Historial › Developer y de Gestiones (0032)", () => {
  const perms = async (tok: string) => (await t.call("GET", "/sessions/current", { token: tok })).body.permissions as string[];
  it("Developer solo para el Administrador", async () => {
    expect(await perms(sis)).toContain("pedido.historialDev");
    expect(await perms(jeison)).toContain("pedido.historialDev"); // en la base de pruebas Jeison es Administrador
    const { rows } = await t.sql.query(
      "SELECT p.code FROM profile_permission pp JOIN user_profile p ON p.id = pp.profile_id WHERE pp.permission_code = 'pedido.historialDev'",
    );
    expect(rows.map((r: any) => r.code)).toEqual(["ADMIN"]);
    for (const tok of [barra, mesero]) {
      expect(await perms(tok)).not.toContain("pedido.historialDev");
    }
  });
  it("reparto por rol: Administrador todo, Encargado todo menos SIR, Cajero lo de caja, Mesero nada", async () => {
    const G = [
      "funciones.facturas",
      "pedido.reconexiones",
      "funciones.semana",
      "funciones.eliminaciones",
      "funciones.kpi",
      "funciones.servicio",
      "funciones.sir",
      "funciones.abrirCajon",
      "mesas.moverMesas",
      "funciones.caja",
      "funciones.periodo",
    ];
    const has = async (tok: string) => (await perms(tok)).filter((p) => G.includes(p)).sort();
    expect(await has(sis)).toEqual([...G].sort());
    const { rows } = await t.sql.query(
      "SELECT pp.permission_code c FROM profile_permission pp JOIN user_profile p ON p.id = pp.profile_id WHERE p.code = 'ADMIN_LOCAL'",
    );
    expect(rows.map((r: any) => r.c).filter((c: string) => G.includes(c)).sort()).toEqual(G.filter((g) => g !== "funciones.sir").sort());
    expect(await has(barra)).toEqual(
      ["funciones.facturas", "funciones.servicio", "funciones.abrirCajon", "funciones.caja", "funciones.periodo"].sort(),
    );
    expect(await has(mesero)).toEqual([]);
  });
  it("cada botón pide su permiso: Resumen semana, Eliminaciones, Mesas en servicio y SIR", async () => {
    const need = async (path: string, perm: string) => {
      const r = await t.call("GET", path, { token: barra });
      expect([r.status, r.error?.details?.permission], path).toEqual([403, perm]);
    };
    await need("/reports/week", "funciones.semana");
    await need("/reports/deletions", "funciones.eliminaciones");
    await need("/interface/sir/sales", "funciones.sir");
    expect((await t.call("GET", "/service/live", { token: barra })).status).toBe(200);
  });
});

describe("9 y 10 · cortes X/Z y anulación con logo y formato", () => {
  const params = async () => (await t.call("GET", "/config/parametros/current", { token: sis })).body;
  const patch = async (body: Record<string, unknown>) => {
    const r = await t.call("PATCH", "/config/parametros/current", { token: sis, body: { ...body, version: (await params()).version } });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
  };
  it("el corte X lleva el logo del local y el mismo contenido que la vista previa; cada parte se quita en Formatos", async () => {
    const id = await mesa();
    const acc = (await t.call("GET", `/orders/${id}`, { token: sis })).body.accounts[0].id;
    const co = await t.call("POST", `/orders/${id}/accounts/${acc}/checkout`, { token: sis, body: { payments: [{ method: "card", amount: null }] } });
    expect(co.status, JSON.stringify(co.env)).toBe(201);
    const before = await params();
    // 8 × 1 puntos: un logo mínimo en GS v 0
    const logo = Buffer.from([0x1d, 0x76, 0x30, 0x00, 1, 0, 1, 0, 0xff]).toString("base64");
    await patch({ ticketLogo: logo });
    let x = (await t.call("POST", "/cash/x-report/print", { token: sis })).body;
    expect(x.ticket[0]).toEqual({ k: "logo", raster: logo });
    const txt = textOf(x.ticket);
    for (const s of ["CORTE X · RESUMEN DE VENTA", "VENTAS", "COMENSALES", "TICKET MEDIO (NETO)", "VENTA BRUTA", "= VENTA NETA", "POR FORMA DE PAGO", "POR CAMARERO", "CAJA (EFECTIVO)", "= Efectivo esperado"]) {
      expect(txt, s).toContain(s);
    }
    await patch({ ticketFormats: { ...(before.ticketFormats ?? {}), cutx: { logo: false, camareros: false, comensales: false } } });
    x = (await t.call("POST", "/cash/x-report/print", { token: sis })).body;
    expect(x.ticket.some((l: any) => l.k === "logo")).toBe(false);
    expect(textOf(x.ticket)).not.toContain("POR CAMARERO");
    expect(textOf(x.ticket)).not.toContain("COMENSALES");
    const prev = await t.call("POST", "/printers/preview", { token: sis, body: { kind: "cutx" } });
    expect(prev.body.text).not.toContain("POR CAMARERO");
    await patch({ ticketFormats: before.ticketFormats ?? {}, ticketLogo: before.ticketLogo ?? null });
  });
  it("comanda de anulación con su formato (Ajustes › Formatos › Anulación)", async () => {
    const before = await params();
    await patch({ ticketFormats: { ...(before.ticketFormats ?? {}), void: { motivo: false, noPreparar: false } } });
    const r = await t.call("POST", "/printers/preview", { token: sis, body: { kind: "void" } });
    expect(r.body.text).toContain("ANULADO");
    expect(r.body.text).not.toContain("MOTIVO");
    expect(r.body.text).not.toContain("NO PREPARAR");
    await patch({ ticketFormats: before.ticketFormats ?? {} });
  });
});
