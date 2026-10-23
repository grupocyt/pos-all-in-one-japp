import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, ensurePeriod, freeTable, PIN, PLU, type T } from "./helpers.js";

/**
 * Correcciones tras las pruebas en tienda (23/10/2026): nombres de cuenta sin repetir, juntar mesas, tickets de
 * ejemplo nuevos, factura sin desglose, datos del descuadre al cerrar el periodo y cambiar un pase ya marchado.
 */
// Sucursal Pruebas: «Menu Del Dia Ciclo 1» (4478) con bebida (pase 0), primero (1) y segundo (2)
const MENU = 4478;
const AGUA = 4480;
const CREMA = 5990;
const LENTEJAS = 5675;
const MERLUZA = 6619;
let t: T;
let sis: string;
let mesero: string;
let jeison: string;
let storeId: string;
const opened: string[] = [];
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  jeison = await t.login(PIN.jeison);
  await ensurePeriod(t, sis);
  storeId = (await t.sql.query("SELECT id::text FROM store LIMIT 1")).rows[0].id;
  await t.sql.query("UPDATE store SET web_order_url = 'https://pedir.example.com/' WHERE id = $1", [storeId]);
});
afterAll(async () => {
  await t.sql.query("UPDATE store SET web_order_url = NULL WHERE id = $1", [storeId]);
  await t.sql.query(
    "UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL",
  );
  // dejar libres las mesas de estas pruebas: lo cobrado se factura, el resto se elimina con motivo y se cierra sin venta
  for (const id of opened) {
    const tx = (await t.call("GET", `/orders/${id}`, { token: sis })).body;
    if (!["open", "billing"].includes(tx.status)) {
      continue;
    }
    for (const a of tx.accounts.filter((x: any) => x.status === "open")) {
      if (a.payments.length) {
        await t.call("POST", `/orders/${id}/accounts/${a.id}/payments`, {
          token: sis,
          body: { method: "card", amount: null },
        });
        await t.call("POST", `/orders/${id}/accounts/${a.id}/invoice`, { token: sis, body: {} });
        continue;
      }
      for (const l of a.lines) {
        await t.call("POST", `/orders/${id}/lines/${l.id}/delete`, {
          token: sis,
          body: { reason: "Prueba" },
        });
      }
    }
    await t.call("POST", `/orders/${id}/close`, { token: sis, body: {} });
  }
  await t.close();
});

const get = async (id: string) => (await t.call("GET", `/orders/${id}`, { token: sis })).body;
const one = async (q: string, p: unknown[] = []) => (await t.sql.query(q, p)).rows[0];
async function open(guests = 2, area: "BARRA" | "TERRAZA" = "BARRA") {
  const o = (
    await t.call("POST", "/orders", { token: sis, body: { tableId: await freeTable(t, area), guests } })
  ).body;
  opened.push(o._id);
  return o;
}
async function withoutPermission(perm: string, fn: () => Promise<void>) {
  await t.sql.query(
    "DELETE FROM profile_permission WHERE permission_code=$1 AND profile_id=(SELECT id FROM user_profile WHERE code='MESERO')",
    [perm],
  );
  try {
    await fn();
  } finally {
    await t.sql.query(
      "INSERT INTO profile_permission (profile_id, permission_code, store_id) SELECT id, $1, store_id FROM user_profile WHERE code='MESERO' ON CONFLICT DO NOTHING",
      [perm],
    );
  }
}
const outbox = async (orderId: string) =>
  (await one("SELECT count(*)::int n FROM sync_outbox WHERE entity = 'order' AND entity_id = $1", [orderId]))
    .n;

