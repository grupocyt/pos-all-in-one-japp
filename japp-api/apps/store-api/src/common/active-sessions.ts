import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@japp/db";
import type { ActiveSession } from "@japp/domain";
import { DATABASE } from "./tokens-di.js";

/** Caché corta en el proceso: la base (app_session) manda; aquí solo se evita una consulta por petición. */
const CACHE_MS = 2000;

/**
 * Una sesión activa por usuario, guardada en app_session (migración 0009): la vigente es la que tiene ended_at NULL.
 * Sobrevive a reinicios de la API: un token sustituido no vuelve a valer.
 */
@Injectable()
export class ActiveSessions {
  private cache = new Map<string, { v: ActiveSession | null; at: number }>();
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async get(storeId: string, userId: string): Promise<ActiveSession | null> {
    const k = `${storeId}|${userId}`, hit = this.cache.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
    const [r] = (await this.database.db.execute(sql`SELECT id::text jti, station_id::text station_id, station_name FROM app_session
      WHERE store_id = ${storeId} AND user_id = ${userId} AND ended_at IS NULL`)).rows as { jti: string; station_id: string | null; station_name: string }[];
    const v = r ? { jti: r.jti, stationId: r.station_id ?? "", stationName: r.station_name } : null;
    this.cache.set(k, { v, at: Date.now() });
    return v;
  }

  /** Nueva sesión del usuario (dentro de la transacción del login): cierra la vigente como «replaced» y devuelve la anterior. */
  async replace(tx: Tx, storeId: string, userId: string, s: ActiveSession & { expiresAt: string }): Promise<ActiveSession | null> {
    const [prev] = (await tx.execute(sql`UPDATE app_session SET ended_at = now(), ended_reason = 'replaced', replaced_by_id = ${s.jti}
      WHERE store_id = ${storeId} AND user_id = ${userId} AND ended_at IS NULL RETURNING id::text jti, station_id::text station_id, station_name`)).rows as { jti: string; station_id: string | null; station_name: string }[];
    await tx.execute(sql`INSERT INTO app_session (id, store_id, user_id, station_id, station_name, expires_at)
      VALUES (${s.jti}, ${storeId}, ${userId}, ${s.stationId}, ${s.stationName}, ${s.expiresAt}::timestamptz)`);
    return prev ? { jti: prev.jti, stationId: prev.station_id ?? "", stationName: prev.station_name } : null;
  }

  /** Tras el COMMIT del login o de salir: la caché ya sabe cuál vale. */
  remember(storeId: string, userId: string, v: ActiveSession | null) { this.cache.set(`${storeId}|${userId}`, { v, at: Date.now() }); }

  /** Salir: la sesión deja de valer. */
  async end(storeId: string, userId: string, jti: string) {
    await this.database.db.execute(sql`UPDATE app_session SET ended_at = now(), ended_reason = 'logout' WHERE store_id = ${storeId} AND user_id = ${userId} AND id = ${jti} AND ended_at IS NULL`);
    this.remember(storeId, userId, null);
  }
}
