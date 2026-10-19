import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/** Una persona por mesa (decidido 15/10/2026): POST /orders/{id}/presence y la guardia de los comandos. */
let t: T;
let mesero: string;
let barra: string;
let sis: string;
let jeison: string;
const CAJA3 = "c3c3c3c3-0000-4000-8000-000000000003";
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  jeison = await t.login(PIN.jeison);
  mesero = await t.login(PIN.mesero);
  barra = await t.login(PIN.barra);
  await ensurePeriod(t, sis);
  const {
    rows: [st],
  } = await t.sql.query("SELECT store_id FROM station WHERE name='CAJA1'");
  await t.sql.query(
    "INSERT INTO station (id, store_id, name, kind, active) VALUES ($1, $2, 'CAJA3', 'station', true) ON CONFLICT DO NOTHING",
    [CAJA3, st.store_id],
  );
});
afterAll(async () => {
  // el reloj de estas pruebas va adelantado: se suelta la presencia para que las demás pruebas encuentren las mesas libres de dueño
  await t.sql.query(
    "UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL",
  );
  await t.sql.query("UPDATE station SET active = false WHERE id = $1", [CAJA3]);
  await t.close();
});

const presence = (tok: string, orderId: string, action: string) =>
  t.call("POST", `/orders/${orderId}/presence`, { token: tok, body: { action } });
async function openTable(tok = mesero) {
  const o = await t.call("POST", "/orders", {
    token: tok,
    body: { tableId: await freeTable(t, "BARRA"), guests: 2 },
  });
  await t.call("POST", `/orders/${o.body._id}/lines`, { token: tok, body: { plu: PLU.tosta } });
  return {
    orderId: o.body._id as string,
    accountId: o.body.accounts[0].id as string,
    tableId: o.body.tableData.tableId as string,
  };
}
const version = async (orderId: string) =>
  (await t.call("GET", `/orders/${orderId}`, { token: sis })).body.version as number;

