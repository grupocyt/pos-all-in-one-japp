import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** Order on Table: QR de la mesa (TPV/PDA) y lo que llama el sistema de pedidos del cliente (/oot/*). */
const KEY = "clave-oot-de-prueba-0123456789abcdef";
const BASE = "https://pedir.example.com/";
const BACARDI = 2018; // pregunta obligatoria (respuestas 5272, 5275)

let t: T;
let sistemas: string;
let mesero: string;
let storeId: string;
beforeAll(async () => {
  t = await setup({ ootIntegrationKey: KEY });
  sistemas = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sistemas);
  const { rows } = await t.sql.query(
    "UPDATE store SET web_order_url = $1 WHERE code = 'CT 03' RETURNING id",
    [BASE],
  );
  storeId = rows[0].id;
});
afterAll(async () => {
  await t.sql.query("UPDATE store SET web_order_url = NULL WHERE id = $1", [storeId]);
  await t.close();
});

const newOrder = async (area: "BARRA" | "TERRAZA" = "BARRA") => {
  const o = await t.call("POST", "/orders", {
    token: mesero,
    body: { tableId: await freeTable(t, area), guests: 2 },
  });
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  return { id: o.body._id as string, acc: o.body.accounts[0].id as string };
};
const qr = (orderId: string, body: object = {}, token = sistemas, headers = {}) =>
  t.call("POST", `/orders/${orderId}/oot`, { token, body, headers });
const ext = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  t.call(method, url, { body, headers: { "x-integration-key": KEY, ...headers } });
const tokens = async (orderId: string) =>
  (
    await t.sql.query(
      "SELECT token, revoked_at, revoked_reason FROM oot_token WHERE order_id = $1 ORDER BY created_at",
      [orderId],
    )
  ).rows;