describe("nombres de cuenta: «Cuenta N» nunca se repite", () => {
  it("al quitar una intermedia, la siguiente cuenta (añadir o separar a nueva) no repite número", async () => {
    const o = await open();
    const add = (body: Record<string, unknown> = {}) =>
      t.call("POST", `/orders/${o._id}/accounts`, { token: sis, body });
    await add();
    const three = await add();
    expect(three.body.accounts.map((a: any) => a.name)).toEqual(["Cuenta 1", "Cuenta 2", "Cuenta 3"]);
    const c2 = three.body.accounts[1].id;
    expect((await t.call("DELETE", `/orders/${o._id}/accounts/${c2}`, { token: sis })).status).toBe(200);
    const four = await add();
    expect(four.status, JSON.stringify(four.env)).toBe(201);
    expect(four.body.accounts.map((a: any) => a.name)).toEqual(["Cuenta 1", "Cuenta 3", "Cuenta 4"]);
    // separar a una cuenta nueva: «Cuenta 5» (la 2 anulada tampoco vuelve)
    const line = (
      await t.call("POST", `/orders/${o._id}/lines`, {
        token: sis,
        body: { plu: PLU.tosta, quantity: 2, force: true },
      })
    ).body.accounts[0].lines[0];
    const mv = await t.call("POST", `/orders/${o._id}/lines/move`, {
      token: sis,
      body: { lines: [{ lineId: line.id, quantity: 1 }] },
    });
    expect(mv.status, JSON.stringify(mv.env)).toBe(200);
    expect(mv.body.accounts.map((a: any) => a.name)).toEqual([
      "Cuenta 1",
      "Cuenta 3",
      "Cuenta 4",
      "Cuenta 5",
    ]);
  });

  it("con nombre se respeta; repetido → 409 DUPLICATE; demasiado largo → 422; versión vieja → 409; sin permiso → 403", async () => {
    const o = await open();
    const url = `/orders/${o._id}/accounts`;
    const ok = await t.call("POST", url, { token: sis, body: { name: "  Los de   la barra " } });
    expect([ok.status, ok.body.accounts[1].name]).toEqual([201, "Los de la barra"]);
    const dup = await t.call("POST", url, { token: sis, body: { name: "los de la barra" } });
    expect([dup.status, dup.error.code, dup.error.field]).toEqual([409, "DUPLICATE", "name"]);
    const long = await t.call("POST", url, { token: sis, body: { name: "x".repeat(41) } });
    expect([long.status, long.error.code]).toEqual([422, "VALIDATION"]);
    const old = await t.call("POST", url, { token: sis, body: { version: ok.body.version - 1 } });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    await withoutPermission("pedido.cuentas", async () => {
      const no = await t.call("POST", url, { token: mesero, body: {} });
      expect([no.status, no.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    });
    const { rows } = await t.sql.query("SELECT name FROM account WHERE order_id = $1 ORDER BY opened_by_at", [
      o._id,
    ]);
    expect(rows.map((r: any) => r.name)).toEqual(["Cuenta 1", "Los de la barra"]);
  });
});

describe("juntar mesas: transferir la mesa entera a una ocupada", () => {
  /** Origen: Cuenta 1 (tosta) y Cuenta 2 (croquetas con cobro parcial), 2 comensales, nota y QR de Order on Table. */
  async function source() {
    const o = await open(2);
    await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: PLU.tosta, force: true } });
    const a2 = (await t.call("POST", `/orders/${o._id}/accounts`, { token: sis, body: {} })).body.accounts[1]
      .id;
    await t.call("POST", `/orders/${o._id}/lines`, {
      token: sis,
      body: { plu: PLU.croquetas, accountId: a2, force: true },
    });
    await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
    await t.call("POST", `/orders/${o._id}/accounts/${a2}/payments`, {
      token: sis,
      body: { method: "card", amount: 2 },
    });
    await t.call("PATCH", `/orders/${o._id}`, { token: sis, body: { note: "alérgico" } });
    return { id: o._id as string, a1: o.accounts[0].id as string, a2: a2 as string, table: o.tableData.name };
  }
  /** Destino: Cuenta 1 (kaspirinha), 3 comensales y nota. */
  async function dest() {
    const o = await open(3);
    await t.call("POST", `/orders/${o._id}/lines`, {
      token: sis,
      body: { plu: PLU.kaspirinha, force: true },
    });
    await t.call("PATCH", `/orders/${o._id}`, { token: sis, body: { note: "cumpleaños" } });
    return { id: o._id as string, tableId: o.tableData.tableId as string, table: o.tableData.name };
  }
  const transfer = (
    tok: string,
    id: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => t.call("POST", `/orders/${id}/transfer`, { token: tok, body: { scope: "table", ...body }, headers });

  it("las cuentas vivas pasan enteras, renombradas si se repiten; comensales y notas se suman; el origen se cierra y su QR se anula", async () => {
    const s = await source();
    const d = await dest();
    const qr = await t.call("POST", `/orders/${s.id}/oot`, { token: sis, body: {} });
    expect(qr.status, JSON.stringify(qr.env)).toBeLessThan(300);
    const before = await get(s.id);
    const acc2 = before.accounts.find((a: any) => a.id === s.a2);
    const outS = await outbox(s.id);
    const outD = await outbox(d.id);
    const destV = (await get(d.id)).version;
    const r = await transfer(sis, s.id, { toTableId: d.tableId, version: before.version });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body._id).toBe(d.id);
    expect(r.body.version).toBe(destV + 1);
    // la Cuenta 1 del origen choca con la del destino → Cuenta 2; la Cuenta 2 del origen choca con esa → Cuenta 3
    const names = Object.fromEntries(r.body.accounts.map((a: any) => [a.id, a.name]));
    expect(r.body.accounts).toHaveLength(3);
    expect([names[s.a1], names[s.a2]]).toEqual(["Cuenta 2", "Cuenta 3"]);
    expect(Object.values(names).sort()).toEqual(["Cuenta 1", "Cuenta 2", "Cuenta 3"]);
    const moved = r.body.accounts.find((a: any) => a.id === s.a2);
    expect(moved.totals).toEqual(acc2.totals); // mismos precios y su cobro parcial
    expect(moved.payments.map((p: any) => p.amount)).toEqual([2]);
    expect(r.body.tableData).toMatchObject({ guests: 5, note: "cumpleaños · alérgico", name: d.table });
    expect(r.body.events.map((e: any) => e.description)).toContain(
      `Se junta la mesa ${s.table}: Cuenta 2, Cuenta 3 (Cuenta 1 ahora Cuenta 2, Cuenta 2 ahora Cuenta 3) · 5 comensales`,
    );
    // origen: cancelado, sin cuentas vivas, su mesa libre, evento y QR anulado como 'transferred'
    const src = await get(s.id);
    expect([src.status, src.accounts]).toEqual(["cancelled", []]);
    expect(src.events.map((e: any) => e.description)).toContain(
      `La mesa ${s.table} se junta con la mesa ${d.table} (Cuenta 2, Cuenta 3)`,
    );
    const tbl = (await t.call("GET", "/tables", { token: sis })).body.items.find(
      (x: any) => x.tableId === before.tableData.tableId,
    );
    expect(tbl.state).toBe("free");
    const tok = await one("SELECT revoked_reason FROM oot_token WHERE token = $1", [qr.body.token]);
    expect(tok.revoked_reason).toBe("transferred");
    // en la base: cuentas y líneas (también las eliminadas) en la orden de destino; las dos órdenes a la cola
    const { rows } = await t.sql.query(
      "SELECT DISTINCT order_id::text FROM order_line WHERE account_id = ANY($1::uuid[])",
      [[s.a1, s.a2]],
    );
    expect(rows).toEqual([{ order_id: d.id }]);
    expect(await outbox(s.id)).toBe(outS + 1);
    expect(await outbox(d.id)).toBe(outD + 1);
    // y se sigue cobrando allí
    expect(
      (
        await t.call("POST", `/orders/${d.id}/accounts/${s.a2}/payments`, {
          token: sis,
          body: { method: "card", amount: null },
        })
      ).status,
    ).toBe(201);
  });

  it("con una cuenta facturada el origen queda closed (la facturada no se mueve)", async () => {
    const s = await source();
    const d = await dest();
    await t.call("POST", `/orders/${s.id}/accounts/${s.a1}/payments`, {
      token: sis,
      body: { method: "card", amount: null },
    });
    await t.call("POST", `/orders/${s.id}/accounts/${s.a1}/invoice`, { token: sis, body: {} });
    const r = await transfer(sis, s.id, { toTableId: d.tableId, version: (await get(s.id)).version });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect(r.body.accounts.map((a: any) => a.name).sort()).toEqual(["Cuenta 1", "Cuenta 2"]);
    expect(r.body.accounts.find((a: any) => a.id === s.a2).name).toBe("Cuenta 2");
    const src = await get(s.id);
    expect(src.status).toBe("closed");
    expect(src.accounts.map((a: any) => [a.id, a.status])).toEqual([[s.a1, "invoiced"]]);
  });

  it("destino cobrándose → 409 TABLE_CHARGING; con otra persona → TABLE_TAKEN salvo mesas.entrarOcupada; versión vieja → 409", async () => {
    const s = await source();
    const d = await dest();
    await t.call("POST", `/orders/${d.id}/presence`, { token: jeison, body: { action: "enter" } });
    await t.call("POST", `/orders/${d.id}/presence`, { token: jeison, body: { action: "charging" } });
    const v = (await get(s.id)).version;
    const ch = await transfer(sis, s.id, { toTableId: d.tableId, version: v });
    expect([ch.status, ch.error.code]).toEqual([409, "TABLE_CHARGING"]);
    await t.call("POST", `/orders/${d.id}/presence`, { token: jeison, body: { action: "chargingEnd" } });
    const tk = await transfer(mesero, s.id, { toTableId: d.tableId, version: v });
    expect([tk.status, tk.error.code]).toEqual([409, "TABLE_TAKEN"]);
    const old = await transfer(sis, s.id, { toTableId: d.tableId, version: v - 1 });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    // nada se movió
    expect((await get(s.id)).accounts).toHaveLength(2);
    expect((await get(d.id)).accounts).toHaveLength(1);
    // Sistemas (mesas.entrarOcupada) sí entra
    expect((await transfer(sis, s.id, { toTableId: d.tableId, version: v })).status).toBe(200);
  });

  it("sin mesas.transferir → 403; cuerpo malo o sin productos → 422; misma Idempotency-Key → se juntan una sola vez", async () => {
    const s = await source();
    const d = await dest();
    const v = (await get(s.id)).version;
    await withoutPermission("mesas.transferir", async () => {
      const no = await transfer(mesero, s.id, { toTableId: d.tableId, version: v });
      expect([no.status, no.error.code, no.error.details.permission]).toEqual([
        403,
        "PERMISSION_REQUIRED",
        "mesas.transferir",
      ]);
    });
    expect((await transfer(sis, s.id, { toTableId: "mesa-8", version: v })).status).toBe(422);
    const empty = await open(1);
    const e = await transfer(sis, empty._id, { toTableId: d.tableId });
    expect([e.status, e.error.code]).toEqual([422, "VALIDATION"]);
    const h = { "idempotency-key": crypto.randomUUID() };
    const a = await transfer(sis, s.id, { toTableId: d.tableId, version: v }, h);
    const b = await transfer(sis, s.id, { toTableId: d.tableId, version: v }, h);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    const n = await one("SELECT count(*)::int n FROM account WHERE order_id = $1", [d.id]);
    expect(n.n).toBe(3);
  });

  it("destino libre: como siempre (la orden cambia de mesa)", async () => {
    const s = await source();
    const to = await freeTable(t, "TERRAZA");
    const r = await transfer(sis, s.id, { toTableId: to });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    expect([r.body._id, r.body.tableData.tableId, r.body.accounts.length]).toEqual([s.id, to, 2]);
  });
});

