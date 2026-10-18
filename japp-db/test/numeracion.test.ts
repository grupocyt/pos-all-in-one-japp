import { inject } from "vitest";
import pg from "pg";
import { connect, one, all, n } from "./db.js";

/**
 * Numeración de facturas con varios equipos cobrando a la vez.
 * Con SELECT … FOR UPDATE sobre invoice_series no hay huecos ni repetidos;
 * sin bloqueo, en las pruebas del informe se perdían entre 57 y 157 de 200.
 */
const WORKERS = 8, EACH = 25;
let url: string, c: pg.Client, store: string;
beforeAll(async () => {
  url = inject("dbUrl"); c = await connect(url);
  store = (await one(c, "SELECT id FROM store")).id;
  await c.query(`INSERT INTO invoice_series (store_id, series, kind, last_sequence) VALUES ($1,'CONC','F2',0), ($1,'NOLOCK','F2',0) ON CONFLICT DO NOTHING`, [store]);
});
afterAll(async () => { await c.query("DELETE FROM invoice_series WHERE series IN ('CONC','NOLOCK')"); await c.end(); });

/** Lo que debe hacer el back al emitir: reservar el número dentro de la misma transacción que inserta la factura. */
async function nextNumber(cl: pg.ClientBase, series: string, lock: boolean): Promise<number> {
  await cl.query("BEGIN");
  try {
    const r = await cl.query(`SELECT last_sequence FROM invoice_series WHERE store_id=$1 AND series=$2 ${lock ? "FOR UPDATE" : ""}`, [store, series]);
    const next = r.rows[0].last_sequence + 1;
    await new Promise(res => setTimeout(res, 1)); // simula el trabajo entre leer y escribir
    await cl.query(`UPDATE invoice_series SET last_sequence=$3 WHERE store_id=$1 AND series=$2`, [store, series, next]);
    await cl.query("COMMIT");
    return next;
  } catch (e) { await cl.query("ROLLBACK"); throw e; }
}

async function run(series: string, lock: boolean) {
  const clients = await Promise.all(Array.from({ length: WORKERS }, () => connect(url)));
  try {
    const got = (await Promise.all(clients.map(async cl => { const xs: number[] = []; for (let i = 0; i < EACH; i++) xs.push(await nextNumber(cl, series, lock)); return xs; }))).flat();
    const last = n((await one(c, "SELECT last_sequence FROM invoice_series WHERE series=$1", [series])).last_sequence);
    return { got, last };
  } finally { await Promise.all(clients.map(cl => cl.end())); }
}

describe("numeración de facturas concurrente", () => {
  it(`${WORKERS} equipos × ${EACH} facturas con FOR UPDATE: 1…200 sin huecos ni repetidos`, async () => {
    const { got, last } = await run("CONC", true);
    expect(new Set(got).size).toBe(WORKERS * EACH);
    expect([...got].sort((a, b) => a - b)).toEqual(Array.from({ length: WORKERS * EACH }, (_, i) => i + 1));
    expect(last).toBe(WORKERS * EACH);
  });
  it("sin FOR UPDATE se repiten números (por eso es obligatorio)", async () => {
    const { got, last } = await run("NOLOCK", false);
    expect(new Set(got).size).toBeLessThan(WORKERS * EACH);
    expect(last).toBeLessThan(WORKERS * EACH);
  });
});
