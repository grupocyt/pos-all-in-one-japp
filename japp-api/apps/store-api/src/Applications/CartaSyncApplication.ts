import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema as s, type Database, type Db, type Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;

export type Translations = Record<string, Record<string, string | null>>;

/** Categoría tal como la ve el Manager (GET /config/carta) y como se compara en el sync. */
export interface CategoryRow {
  id: string;
  externalId: string | null;
  name: string;
  bgColor: string | null;
  fgColor: string | null;
  sortOrder: number;
  hidden: boolean;
  orderOnTable: boolean;
  /** 16/11 · Carta */
  description: string | null;
  translations: Translations;
  /** PLU de sus calificativos, en orden. */
  qualifiers: number[];
  active: boolean;
  version: number;
}

export interface ProductRow {
  id: string;
  externalId: string | null;
  plu: number;
  /** Nombre del PLU (el maestro). */
  name: string;
  /** Nombre a imprimir (comanda, precuenta y factura); null = el del PLU. */
  ticketName: string | null;
  /** Nombre en el TPV (texto de la tecla, category_product.label); null = el del PLU. */
  buttonLabel: string | null;
  description: string | null;
  categoryId: string | null;
  categoryExternalId: string | null;
  price: number;
  priceTerrace: number | null;
  taxId: string;
  taxRate: number | null;
  questionIds: string[];
  questionExternalIds: string[];
  bgColor: string | null;
  fgColor: string | null;
  answerOnly: boolean;
  orderOnTable: boolean;
  soldOut: boolean;
  /** 16/11 · Carta */
  translations: Translations;
  qualifier: boolean;
  /** Canales del Manager: COMIDA y/o BEBIDA. */
  channels: string[];
  active: boolean;
  version: number;
}

export interface AnswerRow {
  productId: string;
  productExternalId: string | null;
  plu: number | null;
  label: string | null;
  extraPrice: number;
  bgColor: string | null;
  fgColor: string | null;
  translations: Translations;
}

export interface QuestionRow {
  id: string;
  externalId: string | null;
  name: string;
  minAnswers: number;
  maxAnswers: number;
  course: number | null;
  /** 16/11 · Carta */
  plu: number | null;
  description: string | null;
  required: boolean;
  answerType: string;
  courseName: string | null;
  translations: Translations;
  active: boolean;
  version: number;
  answers: AnswerRow[];
}

export interface Carta {
  categories: CategoryRow[];
  products: ProductRow[];
  questions: QuestionRow[];
}

/** Columnas que escribe el sync (las que manda el Manager), ya resueltas. */
export interface CategoryValues {
  externalId: string | null;
  name: string;
  bgColor: string | null;
  fgColor: string | null;
  sortOrder: number;
  hidden: boolean;
  orderOnTable: boolean;
  description: string | null;
  translations: Translations;
  qualifiers: number[];
}

export interface ProductValues {
  externalId: string | null;
  plu: number;
  name: string;
  ticketName: string | null;
  /** Texto del botón (product.button_label) y de la tecla (category_product.label). */
  buttonLabel: string | null;
  description: string | null;
  categoryId: string | null;
  price: number;
  priceTerrace: number | null;
  taxId: string;
  bgColor: string | null;
  fgColor: string | null;
  answerOnly: boolean;
  orderOnTable: boolean;
  soldOut: boolean;
  translations: Translations;
  qualifier: boolean;
}

export interface QuestionValues {
  externalId: string | null;
  name: string;
  minAnswers: number;
  maxAnswers: number;
  course: number | null;
  plu: number | null;
  description: string | null;
  required: boolean;
  answerType: string;
  courseName: string | null;
  translations: Translations;
}

/** Una carga del Manager guardada (catalog_release). */
export interface ReleaseRow {
  id: string;
  kind: string;
  publicationId: string;
  publicationType: string | null;
  releaseVersion: number;
  effectiveAt: string;
  status: string;
  checksum: string;
  menu: string | null;
  priceLine: string | null;
  storeCode: string | null;
  note: string | null;
  receivedAt: string;
  appliedAt: string | null;
  error: string | null;
  result: unknown;
  decidedBy: string | null;
}

/** Fila de la vista previa: una tecla (categoría × producto) con lo que decide si sale. */
export interface PreviewRow {
  categoryId: string;
  productId: string;
  plu: number;
  name: string;
  description: string | null;
  price: number;
  priceTerrace: number | null;
  soldOut: boolean;
  answerOnly: boolean;
  orderOnTable: boolean;
  active: boolean;
  ownCategory: { orderOnTable: boolean; hidden: boolean; active: boolean } | null;
}

