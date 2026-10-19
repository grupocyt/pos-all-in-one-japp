import { Inject, Injectable } from "@nestjs/common";
import type { Database, Tx } from "@japp/db";
import type { Actor } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { IncidentsApplication } from "../Applications/IncidentsApplication.js";
import { IncidentsFilterModel, SendIncidentsModel } from "../Models/IncidentsModels.js";

/**
 * Incidencias de productos (cambios hechos en el local para que Marketing los apruebe).
 * Enviar agrupa las pendientes en una solicitud REQ-nnnn, las marca enviadas y la deja en la cola hacia el Manager.
 * sendPending sirve también para el cierre de periodo (trigger period_close), dentro de su transacción.
 */
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(IncidentsApplication) private readonly incidents: IncidentsApplication,
  ) {}

  async list(se: Session, rawStatus?: string) {
    await this.auth.require(se, "ajustes.incidencias");
    const f = parse(IncidentsFilterModel, { status: rawStatus || undefined });
    const rows = await this.incidents.list(se.storeId, f.status);
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        plu: r.plu == null ? null : Number(r.plu),
        product: r.product as string,
        action: r.action as string,
        detail: r.detail as string,
        at: new Date(r.at).toISOString(),
        user: r.user_name ?? null,
        status: r.status as string,
        requestCode: r.request_code ?? null,
      })),
    };
  }

  async send(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.incidencias");
    const b = parse(SendIncidentsModel, body);
    const a = se.actor(this.clock());
    const r = await this.database.withTx((tx) =>
      this.sendPending(tx, se.storeId, a, "manual", b.ids ?? null, b.note ?? null),
    );
    return { request: r.code, sent: r.sent };
  }

  /** Agrupa las pendientes (todas o las de ids) en una solicitud; sin pendientes no crea nada (code null). */
  async sendPending(
    tx: Tx,
    storeId: string,
    a: Actor,
    trigger: "manual" | "period_close",
    ids: string[] | null,
    note: string | null,
  ): Promise<{ code: string | null; sent: number }> {
    // primero el bloqueo de la tienda: dos envíos a la vez no se llevan las mismas ni repiten el código
    const n = await this.incidents.lockAndNextRequestNumber(tx, storeId);
    const pending = await this.incidents.lockPending(tx, storeId, ids);
    if (!pending.length) {
      return { code: null, sent: 0 };
    }
    const id = crypto.randomUUID();
    const code = `REQ-${String(n).padStart(4, "0")}`;
    await this.incidents.insertRequest(tx, { id, storeId, code, trigger, at: a.at, by: a.user });
    await this.incidents.markSent(
      tx,
      storeId,
      id,
      pending.map((p) => p.id as string),
    );
    await this.incidents.enqueue(tx, storeId, id, {
      code,
      trigger,
      sentAt: a.at,
      sentBy: a.user,
      note,
      incidents: pending.map((p) => ({
        id: p.id,
        code: p.code,
        at: new Date(p.at).toISOString(),
        user: p.user_name,
        productId: p.product_id ?? null,
        plu: p.plu == null ? null : Number(p.plu),
        product: p.product_name ?? null,
        action: p.action,
        detail: p.diff ?? null,
      })),
    });
    return { code, sent: pending.length };
  }
}
