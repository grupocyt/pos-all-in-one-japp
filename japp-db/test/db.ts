import pg from "pg";
import { randomUUID } from "node:crypto";

export const connect = async (url: string) => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; };
export const one = async <T = any>(c: pg.ClientBase, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0] as T;
export const all = async <T = any>(c: pg.ClientBase, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[];
/** NUMERIC llega como texto desde pg: lo convertimos solo para comparar en pruebas. */
export const n = (x: unknown) => Number(x);
/** Ejecuta fn dentro de una transacción que siempre se deshace: cada prueba deja la base como estaba. */
export async function rollback<T>(c: pg.ClientBase, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try { return await fn(); } finally { await c.query("ROLLBACK"); }
}
export const uuid = randomUUID;

/** Inserta una mesa completa (orden, cuenta, líneas, modificadores, descuento, cobros y factura) como haría el back. */
export async function insertSampleOrder(c: pg.ClientBase, opts: { breakTotal?: boolean; unpaid?: boolean; deleteWithoutReason?: boolean } = {}) {
  const store = (await one(c, "SELECT id FROM store LIMIT 1")).id;
  const now = new Date().toISOString();
  const period = uuid(), order = uuid(), acc = uuid(), l1 = uuid(), l2 = uuid(), l3 = uuid(), inv = uuid();
  await c.query(`INSERT INTO sales_period (id, store_id, status, opened_by_user_name, opened_by_at, open_flag) VALUES ($1,$2,'open','Lucía',$3,1)`, [period, store, now]);
  await c.query(`INSERT INTO orders (id, store_id, period_id, status, table_name, price_list, guests, opened_by_user_name, opened_by_at) VALUES ($1,$2,$3,'closed','12','terrace',2,'Marta',$4)`, [order, store, period, now]);
  // 2 × 2,90 caña terraza = 5,80 ; croquetas 11,50 + alioli 1,50 = 13,00 ; total 18,80 ; −10 % = 1,88 → 16,92
  const sub = 18.8, disc = 1.88, total = opts.breakTotal ? 99 : 16.92;
  await c.query(`INSERT INTO account (id, store_id, order_id, name, status, opened_by_user_name, opened_by_at, subtotal, discount_total, total, paid, pending)
                 VALUES ($1,$2,$3,'Cuenta 1','invoiced','Marta',$4,$5,$6,$7,$8,$9)`, [acc, store, order, now, sub, disc, total, opts.unpaid ? 0 : 16.92, opts.unpaid ? 16.92 : 0]);
  const line = (id: string, plu: number, name: string, q: number, p: number, extra = "") =>
    c.query(`INSERT INTO order_line (id, store_id, order_id, account_id, plu, name, quantity, unit_price, tax_rate, status, printed, created_by_user_name, created_by_at${extra ? "," + extra.split("=")[0] : ""})
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,10,'preBill',true,'Marta',$9${extra ? ",true" : ""})`, [id, store, order, acc, plu, name, q, p, now]);
  await line(l1, 1001, "Caña", 2, 2.9);
  await line(l2, 3004, "Croquetas", 1, 11.5);
  await c.query(`INSERT INTO order_line_modifier (id, store_id, line_id, name, quantity, unit_price) VALUES ($1,$2,$3,'Alioli',1,1.5)`, [uuid(), store, l2]);
  // línea borrada después de enviarla: no cuenta en el total
  await c.query(`INSERT INTO order_line (id, store_id, order_id, account_id, plu, name, quantity, unit_price, tax_rate, status, printed, created_by_user_name, created_by_at,
                 deleted, delete_reason, deleted_by_user_name, deleted_by_at, delete_authorized_by_user_name)
                 VALUES ($1,$2,$3,$4,1050,'Agua',1,2,10,'deleted',true,'Marta',$5,true,$6,$7,$8,'Lucía')`,
    [l3, store, order, acc, now, opts.deleteWithoutReason ? null : "Error al marcar", "Marta", opts.deleteWithoutReason ? null : now]);
  await c.query(`INSERT INTO account_discount (id, store_id, account_id, source, type, value, base_amount, amount, status, applied_by_user_name, applied_by_at)
                 VALUES ($1,$2,$3,'coupon','percentage',10,$4,$5,'applied','Lucía',$6)`, [uuid(), store, acc, sub, disc, now]);
  if (!opts.unpaid) {
    await c.query(`INSERT INTO payment (id, store_id, account_id, method, amount, tip, status, collected_by_user_name, collected_by_at) VALUES ($1,$2,$3,'card',20,0,'declined','Pablo',$4)`, [uuid(), store, acc, now]);
    await c.query(`INSERT INTO payment (id, store_id, account_id, method, amount, tip, cash_given, change_given, status, collected_by_user_name, collected_by_at) VALUES ($1,$2,$3,'cash',16.92,0,20,3.08,'confirmed','Pablo',$4)`, [uuid(), store, acc, now]);
  }
  // 16,92 al 10 %: base 15,38 · cuota 1,54
  await c.query(`INSERT INTO invoice (id, store_id, account_id, order_id, type, series, sequence, invoice_number, issued_at, issuer_tax_id, issuer_name, tax_base, tax_total, total, issued_by_user_name, issued_by_at)
                 VALUES ($1,$2,$3,$4,'F2','TEST',1,'TEST-000001',$5,'B12345678','Cañas y Tapas',15.38,1.54,16.92,'Pablo',$5)`, [inv, store, acc, order, now]);
  await c.query(`INSERT INTO invoice_tax (invoice_id, rate, store_id, base, tax) VALUES ($1,10,$2,15.38,1.54)`, [inv, store]);
  return { store, period, order, acc, inv };
}
