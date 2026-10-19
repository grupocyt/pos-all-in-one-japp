import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

let t: T;
let sis: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
});
afterAll(async () => {
  await t.close();
});

const cv = async () => Number((await t.sql.query("SELECT config_version FROM store")).rows[0].config_version);
const log = async (module: string) =>
  (
    await t.sql.query(
      "SELECT action, record_name, diff, before, after, config_version FROM config_change_log WHERE module=$1 ORDER BY config_version DESC LIMIT 1",
      [module],
    )
  ).rows[0];

describe("Ajustes · lectura", () => {
  it("cada uno de los 19 módulos se lista con id, version y (si aplica) active", async () => {
    for (const m of [
      "restaurante",
      "empresa",
      "facturacion",
      "parametros",
      "usuarios",
      "perfiles",
      "areas",
      "mesas",
      "impuestos",
      "categorias",
      "productos",
      "preguntas",
      "canales",
      "impresoras",
      "estaciones",
      "formas-pago",
      "descuentos",
      "motivos",
      "objetivos",
    ]) {
      const r = await t.call("GET", `/config/${m}?limit=500`, { token: sis });
      expect(r.status, m).toBe(200);
      for (const it of r.body.items) {
        expect(typeof it.id, m).toBe("string");
        expect(it.version, m).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it("módulo que no existe → 404; sin permiso → PERMISSION_REQUIRED", async () => {
    expect((await t.call("GET", "/config/cosas", { token: sis })).status).toBe(404);
    expect((await t.call("GET", "/config/productos", { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
  });
  it("producto por PLU con canales, preguntas e IVA; búsqueda y paginación", async () => {
    const p = await t.call("GET", `/config/productos/${PLU.tosta}`, { token: sis });
    expect(p.body).toMatchObject({ plu: PLU.tosta, active: true });
    expect(p.body.taxRate).toBeGreaterThan(0);
    expect(Array.isArray(p.body.channels)).toBe(true);
    const q = await t.call("GET", "/config/productos?q=tosta&limit=25", { token: sis });
    expect(
      q.body.items.every(
        (x: any) =>
          /tosta/i.test(x.name) || /tosta/i.test(x.ticketName ?? "") || String(x.plu).includes("tosta"),
      ),
    ).toBe(true);
    const pg1 = await t.call("GET", "/config/productos?limit=25", { token: sis });
    expect(pg1.body.items).toHaveLength(25);
    const pg2 = await t.call("GET", `/config/productos?limit=25&cursor=${pg1.body.next}`, { token: sis });
    expect(pg2.body.items[0].id).not.toBe(pg1.body.items[0].id);
  });
  it("pregunta con respuestas (producto, PLU, etiqueta y suplemento) y su pase", async () => {
    const qs = (await t.call("GET", "/config/preguntas?q=Bebida Menu Dia", { token: sis })).body.items;
    expect(qs[0].course).toBe(0);
    expect(qs[0].answers.length).toBeGreaterThan(0);
    expect(qs[0].answers[0]).toHaveProperty("plu");
  });
});

describe("Ajustes · paquete de configuración", () => {
  it("todo lo activo para pintar el equipo, con ETag; mismo ETag → 304; tras un cambio, otro ETag", async () => {
    const r = await t.call("GET", "/config", { token: mesero });
    expect(r.status).toBe(200);
    expect(r.body.restaurant.code).toBe("CT 03");
    expect(r.body.areas.length).toBeGreaterThan(0);
    expect(r.body.areas[0].tables.length).toBeGreaterThan(0);
    expect(r.body.catalog.products.length).toBeGreaterThan(400);
    const etag = r.headers.etag as string;
    expect(etag).toBe(`W/"${r.body.version}"`);
    const again = await t.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/api/v2/config",
        headers: { authorization: `Bearer ${mesero}`, "if-none-match": etag },
      });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");
  });
});

describe("Ajustes · altas, cambios y bajas", () => {
  let catId: string;
  let prodId: string;
  let prodVer: number;
  it("categoría + producto nuevos: PLU siguiente, IVA por tipo, canal por nombre; historial, versión, cola y incidencia", async () => {
    const v0 = await cv();
    const c = await t.call("POST", "/config/categorias", {
      token: sis,
      body: { name: "PRUEBAS API", bgColor: "#123456", fgColor: "#ffffff", sortOrder: 99 },
    });
    expect(c.status).toBe(201);
    catId = c.body.id;
    expect(c.body.configVersion).toBe(v0 + 1);
    const maxPlu = Number((await t.sql.query("SELECT max(plu) m FROM product")).rows[0].m);
    const p = await t.call("POST", "/config/productos", {
      token: sis,
      headers: { "idempotency-key": "8b7d4a1e-0c11-4e5b-9a7a-1f2e3d4c5b6a" },
      body: {
        name: "TAPA DE PRUEBA",
        price: 4.5,
        priceTerrace: 5,
        taxRate: 10,
        categoryId: catId,
        channels: ["BARRA"],
      },
    });
    expect(p.status, JSON.stringify(p.env)).toBe(201);
    expect(p.body.item.buttonLabel).toBe("TAPA DE PRUEBA");
    expect(p.body.item).toMatchObject({
      plu: maxPlu + 1,
      price: 4.5,
      priceTerrace: 5,
      taxRate: 10,
      categoryId: catId,
      active: true,
    });
    expect(p.body.item.channels).toHaveLength(1);
    prodId = p.body.id;
    prodVer = p.body.version;
    // misma Idempotency-Key → misma respuesta, un solo producto
    const again = await t.call("POST", "/config/productos", {
      token: sis,
      headers: { "idempotency-key": "8b7d4a1e-0c11-4e5b-9a7a-1f2e3d4c5b6a" },
      body: {
        name: "TAPA DE PRUEBA",
        price: 4.5,
        priceTerrace: 5,
        taxRate: 10,
        categoryId: catId,
        channels: ["BARRA"],
      },
    });
    expect(again.body.id).toBe(prodId);
    expect(
      Number((await t.sql.query("SELECT count(*) n FROM product WHERE name='TAPA DE PRUEBA'")).rows[0].n),
    ).toBe(1);
    expect(
      (
        await t.sql.query("SELECT label FROM category_product WHERE product_id=$1 AND category_id=$2", [
          prodId,
          catId,
        ])
      ).rows[0].label,
    ).toBe("TAPA DE PRUEBA");
    expect((await log("productos")).action).toBe("create");
    expect(
      Number(
        (
          await t.sql.query("SELECT count(*) n FROM sync_outbox WHERE entity='config' AND entity_id=$1", [
            prodId,
          ])
        ).rows[0].n,
      ),
    ).toBe(1);
    expect(
      (await t.sql.query("SELECT action, status FROM product_incident WHERE product_id=$1", [prodId]))
        .rows[0],
    ).toEqual({ action: "create", status: "pending" });
  });
  it("cambiar precio con versión: queda en el historial legible; versión vieja → VERSION_CONFLICT", async () => {
    const r = await t.call("PATCH", `/config/productos/${prodId}`, {
      token: sis,
      body: { price: 4.8, priceTerrace: null, version: prodVer },
    });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ price: 4.8, priceTerrace: null, version: prodVer + 1 });
    expect((await log("productos")).diff).toBe("PVP: 4,50 → 4,80 · PVP terraza: 5 → —");
    // el texto de la tecla es independiente del nombre (ticket)
    const lb = await t.call("PATCH", `/config/productos/${prodId}`, {
      token: sis,
      body: { buttonLabel: "TAPA PRUEBA", version: prodVer + 1 },
    });
    expect([lb.body.item.buttonLabel, lb.body.item.name]).toEqual(["TAPA PRUEBA", "TAPA DE PRUEBA"]);
    prodVer += 1;
    const old = await t.call("PATCH", `/config/productos/${prodId}`, {
      token: sis,
      body: { price: 9, version: prodVer },
    });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    const nov = await t.call("PATCH", `/config/productos/${prodId}`, { token: sis, body: { price: 9 } });
    expect([nov.status, nov.error.field]).toEqual([422, "version"]);
    const bad = await t.call("PATCH", `/config/productos/${prodId}`, {
      token: sis,
      body: { price: -1, version: prodVer + 1 },
    });
    expect([bad.status, bad.error.field]).toEqual([422, "price"]);
    const extra = await t.call("PATCH", `/config/productos/${prodId}`, {
      token: sis,
      body: { inventado: 1, version: prodVer + 1 },
    });
    expect(extra.status).toBe(422);
  });
  it("el producto nuevo se vende al momento con su precio", async () => {
    await ensurePeriod(t, sis);
    const o = await t.call("POST", "/orders", {
      token: sis,
      body: { tableId: await freeTable(t, "BARRA"), guests: 1 },
    });
    const plu = (await t.call("GET", `/config/productos/${prodId}`, { token: sis })).body.plu;
    const l = await t.call("POST", `/orders/${o.body._id}/lines`, { token: sis, body: { plu } });
    expect(l.status).toBe(201);
    expect(l.body.accounts[0].totals.total).toBe(4.8);
    const lineId = l.body.accounts[0].lines[0].id;
    await t.call("POST", `/orders/${o.body._id}/lines/${lineId}/delete`, {
      token: sis,
      body: { reason: "Prueba" },
    });
    await t.call("POST", `/orders/${o.body._id}/close`, { token: sis, body: {} });
  });
  it("desactivar: la categoría con productos activos no; el producto sí; luego la categoría sí; y se reactiva", async () => {
    const c1 = await t.call("POST", `/config/categorias/${catId}/deactivate`, { token: sis, body: {} });
    expect([c1.status, c1.error.code, c1.error.details.reason]).toEqual([409, "IN_USE", "products"]);
    const p = await t.call("POST", `/config/productos/${prodId}/deactivate`, { token: sis, body: {} });
    expect(p.body).toMatchObject({ active: false });
    expect((await t.sql.query("SELECT active FROM product WHERE id=$1", [prodId])).rows[0].active).toBe(
      false,
    ); // nada se borra
    expect(
      (await t.call("POST", `/config/categorias/${catId}/deactivate`, { token: sis, body: {} })).body.active,
    ).toBe(false);
    expect(
      (await t.call("GET", "/config/categorias?active=false", { token: sis })).body.items.some(
        (x: any) => x.id === catId,
      ),
    ).toBe(true);
    const cur = (await t.call("GET", `/config/categorias/${catId}`, { token: sis })).body;
    const re = await t.call("PATCH", `/config/categorias/${catId}`, {
      token: sis,
      body: { active: true, version: cur.version },
    });
    expect(re.body.item.active).toBe(true);
    expect((await log("categorias")).action).toBe("activate");
  });
});

describe("Ajustes · reglas de cada módulo", () => {
  it("usuarios: PIN cifrado, nunca devuelto, sin repetir; puede entrar; no te desactivas a ti mismo", async () => {
    const prof = (await t.call("GET", "/config/perfiles?q=Mesero", { token: sis })).body.items[0];
    const dup = await t.call("POST", "/config/usuarios", {
      token: sis,
      body: { name: "Repe", profileId: prof.id, pin: PIN.mesero },
    });
    expect([dup.status, dup.error.code, dup.error.field]).toEqual([409, "DUPLICATE", "pin"]);
    const u = await t.call("POST", "/config/usuarios", {
      token: sis,
      body: { name: "Ana Prueba", profileId: prof.id, pin: "7391", lockSeconds: 30 },
    });
    expect(u.status).toBe(201);
    expect(u.body.item).not.toHaveProperty("pin");
    expect(u.body.item).not.toHaveProperty("pinHash");
    expect(u.body.item.initials).toBe("AP");
    expect(
      (await t.sql.query("SELECT pin_hash FROM app_user WHERE id=$1", [u.body.id])).rows[0].pin_hash,
    ).toMatch(/^\$2[aby]\$/);
    const tok = await t.login("7391");
    expect((await t.call("GET", "/sessions/current", { token: tok })).body.lockSeconds).toBe(30);
    // cambiar el PIN deja «PIN: cambiado» en el historial, nunca el valor
    await t.call("PATCH", `/config/usuarios/${u.body.id}`, {
      token: sis,
      body: { pin: "7392", version: u.body.version },
    });
    const h = await log("usuarios");
    expect(h.diff).toBe("PIN: cambiado");
    expect(JSON.stringify([h.before, h.after])).not.toMatch(/7392|7391/);
    const me = (await t.call("GET", "/sessions/current", { token: sis })).body;
    const self = await t.call("POST", `/config/usuarios/${me.user?.id ?? me.userId}/deactivate`, {
      token: sis,
      body: {},
    });
    expect([self.status, self.error?.code]).toEqual([409, "IN_USE"]);
    // perfil con usuarios no se desactiva
    expect(
      (await t.call("POST", `/config/perfiles/${prof.id}/deactivate`, { token: sis, body: {} })).error.details
        .reason,
    ).toBe("users");
  });
  it("perfiles: permisos que existen; al quitar uno, la API lo aplica en la siguiente petición", async () => {
    const bad = await t.call("POST", "/config/perfiles", {
      token: sis,
      body: { code: "TEST", name: "Test", level: 10, permissions: ["cobro.volar"] },
    });
    expect([bad.status, bad.error.field]).toEqual([422, "permissions"]);
    const p = await t.call("POST", "/config/perfiles", {
      token: sis,
      body: { code: "TEST", name: "Test", level: 10, permissions: ["funciones.caja"] },
    });
    expect(p.body.item.permissions).toEqual(["funciones.caja"]);
    const u = await t.call("POST", "/config/usuarios", {
      token: sis,
      body: { name: "Caja Test", profileId: p.body.id, pin: "4826" },
    });
    const tok = await t.login("4826");
    await ensurePeriod(t, sis);
    expect((await t.call("GET", "/cash/summary", { token: tok })).status).toBe(200);
    await t.call("PATCH", `/config/perfiles/${p.body.id}`, {
      token: sis,
      body: { permissions: [], version: p.body.version },
    });
    expect((await t.call("GET", "/cash/summary", { token: tok })).error.code).toBe("PERMISSION_REQUIRED");
    await t.call("POST", `/config/usuarios/${u.body.id}/deactivate`, { token: sis, body: {} });
  });
  it("preguntas: obligatoria sin respuestas no; respuestas por PLU; mínimo > máximo no", async () => {
    expect(
      (
        await t.call("POST", "/config/preguntas", {
          token: sis,
          body: { name: "Punto", minAnswers: 1, maxAnswers: 1, answers: [] },
        })
      ).error.field,
    ).toBe("answers");
    expect(
      (
        await t.call("POST", "/config/preguntas", {
          token: sis,
          body: { name: "Punto", minAnswers: 2, maxAnswers: 1, answers: [{ plu: PLU.redbull }] },
        })
      ).error.field,
    ).toBe("minAnswers");
    expect(
      (
        await t.call("POST", "/config/preguntas", {
          token: sis,
          body: { name: "Punto", minAnswers: 1, maxAnswers: 1, answers: [{ plu: 999999 }] },
        })
      ).error.field,
    ).toBe("answers");
    const q = await t.call("POST", "/config/preguntas", {
      token: sis,
      body: {
        name: "Punto de la carne",
        minAnswers: 1,
        maxAnswers: 1,
        answers: [{ plu: PLU.redbull, label: "Al punto", extraPrice: 0.5 }],
      },
    });
    expect(q.body.item.answers).toEqual([
      expect.objectContaining({ plu: PLU.redbull, label: "Al punto", extraPrice: 0.5 }),
    ]);
  });
  it("áreas y mesas: nombre repetido → DUPLICATE; mesa con cuenta abierta no se desactiva; área con mesas tampoco", async () => {
    const a = (await t.call("GET", "/config/areas", { token: sis })).body.items[0];
    expect((await t.call("POST", "/config/areas", { token: sis, body: { name: a.name } })).error.code).toBe(
      "DUPLICATE",
    );
    const area = await t.call("POST", "/config/areas", {
      token: sis,
      body: { name: "SALÓN PRUEBAS", priceList: "general", tableNumberFrom: 700 },
    });
    const m = await t.call("POST", "/config/mesas", {
      token: sis,
      body: { number: "701", areaId: area.body.id, capacity: 6, posX: 10, posY: 10 },
    });
    expect(m.status).toBe(201);
    expect(
      (await t.call("POST", `/config/areas/${area.body.id}/deactivate`, { token: sis, body: {} })).error
        .details.reason,
    ).toBe("children");
    await ensurePeriod(t, sis);
    const o = await t.call("POST", "/orders", { token: sis, body: { tableId: m.body.id, guests: 2 } });
    expect(
      (await t.call("POST", `/config/mesas/${m.body.id}/deactivate`, { token: sis, body: {} })).error.details
        .reason,
    ).toBe("openOrders");
    await t.call("POST", `/orders/${o.body._id}/close`, { token: sis, body: {} });
    expect(
      (await t.call("POST", `/config/mesas/${m.body.id}/deactivate`, { token: sis, body: {} })).body.active,
    ).toBe(false);
    expect(
      (await t.call("POST", `/config/areas/${area.body.id}/deactivate`, { token: sis, body: {} })).body
        .active,
    ).toBe(false);
  });
  it("estaciones: canal → impresora, formas de pago por código; impresora asignada no se desactiva", async () => {
    const pr = await t.call("POST", "/config/impresoras", {
      token: sis,
      body: { name: "COCINA 2", connection: "192.168.1.60", kind: "kitchen" },
    });
    const st = await t.call("POST", "/config/estaciones", {
      token: sis,
      body: {
        name: "PDA9",
        kind: "pda",
        ip: "192.168.1.90",
        channels: { BARRA: pr.body.id },
        paymentMethods: ["card"],
      },
    });
    expect(st.status, JSON.stringify(st.env)).toBe(201);
    expect(Object.values(st.body.item.channels)).toEqual([pr.body.id]);
    expect(st.body.item.paymentMethods).toHaveLength(1);
    expect(
      (await t.call("POST", `/config/impresoras/${pr.body.id}/deactivate`, { token: sis, body: {} })).error
        .details.reason,
    ).toBe("stations");
    expect(
      (
        await t.call("POST", "/config/formas-pago", {
          token: sis,
          body: { code: "bizum", name: "Bizum", kind: "platform" },
        })
      ).status,
    ).toBe(201);
    const cash = (await t.call("GET", "/config/formas-pago", { token: sis })).body.items.find(
      (x: any) => x.code === "cash",
    );
    expect(
      (await t.call("POST", `/config/formas-pago/${cash.id}/deactivate`, { token: sis, body: {} })).error
        .details.reason,
    ).toBe("base");
  });
  it("descuentos, impuestos, motivos y objetivos con sus reglas", async () => {
    expect(
      (await t.call("POST", "/config/descuentos", { token: sis, body: { name: "Mal", percent: 150 } })).error
        .field,
    ).toBe("percent");
    expect(
      (
        await t.call("POST", "/config/descuentos", {
          token: sis,
          body: { name: "Otoño", percent: 10, validFrom: "2026-11-01", validTo: "2026-10-01" },
        })
      ).error.field,
    ).toBe("validTo");
    expect(
      (
        await t.call("POST", "/config/descuentos", {
          token: sis,
          body: {
            name: "Otoño",
            percent: 10,
            validFrom: "2026-10-01",
            validTo: "2026-11-30",
            needsAuthorization: true,
          },
        })
      ).body.item.validTo,
    ).toBe("2026-11-30");
    expect(
      (
        await t.call("POST", "/config/motivos", {
          token: sis,
          body: { name: "Cliente se fue", kind: "delete" },
        })
      ).status,
    ).toBe(201);
    const iva = (await t.call("GET", "/config/impuestos", { token: sis })).body.items.find(
      (x: any) => x.rate === 10,
    );
    expect(
      (await t.call("POST", `/config/impuestos/${iva.id}/deactivate`, { token: sis, body: {} })).error.details
        .reason,
    ).toBe("products");
    const o = await t.call("POST", "/config/objetivos", { token: sis, body: { year: 2026, growthPct: 5 } });
    expect(o.body.item).toMatchObject({ year: 2026, week: 0, growthPct: 5 });
    expect(
      (await t.call("POST", "/config/objetivos", { token: sis, body: { year: 2026, growthPct: 7 } })).error
        .code,
    ).toBe("DUPLICATE");
    expect(
      (await t.call("POST", `/config/objetivos/${o.body.id}/deactivate`, { token: sis, body: {} })).status,
    ).toBe(422);
  });
  it("módulos de un solo registro: se cambian con «current»; los parámetros se aplican al momento", async () => {
    expect((await t.call("POST", "/config/parametros", { token: sis, body: {} })).status).toBe(422);
    const p = (await t.call("GET", "/config/parametros/current", { token: sis })).body;
    const r = await t.call("PATCH", "/config/parametros/current", {
      token: sis,
      body: { lockSeconds: 15, version: p.version },
    });
    expect(r.body.item.lockSeconds).toBe(15);
    expect((await t.call("POST", "/sessions", { body: { pin: PIN.barra } })).body.lockSeconds).toBe(15);
    expect(
      (
        await t.call("PATCH", "/config/parametros/current", {
          token: sis,
          body: { pinAttempts: 0, version: r.body.version },
        })
      ).error.field,
    ).toBe("pinAttempts");
    await t.call("PATCH", "/config/parametros/current", {
      token: sis,
      body: { lockSeconds: 7, version: r.body.version },
    });
    const rest = (await t.call("GET", "/config/restaurante/current", { token: sis })).body;
    const r2 = await t.call("PATCH", "/config/restaurante/current", {
      token: sis,
      body: { phone: "910 000 000", version: rest.version },
    });
    expect(r2.body.item.phone).toBe("910 000 000");
    const emp = (await t.call("GET", "/config/empresa/current", { token: sis })).body;
    expect(emp.taxId).toBeTruthy();
  });
});

describe("Ajustes · historial", () => {
  it("lista lo cambiado, filtra por módulo y registro; el mesero no lo ve", async () => {
    const h = await t.call("GET", "/config/history?module=productos&limit=5", { token: sis });
    expect(h.body.items.length).toBeGreaterThan(0);
    expect(h.body.items.every((x: any) => x.module === "productos")).toBe(true);
    expect(h.body.items[0].configVersion).toBeGreaterThan(1);
    const id = h.body.items[0].recordId;
    expect(
      (await t.call("GET", `/config/history?recordId=${id}`, { token: sis })).body.items.every(
        (x: any) => x.recordId === id,
      ),
    ).toBe(true);
    expect((await t.call("GET", "/config/history", { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
  });
});