describe("una persona por mesa", () => {
  let o: Awaited<ReturnType<typeof openTable>>;
  it("entrar: la mesa es de quien entra 30 s; el plano lo muestra", async () => {
    o = await openTable();
    const r = await presence(mesero, o.orderId, "enter");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      holder: { userName: "Mesero", stationName: "CAJA1" },
      charging: false,
      youHold: true,
    });
    expect(Date.parse(r.body.holder.until) - t.clock.now.getTime()).toBe(30_000);
    const table = (await t.call("GET", "/tables", { token: barra })).body.items.find(
      (x: any) => x.orderId === o.orderId,
    );
    expect(table).toMatchObject({ holder: { userName: "Mesero", stationName: "CAJA1" }, charging: false });
  });

  it("otra persona sin mesas.entrarOcupada → 409 TABLE_TAKEN «Mesa ocupada por Mesero · CAJA1»", async () => {
    const r = await presence(barra, o.orderId, "enter");
    expect([r.status, r.error.code, r.error.message]).toEqual([
      409,
      "TABLE_TAKEN",
      "Mesa ocupada por Mesero · CAJA1",
    ]);
    expect(r.error.details.holder).toMatchObject({
      userName: "Mesero",
      stationName: "CAJA1",
      until: expect.any(String),
    });
  });

  it("quien no tiene la mesa solo puede Guardar (añadir y enviar); el resto → 409 TABLE_TAKEN", async () => {
    expect(
      (await t.call("POST", `/orders/${o.orderId}/lines`, { token: barra, body: { plu: PLU.croquetas } }))
        .status,
    ).toBe(201);
    expect((await t.call("POST", `/orders/${o.orderId}/send`, { token: barra, body: {} })).status).toBe(200);
    const p = await t.call("PATCH", `/orders/${o.orderId}`, { token: barra, body: { guests: 4 } });
    expect([p.status, p.error.code]).toEqual([409, "TABLE_TAKEN"]);
    expect(
      (
        await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/payments`, {
          token: barra,
          body: { method: "card", amount: 1 },
        })
      ).error.code,
    ).toBe("TABLE_TAKEN");
    expect(
      (
        await t.call("POST", `/orders/${o.orderId}/accounts/${o.accountId}/prebill`, {
          token: barra,
          body: {},
        })
      ).error.code,
    ).toBe("TABLE_TAKEN");
    // quien la tiene sí, y cada comando le renueva el plazo
    t.clock.now = new Date(t.clock.now.getTime() + 20_000);
    expect(
      (await t.call("PATCH", `/orders/${o.orderId}`, { token: mesero, body: { guests: 3 } })).status,
    ).toBe(200);
    const until = (await t.sql.query("SELECT holder_until FROM orders WHERE id=$1", [o.orderId])).rows[0]
      .holder_until;
    expect(new Date(until).getTime() - t.clock.now.getTime()).toBe(30_000);
  });

  it("con mesas.entrarOcupada (Sistemas) se entra; el anterior pasa a solo guardar y queda en el historial", async () => {
    const r = await presence(sis, o.orderId, "enter");
    expect(r.body).toMatchObject({ holder: { userName: "Sistemas" }, youHold: true });
    const ev = (await t.call("GET", `/orders/${o.orderId}/events`, { token: sis })).body.items;
    expect(ev.map((e: any) => e.description)).toContain(
      "Sistemas entra en la mesa; Mesero pasa a solo guardar",
    );
    expect(
      (await t.call("POST", `/orders/${o.orderId}/lines`, { token: mesero, body: { plu: PLU.redbull } }))
        .status,
    ).toBe(201);
    expect(
      (await t.call("PATCH", `/orders/${o.orderId}`, { token: mesero, body: { guests: 5 } })).error.code,
    ).toBe("TABLE_TAKEN");
    expect((await presence(mesero, o.orderId, "renew")).error.code).toBe("TABLE_TAKEN"); // renovando no se recupera
    expect((await presence(mesero, o.orderId, "enter")).error.code).toBe("TABLE_TAKEN");
  });

  it("mientras se cobra nadie entra, ni un administrador (409 TABLE_CHARGING); el cobro que deja la cuenta a 0 lo cierra", async () => {
    const c = await presence(sis, o.orderId, "charging");
    expect(c.body).toMatchObject({ charging: true, youHold: true });
    const j = await presence(jeison, o.orderId, "enter");
    expect([j.status, j.error.code, j.error.message]).toEqual([
      409,
      "TABLE_CHARGING",
      "Se está cobrando esta mesa",
    ]);
    expect(
      (await t.call("GET", "/tables", { token: barra })).body.items.find((x: any) => x.orderId === o.orderId)
        .charging,
    ).toBe(true);
    const acc = (await t.call("GET", `/orders/${o.orderId}`, { token: sis })).body.accounts[0];
    expect(
      (
        await t.call("POST", `/orders/${o.orderId}/accounts/${acc.id}/payments`, {
          token: sis,
          body: { method: "card", amount: null },
        })
      ).status,
    ).toBe(201);
    expect(
      (await t.call("GET", "/tables", { token: barra })).body.items.find((x: any) => x.orderId === o.orderId)
        .charging,
    ).toBe(false);
    const inv = await t.call("POST", `/orders/${o.orderId}/accounts/${acc.id}/invoice`, {
      token: sis,
      body: {},
    });
    expect(inv.status).toBe(201);
    // el equipo desplazado, al volver, ve con GET /orders/{id} que la mesa se cobró y cerró en otro sitio
    const back = (await t.call("GET", `/orders/${o.orderId}`, { token: mesero })).body;
    expect([back.status, back.accounts[0].status, back.accounts[0].invoice.invoiceNumber]).toEqual([
      "closed",
      "invoiced",
      inv.body.invoice.invoiceNumber,
    ]);
    expect((await presence(mesero, o.orderId, "enter")).error.code).toBe("ORDER_CLOSED");
  });
});

describe("plazo, salir y la misma persona en otro equipo", () => {
  it("pasados 30 s sin renovar la mesa queda libre y todo vuelve a ser como siempre", async () => {
    const o = await openTable();
    await presence(mesero, o.orderId, "enter");
    expect(
      (await t.call("PATCH", `/orders/${o.orderId}`, { token: barra, body: { guests: 4 } })).error.code,
    ).toBe("TABLE_TAKEN");
    t.clock.now = new Date(t.clock.now.getTime() + 31_000);
    expect(
      (await t.call("PATCH", `/orders/${o.orderId}`, { token: barra, body: { guests: 4 } })).status,
    ).toBe(200);
    expect(
      (await t.call("GET", "/tables", { token: barra })).body.items.find((x: any) => x.orderId === o.orderId)
        .holder,
    ).toBeNull();
  });

  it("el mismo usuario en otro equipo es otra persona; al entrar con su clave allí, la mesa del equipo anterior queda libre", async () => {
    const o = await openTable();
    await presence(mesero, o.orderId, "enter");
    // Mesero entra con su clave en CAJA3: su sesión de CAJA1 queda sustituida y la mesa, libre (con su evento)
    const otro = await t.login(PIN.mesero, "CAJA3");
    const old = await t.call("PATCH", `/orders/${o.orderId}`, { token: mesero, body: { guests: 4 } });
    expect([old.status, old.error.code, old.error.details]).toEqual([
      401,
      "SESSION_REPLACED",
      { station: "CAJA3" },
    ]);
    expect(
      (await t.call("GET", "/tables", { token: otro })).body.items.find((x: any) => x.orderId === o.orderId)
        .holder,
    ).toBeNull();
    expect(
      (await t.call("GET", `/orders/${o.orderId}/events`, { token: sis })).body.items.map(
        (e: any) => e.description,
      ),
    ).toContain("Mesero ha entrado en CAJA3; sale de la mesa");
    // el mismo usuario con la mesa viva en otro equipo (p. ej. tras reiniciar la API) cuenta como otra persona
    await t.sql.query(
      "UPDATE orders o SET holder_user_id = u.id, holder_user_name = u.name, holder_station_id = s.id, holder_station_name = s.name, holder_until = $2 FROM app_user u, station s WHERE o.id = $1 AND u.name = 'Mesero' AND s.name = 'CAJA1'",
      [o.orderId, new Date(t.clock.now.getTime() + 30_000).toISOString()],
    );
    expect((await presence(otro, o.orderId, "enter")).error).toMatchObject({
      code: "TABLE_TAKEN",
      message: "Mesa ocupada por Mesero · CAJA1",
    });
    expect(
      (await t.call("PATCH", `/orders/${o.orderId}`, { token: otro, body: { guests: 4 } })).error.code,
    ).toBe("TABLE_TAKEN");
    await t.sql.query("UPDATE orders SET holder_until = $2 WHERE id = $1", [
      o.orderId,
      new Date(t.clock.now.getTime() - 1000).toISOString(),
    ]);
    const e = await presence(otro, o.orderId, "enter");
    expect(e.body).toMatchObject({ holder: { userName: "Mesero", stationName: "CAJA3" }, youHold: true });
    expect((await t.call("PATCH", `/orders/${o.orderId}`, { token: otro, body: { guests: 4 } })).status).toBe(
      200,
    );
    // salir: la mesa queda libre
    const l = await presence(otro, o.orderId, "leave");
    expect(l.body).toEqual({ holder: null, charging: false, youHold: false });
    expect(
      (await t.call("PATCH", `/orders/${o.orderId}`, { token: barra, body: { guests: 2 } })).status,
    ).toBe(200);
    // volver a entrar en el mismo equipo (desbloqueo) solo renueva la sesión
    mesero = await t.login(PIN.mesero);
    expect((await t.call("GET", "/sessions/current", { token: otro })).error.code).toBe("SESSION_REPLACED");
    expect((await t.call("GET", "/sessions/current", { token: mesero })).status).toBe(200);
  });

  it("entrar y renovar no cambian la versión de la orden; acción no válida → 422; orden de otra tienda o inexistente → 404", async () => {
    const o = await openTable();
    const v = await version(o.orderId);
    await presence(mesero, o.orderId, "enter");
    await presence(mesero, o.orderId, "renew");
    await presence(mesero, o.orderId, "charging");
    await presence(mesero, o.orderId, "chargingEnd");
    expect(await version(o.orderId)).toBe(v);
    expect((await presence(mesero, o.orderId, "volar")).status).toBe(422);
    expect((await presence(mesero, crypto.randomUUID(), "enter")).status).toBe(404);
  });
});
