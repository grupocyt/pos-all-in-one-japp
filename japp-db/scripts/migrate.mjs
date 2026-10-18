// npm run db:migrate → aplica migrations/NNNN_*.sql pendientes sobre DATABASE_URL (seguro en tiendas: solo añade).
import pg from "pg";
import { loadEnv } from "./env.mjs";
import { migrate } from "./db.mjs";
loadEnv();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  const done = await migrate(c, m => console.log(`✓ ${m}`));
  console.log(done.length ? `${done.length} migraciones aplicadas.` : "Nada pendiente.");
} catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; } finally { await c.end(); }
