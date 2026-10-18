import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

let t: T, mesero: string, barra: string, sistemas: string;
beforeAll(async () => {
  t = await setup();
  mesero = await t.login(PIN.mesero); barra = await t.login(PIN.barra); sistemas = await t.login(PIN.sistemas);
  await ensurePeriod(t, sistemas);
});
afterAll(async () => { await t.close(); });

const newOrder = async (token = mesero) => {
  const o = await t.call("POST", "/orders", { token, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } });
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  return { id: o.body._id as string, acc: o.body.accounts[0].id as string, version: o.body.version as number };
};
const add = (id: string, body: object, token = mesero, headers = {}) => t.call("POST", `/orders/${id}/lines`, { token, body, headers });

describe("líneas", () => {
  it("la misma tecla dos veces se junta en una línea «Por enviar»", async () => {
    const o = await newOrder();
    await add(o.id, { plu: PLU.croquetas });
    const r = await add(o.id, { plu: PLU.croquetas, quantity: 2 });
    expect(r.body.accounts[0].lines).toHaveLength(1);
    expect(r.body.accounts[0].lines[0].quantity).toBe(3);
  });

  it("duplicado de otra persona en < 3 min → 409 DUPLICATE_SUSPECTED; con force entra", async () => {
    const o = await newOrder();
    await add(o.id, { plu: PLU.kaspirinha });
    await t.call("POST", `/orders/${o.id}/send`, { token: mesero, body: {} });
    const dup = await add(o.id, { plu: PLU.kaspirinha }, barra);
    expect([dup.status, dup.error.code]).toEqual([409, "DUPLICATE_SUSPECTED"]);
    expect(dup.error.details.by).toBe("Mesero");
    expect((await add(o.id, { plu: PLU.kaspirinha, force: true }, barra)).status).toBe(201);
  });

  it("cambiar cantidad y quitar algo sin enviar no pide motivo ni permiso", async () => {
    const o = await newOrder();
    const r = await add(o.id, { plu: PLU.tosta, quantity: 2 });
    const lid = r.body.accounts[0].lines[0].id;
    const p = await t.call("PATCH", `/orders/${o.id}/lines/${lid}`, { token: mesero, body: { quantity: 3, comment: "poco hecha" } });
    expect(p.body.accounts[0].lines[0]).toMatchObject({ quantity: 3, comment: "poco hecha" });
    const d = await t.call("POST", `/orders/${o.id}/lines/${lid}/delete`, { token: mesero, body: {} });
    expect(d.status).toBe(200);
    expect(d.body.accounts[0].lines).toHaveLength(0);
    expect(d.body.accounts[0].deletedLines).toHaveLength(0);
  });

  it("borrar algo enviado: motivo obligatorio, permiso o clave de encargado, y queda el rastro", async () => {
    const o = await newOrder();
    const r = await add(o.id, { plu: PLU.tosta, quantity: 3 });
    const lid = r.body.accounts[0].lines[0].id;
    await t.call("POST", `/orders/${o.id}/send`, { token: mesero, body: {} });

    expect((await t.call("POST", `/orders/${o.id}/lines/${lid}/delete`, { token: mesero, body: {} })).error.code).toBe("VALIDATION");
    const need = await t.call("POST", `/orders/${o.id}/lines/${lid}/delete`, { token: mesero, body: { reason: "Error al marcar" } });
    expect([need.status, need.error.code, need.error.details.permission]).toEqual([403, "PERMISSION_REQUIRED", "pedido.elimEnviado"]);

    // Barra (cajero) tampoco puede autorizarlo
    const no = await t.call("POST", "/sessions/authorize", { token: mesero, body: { pin: PIN.barra, permission: "pedido.elimEnviado" } });
    expect([no.status, no.error.code]).toEqual([403, "NOT_ALLOWED"]);

    const ok = await t.call("POST", "/sessions/authorize", { token: mesero, body: { pin: PIN.sistemas, permission: "pedido.elimEnviado" } });
    expect(ok.status).toBe(201);
    const auth = ok.body.authorization.token;
    const reasonId = (await t.sql.query("SELECT id FROM reason WHERE name='Error al marcar'")).rows[0].id;
    const d = await t.call("POST", `/orders/${o.id}/lines/${lid}/delete`, { token: mesero, body: { reasonId, quantity: 1, authorization: auth } });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.accounts[0].lines[0].quantity).toBe(2);
    expect(d.body.accounts[0].deletedLines[0]).toMatchObject({ quantity: 1, reason: "Error al marcar", removedBy: { user: "Mesero" }, authorizedBy: { user: "Sistemas" } });

    // la autorización es de un solo uso
    const again = await t.call("POST", `/orders/${o.id}/lines/${lid}/delete`, { token: mesero, body: { reason: "x", authorization: auth } });
    expect(again.error.code).toBe("PERMISSION_REQUIRED");

    const { rows } = await t.sql.query("SELECT quantity, deleted, delete_reason, deleted_by_user_name, delete_authorized_by_user_name FROM order_line WHERE order_id=$1 AND deleted", [o.id]);
    expect(rows).toEqual([{ quantity: "1.000", deleted: true, delete_reason: "Error al marcar", deleted_by_user_name: "Mesero", delete_authorized_by_user_name: "Sistemas" }]);
  });

  it("versión vieja → 409 VERSION_CONFLICT", async () => {
    const o = await newOrder();
    await add(o.id, { plu: PLU.tosta });
    const r = await t.call("PATCH", `/orders/${o.id}`, { token: mesero, body: { guests: 4, version: o.version } });
    expect([r.status, r.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    expect(r.error.details.current).toBe(o.version + 1);
  });

  it("Idempotency-Key: el reintento no duplica la línea; la misma clave con otro cuerpo → 422", async () => {
    const o = await newOrder();
    const key = crypto.randomUUID();
    const a = await add(o.id, { plu: PLU.croquetas, comment: "sin sal" }, mesero, { "idempotency-key": key });
    const b = await add(o.id, { plu: PLU.croquetas, comment: "sin sal" }, mesero, { "idempotency-key": key });
    expect(b.status).toBe(201);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.body).toEqual(a.body);
    const { rows } = await t.sql.query("SELECT count(*)::int n FROM order_line WHERE order_id=$1", [o.id]);
    expect(rows[0].n).toBe(1);
    expect((await add(o.id, { plu: PLU.tosta }, mesero, { "idempotency-key": key })).error.code).toBe("VALIDATION");
  });

  it("datos mal formados → 422 con el campo; producto que no existe → 404", async () => {
    const o = await newOrder();
    const bad = await add(o.id, { plu: "abc", quantity: -1 });
    expect(bad.status).toBe(422);
    expect(bad.env.errors.map((f: any) => f.field)).toEqual(expect.arrayContaining(["plu", "quantity"]));
    expect((await add(o.id, { plu: 999999 })).error.code).toBe("NOT_FOUND");
    expect((await t.call("GET", `/orders/${crypto.randomUUID()}`, { token: mesero })).status).toBe(404);
  });
});

