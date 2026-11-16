import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, type T } from "./helpers.js";

/**
 * 1.2.270 (16/11/2026): publicación de Carta (release), canales COMIDA/BEBIDA, Order on Table encendido o apagado y
 * usuarios sin repetir. La base es compartida: al final la carta, las teclas y los usuarios quedan como estaban.
 */
let t: T;
let sis: string;
let store: string;
let original: any;
let keys: any[];
let webUrl: string | null;

const getCarta = async () => (await t.call("GET", "/config/carta", { token: sis })).body;
const post = (url: string, body: unknown, token = sis) => t.call("POST", url, { token, body });
const at = (ms: number) => new Date(t.clock.now.getTime() + ms).toISOString();
let ver = 100;
const release = (kind: string, o: Record<string, unknown> = {}) => ({
  kind,
  releaseVersion: ++ver,
  effectiveAt: at(0),
  checksum: null,
  store,
  priceLine: "GENERAL CYT",
  menu: "m_prueba",
  publicationType: { full: "completa", prices: "precios", names: "nombres", withdraw: "retirar" }[kind],
  publicationId: "pub_prueba_270",
  ...o,
});
/** Una carta mínima con lo nuevo: traducciones, calificativos, canales, pregunta obligatoria y teclas. */
const full = (o: { price?: number } = {}) => ({
  release: release("full"),
  categories: [
    {
      externalId: "c_t270_menu",
      name: "MENU T270",
      description: "Menús de mediodía",
      bgColor: "#6B4FBB",
      fgColor: "#FFFFFF",
      sortOrder: 1,
      hidden: false,
      orderOnTable: true,
      translations: { en: { name: "SET MENU T270" } },
      qualifiers: [
        { productExternalId: "q_t270_2", plu: 970002, sortOrder: 2 },
        { productExternalId: "q_t270_1", plu: 970001, sortOrder: 1 },
      ],
    },
    { externalId: "MGR-MOD", name: "MODIFICADORES T270", description: "", bgColor: null, fgColor: null, sortOrder: 99, hidden: true, orderOnTable: false, translations: {} },
  ],
  products: [
    {
      externalId: "p_t270",
      plu: 970000,
      name: "MENU T270",
      ticketName: "MENU T270",
      buttonLabel: "MENU 270",
      description: "Primero y bebida",
      categoryExternalId: "c_t270_menu",
      price: o.price ?? 13.9,
      priceTerrace: 15.5,
      taxRate: 10,
      questionExternalIds: ["g_t270"],
      bgColor: "#FFFF00",
      fgColor: "#000000",
      printChannels: ["comida", "BEBIDA"],
      answerOnly: false,
      orderOnTable: true,
      translations: { en: { name: "SET MENU 270", ticketName: "MENU T270", buttonLabel: "MENU 270", description: "Starter and drink" } },
    },
    { externalId: "m_t270_agua", plu: 970010, name: "AGUA T270", ticketName: "AGUA T270", buttonLabel: "AGUA T270", description: "", categoryExternalId: "MGR-MOD", price: 0, priceTerrace: null, taxRate: 10, questionExternalIds: [], bgColor: null, fgColor: null, printChannels: ["BEBIDA"], answerOnly: true, orderOnTable: false, translations: {} },
    { externalId: "q_t270_1", plu: 970001, name: "SIN SAL T270", ticketName: "SIN SAL T270", buttonLabel: "SIN SAL", description: "", categoryExternalId: "MGR-MOD", price: 0, priceTerrace: null, taxRate: 10, questionExternalIds: [], bgColor: null, fgColor: null, printChannels: [], answerOnly: true, orderOnTable: false, qualifier: true, translations: {} },
    { externalId: "q_t270_2", plu: 970002, name: "POCO HECHO T270", ticketName: "POCO HECHO T270", buttonLabel: "POCO HECHO", description: "", categoryExternalId: "MGR-MOD", price: 0, priceTerrace: null, taxRate: 10, questionExternalIds: [], bgColor: null, fgColor: null, printChannels: [], answerOnly: true, orderOnTable: false, qualifier: true, translations: {} },
  ],
  questions: [
    {
      externalId: "g_t270",
      plu: null,
      name: "BEBIDA T270",
      description: "BEBIDA (min1-max1)",
      minAnswers: 1,
      maxAnswers: 1,
      required: true,
      answerType: "unica",
      course: 0,
      courseName: "Bebida",
      translations: { en: { name: "DRINK T270", description: "" } },
      answers: [{ productExternalId: "m_t270_agua", plu: 970010, sortOrder: 1, label: "", extraPrice: 0, bgColor: null, fgColor: null, translations: { en: { label: "WATER" } } }],
    },
  ],
  keys: [
    { categoryExternalId: "c_t270_menu", productExternalId: "p_t270", plu: 970000, label: "", bgColor: "#FFFF00", fgColor: "#000000", posX: 0, posY: 0 },
  ],
});

beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  await ensurePeriod(t, sis);
  store = (await t.sql.query("SELECT code FROM store")).rows[0].code;
  original = await getCarta();
  keys = (await t.sql.query("SELECT * FROM category_product")).rows;
  webUrl = (await t.sql.query("SELECT web_order_url FROM store")).rows[0].web_order_url;
});
afterAll(async () => {
  // la carta, las teclas y Order on Table como estaban para las demás pruebas
  const back = await post("/config/carta/sync", { categories: original.categories, products: original.products, questions: original.questions });
  if (back.status !== 200) console.error("pruebas-270 · no se pudo dejar la carta como estaba", back.status, JSON.stringify(back.error));
  await t.sql.query("DELETE FROM category_product");
  for (const k of keys) {
    await t.sql.query(
      "INSERT INTO category_product (category_id, product_id, store_id, label, bg_color, fg_color, pos_x, pos_y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [k.category_id, k.product_id, k.store_id, k.label, k.bg_color, k.fg_color, k.pos_x, k.pos_y],
    );
  }
  await t.sql.query("UPDATE store SET oot_enabled = TRUE, web_order_url = $1", [webUrl]);
  await t.close();
});

describe("Publicación de Carta (release)", () => {
  it("full: categorías, productos, preguntas y teclas con lo nuevo (traducciones, calificativos, COMIDA/BEBIDA, obligatoria)", async () => {
    const r = await post("/config/carta/sync", full());
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.release).toMatchObject({ kind: "full", status: "applied", publicationId: "pub_prueba_270", store, priceLine: "GENERAL CYT" });
    expect(r.body.result.keys).toEqual({ count: 1, changed: true });
    const c = await getCarta();
    const cat = c.categories.find((x: any) => x.externalId === "c_t270_menu");
    expect(cat).toMatchObject({ description: "Menús de mediodía", translations: { en: { name: "SET MENU T270" } }, qualifiers: [970001, 970002] });
    const p = c.products.find((x: any) => x.externalId === "p_t270");
    expect(p).toMatchObject({ buttonLabel: "MENU 270", channels: ["BEBIDA", "COMIDA"], qualifier: false, translations: { en: { name: "SET MENU 270" } } });
    expect(c.products.find((x: any) => x.plu === 970001)).toMatchObject({ qualifier: true, channels: [] });
    const q = c.questions.find((x: any) => x.externalId === "g_t270");
    expect(q).toMatchObject({ required: true, answerType: "unica", courseName: "Bebida", description: "BEBIDA (min1-max1)" });
    expect(q.answers[0]).toMatchObject({ plu: 970010, translations: { en: { label: "WATER" } } });
    // lo que no venía en la carga se desactiva (es la carta entera) y las teclas son solo las de la carga
    expect(c.products.some((x: any) => x.plu === original.products[0].plu)).toBe(false);
    const k = (await t.sql.query("SELECT label, pos_x, pos_y FROM category_product")).rows;
    expect(k).toEqual([{ label: "MENU 270", pos_x: 0, pos_y: 0 }]);
  });
  it("la misma carga otra vez → la misma respuesta (repeated); otra con la misma versión → 409; una versión vieja → 409", async () => {
    const body = full();
    const a = await post("/config/carta/sync", body);
    const b = await post("/config/carta/sync", body);
    expect(b.body.repeated).toBe(true);
    expect(b.body.release.id).toBe(a.body.release.id);
    const other = { ...full({ price: 14 }), release: { ...body.release } };
    const c = await post("/config/carta/sync", other);
    expect([c.status, c.error.code, c.error.field]).toEqual([409, "VERSION_CONFLICT", "release.releaseVersion"]);
    const old = { ...full(), release: { ...release("full"), releaseVersion: 1 } };
    expect((await post("/config/carta/sync", old)).error.code).toBe("VERSION_CONFLICT");
  });
  it("otra tienda → 422 release.store; un canal que no es COMIDA ni BEBIDA → 422 con la fila; teclas en la misma casilla → 409", async () => {
    const a = full();
    a.release.store = "XX99";
    expect((await post("/config/carta/sync", a)).error.field).toBe("release.store");
    const b = full();
    b.products[0]!.printChannels = ["POSTRES"];
    const rb = await post("/config/carta/sync", b);
    expect([rb.status, rb.error.field]).toEqual([422, "products[0].printChannels[0]"]);
    const c = full();
    c.keys.push({ ...c.keys[0]!, productExternalId: "m_t270_agua", plu: 970010 });
    expect((await post("/config/carta/sync", c)).error).toMatchObject({ code: "DUPLICATE", field: "keys[1]" });
    const d = full();
    d.categories[0]!.qualifiers = [{ productExternalId: "p_t270", plu: 970000, sortOrder: 1 }];
    expect((await post("/config/carta/sync", d)).error.field).toBe("categories[0].qualifiers[0]");
  });
  it("prices y names: solo esos campos de productos que existen; uno que no existe → 422 REF_NOT_FOUND", async () => {
    const pr = await post("/config/carta/sync", {
      release: release("prices"),
      products: [{ externalId: "p_t270", plu: 970000, price: 12.5, priceTerrace: 14 }],
    });
    expect(pr.status, JSON.stringify(pr.env)).toBe(200);
    expect(pr.body.result.products).toEqual({ received: 1, updated: 1 });
    const nm = await post("/config/carta/sync", {
      release: release("names"),
      products: [{ externalId: "p_t270", plu: 970000, name: "MENU T270 B", ticketName: "MENU B", buttonLabel: "MENU B", translations: { en: { name: "SET B" } } }],
    });
    expect(nm.body.release.status).toBe("applied");
    const p = (await getCarta()).products.find((x: any) => x.externalId === "p_t270");
    expect(p).toMatchObject({ price: 12.5, priceTerrace: 14, name: "MENU T270 B", ticketName: "MENU B", buttonLabel: "MENU B", channels: ["BEBIDA", "COMIDA"] });
    expect((await t.sql.query("SELECT label FROM category_product WHERE product_id=$1", [p.id])).rows[0].label).toBe("MENU B");
    const bad = await post("/config/carta/sync", { release: release("prices"), products: [{ externalId: "nope", plu: 999999, price: 1 }] });
    expect([bad.status, bad.error.code, bad.error.field]).toEqual([422, "REF_NOT_FOUND", "products[0].externalId"]);
  });
  it("con fecha futura queda pendiente y se aplica sola a su hora", async () => {
    const body = { release: release("prices", { effectiveAt: at(3_600_000) }), products: [{ externalId: "p_t270", plu: 970000, price: 11 }] };
    const r = await post("/config/carta/sync", body);
    expect(r.body.release.status).toBe("pending");
    const price = async () => (await getCarta()).products.find((x: any) => x.externalId === "p_t270").price;
    expect(await price()).toBe(12.5);
    expect(await t.releases.applyDue()).toBe(0);
    t.clock.now = new Date(t.clock.now.getTime() + 3_600_000);
    expect(await t.releases.applyDue()).toBe(1);
    expect(await price()).toBe(11);
    const list = await t.call("GET", "/config/carta/releases?limit=5", { token: sis });
    expect(list.body.items[0]).toMatchObject({ id: r.body.release.id, status: "applied" });
    // una futura con un producto que no existe se rechaza al llegar
    const bad = await post("/config/carta/sync", { release: release("prices", { effectiveAt: at(60_000_000) }), products: [{ plu: 999999, price: 1 }] });
    expect(bad.error.code).toBe("REF_NOT_FOUND");
  });
  it("withdraw espera a un encargado: confirm desactiva toda la carta; cancel no la aplica", async () => {
    const w1 = await post("/config/carta/sync", { release: release("withdraw"), note: "Carta vacía: el TPV desactiva lo que no viene en la carga." });
    expect(w1.body.release).toMatchObject({ status: "confirm", note: expect.stringContaining("Carta vacía") });
    expect((await getCarta()).products.length).toBeGreaterThan(0);
    const c1 = await post(`/config/carta/releases/${w1.body.release.id}/cancel`, { reason: "Era una prueba" });
    expect(c1.body.release).toMatchObject({ status: "cancelled", decidedBy: "Sistemas" });
    const w2 = await post("/config/carta/sync", { release: release("withdraw"), note: null });
    const ok = await post(`/config/carta/releases/${w2.body.release.id}/confirm`, {});
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body.release.status).toBe("applied");
    expect((await getCarta()).products).toEqual([]);
    expect((await post(`/config/carta/releases/${w2.body.release.id}/confirm`, {})).error.code).toBe("INVALID_TRANSITION");
  });
});