describe("prueba de impresoras: anulación, corte X, corte Z y QR de Order on Table", () => {
  it("vista previa de cada ticket nuevo; tipo desconocido → 422; sin permiso → 403", async () => {
    const text = async (kind: string) => {
      const r = await t.call("POST", "/printers/preview", { token: sis, body: { kind } });
      expect(r.status, kind).toBe(200);
      expect(r.body.text.split("\n").every((l: string) => l.length <= 48)).toBe(true);
      return r.body.text as string;
    };
    expect(await text("void")).toMatch(
      /ANULACIÓN[\s\S]*Motivo: Error al marcar[\s\S]*Autorizado por: Encargado/,
    );
    expect(await text("cutx")).toMatch(/CORTE X[\s\S]*Lectura sin cierre[\s\S]*Efectivo esperado/);
    const z = await text("cutz");
    expect(z).toContain("CORTE Z");
    expect(z).toContain("Z nº 0001");
    expect(await text("oot")).toContain("PIDE DESDE TU MÓVIL");
    const bad = await t.call("POST", "/printers/preview", { token: sis, body: { kind: "nope" } });
    expect([bad.status, bad.error.code]).toEqual([422, "VALIDATION"]);
    const no = await t.call("POST", "/printers/preview", { token: mesero, body: { kind: "void" } });
    expect(no.error.code).toBe("PERMISSION_REQUIRED");
  });
});

