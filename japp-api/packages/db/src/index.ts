import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/schema.js";
import * as relations from "./schema/relations.js";

export { schema };
export const fullSchema = { ...schema, ...relations };
export type Db = NodePgDatabase<typeof fullSchema>;
/** Transacción de Drizzle (mismo API que Db). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database { pool: pg.Pool; db: Db; withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>; close(): Promise<void>; }

/**
 * Pool + Drizzle. Todas las conexiones en UTC.
 * withTx: una transacción READ COMMITTED por comando; los bloqueos se piden explícitamente con FOR UPDATE.
 */
export function createDatabase(url: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString: url, max, options: "-c timezone=UTC" });
  const db = drizzle(pool, { schema: fullSchema });
  return {
    pool, db,
    withTx: fn => db.transaction(fn),
    close: () => pool.end(),
  };
}