export interface LayoutTable {
  id: string;
  number: string;
  posX: number | null;
  posY: number | null;
  width: number | null;
  height: number | null;
}

export interface Drawing {
  kind: string;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  item: string | null;
  label: string | null;
}

const num = (v: string | null) => {
  if (v === null) {
    return null;
  }
  return Number(v);
};
const money = (v: number) => v.toFixed(2);
const optMoney = (v: number | null) => {
  if (v === null) {
    return null;
  }
  return v.toFixed(2);
};

/** Agrupa filas por una clave (relaciones de cada registro). */
/** Texto propio de la tecla o null si es el mismo que el nombre del PLU. */
function buttonOf(
  rows: { categoryId: string; label: string | null }[],
  categoryId: string | null,
  name: string,
) {
  const own = rows.find((r) => r.categoryId === categoryId) ?? rows[0];
  const label = own?.label?.trim();
  if (!label || label === name) {
    return null;
  }
  return label;
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const g = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = g.get(k);
    if (list) {
      list.push(x);
    } else {
      g.set(k, [x]);
    }
  }
  return g;
}

/**
 * Ajustes › Carta en la base: carga de la carta completa (para el Manager y para comparar en el sync),
 * escritura de categorías, productos y preguntas que manda el Manager, vista previa, orden, agotado,
 * catálogo de permisos, datos de la PWA y Editar sala. Todo con store_id. Las reglas las decide el servicio.
 */
