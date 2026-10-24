import { inject } from "vitest";
import { connect, all, one, n } from "./db.js";

/** La forma de la base: si alguien cambia el esquema sin respetar las convenciones, falla aquí. */
let c: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { c = await connect(inject("dbUrl")); });
afterAll(async () => { await c.end(); });

const cols = () => all(c, `SELECT table_name t, column_name col, data_type type, is_nullable FROM information_schema.columns WHERE table_schema='public'`);

describe("estructura", () => {
  it("50 tablas de la línea base + idempotency_key (0001) + 4 de la 0005 + 2 de la 0009 + oot_token e invoice_credit_line (0012) + order_incident (0015) + schema_migrations, todas con clave primaria", async () => {
    const t = await all(c, `SELECT tablename FROM pg_tables WHERE schemaname='public'`);
    expect(t).toHaveLength(61);
    const sinPk = await all(c, `SELECT c.relname FROM pg_class c WHERE c.relkind='r' AND c.relnamespace='public'::regnamespace
                                AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p')`);
    expect(sinPk).toEqual([]);
  });
  it("al menos 127 claves foráneas, y todas con índice en la columna de origen", async () => {
    expect(n((await one(c, `SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`)).count)).toBeGreaterThanOrEqual(127);
    const sinIndice = await all(c, `
      SELECT k.conrelid::regclass::text AS tabla, a.attname AS columna
      FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=k.conkey[1]
      WHERE k.contype='f' AND k.connamespace='public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=k.conrelid AND i.indkey[0]=k.conkey[1])`);
    // Si esto falla, añade CREATE INDEX: sin índice, borrar/actualizar el padre recorre toda la tabla hija.
    expect(sinIndice).toEqual([]);
  });
  it("todas las tablas salvo company, permission, schema_migrations y store llevan store_id", async () => {
    const t = await all(c, `SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND tablename NOT IN (SELECT table_name FROM information_schema.columns WHERE column_name='store_id' AND table_schema='public') ORDER BY 1`);
    expect(t.map(x => x.tablename)).toEqual(["company", "permission", "schema_migrations", "store"]); // store es la raíz: su id ES el store_id
  });
  it("dinero siempre NUMERIC (nunca float/real/money)", async () => {
    const money = /(^|_)(amount|price|total|subtotal|paid|pending|tip|tips|base|tax|tax_total|tax_base|cash_given|change_given|value|cash_float)$/;
    const bad = (await cols()).filter(r => money.test(r.col) && !["numeric", "smallint", "integer", "boolean"].includes(r.type));
    expect(bad).toEqual([]);
    const floats = (await cols()).filter(r => ["real", "double precision", "money"].includes(r.type));
    expect(floats).toEqual([]);
  });
  it("fechas siempre con zona (TIMESTAMPTZ), nunca timestamp a secas", async () => {
    expect((await cols()).filter(r => r.type === "timestamp without time zone")).toEqual([]);
  });
  it("ids UUID salvo sync_outbox (bigserial, orden de envío)", async () => {
    const bad = (await cols()).filter(r => r.col === "id" && r.type !== "uuid");
    expect(bad.map(r => r.t)).toEqual(["sync_outbox"]);
  });
  it("las tablas con updated_at tienen el trigger que lo mantiene", async () => {
    const t = await all(c, `SELECT table_name FROM information_schema.columns WHERE column_name='updated_at' AND table_schema='public'
      AND table_name NOT IN (SELECT event_object_table FROM information_schema.triggers WHERE trigger_name LIKE 'trg_%_updated_at')`);
    expect(t).toEqual([]);
  });
  it("solo un periodo abierto por tienda (índice único con open_flag)", async () => {
    const r = await one(c, `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='uq_sales_period_store_id_open_flag'`);
    expect(r.d).toBe("UNIQUE (store_id, open_flag)");
  });
});
