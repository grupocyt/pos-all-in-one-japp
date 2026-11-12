import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Pruebas de la 1.2.268 en JC01 («POS PRUEBAS V. 1.2.268»), aprobado el 11/11/2026 (API 1.2.269, migración 0033):
 * A2 código de forma de pago · D1 formas de pago de descuento en Cobrar · A3 descuentos por perfil · A4 nombre del cliente
 * (fast food) · A5 calificativos por categoría · A7 mesa entera eliminada con motivo · A8 local en la comanda ·
 * A10 observaciones de días anteriores · D2 arqueo con datáfonos, resumen impreso, ingresos y fondo del día siguiente.
 */
let t: T;
let sis: string;
let barra: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  barra = await t.login(PIN.barra);
  mesero = await t.login(PIN.mesero);
  await ensurePeriod(t, sis);
});
afterAll(async () => {
  await t.close();
});
const code = (r: any) => [r.status, r.error?.code];
const textOf = (lines: any[]) =>
  lines
    .filter((l) => l.k === "text")
    .map((l) => l.text)
    .join("\n");
async function mesa(tok = sis, plu: number = PLU.tosta) {
  const o = (
    await t.call("POST", "/orders", { token: tok, body: { tableId: await freeTable(t, "BARRA"), guests: 2 } })
  ).body;
  await t.call("POST", `/orders/${o._id}/lines`, { token: tok, body: { plu, force: true } });
  await t.call("POST", `/orders/${o._id}/send`, { token: tok, body: {} });
  return { id: o._id as string, acc: o.accounts[0].id as string };
}
const profileOf = async (name: string) =>
  (
    await t.sql.query(
      "SELECT p.code FROM app_user u JOIN user_profile p ON p.id = u.profile_id WHERE u.name = $1",
      [name],
    )
  ).rows[0]?.code as string;

describe("A2 · D1 · formas de pago", () => {
  it("el código se pasa a minúsculas («Influ» → «influ»); de más de 20 caracteres → 422", async () => {
    const ok = await t.call("POST", "/config/formas-pago", {
      token: sis,
      body: { code: "Influ", name: "Influ", kind: "discount", showInTpv: true },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(201);
    expect(ok.body.item.code).toBe("influ");
    // las cajas de pruebas tienen sus formas de pago: se le añade (en el TPV, Ajustes › Equipos)
    await t.sql.query(
      `INSERT INTO station_payment_method (station_id, payment_method_id, store_id)
         SELECT sp.station_id, $1, sp.store_id FROM (SELECT DISTINCT station_id, store_id FROM station_payment_method) sp
       ON CONFLICT DO NOTHING`,
      [ok.body.id],
    );
    const long = await t.call("POST", "/config/formas-pago", {
      token: sis,
      body: { code: "0f8c2a1e-5b7d-4c3a-9e2f-1a2b3c4d5e6f", name: "Larga", kind: "platform" },
    });
    expect([long.status, long.error.field]).toEqual([422, "code"]);
  });

  it("una de tipo descuento sale en Cobrar: cierra la cuenta sin dinero, sin propina ni cajón", async () => {
    const m = await mesa();
    const tip = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, {
      token: sis,
      body: { method: "influ", tip: 1 },
    });
    expect([tip.status, tip.error.field], JSON.stringify(tip.env)).toEqual([422, "tip"]);
    const n = t.printer.jobs.length;
    const co = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, {
      token: sis,
      body: { payments: [{ method: "influ", amount: null }] },
    });
    expect(co.status, JSON.stringify(co.env)).toBe(201);
    const pays = (await t.sql.query("SELECT method FROM payment WHERE account_id = $1", [m.acc])).rows;
    expect(pays.map((p: any) => p.method)).toEqual(["influ"]);
    expect(t.printer.jobs.slice(n).some((j: any) => j.openDrawer)).toBe(false);
    // «no mostrar en el TPV» sigue sin cobrarse
    await t.sql.query("UPDATE payment_method SET show_in_tpv = FALSE WHERE code = 'influ'");
    const m2 = await mesa();
    const no = await t.call("POST", `/orders/${m2.id}/accounts/${m2.acc}/payments`, {
      token: sis,
      body: { method: "influ" },
    });
    expect(code(no)).toEqual([409, "METHOD_NOT_ALLOWED"]);
    await t.sql.query("UPDATE payment_method SET show_in_tpv = TRUE WHERE code = 'influ'");
  });
});