describe("Order on Table · QR de la mesa", () => {
  it("genera el token (201), lo reutiliza si ya hay uno vigente e imprime el QR en la impresora de tickets", async () => {
    const o = await newOrder();
    const before = t.printer.jobs.length;
    const r = await qr(o.id, { print: true });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body.token).toMatch(/^oot_[A-Za-z0-9_-]{32}$/);
    expect(r.body).toMatchObject({
      url: `https://pedir.example.com/t/${r.body.token}`,
      reused: false,
      printed: true,
    });
    const job = t.printer.jobs.at(-1)!;
    expect(t.printer.jobs.length).toBe(before + 1);
    expect(job.kind).toBe("oot");
    expect(job.ticket).toContainEqual({ k: "qr", data: r.body.url });
    expect(job.text).toContain("PIDE DESDE TU MÓVIL");

    const again = await qr(o.id, {});
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({
      token: r.body.token,
      reused: true,
      printed: false,
      createdAt: r.body.createdAt,
    });
    const rows = await tokens(o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: r.body.token, revoked_at: null });
  });

  it("misma Idempotency-Key → la misma respuesta y un solo token", async () => {
    const o = await newOrder();
    const k = crypto.randomUUID();
    const a = await qr(o.id, {}, sistemas, { "idempotency-key": k });
    const b = await qr(o.id, {}, sistemas, { "idempotency-key": k });
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.body).toEqual(a.body);
    expect(await tokens(o.id)).toHaveLength(1);
  });

  it("sin permiso mesas.orderOnTable → 403 PERMISSION_REQUIRED (generar y anular)", async () => {
    const o = await newOrder();
    const r = await qr(o.id, {}, mesero);
    expect([r.status, r.error.code, r.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "mesas.orderOnTable",
    ]);
    const d = await t.call("DELETE", `/orders/${o.id}/oot`, { token: mesero });
    expect([d.status, d.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    expect(await tokens(o.id)).toHaveLength(0);
  });

  it("cuerpo u orden no válidos → 422 VALIDATION; orden de otra tienda o inexistente → 404", async () => {
    const o = await newOrder();
    const bad = await qr(o.id, { print: "sí" });
    expect([bad.status, bad.error.code]).toEqual([422, "VALIDATION"]);
    const badId = await qr("no-es-un-uuid", {});
    expect([badId.status, badId.error.code]).toEqual([422, "VALIDATION"]);
    const none = await qr(crypto.randomUUID(), {});
    expect([none.status, none.error.code]).toEqual([404, "NOT_FOUND"]);
  });

  it("sin URL de Order on Table en Ajustes › Restaurante → 409 OOT_NOT_CONFIGURED y no se crea nada", async () => {
    const o = await newOrder();
    await t.sql.query("UPDATE store SET web_order_url = NULL WHERE id = $1", [storeId]);
    try {
      const r = await qr(o.id, {});
      expect([r.status, r.error.code]).toEqual([409, "OOT_NOT_CONFIGURED"]);
      expect(await tokens(o.id)).toHaveLength(0);
    } finally {
      await t.sql.query("UPDATE store SET web_order_url = $1 WHERE id = $2", [BASE, storeId]);
    }
  });

  it("anular: el QR deja de valer (404 para el cliente) y el siguiente es otro token", async () => {
    const o = await newOrder();
    const r = await qr(o.id, {});
    const d = await t.call("DELETE", `/orders/${o.id}/oot`, { token: sistemas });
    expect([d.status, d.body]).toEqual([200, null]);
    expect((await tokens(o.id))[0]).toMatchObject({ revoked_reason: "manual" });
    const g = await ext("GET", `/oot/${r.body.token}`);
    expect([g.status, g.error.code]).toEqual([404, "OOT_TOKEN_INVALID"]);
    // sin token vigente no hace nada
    expect((await t.call("DELETE", `/orders/${o.id}/oot`, { token: sistemas })).status).toBe(200);
    const n = await qr(o.id, {});
    expect(n.body.reused).toBe(false);
    expect(n.body.token).not.toBe(r.body.token);
  });

  it("al facturar la última cuenta la mesa se cierra y el token caduca (revoked 'closed')", async () => {
    const o = await newOrder();
    const r = await qr(o.id, {});
    await t.call("POST", `/orders/${o.id}/lines`, { token: mesero, body: { plu: PLU.tosta } });
    await t.call("POST", `/orders/${o.id}/send`, { token: mesero, body: {} });
    const p = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, {
      token: sistemas,
      body: { method: "card", amount: null },
    });
    expect(p.status, JSON.stringify(p.env)).toBe(201);
    const inv = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/invoice`, { token: sistemas });
    expect(inv.body.tableClosed).toBe(true);
    expect((await tokens(o.id))[0]).toMatchObject({ revoked_reason: "closed" });
    expect((await tokens(o.id))[0].revoked_at).not.toBeNull();
    const g = await ext("GET", `/oot/${r.body.token}`);
    expect([g.status, g.error.code]).toEqual([404, "OOT_TOKEN_INVALID"]);
    const l = await ext("POST", `/oot/${r.body.token}/lines`, { items: [{ plu: PLU.croquetas }] });
    expect([l.status, l.error.code]).toEqual([404, "OOT_TOKEN_INVALID"]);
  });

  it("cerrar sin venta también caduca el token", async () => {
    const o = await newOrder();
    await qr(o.id, {});
    const c = await t.call("POST", `/orders/${o.id}/close`, { token: mesero, body: {} });
    expect(c.status, JSON.stringify(c.env)).toBe(200);
    expect((await tokens(o.id))[0]).toMatchObject({ revoked_reason: "closed" });
  });
});

describe("Order on Table · sistema externo", () => {
  it("sin clave de integración, o con otra → 403 NOT_ALLOWED (antes de mirar el cuerpo)", async () => {
    const o = await newOrder();
    const { body } = await qr(o.id, {});
    const none = await t.call("GET", `/oot/${body.token}`);
    expect([none.status, none.error.code]).toEqual([403, "NOT_ALLOWED"]);
    const wrong = await t.call("GET", `/oot/${body.token}`, { headers: { "x-integration-key": KEY + "x" } });
    expect([wrong.status, wrong.error.code]).toEqual([403, "NOT_ALLOWED"]);
    const post = await t.call("POST", `/oot/${body.token}/lines`, {
      body: { nada: true },
      headers: { "x-integration-key": "otra" },
    });
    expect([post.status, post.error.code]).toEqual([403, "NOT_ALLOWED"]);
    // una sesión de camarero no sustituye a la clave
    const ses = await t.call("GET", `/oot/${body.token}`, { token: sistemas });
    expect(ses.status).toBe(403);
  });

  it("sin OOT_INTEGRATION_KEY configurada /oot/* queda cerrado", async () => {
    const t2 = await setup();
    try {
      const r = await t2.call("GET", "/oot/oot_cualquiera1234567890", {
        headers: { "x-integration-key": "" },
      });
      expect([r.status, r.error.code]).toEqual([403, "NOT_ALLOWED"]);
    } finally {
      await t2.close();
    }
  });

  it("token que no existe o mal formado → 404 OOT_TOKEN_INVALID", async () => {
    const a = await ext("GET", "/oot/oot_noexiste000000000000000000");
    expect([a.status, a.error.code]).toEqual([404, "OOT_TOKEN_INVALID"]);
    const b = await ext("GET", "/oot/cualquier-cosa");
    expect([b.status, b.error.code]).toEqual([404, "OOT_TOKEN_INVALID"]);
  });

  it("carta oot: solo productos y categorías con orderOnTable, sin agotados ni «solo respuesta», PVP del área y preguntas", async () => {
    const o = await newOrder("TERRAZA");
    const { body } = await qr(o.id, {});
    const cat = (await t.sql.query("SELECT category_id FROM product WHERE plu = $1", [PLU.kaspirinha]))
      .rows[0].category_id;
    await t.sql.query("UPDATE product SET price_terrace = 6.40 WHERE plu = $1", [PLU.croquetas]);
    await t.sql.query("UPDATE product SET order_on_table = false WHERE plu = $1", [PLU.tosta]);
    await t.sql.query("UPDATE category SET order_on_table = false WHERE id = $1", [cat]);
    await t.sql.query("UPDATE product SET sold_out = true WHERE plu = 5272");
    try {
      const r = await ext("GET", `/oot/${body.token}`);
      expect(r.status, JSON.stringify(r.env)).toBe(200);
      expect(r.body).toMatchObject({
        store: { code: "CT 03" },
        area: "TERRAZA",
        orderId: o.id,
        open: true,
      });
      const products = r.body.menu.categories.flatMap((c: any) => c.products);
      const plus = products.map((p: any) => p.plu);
      expect(plus).toContain(PLU.croquetas);
      expect(plus).not.toContain(PLU.tosta); // producto sin orderOnTable
      expect(plus).not.toContain(PLU.kaspirinha); // categoría sin orderOnTable
      expect(plus).not.toContain(PLU.redbull); // solo como respuesta
      expect(plus).not.toContain(5272); // agotado
      expect(products.find((p: any) => p.plu === PLU.croquetas).price).toBe(6.4); // terraza
      const bac = products.find((p: any) => p.plu === BACARDI);
      expect(bac.questions[0]).toMatchObject({ minAnswers: 1 });
      expect(bac.questions[0].answers.map((a: any) => a.plu)).toContain(5275);
      // ninguna categoría vacía ni repetida
      const names = r.body.menu.categories.map((c: any) => c.name);
      expect(new Set(names).size).toBe(names.length);
      expect(r.body.menu.categories.every((c: any) => c.products.length > 0)).toBe(true);
    } finally {
      await t.sql.query("UPDATE product SET price_terrace = NULL WHERE plu = $1", [PLU.croquetas]);
      await t.sql.query("UPDATE product SET order_on_table = true WHERE plu = $1", [PLU.tosta]);
      await t.sql.query("UPDATE category SET order_on_table = true WHERE id = $1", [cat]);
      await t.sql.query("UPDATE product SET sold_out = false WHERE plu = 5272");
    }
  });

  it("pedido del cliente: entra en la cuenta «Order on Table», se envía solo y sale por cocina (aunque haya un camarero en la mesa)", async () => {
    const o = await newOrder();
    const { body } = await qr(o.id, {});
    // el camarero está dentro de la mesa: el cliente pide igual
    expect(
      (await t.call("POST", `/orders/${o.id}/presence`, { token: mesero, body: { action: "enter" } })).status,
    ).toBe(200);
    const jobs = t.printer.jobs.length;
    const r = await ext("POST", `/oot/${body.token}/lines`, {
      items: [
        { plu: PLU.croquetas, quantity: 2, comment: "sin sal" },
        { plu: BACARDI, quantity: 1, modifiers: [{ plu: 5272 }] },
      ],
    });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body.accepted).toBe(3);
    expect(r.body.printed.length).toBeGreaterThan(0);
    expect(r.body.printed.every((p: any) => p.ok)).toBe(true);
    const kitchen = t.printer.jobs.slice(jobs);
    expect(kitchen.every((j) => j.kind === "kitchen")).toBe(true);
    expect(kitchen.map((j) => j.text).join("\n")).toMatch(/CROQUETAS DE BOLETUS/);

    const acc = (
      await t.sql.query(
        "SELECT id, name, status, opened_by_role, opened_by_user_name FROM account WHERE order_id = $1 AND name = 'Order on Table'",
        [o.id],
      )
    ).rows;
    expect(acc).toHaveLength(1);
    expect(acc[0]).toMatchObject({ id: r.body.accountId, status: "open", opened_by_role: "customer" });
    const lines = (
      await t.sql.query(
        "SELECT plu, quantity, status, printed, comment, created_by_role, created_by_user_name, created_by_device, created_by_user_id FROM order_line WHERE account_id = $1 ORDER BY plu",
        [r.body.accountId],
      )
    ).rows;
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatchObject({
        status: "printed",
        printed: true,
        created_by_role: "customer",
        created_by_user_name: "Order on Table",
        created_by_device: "OOT",
        created_by_user_id: null,
      });
    }
    expect(lines.find((l: any) => l.plu === PLU.croquetas)).toMatchObject({
      quantity: "2.000",
      comment: "sin sal",
    });
    const lp = await t.sql.query(
      "SELECT count(*)::int n FROM order_line_printer olp JOIN order_line ol ON ol.id = olp.line_id WHERE ol.account_id = $1 AND olp.printed",
      [r.body.accountId],
    );
    expect(lp.rows[0].n).toBeGreaterThan(0);
    const g = await t.call("GET", `/orders/${o.id}`, { token: mesero });
    expect(g.body.version).toBe(r.body.version);
    expect(g.body.events.some((e: any) => e.role === "customer" && e.type === "linePrinted")).toBe(true);
    const outbox = await t.sql.query(
      "SELECT count(*)::int n FROM sync_outbox WHERE entity = 'order' AND entity_id = $1 AND (payload->>'version')::int = $2",
      [o.id, r.body.version],
    );
    expect(outbox.rows[0].n).toBe(1);

    // un segundo pedido va a la misma cuenta (no se crea otra) y no salta DUPLICATE_SUSPECTED
    const r2 = await ext("POST", `/oot/${body.token}/lines`, { items: [{ plu: PLU.croquetas }] });
    expect(r2.status, JSON.stringify(r2.env)).toBe(201);
    expect(r2.body.accountId).toBe(r.body.accountId);
    expect(r2.body.version).toBe(r.body.version + 1);
  });

  it("impresora caída: el pedido queda guardado y printed lo dice (sin 503)", async () => {
    const o = await newOrder();
    const { body } = await qr(o.id, {});
    const orig = t.printer.print.bind(t.printer);
    t.printer.print = async () => ({ ok: false, error: "apagada" });
    try {
      const r = await ext("POST", `/oot/${body.token}/lines`, { items: [{ plu: PLU.croquetas }] });
      expect(r.status, JSON.stringify(r.env)).toBe(201);
      expect(r.body.printed.some((p: any) => !p.ok)).toBe(true);
    } finally {
      t.printer.print = orig;
    }
    const pend = await t.sql.query(
      "SELECT count(*)::int n FROM order_line_printer olp JOIN order_line ol ON ol.id = olp.line_id WHERE ol.order_id = $1 AND NOT olp.printed",
      [o.id],
    );
    expect(pend.rows[0].n).toBeGreaterThan(0);
  });

  it("producto fuera de Order on Table → 422 PRODUCT_NOT_OOT con field items[n].plu y no entra nada", async () => {
    const o = await newOrder();
    const { body } = await qr(o.id, {});
    await t.sql.query("UPDATE product SET order_on_table = false WHERE plu = $1", [PLU.tosta]);
    try {
      const r = await ext("POST", `/oot/${body.token}/lines`, {
        items: [{ plu: PLU.croquetas }, { plu: PLU.tosta }],
      });
      expect([r.status, r.error.code, r.error.field]).toEqual([422, "PRODUCT_NOT_OOT", "items[1].plu"]);
      const none = await ext("POST", `/oot/${body.token}/lines`, { items: [{ plu: 999999 }] });
      expect([none.status, none.error.code, none.error.field]).toEqual([
        422,
        "PRODUCT_NOT_OOT",
        "items[0].plu",
      ]);
      const lines = await t.sql.query("SELECT count(*)::int n FROM order_line WHERE order_id = $1", [o.id]);
      expect(lines.rows[0].n).toBe(0);
    } finally {
      await t.sql.query("UPDATE product SET order_on_table = true WHERE plu = $1", [PLU.tosta]);
    }
  });

  it("pregunta obligatoria sin responder → 422 VALIDATION; cuerpo mal → 422 VALIDATION", async () => {
    const o = await newOrder();
    const { body } = await qr(o.id, {});
    const r = await ext("POST", `/oot/${body.token}/lines`, { items: [{ plu: BACARDI }] });
    expect([r.status, r.error.code]).toEqual([422, "VALIDATION"]);
    const empty = await ext("POST", `/oot/${body.token}/lines`, { items: [] });
    expect([empty.status, empty.error.code]).toEqual([422, "VALIDATION"]);
    const qty = await ext("POST", `/oot/${body.token}/lines`, {
      items: [{ plu: PLU.croquetas, quantity: 0 }],
    });
    expect([qty.status, qty.error.code]).toEqual([422, "VALIDATION"]);
  });

  it("mismo requestId (o Idempotency-Key) → la misma respuesta sin repetir el pedido", async () => {
    const o = await newOrder();
    const { body } = await qr(o.id, {});
    const req = { items: [{ plu: PLU.croquetas, quantity: 2 }], requestId: "pedido-123" };
    const a = await ext("POST", `/oot/${body.token}/lines`, req);
    const jobs = t.printer.jobs.length;
    const b = await ext("POST", `/oot/${body.token}/lines`, req);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body).toEqual(a.body);
    expect(t.printer.jobs.length).toBe(jobs); // no se vuelve a imprimir
    const n = async () =>
      (await t.sql.query("SELECT count(*)::int n FROM order_line WHERE order_id = $1", [o.id])).rows[0].n;
    expect(await n()).toBe(1);
    expect(
      (await t.sql.query("SELECT quantity FROM order_line WHERE order_id = $1", [o.id])).rows[0].quantity,
    ).toBe("2.000");
    // sin requestId, con Idempotency-Key
    const k = crypto.randomUUID();
    const c = await ext(
      "POST",
      `/oot/${body.token}/lines`,
      { items: [{ plu: PLU.tosta }] },
      { "idempotency-key": k },
    );
    const d = await ext(
      "POST",
      `/oot/${body.token}/lines`,
      { items: [{ plu: PLU.tosta }] },
      { "idempotency-key": k },
    );
    expect(d.body).toEqual(c.body);
    expect(await n()).toBe(2);
    // dos a la vez con el mismo requestId: la orden bloqueada los pone en fila y solo entra uno
    const same = { items: [{ plu: PLU.tosta }], requestId: 77 };
    const [x, y] = await Promise.all([
      ext("POST", `/oot/${body.token}/lines`, same),
      ext("POST", `/oot/${body.token}/lines`, same),
    ]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(await n()).toBe(3);
  });
});
