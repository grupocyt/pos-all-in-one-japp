import { inject } from "vitest";
import { connect, one, rollback, uuid, n } from "./db.js";

/** Reglas que la base hace cumplir por sí sola, aunque el back tenga un fallo. */
let c: Awaited<ReturnType<typeof connect>>;
let store: string;
beforeAll(async () => { c = await connect(inject("dbUrl")); store = (await one(c, "SELECT id FROM store")).id; });
afterAll(async () => { await c.end(); });

const fails = async (sql: string, params: unknown[], code: string) => {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("RELEASE SAVEPOINT s"); return "OK"; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); expect(e.code).toBe(code); return e.code; }
};
const openPeriod = (id = uuid()) => c.query(`INSERT INTO sales_period (id, store_id, status, opened_by_user_name, opened_by_at, open_flag) VALUES ($1,$2,'open','Lucía',now(),1)`, [id, store]);

describe("reglas en la base", () => {
  it("las series admiten los tipos de VeriFactu: F1, F2, F3 y R1…R5 (migración 0010)", () => rollback(c, async () => {
    for (const kind of ["F3", "R2", "R3", "R4", "R5"]) {
      expect(await fails(`INSERT INTO invoice_series (store_id, series, kind) VALUES ($1, $2, $3)`, [store, `T${kind}`, kind], "23514")).toBe("OK");
    }
  }));
  it("dos estaciones activas no pueden tener el mismo UUID de equipo (23505, migración 0011)", () => rollback(c, async () => {
    const st = await one(c, "SELECT id FROM station WHERE store_id=$1 LIMIT 1", [store]);
    await c.query("UPDATE station SET device_uuid='AAAA1111-2222-4333-8444-555566667777' WHERE id=$1", [st.id]);
    await fails(`INSERT INTO station (id, store_id, name, kind, device_uuid, ip, active) VALUES ($1, $2, 'DUP', 'pda', 'aaaa1111-2222-4333-8444-555566667777', '10.0.0.9', TRUE)`, [uuid(), store], "23505");
  }));
  it("el external_id del App Manager no se repite en la tienda (23505, migración 0012)", () => rollback(c, async () => {
    const [p1, p2] = (await c.query("SELECT id FROM product WHERE store_id=$1 ORDER BY plu LIMIT 2", [store])).rows;
    await c.query("UPDATE product SET external_id='MGR-P-1' WHERE id=$1", [p1.id]);
    await fails("UPDATE product SET external_id='MGR-P-1' WHERE id=$1", [p2.id], "23505");
    const [k1, k2] = (await c.query("SELECT id FROM category WHERE store_id=$1 LIMIT 2", [store])).rows;
    await c.query("UPDATE category SET external_id='MGR-C-1' WHERE id=$1", [k1.id]);
    await fails("UPDATE category SET external_id='MGR-C-1' WHERE id=$1", [k2.id], "23505");
  }));
  it("el id de integración de una forma de pago no se repite en la tienda (23505, migración 0014)", () => rollback(c, async () => {
    const [m1, m2] = (await c.query("SELECT id FROM payment_method WHERE store_id=$1 ORDER BY code LIMIT 2", [store])).rows;
    await c.query("UPDATE payment_method SET external_id='PAG-1' WHERE id=$1", [m1.id]);
    await fails("UPDATE payment_method SET external_id='PAG-1' WHERE id=$1", [m2.id], "23505");
  }));
  it("el tiempo de la tanda va de 2 a 30 s y por defecto 5 (23514, migración 0016)", () => rollback(c, async () => {
    expect((await c.query("SELECT batch_send_seconds FROM billing_settings WHERE store_id=$1", [store])).rows[0].batch_send_seconds).toBe(5);
    await c.query("UPDATE billing_settings SET batch_send_seconds=10 WHERE store_id=$1", [store]);
    await fails("UPDATE billing_settings SET batch_send_seconds=1 WHERE store_id=$1", [store], "23514");
    await fails("UPDATE billing_settings SET batch_send_seconds=31 WHERE store_id=$1", [store], "23514");
  }));
  it("el color de un usuario es #RRGGBB o vacío (23514, migración 0018)", () => rollback(c, async () => {
    const u = (await one(c, "SELECT id FROM app_user WHERE store_id=$1 LIMIT 1", [store])).id;
    expect(await fails("UPDATE app_user SET color='#2E7D8A' WHERE id=$1", [u], "23514")).toBe("OK");
    expect(await fails("UPDATE app_user SET color=NULL WHERE id=$1", [u], "23514")).toBe("OK");
    await fails("UPDATE app_user SET color='rojo' WHERE id=$1", [u], "23514");
  }));
  it("segunda pantalla: config objeto, media con tipo, mime, tamaño, huella y días 1–7 (migración 0021)", () => rollback(c, async () => {
    expect(await fails("INSERT INTO customer_display (store_id, config) VALUES ($1, '{\"mode\":\"billing\"}')", [store], "23514")).toBe("OK");
    await fails("UPDATE customer_display SET config='[]' WHERE store_id=$1", [store], "23514");
    const ins = "INSERT INTO display_media (id, store_id, kind, name, mime, size_bytes, sha256, days) VALUES ($1,$2,$3,'a.mp4',$4,$5,$6,$7)";
    const sha = "a".repeat(64);
    expect(await fails(ins, [uuid(), store, "video", "video/mp4", 1000, sha, [1, 5]], "23514")).toBe("OK");
    await fails(ins, [uuid(), store, "audio", "video/mp4", 1000, sha, []], "23514");
    await fails(ins, [uuid(), store, "video", "text/html", 1000, sha, []], "23514");
    await fails(ins, [uuid(), store, "video", "video/mp4", 0, sha, []], "23514");
    await fails(ins, [uuid(), store, "video", "video/mp4", 1000, "xyz", []], "23514");
    await fails(ins, [uuid(), store, "video", "video/mp4", 1000, sha, [8]], "23514");
  }));
  it("forma de pago de tipo descuento y sin mostrar en el TPV (migración 0020)", () => rollback(c, async () => {
    const pm = (await one(c, "SELECT id FROM payment_method WHERE store_id=$1 LIMIT 1", [store])).id;
    expect(await fails("UPDATE payment_method SET kind='discount', show_in_tpv=false WHERE id=$1", [pm], "23514")).toBe("OK");
    await fails("UPDATE payment_method SET kind='regalo' WHERE id=$1", [pm], "23514");
  }));
  it("la URL del SIR es http(s) o vacía (23514, migración 0019)", () => rollback(c, async () => {
    expect(await fails("UPDATE store SET sir_url='http://sir.example.com/servicio.php' WHERE id=$1", [store], "23514")).toBe("OK");
    expect(await fails("UPDATE store SET sir_url=NULL WHERE id=$1", [store], "23514")).toBe("OK");
    await fails("UPDATE store SET sir_url='ftp://x' WHERE id=$1", [store], "23514");
  }));
  it("SLA de atención: la regla de la tienda trae todos los límites, el resto puede heredar, sin repetir ámbito ni pasar de 600 min (migración 0017)", () => rollback(c, async () => {
    const d = (await c.query("SELECT * FROM service_sla WHERE store_id=$1 AND area_id IS NULL AND table_id IS NULL AND shift_id IS NULL", [store])).rows;
    expect(d).toHaveLength(1);
    expect(d[0].first_order_minutes).toBeGreaterThan(0);
    const area = (await one(c, "SELECT id FROM area WHERE store_id=$1 LIMIT 1", [store])).id;
    const sh = uuid();
    await c.query("INSERT INTO service_shift (id, store_id, name, starts_at, ends_at) VALUES ($1,$2,'Cena','19:30','00:30')", [sh, store]);
    await fails("INSERT INTO service_shift (id, store_id, name, starts_at, ends_at) VALUES ($1,$2,'Mal','10:00','10:00')", [uuid(), store], "23514");
    const ins = "INSERT INTO service_sla (id, store_id, area_id, table_id, shift_id, first_order_minutes) VALUES ($1,$2,$3,$4,$5,$6)";
    expect(await fails(ins, [uuid(), store, area, null, sh, 5], "23514")).toBe("OK");
    await fails(ins, [uuid(), store, area, null, sh, 7], "23505");
    expect(await fails(ins, [uuid(), store, null, null, sh, 5], "23505")).toBe("OK");
    await fails(ins, [uuid(), store, null, null, sh, 6], "23505");
    await fails("UPDATE service_sla SET total_minutes = NULL WHERE store_id=$1 AND area_id IS NULL AND table_id IS NULL AND shift_id IS NULL", [store], "23514");
    await fails(ins, [uuid(), store, area, null, null, 601], "23514");
    const tbl = (await one(c, "SELECT id FROM dining_table WHERE store_id=$1 LIMIT 1", [store])).id;
    await fails(ins, [uuid(), store, area, tbl, null, 5], "23514");
  }));
  it("una incidencia de mesa resuelta lleva fecha y una abierta no (23514, migración 0015)", () => rollback(c, async () => {
    const ins = `INSERT INTO order_incident (id, store_id, table_name, kind, status, occurred_at, opened_by_user_name, resolved_by_at) VALUES ($1, $2, '12', 'offline', $3, now(), 'x', $4)`;
    expect(await fails(ins, [uuid(), store, "open", null], "23514")).toBe("OK");
    await fails(ins, [uuid(), store, "retried", null], "23514");
    await fails(ins, [uuid(), store, "open", new Date()], "23514");
    await fails(`INSERT INTO order_incident (id, store_id, table_name, kind, occurred_at, opened_by_user_name) VALUES ($1, $2, '1', 'otra', now(), 'x')`, [uuid(), store], "23514");
  }));
  it("una orden tiene como mucho un token de Order on Table vigente (23505, migración 0012)", () => rollback(c, async () => {
    const o = uuid();
    await c.query(`INSERT INTO orders (id, store_id, table_name, opened_by_user_name, opened_by_at) VALUES ($1,$2,'1','x',now())`, [o, store]);
    await c.query(`INSERT INTO oot_token (store_id, order_id, token) VALUES ($1,$2,'oot_a')`, [store, o]);
    await fails(`INSERT INTO oot_token (store_id, order_id, token) VALUES ($1,$2,'oot_b')`, [store, o], "23505");
    await c.query(`UPDATE oot_token SET revoked_at=now(), revoked_reason='manual' WHERE token='oot_a'`);
    expect(await fails(`INSERT INTO oot_token (store_id, order_id, token) VALUES ($1,$2,'oot_b')`, [store, o], "23505")).toBe("OK");
    await fails(`UPDATE oot_token SET revoked_reason='otro' WHERE token='oot_a'`, [], "23514");
  }));
  it("encolar en sync_outbox avisa al agente (NOTIFY sync_outbox al hacer COMMIT, migración 0013)", async () => {
    const l = await connect(inject("dbUrl"));
    const got: string[] = [];
    l.on("notification", (m) => got.push(m.channel));
    await l.query("LISTEN sync_outbox");
    await c.query(`INSERT INTO sync_outbox (store_id, entity, entity_id, payload) VALUES ($1, 'test', $2, '{}')`, [store, uuid()]);
    await c.query(`DELETE FROM sync_outbox WHERE entity = 'test'`);
    for (let i = 0; i < 50 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    await l.end();
    expect(got).toContain("sync_outbox");
  });
  it("un tipo de factura que no existe se rechaza (23514)", () => rollback(c, async () => {
    await fails(`INSERT INTO invoice_series (store_id, series, kind) VALUES ($1, 'TX', 'R9')`, [store], "23514");
  }));
  it("no puede haber dos periodos abiertos en la misma tienda (23505)", () => rollback(c, async () => {
    await openPeriod();
    await fails(`INSERT INTO sales_period (id, store_id, status, opened_by_user_name, opened_by_at, open_flag) VALUES ($1,$2,'open','Otro',now(),1)`, [uuid(), store], "23505");
  }));
  it("al cerrar (open_flag NULL) se puede abrir otro", () => rollback(c, async () => {
    const p = uuid(); await openPeriod(p);
    await c.query(`UPDATE sales_period SET status='closed', open_flag=NULL, closed_by_user_name='Lucía', closed_by_at=now() WHERE id=$1`, [p]);
    await openPeriod();
    expect(n((await one(c, "SELECT count(*) FROM sales_period WHERE open_flag=1")).count)).toBe(1);
  }));
  it("open_flag solo admite 1 (23514)", () => rollback(c, async () => {
    await fails(`INSERT INTO sales_period (id, store_id, status, opened_by_user_name, opened_by_at, open_flag) VALUES ($1,$2,'open','x',now(),2)`, [uuid(), store], "23514");
  }));
  it("estados fuera de la lista se rechazan (CHECK, 23514)", () => rollback(c, async () => {
    await openPeriod();
    await fails(`INSERT INTO orders (id, store_id, status, table_name, opened_by_user_name, opened_by_at) VALUES ($1,$2,'abierta','1','x',now())`, [uuid(), store], "23514");
  }));
  it("no se borra un producto que tiene ventas (FK, 23503)", () => rollback(c, async () => {
    const o = uuid(), a = uuid();
    const p = await one(c, "SELECT id, plu FROM product LIMIT 1");
    await c.query(`INSERT INTO orders (id, store_id, table_name, opened_by_user_name, opened_by_at) VALUES ($1,$2,'1','x',now())`, [o, store]);
    await c.query(`INSERT INTO account (id, store_id, order_id, name, opened_by_user_name, opened_by_at) VALUES ($1,$2,$3,'Cuenta 1','x',now())`, [a, store, o]);
    await c.query(`INSERT INTO order_line (id, store_id, order_id, account_id, product_id, plu, name, unit_price, tax_rate, created_by_user_name, created_by_at) VALUES ($1,$2,$3,$4,$5,$6,'x',1,10,'x',now())`, [uuid(), store, o, a, p.id, p.plu]);
    await fails(`DELETE FROM product WHERE id=$1`, [p.id], "23503");
  }));
  it("una factura no se repite en la misma serie (23505)", () => rollback(c, async () => {
    const ins = `INSERT INTO invoice (id, store_id, type, series, sequence, invoice_number, issued_at, issuer_tax_id, issuer_name, tax_base, tax_total, total, issued_by_user_name, issued_by_at)
                 VALUES ($1,$2,'F2','TDUP',7,'TDUP-000007',now(),'B1','x',1,0.1,1.1,'x',now())`;
    await c.query(ins, [uuid(), store]);
    await fails(ins, [uuid(), store], "23505");
  }));
  it("updated_at se actualiza solo al modificar", () => rollback(c, async () => {
    const before = (await one(c, "SELECT updated_at FROM store")).updated_at as Date;
    await c.query("COMMIT"); await c.query("BEGIN"); // now() cambia entre transacciones
    await c.query("UPDATE store SET phone=phone WHERE id=$1", [store]);
    const after = (await one(c, "SELECT updated_at FROM store")).updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  }));
  it("los importes guardan exactamente 2 decimales (0,1 + 0,2 = 0,30)", async () => {
    expect((await one(c, "SELECT (0.1::numeric(12,2) + 0.2::numeric(12,2))::text v")).v).toBe("0.30");
  });
});
