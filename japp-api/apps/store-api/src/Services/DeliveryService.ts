import { sql } from "drizzle-orm";
import { Inject, Injectable } from "@nestjs/common";
import type { Database, Tx } from "@japp/db";
import {
  DELIVERY_LIVE,
  PLATFORM_RIDER,
  assertDeliveryCancel,
  deliveryLight,
  deliveryTotal,
  fail,
  madridDay,
  nextDeliveryStatus,
} from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { DeliveryApplication, type DeliverySettingsRow } from "../Applications/DeliveryApplication.js";
import { DeliveryAdvanceModel, DeliveryCancelModel, DeliveryOrderModel } from "../Models/DeliveryModels.js";

type Row = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Tablero de pedidos de delivery (TPV 1.2.217–1.2.233 y 1.2.264): alta, siguiente paso, cancelar, lista y ficha. */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DeliveryApplication) private readonly data: DeliveryApplication,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Un pedido como lo ve el TPV: espera y semáforo calculados ahora. */
  private view(r: Row, s: DeliverySettingsRow) {
    const l = deliveryLight(r.status, r.receivedAt, this.clock(), s, r.finishedAt);
    return {
      id: r.id,
      platform: r.platform,
      code: r.code,
      externalId: r.externalId ?? null,
      customer: { name: r.customerName, phone: r.customerPhone ?? null },
      address: r.address ?? null,
      paymentNote: r.paymentNote ?? null,
      note: r.note ?? null,
      status: r.status,
      riderId: r.riderId ?? null,
      riderName: r.riderName ?? null,
      total: Number(r.total),
      receivedAt: iso(r.receivedAt)!,
      finishedAt: iso(r.finishedAt),
      waitMinutes: l.wait,
      light: l.light,
      orderId: r.orderId ?? null,
      version: Number(r.version),
    };
  }

  /** La ficha: el pedido con sus productos y sus pasos. */
  private async full(storeId: string, id: string, s: DeliverySettingsRow, tx?: Tx) {
    const r = await this.data.find(storeId, id, tx);
    if (!r) {
      fail("NOT_FOUND", "Ese pedido no existe", { id });
    }
    const lines = await this.data.lines(storeId, id, tx);
    const events = await this.data.events(storeId, id, tx);
    return {
      ...this.view(r!, s),
      lines: lines.map((l) => ({ ...l, plu: l.plu == null ? null : Number(l.plu), note: l.note ?? null })),
      events: events.map((e) => ({
        status: e.status,
        at: iso(e.at)!,
        by: e.by ?? null,
        note: e.note ?? null,
      })),
    };
  }

  private async settingsOn(storeId: string) {
    const s = await this.data.settings(storeId);
    if (!s.active) {
      fail("DELIVERY_OFF", "Delivery está apagado en este local (Ajustes › Pedidos)");
    }
    return s;
  }

  // ───────────────────────── lectura ─────────────────────────
  async list(se: Session, o: { scope?: string; status?: string; q?: string; date?: string }) {
    await this.auth.require(se, "funciones.pedidos");
    const s = await this.settingsOn(se.storeId);
    const scope = o.scope === "finished" ? "finished" : "active";
    if (o.scope && !["active", "finished"].includes(o.scope)) {
      fail("VALIDATION", "scope es active o finished", { field: "scope" });
    }
    if (o.status && !(DELIVERY_LIVE as string[]).includes(o.status)) {
      fail("VALIDATION", "Estado que no existe o ya terminado", { field: "status" });
    }
    const date = o.date ?? madridDay(this.clock()).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      fail("VALIDATION", "date es AAAA-MM-DD", { field: "date" });
    }
    const rows = await this.data.list(se.storeId, {
      scope,
      status: o.status,
      q: o.q?.trim() || undefined,
      date,
    });
    const c = await this.data.counts(se.storeId, madridDay(this.clock()).date);
    return {
      items: rows.map((r) => this.view(r, s)),
      counts: Object.fromEntries(DELIVERY_LIVE.map((k) => [k, c.live[k] ?? 0])),
      finished: c.finished,
      settings: {
        active: s.active,
        amberMinutes: s.amberMinutes,
        redMinutes: s.redMinutes,
        askRider: s.askRider,
      },
    };
  }

  async get(se: Session, id: string) {
    await this.auth.require(se, "funciones.pedidos");
    const s = await this.data.settings(se.storeId);
    return this.full(se.storeId, id, s);
  }

  // ───────────────────────── escritura ─────────────────────────
  /**
   * Alta: la manda el integrador (clave de la tienda: se == null) o un encargado desde el TPV.
   * Con externalId repetido devuelve el que ya había (created: false). Con autoAccept entra como received.
   */
  async create(se: Session | null, body: unknown) {
    const b = parse(DeliveryOrderModel, body);
    if (b.lines.length > 100) {
      fail("TOO_LARGE", "Un pedido tiene como mucho 100 productos", {
        field: "lines",
        count: b.lines.length,
      });
    }
    if (se) {
      await this.auth.require(se, "funciones.pedidos");
    }
    const storeId = se?.storeId ?? (await this.stores.store()).id;
    const s = await this.settingsOn(storeId);
    const pf = s.platforms.find((p) => p.id === b.platform);
    if (!pf || !pf.active) {
      fail("VALIDATION", "Esa plataforma no está activa en Ajustes › Pedidos", {
        field: "platform",
        platform: b.platform,
      });
    }
    const now = this.clock();
    const actor = se?.actor(now) ?? null;
    return this.database.withTx(async (tx) => {
      if (b.externalId) {
        const had = await this.data.byExternal(storeId, b.platform, b.externalId, tx);
        if (had) {
          return { created: false, order: await this.full(storeId, had, s, tx) };
        }
      }
      const id = crypto.randomUUID();
      const plus = await this.data.productsByPlu(
        tx,
        storeId,
        b.lines.map((l) => l.plu).filter((x): x is number => x != null),
      );
      const at = now.toISOString();
      await this.data.insert(
        tx,
        {
          id,
          storeId,
          periodId: await this.data.openPeriodId(tx, storeId),
          platform: b.platform,
          code: b.code,
          externalId: b.externalId ?? null,
          customerName: b.customer.name,
          customerPhone: b.customer.phone ?? null,
          address: b.address ?? null,
          paymentNote: b.paymentNote ?? null,
          note: b.note ?? null,
          status: s.autoAccept ? "received" : "pending",
          total: deliveryTotal(b.lines),
          at,
        },
        b.lines.map((l) => ({
          productId: l.plu != null ? (plus.get(l.plu) ?? null) : null,
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          note: l.note ?? null,
        })),
      );
      await this.data.event(tx, {
        storeId,
        orderId: id,
        status: "pending",
        at,
        userId: actor?.userId ?? null,
        by: actor?.user ?? "Integración",
      });
      if (s.autoAccept) {
        await this.data.event(tx, {
          storeId,
          orderId: id,
          status: "received",
          at: new Date(now.getTime() + 1).toISOString(),
          userId: null,
          by: "Automático",
        });
      }
      return { created: true, order: await this.full(storeId, id, s, tx) };
    });
  }

  /** Bloquea el pedido y comprueba la versión (VERSION_CONFLICT trae el pedido como está). */
  private async locked(tx: Tx, storeId: string, id: string, version: number, s: DeliverySettingsRow) {
    const r = await this.data.find(storeId, id, tx, true);
    if (!r) {
      fail("NOT_FOUND", "Ese pedido no existe", { id });
    }
    if (Number(r!.version) !== version) {
      fail("VERSION_CONFLICT", "Otro equipo cambió el pedido antes", {
        current: await this.full(storeId, id, s, tx),
        sent: version,
      });
    }
    return r!;
  }

  /** Siguiente paso: Aceptar → Listo → Asignar → Sale → Entregado. Al asignar, quién lo lleva. */
  async advance(se: Session, id: string, body: unknown) {
    const b = parse(DeliveryAdvanceModel, body);
    await this.auth.require(se, "funciones.pedidos");
    const s = await this.data.settings(se.storeId);
    const now = this.clock();
    const a = se.actor(now);
    return this.database.withTx(async (tx) => {
      const r = await this.locked(tx, se.storeId, id, b.version, s);
      const next = nextDeliveryStatus(r.status);
      const patch: Parameters<DeliveryApplication["update"]>[3] = {
        status: next,
        version: Number(r.version) + 1,
      };
      if (next === "assigned") {
        if (b.riderId) {
          const rider = await this.data.activeRider(tx, se.storeId, b.riderId);
          if (!rider) {
            fail("NOT_FOUND", "Ese motorizado no existe o está desactivado", {
              field: "riderId",
              riderId: b.riderId,
            });
          }
          patch.riderId = rider!.id;
          patch.riderName = rider!.name;
        } else if (b.riderName) {
          patch.riderId = null;
          patch.riderName = b.riderName;
        } else if (s.askRider) {
          fail("RIDER_REQUIRED", "Elige quién lleva el pedido (motorizado o «Repartidor de la plataforma»)", {
            field: "riderId",
          });
        } else {
          patch.riderId = null;
          patch.riderName = PLATFORM_RIDER;
        }
      }
      if (next === "delivered") {
        patch.finishedAt = now.toISOString();
      }
      await this.data.update(tx, se.storeId, id, patch);
      await this.data.event(tx, {
        storeId: se.storeId,
        orderId: id,
        status: next,
        at: now.toISOString(),
        userId: a.userId ?? null,
        by: a.user,
        note: next === "assigned" ? patch.riderName : null,
      });
      return this.full(se.storeId, id, s, tx);
    });
  }

  /** Cancelar un pedido sin terminar: pide la clave de un encargado (sistema.autorizar) y queda el motivo en sus pasos. */
  async cancel(se: Session, id: string, body: unknown) {
    const b = parse(DeliveryCancelModel, body);
    await this.auth.require(se, "funciones.pedidos");
    const g = await this.auth.require(se, "sistema.autorizar", b.authorization);
    const s = await this.data.settings(se.storeId);
    const now = this.clock();
    const a = se.actor(now);
    return this.database.withTx(async (tx) => {
      const r = await this.locked(tx, se.storeId, id, b.version, s);
      assertDeliveryCancel(r.status);
      await this.data.update(tx, se.storeId, id, {
        status: "cancelled",
        version: Number(r.version) + 1,
        finishedAt: now.toISOString(),
      });
      const by = g.authorizerActor ? `${a.user} (autoriza ${g.authorizerActor.user})` : a.user;
      await this.data.event(tx, {
        storeId: se.storeId,
        orderId: id,
        status: "cancelled",
        at: now.toISOString(),
        userId: a.userId ?? null,
        by,
        note: b.note || null,
      });
      // 1.2.293 · se avisa a la plataforma (Glovo, Uber…): va en la cola hacia el Manager, que se lo manda con su integración
      const pl = (
        await tx.execute(sql`SELECT platform, code, external_id FROM delivery_order WHERE id = ${id} AND store_id = ${se.storeId}`)
      ).rows[0] as { platform?: string; code?: string; external_id?: string } | undefined;
      await tx.execute(
        sql`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES (${se.storeId}, 'delivery.cancelled', ${id}, 'upsert',
          ${JSON.stringify({ platform: pl?.platform ?? null, code: pl?.code ?? null, externalId: pl?.external_id ?? null, reason: b.note || null, by, at: now.toISOString() })}::jsonb)`,
      );
      return this.full(se.storeId, id, s, tx);
    });
  }
}
