import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * 1.2.292 (20/11/2026) · decisiones del dueño:
 *  - «Transferir producto» con permiso propio (mesas.transferirProducto); fuera «Reabrir» (cobro.reabrir).
 *  - El cierre guarda lo contado de todas las formas de pago (cash_closing.method_detail) y sale en el corte Z.
 *  - El «Formulario» del descuento se guarda con él (account_discount.form_data) y sale en la factura.
 *  - Abonos en efectivo: lo devuelto sale del cajón → resta de lo esperado.
 *  - N2b: precuenta, cobro y «Cobrar y facturar» con expectedTotal; si el servidor tiene otro total → 409 TOTAL_MISMATCH.
 */
let t: T;
let sis: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.close();
});
const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
const open = async (plus: number[] = [PLU.tosta], token = sis) => {
  const o = await t.call("POST", "/orders", { token, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } });
  for (const plu of plus) {
    await t.call("POST", `/orders/${o.body._id}/lines`, { token, body: { plu, force: true } });
  }
  await t.call("POST", `/orders/${o.body._id}/send`, { token, body: {} });
  return { id: o.body._id as string, tableId: o.body.tableData.tableId as string, acc: o.body.accounts[0].id as string };
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const total = async (id: string, acc: string) => (await get(id)).accounts.find((a: any) => a.id === acc).totals.total as number;

describe("permisos", () => {
  it("«Transferir producto» existe y lo tiene quien podía transferir; «Reabrir» ya no existe", async () => {
    const codes = (await t.sql.query("SELECT code FROM permission")).rows.map((r: any) => r.code);
    expect(codes).toContain("mesas.transferirProducto");
    expect(codes).not.toContain("cobro.reabrir");
    const n = async (c: string) => Number((await t.sql.query("SELECT count(*) n FROM profile_permission WHERE permission_code = $1", [c])).rows[0].n);
    expect(await n("mesas.transferirProducto")).toBe(await n("mesas.transferir"));
  });
  it("un producto suelto (item) pide mesas.transferirProducto; sin él → 403 aunque pueda transferir la mesa", async () => {
    const d = await open([PLU.kaspirinha], mesero);
    const s = await open([PLU.tosta], mesero);
    const prof = (await t.sql.query("SELECT p.id FROM user_profile p WHERE p.code = 'MESERO'")).rows[0].id;
    await t.sql.query("DELETE FROM profile_permission WHERE profile_id = $1 AND permission_code = 'mesas.transferirProducto'", [prof]);
    try {
      const no = await t.call("POST", `/orders/${s.id}/accounts/${s.acc}/transfer`, {
        token: mesero,
        body: { toTableId: d.tableId, version: (await get(s.id)).version, item: true },
      });
      expect(no.status).toBe(403);
      expect(no.error.details?.permission ?? no.env?.error?.details?.permission).toBe("mesas.transferirProducto");
      const ok = await t.call("POST", `/orders/${s.id}/accounts/${s.acc}/transfer`, {
        token: mesero,
        body: { toTableId: d.tableId, version: (await get(s.id)).version },
      });
      expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    } finally {
      await t.sql.query(
        "INSERT INTO profile_permission (profile_id, permission_code, store_id) SELECT id, 'mesas.transferirProducto', store_id FROM user_profile WHERE id = $1 ON CONFLICT DO NOTHING",
        [prof],
      );
    }
  });
});

