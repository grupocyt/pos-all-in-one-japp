import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

// Decisión 19 (03/11/2026): anular un cobro parcial mientras la cuenta no está facturada.
let t: T;
let sis: string;
let barra: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  barra = await t.login(PIN.barra);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.close();
});

/** Mesa con dos productos enviados, descuento del 10 % y cliente con factura completa (el caso de las pruebas del 03/11). */
async function mesa() {
  const o = (
    await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })
  ).body;
  const acc = o.accounts[0].id;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta } });
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.croquetas } });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  const d = await t.call("POST", `/orders/${o._id}/accounts/${acc}/discounts`, {
    token: sis,
    body: { type: "percentage", value: 10, reason: "Cliente habitual" },
  });
  await t.call("PUT", `/orders/${o._id}/accounts/${acc}/customer`, {
    token: sis,
    body: { type: "company", taxId: "B12345674", name: "Anular Pruebas SL" },
  });
  const disc = d.body.accounts[0].discounts.find((x: any) => x.status === "applied").id;
  return { id: o._id as string, acc: acc as string, disc: disc as string };
}
const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;

describe("Anular un cobro parcial (POST …/payments/{paymentId}/void)", () => {
  it("con cobros, el descuento no se quita ni se cambia (422) y la mesa no cambia", async () => {
    const m = await mesa();
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, {
      token: barra,
      body: { method: "cash", amount: 2 },
    });
    expect(pay.status, JSON.stringify(pay.env)).toBe(201);
    const v0 = (await get(m.id)).version;
    const rm = await t.call("DELETE", `/orders/${m.id}/accounts/${m.acc}/discounts/${m.disc}`, {
      token: sis,
    });
    expect([rm.status, rm.error.code]).toEqual([422, "VALIDATION"]);
    expect(rm.error.message).toContain("anúlalos");
    const other = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 20, reason: "Otro" },
    });
    expect(other.status).toBe(422);
    expect((await get(m.id)).version).toBe(v0);
  });

  it("anular pide clave de encargado y motivo; después el descuento ya se puede quitar y se cobra de nuevo", async () => {
    const m = await mesa();
    const before = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, {
      token: barra,
      body: { method: "cash", amount: 2 },
    });
    const pid = pay.body.payment.id;
    // 1.2.283 · /cash/summary → byPayment: el cobro en efectivo suma en su forma de pago
    const mid = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const cashOf = (b: { byPayment?: { kind: string; amount: number }[] }) =>
      (b.byPayment ?? []).filter((x) => x.kind === "cash").reduce((a, x) => a + x.amount, 0);
    expect(Array.isArray(mid.byPayment)).toBe(true);
    expect(Math.round((cashOf(mid) - cashOf(before)) * 100) / 100).toBe(2);
    // el cajero no tiene sistema.autorizar
    const no = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments/${pid}/void`, {
      token: barra,
      body: { reason: "Era con tarjeta" },
    });
    expect([no.status, no.error.code, no.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "sistema.autorizar",
    ]);
    const auth = (
      await t.call("POST", "/sessions/authorize", {
        token: barra,
        body: { pin: PIN.sistemas, permission: "sistema.autorizar" },
      })
    ).body.authorization.token;
    const noReason = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments/${pid}/void`, {
      token: barra,
      body: { reason: " ", authorization: auth },
    });
    expect(noReason.status).toBe(422);
    const auth2 = (
      await t.call("POST", "/sessions/authorize", {
        token: barra,
        body: { pin: PIN.sistemas, permission: "sistema.autorizar" },
      })
    ).body.authorization.token;
    const ok = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments/${pid}/void`, {
      token: barra,
      body: { reason: "Era con tarjeta", authorization: auth2 },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body).toMatchObject({ payment: { id: pid, status: "cancelled", amount: 2 }, refund: "cash" });
    expect(ok.body.totals.paid).toBe(0);
    expect(ok.body.totals.pending).toBe(ok.body.totals.total);
    // en la base: el cobro sigue, anulado; queda en el historial con el motivo y quién autorizó
    const row = (await t.sql.query("SELECT status FROM payment WHERE id = $1", [pid])).rows[0];
    expect(row.status).toBe("cancelled");
    const ev = (
      await t.sql.query(
        "SELECT description, user_name FROM order_event WHERE order_id = $1 AND type = 'paymentVoided'",
        [m.id],
      )
    ).rows[0];
    expect(ev.description).toContain("Era con tarjeta");
    expect(ev.description).toContain("autoriza Sistemas");
    expect(ev.user_name).toBe("Barra");
    // la caja no cuenta el cobro anulado
    const after = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(after.expectedCash).toBe(before.expectedCash);
    // repetir → 409
    const again = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments/${pid}/void`, {
      token: sis,
      body: { reason: "Otra vez" },
    });
    expect([again.status, again.error.code]).toEqual([409, "INVALID_TRANSITION"]);
    // ya sin cobros: el descuento se puede quitar, y se cobra todo con tarjeta y se factura
    const rm = await t.call("DELETE", `/orders/${m.id}/accounts/${m.acc}/discounts/${m.disc}`, {
      token: sis,
    });
    expect(rm.status, JSON.stringify(rm.env)).toBe(200);
    const pend = (await get(m.id)).accounts[0].totals.pending;
    const card = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, {
      token: barra,
      body: { method: "card" },
    });
    expect(card.status, JSON.stringify(card.env)).toBe(201);
    expect(card.body.totals).toMatchObject({ paid: pend, pending: 0 });
    const inv = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/invoice`, { token: barra, body: {} });
    expect(inv.status, JSON.stringify(inv.env)).toBe(201);
    // facturada: ya no se anula (abono)
    const late = await t.call(
      "POST",
      `/orders/${m.id}/accounts/${m.acc}/payments/${card.body.payment.id}/void`,
      {
        token: sis,
        body: { reason: "Tarde" },
      },
    );
    // con la cuenta facturada (y aquí la mesa ya cerrada): 409 ACCOUNT_CLOSED u ORDER_CLOSED
    expect(late.status).toBe(409);
    expect(["ACCOUNT_CLOSED", "ORDER_CLOSED"]).toContain(late.error.code);
  });

  it("con tarjeta avisa de la devolución en el datáfono; un cobro de otra cuenta → 404", async () => {
    const m = await mesa();
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, {
      token: sis,
      body: { method: "card", amount: 3 },
    });
    const r = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments/${pay.body.payment.id}/void`, {
      token: sis,
      body: { reason: "Tarjeta equivocada" },
    });
    expect(r.body.refund).toBe("card-terminal");
    const ev = (
      await t.sql.query(
        "SELECT description FROM order_event WHERE order_id = $1 AND type = 'paymentVoided'",
        [m.id],
      )
    ).rows[0];
    expect(ev.description).toContain("datáfono");
    const ghost = await t.call(
      "POST",
      `/orders/${m.id}/accounts/${m.acc}/payments/${crypto.randomUUID()}/void`,
      {
        token: sis,
        body: { reason: "No existe" },
      },
    );
    expect(ghost.status).toBe(404);
  });
});
