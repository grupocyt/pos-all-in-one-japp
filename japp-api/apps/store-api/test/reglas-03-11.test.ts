import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Reglas del 03/11/2026 (API 1.2.268): una cuenta con descuento o con un cobro parcial queda CONGELADA (ya se está cobrando).
 * Por cuenta, no por mesa. Para seguir: «Liberar la cuenta y continuar» (POST …/accounts/{id}/release).
 */
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

const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
const code = (r: any) => [r.status, r.error?.code];

/** Mesa con Cuenta 1 (tosta enviada + croquetas por enviar) y Cuenta 2 (tosta enviada). */
async function mesa() {
  const o = (
    await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })
  ).body;
  const a1 = o.accounts[0].id as string;
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
  const a2 = (await t.call("POST", `/orders/${o._id}/accounts`, { token: sis, body: {} })).body.accounts[1]
    .id as string;
  await t.call("POST", `/orders/${o._id}/lines`, {
    token: sis,
    body: { plu: PLU.tosta, accountId: a2, force: true },
  });
  await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
  await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.croquetas, force: true } });
  const ord = await get(o._id);
  const acc1 = ord.accounts.find((a: any) => a.id === a1);
  const sent = acc1.lines.find((l: any) => l.status !== "pendingPrint").id as string;
  const unsent = acc1.lines.find((l: any) => l.status === "pendingPrint").id as string;
  return { id: o._id as string, a1, a2, sent, unsent };
}

describe("cuenta congelada con descuento o cobro parcial (409 ACCOUNT_LOCKED)", () => {
  it("solo con descuento: no se tica, ni se cambia, ni se elimina (tampoco lo por enviar); la otra cuenta sigue libre", async () => {
    const m = await mesa();
    const d = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 10, reason: "Cliente habitual" },
    });
    expect(d.status, JSON.stringify(d.env)).toBe(201);
    const v = (await get(m.id)).version;
    const add = await t.call("POST", `/orders/${m.id}/lines`, {
      token: sis,
      body: { plu: PLU.redbull, accountId: m.a1 },
    });
    expect(code(add)).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(add.error.details).toMatchObject({
      accountId: m.a1,
      action: "añadir productos",
      discount: { reason: "Cliente habitual" },
    });
    expect(
      code(await t.call("PATCH", `/orders/${m.id}/lines/${m.unsent}`, { token: sis, body: { quantity: 2 } })),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(
      code(
        await t.call("PATCH", `/orders/${m.id}/lines/${m.unsent}`, {
          token: sis,
          body: { comment: "sin sal" },
        }),
      ),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(
      code(await t.call("POST", `/orders/${m.id}/lines/${m.unsent}/delete`, { token: sis, body: {} })),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect(
      code(
        await t.call("POST", `/orders/${m.id}/lines/${m.sent}/delete`, {
          token: sis,
          body: { reason: "Invitación" },
        }),
      ),
    ).toEqual([409, "ACCOUNT_LOCKED"]);
    expect((await get(m.id)).version).toBe(v);
    // la Cuenta 2 no tiene nada: sigue libre
    const free = await t.call("POST", `/orders/${m.id}/lines`, {
      token: sis,
      body: { plu: PLU.redbull, accountId: m.a2 },
    });
    expect(free.status, JSON.stringify(free.env)).toBe(201);
    // quitado el descuento (no hay cobros), se vuelve a ticar
    const disc = d.body.accounts
      .find((a: any) => a.id === m.a1)
      .discounts.find((x: any) => x.status === "applied").id;
    expect(
      (await t.call("DELETE", `/orders/${m.id}/accounts/${m.a1}/discounts/${disc}`, { token: sis })).status,
    ).toBe(200);
    expect(
      (
        await t.call("POST", `/orders/${m.id}/lines`, {
          token: sis,
          body: { plu: PLU.redbull, accountId: m.a1 },
        })
      ).status,
    ).toBe(201);
  });

  it("con cobro parcial: no se pasan productos a ni desde ella, ni se pasa la cuenta ni se cambia la mesa; sí cliente y cobrar lo que falta", async () => {
    const m = await mesa();
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments`, {
      token: barra,
      body: { method: "cash", amount: 2 },
    });
    expect(pay.status, JSON.stringify(pay.env)).toBe(201);
    let v = (await get(m.id)).version;
    const out = await t.call("POST", `/orders/${m.id}/lines/move`, {
      token: sis,
      body: { lines: [{ lineId: m.sent, quantity: 1 }], toAccountId: m.a2 },
    });
    expect(code(out)).toEqual([409, "ACCOUNT_LOCKED"]);
    const c2 = (await get(m.id)).accounts.find((a: any) => a.id === m.a2).lines[0].id;
    const into = await t.call("POST", `/orders/${m.id}/lines/move`, {
      token: sis,
      body: { lines: [{ lineId: c2, quantity: 1 }], toAccountId: m.a1 },
    });
    expect(code(into)).toEqual([409, "ACCOUNT_LOCKED"]);
    const acc = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/transfer`, {
      token: sis,
      body: { toTableId: await freeTable(t, "BARRA"), version: v },
    });
    expect(code(acc)).toEqual([409, "ACCOUNT_LOCKED"]);
    const tbl = await t.call("POST", `/orders/${m.id}/transfer`, {
      token: sis,
      body: { scope: "table", toTableId: await freeTable(t, "BARRA"), version: v },
    });
    expect(code(tbl)).toEqual([409, "ACCOUNT_LOCKED"]);
    expect((await get(m.id)).version).toBe(v);
    // la Cuenta 2 sí se pasa a otra mesa
    const ok2 = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/transfer`, {
      token: sis,
      body: { toTableId: await freeTable(t, "BARRA"), version: v },
    });
    expect(ok2.status, JSON.stringify(ok2.env)).toBe(200);
    // datos de cliente sí (es parte del cobro)
    const cust = await t.call("PUT", `/orders/${m.id}/accounts/${m.a1}/customer`, {
      token: sis,
      body: { type: "company", taxId: "B12345674", name: "Reglas SL" },
    });
    expect(cust.status, JSON.stringify(cust.env)).toBe(200);
    // y cobrar lo que falta (lo por enviar se envía antes)
    await t.call("POST", `/orders/${m.id}/send`, { token: sis, body: {} });
    v = (await get(m.id)).version;
    const rest = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments`, {
      token: barra,
      body: { method: "card" },
    });
    expect(rest.status, JSON.stringify(rest.env)).toBe(201);
    expect(rest.body.totals.pending).toBe(0);
  });

  it("un descuento no puede dejar la cuenta a 0 € → 422 VALIDATION field value", async () => {
    const m = await mesa();
    const all = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/discounts`, {
      token: sis,
      body: { type: "percentage", value: 100, reason: "Invitar" },
    });
    expect([all.status, all.error.code, all.error.field]).toEqual([422, "VALIDATION", "value"]);
    expect(all.error.message).toContain("Invitación");
    const total = (await get(m.id)).accounts.find((a: any) => a.id === m.a2).totals.total;
    const fixed = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/discounts`, {
      token: sis,
      body: { type: "fixed", value: total, reason: "Invitar" },
    });
    expect(fixed.status).toBe(422);
  });
});

