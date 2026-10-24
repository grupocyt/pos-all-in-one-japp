// npm run db:init → deja la base de DATABASE_URL lista sin borrar nada:
//   1) si está vacía, aplica la línea base (01_esquema) y, con SEED=1, los datos de arranque de la Sucursal Pruebas (02);
//   2) aplica las migraciones pendientes.
//   3) solo si la base se acaba de crear con SEED=1: los datos de la tienda nueva (sql/04_datos_tienda_inicial.sql), después de las migraciones.
// STORE_CODE=CT05 (opcional, al crear con SEED=1): la tienda se crea con ese código en vez del de 04 (JC01).
// Es lo que ejecuta el contenedor de la API al arrancar. Seguro de repetir.
import pg from "pg";
import { loadEnv } from "./env.mjs";
import { migrate, readSql } from "./db.mjs";
loadEnv();
const seed = ["1", "true", "si", "sí"].includes(String(process.env.SEED ?? "").trim().toLowerCase()); // «set SEED=1 && …» en CMD deja un espacio al final
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  const { rows } = await c.query("SELECT to_regclass('public.store') IS NOT NULL AS ok");
  const fresh = !rows[0].ok;
  if (fresh) {
    await c.query("BEGIN");
    await c.query(readSql("01_esquema_postgres.sql"));
    if (seed) {
      await c.query(readSql("02_datos_arranque_postgres.sql"));
    }
    await c.query("COMMIT");
    console.log(`✓ línea base aplicada${seed ? " con la carta y los datos de arranque" : ""}`);
  } else console.log("· la base ya tiene esquema");
  const done = await migrate(c, m => console.log(`✓ ${m}`));
  console.log(done.length ? `${done.length} migraciones aplicadas` : "· sin migraciones pendientes");
  if (fresh && seed) {
    await c.query("BEGIN");
    await c.query(readSql("04_datos_tienda_inicial.sql"));
    const code = process.env.STORE_CODE?.trim();
    if (code) await c.query("UPDATE store SET code = $1", [code]);
    await c.query("COMMIT");
    const s = (await c.query("SELECT code, name FROM store")).rows[0];
    console.log(`✓ datos de la tienda nueva: ${s.code} · ${s.name}`);
  }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error(`✗ ${e.message}`); process.exitCode = 1; } finally { await c.end(); }