describe("A3 · descuentos por perfil", () => {
  it("un perfil que no está en la lista no lo aplica sin la clave de quien pueda; [] = todos", async () => {
    const barraProfile = await profileOf("Barra");
    const d = await t.call("POST", "/config/descuentos", {
      token: sis,
      body: { name: "Solo admin 268", percent: 10, profiles: ["ADMIN"] },
    });
    expect(d.status, JSON.stringify(d.env)).toBe(201);
    expect(d.body.item.profiles).toEqual(["ADMIN"]);
    const bad = await t.call("POST", "/config/descuentos", {
      token: sis,
      body: { name: "Mal", percent: 10, profiles: ["cajero raro"] },
    });
    expect(bad.status).toBe(422);
    expect(bad.error.field).toMatch(/^profiles/);
    const m = await mesa(barra);
    const r = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/discounts`, {
      token: barra,
      body: { discountId: d.body.id },
    });
    if (barraProfile !== "ADMIN") {
      expect(code(r)).toEqual([403, "PERMISSION_REQUIRED"]);
      const auth = (
        await t.call("POST", "/sessions/authorize", {
          token: barra,
          body: { pin: PIN.sistemas, permission: "cobro.descuentos" },
        })
      ).body.authorization.token;
      const ok = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/discounts`, {
        token: barra,
        body: { discountId: d.body.id, authorization: auth },
      });
      expect(ok.status, JSON.stringify(ok.env)).toBe(201);
    }
    // se cobra para no dejar la mesa abierta (en cobro, a nombre de Barra)
    const co = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, {
      token: barra,
      body: { payments: [{ method: "card", amount: null }] },
    });
    expect(co.status, JSON.stringify(co.env)).toBe(201);
    // con la lista vacía lo aplica cualquiera que tenga cobro.descuentos
    const todos = await t.call("POST", "/config/descuentos", {
      token: sis,
      body: { name: "Todos 268", percent: 5 },
    });
    expect(todos.body.item.profiles).toEqual([]);
    const m2 = await mesa(sis);
    const ok2 = await t.call("POST", `/orders/${m2.id}/accounts/${m2.acc}/discounts`, {
      token: sis,
      body: { discountId: todos.body.id },
    });
    expect(ok2.status, JSON.stringify(ok2.env)).toBe(201);
    await t.call("POST", `/orders/${m2.id}/accounts/${m2.acc}/checkout`, {
      token: sis,
      body: { payments: [{ method: "card", amount: null }] },
    });
  });
});

