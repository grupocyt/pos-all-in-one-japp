import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";

const root = new URL("../sql/", import.meta.url);
export const SQL_FILES = ["01_esquema_postgres.sql", "02_datos_arranque_postgres.sql"];
export const readSql = (f) => readFileSync(new URL(f, root), "utf8");
export const verificationQueries = () =>
  readdirSync(new URL("verificacion/", root)).filter(f => f.endsWith(".sql")).sort()
    .map(f => ({ name: f.replace(/\.sql$/, ""), sql: readFileSync(new URL(`verificacion/${f}`, root), "utf8") }));

const migDir = new URL("../migrations/", import.meta.url);
export const migrationFiles = () => existsSync(migDir)
  ? readdirSync(migDir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort().map(f => {
      const sql = readFileSync(new URL(f, migDir), "utf8");
      return { version: f.slice(0, 4), name: f, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    })
  : [];

/**
 * Aplica las migraciones pendientes (cada una en su transacción) y registra versión + checksum.
 * Se niega a seguir si una migración ya aplicada cambió: las migraciones instaladas no se editan.
 */
export async function migrate(client, log = () => {}) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version CHAR(4) PRIMARY KEY, name VARCHAR(200) NOT NULL, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ(3) NOT NULL DEFAULT now())`);
  await client.query("SELECT pg_advisory_lock(727270)"); // dos procesos a la vez no migran dos veces
  try {
    const done = new Map((await client.query("SELECT version, checksum FROM schema_migrations")).rows.map(r => [r.version, r.checksum]));
    const applied = [];
    for (const m of migrationFiles()) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.checksum) throw new Error(`La migración ${m.name} ya aplicada ha cambiado (checksum distinto). Crea una nueva en vez de editarla.`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1,$2,$3)", [m.version, m.name, m.checksum]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw new Error(`Falló ${m.name}: ${e.message}`); }
      applied.push(m.name); log(`aplicada ${m.name}`);
    }
    return applied;
  } finally { await client.query("SELECT pg_advisory_unlock(727270)"); }
}

/** Cambia el nombre de la base en una URL de conexión. */
export const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

/** Borra (si existe) y crea la base `name`, aplica esquema + datos de arranque + migraciones. Devuelve su URL. */
export async function createDatabase(adminUrl, name) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
  } finally { await admin.end(); }
  const url = withDb(adminUrl, name);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { for (const f of SQL_FILES) await c.query(readSql(f)); await migrate(c); } finally { await c.end(); }
  return url;
}

export async function dropDatabase(adminUrl, name) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await admin.end(); }
}
