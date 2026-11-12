import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import { fail } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { ReconnectionsApplication } from "../Applications/ReconnectionsApplication.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { OrdersService } from "./OrdersService.js";
import {
  AcceptReconnectionModel,
  CreateReconnectionsModel,
  DiscardReconnectionModel,
  ReconnectionIdModel,
  ReconnectionsFilterModel,
} from "../Models/ReconnectionsModels.js";

type Row = Record<string, any>;
const iso = (d: unknown) => (d == null ? null : new Date(d as string).toISOString());
const OrderIdModel = ReconnectionIdModel;
export const RECONNECTION_PERMISSION = "pedido.reconexiones";

/**
 * Reconexiones de la orden (decidido con el dueño el 04/11/2026, API 1.2.268).
 * Lo que un equipo ticó sin conexión con el servidor no entra directo en la cuenta: al volver la conexión el equipo lo
 * manda aquí y queda pendiente. Quien tenga «Resolver reconexiones» (pedido.reconexiones, o con la clave de un encargado)
 * lo valida —pasa a la cuenta y sale la comanda— o lo descarta con un motivo. Mientras haya algo pendiente en una cuenta,
 * esa cuenta no se cobra (409 RECONNECTION_PENDING en cobrar, facturar y cobrar y facturar).
 */
@Injectable()
export class ReconnectionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ReconnectionsApplication) private readonly rec: ReconnectionsApplication,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
  ) {}

  /** Guardar lo ticado sin conexión. Basta una sesión válida (lo marcó quien estaba en el equipo). Repetir no duplica. */
  async create(se: Session, rawOrderId: string, body: unknown) {
    const orderId = parse(OrderIdModel, rawOrderId);
    const b = parse(CreateReconnectionsModel, body);
    if (!(await this.rec.orderExists(se.storeId, orderId))) {
      fail("NOT_FOUND", "No existe esa mesa", { field: "orderId" });
    }
    const now = this.clock();
    const items: Row[] = [];
    for (const it of b.items) {
      items.push(
        await this.rec.insert({
          id: randomUUID(),
          storeId: se.storeId,
          orderId,
          accountId: b.accountId ?? null,
          clientId: it.clientId,
          plu: it.plu,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          detail: { comment: it.comment ?? null, modifiers: it.modifiers },
          markedAt: it.markedAt ? new Date(it.markedAt) : now,
          userId: se.user.id,
          userName: se.user.name,
          device: se.station.name,
          offlineReason: b.offlineReason ?? null,
        }),
      );
    }
    return { items: items.map((r) => this.view(r)) };
  }

  async list(se: Session, status?: string, orderId?: string) {
    const f = parse(ReconnectionsFilterModel, { status: status || undefined, orderId: orderId || undefined });
    return { items: (await this.rec.list(se.storeId, f.status, f.orderId)).map((r) => this.view(r)) };
  }

  /** Validar: la línea pasa a su cuenta y se envía (sale la comanda). Repetir sobre una ya aceptada la devuelve igual. */
  async accept(se: Session, rawId: string, body: unknown) {
    const id = parse(ReconnectionIdModel, rawId);
    const b = parse(AcceptReconnectionModel, body ?? {});
    const g = await this.auth.require(se, RECONNECTION_PERMISSION, b.authorization);
    const cur = await this.rec.get(se.storeId, id);
    if (!cur) {
      fail("NOT_FOUND", "No existe esa reconexión", { field: "reconnectionId" });
    }
    if (cur!.status === "accepted") {
      return { reconnection: this.view(cur!), printed: [] };
    }
    if (cur!.status !== "pending") {
      fail("RECONNECTION_DECIDED", "Esa reconexión ya se descartó", { status: cur!.status });
    }
    const by = g.authorizerActor?.user ?? null;
    const d = (cur!.detail ?? {}) as {
      comment?: string | null;
      modifiers?: { questionId?: string | null; plu: number; quantity?: number }[];
    };
    const r = await this.orders.addAndSendReconnection(
      se,
      cur!.order_id as string,
      {
        lineId: id,
        accountId: (cur!.account_id as string) ?? null,
        plu: cur!.plu as number,
        quantity: cur!.quantity as number,
        comment: d.comment ?? null,
        modifiers: d.modifiers ?? [],
        note: `ticado sin conexión por ${cur!.marked_by_name ?? "?"}${cur!.device ? ` en ${cur!.device}` : ""}; valida ${se.user.name}${by ? `/${by}` : ""}`,
      },
      async (tx) => {
        const again = await this.rec.lock(tx, se.storeId, id);
        if (again?.status !== "pending") {
          fail("RECONNECTION_DECIDED", "Otro equipo ya decidió esa reconexión", { status: again?.status });
        }
        await this.rec.decide(tx, se.storeId, id, {
          status: "accepted",
          userName: se.user.name,
          authorizedBy: by,
          reason: null,
          at: this.clock(),
        });
      },
    );
    return { reconnection: this.view((await this.rec.get(se.storeId, id))!), printed: r.printed };
  }

  /** Descartar con motivo: no entra en la cuenta, queda en el historial de reconexiones. */
  async discard(se: Session, rawId: string, body: unknown) {
    const id = parse(ReconnectionIdModel, rawId);
    const b = parse(DiscardReconnectionModel, body);
    const g = await this.auth.require(se, RECONNECTION_PERMISSION, b.authorization);
    await this.database.withTx(async (tx) => {
      const cur = await this.rec.lock(tx, se.storeId, id);
      if (!cur) {
        fail("NOT_FOUND", "No existe esa reconexión", { field: "reconnectionId" });
      }
      if (cur!.status === "accepted") {
        fail("RECONNECTION_DECIDED", "Esa reconexión ya se validó y está en la cuenta", {
          status: cur!.status,
        });
      }
      if (cur!.status === "pending") {
        await this.rec.decide(tx, se.storeId, id, {
          status: "discarded",
          userName: se.user.name,
          authorizedBy: g.authorizerActor?.user ?? null,
          reason: b.reason,
          at: this.clock(),
        });
      }
    });
    return { reconnection: this.view((await this.rec.get(se.storeId, id))!) };
  }

  private view(r: Row) {
    const d = (r.detail ?? {}) as { comment?: string | null; modifiers?: unknown[] };
    return {
      id: r.id as string,
      clientId: r.client_id as string,
      orderId: r.order_id as string,
      tableName: (r.table_name as string) ?? null,
      accountId: (r.account_id as string) ?? null,
      accountName: (r.account_name as string) ?? null,
      plu: r.plu as number,
      name: r.name as string,
      quantity: r.quantity as number,
      unitPrice: Number(r.unit_price),
      comment: d.comment ?? null,
      modifiers: d.modifiers ?? [],
      status: r.status as string,
      offlineReason: (r.offline_reason as string) ?? null,
      markedBy: {
        user: (r.marked_by_name as string) ?? null,
        device: (r.device as string) ?? null,
        at: iso(r.marked_at)!,
      },
      decidedBy:
        r.status === "pending"
          ? null
          : {
              user: r.decided_by_name as string,
              authorizedBy: (r.authorized_by_name as string) ?? null,
              at: iso(r.decided_at)!,
              reason: (r.decision_reason as string) ?? null,
            },
    };
  }
}
