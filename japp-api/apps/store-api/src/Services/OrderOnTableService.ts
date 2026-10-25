import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@japp/db";
import {
  assertOotProduct,
  assertOotTokenLive,
  DomainError,
  fail,
  isOotProduct,
  isOotToken,
  ootQrTicket,
  ootToken,
  ootUrl,
  priceFor,
  OOT_ACCOUNT_NAME,
} from "@japp/domain";
import { CLOCK, DATABASE, PRINTER, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import type { PrinterPort } from "../Clases/Printers.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { OrdersService } from "./OrdersService.js";
import { OrderOnTableApplication, type OotTokenRow } from "../Applications/OrderOnTableApplication.js";
import { StoreApplication } from "../Applications/StoreApplication.js";

/** Sin estación: la comanda del cliente sale por la impresora de cada canal (ningún equipo la cambia). */
const NO_STATION = "00000000-0000-0000-0000-000000000000";
type Item = {
  plu: number;
  quantity: number;
  comment?: string | null;
  modifiers?: { questionId?: string | null; plu: number; quantity?: number }[];
};
type OotResponse = {
  accepted: number;
  accountId: string;
  version: number;
  printed: { channel: string; printer: string; lines: number; ok: boolean }[];
};
const sha256 = (x: string) => createHash("sha256").update(x).digest();
const iso = (x: string) => new Date(x).toISOString();
const isClosed = (status: string) => status === "closed" || status === "cancelled";

/**
 * Order on Table: el QR de la mesa (generar, reutilizar, anular e imprimir) y lo que llama el sistema de pedidos
 * del cliente (carta del token y pedido). Reglas en @japp/domain (oot.ts); el pedido usa OrdersService.addAndSendAs.
 */
@Injectable()
export class OrderOnTableService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PRINTER) private readonly printer: PrinterPort,
    @Inject(OrderOnTableApplication) private readonly oot: OrderOnTableApplication,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
  ) {}

  /**
   * Generar el QR: un token por orden abierta (si ya hay uno vigente se devuelve, reused = true).
   * Con print, el ticket sale por la impresora de tickets del área DESPUÉS del COMMIT (printed false si falla).
   */
  async create(session: Session, orderId: string, b: { print: boolean; copies?: number }) {
    await this.auth.require(session, "mesas.orderOnTable");
    const S = session.storeId;
    const now = this.clock();
    const r = await this.database.withTx(async (tx) => {
      // la orden bloqueada: dos peticiones a la vez no crean dos tokens (y el índice único de vigentes lo garantiza)
      const o = await this.oot.lockOrder(tx, S, orderId);
      if (!o) {
        fail("NOT_FOUND", "La orden no existe", { orderId });
      }
      if (isClosed(o!.status)) {
        fail("ORDER_CLOSED", "La mesa ya está cerrada", { orderId });
      }
      const base = await this.oot.webOrderUrl(S, tx);
      const live = await this.oot.liveToken(tx, S, orderId);
      if (live) {
        return {
          token: live.token,
          url: ootUrl(base, live.token),
          createdAt: iso(live.createdAt),
          reused: true,
          o: o!,
        };
      }
      const token = ootToken(randomBytes(32));
      // la URL antes de guardar: sin URL en Ajustes › Restaurante → 409 OOT_NOT_CONFIGURED y no se crea nada
      const url = ootUrl(base, token);
      await this.oot.insertToken(tx, {
        storeId: S,
        orderId,
        token,
        userId: session.user.id,
        userName: session.user.name,
        device: session.station.name,
        createdAt: now.toISOString(),
      });
      return { token, url, createdAt: now.toISOString(), reused: false, o: o! };
    });
    let printed = false;
    if (b.print) {
      // uno o varios tickets (p. ej. uno por cada lado de una mesa grande)
      printed = true;
      for (let i = 0; i < (b.copies ?? 1); i++) {
        const ok = await this.printQr(session, orderId, r.url, r.token, {
          name: r.o.tableName,
          area: r.o.zone ?? "",
        }).catch(() => false);
        printed = printed && ok;
      }
    }
    return { token: r.token, url: r.url, createdAt: r.createdAt, reused: r.reused, printed };
  }

  /** Ticket «ootQr» en la impresora de tickets del área de la mesa (la misma que la precuenta). */
  private async printQr(
    session: Session,
    orderId: string,
    url: string,
    token: string,
    table: { name: string; area: string },
  ) {
    const p = await this.database.withTx((tx) => this.orders.ticketPrinter(tx, session, orderId));
    const st = await this.stores.store();
    const res = await this.printer.print({
      kind: "oot",
      channel: p.channel,
      printer: p.name,
      connection: p.connection,
      title: `QR mesa ${table.name}`,
      ticket: ootQrTicket({
        store: { chain: st.chainName, name: st.name, legalName: st.issuerName },
        table,
        url,
        token,
        waiter: session.user.name,
        at: this.clock(),
      }),
    });
    return res.ok;
  }

  /** Anular el QR a mano: deja de valer al momento. Sin token vigente no hace nada. */
  async revoke(session: Session, orderId: string) {
    await this.auth.require(session, "mesas.orderOnTable");
    await this.database.withTx(async (tx) => {
      const o = await this.oot.lockOrder(tx, session.storeId, orderId);
      if (!o) {
        fail("NOT_FOUND", "La orden no existe", { orderId });
      }
      await this.oot.revoke(tx, session.storeId, orderId, "manual");
    });
    return null;
  }

  /** Token del QR vigente con su orden; si no → 404 OOT_TOKEN_INVALID. */
  private async liveToken(storeId: string, token: string): Promise<OotTokenRow> {
    const row = isOotToken(token) ? await this.oot.tokenState(storeId, token) : undefined;
    assertOotTokenLive(row ? { orderStatus: row.orderStatus, revokedAt: row.revokedAt } : null);
    return row!;
  }

  /** Mesa y carta del token: productos y categorías con orderOnTable (isOotProduct), sin agotados, con PVP del área. */
  async menu(token: string) {
    const st = await this.stores.store();
    const t = await this.liveToken(st.id, token);
    const area = { priceList: t.priceList === "terrace" ? ("terrace" as const) : ("general" as const) };
    const products = (await this.oot.menuProducts(st.id)).filter((p) => isOotProduct(p) && !p.soldOut);
    const questions = await this.oot.questions(
      st.id,
      products.map((p) => p.productId),
    );
    const categories: {
      id: string | null;
      name: string;
      products: {
        plu: number;
        name: string;
        description: string | null;
        price: number;
        questions: unknown[];
      }[];
    }[] = [];
    for (const p of products) {
      let cat = categories.find((c) => c.id === p.category!.id);
      if (!cat) {
        cat = { id: p.category!.id, name: p.category!.name, products: [] };
        categories.push(cat);
      }
      const price = priceFor(
        { price: Number(p.price), terracePrice: p.priceTerrace == null ? undefined : Number(p.priceTerrace) },
        area,
      );
      cat.products.push({
        plu: p.plu,
        name: p.name,
        description: p.description,
        price,
        questions: questions
          .filter((q) => q.productId === p.productId)
          .map((q) => ({
            id: q.id,
            name: q.name,
            minAnswers: q.minAnswers,
            maxAnswers: q.maxAnswers,
            answers: q.answers.map((a) => ({ plu: a.plu, label: a.label, extraPrice: Number(a.extraPrice) })),
          })),
      });
    }
    return {
      store: { code: st.code, name: st.name },
      table: t.tableName,
      area: t.zone,
      orderId: t.orderId,
      open: !isClosed(t.orderStatus),
      menu: { categories },
    };
  }

  /** El cliente como actor: rol customer, usuario «Order on Table», equipo «OOT»; sin usuario ni estación de la tienda. */
  private customer(storeId: string): Session {
    return {
      storeId,
      user: {
        id: "oot",
        name: OOT_ACCOUNT_NAME,
        initials: "OT",
        profileId: "",
        profileCode: "OOT",
        level: 0,
        color: null,
        pinHash: "",
        active: true,
        lockSeconds: null,
        overrides: {},
        allowedStations: "any",
      },
      station: { id: NO_STATION, name: "OOT", kind: "oot", isMain: false, deviceUuid: null },
      role: "customer",
      origin: "tpv",
      jti: "oot",
      can: () => false,
      actor: (at: Date) => ({
        user: OOT_ACCOUNT_NAME,
        role: "customer",
        device: "OOT",
        at: at.toISOString(),
      }),
    };
  }

  /**
   * Pedido del cliente: entra en la cuenta «Order on Table» y se envía solo (OrdersService.addAndSendAs).
   * requestId (o Idempotency-Key) → clave derivada «oot:» + SHA-256(orden|requestId) en idempotency_key, leída y escrita
   * dentro de la transacción del pedido con la orden bloqueada: el mismo requestId en esa orden devuelve lo mismo sin repetir.
   */
  async order(
    token: string,
    b: { items: Item[]; requestId?: string | number | null },
    idempotencyKey: string | undefined,
  ): Promise<OotResponse> {
    const st = await this.stores.store();
    const S = st.id;
    const t = await this.liveToken(S, token);
    const requestId = b.requestId != null ? String(b.requestId) : idempotencyKey?.trim() || null;
    const reqKey = requestId ? `oot:${sha256(`${t.orderId}|${requestId}`).toString("hex")}` : null;
    const hash = sha256(JSON.stringify(b)).toString("hex");
    let r: { replay: OotResponse } | OotResponse;
    try {
      r = await this.orders.addAndSendAs<OotResponse>(
        this.customer(S),
        t.orderId,
        { accountName: OOT_ACCOUNT_NAME, items: b.items },
        {
          check: async (tx) => {
            // otra vez con la orden bloqueada: el QR se pudo anular mientras tanto
            const now = await this.oot.tokenState(S, token, tx);
            assertOotTokenLive(now ? { orderStatus: now.orderStatus, revokedAt: now.revokedAt } : null);
            if (reqKey) {
              const prev = await this.oot.findRequest(tx, S, reqKey);
              if (prev !== undefined) {
                // el mismo requestId con otro pedido no es un reintento: no se devuelve el anterior como si fuera este
                if (prev.hash !== hash) {
                  fail("VALIDATION", "requestId ya usado con otro pedido", { field: "requestId" });
                }
                return prev.response as OotResponse;
              }
            }
            for (const [i, it] of b.items.entries()) {
              assertOotProduct((await this.oot.productByPlu(tx, S, it.plu)) ?? null, it.plu, i);
            }
            return undefined;
          },
          record: async (tx, out) => {
            if (reqKey) {
              await this.oot.saveRequest(tx, {
                storeId: S,
                key: reqKey,
                path: "/api/v2/oot/{token}/lines",
                hash,
                status: 201,
                response: { ...out, printed: [] },
              });
            }
          },
        },
      );
    } catch (e) {
      // la mesa se cerró entre la lectura del token y el bloqueo de la orden: para el cliente es un QR que ya no vale
      if (e instanceof DomainError && e.code === "ORDER_CLOSED") {
        fail("OOT_TOKEN_INVALID", "Esta mesa ya está cerrada: pide uno nuevo al camarero");
      }
      throw e;
    }
    if (!("accountId" in r)) {
      return r.replay;
    }
    const res: OotResponse = {
      accepted: r.accepted,
      accountId: r.accountId,
      version: r.version,
      printed: r.printed,
    };
    if (reqKey) {
      await this.oot.updateRequest(S, reqKey, res);
    }
    return res;
  }
}