describe("factura y precuenta sin desglose interno", () => {
  it("la precuenta de un menú: una línea con su importe, sin respuestas ni pases; la comanda sí los lleva", async () => {
    const o = await open();
    const n = t.printer.jobs.length;
    await t.call("POST", `/orders/${o._id}/lines`, {
      token: sis,
      body: { plu: MENU, modifiers: [{ plu: AGUA }, { plu: CREMA }, { plu: MERLUZA }] },
    });
    await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
    const pb = await t.call("POST", `/orders/${o._id}/accounts/${o.accounts[0].id}/prebill`, {
      token: sis,
      body: {},
    });
    expect(pb.status, JSON.stringify(pb.env)).toBe(200);
    const jobs = t.printer.jobs.slice(n);
    const kitchen = jobs
      .filter((j) => j.kind === "kitchen")
      .map((j) => j.text)
      .join("\n");
    const bill = jobs
      .filter((j) => j.kind !== "kitchen")
      .map((j) => j.text)
      .join("\n");
    expect(kitchen).toContain("CREMA PUERRO");
    expect(bill).toContain("PRECUENTA");
    expect(bill).not.toContain("CREMA PUERRO");
    expect(bill).not.toContain("AGUA SIN GAS");
    expect(bill).not.toMatch(/ c\. /);
  });
});

