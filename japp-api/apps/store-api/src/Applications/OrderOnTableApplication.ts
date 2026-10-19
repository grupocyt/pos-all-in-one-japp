import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema as s, type Database, type Db, type Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;

/** Motivos de anulación que admite oot_token.revoked_reason (oot_token_revoked_reason_check). */
export type OotRevokeReason = "closed" | "manual" | "transferred";

/** Token de Order on Table con la orden de su mesa (lo que hace falta para decidir si vale). */
export interface OotTokenRow {
  id: string;
  orderId: string;
  token: string;
  createdAt: string;
  revokedAt: string | null;
  orderStatus: string;
  tableName: string;
  zone: string | null;
  priceList: string;
}

/** Producto de la carta con su categoría, en bruto: qué entra en Order on Table lo decide el dominio (isOotProduct). */
export interface OotMenuRow {
  productId: string;
  plu: number;
  name: string;
  description: string | null;
  price: string;
  priceTerrace: string | null;
  active: boolean;
  soldOut: boolean;
  answerOnly: boolean;
  orderOnTable: boolean;
  category: {
    id: string;
    name: string;
    sortOrder: number;
    hidden: boolean;
    active: boolean;
    orderOnTable: boolean;
  } | null;
}

export interface OotQuestionRow {
  productId: string;
  id: string;
  name: string;
  minAnswers: number;
  maxAnswers: number;
  answers: { plu: number; label: string | null; extraPrice: string }[];
}

type ProductRow = typeof s.product.$inferSelect;
type CategoryRow = typeof s.category.$inferSelect;
/** Fila de product + category → lo que necesita la regla de Order on Table. */
function toMenuRow({ p, c }: { p: ProductRow; c: CategoryRow | null }): OotMenuRow {
  return {
    productId: p.id,
    plu: p.plu,
    name: p.name,
    description: p.description,
    price: p.price,
    priceTerrace: p.priceTerrace,
    active: p.active,
    soldOut: p.soldOut,
    answerOnly: p.answerOnly,
    orderOnTable: p.orderOnTable,
    category: c
      ? {
          id: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          hidden: c.hidden,
          active: c.active,
          orderOnTable: c.orderOnTable,
        }
      : null,
  };
}

/**
 * Order on Table: tabla oot_token (un token vigente por orden, uq_oot_token_order_live), la URL de la tienda,
 * la carta que ve el cliente y la memoria de pedidos ya hechos (requestId) en idempotency_key.
 */
