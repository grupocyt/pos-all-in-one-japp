import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { Database, Tx } from "@japp/db";
import {
  DomainError,
  SYNC_LIMITS,
  assertNoRepeats,
  assertNotInUse,
  assertSyncSize,
  checkConfigRecord,
  describeDiff,
  fail,
  planSync,
  resolveRef,
  syncCounts,
  type SyncAction,
  type SyncMatch,
} from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { ConfigApplication } from "../Applications/ConfigApplication.js";
import { ConfigHistoryApplication } from "../Applications/ConfigHistoryApplication.js";
import { MODULES, labelsOf } from "../Applications/ConfigRegistry.js";
import {
  CartaSyncApplication,
  type CategoryRow,
  type CategoryValues,
  type ProductRow,
  type ProductValues,
  type QuestionRow,
  type QuestionValues,
} from "../Applications/CartaSyncApplication.js";
import {
  CartaSyncModel,
  CategoriasSyncModel,
  PreguntasSyncModel,
  ProductosSyncModel,
  type SyncCategory,
  type SyncProduct,
  type SyncQuestion,
} from "../Models/CartaModels.js";

type Module = "categorias" | "productos" | "preguntas";
type Snap = Record<string, unknown>;

/** Una fila que cambia: va al historial de Ajustes (config_change_log), una por registro. */
interface Change {
  module: Module;
  action: "create" | "update" | "activate" | "deactivate";
  id: string;
  name: string;
  before: Snap | null;
  after: Snap;
}

/** Lo que el sync hace con cada fila que llega (y con cada una que se quita). */
interface ItemResult {
  externalId: string | null;
  id: string;
  name: string;
  plu: number | null;
  action: SyncAction | "deactivated";
}

interface CategoryOp {
  index: number;
  id: string;
  action: SyncMatch<CategoryRow>["action"];
  before: CategoryRow | null;
  values: CategoryValues;
}

interface AnswerValues {
  productId: string;
  label: string | null;
  extraPrice: number;
  bgColor: string | null;
  fgColor: string | null;
}

interface QuestionOp {
  index: number;
  id: string;
  action: SyncMatch<QuestionRow>["action"];
  before: QuestionRow | null;
  values: QuestionValues;
  /** undefined = no vino: las respuestas que tenía se conservan. */
  answers?: AnswerValues[];
}

interface ProductOp {
  index: number;
  id: string;
  action: SyncMatch<ProductRow>["action"];
  before: ProductRow | null;
  /** plu null = producto nuevo sin PLU: recibe el siguiente libre antes de escribir. */
  values: Omit<ProductValues, "plu"> & { plu: number | null };
  /** undefined = no vino: las preguntas que tenía se conservan. */
  questions?: string[];
}

/** Dónde buscar las referencias de una fila (en la tienda o en la misma carga de la carta). */
interface Refs {
  categoryByExt: Map<string, string>;
  categoryById: Map<string, string>;
  questionByExt: Map<string, string>;
  questionById: Map<string, string>;
}
interface ProductRefs {
  byExt: Map<string, string>;
  byId: Map<string, string>;
  byPlu: Map<string, string>;
}

/** Valor que llega encima de lo que había: si no viene (undefined) se conserva. */
function keep<T>(sent: T | undefined, current: T): T {
  if (sent === undefined) {
    return current;
  }
  return sent;
}
/** Igual, para campos que admiten null (null que llega = vaciar). */
function keepNullable<T>(sent: T | null | undefined, current: T | null): T | null {
  if (sent === undefined) {
    return current;
  }
  return sent ?? null;
}

/** Nombre en el TPV: vacío o igual al nombre del PLU = null (la tecla sigue al nombre del PLU). */
function sameAsName(label: string | null, name: string): string | null {
  const l = label?.trim();
  if (!l || l === name.trim()) {
    return null;
  }
  return l;
}

/** Ruta de zod → campo del contrato: ["items", 3, "name"] → items[3].name. */
function fieldOf(path: (string | number)[]) {
  let out = "";
  for (const p of path) {
    if (typeof p === "number") {
      out += `[${p}]`;
    } else if (out) {
      out += `.${p}`;
    } else {
      out = p;
    }
  }
  return out;
}

/** Valida el cuerpo; los errores salen con el campo de la fila (items[3].name), uno por campo. */
function parseRows<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw new ZodError(r.error.issues.map((i) => ({ ...i, path: [fieldOf(i.path)] })));
  }
  return r.data;
}

/** Una regla de un registro (checkConfigRecord) que falla en una fila: el campo lleva delante la fila. */
function atRow<T>(row: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DomainError && typeof e.details.field === "string") {
      throw new DomainError(e.code, e.message, { ...e.details, field: `${row}.${e.details.field}` });
    }
    throw e;
  }
}

