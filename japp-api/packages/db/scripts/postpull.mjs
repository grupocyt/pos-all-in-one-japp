// Tras drizzle-kit pull: deja schema.ts y relations.ts en src/schema/ y descarta el SQL que genera
// (las migraciones viven en japp-db, nunca aquí).
import { renameSync, rmSync, readFileSync, writeFileSync } from "node:fs";
const head = "// ⚠️ GENERADO con `npm run db:pull` desde la base de japp-db. No editar a mano.\n";
for (const f of ["schema.ts", "relations.ts"]) {
  const src = new URL(`../drizzle/${f}`, import.meta.url), dst = new URL(`../src/schema/${f}`, import.meta.url);
  let s = readFileSync(src, "utf8").replace('from "./schema"', 'from "./schema.js"');
  writeFileSync(dst, head + s); rmSync(src);
}
rmSync(new URL("../drizzle", import.meta.url), { recursive: true, force: true });
console.log("Esquema Drizzle actualizado en src/schema/");
