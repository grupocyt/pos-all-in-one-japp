import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** Papeles a cocina y barra (25/10/2026): comanda de anulación, aviso de cambio de mesa y varios QR de Order on Table. */
let t: T;
let sis: string;
let storeId: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  await ensurePeriod(t, sis);
  storeId = (await t.sql.query("SELECT id::text FROM store WHERE code = 'CT 03'")).rows[0].id;
});
afterAll(async () => {
  await t.sql.query("UPDATE store SET web_order_url = NULL WHERE id = $1", [storeId]);
  await t.sql.query(
    "UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL",
  );
  await t.close();
});

async function sentTable(plus: number[]) {
  const o = (
    await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })
  ).body;
  const ids: string[] = [];
  for (const plu of plus) {
    const r = await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu, force: true } });
    ids.push(r.body.accounts[0].lines.at(-1).id);
  }
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  return {
    id: o._id as string,
    acc: o.accounts[0].id as string,
    lines: ids,
    table: o.tableData.name as string,
  };
}
const jobsFrom = (n: number) => t.printer.jobs.slice(n);

describe("comanda de anulación", () => {
  it("eliminar algo enviado imprime «ANULADO» en la impresora por la que salió", async () => {
    const o = await sentTable([PLU.tosta]);
    const n = t.printer.jobs.length;
    const r = await t.call("POST", `/orders/${o.id}/lines/${o.lines[0]}/delete`, {
      token: sis,
      body: { reason: "Error de marcado", quantity: 1 },
    });
    expect(r.status).toBe(200);
    const v = jobsFrom(n).filter((j) => j.text.includes("*** ANULADO ***"));
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0]!.text).toContain("ELIMINADO TRAS ENVIAR A COCINA");
    expect(v[0]!.text).toContain("MOTIVO: ERROR DE MARCADO");
    expect(v[0]!.text).toContain("*** NO PREPARAR ***");
    expect(v[0]!.text).toContain(`/${o.table}`);
  });

  it("eliminar tras la precuenta lo dice en la comanda de anulación", async () => {
    const o = await sentTable([PLU.croquetas, PLU.tosta]);
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill`, { token: sis });
    const n = t.printer.jobs.length;
    await t.call("POST", `/orders/${o.id}/lines/${o.lines[0]}/delete`, {
      token: sis,
      body: { reason: "Cliente", quantity: 1 },
    });
    const v = jobsFrom(n).filter((j) => j.text.includes("*** ANULADO ***"));
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0]!.text).toContain("ELIMINADO TRAS LA PRECUENTA");
  });

  it("quitar algo que aún no se envió no imprime nada", async () => {
    const o = (
      await t.call("POST", "/orders", {
        token: sis,
        body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
      })
    ).body;
    const l = (
      await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } })
    ).body.accounts[0].lines[0].id;
    const n = t.printer.jobs.length;
    await t.call("POST", `/orders/${o._id}/lines/${l}/delete`, { token: sis, body: {} });
    expect(jobsFrom(n)).toHaveLength(0);
  });
});

describe("aviso de cambio de mesa", () => {
  it("transferir la mesa avisa a las impresoras por las que ya salió algo", async () => {
    const o = await sentTable([PLU.tosta]);
    const dest = await freeTable(t, "BARRA");
    const v = (await t.call("GET", `/orders/${o.id}`, { token: sis })).body.version;
    const n = t.printer.jobs.length;
    const r = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "table", toTableId: dest, version: v },
    });
    expect(r.status).toBe(200);
    const c = jobsFrom(n).filter((j) => j.text.includes("CAMBIO DE MESA"));
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c[0]!.text).toContain(`DE: Mesa`);
    expect(c[0]!.text).toContain(`A: Mesa`);
    expect(c[0]!.text).toContain(r.body.tableData.name);
  });

  it("sin nada enviado no hay aviso", async () => {
    const o = (
      await t.call("POST", "/orders", {
        token: sis,
        body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
      })
    ).body;
    await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
    const n = t.printer.jobs.length;
    const v = (await t.call("GET", `/orders/${o._id}`, { token: sis })).body.version;
    await t.call("POST", `/orders/${o._id}/transfer`, {
      token: sis,
      body: { scope: "table", toTableId: await freeTable(t, "BARRA"), version: v },
    });
    expect(jobsFrom(n).filter((j) => j.text.includes("CAMBIO DE MESA"))).toHaveLength(0);
  });
});

describe("cambio de mesa entre tarifas", () => {
  it("de una zona con precio general a una de terraza → 422 en toTableId y la mesa no se mueve (mesa y cuenta)", async () => {
    const o = await sentTable([PLU.tosta]);
    const v = (await t.call("GET", `/orders/${o.id}`, { token: sis })).body.version;
    const r = await t.call("POST", `/orders/${o.id}/transfer`, {
      token: sis,
      body: { scope: "table", toTableId: await freeTable(t, "TERRAZA"), version: v },
    });
    expect([r.status, r.error.code, r.error.field]).toEqual([422, "VALIDATION", "toTableId"]);
    expect(r.error.message).toBe(
      "No se puede pasar de una zona con precio general a una con precio de terraza",
    );
    const a = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/transfer`, {
      token: sis,
      body: { toTableId: await freeTable(t, "TERRAZA"), version: v },
    });
    expect([a.status, a.error.field]).toEqual([422, "toTableId"]);
    expect((await t.call("GET", `/orders/${o.id}`, { token: sis })).body.tableData.zone).toBe("BARRA");
  });
});

describe("Order on Table: uno o varios tickets", () => {
  it("copies = 2 imprime dos tickets con el formato de la vista previa", async () => {
    await t.sql.query("UPDATE store SET web_order_url = $1 WHERE id = $2", [
      "https://pedir.canasytapas.com",
      storeId,
    ]);
    const o = await sentTable([PLU.tosta]);
    const n = t.printer.jobs.length;
    const r = await t.call("POST", `/orders/${o.id}/oot`, { token: sis, body: { print: true, copies: 2 } });
    expect([r.status, r.body.printed]).toEqual([201, true]);
    const q = jobsFrom(n).filter((j) => j.kind === "oot");
    expect(q).toHaveLength(2);
    expect(q[0]!.text).toContain("PIDE DESDE TU MÓVIL");
    expect(q[0]!.text).toContain("Código de mesa:");
    expect(q[0]!.text).toContain("Sistemas");
    expect(
      (await t.call("POST", `/orders/${o.id}/oot`, { token: sis, body: { print: true, copies: 11 } })).status,
    ).toBe(422);
  });
});
