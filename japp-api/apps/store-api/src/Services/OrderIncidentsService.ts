import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import { fail, planIncidentResolution, type IncidentResolution, type IncidentStatus } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { OrderIncidentsApplication } from "../Applications/OrderIncidentsApplication.js";
import {
  CreateOrderIncidentModel,
  IncidentIdModel,
  OrderIncidentsFilterModel,
  ResolveOrderIncidentModel,
} from "../Models/OrderIncidentsModels.js";

type Row = Record<string, any>;
const iso = (d: unknown) => (d == null ? null : new Date(d as string).toISOString());

/**
 * Incidencias de mesa (25/10/2026): el equipo guarda solo lo que pasó (sin conexión, no cuadra, rechazado) sin aplicar nada,
 * y una persona decide después en ese equipo: reintentar el envío o quedarse con lo del servidor.
 * Basta con una sesión válida: la decisión con clave de encargado la pide el equipo y se guarda en authorizedBy.
 */
@Injectable()
export class OrderIncidentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OrderIncidentsApplication) private readonly incidents: OrderIncidentsApplication,
  ) {}

  async create(se: Session, body: unknown) {
    const b = parse(CreateOrderIncidentModel, body);
    const now = this.clock();
    const row = await this.incidents.insert({
      id: b.id,
      storeId: se.storeId,
      orderId: b.orderId ?? null,
      accountId: b.accountId ?? null,
      tableName: b.tableName,
      kind: b.kind,
      detail: b.detail,
      stationId: se.station.id,
      device: se.station.name,
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : now,
      userId: se.user.id,
      userName: se.user.name,
      at: now,
    });
    if (!row) {
      return fail("NOT_FOUND", "No existe esa incidencia", { field: "id" });
    }
    return this.view(row);
  }

  async resolve(se: Session, rawId: string, body: unknown) {
    const id = parse(IncidentIdModel, rawId);
    const b = parse(ResolveOrderIncidentModel, body);
    const now = this.clock();
    await this.database.withTx(async (tx) => {
      const cur = await this.incidents.lock(tx, se.storeId, id);
      if (!cur) {
        fail("NOT_FOUND", "No existe esa incidencia", { field: "id" });
      }
      if (planIncidentResolution(cur!.status as IncidentStatus, b.status as IncidentResolution)) {
        await this.incidents.resolve(tx, se.storeId, id, {
          status: b.status,
          userId: se.user.id,
          userName: se.user.name,
          authorizedBy: b.authorizedBy ?? null,
          note: b.note ?? null,
          at: now,
        });
      }
    });
    return this.view((await this.incidents.get(se.storeId, id))!);
  }

  async list(se: Session, status?: string, orderId?: string) {
    const f = parse(OrderIncidentsFilterModel, {
      status: status || undefined,
      orderId: orderId || undefined,
    });
    return { items: (await this.incidents.list(se.storeId, f.status, f.orderId)).map((r) => this.view(r)) };
  }

  private view(r: Row) {
    return {
      id: r.id as string,
      orderId: (r.order_id as string) ?? null,
      accountId: (r.account_id as string) ?? null,
      tableName: r.table_name as string,
      kind: r.kind as string,
      status: r.status as string,
      detail: (r.detail ?? {}) as Record<string, unknown>,
      device: (r.device as string) ?? null,
      occurredAt: iso(r.occurred_at)!,
      openedBy: {
        user: r.opened_by_user_name as string,
        device: (r.device as string) ?? null,
        at: iso(r.opened_by_at)!,
      },
      resolvedBy:
        r.status === "open"
          ? null
          : {
              user: r.resolved_by_user_name as string,
              authorizedBy: (r.resolved_authorized_by as string) ?? null,
              at: iso(r.resolved_by_at)!,
              note: (r.resolution_note as string) ?? null,
            },
    };
  }
}
