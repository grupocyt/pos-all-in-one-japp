import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

/** Lo guardado de una clave: el hash de la petición, el código (0 = en curso) y la respuesta. */
export interface IdempotencyRow {
  request_hash: string;
  status_code: number;
  response: unknown;
}

/** Tabla idempotency_key: reservas y respuestas guardadas de los POST con Idempotency-Key. Fuera de transacción. */
@Injectable()
export class IdempotencyApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Reserva la clave (status_code 0 = en curso). true si esta petición se la ha quedado. */
  async reserve(storeId: string, key: string, method: string, path: string, hash: string) {
    const r = await this.database.db
      .execute(sql`INSERT INTO idempotency_key (store_id, key, method, path, request_hash, status_code, response)
        VALUES (${storeId}, ${key}, ${method}, ${path}, ${hash}, 0, '{}'::jsonb) ON CONFLICT DO NOTHING RETURNING key`);
    return r.rows.length > 0;
  }

  /** La petición original murió sin terminar: se toma su reserva si es más vieja que staleSeconds. */
  async takeStale(storeId: string, key: string, hash: string, staleSeconds: number) {
    const r = await this.database.db
      .execute(sql`UPDATE idempotency_key SET created_at = now(), request_hash = ${hash} WHERE store_id = ${storeId} AND key = ${key}
            AND status_code = 0 AND created_at < now() - make_interval(secs => ${staleSeconds}) RETURNING key`);
    return r.rows.length > 0;
  }

  /** La acción falló: se borra la reserva (un error se puede reintentar). */
  async release(storeId: string, key: string) {
    await this.database.db.execute(
      sql`DELETE FROM idempotency_key WHERE store_id = ${storeId} AND key = ${key} AND status_code = 0`,
    );
  }

  /** La acción terminó bien: se guarda su respuesta. */
  async complete(storeId: string, key: string, status: number, body: unknown) {
    await this.database.db
      .execute(sql`UPDATE idempotency_key SET status_code = ${status}, response = ${JSON.stringify(body ?? null)}::jsonb
          WHERE store_id = ${storeId} AND key = ${key}`);
  }

  /** Limpieza de claves terminadas de más de 7 días. */
  async purgeOld() {
    await this.database.db.execute(
      sql`DELETE FROM idempotency_key WHERE created_at < now() - interval '7 days' AND status_code <> 0`,
    );
  }

  async find(storeId: string, key: string): Promise<IdempotencyRow | undefined> {
    const [prev] = (
      await this.database.db.execute(
        sql`SELECT request_hash, status_code, response FROM idempotency_key WHERE store_id = ${storeId} AND key = ${key}`,
      )
    ).rows as unknown as IdempotencyRow[];
    return prev;
  }
}
