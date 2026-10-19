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

export const SyncCategoryModel = z.object({
  externalId,
  name: str(60),
  bgColor: color,
  fgColor: color,
  sortOrder: z.number().int().min(0).max(999).optional(),
  hidden: z.boolean().optional(),
  orderOnTable: z.boolean().optional(),
});
export type SyncCategory = z.infer<typeof SyncCategoryModel>;

export const SyncProductModel = z.object({
  externalId,
  plu: z.number().int().positive().nullish(),
  name: str(80),
  ticketName: optStr(80),
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
});
export type SyncProduct = z.infer<typeof SyncProductModel>;

export const SyncAnswerModel = z
  .object({
    productExternalId: ref.nullish(),
    productId: z.string().uuid().nullish(),
    plu: z.number().int().positive().nullish(),
    label: optStr(80),
    extraPrice: z.number().min(0).max(1000).optional(),
  })
  .refine((a) => a.productExternalId || a.productId || a.plu, "productExternalId, productId o plu");
export type SyncAnswer = z.infer<typeof SyncAnswerModel>;

export const SyncQuestionModel = z.object({
  externalId,
  name: str(100),
  minAnswers: z.number().int().min(0).max(50).optional(),
  maxAnswers: z.number().int().min(0).max(50).optional(),
  course: z.number().int().nullish(),
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
