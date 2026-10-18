// npm run verify → pasa las consultas de sql/verificacion contra DATABASE_URL. Sale con código 1 si alguna devuelve filas.
import pg from "pg";
import { loadEnv } from "./env.mjs";
import { verificationQueries } from "./db.mjs";
loadEnv();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
let bad = 0;
for (const q of verificationQueries()) {
  const { rows } = await c.query(q.sql);
  console.log(`${rows.length ? "✗" : "✓"} ${q.name}${rows.length ? ` · ${rows.length} filas` : ""}`);
  if (rows.length) { bad++; console.table(rows.slice(0, 10)); }
}
await c.end();
process.exit(bad ? 1 : 0);
