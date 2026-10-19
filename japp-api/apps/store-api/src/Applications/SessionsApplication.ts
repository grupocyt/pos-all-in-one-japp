import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import type { ActiveSession } from "@japp/domain";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../Constants/Injection.js";

/** Caché corta en el proceso: la base (app_session) manda; aquí solo se evita una consulta por petición. */
const CACHE_MS = 2000;

/**
 * Una sesión activa por usuario, guardada en app_session (migración 0009): la vigente es la que tiene ended_at NULL.
 * Sobrevive a reinicios de la API: un token sustituido no vuelve a valer.
 */
@Injectable()
export class SessionsApplication {
  private cache = new Map<string, { v: ActiveSession | null; at: number }>();
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async get(storeId: string, userId: string): Promise<ActiveSession | null> {
    const k = `${storeId}|${userId}`;
    const hit = this.cache.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return hit.v;
    }
    const [r] = (
      await this.database.db
        .execute(sql`SELECT id::text jti, station_id::text station_id, station_name FROM app_session
      WHERE store_id = ${storeId} AND user_id = ${userId} AND ended_at IS NULL`)
    ).rows as { jti: string; station_id: string | null; station_name: string }[];
    const v = r ? { jti: r.jti, stationId: r.station_id ?? "", stationName: r.station_name } : null;
    this.cache.set(k, { v, at: Date.now() });
    return v;
  }

  /** Nueva sesión del usuario (dentro de la transacción del login): cierra la vigente como «replaced» y devuelve la anterior. */
  async replace(
    tx: Tx,
    storeId: string,
    userId: string,
    s: ActiveSession & { expiresAt: string },
  ): Promise<ActiveSession | null> {
    const [prev] = (
      await tx.execute(sql`UPDATE app_session SET ended_at = now(), ended_reason = 'replaced', replaced_by_id = ${s.jti}
      WHERE store_id = ${storeId} AND user_id = ${userId} AND ended_at IS NULL RETURNING id::text jti, station_id::text station_id, station_name`)
    ).rows as { jti: string; station_id: string | null; station_name: string }[];
    await tx.execute(sql`INSERT INTO app_session (id, store_id, user_id, station_id, station_name, expires_at)
      VALUES (${s.jti}, ${storeId}, ${userId}, ${s.stationId}, ${s.stationName}, ${s.expiresAt}::timestamptz)`);
    return prev ? { jti: prev.jti, stationId: prev.station_id ?? "", stationName: prev.station_name } : null;
  }

  /** Tras el COMMIT del login o de salir: la caché ya sabe cuál vale. */
  remember(storeId: string, userId: string, v: ActiveSession | null) {
    this.cache.set(`${storeId}|${userId}`, { v, at: Date.now() });
  }

  /** Salir: la sesión deja de valer. */
  async end(storeId: string, userId: string, jti: string) {
    await this.database.db.execute(
      sql`UPDATE app_session SET ended_at = now(), ended_reason = 'logout' WHERE store_id = ${storeId} AND user_id = ${userId} AND id = ${jti} AND ended_at IS NULL`,
    );
    this.remember(storeId, userId, null);
  }

  // ---- Bloqueo de PIN (pin_attempt, migración 0009): una fila por clave (device:<UUID>, station:<id>, user:<id>) ----

  /** Las claves como text[] de PostgreSQL. */
  private keysOf(keys: string[]) {
    return sql`ANY(${"{" + keys.map((k) => `"${k.replace(/"/g, "")}"`).join(",") + "}"}::text[])`;
  }

  /** Hasta cuándo está bloqueado el teclado (la mayor de las claves bloqueadas), o null. */
  async pinLockedUntil(storeId: string, keys: string[], at: string): Promise<string | null> {
    const [locked] = (
      await this.database.db.execute(
        sql`SELECT max(locked_until) until FROM pin_attempt WHERE store_id = ${storeId} AND key = ${this.keysOf(keys)} AND locked_until > ${at}::timestamptz`,
      )
    ).rows as { until: string | null }[];
    return locked?.until ?? null;
  }

  /** Clave correcta: se ponen a cero los fallos de esas claves. */
  async resetPinFailures(storeId: string, keys: string[]) {
    await this.database.db.execute(
      sql`UPDATE pin_attempt SET failures = 0, locked_until = NULL WHERE store_id = ${storeId} AND key = ${this.keysOf(keys)} AND (failures > 0 OR locked_until IS NOT NULL)`,
    );
  }

  /** Un fallo más en esa clave; devuelve cuántos lleva. Tras un bloqueo ya pasado se empieza a contar de nuevo. */
  async addPinFailure(storeId: string, key: string): Promise<number> {
    const [r] = (
      await this.database.db
        .execute(sql`INSERT INTO pin_attempt (store_id, key, failures) VALUES (${storeId}, ${key}, 1)
        ON CONFLICT (store_id, key) DO UPDATE SET failures = CASE WHEN pin_attempt.locked_until IS NOT NULL THEN 1 ELSE pin_attempt.failures + 1 END, locked_until = NULL
        RETURNING failures`)
    ).rows as { failures: number }[];
    return Number(r!.failures);
  }

  /** Bloquea el teclado de esa clave hasta «until». */
  async lockPin(storeId: string, key: string, until: string) {
    await this.database.db.execute(
      sql`UPDATE pin_attempt SET failures = 0, locked_until = ${until}::timestamptz WHERE store_id = ${storeId} AND key = ${key}`,
    );
  }

  // ---- Mesas del equipo anterior al entrar en otro ----

  /** Suelta las mesas (y su cobro abierto) que el usuario tenía desde esa estación; devuelve las órdenes soltadas. */
  async releaseTables(tx: Tx, storeId: string, userId: string, oldStation: string): Promise<string[]> {
    const ids = (
      await tx.execute(sql`UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL
        WHERE store_id = ${storeId} AND holder_user_id = ${userId} AND holder_station_id = ${oldStation} RETURNING id::text`)
    ).rows as { id: string }[];
    return ids.map((o) => o.id);
  }

  /** Evento «tableReleased» de una orden soltada. */
  async addReleasedEvent(
    tx: Tx,
    storeId: string,
    orderId: string,
    description: string,
    a: { at: string; userId: string; userName: string; role: string; device: string },
  ) {
    await tx.execute(sql`INSERT INTO order_event (id, store_id, order_id, type, description, at, user_id, user_name, role, device)
        VALUES (${randomUUID()}, ${storeId}, ${orderId}, 'tableReleased', ${description}, ${a.at}, ${a.userId}, ${a.userName}, ${a.role}, ${a.device})`);
  }
}
