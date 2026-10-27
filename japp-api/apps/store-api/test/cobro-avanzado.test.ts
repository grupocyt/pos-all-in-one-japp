import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";
// @ts-ignore
import { verificationQueries } from "../../../../japp-db/scripts/db.mjs";

let t: T;
let mesero: string;
let barra: string;
let sistemas: string;
beforeAll(async () => {
  t = await setup();
  mesero = await t.login(PIN.mesero);
  barra = await t.login(PIN.barra);
  sistemas = await t.login(PIN.sistemas);
  await ensurePeriod(t, sistemas);
});
afterAll(async () => {
  await t.close();
});

const newOrder = async (token = mesero, area: "BARRA" | "TERRAZA" = "BARRA") => {
  const o = await t.call("POST", "/orders", {
    token,
    body: { tableId: await freeTable(t, area), guests: 2 },
  });
  const r = await t.call("POST", `/orders/${o.body._id}/lines`, {
    token,
    body: { plu: PLU.tosta, quantity: 2 },
  }); // 17,00
  return { id: o.body._id as string, acc: o.body.accounts[0].id as string, tx: r.body };
};

describe("descuentos", () => {
  it("manual: el mesero necesita encargado; con clave se aplica y el total baja; al quitarlo vuelve", async () => {
    const o = await newOrder();
    const url = `/orders/${o.id}/accounts/${o.acc}/discounts`;
    expect(
      (
        await t.call("POST", url, {
          token: mesero,
          body: { type: "percentage", value: 10, reason: "Cliente habitual" },
        })
      ).error.code,
    ).toBe("PERMISSION_REQUIRED");
    const auth = (
      await t.call("POST", "/sessions/authorize", {
        token: mesero,
        body: { pin: PIN.sistemas, permission: "cobro.descuentos" },
      })
    ).body.authorization.token;
    const r = await t.call("POST", url, {
      token: mesero,
      body: { type: "percentage", value: 10, reason: "Cliente habitual", authorization: auth },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.accounts[0].totals).toMatchObject({ sub: 17, disc: 1.7, total: 15.3 });
    const did = r.body.accounts[0].discounts[0].id;
    const u = await t.call("DELETE", `${url}/${did}`, { token: sistemas });
    expect(u.body.accounts[0].totals.total).toBe(17);
    const { rows } = await t.sql.query(
      "SELECT status, removed_by_user_name FROM account_discount WHERE id=$1",
      [did],
    );
    expect(rows[0]).toEqual({ status: "removed", removed_by_user_name: "Sistemas" });
  });
  it("con cobros hechos ya no se puede aplicar", async () => {
    const o = await newOrder(barra);
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, {
      token: barra,
      body: { method: "card", amount: 5 },
    });
    const r = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/discounts`, {
      token: sistemas,
      body: { type: "fixed", value: 2, reason: "x" },
    });
    expect(r.error.code).toBe("VALIDATION");
  });
});

describe("factura completa F1", () => {
  it("con datos del cliente sale F1 en la serie F y se guarda el cliente", async () => {
    const o = await newOrder(barra);
    const bad = await t.call("PUT", `/orders/${o.id}/accounts/${o.acc}/customer`, {
      token: barra,
      body: { type: "company", taxId: "B12345678", name: "Eventos Madrid SL" },
    });
    expect([bad.status, bad.error.details.field]).toEqual([422, "taxId"]);
    const c = await t.call("PUT", `/orders/${o.id}/accounts/${o.acc}/customer`, {
      token: barra,
      body: {
        type: "company",
        taxId: "B02891075",
        name: "Eventos Madrid SL",
        address: { street: "Calle Mayor 1", postalCode: "28001", city: "Madrid", country: "ES" },
      },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.accounts[0].customerData).toMatchObject({ taxId: "B02891075", name: "Eventos Madrid SL" });
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, {
      token: barra,
      body: { method: "card", amount: 17 },
    });
    const jobs = t.printer.jobs.length;
    const f = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/invoice`, { token: barra });
    expect(f.body.invoice).toMatchObject({ type: "F1", series: "F2026" });
    // la F1 impresa lleva el domicilio del cliente (también al reimprimir) — pruebas del 27/10/2026
    const printedF1 = t.printer.jobs.slice(jobs).map((j) => j.text).join("\n");
    expect(printedF1).toContain("Calle Mayor 1, 28001 Madrid");
    const invId = (await t.sql.query("SELECT id FROM invoice WHERE account_id=$1", [o.acc])).rows[0].id;
    const j2 = t.printer.jobs.length;
    await t.call("POST", `/invoices/${invId}/reprint`, { token: sistemas });
    expect(t.printer.jobs.slice(j2).map((j) => j.text).join("\n")).toContain("Calle Mayor 1, 28001 Madrid");
    const detail = await t.call(
      "GET",
      `/invoices/${(await t.sql.query("SELECT id FROM invoice WHERE account_id=$1", [o.acc])).rows[0].id}`,
      { token: sistemas },
    );
    expect(detail.body).toMatchObject({
      type: "F1",
      customer: { taxId: "B02891075" },
      taxes: [{ rate: 10, base: 15.45, tax: 1.55 }],
    });
    const list = await t.call("GET", "/invoices?q=Eventos", { token: sistemas });
    expect(list.body.items[0]).toMatchObject({ type: "F1", methods: ["card"] });
  });
});

