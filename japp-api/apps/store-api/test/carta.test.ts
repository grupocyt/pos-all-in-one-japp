import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Ajustes › Carta y los servicios Sync del App Manager.
 * La base es compartida con las demás pruebas: lo que se crea aquí lleva externalId «MGR-T-…» y al final
 * se vuelve a cargar la carta original (lo de prueba queda desactivado y lo de la tienda, como estaba).
 */
let t: T;
let sis: string;
let mesero: string;
let original: any;
let areaOrder: string[];

const cv = async () => Number((await t.sql.query("SELECT config_version FROM store")).rows[0].config_version);
const logCount = async () =>
  Number((await t.sql.query("SELECT count(*) n FROM config_change_log")).rows[0].n);
const outboxCount = async () =>
  Number((await t.sql.query("SELECT count(*) n FROM sync_outbox WHERE entity = 'config'")).rows[0].n);
const getCarta = async (q = "") => {
  const r = await t.call("GET", `/config/carta${q}`, { token: sis });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r.body;
};
/** La carta tal como la devuelve GET /config/carta, lista para mandarla otra vez. */
const resend = (c: any) => ({ categories: c.categories, products: c.products, questions: c.questions });
const post = (url: string, body: unknown, token = sis, headers: Record<string, string> = {}) =>
  t.call("POST", url, { token, body, headers });

beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  original = await getCarta();
  areaOrder = (await t.sql.query("SELECT id FROM area WHERE active ORDER BY sort_order, name")).rows.map(
    (r) => r.id,
  );
});
afterAll(async () => {
  // deja la carta y el orden de las áreas como estaban para las demás pruebas
  const r = await post("/config/carta/sync", resend(original));
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  await t.call("PUT", "/config/areas/order", { token: sis, body: { ids: areaOrder } });
  await t.close();
});