describe("POST …/accounts/{accountId}/release · Liberar la cuenta y continuar", () => {
  it("anula todos los cobros y quita el descuento en una operación, con motivo y clave de encargado; después se tica", async () => {
    const m = await mesa();
    await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/discounts`, {
      token: sis,
      body: { type: "fixed", value: 1, reason: "Cliente habitual" },
    });
    await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments`, {
      token: barra,
      body: { method: "cash", amount: 2 },
    });
    await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/payments`, {
      token: barra,
      body: { method: "card", amount: 3 },
    });
    const before = (await t.call("GET", "/cash/summary", { token: sis })).body;
    // el cajero no tiene sistema.autorizar
    const no = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/release`, {
      token: barra,
      body: { reason: "Cambian de mesa" },
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
    const noReason = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/release`, {
      token: barra,
      body: { reason: "", authorization: auth },
    });
    expect(noReason.status).toBe(422);
    const auth2 = (
      await t.call("POST", "/sessions/authorize", {
        token: barra,
        body: { pin: PIN.sistemas, permission: "sistema.autorizar" },
      })
    ).body.authorization.token;
    const r = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/release`, {
      token: barra,
      body: { reason: "Cambian de mesa", authorization: auth2 },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.voided.map((p: any) => p.amount).sort()).toEqual([2, 3]);
    expect(r.body.discountRemoved).toBe("Cliente habitual");
    expect(r.body.refund).toEqual({ cash: 2, card: 3, other: 0 });
    expect(r.body.totals.paid).toBe(0);
    // en la base y el historial: cobros cancelled, descuento removed, quién autorizó
    const pays = (await t.sql.query("SELECT status FROM payment WHERE account_id = $1", [m.a1])).rows.map(
      (x: any) => x.status,
    );
    expect(pays).toEqual(["cancelled", "cancelled"]);
    const evs = (
      await t.sql.query(
        "SELECT type, description FROM order_event WHERE order_id = $1 AND type IN ('paymentVoided','discountRemoved')",
        [m.id],
      )
    ).rows;
    expect(evs.filter((e: any) => e.type === "paymentVoided")).toHaveLength(2);
    expect(evs.some((e: any) => e.type === "discountRemoved")).toBe(true);
    expect(evs.every((e: any) => e.description.includes("Cambian de mesa"))).toBe(true);
    expect((await t.call("GET", "/cash/summary", { token: sis })).body.expectedCash).toBe(
      before.expectedCash - 2,
    );
    // libre: se tica y se cambia de mesa; nada se vuelve a poner solo
    expect(
      (
        await t.call("POST", `/orders/${m.id}/lines`, {
          token: sis,
          body: { plu: PLU.redbull, accountId: m.a1 },
        })
      ).status,
    ).toBe(201);
    const acc = (await get(m.id)).accounts.find((a: any) => a.id === m.a1);
    expect(acc.discounts.filter((d: any) => d.status === "applied")).toHaveLength(0);
    // otra vez: ya no hay nada que liberar
    const again = await t.call("POST", `/orders/${m.id}/accounts/${m.a1}/release`, {
      token: sis,
      body: { reason: "Otra vez" },
    });
    expect(code(again)).toEqual([422, "VALIDATION"]);
  });

  it("cuenta facturada → 409 (abono); no existe → 404", async () => {
    const m = await mesa();
    await t.call("POST", `/orders/${m.id}/send`, { token: sis, body: {} });
    await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/payments`, {
      token: sis,
      body: { method: "card" },
    });
    const inv = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/invoice`, { token: sis, body: {} });
    expect(inv.status, JSON.stringify(inv.env)).toBe(201);
    const late = await t.call("POST", `/orders/${m.id}/accounts/${m.a2}/release`, {
      token: sis,
      body: { reason: "Tarde" },
    });
    expect(late.status).toBe(409);
    expect(["ACCOUNT_CLOSED", "ORDER_CLOSED"]).toContain(late.error.code);
    const ghost = await t.call("POST", `/orders/${m.id}/accounts/${crypto.randomUUID()}/release`, {
      token: sis,
      body: { reason: "No existe" },
    });
    expect(ghost.status).toBe(404);
  });
});
