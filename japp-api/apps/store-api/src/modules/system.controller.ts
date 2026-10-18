import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema as s, type Database } from "@japp/db";
import { fail } from "@japp/domain";
import { CONFIG, DATABASE } from "../common/tokens-di.js";
import { Public } from "../common/auth.js";
import { parse } from "../common/validate.js";
import { StoreRepo } from "../repos/store.repo.js";
import type { Config } from "../config.js";

@Controller()
export class SystemController {
  constructor(@Inject(DATABASE) private readonly database: Database, @Inject(StoreRepo) private readonly stores: StoreRepo, @Inject(CONFIG) private readonly cfg: Config) {}

  /** Latido: lo mismo que se envía al Manager. */
  @Public() @Get("health")
  async health() {
    const db = this.database.db;
    let ok = "ok";
    try { await db.execute(sql`select 1`); } catch { ok = "down"; }
    const store = await this.stores.store().catch(() => null);
    const [pending] = store ? await db.select({ n: count() }).from(s.syncOutbox).where(and(eq(s.syncOutbox.storeId, store.id), isNull(s.syncOutbox.sentAt))) : [{ n: 0 }];
    const [last] = store ? await db.select({ at: s.invoice.issuedAt }).from(s.invoice).where(eq(s.invoice.storeId, store.id)).orderBy(desc(s.invoice.issuedAt)).limit(1) : [];
    return { version: this.cfg.version, db: ok, printers: {}, outboxPending: Number(pending?.n ?? 0), lastInvoiceAt: last ? new Date(last.at).toISOString() : null, time: new Date().toISOString() };
  }

  /** Primer arranque del equipo: se le asigna estación (CAJA1, PDA1…) por su UUID. */
  @Public() @Post("devices/register") @HttpCode(201)
  async register(@Body() body: unknown) {
    const b = parse(z.object({ deviceUuid: z.string().min(8).max(36), kind: z.enum(["desktop", "mobile"]) }), body);
    const store = await this.stores.store();
    const db = this.database.db;
    const all = await db.select().from(s.station).where(and(eq(s.station.storeId, store.id), eq(s.station.active, true)));
    let st = all.find(x => x.deviceUuid === b.deviceUuid);
    if (!st) {
      const kind = b.kind === "mobile" ? "pda" : "station";
      st = all.find(x => x.kind === kind && !x.deviceUuid);
      if (!st) fail("NOT_FOUND", "No queda ninguna estación libre de ese tipo: créala en Ajustes › Estaciones", { kind });
      await db.update(s.station).set({ deviceUuid: b.deviceUuid } as any).where(and(eq(s.station.storeId, store.id), eq(s.station.id, st!.id)));
    }
    return { stationId: st!.id, name: st!.name, kind: st!.kind };
  }
}