/** Tamaño de una lista del cuerpo antes de validarla (una carga enorme → 413 sin recorrerla). */
function sizeOf(body: unknown, key: string): number {
  const v = (body as Record<string, unknown> | null)?.[key];
  if (Array.isArray(v)) {
    return v.length;
  }
  return 0;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Servicios Sync del App Manager: el Manager manda la lista COMPLETA y la tienda queda así, en una sola
 * transacción (todo o nada). Casar, repetidos, tamaños, referencias e IN_USE los decide @japp/domain (cartaSync).
 * Un campo que no viene se conserva; «unchanged» = lo que manda el Manager ya estaba igual.
 * Por llamada: store.config_version +1 una vez (solo si algo cambia), una fila de historial por registro
 * que cambia y una fila en la cola hacia el Manager (entity 'config') con el resumen.
 */
@Injectable()
export class CartaSyncService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CartaSyncApplication) private readonly carta: CartaSyncApplication,
    @Inject(ConfigApplication) private readonly config: ConfigApplication,
    @Inject(ConfigHistoryApplication) private readonly changes: ConfigHistoryApplication,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────────────────────── endpoints ─────────────────────────
  /** POST /config/categorias/sync. Clave natural: el nombre. Quitar una con productos activos → 409 IN_USE. */
  async syncCategorias(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.categorias");
    assertSyncSize("categorías", sizeOf(body, "items"), SYNC_LIMITS.categorias);
    const b = parseRows(CategoriasSyncModel, body);
    return this.database.withTx(async (tx) => {
      await this.carta.lockCarta(tx, se.storeId);
      const now = await this.carta.carta(se.storeId, { lock: true }, tx);
      const plan = this.planCategories(now.categories, b.items, "items");
      const used = await this.carta.activeProductsPerCategory(
        tx,
        se.storeId,
        plan.deactivate.map((c) => c.id),
      );
      assertNotInUse(
        plan.deactivate.map((c) => ({ name: c.name, count: used.get(c.id) ?? 0 })),
        "la categoría",
      );
      const out: Change[] = [];
      await this.applyCategories(tx, se, plan.ops, out);
      await this.deactivateAll(tx, se, "categorias", plan.deactivate, out);
      const configVersion = await this.finish(tx, se, "categorias", out);
      return this.listResult("categorias", plan.ops, plan.deactivate, configVersion, out, (op) => ({
        externalId: op.values.externalId,
        name: op.values.name,
        plu: null,
      }));
    });
  }

  /**
   * POST /config/productos/sync. Clave natural: el PLU (nuevo sin PLU → el siguiente libre).
   * Categoría, preguntas e IVA tienen que existir en la tienda (422 REF_NOT_FOUND). Canales y, si no viene, agotado se conservan.
   * Quitar uno que está en una mesa abierta → 409 IN_USE.
   */
  async syncProductos(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.productos");
    assertSyncSize("productos", sizeOf(body, "items"), SYNC_LIMITS.productos);
    const b = parseRows(ProductosSyncModel, body);
    return this.database.withTx(async (tx) => {
      await this.carta.lockCarta(tx, se.storeId);
      // el de PLU antes de bloquear filas: el alta desde Ajustes lo toma en el mismo orden (carta → PLU → filas)
      await this.config.lockPlu(tx, se.storeId);
      const now = await this.carta.carta(se.storeId, { lock: true }, tx);
      const refs = this.storeRefs(now);
      const taxes = await this.taxMap(tx, se.storeId);
      const plan = this.planProducts(now.products, b.items, "items", refs, taxes, { soldOut: true });
      const used = await this.carta.openLinesPerProduct(
        tx,
        se.storeId,
        plan.deactivate.map((p) => p.id),
      );
      assertNotInUse(
        plan.deactivate.map((p) => ({ name: p.name, count: used.get(p.id) ?? 0 })),
        "el producto",
      );
      await this.assignPlus(tx, se, plan.ops, now.products);
      const out: Change[] = [];
      await this.applyProducts(tx, se, plan.ops, out, now.products);
      await this.deactivateAll(tx, se, "productos", plan.deactivate, out);
      const configVersion = await this.finish(tx, se, "productos", out);
      return this.listResult("productos", plan.ops, plan.deactivate, configVersion, out, (op) => ({
        externalId: op.values.externalId,
        name: op.values.name,
        plu: op.values.plu,
      }));
    });
  }

  /**
   * POST /config/preguntas/sync. Clave natural: el texto. Las respuestas (productExternalId, productId o plu)
   * tienen que ser productos activos de la tienda y sustituyen a las que había, en orden.
   * Quitar una que usa un producto activo → 409 IN_USE.
   */
  async syncPreguntas(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.preguntas");
    assertSyncSize("preguntas", sizeOf(body, "items"), SYNC_LIMITS.preguntas);
    const b = parseRows(PreguntasSyncModel, body);
    return this.database.withTx(async (tx) => {
      await this.carta.lockCarta(tx, se.storeId);
      const now = await this.carta.carta(se.storeId, { lock: true }, tx);
      const plan = this.planQuestions(now.questions, b.items, "items");
      this.resolveAnswers(plan.ops, b.items, "items", this.productRefs(now.products.filter((p) => p.active)));
      const used = await this.carta.activeProductsPerQuestion(
        tx,
        se.storeId,
        plan.deactivate.map((q) => q.id),
      );
      assertNotInUse(
        plan.deactivate.map((q) => ({ name: q.name, count: used.get(q.id) ?? 0 })),
        "la pregunta",
      );
      const out: Change[] = [];
      await this.applyQuestions(tx, se, plan.ops, out);
      await this.applyAnswers(tx, se, plan.ops);
      await this.deactivateAll(tx, se, "preguntas", plan.deactivate, out);
      const configVersion = await this.finish(tx, se, "preguntas", out);
      return this.listResult("preguntas", plan.ops, plan.deactivate, configVersion, out, (op) => ({
        externalId: op.values.externalId,
        name: op.values.name,
        plu: null,
      }));
    });
  }

  /**
   * POST /config/carta/sync: categorías + productos + preguntas juntos, todo o nada.
   * Las referencias se buscan DENTRO de la carga (lo que no viene se quita, así que no se puede nombrar):
   * producto → categoría y preguntas; respuesta → producto. Lo que no viene se quita en cascada, sin IN_USE.
   * Canales de impresión y agotado son de la tienda: se conservan.
   */
  async syncCarta(se: Session, body: unknown) {
    for (const p of ["ajustes.categorias", "ajustes.productos", "ajustes.preguntas"]) {
      await this.auth.require(se, p);
    }
    assertSyncSize("categorías", sizeOf(body, "categories"), SYNC_LIMITS.carta.categories);
    assertSyncSize("productos", sizeOf(body, "products"), SYNC_LIMITS.carta.products);
    assertSyncSize("preguntas", sizeOf(body, "questions"), SYNC_LIMITS.carta.questions);
    const b = parseRows(CartaSyncModel, body);
    return this.database.withTx(async (tx) => {
      await this.carta.lockCarta(tx, se.storeId);
      // el de PLU antes de bloquear filas: el alta desde Ajustes lo toma en el mismo orden (carta → PLU → filas)
      await this.config.lockPlu(tx, se.storeId);
      const now = await this.carta.carta(se.storeId, { lock: true }, tx);
      const cats = this.planCategories(now.categories, b.categories, "categories");
      const qs = this.planQuestions(now.questions, b.questions, "questions");
      const refs: Refs = {
        categoryByExt: this.byExternal(cats.ops),
        categoryById: new Map(cats.ops.map((o) => [o.id, o.id])),
        questionByExt: this.byExternal(qs.ops),
        questionById: new Map(qs.ops.map((o) => [o.id, o.id])),
      };
      const taxes = await this.taxMap(tx, se.storeId);
      const prods = this.planProducts(now.products, b.products, "products", refs, taxes, { soldOut: false });
      await this.assignPlus(tx, se, prods.ops, now.products);
      this.resolveAnswers(qs.ops, b.questions, "questions", {
        byExt: this.byExternal(prods.ops),
        byId: new Map(prods.ops.map((o) => [o.id, o.id])),
        byPlu: new Map(prods.ops.map((o) => [String(o.values.plu), o.id])),
      });
      const out: Change[] = [];
      await this.applyCategories(tx, se, cats.ops, out);
      await this.applyQuestions(tx, se, qs.ops, out);
      await this.applyProducts(tx, se, prods.ops, out, now.products);
      await this.applyAnswers(tx, se, qs.ops);
      await this.deactivateAll(tx, se, "productos", prods.deactivate, out);
      await this.deactivateAll(tx, se, "preguntas", qs.deactivate, out);
      await this.deactivateAll(tx, se, "categorias", cats.deactivate, out);
      const configVersion = await this.finish(tx, se, "carta", out);
      const actionsOf = (ops: { id: string; action: SyncAction }[], m: Module) =>
        ops.map((o) => this.finalAction(o, m, out));
      const ids: Record<string, string> = {};
      for (const o of [...cats.ops, ...qs.ops, ...prods.ops]) {
        if (o.values.externalId) {
          ids[o.values.externalId] = o.id;
        }
      }
      return {
        categories: syncCounts(actionsOf(cats.ops, "categorias"), cats.deactivate.length),
        products: syncCounts(actionsOf(prods.ops, "productos"), prods.deactivate.length),
        questions: syncCounts(actionsOf(qs.ops, "preguntas"), qs.deactivate.length),
        configVersion,
        ids,
      };
    });
  }

  // ───────────────────────── planes (casar y completar cada fila) ─────────────────────────
  private planCategories(existing: CategoryRow[], items: SyncCategory[], path: string) {
    assertNoRepeats(
      items.map((c) => ({ externalId: c.externalId ?? null, naturalKey: c.name })),
      "name",
      path,
    );
    const plan = planSync(
      existing.map((e) => ({ ...e, naturalKey: e.name })),
      items.map((c) => ({ externalId: c.externalId ?? null, naturalKey: c.name })),
    );
    const ops: CategoryOp[] = plan.items.map((m) => {
      const inc = items[m.index]!;
      const before = m.existing;
      const values: CategoryValues = {
        externalId: inc.externalId ?? before?.externalId ?? null,
        name: inc.name,
        bgColor: keepNullable(inc.bgColor, before?.bgColor ?? null),
        fgColor: keepNullable(inc.fgColor, before?.fgColor ?? null),
        sortOrder: keep(inc.sortOrder, before?.sortOrder ?? 0),
        hidden: keep(inc.hidden, before?.hidden ?? false),
        orderOnTable: keep(inc.orderOnTable, before?.orderOnTable ?? true),
      };
      // el nombre es único en la tienda (también entre desactivadas): otra categoría con ese nombre → DUPLICATE
      const clash = existing.find((e) => e.name === values.name && e.id !== before?.id);
      if (clash) {
        fail("DUPLICATE", `Ya hay otra categoría «${values.name}» en la tienda`, {
          field: `${path}[${m.index}].name`,
          id: clash.id,
          externalId: clash.externalId,
        });
      }
      return { index: m.index, id: before?.id ?? randomUUID(), action: m.action, before, values };
    });
    return { ops, deactivate: plan.deactivate };
  }

  private planQuestions(existing: QuestionRow[], items: SyncQuestion[], path: string) {
    assertNoRepeats(
      items.map((q) => ({ externalId: q.externalId ?? null, naturalKey: q.name })),
      "name",
      path,
    );
    items.forEach((q, i) => {
      if (q.answers) {
        assertSyncSize(`respuestas en ${path}[${i}]`, q.answers.length, SYNC_LIMITS.answersPerQuestion);
      }
    });
    const plan = planSync(
      existing.map((e) => ({ ...e, naturalKey: e.name })),
      items.map((q) => ({ externalId: q.externalId ?? null, naturalKey: q.name })),
    );
    const ops: QuestionOp[] = plan.items.map((m) => {
      const inc = items[m.index]!;
      const before = m.existing;
      const values: QuestionValues = {
        externalId: inc.externalId ?? before?.externalId ?? null,
        name: inc.name,
        minAnswers: keep(inc.minAnswers, before?.minAnswers ?? 0),
        maxAnswers: keep(inc.maxAnswers, before?.maxAnswers ?? 1),
        course: keepNullable(inc.course, before?.course ?? null),
      };
      return { index: m.index, id: before?.id ?? randomUUID(), action: m.action, before, values };
    });
    return { ops, deactivate: plan.deactivate };
  }

  private planProducts(
    existing: ProductRow[],
    items: SyncProduct[],
    path: string,
    refs: Refs,
    taxes: Map<string, string>,
    o: { soldOut: boolean },
  ) {
    const key = (p: SyncProduct) => {
      if (p.plu == null) {
        return null;
      }
      return String(p.plu);
    };
    assertNoRepeats(
      items.map((p) => ({ externalId: p.externalId ?? null, naturalKey: key(p) })),
      "plu",
      path,
    );
    // el PLU nunca cambia: manda sobre el externalId (el producto conserva su id, sus canales y su historial)
    const plan = planSync(
      existing.map((e) => ({ ...e, naturalKey: String(e.plu) })),
      items.map((p) => ({ externalId: p.externalId ?? null, naturalKey: key(p) })),
      { keyFirst: true },
    );
    const ops: ProductOp[] = plan.items.map((m) => {
      const inc = items[m.index]!;
      const before = m.existing;
      const row = `${path}[${m.index}]`;
      const plu = inc.plu ?? before?.plu ?? null;
      if (plu !== null) {
        // el PLU es único en la tienda (también entre desactivados): si lo tiene otro producto → DUPLICATE
        const clash = existing.find((e) => e.plu === plu && e.id !== before?.id);
        if (clash) {
          fail("DUPLICATE", `El PLU ${plu} ya lo tiene otro producto (${clash.name})`, {
            field: `${row}.plu`,
            id: clash.id,
            externalId: clash.externalId,
          });
        }
      }
      let soldOut = before?.soldOut ?? false;
      if (o.soldOut) {
        soldOut = keep(inc.soldOut, soldOut);
      }
      const values: ProductOp["values"] = {
        externalId: inc.externalId ?? before?.externalId ?? null,
        plu,
        name: inc.name,
        ticketName: keepNullable(inc.ticketName, before?.ticketName ?? null),
        buttonLabel: sameAsName(keepNullable(inc.buttonLabel, before?.buttonLabel ?? null), inc.name),
        description: keepNullable(inc.description, before?.description ?? null),
        categoryId: this.categoryOf(inc, row, refs, before),
        price: inc.price,
        priceTerrace: keepNullable(inc.priceTerrace, before?.priceTerrace ?? null),
        taxId: this.taxOf(inc, row, taxes, before),
        bgColor: keepNullable(inc.bgColor, before?.bgColor ?? null),
        fgColor: keepNullable(inc.fgColor, before?.fgColor ?? null),
        answerOnly: keep(inc.answerOnly, before?.answerOnly ?? false),
        orderOnTable: keep(inc.orderOnTable, before?.orderOnTable ?? true),
        soldOut,
      };
      atRow(row, () => checkConfigRecord("productos", values, { isNew: !before }));
      return {
        index: m.index,
        id: before?.id ?? randomUUID(),
        action: m.action,
        before,
        values,
        questions: this.questionsOf(inc, row, refs),
      };
    });
    // un externalId que manda el Manager para otro PLU deja de ser del producto que solo lo conservaba
    const sent = new Map<string, number>();
    items.forEach((p, i) => {
      if (p.externalId) {
        sent.set(p.externalId.trim(), i);
      }
    });
    for (const op of ops) {
      const ext = op.values.externalId;
      if (ext && !items[op.index]!.externalId && sent.has(ext)) {
        op.values.externalId = null;
      }
    }
    return { ops, deactivate: plan.deactivate };
  }

  /** Categoría del producto: categoryExternalId (si viene) o categoryId; si no viene ninguno se conserva. */
  private categoryOf(inc: SyncProduct, row: string, refs: Refs, before: ProductRow | null): string | null {
    if (inc.categoryExternalId) {
      return resolveRef(
        refs.categoryByExt,
        inc.categoryExternalId,
        `${row}.categoryExternalId`,
        "la categoría",
      );
    }
    if (inc.categoryId) {
      return resolveRef(refs.categoryById, inc.categoryId, `${row}.categoryId`, "la categoría");
    }
    if (inc.categoryExternalId === null || inc.categoryId === null) {
      return null;
    }
    return before?.categoryId ?? null;
  }

  /** IVA por tipo: el IVA activo con ese tipo (si el que tenía ya es de ese tipo, se queda). */
  private taxOf(inc: SyncProduct, row: string, taxes: Map<string, string>, before: ProductRow | null) {
    if (inc.taxRate == null) {
      if (!before) {
        fail("VALIDATION", "Falta el IVA (taxRate) del producto nuevo", { field: `${row}.taxRate` });
      }
      return before!.taxId;
    }
    if (before && before.taxRate === inc.taxRate) {
      return before.taxId;
    }
    return resolveRef(taxes, inc.taxRate, `${row}.taxRate`, "un IVA activo del");
  }

  /**
   * Preguntas del producto, en orden: questionIds (ids de la tienda, como los devuelve GET /config/carta) y
   * después questionExternalIds que no estén ya. Si no viene ninguna de las dos, se conservan las que tenía.
   */
  private questionsOf(inc: SyncProduct, row: string, refs: Refs): string[] | undefined {
    if (inc.questionIds === undefined && inc.questionExternalIds === undefined) {
      return undefined;
    }
    const out: string[] = [];
    (inc.questionIds ?? []).forEach((id, j) => {
      out.push(resolveRef(refs.questionById, id, `${row}.questionIds[${j}]`, "la pregunta"));
    });
    (inc.questionExternalIds ?? []).forEach((ext, j) => {
      const id = resolveRef(refs.questionByExt, ext, `${row}.questionExternalIds[${j}]`, "la pregunta");
      if (!out.includes(id)) {
        out.push(id);
      }
    });
    return out;
  }

  /** Respuestas de cada pregunta → productos, en orden; y las reglas de la pregunta con sus respuestas. */
  private resolveAnswers(ops: QuestionOp[], items: SyncQuestion[], path: string, products: ProductRefs) {
    for (const op of ops) {
      const inc = items[op.index]!;
      const row = `${path}[${op.index}]`;
      if (inc.answers) {
        const prev = new Map((op.before?.answers ?? []).map((a) => [a.productId, a]));
        const seen = new Set<string>();
        op.answers = inc.answers.map((a, j) => {
          const at = `${row}.answers[${j}]`;
          let productId: string;
          if (a.productExternalId) {
            productId = resolveRef(
              products.byExt,
              a.productExternalId,
              `${at}.productExternalId`,
              "el producto",
            );
          } else if (a.productId) {
            productId = resolveRef(products.byId, a.productId, `${at}.productId`, "el producto");
          } else {
            productId = resolveRef(products.byPlu, a.plu!, `${at}.plu`, "el producto");
          }
          if (seen.has(productId)) {
            fail("DUPLICATE", "Ese producto ya es una respuesta de esta pregunta", { field: at });
          }
          seen.add(productId);
          // los colores de la tecla de la respuesta son de la tienda: se conservan
          return {
            productId,
            label: a.label ?? null,
            extraPrice: a.extraPrice ?? 0,
            bgColor: prev.get(productId)?.bgColor ?? null,
            fgColor: prev.get(productId)?.fgColor ?? null,
          };
        });
      }
      const answers = op.answers ?? op.before?.answers ?? [];
      atRow(row, () => checkConfigRecord("preguntas", { ...op.values, answers }, { isNew: !op.before }));
    }
  }

  /** PLU para los productos nuevos sin PLU: el siguiente libre, por encima también de los que vienen en la carga. */
  private async assignPlus(tx: Tx, se: Session, ops: ProductOp[], existing: ProductRow[]) {
    const missing = ops.filter((o) => o.values.plu === null);
    if (!missing.length) {
      return;
    }
    // mismo bloqueo que el alta desde Ajustes (ya tomado al empezar, justo después del de carta): dos altas a la vez
    // no se llevan el mismo número
    let next = await this.config.lockAndNextPlu(tx, se.storeId);
    const taken = new Set([...existing.map((p) => p.plu), ...ops.map((o) => o.values.plu)]);
    for (const o of missing) {
      while (taken.has(next)) {
        next += 1;
      }
      o.values.plu = next;
      taken.add(next);
    }
  }

  // ───────────────────────── escritura ─────────────────────────
  private async applyCategories(tx: Tx, se: Session, ops: CategoryOp[], out: Change[]) {
    for (const op of ops) {
      const after = { ...this.categorySnap(op.values), active: true };
      if (!op.before) {
        await this.carta.insertCategory(tx, se.storeId, op.id, op.values);
        out.push(this.change("categorias", "create", op.id, op.values.name, null, after));
        continue;
      }
      const before = { ...this.categorySnap(op.before), active: op.before.active };
      if (same(before, after)) {
        continue;
      }
      await this.carta.updateCategory(tx, se.storeId, op.id, op.values, op.before.version + 1);
      out.push(
        this.change("categorias", this.updateAction(op.before.active), op.id, op.values.name, before, after),
      );
    }
  }

  private async applyQuestions(tx: Tx, se: Session, ops: QuestionOp[], out: Change[]) {
    for (const op of ops) {
      const after = this.questionSnap(op.values, op.answers ?? op.before?.answers ?? [], true);
      if (!op.before) {
        await this.carta.insertQuestion(tx, se.storeId, op.id, op.values);
        out.push(this.change("preguntas", "create", op.id, op.values.name, null, after));
        continue;
      }
      const before = this.questionSnap(op.before, op.before.answers, op.before.active);
      if (same(before, after)) {
        continue;
      }
      await this.carta.updateQuestion(tx, se.storeId, op.id, op.values, op.before.version + 1);
      out.push(
        this.change("preguntas", this.updateAction(op.before.active), op.id, op.values.name, before, after),
      );
    }
  }

  /**
   * Respuestas (question_answer) en el orden de la lista, solo si cambian. Van después de los productos
   * (en la carta completa una respuesta puede ser un producto nuevo). La versión y el historial de la
   * pregunta ya los puso applyQuestions, porque la foto de la pregunta incluye sus respuestas.
   */
  private async applyAnswers(tx: Tx, se: Session, ops: QuestionOp[]) {
    for (const op of ops) {
      if (!op.answers) {
        continue;
      }
      if (op.before && same(this.answersSnap(op.before.answers), this.answersSnap(op.answers))) {
        continue;
      }
      await this.config.replaceQuestionAnswers(tx, se.storeId, op.id, op.answers);
    }
  }

  private async applyProducts(tx: Tx, se: Session, ops: ProductOp[], out: Change[], existing: ProductRow[]) {
    // Al casar por PLU, un externalId puede pasar de un producto a otro: se suelta antes en el que lo tenía
    // (el índice único uq_product_external_id no deja dos iguales ni un instante).
    const claimed = new Map<string, string>();
    for (const op of ops) {
      if (op.values.externalId) {
        claimed.set(op.values.externalId, op.id);
      }
    }
    const free = existing
      .filter((e) => e.externalId && claimed.has(e.externalId) && claimed.get(e.externalId) !== e.id)
      .map((e) => e.id);
    await this.carta.clearProductExternalIds(tx, se.storeId, free);
    for (const op of ops) {
      const values = op.values as ProductValues;
      const questions = op.questions ?? op.before?.questionIds ?? [];
      const after = { ...this.productSnap(values, questions), active: true };
      if (!op.before) {
        await this.carta.insertProduct(tx, se.storeId, op.id, values);
        if (questions.length) {
          await this.config.replaceProductQuestions(tx, se.storeId, op.id, questions);
        }
        await this.saveButton(tx, se, op.id, null, values);
        out.push(this.change("productos", "create", op.id, values.name, null, after));
        continue;
      }
      const before = { ...this.productSnap(op.before, op.before.questionIds), active: op.before.active };
      if (same(before, after)) {
        continue;
      }
      await this.carta.updateProduct(tx, se.storeId, op.id, values, op.before.version + 1);
      if (!same(op.before.questionIds, questions)) {
        await this.config.replaceProductQuestions(tx, se.storeId, op.id, questions);
      }
      await this.saveButton(tx, se, op.id, op.before, values);
      out.push(
        this.change("productos", this.updateAction(op.before.active), op.id, values.name, before, after),
      );
    }
  }

  /**
   * Tecla del producto en la toma de pedido (category_product), como hace Ajustes: si cambia de categoría
   * la tecla pasa a la nueva (al final); si no, cambian texto y colores. El texto sigue al nombre solo si era
   * el nombre (un texto propio de la tecla se respeta).
   */
  private async saveButton(tx: Tx, se: Session, id: string, before: ProductRow | null, v: ProductValues) {
    const changed =
      !before ||
      before.categoryId !== v.categoryId ||
      before.name !== v.name ||
      before.buttonLabel !== v.buttonLabel ||
      before.bgColor !== v.bgColor ||
      before.fgColor !== v.fgColor;
    if (!changed) {
      return;
    }
    const { current: cur } = await this.config.productButton(tx, se.storeId, id);
    // la tecla enseña el nombre en el TPV si lo hay; si no, el nombre del PLU
    const label = v.buttonLabel ?? v.name;
    if (v.categoryId && !cur.some((x) => x.category_id === v.categoryId)) {
      await this.config.moveProductButton(tx, se.storeId, id, {
        categoryId: v.categoryId,
        label,
        bg: v.bgColor,
        fg: v.fgColor,
      });
    } else {
      await this.config.updateProductButton(tx, se.storeId, id, { label, bg: v.bgColor, fg: v.fgColor });
    }
  }

  private async deactivateAll(
    tx: Tx,
    se: Session,
    m: Module,
    rows: (CategoryRow | ProductRow | QuestionRow)[],
    out: Change[],
  ) {
    const what = ({ categorias: "category", productos: "product", preguntas: "question" } as const)[m];
    await this.carta.deactivate(
      tx,
      se.storeId,
      what,
      rows.map((r) => r.id),
    );
    for (const r of rows) {
      const before = this.snapOf(m, r);
      out.push(this.change(m, "deactivate", r.id, r.name, before, { ...before, active: false }));
    }
  }

  /**
   * Historial (una fila por registro que cambia), store.config_version +1 una sola vez y una fila en la cola
   * hacia el Manager con el resumen. Si no cambia nada, no se toca nada y se devuelve la versión actual.
   */
  private async finish(tx: Tx, se: Session, what: Module | "carta", out: Change[]) {
    if (!out.length) {
      return this.changes.configVersion(se.storeId, tx);
    }
    const a = se.actor(this.clock());
    const v = await this.changes.bumpConfigVersion(tx, se.storeId);
    for (const c of out) {
      const labels = labelsOf(MODULES[c.module]);
      await this.changes.insertChangeLog(tx, {
        storeId: se.storeId,
        at: a.at,
        userId: a.userId,
        userName: a.user,
        module: c.module,
        action: c.action,
        recordName: c.name.slice(0, 120),
        diff: describeDiff(c.before, c.after, labels).slice(0, 4000) || "Sin cambios",
        recordId: c.id,
        before: c.before,
        after: c.after,
        configVersion: v,
        device: a.device,
      });
    }
    const count = (m: Module, action: Change["action"]) =>
      out.filter((c) => c.module === m && c.action === action).length;
    const summary = Object.fromEntries(
      (["categorias", "productos", "preguntas"] as const).map((m) => [
        m,
        {
          created: count(m, "create"),
          updated: count(m, "update") + count(m, "activate"),
          deactivated: count(m, "deactivate"),
        },
      ]),
    );
    // una fila por llamada: el Manager es quien mandó la carta, solo necesita saber la versión que dejó
    await this.changes.enqueueConfig(tx, se.storeId, se.storeId, {
      module: what,
      action: "sync",
      configVersion: v,
      summary,
    });
    return v;
  }

  // ───────────────────────── utilidades ─────────────────────────
  private change(
    module: Module,
    action: Change["action"],
    id: string,
    name: string,
    before: Snap | null,
    after: Snap,
  ): Change {
    return { module, action, id, name, before, after };
  }
  private updateAction(wasActive: boolean): Change["action"] {
    if (wasActive) {
      return "update";
    }
    return "activate";
  }
  /** created / reactivated se quedan; updated sin cambios es «unchanged». */
  private finalAction(op: { id: string; action: SyncAction }, m: Module, out: Change[]): SyncAction {
    if (op.action === "updated" && !out.some((c) => c.module === m && c.id === op.id)) {
      return "unchanged";
    }
    return op.action;
  }

  /** Respuesta de un sync individual: recuentos, versión y qué se hizo con cada fila (también las quitadas). */
  private listResult<O extends { id: string; action: SyncAction }>(
    m: Module,
    ops: O[],
    gone: (CategoryRow | ProductRow | QuestionRow)[],
    configVersion: number,
    out: Change[],
    show: (op: O) => { externalId: string | null; name: string; plu: number | null },
  ) {
    const actions: SyncAction[] = [];
    const items: ItemResult[] = ops.map((op) => {
      const action = this.finalAction(op, m, out);
      actions.push(action);
      return { ...show(op), id: op.id, action };
    });
    for (const g of gone) {
      let plu: number | null = null;
      if ("plu" in g) {
        plu = g.plu;
      }
      items.push({ externalId: g.externalId, id: g.id, name: g.name, plu, action: "deactivated" });
    }
    return { ...syncCounts(actions, gone.length), configVersion, items };
  }

  /** externalId → id de lo que viene en la carga (para las referencias de la carta completa). */
  private byExternal(ops: { id: string; values: { externalId: string | null } }[]) {
    const m = new Map<string, string>();
    for (const o of ops) {
      if (o.values.externalId) {
        m.set(o.values.externalId.trim(), o.id);
      }
    }
    return m;
  }

  /** Referencias de un sync individual: categorías y preguntas ACTIVAS de la tienda (por externalId o id). */
  private storeRefs(now: { categories: CategoryRow[]; questions: QuestionRow[] }): Refs {
    const cats = now.categories.filter((c) => c.active);
    const qs = now.questions.filter((q) => q.active);
    return {
      categoryByExt: this.byExternal(cats.map((c) => ({ id: c.id, values: c }))),
      categoryById: new Map(cats.map((c) => [c.id, c.id])),
      questionByExt: this.byExternal(qs.map((q) => ({ id: q.id, values: q }))),
      questionById: new Map(qs.map((q) => [q.id, q.id])),
    };
  }

  private productRefs(products: ProductRow[]): ProductRefs {
    return {
      byExt: this.byExternal(products.map((p) => ({ id: p.id, values: p }))),
      byId: new Map(products.map((p) => [p.id, p.id])),
      byPlu: new Map(products.map((p) => [String(p.plu), p.id])),
    };
  }

  /** Tipo de IVA → id del IVA activo (el primero por nombre si hubiera dos del mismo tipo). */
  private async taxMap(tx: Tx, storeId: string) {
    const m = new Map<string, string>();
    for (const t of await this.carta.activeTaxes(tx, storeId)) {
      const k = String(t.rate);
      if (!m.has(k)) {
        m.set(k, t.id);
      }
    }
    return m;
  }

  // Fotos para comparar («unchanged») y para el historial: solo lo que manda el Manager.
  private categorySnap(c: CategoryValues): Snap {
    return {
      externalId: c.externalId,
      name: c.name,
      bgColor: c.bgColor,
      fgColor: c.fgColor,
      sortOrder: c.sortOrder,
      hidden: c.hidden,
      orderOnTable: c.orderOnTable,
    };
  }
  private productSnap(p: ProductValues, questions: string[]): Snap {
    return {
      externalId: p.externalId,
      plu: p.plu,
      name: p.name,
      ticketName: p.ticketName,
      buttonLabel: p.buttonLabel,
      description: p.description,
      categoryId: p.categoryId,
      price: p.price,
      priceTerrace: p.priceTerrace,
      taxId: p.taxId,
      bgColor: p.bgColor,
      fgColor: p.fgColor,
      answerOnly: p.answerOnly,
      orderOnTable: p.orderOnTable,
      soldOut: p.soldOut,
      questions,
    };
  }
  private answersSnap(answers: { productId: string; label: string | null; extraPrice: number }[]) {
    return answers.map((a) => ({ productId: a.productId, label: a.label, extraPrice: a.extraPrice }));
  }
  private questionSnap(
    q: QuestionValues,
    answers: { productId: string; label: string | null; extraPrice: number }[],
    active: boolean,
  ): Snap {
    return {
      externalId: q.externalId,
      name: q.name,
      minAnswers: q.minAnswers,
      maxAnswers: q.maxAnswers,
      course: q.course,
      answers: this.answersSnap(answers),
      active,
    };
  }
  private snapOf(m: Module, r: CategoryRow | ProductRow | QuestionRow): Snap {
    if (m === "categorias") {
      return { ...this.categorySnap(r as CategoryRow), active: r.active };
    }
    if (m === "productos") {
      const p = r as ProductRow;
      return { ...this.productSnap(p, p.questionIds), active: p.active };
    }
    const q = r as QuestionRow;
    return this.questionSnap(q, q.answers, q.active);
  }
}