describe("N2b · el total de la pantalla tiene que ser el del servidor", () => {
  it("precuenta, cobro y «Cobrar y facturar»: otro total → 409 TOTAL_MISMATCH y no se imprime ni se cobra", async () => {
    const o = await open([PLU.tosta, PLU.croquetas]);
    const tot = await total(o.id, o.acc);
    const jobs = t.printer.jobs.length;
    const pb = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill`, { token: sis, body: { expectedTotal: tot + 1 } });
    expect(pb.status).toBe(409);
    expect(pb.error.code).toBe("TOTAL_MISMATCH");
    expect(t.printer.jobs.length).toBe(jobs);
    const pay = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/payments`, {
      token: sis,
      body: { method: "card", amount: 1, expectedTotal: tot - 0.5 },
    });
    expect(pay.status).toBe(409);
    expect((await get(o.id)).accounts[0].payments.filter((p: any) => p.status === "confirmed")).toHaveLength(0);
    const ck = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/checkout`, {
      token: sis,
      body: { payments: [{ method: "card", amount: null }], expectedTotal: tot + 0.01 },
    });
    expect(ck.status).toBe(409);
    expect((await t.sql.query("SELECT count(*) n FROM invoice WHERE account_id = $1", [o.acc])).rows[0].n).toBe("0");
    // con el mismo total (o sin mandarlo, como antes) sí
    const pb2 = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill`, { token: sis, body: { expectedTotal: tot } });
    expect([200, 409]).toContain(pb2.status);
    expect(pb2.error?.code ?? null).not.toBe("TOTAL_MISMATCH");
    const ok = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/checkout`, {
      token: sis,
      body: { payments: [{ method: "card", amount: null }], expectedTotal: tot },
    });
    expect(ok.status, JSON.stringify(ok.error)).toBe(201);
  });
  it("casos raros: varias cuentas, descuento y productos movidos; el total que vale es el de cada cuenta en el servidor", async () => {
    const o = await open([PLU.tosta, PLU.croquetas, PLU.redbull]);
    const two = await t.call("POST", `/orders/${o.id}/accounts`, { token: sis, body: {} });
    const a2 = two.body.accounts.find((a: any) => a.id !== o.acc).id as string;
    const ln = (await get(o.id)).accounts[0].lines.find((l: any) => (l.plu ?? l.productId) === PLU.redbull);
    const mv = await t.call("POST", `/orders/${o.id}/lines/move`, {
      token: sis,
      body: { fromAccountId: o.acc, toAccountId: a2, lines: [{ lineId: ln.id, quantity: 1 }], version: (await get(o.id)).version },
    });
    expect([200, 201]).toContain(mv.status);
    const before1 = await total(o.id, o.acc);
    const ds = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 10, reason: "Prueba" },
    });
    expect(ds.status, JSON.stringify(ds.error)).toBeLessThan(300);
    const t1 = await total(o.id, o.acc);
    const t2 = await total(o.id, a2);
    expect(t1).toBeLessThan(before1);
    // la pantalla con el total de antes del descuento (otro equipo lo aplicó) → no se cobra
    expect((await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/checkout`, {
      token: sis, body: { payments: [{ method: "card", amount: null }], expectedTotal: before1 },
    })).status).toBe(409);
    // el total de la otra cuenta tampoco vale para esta
    if (Math.abs(t2 - t1) >= 0.01) {
      expect((await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/checkout`, {
        token: sis, body: { payments: [{ method: "card", amount: null }], expectedTotal: t2 },
      })).status).toBe(409);
    }
    for (const [acc, tt] of [[o.acc, t1], [a2, t2]] as const) {
      const r = await t.call("POST", `/orders/${o.id}/accounts/${acc}/checkout`, {
        token: sis, body: { payments: [{ method: "card", amount: null }], expectedTotal: tt },
      });
      expect(r.status, JSON.stringify(r.error)).toBe(201);
    }
  });
});

describe("descuento con formulario en la factura", () => {
  it("lo rellenado se guarda con el descuento y sale en la factura (no en la precuenta)", async () => {
    const o = await open([PLU.tosta, PLU.croquetas]);
    const r = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 10, reason: "Empleado", formData: [{ label: "DNI", value: "12345678Z" }, { label: "Nombre", value: "Ana Pérez" }] },
    });
    expect(r.status, JSON.stringify(r.error)).toBeLessThan(300);
    const fd = (await t.sql.query("SELECT form_data FROM account_discount WHERE account_id = $1 AND status = 'applied'", [o.acc])).rows[0].form_data;
    expect(fd).toEqual([{ label: "DNI", value: "12345678Z" }, { label: "Nombre", value: "Ana Pérez" }]);
    const j0 = t.printer.jobs.length;
    await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/prebill`, { token: sis, body: {} });
    const pre = t.printer.jobs.slice(j0).map((j) => j.text).join("\n");
    expect(pre).not.toContain("12345678Z");
    const j1 = t.printer.jobs.length;
    const ck = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/checkout`, { token: sis, body: { payments: [{ method: "card", amount: null }] } });
    expect(ck.status, JSON.stringify(ck.error)).toBe(201);
    const inv = t.printer.jobs.slice(j1).map((j) => j.text).join("\n");
    expect(inv).toContain("DNI: 12345678Z");
    expect(inv).toContain("Nombre: Ana Pérez");
    expect((await get(o.id)).accounts[0].discounts.find((d: any) => d.status === "applied")?.formData).toHaveLength(2);
  });
});

describe("abonos en efectivo", () => {
  it("lo devuelto en efectivo sale del cajón: resta de lo esperado (con tarjeta, no)", async () => {
    const o = await open([PLU.tosta]);
    const ck = await t.call("POST", `/orders/${o.id}/accounts/${o.acc}/checkout`, { token: sis, body: { payments: [{ method: "cash", amount: null }], print: false } });
    expect(ck.status, JSON.stringify(ck.error)).toBe(201);
    const a = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const inv = (await t.sql.query("SELECT id::text, total::float8 total FROM invoice WHERE account_id = $1", [o.acc])).rows[0];
    const cr = await t.call("POST", `/invoices/${inv.id}/credit`, { token: sis, body: { reason: "Devolución" } });
    expect(cr.status, JSON.stringify(cr.error)).toBe(201);
    const b = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(b.expectedCash).toBe(Math.round((a.expectedCash - inv.total) * 100) / 100);
    // con tarjeta: el efectivo no cambia
    const o2 = await open([PLU.croquetas]);
    await t.call("POST", `/orders/${o2.id}/accounts/${o2.acc}/checkout`, { token: sis, body: { payments: [{ method: "card", amount: null }], print: false } });
    const c0 = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const inv2 = (await t.sql.query("SELECT id::text FROM invoice WHERE account_id = $1", [o2.acc])).rows[0];
    expect((await t.call("POST", `/invoices/${inv2.id}/credit`, { token: sis, body: { reason: "Devolución" } })).status).toBe(201);
    expect((await t.call("GET", "/cash/summary", { token: sis })).body.expectedCash).toBe(c0.expectedCash);
  });
});

describe("cierre con todas las formas de pago", () => {
  it("guarda lo contado de cada una (con lo del sistema) y sale en el corte Z", async () => {
    // sin mesas abiertas para poder cerrar (como en cierres.test.ts): se cobra lo pendiente o se cierra sin venta
    const { rows } = await t.sql.query("SELECT id FROM orders WHERE status IN ('open','billing')");
    for (const r of rows) {
      const tx = await get(r.id);
      for (const a of tx.accounts.filter((x: any) => x.status === "open" && x.lines.length)) {
        if (a.totals.pending > 0) {
          await t.call("POST", `/orders/${r.id}/accounts/${a.id}/payments`, { token: sis, body: { method: "card", amount: a.totals.pending } });
        }
        await t.call("POST", `/orders/${r.id}/accounts/${a.id}/invoice`, { token: sis });
      }
      const after = await get(r.id);
      if (["open", "billing"].includes(after.status)) {
        for (const l of after.accounts.flatMap((a: any) => a.lines)) {
          await t.call("POST", `/orders/${r.id}/lines/${l.id}/delete`, { token: sis, body: { reason: "Prueba" } });
        }
        await t.call("POST", `/orders/${r.id}/close`, { token: sis, body: { closeReason: "Prueba" } });
      }
    }
    const left = (await t.sql.query("SELECT id, status FROM orders WHERE status IN ('open','billing')")).rows;
    expect(left, JSON.stringify(left)).toHaveLength(0);
    const pid = await ensurePeriod(t, sis);
    const sum = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const j0 = t.printer.jobs.length;
    const c = await t.call("POST", `/periods/${pid}/close`, {
      token: sis,
      body: {
        countedCash: r2(sum.expectedCash + 150),
        countedCard: sum.cardSales,
        nextFloat: 150, // como en cierres.test.ts: las pruebas de apertura que vienen detrás cuentan con ese fondo
        note: "Prueba 1.2.292",
        methods: [
          { method: "cash", name: "Efectivo", counted: 0 },
          { method: "card", name: "Tarjeta", counted: 0 },
          { method: "gourmet", name: "Gourmet", counted: 12.5 },
        ],
      },
    });
    expect(c.status, JSON.stringify(c.error)).toBe(200);
    const md = (await t.sql.query("SELECT method_detail FROM cash_closing WHERE period_id = $1", [pid])).rows[0].method_detail;
    expect(md).toHaveLength(3);
    expect(md[0]).toMatchObject({ method: "cash", counted: r2(sum.expectedCash + 150), expected: sum.expectedCash });
    expect(md[2]).toMatchObject({ method: "gourmet", name: "Gourmet", counted: 12.5, expected: 0 });
    const z = t.printer.jobs.slice(j0).map((j) => j.text).join("\n");
    expect(z).toContain("CONTADO POR FORMA DE PAGO");
    expect(z).toMatch(/Gourmet\s+12,50 €\s+\+12,50 €/);
    await ensurePeriod(t, sis); // deja un periodo abierto para las pruebas que vienen detrás
  });
});
