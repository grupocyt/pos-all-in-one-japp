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
