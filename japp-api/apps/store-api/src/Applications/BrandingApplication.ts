import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database, Db, Tx } from "@japp/db";
import type { Branding } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;

/** Fila de system_branding ya traducida (null = la tienda no tiene fila: los originales). */
export interface BrandingRow extends Branding {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Ajustes › Administración › Sistema en la base (system_branding, una fila por tienda). */
@Injectable()
export class BrandingApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async find(storeId: string, q: Q = this.database.db, lock = false): Promise<BrandingRow | null> {
    const r = (
      await q.execute(
        sql`SELECT name, subtitle, login_group, logo, no_image, palette, colors, version, updated_at, updated_by
            FROM system_branding WHERE store_id = ${storeId}${sql.raw(lock ? " FOR UPDATE" : "")}`,
      )
    ).rows[0] as Record<string, any> | undefined;
    if (!r) {
      return null;
    }
    return {
      name: r.name,
      subtitle: r.subtitle,
      loginGroup: r.login_group,
      logo: r.logo,
      noImage: r.no_image,
      palette: r.palette,
      colors: r.colors,
      version: Number(r.version),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      updatedBy: r.updated_by,
    };
  }

  /** Alta o cambio de la fila de la tienda con la versión nueva. */
  async save(tx: Tx, storeId: string, b: Branding, version: number, by: string) {
    await tx.execute(
      sql`INSERT INTO system_branding (store_id, name, subtitle, login_group, logo, no_image, palette, colors, version, updated_by)
          VALUES (${storeId}, ${b.name}, ${b.subtitle}, ${b.loginGroup}, ${b.logo}, ${b.noImage},
                  ${JSON.stringify(b.palette)}::jsonb, ${JSON.stringify(b.colors)}::jsonb, ${version}, ${by})
          ON CONFLICT (store_id) DO UPDATE SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
            login_group = EXCLUDED.login_group, logo = EXCLUDED.logo, no_image = EXCLUDED.no_image,
            palette = EXCLUDED.palette, colors = EXCLUDED.colors, version = EXCLUDED.version, updated_by = EXCLUDED.updated_by`,
    );
  }
}
