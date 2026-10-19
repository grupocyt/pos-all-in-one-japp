import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";
// @ts-ignore — consultas de control del repo hermano
import { verificationQueries } from "../../../../japp-db/scripts/db.mjs";

let t: T;
let mesero: string;
let barra: string;
beforeAll(async () => {
  t = await setup();
  barra = await t.login(PIN.barra);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, await t.login(PIN.sistemas));
  await t.sql.query("UPDATE product SET price_terrace = 9.50 WHERE plu = $1", [PLU.tosta]);
});
afterAll(async () => {
  await t.sql.query("UPDATE product SET price_terrace = NULL WHERE plu = $1", [PLU.tosta]);
  await t.close();
});

describe("mesa de terraza de punta a punta", () => {
  it("abrir → pedir → enviar → precuenta → cobrar → facturar, y la base cuadra", async () => {
    const tableId = await freeTable(t, "TERRAZA");
    const open = await t.call("POST", "/orders", { token: mesero, body: { tableId, guests: 2 } });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    const orderId = open.body._id;
    const accountId = open.body.accounts[0].id;
    expect(open.body.tableData).toMatchObject({ zone: "TERRAZA", priceList: "terrace", guests: 2 });

    // la mesa ya no está libre
    expect(
      (await t.call("POST", "/orders", { token: mesero, body: { tableId, guests: 2 } })).error.code,
    ).toBe("TABLE_BUSY");

    let r = await t.call("POST", `/orders/${orderId}/lines`, {
      token: mesero,
      body: { plu: PLU.tosta, quantity: 2 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.accounts[0].lines[0]).toMatchObject({
      productId: PLU.tosta,
      quantity: 2,
      unitPrice: 9.5,
      status: "pendingPrint",
    }); // PVP terraza
    r = await t.call("POST", `/orders/${orderId}/lines`, {
      token: mesero,
      body: { plu: PLU.croquetas, quantity: 1, modifiers: [{ plu: PLU.redbull }] },
    });
    expect(r.body.accounts[0].totals).toMatchObject({ sub: 25.95, total: 25.95, pending: 25.95 }); // 2×9,50 + 5,95 + 1,00

    const sent = await t.call("POST", `/orders/${orderId}/send`, { token: mesero, body: {} });
    expect(sent.status).toBe(200);
    expect(sent.body.printed.length).toBeGreaterThan(0);
    const kitchen = t.printer.jobs
      .filter((j) => j.kind === "kitchen")
      .map((j) => j.text)
      .join("\n");
    expect(kitchen).toContain("2 Comensales\n");
    expect(kitchen).toMatch(/Mesa \S+ TERRAZA/);
    expect(kitchen).toMatch(/2  TOSTA DE JAMON\n/);
    expect(kitchen).toMatch(/1  CROQUETAS DE BOLETUS[\s\S]*-- 1 /);
    expect(sent.body.order.accounts[0].lines.every((l: any) => l.status === "printed")).toBe(true);

    r = await t.call("POST", `/orders/${orderId}/accounts/${accountId}/prebill`, { token: mesero });
    const pb = t.printer.jobs.at(-1)!;
    expect(pb.kind).toBe("prebill");
    expect(pb.text).toContain("PRECUENTA");
    expect(pb.text).toContain("NIF: B02891075");
    expect(pb.text).toMatch(/Total \(Impuestos Incl\.\)\s+25,95 €/);
    expect(r.body.accounts[0].lines.every((l: any) => l.status === "preBill")).toBe(true);

    // el mesero no cobra (excepción personal can_charge = false)
    const denied = await t.call("POST", `/orders/${orderId}/accounts/${accountId}/payments`, {
      token: mesero,
      body: { method: "cash", amount: 25.95, cashGiven: 30 },
    });
    expect([denied.status, denied.error.code, denied.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "cobro.cobrar",
    ]);

    // facturar con pendiente → 409
    expect(
      (await t.call("POST", `/orders/${orderId}/accounts/${accountId}/invoice`, { token: barra })).error.code,
    ).toBe("PENDING_NOT_ZERO");

    const p1 = await t.call("POST", `/orders/${orderId}/accounts/${accountId}/payments`, {
      token: barra,
      body: { method: "card", amount: 10, tip: 1 },
    });
    expect(p1.body.totals).toEqual({ total: 25.95, paid: 10, pending: 15.95 });
    // más de lo pendiente ya no se recorta: 409 AMOUNT_EXCEEDS_PENDING con lo que queda
    const over = await t.call("POST", `/orders/${orderId}/accounts/${accountId}/payments`, {
      token: barra,
      body: { method: "cash", amount: 50, cashGiven: 50 },
    });
    expect([over.status, over.error.code, over.error.details.pending]).toEqual([
      409,
      "AMOUNT_EXCEEDS_PENDING",
      15.95,
    ]);
    // sin importe se cobra lo pendiente (15,95) y se devuelve el cambio de 20
    const p2 = await t.call("POST", `/orders/${orderId}/accounts/${accountId}/payments`, {
      token: barra,
      body: { method: "cash", amount: null, cashGiven: 20 },
    });
    expect(p2.body.payment.change).toBe(4.05);
    expect(p2.body.totals.pending).toBe(0);

    const inv = await t.call("POST", `/orders/${orderId}/accounts/${accountId}/invoice`, { token: barra });
    expect(inv.status).toBe(201);
    expect(inv.body.invoice).toMatchObject({ type: "F2", series: "T2026", total: 25.95 });
    expect(inv.body.invoice.invoiceNumber).toMatch(/^T2026-\d{6}$/);
    expect(inv.body.invoice.verifactuQr).toContain("nif=B02891075");
    expect(inv.body.tableClosed).toBe(true);
    expect(inv.body.printed).toBe(true);
    const ft = t.printer.jobs.at(-1)!;
    expect(ft.kind).toBe("invoice");
    expect(ft.openDrawer).toBe(true); // hubo efectivo y CAJA1 abre cajón
    expect(ft.text).toContain("FACTURA SIMPLIFICADA");
    expect(ft.text).toContain(`Nº Op.:    ${inv.body.invoice.invoiceNumber}`);
    expect(ft.text).toMatch(/Entregado:\s+20,00 € Cambio:\s+4,05 €/);
    expect(ft.text).toMatch(/Tarjeta\s+10,00 €/);
    expect(ft.text).toMatch(/Propina\s+1,00 €/);
    expect(ft.text).toContain("VERI*FACTU");
    const invId = (await t.sql.query("SELECT id FROM invoice WHERE account_id=$1", [accountId])).rows[0].id;
    expect((await t.call("POST", `/invoices/${invId}/reprint`, { token: barra })).body).toEqual({
      printed: true,
    });
    expect(t.printer.jobs.at(-1)!.text).toBe(ft.text);

    // lo que queda en la base
    const {
      rows: [acc],
    } = await t.sql.query("SELECT status, subtotal, total, paid, pending, tips FROM account WHERE id=$1", [
      accountId,
    ]);
    expect(acc).toEqual({
      status: "invoiced",
      subtotal: "25.95",
      total: "25.95",
      paid: "25.95",
      pending: "0.00",
      tips: "1.00",
    });
    const {
      rows: [ord],
    } = await t.sql.query("SELECT status, version, snapshot->>'_id' AS snap FROM orders WHERE id=$1", [
      orderId,
    ]);
    expect(ord.status).toBe("closed");
    expect(ord.snap).toBe(orderId);
    const { rows: taxes } = await t.sql.query(
      "SELECT rate, base, tax FROM invoice_tax it JOIN invoice i ON i.id=it.invoice_id WHERE i.account_id=$1",
      [accountId],
    );
    expect(taxes).toEqual([{ rate: "10.00", base: "23.59", tax: "2.36" }]);
    const { rows: out } = await t.sql.query("SELECT count(*)::int n FROM sync_outbox WHERE entity_id=$1", [
      orderId,
    ]);
    expect(out[0].n).toBeGreaterThanOrEqual(7);

    // y las consultas de control de japp-db no encuentran nada raro
    for (const q of verificationQueries()) {
      expect((await t.sql.query(q.sql)).rows, q.name).toEqual([]);
    }

    // una mesa cerrada ya no admite cambios
    expect(
      (await t.call("POST", `/orders/${orderId}/lines`, { token: mesero, body: { plu: PLU.tosta } })).error
        .code,
    ).toBe("ORDER_CLOSED");
  });

  it("en sala (BARRA) se cobra el PVP general", async () => {
    const tableId = await freeTable(t, "BARRA");
    const o = await t.call("POST", "/orders", { token: mesero, body: { tableId, guests: 1 } });
    const r = await t.call("POST", `/orders/${o.body._id}/lines`, {
      token: mesero,
      body: { plu: PLU.tosta },
    });
    expect(r.body.accounts[0].lines[0].unitPrice).toBe(8.5);
  });

  it("el plano muestra la mesa abierta como mía para quien la abrió y de otro para los demás", async () => {
    const mine = (await t.call("GET", "/tables", { token: mesero })).body.items.filter(
      (x: any) => x.state === "mine",
    );
    expect(mine.length).toBeGreaterThan(0);
    const other = (await t.call("GET", "/tables", { token: barra })).body.items.find(
      (x: any) => x.tableId === mine[0].tableId,
    );
    expect(other.state).toBe("busy");
  });
});
