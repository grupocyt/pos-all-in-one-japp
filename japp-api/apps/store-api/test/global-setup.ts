import type { GlobalSetupContext } from "vitest/node";
import { existsSync, readFileSync } from "node:fs";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

/**
 * Base temporal creada con el SQL de japp-db (repo hermano): esquema + datos de arranque + migraciones.
 * Así las pruebas del back corren siempre contra el mismo esquema que se instala en tienda.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const env = new URL("../../../.env", import.meta.url);
  if (existsSync(env)) {
    for (const l of readFileSync(env, "utf8").split("\n")) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !(m[1]! in process.env)) {
        process.env[m[1]!] = m[2];
      }
    }
  }
  const dbScripts = new URL("../../../../japp-db/scripts/db.mjs", import.meta.url);
  if (!existsSync(dbScripts)) {
    throw new Error("No encuentro ../japp-db: deja japp-db y japp-api en la misma carpeta");
  }
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!admin) {
    throw new Error("Falta DATABASE_ADMIN_URL en japp-api/.env (mira .env.example)");
  }
  const { createDatabase, dropDatabase } = await import(dbScripts.href);
  const name = `japp_api_test_${process.pid}`;
  provide("dbUrl", await createDatabase(admin, name));
  return async () => {
    if (!process.env.KEEP_TEST_DB) {
      await dropDatabase(admin, name);
    }
  };
}
