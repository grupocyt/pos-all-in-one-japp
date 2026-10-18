// npm run db:reset → recrea la base de DATABASE_URL desde sql/ (¡borra lo que haya!). Solo para desarrollo.
import { loadEnv } from "./env.mjs";
import { createDatabase, withDb } from "./db.mjs";
loadEnv();
const url = process.env.DATABASE_URL;
if (!url) { console.error("Falta DATABASE_URL (copia .env.example a .env)"); process.exit(1); }
const name = new URL(url).pathname.slice(1);
if (/prod|tienda|ct\d/i.test(name)) { console.error(`Me niego a recrear «${name}»: parece una base real.`); process.exit(1); }
await createDatabase(process.env.DATABASE_ADMIN_URL ?? withDb(url, "postgres"), name);
console.log(`Base «${name}» recreada con esquema y datos de arranque.`);
