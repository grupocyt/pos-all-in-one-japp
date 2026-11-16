import { z } from "zod";

/**
 * Cuerpos de Ajustes › Carta y de los servicios Sync del App Manager.
 * Los de sync NO son strict: el Manager puede mandar campos que la tienda no guarda (channels, id, active…)
 * y se ignoran. Un campo que no viene se conserva («unchanged» compara solo lo que manda el Manager).
 */
const str = (max: number) => z.string().trim().min(1).max(max);
const optStr = (max: number) => z.string().trim().max(max).nullish();
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "Color #RRGGBB")
  .nullish();
const externalId = z.string().trim().min(1).max(60).nullish();
const ref = z.string().trim().min(1).max(60);
/** 16/11 · textos por idioma: {"en":{"name":"SET MENU 1"}} (códigos de dos letras). */
const translations = z
  .record(z.string().regex(/^[a-z]{2}$/, "Idioma de dos letras (es, en, fr)"), z.record(z.string(), z.string().max(300).nullable()))
  .optional();
const desc = z.string().max(300).nullish();

export const SyncCategoryModel = z.object({
  externalId,
  name: str(60),
  bgColor: color,
  fgColor: color,
  sortOrder: z.number().int().min(0).max(999).optional(),
  hidden: z.boolean().optional(),
  orderOnTable: z.boolean().optional(),
  // 16/11 · publicación de Carta
  description: desc,
  translations,
  /** Calificativos de la categoría, en orden ([] = ninguno). */
  qualifiers: z
    .array(
      z.union([
        // el PLU solo: así lo devuelve GET /config/carta (ida y vuelta)
        z.number().int().positive(),
        z
        .object({
          productExternalId: ref.nullish(),
          plu: z.number().int().positive().nullish(),
          sortOrder: z.number().int().min(0).max(9999).optional(),
        })
        .refine((q) => q.productExternalId || q.plu, "productExternalId o plu"),
      ]),
    )
    .max(60)
    .optional(),
});
export type SyncCategory = z.infer<typeof SyncCategoryModel>;

export const SyncProductModel = z.object({
  externalId,
  plu: z.number().int().positive().nullish(),
  /** Nombre del PLU (el maestro). */
  name: str(80),
  /** Nombre a imprimir (comanda, precuenta y factura); vacío = el del PLU. */
  ticketName: optStr(80),
  /** Nombre en el TPV (texto de la tecla); vacío = el del PLU. */
  buttonLabel: optStr(80),
  description: z.string().max(300).nullish(),
  categoryExternalId: ref.nullish(),
  categoryId: z.string().uuid().nullish(),
  price: z.number().min(0).max(100000),
  priceTerrace: z.number().min(0).max(100000).nullish(),
  taxRate: z.number().min(0).max(100).nullish(),
  questionExternalIds: z.array(ref).max(30).optional(),
  questionIds: z.array(z.string().uuid()).max(30).optional(),
  bgColor: color,
  fgColor: color,
  answerOnly: z.boolean().optional(),
  orderOnTable: z.boolean().optional(),
  soldOut: z.boolean().optional(),
  // 16/11 · publicación de Carta
  translations,
  /** COMIDA y/o BEBIDA ([] = no imprime). */
  printChannels: z.array(z.string().trim().min(1).max(40)).max(2).optional(),
  /** Calificativo: texto rápido del comentario. */
  qualifier: z.boolean().optional(),
});
export type SyncProduct = z.infer<typeof SyncProductModel>;

export const SyncAnswerModel = z
  .object({
    productExternalId: ref.nullish(),
    productId: z.string().uuid().nullish(),
    plu: z.number().int().positive().nullish(),
    label: optStr(80),
    extraPrice: z.number().min(0).max(1000).optional(),
    // 16/11 · publicación de Carta
    sortOrder: z.number().int().min(0).max(9999).optional(),
    bgColor: color,
    fgColor: color,
    translations,
  })
  .refine((a) => a.productExternalId || a.productId || a.plu, "productExternalId, productId o plu");
export type SyncAnswer = z.infer<typeof SyncAnswerModel>;

export const SyncQuestionModel = z.object({
  externalId,
  name: str(100),
  minAnswers: z.number().int().min(0).max(50).optional(),
  maxAnswers: z.number().int().min(0).max(50).optional(),
  course: z.number().int().nullish(),
  // 16/11 · publicación de Carta
  plu: z.number().int().positive().nullish(),
  description: desc,
  required: z.boolean().optional(),
  answerType: z.enum(["unica", "multiple"]).optional(),
  courseName: z.string().trim().max(40).nullish(),
  translations,
  // el tamaño (100 por pregunta) lo comprueba el servicio con SYNC_LIMITS → 413 TOO_LARGE
  answers: z.array(SyncAnswerModel).optional(),
});
export type SyncQuestion = z.infer<typeof SyncQuestionModel>;