describe("cerrar el periodo con descuadre sin nota", () => {
  it("422 VALIDATION en note con lo esperado, lo contado, la diferencia y el umbral", async () => {
    const p = (await t.call("GET", "/periods/current", { token: sis })).body.id;
    // el cierre no deja con mesas abiertas: se apartan un momento y se dejan como estaban (el 422 no cambia nada)
    const { rows: live } = await t.sql.query(
      "UPDATE orders o SET status = 'cancelled' FROM (SELECT id, status FROM orders WHERE status IN ('open','billing') FOR UPDATE) x WHERE o.id = x.id RETURNING o.id, x.status",
    );
    try {
      const sum = (await t.call("GET", "/cash/summary", { token: sis })).body;
      const thr = Number(
        (await one("SELECT cash_diff_threshold FROM store_parameters WHERE store_id = $1", [storeId]))
          .cash_diff_threshold,
      );
      const bad = await t.call("POST", `/periods/${p}/close`, {
        token: sis,
        body: { countedCash: sum.expectedCash - 20, nextFloat: 150 },
      });
      expect([bad.status, bad.error.code, bad.error.field]).toEqual([422, "VALIDATION", "note"]);
      expect(bad.error.details).toMatchObject({
        expectedCash: sum.expectedCash,
        countedCash: sum.expectedCash - 20,
        difference: -20,
        threshold: thr,
      });
      expect((await t.call("GET", "/periods/current", { token: sis })).body.id).toBe(p);
    } finally {
      for (const r of live) {
        await t.sql.query("UPDATE orders SET status = $2 WHERE id = $1", [r.id, r.status]);
      }
    }
  });
});

