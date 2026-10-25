import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/schema.js";
import * as relations from "./schema/relations.js";

export { schema };
export const fullSchema = { ...schema, ...relations };
export type Db = NodePgDatabase<typeof fullSchema>;
/** Transacción de Drizzle (mismo API que Db). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database {
  pool: pg.Pool;
  /** Dentro de ambient() es la transacción en curso; fuera, el pool. */
  db: Db;
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * Una sola transacción para todo lo que pase dentro de fn (la tanda de comandos de una mesa, POST /orders/{id}/batch):
   * db y withTx usan esa transacción; si fn falla no queda nada.
   */
  ambient<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Pool + Drizzle. Todas las conexiones en UTC.
 * withTx: una transacción READ COMMITTED por comando; los bloqueos se piden explícitamente con FOR UPDATE.
 */
export function createDatabase(url: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString: url, max, options: "-c timezone=UTC" });
  const base = drizzle(pool, { schema: fullSchema });
  const als = new AsyncLocalStorage<Tx>();
  return {
    pool,
    get db() {
      return (als.getStore() as unknown as Db | undefined) ?? base;
    },
    withTx: (fn) => {
      const tx = als.getStore();
      return tx ? fn(tx) : base.transaction(fn);
    },
    ambient: (fn) => {
      if (als.getStore()) {
        return fn();
      }
      return base.transaction((tx) => als.run(tx, fn));
    },
    close: () => pool.end(),
  };
}