export const CategoriasSyncModel = z.object({ items: z.array(SyncCategoryModel) });
export const ProductosSyncModel = z.object({ items: z.array(SyncProductModel) });
export const PreguntasSyncModel = z.object({ items: z.array(SyncQuestionModel) });
export const CartaSyncModel = z.object({
  categories: z.array(SyncCategoryModel),
  products: z.array(SyncProductModel),
  questions: z.array(SyncQuestionModel),
});

/**
 * 16/11 · Publicación de Carta (JSON «Campos del JSON · Publicación de Carta al TPV»): POST /config/carta/sync con «release».
 * kind full = carta entera (lo que no viene se desactiva) · prices = solo precios · names = solo nombres ·
 * withdraw = retirar la carta (espera a que un encargado la confirme).
 */
export const ReleaseModel = z.object({
  kind: z.enum(["full", "prices", "names", "withdraw"]),
  releaseVersion: z.number().int().min(0),
  effectiveAt: z.string().datetime({ offset: true }),
  checksum: z.string().max(200).nullish(),
  store: z.string().trim().min(1).max(20),
  priceLine: z.string().trim().max(60).nullish(),
  menu: z.string().trim().max(60).nullish(),
  publicationType: z.string().trim().max(20).nullish(),
  publicationId: z.string().trim().min(1).max(60),
});
export type Release = z.infer<typeof ReleaseModel>;

export const KeyModel = z
  .object({
    categoryExternalId: ref,
    productExternalId: ref.nullish(),
    plu: z.number().int().positive().nullish(),
    label: z.string().trim().max(80).nullish(),
    bgColor: color,
    fgColor: color,
    posX: z.number().int().min(0).max(99),
    posY: z.number().int().min(0).max(999),
  })
  .refine((k) => k.productExternalId || k.plu, "productExternalId o plu");
export type SyncKey = z.infer<typeof KeyModel>;

/** Carga completa: los cinco bloques. */
export const PublicationFullModel = z.object({
  release: ReleaseModel,
  categories: z.array(SyncCategoryModel),
  products: z.array(SyncProductModel),
  questions: z.array(SyncQuestionModel),
  keys: z.array(KeyModel).default([]),
});
export type PublicationFull = z.infer<typeof PublicationFullModel>;

const productRef = { externalId: ref.nullish(), plu: z.number().int().positive().nullish() };
export const PriceItemModel = z
  .object({
    ...productRef,
    price: z.number().min(0).max(100000),
    priceTerrace: z.number().min(0).max(100000).nullish(),
  })
  .refine((p) => p.externalId || p.plu, "externalId o plu");
export const NameItemModel = z
  .object({ ...productRef, name: str(80), ticketName: optStr(80), buttonLabel: optStr(80), translations })
  .refine((p) => p.externalId || p.plu, "externalId o plu");
export const PublicationPricesModel = z.object({ release: ReleaseModel, products: z.array(PriceItemModel) });
export const PublicationNamesModel = z.object({ release: ReleaseModel, products: z.array(NameItemModel) });
export const PublicationWithdrawModel = z.object({ release: ReleaseModel, note: z.string().max(300).nullish() });
export type PriceItem = z.infer<typeof PriceItemModel>;
export type NameItem = z.infer<typeof NameItemModel>;

/** PUT /config/categorias/order y /config/areas/order: todos los activos, en el orden nuevo. */
export const OrderModel = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }).strict();

/** POST /config/productos/{id}/sold-out. */
export const SoldOutModel = z.object({ soldOut: z.boolean() }).strict();

const coord = z.number().min(0).max(99999);
/** PUT /config/areas/{areaId}/layout: mesas del área y dibujos (se sustituyen), con la versión del área. */
export const LayoutModel = z
  .object({
    tables: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            x: coord,
            y: coord,
            width: z.number().int().min(10).max(2000).nullish(),
            height: z.number().int().min(10).max(2000).nullish(),
          })
          .strict(),
      )
      .max(500),
    drawings: z
      .array(
        z
          .object({
            kind: z.enum(["wall", "block", "item", "text"]),
            x1: coord,
            y1: coord,
            x2: coord.nullish(),
            y2: coord.nullish(),
            item: z.string().max(20).nullish(),
            label: z.string().max(80).nullish(),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
    version: z.number().int(),
  })
  .strict();
export type Layout = z.infer<typeof LayoutModel>;

/** GET /config/carta/preview?mode. */
export const PreviewModeModel = z.enum(["tpv", "oot"]).default("tpv");