describe("Order on Table encendido o apagado (Ajustes › Restaurante)", () => {
  it("apagado → crear el QR da 409 OOT_NOT_CONFIGURED; encendido vuelve a funcionar", async () => {
    await post("/config/carta/sync", { categories: original.categories, products: original.products, questions: original.questions });
    await t.sql.query("UPDATE store SET web_order_url = COALESCE(web_order_url, 'https://pedidos.example.com')");
    const item = (await t.call("GET", "/config/restaurante/current", { token: sis })).body;
    const off = await t.call("PATCH", "/config/restaurante/current", { token: sis, body: { ootEnabled: false, version: item.version } });
    expect(off.status, JSON.stringify(off.env)).toBe(200);
    const o = await post("/orders", { tableId: await freeTable(t, "BARRA"), guests: 2 });
    const qr = await post(`/orders/${o.body._id}/oot`, { print: false });
    expect([qr.status, qr.error?.code]).toEqual([409, "OOT_NOT_CONFIGURED"]);
    await t.call("PATCH", "/config/restaurante/current", { token: sis, body: { ootEnabled: true, version: off.body.version } });
    const qr2 = await post(`/orders/${o.body._id}/oot`, { print: false });
    expect(qr2.status, JSON.stringify(qr2.env)).toBe(201);
    await post(`/orders/${o.body._id}/close`, {});
  });
});

