import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

// Reglas de las pruebas del 28/10 (TPV 1.2.259–1.2.261) que la API ya cumple (1.2.267).
const MENU = 4478;
const AGUA = 4480;
const CREMA = 5990;
const MERLUZA = 6619;
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

describe("Ajustes · personas y bloqueo", () => {
  it("no hay dos personas con el mismo nombre (mayúsculas, tildes y espacios no cuentan) → 409 DUPLICATE name", async () => {
    const prof = (await t.call("GET", "/config/perfiles", { token: sis })).body.items.find(
      (p: any) => p.code === "MESERO",
    );
    const a = await t.call("POST", "/config/usuarios", {
      token: sis,
      body: { name: "Ána  Pérez", profileId: prof.id, pin: "8462" },
    });
    expect(a.status, JSON.stringify(a.env)).toBe(201);
    const b = await t.call("POST", "/config/usuarios", {
      token: sis,
      body: { name: " ana perez ", profileId: prof.id, pin: "8463" },
    });
    expect([b.status, b.error.code, b.error.field ?? b.error.details.field]).toEqual([
      409,
      "DUPLICATE",
      "name",
    ]);
    const other = await t.call("POST", "/config/usuarios", {
      token: sis,
      body: { name: "Ana Pérez Gómez", profileId: prof.id, pin: "8464" },
    });
    expect(other.status).toBe(201);
    const ren = await t.call("PATCH", `/config/usuarios/${other.body.id}`, {
      token: sis,
      body: { name: "ANA PEREZ", version: other.body.version },
    });
    expect([ren.status, ren.error.code]).toEqual([409, "DUPLICATE"]);
  });

  it("bloqueo por inactividad: 0 o de 10 a 3600 s (de 1 a 9 → 422)", async () => {
    const prof = (await t.call("GET", "/config/perfiles", { token: sis })).body.items.find(
      (p: any) => p.code === "MESERO",
    );
    const bad = await t.call("POST", "/config/usuarios", {
      token: sis,
      body: { name: "Bloqueo Corto", profileId: prof.id, pin: "8471", lockSeconds: 5 },
    });
    expect([bad.status, bad.error.field ?? bad.error.details.field]).toEqual([422, "lockSeconds"]);
    for (const [v, pin] of [
      [0, "8571"],
      [10, "8572"],
      [3600, "8573"],
    ] as const) {
      const ok = await t.call("POST", "/config/usuarios", {
        token: sis,
        body: { name: `Bloqueo ${v}`, profileId: prof.id, pin, lockSeconds: v },
      });
      expect(ok.status, JSON.stringify(ok.env)).toBe(201);
    }
  });
});

describe("Clientes por correo", () => {
  it("GET /customers busca también por correo; el cliente de la factura completa queda en el fichero", async () => {
    const o = (
      await t.call("POST", "/orders", {
        token: sis,
        body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
      })
    ).body;
    const c = await t.call("PUT", `/orders/${o._id}/accounts/${o.accounts[0].id}/customer`, {
      token: sis,
      body: {
        type: "company",
        taxId: "B12345674",
        name: "Correo Pruebas SL",
        email: "facturas@correo-pruebas.es",
      },
    });
    expect(c.status, JSON.stringify(c.env)).toBe(200);
    const r = await t.call("GET", "/customers?q=correo-pruebas", { token: sis });
    expect(r.body.items.map((x: any) => x.taxId)).toContain("B12345674");
    await t.call("POST", `/orders/${o._id}/close`, { token: sis, body: {} });
  });
});

