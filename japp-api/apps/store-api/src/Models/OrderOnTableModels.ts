import { z } from "zod";

/** Modelos de entrada de Order on Table: QR de la mesa (TPV/PDA) y pedido del cliente (sistema externo). */
export { Uuid } from "./OrdersModels.js";

/** POST /orders/{orderId}/oot: print = imprimir el ticket con el QR en la impresora de tickets del área. */
export const CreateOot = z.object({ print: z.boolean().default(false) }).strict();

/** Una línea del pedido del cliente: como POST …/lines, sin cuenta, sin force y sin version. */
const OotItem = z
  .object({
    plu: z.number().int().positive(),
    quantity: z.number().int().min(1).max(99).default(1),
    comment: z.string().max(300).nullish(),
    modifiers: z
      .array(
        z.object({
          questionId: z.string().nullish(),
          plu: z.number().int().positive(),
          quantity: z.number().int().min(1).max(99).optional(),
        }),
      )
      .max(30)
      .default([]),
  })
  .strict();

/** POST /oot/{token}/lines. requestId: id del pedido en el otro sistema (texto o número), evita el pedido doble. */
export const OotLines = z
  .object({
    items: z.array(OotItem).min(1).max(50),
    requestId: z.union([z.string().min(1).max(100), z.number().int()]).nullish(),
  })
  .strict();