@Injectable()
export class CartaSyncApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  // ───────────────────────── carta completa ─────────────────────────
  /**
   * La carta de la tienda (activos y desactivados) con sus relaciones.
   * Con `lock` (dentro del sync) bloquea las filas de categorías, productos y preguntas (FOR UPDATE):
   * así un cambio desde Ajustes a la vez espera a que termine la carga.
   */
  async carta(storeId: string, o: { lock?: boolean } = {}, q: Q = this.database.db): Promise<Carta> {
    const catQ = q
      .select()
      .from(s.category)
      .where(eq(s.category.storeId, storeId))
      .orderBy(asc(s.category.sortOrder), asc(s.category.name));
    const prodQ = q
      .select()
      .from(s.product)
      .where(eq(s.product.storeId, storeId))
      .orderBy(asc(s.product.plu));
    const qQ = q
      .select()
      .from(s.question)
      .where(eq(s.question.storeId, storeId))
      .orderBy(asc(s.question.name));
    let cats;
    let prods;
    let qs;
    if (o.lock) {
      cats = await catQ.for("update");
      prods = await prodQ.for("update");
      qs = await qQ.for("update");
    } else {
      cats = await catQ;
      prods = await prodQ;
      qs = await qQ;
    }
    const taxes = await q
      .select({ id: s.tax.id, rate: s.tax.rate })
      .from(s.tax)
      .where(eq(s.tax.storeId, storeId));
    const rateOf = new Map(taxes.map((t) => [t.id, Number(t.rate)]));
    const pq = await q
      .select({ productId: s.productQuestion.productId, questionId: s.productQuestion.questionId })
      .from(s.productQuestion)
      .where(eq(s.productQuestion.storeId, storeId))
      .orderBy(asc(s.productQuestion.sortOrder));
    const qa = await q
      .select({
        questionId: s.questionAnswer.questionId,
        productId: s.questionAnswer.productId,
        label: s.questionAnswer.label,
        extraPrice: s.questionAnswer.extraPrice,
        bgColor: s.questionAnswer.bgColor,
        fgColor: s.questionAnswer.fgColor,
        translations: s.questionAnswer.translations,
      })
      .from(s.questionAnswer)
      .where(eq(s.questionAnswer.storeId, storeId))
      .orderBy(asc(s.questionAnswer.sortOrder));
    // texto de la tecla: el de la categoría propia del producto si la tiene, si no el primero
    const btn = await q
      .select({
        productId: s.categoryProduct.productId,
        categoryId: s.categoryProduct.categoryId,
        label: s.categoryProduct.label,
      })
      .from(s.categoryProduct)
      .where(eq(s.categoryProduct.storeId, storeId));
    const btnBy = groupBy(btn, (x) => x.productId);
    const pch = await q
      .select({ productId: s.productChannel.productId, code: s.printChannel.code })
      .from(s.productChannel)
      .innerJoin(s.printChannel, eq(s.printChannel.id, s.productChannel.channelId))
      .where(eq(s.productChannel.storeId, storeId))
      .orderBy(asc(s.printChannel.code));
    const pchBy = groupBy(pch, (x) => x.productId);
    const catExt = new Map(cats.map((c) => [c.id, c.externalId]));
    const qExt = new Map(qs.map((x) => [x.id, x.externalId]));
    const prodKey = new Map(prods.map((p) => [p.id, { externalId: p.externalId, plu: p.plu }]));
    const pqBy = groupBy(pq, (x) => x.productId);
    const qaBy = groupBy(qa, (x) => x.questionId);
    const categories: CategoryRow[] = cats.map((c) => ({
      id: c.id,
      externalId: c.externalId,
      name: c.name,
      bgColor: c.bgColor,
      fgColor: c.fgColor,
      sortOrder: c.sortOrder,
      hidden: c.hidden,
      orderOnTable: c.orderOnTable,
      description: c.description,
      translations: (c.translations ?? {}) as Translations,
      qualifiers: ((c.qualifiers ?? []) as unknown[]).map(Number),
      active: c.active,
      version: c.version,
    }));
    const products: ProductRow[] = prods.map((p) => {
      const questionIds = (pqBy.get(p.id) ?? []).map((x) => x.questionId);
      const questionExternalIds = questionIds
        .map((id) => qExt.get(id) ?? null)
        .filter((x): x is string => x !== null);
      let categoryExternalId: string | null = null;
      if (p.categoryId) {
        categoryExternalId = catExt.get(p.categoryId) ?? null;
      }
      return {
        id: p.id,
        externalId: p.externalId,
        plu: p.plu,
        name: p.name,
        ticketName: p.ticketName,
        buttonLabel: p.buttonLabel ?? buttonOf(btnBy.get(p.id) ?? [], p.categoryId, p.name),
        description: p.description,
        categoryId: p.categoryId,
        categoryExternalId,
        price: Number(p.price),
        priceTerrace: num(p.priceTerrace),
        taxId: p.taxId,
        taxRate: rateOf.get(p.taxId) ?? null,
        questionIds,
        questionExternalIds,
        bgColor: p.bgColor,
        fgColor: p.fgColor,
        answerOnly: p.answerOnly,
        orderOnTable: p.orderOnTable,
        soldOut: p.soldOut,
        translations: (p.translations ?? {}) as Translations,
        qualifier: p.qualifier,
        channels: (pchBy.get(p.id) ?? []).map((x) => x.code).filter((x): x is string => !!x),
        active: p.active,
        version: p.version,
      };
    });
    const questions: QuestionRow[] = qs.map((x) => ({
      id: x.id,
      externalId: x.externalId,
      name: x.name,
      minAnswers: x.minAnswers,
      maxAnswers: x.maxAnswers,
      course: x.course,
      plu: x.plu,
      description: x.description,
      required: x.required,
      answerType: x.answerType,
      courseName: x.courseName,
      translations: (x.translations ?? {}) as Translations,
      active: x.active,
      version: x.version,
      answers: (qaBy.get(x.id) ?? []).map((a) => ({
        productId: a.productId,
        productExternalId: prodKey.get(a.productId)?.externalId ?? null,
        plu: prodKey.get(a.productId)?.plu ?? null,
        label: a.label,
        extraPrice: Number(a.extraPrice),
        bgColor: a.bgColor,
        fgColor: a.fgColor,
        translations: (a.translations ?? {}) as Translations,
      })),
    }));
    return { categories, products, questions };
  }

  /** Una carga de la carta a la vez por tienda (dos sync a la vez no se pisan). */
  async lockCarta(tx: Tx, storeId: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('carta:' || ${storeId}))`);
  }

  /** IVA activos de la tienda (id y tipo): el producto llega con taxRate. */
  async activeTaxes(tx: Tx, storeId: string): Promise<{ id: string; rate: number }[]> {
    const rows = await tx
      .select({ id: s.tax.id, rate: s.tax.rate })
      .from(s.tax)
      .where(and(eq(s.tax.storeId, storeId), eq(s.tax.active, true)))
      .orderBy(asc(s.tax.name));
    return rows.map((r) => ({ id: r.id, rate: Number(r.rate) }));
  }

  // ───────────────────────── escritura del sync ─────────────────────────
  async insertCategory(tx: Tx, storeId: string, id: string, v: CategoryValues) {
    await tx.insert(s.category).values({ id, storeId, ...v });
  }

  /** Cambio (o reactivación) con la versión nueva. */
  async updateCategory(tx: Tx, storeId: string, id: string, v: CategoryValues, version: number) {
    await tx
      .update(s.category)
      .set({ ...v, active: true, version })
      .where(and(eq(s.category.storeId, storeId), eq(s.category.id, id)));
  }

  async insertProduct(tx: Tx, storeId: string, id: string, v: ProductValues) {
    await tx.insert(s.product).values({
      id,
      storeId,
      ...v,
      price: money(v.price),
      priceTerrace: optMoney(v.priceTerrace),
    });
  }

  /** Suelta el externalId de esos productos (pasa a otro producto con el mismo PLU en el sync). */
  async clearProductExternalIds(tx: Tx, storeId: string, ids: string[]) {
    if (!ids.length) {
      return;
    }
    await tx
      .update(s.product)
      .set({ externalId: null })
      .where(and(eq(s.product.storeId, storeId), inArray(s.product.id, ids)));
  }

  async updateProduct(tx: Tx, storeId: string, id: string, v: ProductValues, version: number) {
    await tx
      .update(s.product)
      .set({ ...v, price: money(v.price), priceTerrace: optMoney(v.priceTerrace), active: true, version })
      .where(and(eq(s.product.storeId, storeId), eq(s.product.id, id)));
  }

  async insertQuestion(tx: Tx, storeId: string, id: string, v: QuestionValues) {
    await tx.insert(s.question).values({ id, storeId, ...v });
  }

  async updateQuestion(tx: Tx, storeId: string, id: string, v: QuestionValues, version: number) {
    await tx
      .update(s.question)
      .set({ ...v, active: true, version })
      .where(and(eq(s.question.storeId, storeId), eq(s.question.id, id)));
  }

  /** Lo que no viene en la lista se desactiva (nunca se borra) y sube su versión. */
  async deactivate(tx: Tx, storeId: string, what: "category" | "product" | "question", ids: string[]) {
    if (!ids.length) {
      return;
    }
    const t = { category: s.category, product: s.product, question: s.question }[what];
    await tx
      .update(t)
      .set({ active: false, version: sql`${t.version} + 1` })
      .where(and(eq(t.storeId, storeId), inArray(t.id, ids)));
  }

  // ───────────────────────── 16/11 · publicación de Carta ─────────────────────────
  /** Id de los canales del Manager: COMIDA y BEBIDA. */
  async channelIdsByCode(tx: Tx, storeId: string): Promise<Map<string, string>> {
    const rows = await tx
      .select({ id: s.printChannel.id, code: s.printChannel.code })
      .from(s.printChannel)
      .where(and(eq(s.printChannel.storeId, storeId), sql`${s.printChannel.code} IS NOT NULL`));
    return new Map(rows.map((r) => [r.code!, r.id]));
  }

  /** Teclas de la toma de pedido: se sustituyen todas las de la tienda por las de la carga. */
  async replaceKeys(
    tx: Tx,
    storeId: string,
    keys: { categoryId: string; productId: string; label: string | null; bg: string | null; fg: string | null; x: number; y: number }[],
  ) {
    await tx.delete(s.categoryProduct).where(eq(s.categoryProduct.storeId, storeId));
    if (!keys.length) {
      return;
    }
    await tx.insert(s.categoryProduct).values(
      keys.map((k) => ({
        categoryId: k.categoryId,
        productId: k.productId,
        storeId,
        label: k.label,
        bgColor: k.bg,
        fgColor: k.fg,
        posX: k.x,
        posY: k.y,
      })),
    );
  }

  /** Teclas actuales de la tienda (para comparar si cambian). */
  async keys(tx: Tx, storeId: string) {
    return tx
      .select({
        categoryId: s.categoryProduct.categoryId,
        productId: s.categoryProduct.productId,
        label: s.categoryProduct.label,
        bg: s.categoryProduct.bgColor,
        fg: s.categoryProduct.fgColor,
        x: s.categoryProduct.posX,
        y: s.categoryProduct.posY,
      })
      .from(s.categoryProduct)
      .where(eq(s.categoryProduct.storeId, storeId))
      .orderBy(asc(s.categoryProduct.categoryId), asc(s.categoryProduct.posY), asc(s.categoryProduct.posX));
  }

  /** Solo precios (carga prices). */
  async setPrices(tx: Tx, storeId: string, id: string, price: number, priceTerrace: number | null, version: number) {
    await tx
      .update(s.product)
      .set({ price: money(price), priceTerrace: optMoney(priceTerrace), version })
      .where(and(eq(s.product.storeId, storeId), eq(s.product.id, id)));
  }

  /** Solo nombres (carga names); la tecla sigue al texto del botón si no tenía uno propio. */
  async setNames(
    tx: Tx,
    storeId: string,
    id: string,
    v: { name: string; ticketName: string | null; buttonLabel: string | null; translations: Translations },
    oldShown: string,
    version: number,
  ) {
    await tx
      .update(s.product)
      .set({ name: v.name, ticketName: v.ticketName, buttonLabel: v.buttonLabel, translations: v.translations, version })
      .where(and(eq(s.product.storeId, storeId), eq(s.product.id, id)));
    await tx
      .update(s.categoryProduct)
      .set({ label: v.buttonLabel ?? v.name })
      .where(
        and(
          eq(s.categoryProduct.storeId, storeId),
          eq(s.categoryProduct.productId, id),
          sql`(${s.categoryProduct.label} IS NULL OR ${s.categoryProduct.label} = ${oldShown})`,
        ),
      );
  }

  // ───────────────────────── cargas (catalog_release) ─────────────────────────
  private releaseCols = {
    id: s.catalogRelease.id,
    kind: s.catalogRelease.kind,
    publicationId: s.catalogRelease.publicationId,
    publicationType: s.catalogRelease.publicationType,
    releaseVersion: s.catalogRelease.releaseVersion,
    effectiveAt: s.catalogRelease.effectiveAt,
    status: s.catalogRelease.status,
    checksum: s.catalogRelease.checksum,
    menu: s.catalogRelease.menu,
    priceLine: s.catalogRelease.priceLine,
    storeCode: s.catalogRelease.storeCode,
    note: s.catalogRelease.note,
    receivedAt: s.catalogRelease.receivedAt,
    appliedAt: s.catalogRelease.appliedAt,
    error: s.catalogRelease.error,
    result: s.catalogRelease.result,
    decidedBy: s.catalogRelease.decidedBy,
  };

  async releaseByKey(tx: Tx, storeId: string, publicationId: string, version: number): Promise<ReleaseRow | null> {
    const [r] = await tx
      .select(this.releaseCols)
      .from(s.catalogRelease)
      .where(
        and(
          eq(s.catalogRelease.storeId, storeId),
          eq(s.catalogRelease.publicationId, publicationId),
          eq(s.catalogRelease.releaseVersion, version),
        ),
      );
    return r ?? null;
  }

  /** La versión más alta ya aplicada o pendiente de esa publicación. */
  async latestRelease(tx: Tx, storeId: string, publicationId: string): Promise<ReleaseRow | null> {
    const [r] = await tx
      .select(this.releaseCols)
      .from(s.catalogRelease)
      .where(
        and(
          eq(s.catalogRelease.storeId, storeId),
          eq(s.catalogRelease.publicationId, publicationId),
          inArray(s.catalogRelease.status, ["applied", "unchanged", "pending", "confirm"]),
        ),
      )
      .orderBy(sql`${s.catalogRelease.releaseVersion} DESC`)
      .limit(1);
    return r ?? null;
  }

  async releaseById(tx: Q, storeId: string, id: string, lock = false): Promise<(ReleaseRow & { payload: unknown }) | null> {
    const base = tx
      .select({ ...this.releaseCols, payload: s.catalogRelease.payload })
      .from(s.catalogRelease)
      .where(and(eq(s.catalogRelease.storeId, storeId), sql`${s.catalogRelease.id}::text = ${id}`));
    const [r] = lock ? await base.for("update") : await base;
    return r ?? null;
  }

  async insertRelease(
    tx: Tx,
    storeId: string,
    r: Omit<ReleaseRow, "receivedAt" | "appliedAt" | "error" | "result" | "decidedBy"> & {
      payload: unknown;
      appliedAt?: string | null;
      result?: unknown;
    },
  ) {
    await tx.insert(s.catalogRelease).values({
      id: r.id,
      storeId,
      kind: r.kind,
      publicationId: r.publicationId,
      publicationType: r.publicationType,
      releaseVersion: r.releaseVersion,
      effectiveAt: r.effectiveAt,
      status: r.status,
      checksum: r.checksum,
      menu: r.menu,
      priceLine: r.priceLine,
      storeCode: r.storeCode,
      note: r.note,
      payload: r.payload,
      appliedAt: r.appliedAt ?? null,
      result: r.result ?? null,
    });
  }

  async setReleaseStatus(
    tx: Q,
    storeId: string,
    id: string,
    v: { status: string; appliedAt?: string | null; error?: string | null; result?: unknown; decidedBy?: string | null },
  ) {
    await tx
      .update(s.catalogRelease)
      .set({
        status: v.status,
        ...(v.appliedAt !== undefined ? { appliedAt: v.appliedAt } : {}),
        ...(v.error !== undefined ? { error: v.error?.slice(0, 300) ?? null } : {}),
        ...(v.result !== undefined ? { result: v.result } : {}),
        ...(v.decidedBy !== undefined ? { decidedBy: v.decidedBy } : {}),
      })
      .where(and(eq(s.catalogRelease.storeId, storeId), eq(s.catalogRelease.id, id)));
  }

  /** Las pendientes más antiguas de la misma publicación quedan «superseded» al llegar otra más nueva. */
  async supersede(tx: Tx, storeId: string, publicationId: string, belowVersion: number) {
    await tx
      .update(s.catalogRelease)
      .set({ status: "superseded" })
      .where(
        and(
          eq(s.catalogRelease.storeId, storeId),
          eq(s.catalogRelease.publicationId, publicationId),
          inArray(s.catalogRelease.status, ["pending", "confirm"]),
          sql`${s.catalogRelease.releaseVersion} < ${belowVersion}`,
        ),
      );
  }

  async releases(storeId: string, limit: number, q: Q = this.database.db): Promise<ReleaseRow[]> {
    return q
      .select(this.releaseCols)
      .from(s.catalogRelease)
      .where(eq(s.catalogRelease.storeId, storeId))
      .orderBy(sql`${s.catalogRelease.receivedAt} DESC`)
      .limit(limit);
  }

  /** Pendientes que ya tocan (todas las tiendas de esta base). */
  async dueReleases(now: Date, q: Q = this.database.db): Promise<{ id: string; storeId: string }[]> {
    return q
      .select({ id: s.catalogRelease.id, storeId: s.catalogRelease.storeId })
      .from(s.catalogRelease)
      .where(and(eq(s.catalogRelease.status, "pending"), sql`${s.catalogRelease.effectiveAt} <= ${now.toISOString()}::timestamptz`))
      .orderBy(asc(s.catalogRelease.effectiveAt), asc(s.catalogRelease.releaseVersion))
      .limit(20);
  }

  // ───────────────────────── recuentos para IN_USE ─────────────────────────
  /** Productos activos de cada categoría. */
  async activeProductsPerCategory(tx: Tx, storeId: string, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) {
      return new Map();
    }
    const rows = await tx
      .select({ id: s.product.categoryId, n: sql<number>`count(*)::int` })
      .from(s.product)
      .where(
        and(eq(s.product.storeId, storeId), eq(s.product.active, true), inArray(s.product.categoryId, ids)),
      )
      .groupBy(s.product.categoryId);
    return new Map(rows.map((r) => [r.id as string, Number(r.n)]));
  }

  /** Productos activos que hacen cada pregunta. */
  async activeProductsPerQuestion(tx: Tx, storeId: string, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) {
      return new Map();
    }
    const rows = await tx
      .select({ id: s.productQuestion.questionId, n: sql<number>`count(*)::int` })
      .from(s.productQuestion)
      .innerJoin(s.product, eq(s.product.id, s.productQuestion.productId))
      .where(
        and(
          eq(s.productQuestion.storeId, storeId),
          eq(s.product.active, true),
          inArray(s.productQuestion.questionId, ids),
        ),
      )
      .groupBy(s.productQuestion.questionId);
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  /** Líneas vivas de cada producto en mesas abiertas (open o billing). */
  async openLinesPerProduct(tx: Tx, storeId: string, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) {
      return new Map();
    }
    const rows = await tx
      .select({ id: s.orderLine.productId, n: sql<number>`count(*)::int` })
      .from(s.orderLine)
      .innerJoin(s.orders, eq(s.orders.id, s.orderLine.orderId))
      .where(
        and(
          eq(s.orderLine.storeId, storeId),
          eq(s.orderLine.deleted, false),
          inArray(s.orders.status, ["open", "billing"]),
          inArray(s.orderLine.productId, ids),
        ),
      )
      .groupBy(s.orderLine.productId);
    return new Map(rows.map((r) => [r.id as string, Number(r.n)]));
  }

  // ───────────────────────── vista previa ─────────────────────────
  /** Categorías activas (en su orden) para la vista previa. */
  async previewCategories(storeId: string, q: Q = this.database.db) {
    return q
      .select({
        id: s.category.id,
        name: s.category.name,
        bgColor: s.category.bgColor,
        fgColor: s.category.fgColor,
        hidden: s.category.hidden,
        orderOnTable: s.category.orderOnTable,
      })
      .from(s.category)
      .where(and(eq(s.category.storeId, storeId), eq(s.category.active, true)))
      .orderBy(asc(s.category.sortOrder), asc(s.category.name));
  }

  /** Teclas de la toma de pedido (category_product) con el producto y la categoría propia del producto. */
  async previewRows(storeId: string, q: Q = this.database.db): Promise<PreviewRow[]> {
    const own = sql`(SELECT json_build_object('orderOnTable', c.order_on_table, 'hidden', c.hidden, 'active', c.active) FROM category c WHERE c.id = ${s.product.categoryId})`;
    const rows = await q
      .select({
        categoryId: s.categoryProduct.categoryId,
        productId: s.product.id,
        plu: s.product.plu,
        name: s.product.name,
        description: s.product.description,
        price: s.product.price,
        priceTerrace: s.product.priceTerrace,
        soldOut: s.product.soldOut,
        answerOnly: s.product.answerOnly,
        orderOnTable: s.product.orderOnTable,
        active: s.product.active,
        ownCategory: sql<PreviewRow["ownCategory"]>`${own}`,
      })
      .from(s.categoryProduct)
      .innerJoin(s.product, eq(s.product.id, s.categoryProduct.productId))
      .where(eq(s.categoryProduct.storeId, storeId))
      .orderBy(asc(s.categoryProduct.posY), asc(s.categoryProduct.posX), asc(s.product.name));
    return rows.map((r) => ({ ...r, price: Number(r.price), priceTerrace: num(r.priceTerrace) }));
  }

  /** Preguntas activas de cada producto, en orden. */
  async productQuestionIds(storeId: string, q: Q = this.database.db): Promise<Map<string, string[]>> {
    const rows = await q
      .select({ productId: s.productQuestion.productId, questionId: s.productQuestion.questionId })
      .from(s.productQuestion)
      .innerJoin(s.question, eq(s.question.id, s.productQuestion.questionId))
      .where(and(eq(s.productQuestion.storeId, storeId), eq(s.question.active, true)))
      .orderBy(asc(s.productQuestion.sortOrder));
    const g = groupBy(rows, (r) => r.productId);
    return new Map([...g].map(([k, v]) => [k, v.map((x) => x.questionId)]));
  }

  // ───────────────────────── orden de categorías y áreas ─────────────────────────
  /** Activos con su orden, bloqueados para reordenarlos. */
  async activeForOrder(tx: Tx, storeId: string, what: "category" | "area") {
    const t = { category: s.category, area: s.area }[what];
    return tx
      .select({ id: t.id, name: t.name, sortOrder: t.sortOrder, version: t.version })
      .from(t)
      .where(and(eq(t.storeId, storeId), eq(t.active, true)))
      .orderBy(asc(t.sortOrder), asc(t.name))
      .for("update");
  }

  async setSortOrder(tx: Tx, storeId: string, what: "category" | "area", id: string, sortOrder: number) {
    const t = { category: s.category, area: s.area }[what];
    await tx
      .update(t)
      .set({ sortOrder, version: sql`${t.version} + 1` })
      .where(and(eq(t.storeId, storeId), eq(t.id, id)));
  }

  // ───────────────────────── agotado ─────────────────────────
  /** Producto por UUID o PLU, bloqueado; null si no existe en la tienda. */
  async productForUpdate(tx: Tx, storeId: string, idOrPlu: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrPlu);
    const isPlu = /^\d{1,9}$/.test(idOrPlu);
    if (!isUuid && !isPlu) {
      return null;
    }
    let where;
    if (isUuid) {
      where = and(eq(s.product.storeId, storeId), eq(s.product.id, idOrPlu));
    } else {
      where = and(eq(s.product.storeId, storeId), eq(s.product.plu, Number(idOrPlu)));
    }
    const [p] = await tx
      .select({
        id: s.product.id,
        plu: s.product.plu,
        name: s.product.name,
        soldOut: s.product.soldOut,
        version: s.product.version,
      })
      .from(s.product)
      .where(where)
      .for("update");
    return p ?? null;
  }

  async setSoldOut(tx: Tx, storeId: string, id: string, soldOut: boolean, version: number) {
    await tx
      .update(s.product)
      .set({ soldOut, version })
      .where(and(eq(s.product.storeId, storeId), eq(s.product.id, id)));
  }

  // ───────────────────────── permisos y PWA ─────────────────────────
  /** Catálogo de permisos (tabla común a todas las tiendas), en su orden. */
  async permissions(q: Q = this.database.db) {
    return q
      .select({
        code: s.permission.code,
        module: s.permission.module,
        name: s.permission.name,
        sortOrder: s.permission.sortOrder,
      })
      .from(s.permission)
      .orderBy(asc(s.permission.sortOrder), asc(s.permission.code));
  }

  /** Código y nombre del local (para el manifest de la PDA). */
  async storeName(storeId: string, q: Q = this.database.db) {
    const [r] = await q
      .select({ code: s.store.code, name: s.store.name })
      .from(s.store)
      .where(eq(s.store.id, storeId));
    return r ?? null;
  }

  // ───────────────────────── Editar sala ─────────────────────────
  /** El área (bloqueada) o null si no existe en la tienda. */
  async areaForUpdate(tx: Tx, storeId: string, areaId: string) {
    const [a] = await tx
      .select({ id: s.area.id, name: s.area.name, version: s.area.version })
      .from(s.area)
      .where(and(eq(s.area.storeId, storeId), eq(s.area.id, areaId)))
      .for("update");
    return a ?? null;
  }

  /** Mesas activas del área con su posición y tamaño. */
  async areaTables(tx: Tx, storeId: string, areaId: string): Promise<LayoutTable[]> {
    const rows = await tx
      .select({
        id: s.diningTable.id,
        number: s.diningTable.number,
        posX: s.diningTable.posX,
        posY: s.diningTable.posY,
        width: s.diningTable.width,
        height: s.diningTable.height,
      })
      .from(s.diningTable)
      .where(
        and(
          eq(s.diningTable.storeId, storeId),
          eq(s.diningTable.areaId, areaId),
          eq(s.diningTable.active, true),
        ),
      )
      .for("update");
    return rows.map((r) => ({ ...r, posX: num(r.posX), posY: num(r.posY) }));
  }

  async moveTable(
    tx: Tx,
    storeId: string,
    id: string,
    p: { x: number; y: number; width: number | null; height: number | null },
  ) {
    await tx
      .update(s.diningTable)
      .set({
        posX: p.x.toFixed(2),
        posY: p.y.toFixed(2),
        width: p.width,
        height: p.height,
        version: sql`${s.diningTable.version} + 1`,
      })
      .where(and(eq(s.diningTable.storeId, storeId), eq(s.diningTable.id, id)));
  }

  async drawings(tx: Tx, storeId: string, areaId: string): Promise<Drawing[]> {
    const rows = await tx
      .select({
        kind: s.areaDrawing.kind,
        x1: s.areaDrawing.x1,
        y1: s.areaDrawing.y1,
        x2: s.areaDrawing.x2,
        y2: s.areaDrawing.y2,
        item: s.areaDrawing.item,
        label: s.areaDrawing.label,
      })
      .from(s.areaDrawing)
      .where(and(eq(s.areaDrawing.storeId, storeId), eq(s.areaDrawing.areaId, areaId)))
      .orderBy(asc(s.areaDrawing.sortOrder));
    return rows.map((r) => ({ ...r, x1: Number(r.x1), y1: Number(r.y1), x2: num(r.x2), y2: num(r.y2) }));
  }

  /** Los dibujos del área se sustituyen enteros (en el orden en que llegan). */
  async replaceDrawings(tx: Tx, storeId: string, areaId: string, list: Drawing[]) {
    await tx
      .delete(s.areaDrawing)
      .where(and(eq(s.areaDrawing.storeId, storeId), eq(s.areaDrawing.areaId, areaId)));
    if (!list.length) {
      return;
    }
    await tx.insert(s.areaDrawing).values(
      list.map((d, i) => ({
        id: crypto.randomUUID(),
        storeId,
        areaId,
        kind: d.kind,
        x1: d.x1.toFixed(2),
        y1: d.y1.toFixed(2),
        x2: optMoney(d.x2),
        y2: optMoney(d.y2),
        item: d.item,
        label: d.label,
        sortOrder: i,
      })),
    );
  }

  async setAreaVersion(tx: Tx, storeId: string, areaId: string, version: number) {
    await tx
      .update(s.area)
      .set({ version })
      .where(and(eq(s.area.storeId, storeId), eq(s.area.id, areaId)));
  }
}