@Injectable()
export class OrderOnTableApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Anula los tokens vigentes de la orden (revoked_at = now()). reason: 'closed' (la mesa se cerró), 'manual'
   * o 'transferred' (la orden pasó entera a otra mesa: el QR de la mesa vieja ya no debe pedir en ella).
   * Estática para que OrdersApplication.save la llame dentro de su transacción sin depender de esta clase.
   */
  static async revoke(tx: Tx, storeId: string, orderId: string, reason: OotRevokeReason) {
    const r = await tx
      .update(s.ootToken)
      .set({ revokedAt: sql`now()`, revokedReason: reason } as any)
      .where(
        and(eq(s.ootToken.storeId, storeId), eq(s.ootToken.orderId, orderId), isNull(s.ootToken.revokedAt)),
      )
      .returning({ id: s.ootToken.id });
    return r.length;
  }

  async revoke(tx: Tx, storeId: string, orderId: string, reason: OotRevokeReason) {
    return OrderOnTableApplication.revoke(tx, storeId, orderId, reason);
  }

  /** Orden bloqueada (FOR UPDATE) con lo que pide el QR; undefined si no existe en la tienda. */
  async lockOrder(tx: Tx, storeId: string, orderId: string) {
    const [o] = await tx
      .select({
        id: s.orders.id,
        status: s.orders.status,
        tableName: s.orders.tableName,
        zone: s.orders.zone,
      })
      .from(s.orders)
      .where(and(eq(s.orders.id, orderId), eq(s.orders.storeId, storeId)))
      .for("update");
    return o;
  }

  /** Token vigente (sin anular) de la orden; undefined si no tiene. */
  async liveToken(tx: Tx, storeId: string, orderId: string) {
    const [t] = await tx
      .select({ token: s.ootToken.token, createdAt: s.ootToken.createdAt })
      .from(s.ootToken)
      .where(
        and(eq(s.ootToken.storeId, storeId), eq(s.ootToken.orderId, orderId), isNull(s.ootToken.revokedAt)),
      );
    return t;
  }

  async insertToken(
    tx: Tx,
    v: {
      storeId: string;
      orderId: string;
      token: string;
      userId: string;
      userName: string;
      device: string;
      createdAt: string;
    },
  ) {
    await tx.insert(s.ootToken).values({
      id: crypto.randomUUID(),
      storeId: v.storeId,
      orderId: v.orderId,
      token: v.token,
      createdByUserId: v.userId,
      createdByUserName: v.userName.slice(0, 60),
      createdByDevice: v.device.slice(0, 40),
      createdAt: v.createdAt,
    } as typeof s.ootToken.$inferInsert);
  }

  /** URL de Order on Table de Ajustes › Restaurante (se lee siempre: puede cambiar con la tienda abierta). */
  async webOrderUrl(storeId: string, q: Q = this.database.db): Promise<string | null> {
    const [r] = await q.select({ url: s.store.webOrderUrl }).from(s.store).where(eq(s.store.id, storeId));
    return r?.url ?? null;
  }

  /** Token (exista o no vigente) con el estado de su orden; undefined si no existe en la tienda. */
  async tokenState(
    storeId: string,
    token: string,
    q: Q = this.database.db,
  ): Promise<OotTokenRow | undefined> {
    const [r] = await q
      .select({
        id: s.ootToken.id,
        orderId: s.ootToken.orderId,
        token: s.ootToken.token,
        createdAt: s.ootToken.createdAt,
        revokedAt: s.ootToken.revokedAt,
        orderStatus: s.orders.status,
        tableName: s.orders.tableName,
        zone: s.orders.zone,
        priceList: s.orders.priceList,
      })
      .from(s.ootToken)
      .innerJoin(s.orders, and(eq(s.orders.id, s.ootToken.orderId), eq(s.orders.storeId, storeId)))
      .where(and(eq(s.ootToken.storeId, storeId), eq(s.ootToken.token, token)));
    return r;
  }

  /** Todos los productos de la tienda con su categoría (la de product.category_id), ordenados como la carta. */
  async menuProducts(storeId: string): Promise<OotMenuRow[]> {
    const rows = await this.database.db
      .select({ p: s.product, c: s.category })
      .from(s.product)
      .leftJoin(s.category, and(eq(s.category.id, s.product.categoryId), eq(s.category.storeId, storeId)))
      .where(eq(s.product.storeId, storeId))
      .orderBy(asc(s.category.sortOrder), asc(s.category.name), asc(s.product.name));
    return rows.map(toMenuRow);
  }

  /** Producto por PLU con su categoría (para assertOotProduct); undefined si no existe en la tienda. */
  async productByPlu(tx: Tx, storeId: string, plu: number): Promise<OotMenuRow | undefined> {
    const [r] = await tx
      .select({ p: s.product, c: s.category })
      .from(s.product)
      .leftJoin(s.category, and(eq(s.category.id, s.product.categoryId), eq(s.category.storeId, storeId)))
      .where(and(eq(s.product.storeId, storeId), eq(s.product.plu, plu)));
    if (!r) {
      return undefined;
    }
    return toMenuRow(r);
  }

  /** Preguntas activas de esos productos con sus respuestas (PLU, texto y suplemento), en su orden. */
  async questions(storeId: string, productIds: string[]): Promise<OotQuestionRow[]> {
    if (!productIds.length) {
      return [];
    }
    const db = this.database.db;
    const qs = await db
      .select({ productId: s.productQuestion.productId, q: s.question })
      .from(s.productQuestion)
      .innerJoin(
        s.question,
        and(eq(s.question.id, s.productQuestion.questionId), eq(s.question.storeId, storeId)),
      )
      .where(
        and(
          eq(s.productQuestion.storeId, storeId),
          inArray(s.productQuestion.productId, productIds),
          eq(s.question.active, true),
        ),
      )
      .orderBy(asc(s.productQuestion.sortOrder), asc(s.question.name));
    if (!qs.length) {
      return [];
    }
    const qids = [...new Set(qs.map((x) => x.q.id))];
    const ans = await db
      .select({
        questionId: s.questionAnswer.questionId,
        plu: s.product.plu,
        label: s.questionAnswer.label,
        name: s.product.name,
        extraPrice: s.questionAnswer.extraPrice,
      })
      .from(s.questionAnswer)
      .innerJoin(s.product, and(eq(s.product.id, s.questionAnswer.productId), eq(s.product.storeId, storeId)))
      .where(
        and(
          eq(s.questionAnswer.storeId, storeId),
          inArray(s.questionAnswer.questionId, qids),
          eq(s.product.active, true),
        ),
      )
      .orderBy(asc(s.questionAnswer.sortOrder), asc(s.product.name));
    return qs.map(({ productId, q }) => ({
      productId,
      id: q.id,
      name: q.name,
      minAnswers: q.minAnswers,
      maxAnswers: q.maxAnswers,
      answers: ans
        .filter((a) => a.questionId === q.id)
        .map((a) => ({ plu: a.plu, label: a.label ?? a.name, extraPrice: a.extraPrice })),
    }));
  }

  /**
   * Pedido ya hecho con ese requestId (clave derivada en idempotency_key). Se lee dentro de la transacción del pedido,
   * con la orden bloqueada: dos reintentos a la vez se ponen en fila y el segundo ya ve la fila del primero.
   */
  async findRequest(
    tx: Tx,
    storeId: string,
    key: string,
  ): Promise<{ response: unknown; hash: string } | undefined> {
    const [r] = await tx
      .select({
        response: s.idempotencyKey.response,
        status: s.idempotencyKey.statusCode,
        hash: s.idempotencyKey.requestHash,
      })
      .from(s.idempotencyKey)
      .where(and(eq(s.idempotencyKey.storeId, storeId), eq(s.idempotencyKey.key, key)));
    if (!r || r.status === 0) {
      return undefined;
    }
    return { response: r.response, hash: r.hash };
  }

  /** Apunta el pedido (en la misma transacción que las líneas): un reintento con el mismo requestId no lo repite. */
  async saveRequest(
    tx: Tx,
    v: { storeId: string; key: string; path: string; hash: string; status: number; response: unknown },
  ) {
    await tx.insert(s.idempotencyKey).values({
      storeId: v.storeId,
      key: v.key,
      method: "POST",
      path: v.path.slice(0, 200),
      requestHash: v.hash,
      statusCode: v.status,
      response: v.response,
    } as typeof s.idempotencyKey.$inferInsert);
  }

  /** Tras imprimir (después del COMMIT): la respuesta guardada pasa a llevar lo que salió por cada impresora. */
  async updateRequest(storeId: string, key: string, response: unknown) {
    await this.database.db
      .update(s.idempotencyKey)
      .set({ response } as any)
      .where(and(eq(s.idempotencyKey.storeId, storeId), eq(s.idempotencyKey.key, key)));
  }
}
