// npm run db:init → deja la base de DATABASE_URL lista sin borrar nada:
//   1) si está vacía, aplica la línea base (01_esquema) y, con SEED=1, los datos de arranque de la Sucursal Pruebas (02);
//   2) aplica las migraciones pendientes.
// STORE_CODE=CT05 (opcional, al crear con SEED=1): la tienda de arranque se crea con ese código en vez de «CT 03».
// Es lo que ejecuta el contenedor de la API al arrancar. Seguro de repetir.
import pg from "pg";
import { loadEnv } from "./env.mjs";
import { migrate, readSql } from "./db.mjs";
loadEnv();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  const { rows } = await c.query("SELECT to_regclass('public.store') IS NOT NULL AS ok");
  if (!rows[0].ok) {
    await c.query("BEGIN");
    await c.query(readSql("01_esquema_postgres.sql"));
    if (process.env.SEED === "1") {
      await c.query(readSql("02_datos_arranque_postgres.sql"));
      const code = process.env.STORE_CODE?.trim();
      if (code) await c.query("UPDATE store SET code = $1", [code]);
    }
    await c.query("COMMIT");
    console.log(`✓ línea base aplicada${process.env.SEED === "1" ? " con datos de arranque (Sucursal Pruebas)" : ""}`);
  } else console.log("· la base ya tiene esquema");
  const done = await migrate(c, m => console.log(`✓ ${m}`));
  console.log(done.length ? `${done.length} migraciones aplicadas` : "· sin migraciones pendientes");
} catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error(`✗ ${e.message}`); process.exitCode = 1; } finally { await c.end(); }