describe("GET /config/carta", () => {
  it("categorías, productos y preguntas con id, externalId y relaciones; active=all incluye desactivados", async () => {
    const c = original;
    const n = (await t.sql.query("SELECT count(*) n FROM product WHERE active")).rows[0].n;
    expect(c.products).toHaveLength(Number(n));
    expect(c.categories.length).toBeGreaterThan(0);
    expect(c.configVersion).toBe(await cv());
    const tosta = c.products.find((p: any) => p.plu === PLU.tosta);
    expect(tosta).toMatchObject({ externalId: null, active: true, orderOnTable: true });
    expect(tosta.taxRate).toBeGreaterThan(0);
    expect(tosta.categoryId).toBeTruthy();
    const q = c.questions.find((x: any) => x.answers.length > 0);
    expect(q.answers[0]).toHaveProperty("productId");
    expect(q.answers[0]).toHaveProperty("plu");
    const id = crypto.randomUUID();
    await t.sql.query(
      "INSERT INTO category (id, store_id, name, active) SELECT $1, id, 'ZZ CARTA INACTIVA', false FROM store",
      [id],
    );
    expect((await getCarta()).categories.some((x: any) => x.id === id)).toBe(false);
    expect((await getCarta("?active=all")).categories.find((x: any) => x.id === id)).toMatchObject({
      active: false,
    });
  });
  it("sin permiso → 403 PERMISSION_REQUIRED; active que no es true/all → 422", async () => {
    const r = await t.call("GET", "/config/carta", { token: mesero });
    expect([r.status, r.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    expect((await t.call("GET", "/config/carta?active=x", { token: sis })).status).toBe(422);
  });
});

describe("POST /config/categorias/sync", () => {
  const seed = () =>
    original.categories.map((c: any) => ({
      name: c.name,
      bgColor: c.bgColor,
      fgColor: c.fgColor,
      sortOrder: c.sortOrder,
      hidden: c.hidden,
      orderOnTable: c.orderOnTable,
    }));
  const nueva = { externalId: "MGR-T-CAT-1", name: "SYNC BEBIDAS", bgColor: "#1b5e66", sortOrder: 90 };
  let catId: string;

  it("crea la que no existe; lo demás sin cambios; versión +1 una vez, historial por registro y una fila en la cola", async () => {
    const [v0, l0, o0] = [await cv(), await logCount(), await outboxCount()];
    const r = await post("/config/categorias/sync", { items: [...seed(), nueva] });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body).toMatchObject({ created: 1, updated: 0, deactivated: 0, unchanged: seed().length });
    expect(r.body.configVersion).toBe(v0 + 1);
    const item = r.body.items.find((x: any) => x.externalId === "MGR-T-CAT-1");
    expect(item.action).toBe("created");
    catId = item.id;
    const row = (
      await t.sql.query(
        "SELECT name, external_id, bg_color, sort_order, order_on_table FROM category WHERE id=$1",
        [catId],
      )
    ).rows[0];
    expect(row).toEqual({
      name: "SYNC BEBIDAS",
      external_id: "MGR-T-CAT-1",
      bg_color: "#1b5e66",
      sort_order: 90,
      order_on_table: true,
    });
    expect(await cv()).toBe(v0 + 1);
    expect(await logCount()).toBe(l0 + 1);
    expect(await outboxCount()).toBe(o0 + 1);
    const log = (
      await t.sql.query("SELECT module, action FROM config_change_log WHERE record_id=$1", [catId])
    ).rows;
    expect(log).toEqual([{ module: "categorias", action: "create" }]);
  });
  it("la misma lista otra vez: todo «unchanged» y no sube la versión", async () => {
    const v0 = await cv();
    const r = await post("/config/categorias/sync", { items: [...seed(), nueva] });
    expect(r.body).toMatchObject({ created: 0, updated: 0, deactivated: 0, unchanged: seed().length + 1 });
    expect(await cv()).toBe(v0);
  });
  it("lo que no viene se desactiva; si vuelve su externalId se reactiva con el mismo id", async () => {
    const off = await post("/config/categorias/sync", { items: seed() });
    expect(off.body.deactivated).toBe(1);
    expect(off.body.items.find((x: any) => x.id === catId).action).toBe("deactivated");
    expect((await t.sql.query("SELECT active FROM category WHERE id=$1", [catId])).rows[0].active).toBe(
      false,
    );
    const on = await post("/config/categorias/sync", {
      items: [...seed(), { ...nueva, name: "SYNC BEBIDAS FRIAS" }],
    });
    expect(on.body).toMatchObject({ created: 0, updated: 1 });
    const it2 = on.body.items.find((x: any) => x.externalId === "MGR-T-CAT-1");
    expect([it2.id, it2.action]).toEqual([catId, "reactivated"]);
    const row = (await t.sql.query("SELECT active, name, version FROM category WHERE id=$1", [catId]))
      .rows[0];
    expect(row).toMatchObject({ active: true, name: "SYNC BEBIDAS FRIAS", version: 3 });
    expect(
      (
        await t.sql.query("SELECT action FROM config_change_log WHERE record_id=$1 ORDER BY config_version", [
          catId,
        ])
      ).rows.map((x) => x.action),
    ).toEqual(["create", "deactivate", "activate"]);
    nueva.name = "SYNC BEBIDAS FRIAS";
  });
  it("una categoría con productos activos que no viene → 409 IN_USE y no cambia nada", async () => {
    const v0 = await cv();
    const r = await post("/config/categorias/sync", { items: [nueva] });
    expect([r.status, r.error.code]).toEqual([409, "IN_USE"]);
    expect(r.error.details.items.length).toBeGreaterThan(0);
    expect(await cv()).toBe(v0);
    expect(Number((await t.sql.query("SELECT count(*) n FROM category WHERE active")).rows[0].n)).toBe(
      seed().length + 1,
    );
  });
  it("repetidos → 409 DUPLICATE con la fila; sin nombre → 422 con la fila; más de 500 → 413 TOO_LARGE", async () => {
    const dup = await post("/config/categorias/sync", { items: [...seed(), nueva, { name: nueva.name }] });
    expect([dup.status, dup.error.code, dup.error.field]).toEqual([
      409,
      "DUPLICATE",
      `items[${seed().length + 1}].name`,
    ]);
    const dupExt = await post("/config/categorias/sync", {
      items: [
        { externalId: "X1", name: "A" },
        { externalId: "X1", name: "B" },
      ],
    });
    expect([dupExt.error.code, dupExt.error.field]).toEqual(["DUPLICATE", "items[1].externalId"]);
    const bad = await post("/config/categorias/sync", {
      items: [{ name: "A" }, { name: "B" }, { bgColor: null }],
    });
    expect([bad.status, bad.error.code, bad.error.field]).toEqual([422, "VALIDATION", "items[2].name"]);
    const big = await post("/config/categorias/sync", {
      items: Array.from({ length: 501 }, (_, i) => ({ name: `C${i}` })),
    });
    expect([big.status, big.error.code, big.error.details.max]).toEqual([413, "TOO_LARGE", 500]);
  });
  it("sin permiso → 403; misma Idempotency-Key → una sola carga", async () => {
    const r = await post("/config/categorias/sync", { items: seed() }, mesero);
    expect([r.status, r.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    const key = crypto.randomUUID();
    const items = [...seed(), { ...nueva, sortOrder: 91 }];
    const v0 = await cv();
    const a = await post("/config/categorias/sync", { items }, sis, { "idempotency-key": key });
    const b = await post("/config/categorias/sync", { items }, sis, { "idempotency-key": key });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.body).toEqual(a.body);
    expect(await cv()).toBe(v0 + 1);
  });
});

describe("POST /config/productos/sync", () => {
  const seed = () => original.products;
  const nuevo = {
    externalId: "MGR-T-P-1",
    name: "GRANIZADO PRUEBA",
    description: "Limón natural\nSin azúcar añadido",
    categoryExternalId: "MGR-T-CAT-1",
    price: 3.95,
    taxRate: 10,
    channels: ["BARRA"],
    orderOnTable: true,
  };
  let prodId: string;
  let plu: number;

  it("crea el nuevo con el PLU siguiente, su categoría y su tecla; el resto sin cambios (canales se ignoran)", async () => {
    const max = Number((await t.sql.query("SELECT max(plu) m FROM product")).rows[0].m);
    const r = await post("/config/productos/sync", { items: [...seed(), nuevo] });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body).toMatchObject({ created: 1, updated: 0, deactivated: 0, unchanged: seed().length });
    const item = r.body.items.find((x: any) => x.externalId === "MGR-T-P-1");
    expect(item).toMatchObject({ action: "created", plu: max + 1, name: "GRANIZADO PRUEBA" });
    prodId = item.id;
    plu = item.plu;
    const p = (
      await t.sql.query(
        "SELECT p.description, p.price::float8 price, c.external_id cat, t.rate::float8 rate FROM product p JOIN category c ON c.id=p.category_id JOIN tax t ON t.id=p.tax_id WHERE p.id=$1",
        [prodId],
      )
    ).rows[0];
    expect(p).toEqual({
      description: "Limón natural\nSin azúcar añadido",
      price: 3.95,
      cat: "MGR-T-CAT-1",
      rate: 10,
    });
    const btn = (
      await t.sql.query(
        "SELECT c.external_id cat, cp.label FROM category_product cp JOIN category c ON c.id=cp.category_id WHERE cp.product_id=$1",
        [prodId],
      )
    ).rows;
    expect(btn).toEqual([{ cat: "MGR-T-CAT-1", label: "GRANIZADO PRUEBA" }]);
    expect(
      Number(
        (await t.sql.query("SELECT count(*) n FROM product_channel WHERE product_id=$1", [prodId])).rows[0].n,
      ),
    ).toBe(0);
  });
  it("cambia lo que manda el Manager (precio); el agotado que no viene se conserva", async () => {
    await t.sql.query("UPDATE product SET sold_out = true WHERE id=$1", [prodId]);
    const r = await post("/config/productos/sync", { items: [...seed(), { ...nuevo, plu, price: 4.2 }] });
    expect(r.body).toMatchObject({ created: 0, updated: 1, unchanged: seed().length });
    const p = (
      await t.sql.query("SELECT price::float8 price, sold_out, version FROM product WHERE id=$1", [prodId])
    ).rows[0];
    expect(p).toEqual({ price: 4.2, sold_out: true, version: 2 });
    nuevo.price = 4.2;
    await t.sql.query("UPDATE product SET sold_out = false WHERE id=$1", [prodId]);
  });
  it("referencias que no existen → 422 REF_NOT_FOUND con el campo exacto (categoría, IVA, pregunta)", async () => {
    const at = seed().length;
    const cat = await post("/config/productos/sync", {
      items: [...seed(), { ...nuevo, categoryExternalId: "NO" }],
    });
    expect([cat.status, cat.error.code, cat.error.field]).toEqual([
      422,
      "REF_NOT_FOUND",
      `items[${at}].categoryExternalId`,
    ]);
    const tax = await post("/config/productos/sync", { items: [...seed(), { ...nuevo, taxRate: 33 }] });
    expect([tax.error.code, tax.error.field]).toEqual(["REF_NOT_FOUND", `items[${at}].taxRate`]);
    const q = await post("/config/productos/sync", {
      items: [...seed(), { ...nuevo, questionExternalIds: ["MGR-NO"] }],
    });
    expect([q.error.code, q.error.field]).toEqual(["REF_NOT_FOUND", `items[${at}].questionExternalIds[0]`]);
    const noTax = await post("/config/productos/sync", {
      items: [...seed(), { ...nuevo, externalId: "MGR-T-P-NOTAX", plu: null, taxRate: null }],
    });
    expect([noTax.status, noTax.error.field]).toEqual([422, `items[${at}].taxRate`]);
    const price = await post("/config/productos/sync", { items: [{ ...nuevo, price: -1 }] });
    expect([price.status, price.error.field]).toEqual([422, "items[0].price"]);
  });
  it("PLU repetido en la lista → 409 DUPLICATE; más de 2.000 → 413", async () => {
    const dup = await post("/config/productos/sync", { items: [...seed(), { ...nuevo, plu: PLU.tosta }] });
    expect([dup.status, dup.error.code, dup.error.field]).toEqual([
      409,
      "DUPLICATE",
      `items[${seed().length}].plu`,
    ]);
    const big = await post("/config/productos/sync", {
      items: Array.from({ length: 2001 }, (_, i) => ({ name: `P${i}`, price: 1, taxRate: 10 })),
    });
    expect([big.status, big.error.code]).toEqual([413, "TOO_LARGE"]);
  });
  it("quitar un producto que está en una mesa abierta → 409 IN_USE; sin mesa, se desactiva", async () => {
    await ensurePeriod(t, sis);
    const o = await post("/orders", { tableId: await freeTable(t, "BARRA"), guests: 1 });
    const l = await post(`/orders/${o.body._id}/lines`, { plu });
    expect(l.status).toBe(201);
    const busy = await post("/config/productos/sync", { items: seed() });
    expect([busy.status, busy.error.code]).toEqual([409, "IN_USE"]);
    expect(busy.error.details.items[0]).toMatchObject({ name: "GRANIZADO PRUEBA", count: 1 });
    await post(`/orders/${o.body._id}/lines/${l.body.accounts[0].lines[0].id}/delete`, {});
    await post(`/orders/${o.body._id}/close`, {});
    const off = await post("/config/productos/sync", { items: seed() });
    expect(off.body).toMatchObject({ deactivated: 1, unchanged: seed().length });
    expect((await t.sql.query("SELECT active FROM product WHERE id=$1", [prodId])).rows[0].active).toBe(
      false,
    );
    const on = await post("/config/productos/sync", { items: [...seed(), nuevo] });
    expect(on.body.items.find((x: any) => x.externalId === "MGR-T-P-1")).toMatchObject({
      id: prodId,
      plu,
      action: "reactivated",
    });
  });
  it("sin permiso → 403", async () => {
    const r = await post("/config/productos/sync", { items: [] }, mesero);
    expect([r.status, r.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
  });
});

describe("POST /config/preguntas/sync", () => {
  const seed = () => original.questions;
  const nueva = {
    externalId: "MGR-T-Q-1",
    name: "SYNC Sabor del granizado",
    minAnswers: 1,
    maxAnswers: 1,
    answers: [{ productExternalId: "MGR-T-P-1" }, { plu: PLU.tosta, label: "Tosta", extraPrice: 1 }],
  };
  let qId: string;

  it("crea la pregunta con sus respuestas en orden; el resto sin cambios", async () => {
    const r = await post("/config/preguntas/sync", { items: [...seed(), nueva] });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body).toMatchObject({ created: 1, unchanged: seed().length, deactivated: 0 });
    qId = r.body.items.find((x: any) => x.externalId === "MGR-T-Q-1").id;
    const a = (
      await t.sql.query(
        "SELECT p.plu, qa.label, qa.extra_price::float8 extra FROM question_answer qa JOIN product p ON p.id=qa.product_id WHERE qa.question_id=$1 ORDER BY qa.sort_order",
        [qId],
      )
    ).rows;
    expect(a.map((x) => x.label)).toEqual([null, "Tosta"]);
    expect(a[1]).toMatchObject({ plu: PLU.tosta, extra: 1 });
  });
  it("respuesta a un producto que no existe → 422 REF_NOT_FOUND; obligatoria sin respuestas → 422 con la fila", async () => {
    const at = seed().length;
    const r = await post("/config/preguntas/sync", {
      items: [...seed(), { ...nueva, answers: [{ productExternalId: "MGR-NO" }] }],
    });
    expect([r.status, r.error.code, r.error.field]).toEqual([
      422,
      "REF_NOT_FOUND",
      `items[${at}].answers[0].productExternalId`,
    ]);
    const empty = await post("/config/preguntas/sync", { items: [...seed(), { ...nueva, answers: [] }] });
    expect([empty.error.code, empty.error.field]).toEqual(["VALIDATION", `items[${at}].answers`]);
    const big = await post("/config/preguntas/sync", {
      items: [{ name: "X", answers: Array.from({ length: 101 }, () => ({ plu: PLU.tosta })) }],
    });
    expect([big.status, big.error.code]).toEqual([413, "TOO_LARGE"]);
  });
  it("una pregunta que hace un producto activo no se quita → 409 IN_USE", async () => {
    const prods = [
      ...original.products,
      { ...(await getCarta()).products.find((p: any) => p.externalId === "MGR-T-P-1") },
    ];
    const withQ = prods.map((p: any) => {
      if (p.externalId === "MGR-T-P-1") {
        return { ...p, questionExternalIds: ["MGR-T-Q-1"] };
      }
      return p;
    });
    const s = await post("/config/productos/sync", { items: withQ });
    expect(s.body.updated).toBe(1);
    expect(
      (
        await t.sql.query(
          "SELECT question_id::text q FROM product_question WHERE product_id=(SELECT id FROM product WHERE external_id='MGR-T-P-1')",
        )
      ).rows,
    ).toEqual([{ q: qId }]);
    const r = await post("/config/preguntas/sync", { items: seed() });
    expect([r.status, r.error.code]).toEqual([409, "IN_USE"]);
  });
  it("sin permiso → 403", async () => {
    const r = await post("/config/preguntas/sync", { items: [] }, mesero);
    expect(r.error.code).toBe("PERMISSION_REQUIRED");
  });
});

describe("POST /config/carta/sync", () => {
  const extra = {
    categories: [{ externalId: "MGR-T-CAT-2", name: "SYNC CARTA POSTRES", orderOnTable: true }],
    products: [
      {
        externalId: "MGR-T-P-2",
        name: "TARTA PRUEBA",
        price: 5.5,
        taxRate: 10,
        categoryExternalId: "MGR-T-CAT-2",
        questionExternalIds: ["MGR-T-Q-2"],
      },
      {
        externalId: "MGR-T-P-3",
        name: "NATA PRUEBA",
        price: 0.5,
        taxRate: 10,
        categoryExternalId: "MGR-T-CAT-2",
        answerOnly: true,
      },
    ],
    questions: [
      {
        externalId: "MGR-T-Q-2",
        name: "SYNC Con nata",
        minAnswers: 0,
        maxAnswers: 1,
        answers: [{ productExternalId: "MGR-T-P-3", extraPrice: 0.5 }],
      },
    ],
  };
  const body = () => ({
    categories: [...original.categories, ...extra.categories],
    products: [...original.products, ...extra.products],
    questions: [...original.questions, ...extra.questions],
  });

  it("carta entera: crea categoría, productos y pregunta que se nombran entre sí; lo de prueba anterior se quita en cascada sin IN_USE", async () => {
    const v0 = await cv();
    const r = await post("/config/carta/sync", body());
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body.categories).toMatchObject({ created: 1, deactivated: 1 }); // SYNC BEBIDAS FRIAS
    expect(r.body.products).toMatchObject({ created: 2, deactivated: 1 }); // GRANIZADO (con su pregunta)
    expect(r.body.questions).toMatchObject({ created: 1, deactivated: 1 });
    expect(r.body.configVersion).toBe(v0 + 1);
    const tarta = r.body.ids["MGR-T-P-2"];
    expect(r.body.ids["MGR-T-CAT-2"]).toBeTruthy();
    const q = (
      await t.sql.query("SELECT question_id::text q FROM product_question WHERE product_id=$1", [tarta])
    ).rows;
    expect(q).toEqual([{ q: r.body.ids["MGR-T-Q-2"] }]);
    const ans = (
      await t.sql.query("SELECT product_id::text p FROM question_answer WHERE question_id=$1", [
        r.body.ids["MGR-T-Q-2"],
      ])
    ).rows;
    expect(ans).toEqual([{ p: r.body.ids["MGR-T-P-3"] }]);
    expect(
      (await t.sql.query("SELECT active FROM product WHERE external_id='MGR-T-P-1'")).rows[0].active,
    ).toBe(false);
  });
  it("la carta de GET /config/carta mandada otra vez: todo sin cambios; canales y agotado se conservan", async () => {
    const tosta = original.products.find((p: any) => p.plu === PLU.tosta);
    await t.sql.query("UPDATE product SET sold_out = true WHERE id=$1", [tosta.id]);
    const ch0 = (await t.sql.query("SELECT count(*) n FROM product_channel WHERE product_id=$1", [tosta.id]))
      .rows[0].n;
    const v0 = await cv();
    const now = await getCarta();
    const r = await post("/config/carta/sync", {
      ...resend(now),
      products: now.products.map((p: any) => ({ ...p, soldOut: false })),
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    for (const k of ["categories", "products", "questions"]) {
      expect(r.body[k], k).toMatchObject({ created: 0, updated: 0, deactivated: 0 });
    }
    expect(r.body.products.unchanged).toBe(now.products.length);
    expect(await cv()).toBe(v0);
    const p = (await t.sql.query("SELECT sold_out FROM product WHERE id=$1", [tosta.id])).rows[0];
    expect(p.sold_out).toBe(true);
    expect(
      (await t.sql.query("SELECT count(*) n FROM product_channel WHERE product_id=$1", [tosta.id])).rows[0].n,
    ).toBe(ch0);
    await t.sql.query("UPDATE product SET sold_out = false WHERE id=$1", [tosta.id]);
  });
  it("todo o nada: una referencia mala al final deja la tienda como estaba (422 REF_NOT_FOUND)", async () => {
    const v0 = await cv();
    const b = body();
    b.categories.push({ externalId: "MGR-T-CAT-3", name: "SYNC NO DEBE QUEDAR", orderOnTable: true });
    // en la carta completa la categoría tiene que venir en la carga: una de la tienda que no viene no vale
    b.products.push({
      ...extra.products[0],
      externalId: "MGR-T-P-4",
      categoryExternalId: "MGR-T-CAT-1",
    } as any);
    const r = await post("/config/carta/sync", b);
    expect([r.status, r.error.code, r.error.field]).toEqual([
      422,
      "REF_NOT_FOUND",
      `products[${b.products.length - 1}].categoryExternalId`,
    ]);
    expect(await cv()).toBe(v0);
    expect(
      (await t.sql.query("SELECT count(*) n FROM category WHERE name='SYNC NO DEBE QUEDAR'")).rows[0].n,
    ).toBe("0");
  });
  it("demasiadas categorías → 413; repetidos → 409 con la fila; sin permiso → 403; misma Idempotency-Key → una carga", async () => {
    const big = await post("/config/carta/sync", {
      categories: Array.from({ length: 501 }, (_, i) => ({ name: `C${i}` })),
      products: [],
      questions: [],
    });
    expect([big.status, big.error.code]).toEqual([413, "TOO_LARGE"]);
    const b = body();
    b.questions.push({ ...extra.questions[0], name: "Otra" });
    const dup = await post("/config/carta/sync", b);
    expect([dup.status, dup.error.code, dup.error.field]).toEqual([
      409,
      "DUPLICATE",
      `questions[${b.questions.length - 1}].externalId`,
    ]);
    expect((await post("/config/carta/sync", body(), mesero)).error.code).toBe("PERMISSION_REQUIRED");
    const bad = await post("/config/carta/sync", { categories: [] });
    expect([bad.status, bad.error.field]).toEqual([422, "products"]);
    const key = crypto.randomUUID();
    const b2 = body();
    b2.products = b2.products.map((p: any) => (p.externalId === "MGR-T-P-2" ? { ...p, price: 6 } : p));
    const v0 = await cv();
    const x = await post("/config/carta/sync", b2, sis, { "idempotency-key": key });
    const y = await post("/config/carta/sync", b2, sis, { "idempotency-key": key });
    expect(x.body.products.updated).toBe(1);
    expect(y.headers["idempotent-replayed"]).toBe("true");
    expect(await cv()).toBe(v0 + 1);
  });
});

describe("GET /config/carta/preview", () => {
  it("tpv: categorías visibles con sus teclas; oot: solo orderOnTable, sin agotados ni modificadores", async () => {
    const tosta = original.products.find((p: any) => p.plu === PLU.tosta);
    const cro = original.products.find((p: any) => p.plu === PLU.croquetas);
    await t.sql.query("UPDATE product SET order_on_table = false WHERE id=$1", [tosta.id]);
    await t.sql.query("UPDATE product SET sold_out = true WHERE id=$1", [cro.id]);
    try {
      const tpv = await t.call("GET", "/config/carta/preview", { token: sis });
      expect(tpv.status).toBe(200);
      expect(tpv.body.mode).toBe("tpv");
      const all = tpv.body.categories.flatMap((c: any) => c.products);
      expect(all.some((p: any) => p.plu === PLU.tosta)).toBe(true);
      expect(all.find((p: any) => p.plu === PLU.croquetas).soldOut).toBe(true);
      expect(all.some((p: any) => p.name === "NATA PRUEBA")).toBe(false); // solo como respuesta
      expect(all.find((p: any) => p.name === "TARTA PRUEBA").questions).toHaveLength(1);
      const oot = await t.call("GET", "/config/carta/preview?mode=oot", { token: sis });
      expect(oot.body.mode).toBe("oot");
      const ootAll = oot.body.categories.flatMap((c: any) => c.products);
      expect(ootAll.some((p: any) => p.plu === PLU.tosta)).toBe(false);
      expect(ootAll.some((p: any) => p.plu === PLU.croquetas)).toBe(false);
      expect(ootAll.length).toBeGreaterThan(0);
      expect(ootAll.every((p: any) => p.orderOnTable && !p.soldOut && p.questions.length === 0)).toBe(true);
      expect(oot.body.categories.every((c: any) => c.orderOnTable)).toBe(true);
    } finally {
      await t.sql.query("UPDATE product SET order_on_table = true, sold_out = false WHERE id = ANY($1)", [
        [tosta.id, cro.id],
      ]);
    }
  });
  it("mode que no existe → 422; sin permiso → 403", async () => {
    expect((await t.call("GET", "/config/carta/preview?mode=x", { token: sis })).status).toBe(422);
    expect((await t.call("GET", "/config/carta/preview", { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
  });
});

describe("Ajustes › orden, agotado, permisos y PWA", () => {
  it("PUT /config/categorias/order: todas las activas en el orden nuevo; si falta una → 422; sin permiso → 403", async () => {
    const ids = (
      await t.sql.query("SELECT id FROM category WHERE active ORDER BY sort_order, name")
    ).rows.map((r) => r.id);
    const v0 = await cv();
    const r = await t.call("PUT", "/config/categorias/order", {
      token: sis,
      body: { ids: [...ids].reverse() },
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body.configVersion).toBe(v0 + 1);
    const now = (await t.sql.query("SELECT id FROM category WHERE active ORDER BY sort_order")).rows.map(
      (x) => x.id,
    );
    expect(now).toEqual([...ids].reverse());
    const bad = await t.call("PUT", "/config/categorias/order", { token: sis, body: { ids: ids.slice(1) } });
    expect([bad.status, bad.error.field]).toEqual([422, "ids"]);
    expect(
      (await t.call("PUT", "/config/categorias/order", { token: mesero, body: { ids } })).error.code,
    ).toBe("PERMISSION_REQUIRED");
  });
  it("PUT /config/areas/order", async () => {
    const r = await t.call("PUT", "/config/areas/order", {
      token: sis,
      body: { ids: [...areaOrder].reverse() },
    });
    expect(r.status).toBe(200);
    const now = (await t.sql.query("SELECT id FROM area WHERE active ORDER BY sort_order")).rows.map(
      (x) => x.id,
    );
    expect(now).toEqual([...areaOrder].reverse());
    expect((await t.call("PUT", "/config/areas/order", { token: sis, body: { ids: ["x"] } })).status).toBe(
      422,
    );
    expect(
      (await t.call("PUT", "/config/areas/order", { token: mesero, body: { ids: areaOrder } })).status,
    ).toBe(403);
  });
  it("POST /config/productos/{id}/sold-out por PLU o UUID; versión, historial; 404, 422, 403 e idempotencia", async () => {
    const tosta = original.products.find((p: any) => p.plu === PLU.tosta);
    const v0 = await cv();
    const key = crypto.randomUUID();
    const a = await post(`/config/productos/${PLU.tosta}/sold-out`, { soldOut: true }, sis, {
      "idempotency-key": key,
    });
    const b = await post(`/config/productos/${PLU.tosta}/sold-out`, { soldOut: true }, sis, {
      "idempotency-key": key,
    });
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    expect(a.body).toEqual({ id: tosta.id, plu: PLU.tosta, soldOut: true, configVersion: v0 + 1 });
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(await cv()).toBe(v0 + 1);
    const log = (
      await t.sql.query(
        "SELECT action, diff FROM config_change_log WHERE record_id=$1 ORDER BY config_version DESC LIMIT 1",
        [tosta.id],
      )
    ).rows[0];
    expect(log.action).toBe("update");
    expect(log.diff).toContain("Agotado");
    const off = await post(`/config/productos/${tosta.id}/sold-out`, { soldOut: false });
    expect(off.body.soldOut).toBe(false);
    expect((await post("/config/productos/999999/sold-out", { soldOut: true })).status).toBe(404);
    expect((await post(`/config/productos/${PLU.tosta}/sold-out`, { soldOut: "si" })).status).toBe(422);
    expect((await post(`/config/productos/${PLU.tosta}/sold-out`, { soldOut: true }, mesero)).status).toBe(
      403,
    );
  });
  it("GET /config/permisos en el orden de la tabla; sin permiso → 403", async () => {
    const r = await t.call("GET", "/config/permisos", { token: sis });
    expect(r.status).toBe(200);
    const n = Number((await t.sql.query("SELECT count(*) n FROM permission")).rows[0].n);
    expect(r.body.items).toHaveLength(n);
    const orders = r.body.items.map((x: any) => x.sortOrder);
    expect(orders).toEqual([...orders].sort((x, y) => x - y));
    expect(r.body.items.some((x: any) => x.code === "mesas.orderOnTable")).toBe(true);
    expect((await t.call("GET", "/config/permisos", { token: mesero })).status).toBe(403);
  });
  it("GET /config/restaurante/pwa: manifest con el código del local; sin permiso → 403", async () => {
    const r = await t.call("GET", "/config/restaurante/pwa", { token: sis });
    expect(r.status).toBe(200);
    expect(r.body.storeCode).toBe("CT 03");
    expect(r.body.manifest).toMatchObject({
      name: "Japp PDA · CT 03",
      display: "standalone",
      start_url: "/",
    });
    expect(JSON.stringify(r.body)).not.toMatch(/token|pin/i);
    expect((await t.call("GET", "/config/restaurante/pwa", { token: mesero })).status).toBe(403);
  });
  it("las rutas genéricas siguen funcionando junto a las concretas", async () => {
    expect((await t.call("GET", "/config/restaurante/current", { token: sis })).status).toBe(200);
    expect((await t.call("GET", `/config/productos/${PLU.tosta}`, { token: sis })).status).toBe(200);
    expect((await t.call("GET", "/config/categorias", { token: sis })).status).toBe(200);
  });
});

describe("PUT /config/areas/{areaId}/layout", () => {
  it("mueve mesas y sustituye dibujos con la versión del área; VERSION_CONFLICT, 422, 404 y 403", async () => {
    const area = (await t.sql.query("SELECT id::text, version FROM area WHERE name='TERRAZA'")).rows[0];
    const tables = (
      await t.sql.query(
        "SELECT id::text, pos_x::float8 x, pos_y::float8 y, width, height FROM dining_table WHERE area_id=$1 AND active ORDER BY number LIMIT 2",
        [area.id],
      )
    ).rows;
    const v0 = await cv();
    const body = {
      tables: [{ id: tables[0].id, x: 18, y: 30, width: 120, height: 90 }],
      drawings: [
        { kind: "wall", x1: 10, y1: 80, x2: 60, y2: 80 },
        { kind: "text", x1: 5, y1: 5, label: "Entrada" },
      ],
      version: area.version,
    };
    const r = await t.call("PUT", `/config/areas/${area.id}/layout`, { token: sis, body });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body).toEqual({ version: area.version + 1, configVersion: v0 + 1 });
    const tb = (
      await t.sql.query("SELECT pos_x::float8 x, pos_y::float8 y, width FROM dining_table WHERE id=$1", [
        tables[0].id,
      ])
    ).rows[0];
    expect(tb).toEqual({ x: 18, y: 30, width: 120 });
    const d = (
      await t.sql.query("SELECT kind, label FROM area_drawing WHERE area_id=$1 ORDER BY sort_order", [
        area.id,
      ])
    ).rows;
    expect(d).toEqual([
      { kind: "wall", label: null },
      { kind: "text", label: "Entrada" },
    ]);
    const old = await t.call("PUT", `/config/areas/${area.id}/layout`, { token: sis, body });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    const other = (
      await t.sql.query(
        "SELECT dt.id::text FROM dining_table dt JOIN area a ON a.id=dt.area_id WHERE a.name='BARRA' LIMIT 1",
      )
    ).rows[0].id;
    const bad = await t.call("PUT", `/config/areas/${area.id}/layout`, {
      token: sis,
      body: { ...body, version: area.version + 1, tables: [{ id: other, x: 1, y: 1 }] },
    });
    expect([bad.status, bad.error.field]).toEqual([422, "tables[0].id"]);
    const kind = await t.call("PUT", `/config/areas/${area.id}/layout`, {
      token: sis,
      body: { ...body, version: area.version + 1, drawings: [{ kind: "ventana", x1: 1, y1: 1 }] },
    });
    expect(kind.status).toBe(422);
    expect(
      (await t.call("PUT", `/config/areas/${crypto.randomUUID()}/layout`, { token: sis, body })).status,
    ).toBe(404);
    expect((await t.call("PUT", `/config/areas/${area.id}/layout`, { token: mesero, body })).status).toBe(
      403,
    );
    // vuelve a dejarlo como estaba
    const back = await t.call("PUT", `/config/areas/${area.id}/layout`, {
      token: sis,
      body: {
        tables: [
          {
            id: tables[0].id,
            x: tables[0].x ?? 0,
            y: tables[0].y ?? 0,
            width: tables[0].width,
            height: tables[0].height,
          },
        ],
        drawings: [],
        version: area.version + 1,
      },
    });
    expect(back.status).toBe(200);
  });
});

describe("Ajustes · campos nuevos (externalId, orderOnTable, description, webOrderUrl)", () => {
  it("se ven y se cambian en los módulos y salen en GET /config", async () => {
    const cat = (await t.call("GET", "/config/categorias?limit=500", { token: sis })).body.items[0];
    expect(cat).toHaveProperty("externalId");
    expect(cat.orderOnTable).toBe(true);
    const p = await t.call("PATCH", `/config/categorias/${cat.id}`, {
      token: sis,
      body: { orderOnTable: false, version: cat.version },
    });
    expect(p.status, JSON.stringify(p.error)).toBe(200);
    expect(p.body.item.orderOnTable).toBe(false);
    await t.call("PATCH", `/config/categorias/${cat.id}`, {
      token: sis,
      body: { orderOnTable: true, version: cat.version + 1 },
    });
    const prod = await t.call("PATCH", `/config/productos/${PLU.tosta}`, {
      token: sis,
      body: {
        description: "Con tomate",
        version: (await t.call("GET", `/config/productos/${PLU.tosta}`, { token: sis })).body.version,
      },
    });
    expect(prod.body.item).toMatchObject({ description: "Con tomate", orderOnTable: true, externalId: null });
    const q = (await t.call("GET", "/config/preguntas", { token: sis })).body.items[0];
    expect(q).toHaveProperty("externalId");
    const rest = (await t.call("GET", "/config/restaurante/current", { token: sis })).body;
    const r = await t.call("PATCH", "/config/restaurante/current", {
      token: sis,
      body: { webOrderUrl: "https://pedir.example.com", version: rest.version },
    });
    expect(r.body.item.webOrderUrl).toBe("https://pedir.example.com");
    const bundle = (await t.call("GET", "/config", { token: mesero })).body;
    expect(bundle.restaurant.webOrderUrl).toBe("https://pedir.example.com");
    expect(bundle.catalog.categories[0]).toHaveProperty("orderOnTable");
    expect(bundle.catalog.products.find((x: any) => x.plu === PLU.tosta).description).toBe("Con tomate");
    expect(bundle.catalog.questions[0]).toHaveProperty("externalId");
    await t.call("PATCH", "/config/restaurante/current", {
      token: sis,
      body: { webOrderUrl: null, version: rest.version + 1 },
    });
    await t.sql.query("UPDATE product SET description = NULL WHERE plu = $1", [PLU.tosta]);
  });
});