describe("A4 · A8 · nombre del cliente y local en la comanda", () => {
  it("customerName en la mesa, grande en la comanda y en la precuenta; la comanda dice el local", async () => {
    const o = (
      await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 1 } })
    ).body;
    const p = await t.call("PATCH", `/orders/${o._id}`, { token: sis, body: { customerName: "  Lucía " } });
    expect(p.status, JSON.stringify(p.env)).toBe(200);
    expect(p.body.tableData.customerName).toBe("Lucía");
    expect(p.body.events.some((e: any) => e.type === "customerNamed")).toBe(true);
    await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.redbull, force: true } });
    const n = t.printer.jobs.length;
    await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
    const k = t.printer.jobs.slice(n).find((j: any) => j.kind === "kitchen")!;
    expect(k.text).toContain("LUCÍA");
    const st = (await t.sql.query("SELECT code, name FROM store LIMIT 1")).rows[0];
    expect(k.text.split("\n")[0].trim()).toBe(`${st.code} · ${st.name}`);
    const pre = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/prebill`, { token: sis, body: {} });
    expect(pre.status, JSON.stringify(pre.env)).toBe(200);
    const pj = t.printer.jobs.at(-1)!;
    expect(pj.text).toContain("Cliente: Lucía");
    // sin nombre
    const q = await t.call("PATCH", `/orders/${o._id}`, { token: sis, body: { customerName: "" } });
    expect(q.body.tableData.customerName).toBeNull();
  });
});

describe("A5 · calificativos por categoría", () => {
  it("la categoría guarda los PLU de sus calificativos ([] = todos)", async () => {
    const cats = (await t.call("GET", "/config/categorias", { token: sis })).body.items;
    const c = cats[0];
    expect(c.qualifiers).toEqual([]);
    const r = await t.call("PATCH", `/config/categorias/${c.id}`, {
      token: sis,
      body: { qualifiers: [PLU.tosta], version: c.version },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.item.qualifiers).toEqual([PLU.tosta]);
  });
});

describe("A7 · mesa entera eliminada", () => {
  it("se eliminó todo lo enviado: cerrar pide el motivo y sale en Eliminaciones › Mesas enteras", async () => {
    const m = await mesa();
    const tx = (await t.call("GET", `/orders/${m.id}`, { token: sis })).body;
    await t.call("POST", `/orders/${m.id}/lines/${tx.accounts[0].lines[0].id}/delete`, {
      token: sis,
      body: { reason: "Error al marcar" },
    });
    const no = await t.call("POST", `/orders/${m.id}/close`, { token: sis, body: {} });
    expect([no.status, no.error.field]).toEqual([422, "closeReason"]);
    expect(no.error.details.lines).toBe(1);
    expect(no.error.details.amount).toBeGreaterThan(0);
    const ok = await t.call("POST", `/orders/${m.id}/close`, {
      token: sis,
      body: { closeReason: "El cliente se fue sin consumir" },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body.status).toBe("cancelled");
    expect(ok.body.tableData.voidClose).toMatchObject({ reason: "El cliente se fue sin consumir", lines: 1, user: "Sistemas" });
    const rep = await t.call("GET", "/reports/deletions", { token: sis });
    const row = rep.body.tables.find((x: any) => x.orderId === m.id);
    expect(row).toMatchObject({ reason: "El cliente se fue sin consumir", lines: 1, user: "Sistemas" });
    expect(row.amount).toBeGreaterThan(0);
  });

  it("Guardar y salir también lo pide; una mesa abierta por error (nada enviado) se cierra como siempre", async () => {
    const m = await mesa();
    const tx = (await t.call("GET", `/orders/${m.id}`, { token: sis })).body;
    await t.call("POST", `/orders/${m.id}/lines/${tx.accounts[0].lines[0].id}/delete`, {
      token: sis,
      body: { reason: "Error al marcar" },
    });
    const no = await t.call("POST", `/orders/${m.id}/save`, { token: sis, body: {} });
    expect([no.status, no.error.field]).toEqual([422, "closeReason"]);
    const ok = await t.call("POST", `/orders/${m.id}/save`, { token: sis, body: { closeReason: "Mesa duplicada" } });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body.released).toBe(true);
    const o = (
      await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, "BARRA"), guests: 1 } })
    ).body;
    const c = await t.call("POST", `/orders/${o._id}/close`, { token: sis, body: {} });
    expect(c.status).toBe(200);
    expect(c.body.tableData.voidClose).toBeUndefined();
  });
});

describe("A10 · Resumen semana: días anteriores", () => {
  it("sin «editar días anteriores» → 403 PERMISSION_REQUIRED; con la clave de quien lo tiene, sí", async () => {
    const ayer = new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
    // un perfil con Resumen semana pero sin editar días anteriores (y se deja como estaba al acabar)
    const had = async (perm: string) =>
      (
        await t.sql.query(
          "SELECT 1 FROM profile_permission pp JOIN app_user u ON u.profile_id = pp.profile_id WHERE u.name = 'Barra' AND pp.permission_code = $1",
          [perm],
        )
      ).rows.length > 0;
    const hadSemana = await had("funciones.semana");
    const hadEditar = await had("funciones.semanaEditar");
    await t.sql.query(
      `INSERT INTO profile_permission (profile_id, permission_code, store_id)
         SELECT u.profile_id, 'funciones.semana', u.store_id FROM app_user u WHERE u.name = 'Barra' ON CONFLICT DO NOTHING`,
    );
    await t.sql.query(
      `DELETE FROM profile_permission pp USING app_user u
        WHERE u.name = 'Barra' AND pp.profile_id = u.profile_id AND pp.permission_code = 'funciones.semanaEditar'`,
    );
    const today = await t.call("PUT", `/reports/week/notes/${hoy}`, { token: barra, body: { note: "Hoy llueve" } });
    expect(today.status, JSON.stringify(today.env)).toBe(200);
    const past = await t.call("PUT", `/reports/week/notes/${ayer}`, { token: barra, body: { note: "Ayer" } });
    expect([...code(past), past.error.details.permission]).toEqual([403, "PERMISSION_REQUIRED", "funciones.semanaEditar"]);
    const auth = (
      await t.call("POST", "/sessions/authorize", {
        token: barra,
        body: { pin: PIN.sistemas, permission: "funciones.semanaEditar" },
      })
    ).body.authorization.token;
    const ok = await t.call("PUT", `/reports/week/notes/${ayer}`, {
      token: barra,
      body: { note: "Ayer", authorization: auth },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    await t.call("PUT", `/reports/week/notes/${hoy}`, { token: sis, body: { note: "" } });
    await t.call("PUT", `/reports/week/notes/${ayer}`, { token: sis, body: { note: "" } });
    if (!hadSemana) {
      await t.sql.query(
        `DELETE FROM profile_permission pp USING app_user u
          WHERE u.name = 'Barra' AND pp.profile_id = u.profile_id AND pp.permission_code = 'funciones.semana'`,
      );
    }
    if (hadEditar) {
      await t.sql.query(
        `INSERT INTO profile_permission (profile_id, permission_code, store_id)
           SELECT u.profile_id, 'funciones.semanaEditar', u.store_id FROM app_user u WHERE u.name = 'Barra' ON CONFLICT DO NOTHING`,
      );
    }
  });
});

describe("D2 · arqueo, ingresos y fondo del día siguiente", () => {
  it("Parámetros › Datáfonos (1–9); el resumen de caja dice cuántos y el fondo que se propone", async () => {
    const p = (await t.call("GET", "/config/parametros/current", { token: sis })).body;
    expect(p.cardTerminals).toBe(1);
    const bad = await t.call("PATCH", "/config/parametros/current", {
      token: sis,
      body: { cardTerminals: 0, version: p.version },
    });
    expect(bad.status).toBe(422);
    const ok = await t.call("PATCH", "/config/parametros/current", {
      token: sis,
      body: { cardTerminals: 2, version: p.version },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    const s = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(s.cardTerminals).toBe(2);
    expect(s.nextFloat).toBe(Math.round((s.float - s.withdrawals + s.deposits) * 100) / 100);
    await t.call("PATCH", "/config/parametros/current", { token: sis, body: { cardTerminals: 1, version: ok.body.item?.version ?? (await t.call("GET", "/config/parametros/current", { token: sis })).body.version } });
  });

  it("un ingreso (abono desde la caja fuerte) suma a lo esperado y al fondo de mañana", async () => {
    const a = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const r = await t.call("POST", "/cash/movements", { token: sis, body: { kind: "deposit", amount: 5 } });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    const b = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(b.deposits).toBe(Math.round((a.deposits + 5) * 100) / 100);
    expect(b.expectedCash).toBe(Math.round((a.expectedCash + 5) * 100) / 100);
    expect(b.nextFloat).toBe(Math.round((a.nextFloat + 5) * 100) / 100);
  });

  it("arqueo con dos datáfonos: guarda lo de cada uno e imprime el resumen; se puede reimprimir", async () => {
    const m = await mesa();
    await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/checkout`, {
      token: sis,
      body: { payments: [{ method: "card", amount: null }] },
    });
    const s = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const n = t.printer.jobs.length;
    const r = await t.call("POST", "/cash/counts", {
      token: sis,
      body: {
        countedCash: s.expectedCash,
        cards: [
          { name: "Datáfono 1", amount: 1 },
          { name: "Datáfono 2", amount: Math.round((s.cardSales - 1) * 100) / 100 },
        ],
        print: true,
      },
    });
    expect(r.status, JSON.stringify(r.env)).toBe(201);
    expect(r.body).toMatchObject({ countedCard: s.cardSales, cardDifference: 0, printed: true });
    const txt = textOf(r.body.ticket);
    for (const x of ["ARQUEO · RESUMEN DE CAJA", "POR FORMA DE PAGO", "CAJA (EFECTIVO)", "Datáfono 1", "Datáfono 2", "Total datáfonos", "Diferencia tarjeta"]) {
      expect(txt, x).toContain(x);
    }
    expect(t.printer.jobs.slice(n).some((j: any) => j.kind === "cutx")).toBe(true);
    const row = (await t.sql.query("SELECT card_detail, counted_card FROM cash_movement WHERE id = $1", [r.body.id])).rows[0];
    expect(row.card_detail).toHaveLength(2);
    expect(Number(row.counted_card)).toBe(s.cardSales);
    const again = await t.call("POST", `/cash/counts/${r.body.id}/print`, { token: sis });
    expect(again.status, JSON.stringify(again.env)).toBe(200);
    expect(textOf(again.body.ticket)).toContain("Datáfono 2");
    expect(code(await t.call("POST", `/cash/counts/${r.body.id}/print`, { token: mesero }))).toEqual([403, "PERMISSION_REQUIRED"]);
    expect(code(await t.call("POST", `/cash/counts/${crypto.randomUUID()}/print`, { token: sis }))).toEqual([404, "NOT_FOUND"]);
  });

  it("cierre: a depositar = contado − fondo de mañana (lo calcula la API); el periodo siguiente abre con ese fondo", async () => {
    // cobrar o cerrar lo que quede abierto
    const { rows } = await t.sql.query("SELECT id FROM orders WHERE status IN ('open','billing')");
    for (const o of rows) {
      const tx = (await t.call("GET", `/orders/${o.id}`, { token: sis })).body;
      for (const a of tx.accounts.filter((x: any) => x.status === "open" && x.lines.length)) {
        if (a.totals.pending > 0) {
          await t.call("POST", `/orders/${o.id}/accounts/${a.id}/payments`, {
            token: sis,
            body: { method: "card", amount: a.totals.pending },
          });
        }
        await t.call("POST", `/orders/${o.id}/accounts/${a.id}/invoice`, { token: sis });
      }
      const after = (await t.call("GET", `/orders/${o.id}`, { token: sis })).body;
      if (["open", "billing"].includes(after.status)) {
        for (const l of after.accounts.flatMap((a: any) => a.lines)) {
          await t.call("POST", `/orders/${o.id}/lines/${l.id}/delete`, { token: sis, body: { reason: "Prueba" } });
        }
        await t.call("POST", `/orders/${o.id}/close`, { token: sis, body: { closeReason: "Prueba" } });
      }
    }
    // lo que siga abierto (p. ej. una cuenta a 0 €): se factura lo que se pueda y se cierra
    const left = (await t.sql.query("SELECT id FROM orders WHERE status IN ('open','billing')")).rows;
    for (const o of left) {
      const tx = (await t.call("GET", `/orders/${o.id}`, { token: sis })).body;
      for (const a of tx.accounts) {
        await t.call("POST", `/orders/${o.id}/accounts/${a.id}/invoice`, { token: sis });
      }
      await t.call("POST", `/orders/${o.id}/close`, { token: sis, body: { closeReason: "Prueba" } });
    }
    const s = (await t.call("GET", "/cash/summary", { token: sis })).body;
    const p = (await t.call("GET", "/periods/current", { token: sis })).body.id;
    const counted = s.expectedCash;
    // el fondo para mañana lo dice el equipo (el de Parámetros, para no cambiar el de las otras pruebas); deposit se ignora
    const nextFloat = Math.min(counted, 150);
    const c = await t.call("POST", `/periods/${p}/close`, {
      token: sis,
      body: { countedCash: counted, cards: [{ name: "Datáfono 1", amount: s.cardSales }], nextFloat: 150, deposit: 999 },
    });
    expect(c.status, JSON.stringify(c.env)).toBe(200);
    expect(c.body.closing.nextFloat).toBe(nextFloat);
    expect(c.body.closing.deposit).toBe(Math.round(Math.max(0, counted - nextFloat) * 100) / 100);
    expect(textOf(c.body.zReport.ticket)).toContain("A depositar");
    const row = (await t.sql.query("SELECT deposit, card_detail FROM cash_closing WHERE period_id = $1", [p])).rows[0];
    expect(Number(row.deposit)).toBe(c.body.closing.deposit);
    expect(row.card_detail).toEqual([{ name: "Datáfono 1", amount: s.cardSales }]);
    await ensurePeriod(t, sis);
    const s2 = (await t.call("GET", "/cash/summary", { token: sis })).body;
    expect(s2.float).toBe(nextFloat);
  });
});

