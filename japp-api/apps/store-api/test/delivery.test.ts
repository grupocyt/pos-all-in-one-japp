import { setup, PIN, type T } from "./helpers.js";

let t: T;
let admin: string;
let mesero: string;
let barra: string; // 0030 (04/11): el tablero de delivery es de cajero y encargado
const KEY = "clave-tienda-pruebas-delivery";

const pedido = (over: Record<string, unknown> = {}) => ({
  platform: "glovo",
  code: "GLV-4821",
  externalId: `glv_${crypto.randomUUID().slice(0, 8)}`,
  customer: { name: "Marta R.", phone: "612 345 678" },
  address: "C/ Mayor 12, 3.º B",
  paymentNote: "Pagado online",
  note: "Sin cebolla",
  lines: [
    { plu: 1813, name: "Tosta", quantity: 2, unitPrice: 5.5 },
    { name: "Huevos rotos con jamón", quantity: 1, unitPrice: 11.9 },
  ],
  ...over,
});

beforeAll(async () => {
  t = await setup({ storeKey: KEY });
  admin = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  barra = await t.login(PIN.barra);
});
afterAll(async () => {
  await t.close();
});

describe("Ajustes › Pedidos y Motorizados (módulos pedidos y motorizados)", () => {
  it("pedidos: un registro «current» con los valores por defecto; rojo después del ámbar", async () => {
    const g = await t.call("GET", "/config/pedidos/current", { token: admin });
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ active: true, askRider: true, amberMinutes: 15, redMinutes: 30 });
    expect(g.body.platforms.map((p: any) => p.id)).toEqual(["glovo", "uber", "just", "own"]);
    const bad = await t.call("PATCH", "/config/pedidos/current", {
      token: admin,
      body: { amberMinutes: 30, redMinutes: 20, version: g.body.version },
    });
    expect([bad.status, bad.error.field]).toEqual([422, "redMinutes"]);
    const ok = await t.call("PATCH", "/config/pedidos/current", {
      token: admin,
      body: {
        platforms: [...g.body.platforms.slice(0, 3), { id: "own", name: "Web propia", active: false }],
        version: g.body.version,
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.item.platforms[3].active).toBe(false);
    const cfg = await t.call("GET", "/config", { token: admin });
    expect(cfg.body.delivery.settings.active).toBe(true);
    expect(cfg.body.system).toMatchObject({ name: expect.any(String), version: expect.any(Number) });
  });

  it("motorizados: alta, sin repetir nombre (mayúsculas/espacios), quitar = desactivar; el mesero no entra", async () => {
    const a = await t.call("POST", "/config/motorizados", {
      token: admin,
      body: { name: "Carlos M.", phone: "600111222" },
    });
    expect(a.status).toBe(201);
    const dup = await t.call("POST", "/config/motorizados", { token: admin, body: { name: "  carlos m. " } });
    expect([dup.status, dup.error.code, dup.error.details.field ?? dup.error.field]).toEqual([
      409,
      "DUPLICATE",
      "name",
    ]);
    const b = await t.call("POST", "/config/motorizados", { token: admin, body: { name: "Lucía" } });
    const off = await t.call("POST", `/config/motorizados/${b.body.id}/deactivate`, {
      token: admin,
      body: {},
    });
    expect(off.body.active).toBe(false);
    const list = await t.call("GET", "/config/motorizados", { token: admin });
    expect(list.body.items.map((x: any) => x.name)).toEqual(["Carlos M."]);
    const m = await t.call("GET", "/config/motorizados", { token: mesero });
    expect([m.status, m.error.details.permission]).toEqual([403, "ajustes.pedidos"]);
  });
});

