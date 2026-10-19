import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Database, Db, Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;
type Row = Record<string, any>;

/** Una entrada del historial de Ajustes (config_change_log). */
export interface ChangeLogEntry {
  storeId: string;
  at: string;
  userId?: string;
  userName: string;
  module: string;
  action: string;
  recordName: string;
  diff: string;
  recordId: string;
  before: unknown;
  after: unknown;
  configVersion: number;
  device?: string;
}

/** Una incidencia de producto para Marketing (product_incident). */
export interface ProductIncident {
  storeId: string;
  code: string;
  at: string;
  userName: string;
  productId: string;
  productName: string;
  action: string;
  diff: string;
}

/** Ajustes en la base: versión de configuración, historial, cola hacia el Manager e incidencias de producto. */
@Injectable()
export class ConfigHistoryApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async rows(q: Q, query: SQL): Promise<Row[]> {
    return (await q.execute(query)).rows as Row[];
  }

  /** Versión de configuración de la tienda (ETag de GET /config). */
  async configVersion(storeId: string, q: Q = this.database.db): Promise<number> {
    return Number(
      (await this.rows(q, sql`SELECT config_version FROM store WHERE id = ${storeId}`))[0]!.config_version,
    );
  }

  /** store.config_version + 1; devuelve la nueva. */
  async bumpConfigVersion(tx: Tx, storeId: string): Promise<number> {
    return Number(
      (
        await this.rows(
          tx,
          sql`UPDATE store SET config_version = config_version + 1 WHERE id = ${storeId} RETURNING config_version`,
        )
      )[0]!.config_version,
    );
  }

  async insertChangeLog(tx: Tx, e: ChangeLogEntry) {
    await tx.execute(
      sql`INSERT INTO config_change_log (id, store_id, at, user_id, user_name, module, action, record_name, diff, record_id, before, after, config_version, device) VALUES (${crypto.randomUUID()},${e.storeId},${e.at},${e.userId ?? null},${e.userName},${e.module},${e.action},${e.recordName},${e.diff},${e.recordId},${JSON.stringify(e.before)},${JSON.stringify(e.after)},${e.configVersion},${e.device ?? null})`,
    );
  }

  /** Cola hacia el Manager (entity = 'config'). */
  async enqueueConfig(tx: Tx, storeId: string, entityId: string, payload: unknown) {
    await tx.execute(
      sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES (${storeId}, 'config', ${entityId}, 'upsert', ${JSON.stringify(payload)})`,
    );
  }

  /** Código correlativo de incidencia: uno a la vez por tienda (sin repetidos con dos cambios a la vez). Devuelve el número siguiente. */
  async lockAndNextIncidentNumber(tx: Tx, storeId: string): Promise<number> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('incident:' || ${storeId}))`);
    return Number(
      (await this.rows(tx, sql`SELECT count(*) + 1 n FROM product_incident WHERE store_id = ${storeId}`))[0]!
        .n,
    );
  }

  async insertProductIncident(tx: Tx, i: ProductIncident) {
    await tx.execute(
      sql`INSERT INTO product_incident (id, store_id, code, at, user_name, product_id, product_name, action, diff, status) VALUES (${crypto.randomUUID()},${i.storeId},${i.code},${i.at},${i.userName},${i.productId},${i.productName},${i.action},${i.diff},'pending')`,
    );
  }

  /** Una página del historial, la más reciente primero (una fila de más para saber si hay página siguiente). */
  async history(
    storeId: string,
    o: { module?: string; recordId?: string; limit: number; offset: number },
    q: Q = this.database.db,
  ) {
    const w: SQL[] = [sql`store_id = ${storeId}`];
    if (o.module) {
      w.push(sql`module = ${o.module}`);
    }
    if (o.recordId) {
      w.push(sql`record_id = ${o.recordId}`);
    }
    const rows = await this.rows(
      q,
      sql`SELECT id::text, at, user_name, device, module, action, record_name, record_id, diff, config_version, synced_at FROM config_change_log WHERE ${sql.join(w, sql` AND `)} ORDER BY at DESC, config_version DESC NULLS LAST LIMIT ${sql.raw(String(o.limit + 1))} OFFSET ${sql.raw(String(o.offset))}`,
    );
    return {
      items: rows.slice(0, o.limit).map((r) => ({
        id: r.id as string,
        at: new Date(r.at).toISOString(),
        user: r.user_name,
        device: r.device,
        module: r.module,
        action: r.action,
        record: r.record_name,
        recordId: r.record_id,
        diff: r.diff,
        configVersion: r.config_version == null ? null : Number(r.config_version),
        syncedAt: r.synced_at ? new Date(r.synced_at).toISOString() : null,
      })),
      more: rows.length > o.limit,
    };
  }
}
