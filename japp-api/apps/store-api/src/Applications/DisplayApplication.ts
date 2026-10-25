import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Database, Db, Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;
type Row = Record<string, any>;

export interface MediaRow {
  id: string;
  kind: "video" | "image";
  name: string;
  mime: string;
  size: number;
  duration: number | null;
  sha256: string;
  days: number[];
  from: string | null;
  to: string | null;
  active: boolean;
  sortOrder: number;
}
export interface NewMedia {
  id: string;
  kind: "video" | "image";
  name: string;
  mime: string;
  size: number;
  duration: number | null;
  sha256: string;
  by: string;
}

const toMedia = (r: Row): MediaRow => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  mime: r.mime,
  size: Number(r.size_bytes),
  duration: r.duration_s == null ? null : Number(r.duration_s),
  sha256: r.sha256,
  days: (r.days ?? []).map(Number),
  from: r.time_from ? String(r.time_from).slice(0, 5) : null,
  to: r.time_to ? String(r.time_to).slice(0, 5) : null,
  active: !!r.active,
  sortOrder: Number(r.sort_order),
});

/** Segunda pantalla del cliente en la base: customer_display (configuración y versión) y display_media (la lista). */
@Injectable()
export class DisplayApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async rows(q: Q, query: SQL): Promise<Row[]> {
    return (await q.execute(query)).rows as Row[];
  }

  async config(storeId: string, q: Q = this.database.db): Promise<{ config: unknown; version: number } | null> {
    const r = (await this.rows(q, sql`SELECT config, version FROM customer_display WHERE store_id = ${storeId}`))[0];
    return r ? { config: r.config, version: Number(r.version) } : null;
  }

  /** La fila de la tienda (si no existe, se crea con la versión 1) y bloqueada para escribir. */
  async lock(tx: Tx, storeId: string): Promise<{ config: unknown; version: number }> {
    await tx.execute(sql`INSERT INTO customer_display (store_id) VALUES (${storeId}) ON CONFLICT (store_id) DO NOTHING`);
    const r = (await this.rows(tx, sql`SELECT config, version FROM customer_display WHERE store_id = ${storeId} FOR UPDATE`))[0]!;
    return { config: r.config, version: Number(r.version) };
  }

  async save(tx: Tx, storeId: string, config: unknown, version: number, by: string) {
    await tx.execute(
      sql`UPDATE customer_display SET config = ${JSON.stringify(config)}::jsonb, version = ${version}, updated_by = ${by} WHERE store_id = ${storeId}`,
    );
  }

  async media(storeId: string, q: Q = this.database.db): Promise<MediaRow[]> {
    return (
      await this.rows(
        q,
        sql`SELECT * FROM display_media WHERE store_id = ${storeId} AND deleted_at IS NULL ORDER BY sort_order, created_at`,
      )
    ).map(toMedia);
  }

  async mediaById(storeId: string, id: string, q: Q = this.database.db): Promise<MediaRow | null> {
    const r = (
      await this.rows(q, sql`SELECT * FROM display_media WHERE store_id = ${storeId} AND id = ${id} AND deleted_at IS NULL`)
    )[0];
    return r ? toMedia(r) : null;
  }

  async insertMedia(tx: Tx, storeId: string, m: NewMedia) {
    await tx.execute(sql`INSERT INTO display_media (id, store_id, kind, name, mime, size_bytes, duration_s, sha256, sort_order, created_by)
      VALUES (${m.id}, ${storeId}, ${m.kind}, ${m.name}, ${m.mime}, ${m.size}, ${m.duration}, ${m.sha256},
        (SELECT coalesce(max(sort_order), 0) + 1 FROM display_media WHERE store_id = ${storeId} AND deleted_at IS NULL), ${m.by})`);
  }

  async schedule(
    tx: Tx,
    storeId: string,
    id: string,
    s: { days: number[]; from: string | null; to: string | null; active: boolean },
    sortOrder: number,
  ) {
    const days = sql.raw(`ARRAY[${s.days.map((d) => Number(d)).join(",")}]::SMALLINT[]`);
    await tx.execute(
      sql`UPDATE display_media SET days = ${days}, time_from = ${s.from}, time_to = ${s.to}, active = ${s.active}, sort_order = ${sortOrder} WHERE store_id = ${storeId} AND id = ${id}`,
    );
  }

  /** Quita un archivo de la lista (deleted_at; la fila queda). Devuelve si existía. */
  async remove(tx: Tx, storeId: string, id: string): Promise<boolean> {
    const r = await this.rows(
      tx,
      sql`UPDATE display_media SET deleted_at = now() WHERE store_id = ${storeId} AND id = ${id} AND deleted_at IS NULL RETURNING id`,
    );
    return r.length > 0;
  }
}