describe("0034 · pantalla de cada equipo", () => {
  it("automática por defecto; fija con ancho × alto y escala 70–150 %; fuera de rango → 422", async () => {
    const st = (await t.call("GET", "/config/estaciones", { token: sis })).body.items.find((x: any) => x.kind === "station");
    expect([st.screenMode, st.uiScale, st.screenWidth ?? null]).toEqual(["auto", 100, null]);
    const ok = await t.call("PATCH", `/config/estaciones/${st.id}`, {
      token: sis,
      body: { screenMode: "fixed", screenWidth: 1920, screenHeight: 1080, uiScale: 120, version: st.version },
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body.item).toMatchObject({ screenMode: "fixed", screenWidth: 1920, screenHeight: 1080, uiScale: 120 });
    const bad = await t.call("PATCH", `/config/estaciones/${st.id}`, { token: sis, body: { uiScale: 200, version: ok.body.item.version } });
    expect([bad.status, bad.error.field]).toEqual([422, "uiScale"]);
    const back = await t.call("PATCH", `/config/estaciones/${st.id}`, {
      token: sis,
      body: { screenMode: "auto", screenWidth: null, screenHeight: null, uiScale: 100, version: ok.body.item.version },
    });
    expect(back.status, JSON.stringify(back.env)).toBe(200);
    expect(code(await t.call("PATCH", `/config/estaciones/${st.id}`, { token: mesero, body: { uiScale: 90, version: back.body.item.version } }))[0]).toBe(403);
  });
});