describe("separar cuenta", () => {
  it("pasa unidades a una cuenta nueva y cada una se cobra y factura por separado", async () => {
    const o = await newOrder();
    let r = await add(o.id, { plu: PLU.tosta, quantity: 2 });
    r = await add(o.id, { plu: PLU.croquetas });
    await t.call("POST", `/orders/${o.id}/send`, { token: mesero, body: {} });
    const tosta = r.body.accounts[0].lines.find((l: any) => l.productId === PLU.tosta);
    const m = await t.call("POST", `/orders/${o.id}/lines/move`, { token: mesero, body: { lines: [{ lineId: tosta.id, quantity: 1 }], newAccountName: "Ana" } });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(m.body.accounts.map((a: any) => [a.name, a.totals.total])).toEqual([["Cuenta 1", 14.45], ["Ana", 8.5]]);

    for (const a of m.body.accounts) {
      const p = await t.call("POST", `/orders/${o.id}/accounts/${a.id}/payments`, { token: barra, body: { method: "card", amount: a.totals.total } });
      expect(p.body.totals.pending).toBe(0);
      const f = await t.call("POST", `/orders/${o.id}/accounts/${a.id}/invoice`, { token: barra });
      expect(f.status).toBe(201);
    }
    const { rows } = await t.sql.query("SELECT status FROM orders WHERE id=$1", [o.id]);
    expect(rows[0].status).toBe("closed");
  });

  it("pasar la línea entera deja la original marcada «Pasada a …» y no descuadra", async () => {
    const o = await newOrder();
    const r = await add(o.id, { plu: PLU.tosta });
    await add(o.id, { plu: PLU.croquetas });
    await t.call("POST", `/orders/${o.id}/send`, { token: mesero, body: {} });
    const m = await t.call("POST", `/orders/${o.id}/lines/move`, { token: mesero, body: { lines: [{ lineId: r.body.accounts[0].lines[0].id, quantity: 1 }] } });
    expect(m.body.accounts.map((a: any) => a.totals.total)).toEqual([5.95, 8.5]);
    const { rows } = await t.sql.query("SELECT delete_reason FROM order_line WHERE order_id=$1 AND deleted", [o.id]);
    expect(rows).toEqual([{ delete_reason: "Pasada a Cuenta 2" }]);
  });

  it("cuenta a 0,00 € → 409 NOTHING_TO_CHARGE en precuenta, cobro y factura", async () => {
    const o = await newOrder(sistemas);
    await add(o.id, { plu: 1534 }, sistemas); // CAMBIO LECHE, 0,00 €
    await t.call("POST", `/orders/${o.id}/send`, { token: sistemas, body: {} });
    const pre = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill`, { token: sistemas, body: {} });
    expect([pre.status, pre.error?.code]).toEqual([409, "NOTHING_TO_CHARGE"]);
    const pay = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, { token: sistemas, body: { method: "cash", amount: 1 } });
    expect([pay.status, pay.error?.code]).toEqual([409, "NOTHING_TO_CHARGE"]);
    const inv = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/invoice`, { token: sistemas, body: {} });
    expect([inv.status, inv.error?.code]).toEqual([409, "NOTHING_TO_CHARGE"]);
    // sin productos no se transfiere; con productos no se cierra sin venta; al eliminarlos (con motivo) se cierra y la mesa queda libre
    const busy = await t.call("POST", `/orders/${o.id}/close`, { token: sistemas, body: {} });
    expect([busy.status, busy.error?.code]).toEqual([409, "ORDER_NOT_EMPTY"]);
    const tx = (await t.call("GET", `/orders/${o.id}`, { token: sistemas })).body;
    await t.call("POST", `/orders/${o.id}/lines/${tx.accounts[0].lines[0].id}/delete`, { token: sistemas, body: { reason: "Invitación" } });
    const tr = await t.call("POST", `/orders/${o.id}/transfer`, { token: sistemas, body: { toTableId: await freeTable(t, "TERRAZA") } });
    expect([tr.status, tr.error?.field]).toEqual([422, "orderId"]);
    const closed = await t.call("POST", `/orders/${o.id}/close`, { token: sistemas, body: {} });
    expect(closed.status, JSON.stringify(closed.env)).toBe(200);
    expect(closed.body.status).toBe("cancelled");
    const { rows: [row] } = await t.sql.query("SELECT status, closed_at FROM orders WHERE id=$1", [o.id]);
    expect(row.status).toBe("cancelled"); expect(row.closed_at).not.toBeNull();
    expect((await t.call("POST", `/orders/${o.id}/close`, { token: sistemas, body: {} })).error.code).toBe("ORDER_CLOSED");
  });

  it("pregunta obligatoria sin responder → 422 (field modifiers); respondida entra", async () => {
    const o = await newOrder(sistemas);
    const no = await add(o.id, { plu: 2018 }, sistemas); // BACARDI: «¿Con qué acompaña LICORES?» mínimo 1
    expect([no.status, no.error?.field, no.error?.details.min]).toEqual([422, "modifiers", 1]);
    const two = await add(o.id, { plu: 2018, modifiers: [{ plu: 5272 }, { plu: 5275 }] }, sistemas);
    expect(two.status).toBe(422);
    const ok = await add(o.id, { plu: 2018, modifiers: [{ plu: 5272 }] }, sistemas);
    expect(ok.status, JSON.stringify(ok.env)).toBe(201);
    expect(ok.body.accounts[0].lines[0].modifiers[0].name).toBe("KAS LIMON");
  });

  it("ordenar lo por enviar: cambia el orden, se guarda y la comanda sale en ese orden", async () => {
    const o = await newOrder(sistemas);
    await add(o.id, { plu: PLU.redbull }, sistemas);
    await add(o.id, { plu: PLU.croquetas }, sistemas);
    const r = await add(o.id, { plu: PLU.tosta }, sistemas);
    const [a, b, c] = r.body.accounts[0].lines.map((l: any) => l.id);
    const bad = await t.call("POST", `/orders/${o.id}/lines/reorder`, { token: sistemas, body: { lineIds: [c, a] } });
    expect([bad.status, bad.error?.field]).toEqual([422, "lineIds"]);
    const ok = await t.call("POST", `/orders/${o.id}/lines/reorder`, { token: sistemas, body: { lineIds: [c, a, b] } });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body.accounts[0].lines.map((l: any) => l.id)).toEqual([c, a, b]);
    // se guarda: al volver a leer sigue igual
    const again = (await t.call("GET", `/orders/${o.id}`, { token: sistemas })).body;
    expect(again.accounts[0].lines.map((l: any) => l.id)).toEqual([c, a, b]);
    // una línea nueva va al final
    const d = (await add(o.id, { plu: PLU.kaspirinha }, sistemas)).body.accounts[0].lines.at(-1).id;
    expect((await t.call("GET", `/orders/${o.id}`, { token: sistemas })).body.accounts[0].lines.map((l: any) => l.id)).toEqual([c, a, b, d]);
    // la comanda respeta el orden (la tosta va antes que las croquetas)
    const before = t.printer.jobs.length;
    await t.call("POST", `/orders/${o.id}/send`, { token: sistemas, body: {} });
    const text = t.printer.jobs.slice(before).filter(j => j.kind === "kitchen").map(j => j.text).join("\n");
    expect(text.indexOf("TOSTA")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("TOSTA")).toBeLessThan(text.indexOf("CROQUETAS"));
  });
});
