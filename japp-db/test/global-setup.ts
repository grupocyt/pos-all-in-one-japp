import type { GlobalSetupContext } from "vitest/node";
// @ts-ignore — módulo JS de scripts/
import { createDatabase, dropDatabase } from "../scripts/db.mjs";
// @ts-ignore
import { loadEnv } from "../scripts/env.mjs";

declare module "vitest" { export interface ProvidedContext { dbUrl: string } }

/** Crea una base temporal japp_test_<n> con esquema + datos de arranque; la borra al acabar. */
export default async function ({ provide }: GlobalSetupContext) {
  loadEnv();
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!admin) throw new Error("Falta DATABASE_ADMIN_URL (copia .env.example a .env y levanta la base con npm run db:up)");
  const name = `japp_test_${process.pid}`;
  provide("dbUrl", await createDatabase(admin, name));
  return async () => { if (!process.env.KEEP_TEST_DB) await dropDatabase(admin, name); };
}