describe("mesa", () => {
  // a una mesa ocupada ya no es TABLE_BUSY: se juntan (23/10/2026, pruebas en correcciones-tienda.test.ts)
  it("transferir a una mesa libre y queda en el historial", async () => {
    const o = await newOrder();
    const to = await freeTable(t, "BARRA");
    const r = await t.call("POST", `/orders/${o.id}/transfer`, { token: mesero, body: { toTableId: to } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.tableData).toMatchObject({ tableId: to, zone: "BARRA" });
    expect(r.body.accounts[0].lines[0].unitPrice).toBe(8.5); // lo ya marcado conserva su precio
    const ev = await t.call("GET", `/orders/${o.id}/events`, { token: mesero });
    expect(ev.body.items.map((e: any) => e.type)).toEqual(
      expect.arrayContaining(["tableOpened", "lineAdded", "tableTransferred"]),
    );
  });
  it("añadir y quitar una cuenta vacía; la que tiene líneas no", async () => {
    const o = await newOrder();
    const a = await t.call("POST", `/orders/${o.id}/accounts`, { token: mesero, body: { name: "Pareja" } });
    const nid = a.body.accounts.find((x: any) => x.name === "Pareja").id;
    expect((await t.call("DELETE", `/orders/${o.id}/accounts/${o.acc}`, { token: mesero })).error.code).toBe(
      "VALIDATION",
    );
    const r = await t.call("DELETE", `/orders/${o.id}/accounts/${nid}`, { token: mesero });
    expect(r.body.accounts.map((x: any) => x.name)).toEqual(["Cuenta 1"]);
  });
});

describe("caja, informes y developer", () => {
  it("retiro con motivo baja el efectivo esperado", async () => {
    const a = (await t.call("GET", "/cash/summary", { token: sistemas })).body;
    expect(
      (await t.call("POST", "/cash/movements", { token: sistemas, body: { kind: "withdrawal", amount: 20 } }))
        .error.code,
    ).toBe("VALIDATION");
    const r = await t.call("POST", "/cash/movements", {
      token: sistemas,
      body: { kind: "withdrawal", amount: 20, reasonId: "A caja fuerte" },
    });
    expect(r.status).toBe(201);
    const b = (await t.call("GET", "/cash/summary", { token: sistemas })).body;
    expect(b.withdrawals - a.withdrawals).toBe(20);
    expect(Math.round((a.expectedCash - b.expectedCash) * 100) / 100).toBe(20);
  });
  it("informe de eliminaciones (no incluye lo pasado a otra cuenta) y transacciones de developer", async () => {
    const o = await newOrder();
    await t.call("POST", `/orders/${o.id}/send`, { token: mesero, body: {} });
    const lid = o.tx.accounts[0].lines[0].id;
    await t.call("POST", `/orders/${o.id}/lines/${lid}/delete`, {
      token: sistemas,
      body: { reason: "Producto agotado", quantity: 1 },
    });
    const d = await t.call("GET", "/reports/deletions", { token: sistemas });
    expect(d.body.items[0]).toMatchObject({
      product: expect.any(String),
      reason: "Producto agotado",
      user: "Sistemas",
      amount: 8.5,
    });
    expect((await t.call("GET", "/reports/deletions", { token: mesero })).error.code).toBe(
      "PERMISSION_REQUIRED",
    );
    const tx = await t.call("GET", `/transactions?status=open&q=${o.id.slice(0, 8)}`, { token: sistemas });
    expect(tx.body.items).toHaveLength(1);
    expect(tx.body.items[0]).toMatchObject({ id: o.id, total: 8.5 });
    expect((await t.call("GET", "/transactions", { token: mesero })).error.code).toBe("PERMISSION_REQUIRED");
  });
  it("salir devuelve 200 (data null) y la base sigue cuadrando", async () => {
    expect((await t.call("DELETE", "/sessions/current", { token: mesero })).status).toBe(200);
    for (const q of verificationQueries()) {
      expect((await t.sql.query(q.sql)).rows, q.name).toEqual([]);
    }
  });
});