describe("cambiar un pase ya marchado (falta de stock)", () => {
  beforeAll(async () => {
    // las lentejas como primero llevan suplemento: el precio de la línea se recalcula con la respuesta nueva
    await t.sql.query(
      "UPDATE question_answer SET extra_price = 1.50 WHERE product_id = (SELECT id FROM product WHERE plu = $1) AND question_id IN (SELECT id FROM question WHERE course = 1)",
      [LENTEJAS],
    );
  });
  afterAll(async () => {
    await t.sql.query(
      "UPDATE question_answer SET extra_price = 0 WHERE product_id = (SELECT id FROM product WHERE plu = $1) AND question_id IN (SELECT id FROM question WHERE course = 1)",
      [LENTEJAS],
    );
  });
  /** Menú con agua y crema marchados (y el 2.º elegido o por elegir). */
  async function menu(withSecond = false) {
    const o = await open();
    const mods = [{ plu: AGUA }, { plu: CREMA }, ...(withSecond ? [{ plu: MERLUZA }] : [])];
    const lid = (
      await t.call("POST", `/orders/${o._id}/lines`, { token: sis, body: { plu: MENU, modifiers: mods } })
    ).body.accounts[0].lines[0].id;
    const s = await t.call("POST", `/orders/${o._id}/send`, { token: sis, body: {} });
    expect(s.body.order.accounts[0].lines[0].courses[1]).toMatchObject({ course: 1, state: "fired" });
    return { id: o._id as string, acc: o.accounts[0].id as string, lid: lid as string };
  }
  const change = (tok: string, m: { id: string; lid: string }, body: Record<string, unknown>) =>
    t.call("PUT", `/orders/${m.id}/lines/${m.lid}/answers`, { token: tok, body: { course: 1, ...body } });

  it("con motivo y permiso: el pase sigue marchado con la respuesta nueva, se recalcula el precio, queda en el historial y sale «CAMBIO 1.º»", async () => {
    const m = await menu();
    const before = await get(m.id);
    const line0 = before.accounts[0].lines[0];
    const reason = await one(
      "SELECT id::text, name FROM reason WHERE store_id = $1 AND name = 'Producto agotado'",
      [storeId],
    );
    const n = t.printer.jobs.length;
    // el cambio llega un minuto después de marchar: firedAt nuevo
    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    const r = await change(sis, m, {
      modifiers: [{ plu: LENTEJAS }],
      reasonId: reason.id,
      version: before.version,
    });
    expect(r.status, JSON.stringify(r.env)).toBe(200);
    const l = r.body.accounts[0].lines[0];
    const c1 = l.courses.find((c: any) => c.course === 1);
    expect(c1.state).toBe("fired");
    expect(c1.firedAt).toBe(t.clock.now.toISOString());
    expect(c1.firedAt).not.toBe(line0.courses.find((c: any) => c.course === 1).firedAt);
    expect(l.modifiers.filter((x: any) => x.course === 1).map((x: any) => x.name)).toEqual([
      "M Lentejas Con Chorizo",
    ]);
    expect(l.amount).toBeCloseTo(line0.amount + 1.5, 2);
    expect(r.body.version).toBe(before.version + 1);
    expect(r.body.events.map((e: any) => e.description)).toContain(
      "Cambio 1.º: M CREMA PUERRO Y CALABACIN → M LENTEJAS CON CHORIZO · Producto agotado · Sistemas",
    );
    const k = t.printer.jobs
      .slice(n)
      .filter((j) => j.kind === "kitchen")
      .map((j) => j.text)
      .join("\n");
    expect(k).toContain(">> CAMBIO 1.º");
    expect(k).toContain("M LENTEJAS CON CHORIZO");
    expect(k).toContain("ANTES: M CREMA PUERRO Y CALABACIN");
    const lp = await one(
      "SELECT count(*)::int n, bool_and(printed) ok FROM order_line_printer WHERE line_id = $1 AND channel_name LIKE '%|CAMBIO 1.º'",
      [m.lid],
    );
    expect([lp.n > 0, lp.ok]).toEqual([true, true]);
    const mods = await t.sql.query(
      "SELECT name, unit_price FROM order_line_modifier WHERE line_id = $1 AND course = 1",
      [m.lid],
    );
    expect(mods.rows.map((x: any) => [x.name, Number(x.unit_price)])).toEqual([
      ["M Lentejas Con Chorizo", 1.5],
    ]);
  });

  it("sin motivo → 422 field reason; sin pedido.elimEnviado → 403; con la clave de un encargado sí; versión vieja → 409", async () => {
    const m = await menu();
    const noReason = await change(sis, m, { modifiers: [{ plu: LENTEJAS }] });
    expect([noReason.status, noReason.error.code, noReason.error.field]).toEqual([
      422,
      "VALIDATION",
      "reason",
    ]);
    const no = await change(mesero, m, { modifiers: [{ plu: LENTEJAS }], reason: "No queda crema" });
    expect([no.status, no.error.code, no.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "pedido.elimEnviado",
    ]);
    const v = (await get(m.id)).version;
    const old = await change(sis, m, { modifiers: [{ plu: LENTEJAS }], reason: "x", version: v - 1 });
    expect([old.status, old.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    const auth = (
      await t.call("POST", "/sessions/authorize", {
        token: mesero,
        body: { pin: PIN.sistemas, permission: "pedido.elimEnviado" },
      })
    ).body.authorization.token;
    const ok = await change(mesero, m, {
      modifiers: [{ plu: LENTEJAS }],
      reason: "No queda crema",
      authorization: auth,
      version: v,
    });
    expect(ok.status, JSON.stringify(ok.env)).toBe(200);
    expect(ok.body.events.map((e: any) => e.description)).toContain(
      "Cambio 1.º: M CREMA PUERRO Y CALABACIN → M LENTEJAS CON CHORIZO · No queda crema · Mesero/Sistemas",
    );
  });

  it("con la cuenta cobrada, bajar de lo cobrado → 409 TOTAL_BELOW_PAID y no cambia nada", async () => {
    const m = await menu(true);
    await change(sis, m, { modifiers: [{ plu: LENTEJAS }], reason: "No queda crema" });
    const pay = await t.call("POST", `/orders/${m.id}/accounts/${m.acc}/payments`, {
      token: sis,
      body: { method: "card", amount: null },
    });
    expect(pay.status, JSON.stringify(pay.env)).toBe(201);
    const v = (await get(m.id)).version;
    const r = await change(sis, m, {
      modifiers: [{ plu: CREMA }],
      reason: "Vuelve a haber crema",
      version: v,
    });
    expect([r.status, r.error.code]).toEqual([409, "TOTAL_BELOW_PAID"]);
    expect((await get(m.id)).version).toBe(v);
  });
});