describe("Sala · editar el plano", () => {
  it("una mesa no puede quedar encima de otra → 422 TABLE_OVERLAP {a, b}", async () => {
    // un área nueva con dos mesas separadas (no se cruza con las otras pruebas del plano)
    const store = (await t.sql.query("SELECT id FROM store LIMIT 1")).rows[0].id;
    const areaId = crypto.randomUUID();
    await t.sql.query(
      "INSERT INTO area (id, store_id, name, sort_order) VALUES ($1, $2, 'PLANO 28/10', 99)",
      [areaId, store],
    );
    for (const [n, x] of [
      ["901", 20],
      ["902", 200],
    ] as const) {
      await t.sql.query(
        "INSERT INTO dining_table (id, store_id, area_id, number, capacity, pos_x, pos_y, width, height) VALUES ($1,$2,$3,$4,4,$5,20,80,48)",
        [crypto.randomUUID(), store, areaId, n, x],
      );
    }
    const area = (await t.sql.query("SELECT id::text, version FROM area WHERE id=$1", [areaId])).rows[0];
    const ts = (
      await t.sql.query(
        "SELECT id::text, number, pos_x::float8 x, pos_y::float8 y FROM dining_table WHERE area_id=$1 ORDER BY number",
        [area.id],
      )
    ).rows;
    const r = await t.call("PUT", `/config/areas/${area.id}/layout`, {
      token: sis,
      body: {
        tables: [{ id: ts[1].id, x: ts[0].x + 10, y: ts[0].y + 5 }],
        drawings: [],
        version: area.version,
      },
    });
    expect([r.status, r.error.code]).toEqual([422, "TABLE_OVERLAP"]);
    expect(r.error.details).toEqual({ a: ts[1].number, b: ts[0].number });
    // sin solaparse se guarda
    const ok = await t.call("PUT", `/config/areas/${area.id}/layout`, {
      token: sis,
      body: { tables: [{ id: ts[1].id, x: ts[1].x, y: ts[1].y + 1 }], drawings: [], version: area.version },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
  });
});

describe("Mesa: guardar, precuenta y cobro", () => {
  it("la cuenta que se queda sin productos porque se eliminó todo desaparece al guardar", async () => {
    const o = (
      await t.call("POST", "/orders", {
        token: sis,
        body: { tableId: await freeTable(t, "BARRA"), guests: 2 },
      })
    ).body;
    await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta } });
    const acc2 = await t.call("POST", `/orders/${o._id}/accounts`, { token: sis, body: {} });
    expect(acc2.status, JSON.stringify(acc2.env)).toBe(201);
    const a2 = acc2.body.accounts.at(-1);
    const l = await t.call("POST", `/orders/${o._id}/lines`, {
      token: sis,
      body: { plu: PLU.croquetas, accountId: a2.id },
    });
    await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
    const line = l.body.accounts.find((a: any) => a.id === a2.id).lines[0];
    await t.call("POST", `/orders/${o._id}/lines/${line.id}/delete`, {
      token: sis,
      body: { reason: "Error al marcar" },
    });
    const cur = (await t.call("GET", `/orders/${o._id}`, { token: sis })).body;
    expect(cur.accounts).toHaveLength(2);
    const s = await t.call("POST", `/orders/${o._id}/save`, { token: sis, body: { version: cur.version } });
    expect(s.status, JSON.stringify(s.env)).toBe(200);
    expect(s.body.released).toBe(false);
    expect(s.body.order.accounts.map((a: any) => a.id)).toEqual([o.accounts[0].id]);
    // la anulación sigue contando (Eliminaciones)
    const del = await t.call("GET", "/reports/deletions", { token: sis });
    expect(JSON.stringify(del.body)).toContain("Error al marcar");
  });

  it("la precuenta se imprime cada vez que se pide, aunque no haya cambios", async () => {
    const o = (
      await t.call("POST", "/orders", {
        token: sis,
        body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
      })
    ).body;
    await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta } });
    await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
    const n = t.printer.jobs.filter((j) => j.kind === "prebill").length;
    for (let i = 0; i < 2; i++) {
      const r = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/prebill`, {
        token: sis,
        body: {},
      });
      expect(r.status, JSON.stringify(r.env)).toBe(200);
    }
    expect(t.printer.jobs.filter((j) => j.kind === "prebill").length).toBe(n + 2);
  });

  it("no se cobra un menú con un pase sin marchar (en espera) → 409 COURSE_PENDING", async () => {
    const o = (
      await t.call("POST", "/orders", {
        token: sis,
        body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
      })
    ).body;
    const lid = (
      await t.call("POST", `/orders/${o._id}/lines`, {
        token: sis,
        body: { plu: MENU, modifiers: [{ plu: AGUA }] },
      })
    ).body.accounts[0].lines[0].id;
    await t.call("PUT", `/orders/${o._id}/lines/${lid}/answers`, {
      token: sis,
      body: { course: 1, modifiers: [{ plu: CREMA }] },
    });
    await t.call("PUT", `/orders/${o._id}/lines/${lid}/answers`, {
      token: sis,
      body: { course: 2, modifiers: [{ plu: MERLUZA }] },
    });
    const sent = await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
    expect(sent.body.order.accounts[0].lines[0].courses.map((c: any) => c.state)).toEqual([
      "fired",
      "fired",
      "held",
    ]);
    const pay = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/payments`, {
      token: sis,
      body: { method: "cash", amount: 1 },
    });
    expect([pay.status, pay.error.code]).toEqual([409, "COURSE_PENDING"]);
    expect(pay.error.message).toContain("marchar 2.º");
    const chk = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/checkout`, {
      token: sis,
      body: { payments: [{ method: "cash" }] },
    });
    expect([chk.status, chk.error.code]).toEqual([409, "COURSE_PENDING"]);
    // al marcharlo ya se cobra
    await t.call("POST", `/orders/${o._id}/lines/${lid}/fire`, { token: sis, body: { course: 2 } });
    const tx = (await t.call("GET", `/orders/${o._id}`, { token: sis })).body;
    const ok = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/payments`, {
      token: sis,
      body: { method: "card", amount: tx.accounts[0].totals.pending },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(201);
  });
});