describe("Tablero de pedidos (delivery)", () => {
  let id: string;
  let version: number;
  it("el integrador lo manda con la clave de la tienda: total calculado en la API, pasos y semáforo", async () => {
    const r = await t.call("POST", "/delivery/orders", {
      headers: { authorization: `Bearer ${KEY}` },
      body: pedido({ externalId: "glv_8f2a91" }),
    });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body).toMatchObject({
      status: "pending",
      total: 22.9,
      light: "green",
      riderName: null,
      customer: { name: "Marta R." },
    });
    expect(r.body.lines[0]).toMatchObject({ plu: 1813, quantity: 2, amount: 11 });
    expect(r.body.lines[0].productId).toBeTruthy();
    expect(r.body.lines[1]).toMatchObject({ plu: null, productId: null });
    expect(r.body.events).toEqual([expect.objectContaining({ status: "pending", by: "Integración" })]);
    id = r.body.id;
    version = r.body.version;
    // el mismo externalId no se duplica: 200 con el que había
    const again = await t.call("POST", "/delivery/orders", {
      headers: { authorization: `Bearer ${KEY}` },
      body: pedido({ externalId: "glv_8f2a91" }),
    });
    expect([again.status, again.body.id]).toEqual([200, id]);
    // otra clave → sesión no válida
    const bad = await t.call("POST", "/delivery/orders", {
      headers: { authorization: "Bearer otra" },
      body: pedido(),
    });
    expect(bad.status).toBe(401);
  });

  it("validaciones: plataforma apagada, sin productos, más de 100 productos", async () => {
    const off = await t.call("POST", "/delivery/orders", { token: admin, body: pedido({ platform: "own" }) });
    expect([off.status, off.error.field ?? off.error.details.field]).toEqual([422, "platform"]);
    const empty = await t.call("POST", "/delivery/orders", { token: admin, body: pedido({ lines: [] }) });
    expect(empty.status).toBe(422);
    const big = await t.call("POST", "/delivery/orders", {
      token: admin,
      body: pedido({
        lines: Array.from({ length: 101 }, () => ({ name: "Caña", quantity: 1, unitPrice: 2 })),
      }),
    });
    expect([big.status, big.error.code]).toEqual([413, "TOO_LARGE"]);
  });

  it("siguiente paso hasta asignar: con askRider pide quién lo lleva; con versión vieja → 409", async () => {
    const a = await t.call("POST", `/delivery/orders/${id}/advance`, { token: barra, body: { version } });
    expect(a.body.status).toBe("received");
    const old = await t.call("POST", `/delivery/orders/${id}/advance`, { token: barra, body: { version } });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    expect(old.error.details.current.status).toBe("received");
    const b = await t.call("POST", `/delivery/orders/${id}/advance`, {
      token: barra,
      body: { version: a.body.version },
    });
    expect(b.body.status).toBe("to_assign");
    const nr = await t.call("POST", `/delivery/orders/${id}/advance`, {
      token: barra,
      body: { version: b.body.version },
    });
    expect([nr.status, nr.error.code]).toEqual([422, "RIDER_REQUIRED"]);
    const ghost = await t.call("POST", `/delivery/orders/${id}/advance`, {
      token: barra,
      body: { version: b.body.version, riderId: crypto.randomUUID() },
    });
    expect([ghost.status, ghost.error.code]).toEqual([404, "NOT_FOUND"]);
    const rider = (await t.call("GET", "/config/motorizados", { token: admin })).body.items[0];
    const c = await t.call("POST", `/delivery/orders/${id}/advance`, {
      token: barra,
      body: { version: b.body.version, riderId: rider.id },
    });
    expect(c.body).toMatchObject({ status: "assigned", riderId: rider.id, riderName: "Carlos M." });
    const d = await t.call("POST", `/delivery/orders/${id}/advance`, {
      token: barra,
      body: { version: c.body.version },
    });
    const e = await t.call("POST", `/delivery/orders/${id}/advance`, {
      token: barra,
      body: { version: d.body.version },
    });
    expect(e.body).toMatchObject({ status: "delivered", light: null });
    expect(e.body.finishedAt).toBeTruthy();
    expect(e.body.events.map((x: any) => x.status)).toEqual([
      "pending",
      "received",
      "to_assign",
      "assigned",
      "on_route",
      "delivered",
    ]);
    const done = await t.call("POST", `/delivery/orders/${id}/advance`, {
      token: barra,
      body: { version: e.body.version },
    });
    expect([done.status, done.error.code]).toEqual([409, "INVALID_TRANSITION"]);
  });

  it("autoAccept entra como received; sin askRider queda «Repartidor de la plataforma»", async () => {
    const s = (await t.call("GET", "/config/pedidos/current", { token: admin })).body;
    await t.call("PATCH", "/config/pedidos/current", {
      token: admin,
      body: { autoAccept: true, askRider: false, version: s.version },
    });
    const r = await t.call("POST", "/delivery/orders", { token: admin, body: pedido({ platform: "uber" }) });
    expect(r.body.status).toBe("received");
    expect(r.body.events.map((x: any) => [x.status, x.by])).toEqual([
      ["pending", "Sistemas"],
      ["received", "Automático"],
    ]);
    const a = await t.call("POST", `/delivery/orders/${r.body.id}/advance`, {
      token: admin,
      body: { version: r.body.version },
    });
    const b = await t.call("POST", `/delivery/orders/${r.body.id}/advance`, {
      token: admin,
      body: { version: a.body.version },
    });
    expect(b.body).toMatchObject({
      status: "assigned",
      riderId: null,
      riderName: "Repartidor de la plataforma",
    });
  });

  it("cancelar pide clave de encargado; queda el motivo; tablero con pendientes, terminados y semáforo", async () => {
    const r = await t.call("POST", "/delivery/orders", { token: admin, body: pedido({ platform: "just" }) });
    const no = await t.call("POST", `/delivery/orders/${r.body.id}/cancel`, {
      token: barra,
      body: { version: r.body.version, note: "No contesta" },
    });
    expect([no.status, no.error.details.permission]).toEqual([403, "sistema.autorizar"]);
    // el reloj avanza: el pedido de Just Eat pasa a rojo
    t.clock.now = new Date(Date.now() + 31 * 60_000);
    const board = await t.call("GET", "/delivery/orders", { token: barra });
    expect(board.status).toBe(200);
    const it = board.body.items.find((x: any) => x.id === r.body.id);
    expect(it).toMatchObject({ light: "red" });
    expect(it.waitMinutes).toBeGreaterThanOrEqual(31);
    expect(board.body.counts.received).toBeGreaterThanOrEqual(1);
    // «terminados» cuenta los de hoy: si los 31 minutos cruzan la medianoche, el de antes ya es de ayer
    if (new Date(t.clock.now).toDateString() === new Date().toDateString())
      expect(board.body.finished).toBeGreaterThanOrEqual(1);
    t.clock.now = new Date();
    const c = await t.call("POST", `/delivery/orders/${r.body.id}/cancel`, {
      token: admin,
      body: { version: r.body.version, note: "No contesta" },
    });
    expect(c.body).toMatchObject({ status: "cancelled", light: null });
    expect(c.body.events.at(-1)).toMatchObject({ status: "cancelled", by: "Sistemas", note: "No contesta" });
    // 1.2.293 · se avisa a la plataforma: el aviso queda en la cola hacia el Manager
    const ob = (await t.sql.query("SELECT payload FROM sync_outbox WHERE entity = 'delivery.cancelled' AND entity_id = $1", [r.body.id])).rows;
    expect(ob).toHaveLength(1);
    expect(ob[0].payload).toMatchObject({ platform: expect.any(String), reason: "No contesta" });
    const again = await t.call("POST", `/delivery/orders/${r.body.id}/cancel`, {
      token: admin,
      body: { version: c.body.version },
    });
    expect([again.status, again.error.code]).toEqual([409, "INVALID_TRANSITION"]);
    const fin = await t.call("GET", "/delivery/orders?scope=finished", { token: admin });
    expect(fin.body.items.map((x: any) => x.status)).toContain("cancelled");
    const one = await t.call("GET", `/delivery/orders/${r.body.id}`, { token: barra });
    expect(one.body.lines).toHaveLength(2);
    expect((await t.call("GET", `/delivery/orders/${crypto.randomUUID()}`, { token: barra })).status).toBe(
      404,
    );
  });

  it("delivery apagado: el tablero y el alta → 409 DELIVERY_OFF", async () => {
    const s = (await t.call("GET", "/config/pedidos/current", { token: admin })).body;
    await t.call("PATCH", "/config/pedidos/current", {
      token: admin,
      body: { active: false, version: s.version },
    });
    expect((await t.call("GET", "/delivery/orders", { token: admin })).error.code).toBe("DELIVERY_OFF");
    const r = await t.call("POST", "/delivery/orders", {
      headers: { authorization: `Bearer ${KEY}` },
      body: pedido(),
    });
    expect([r.status, r.error.code]).toEqual([409, "DELIVERY_OFF"]);
    const s2 = (await t.call("GET", "/config/pedidos/current", { token: admin })).body;
    await t.call("PATCH", "/config/pedidos/current", {
      token: admin,
      body: { active: true, autoAccept: false, askRider: true, version: s2.version },
    });
  });
});