describe("Usuarios: nombre, iniciales y clave no se repiten", () => {
  it("nombre (sin mayúsculas), iniciales y clave de otro → 409 DUPLICATE con el campo; iniciales automáticas se numeran", async () => {
    const prof = (await t.call("GET", "/config/perfiles?limit=50", { token: sis })).body.items[0].id;
    const mk = (b: Record<string, unknown>) => post("/config/usuarios", { profileId: prof, ...b });
    expect((await mk({ name: " sistemas ", initials: "ZZ", pin: "4821" })).error).toMatchObject({ code: "DUPLICATE", field: "name" });
    const si = (await t.sql.query("SELECT initials FROM app_user WHERE name='Sistemas'")).rows[0].initials;
    expect((await mk({ name: "Prueba Iniciales", initials: String(si).toLowerCase(), pin: "4821" })).error).toMatchObject({ code: "DUPLICATE", field: "initials" });
    expect((await mk({ name: "Prueba Clave", initials: "PC", pin: PIN.sistemas })).error).toMatchObject({ code: "DUPLICATE", field: "pin" });
    const a = await mk({ name: "Zoe Zamora", pin: "4822" });
    const b = await mk({ name: "Zeta Zulú", pin: "4823" });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.item.initials, b.body.item.initials]).toEqual(["ZZ", "ZZ2"]);
    await t.sql.query("DELETE FROM app_user WHERE id = ANY($1::uuid[])", [[a.body.id, b.body.id]]);
  });
});
