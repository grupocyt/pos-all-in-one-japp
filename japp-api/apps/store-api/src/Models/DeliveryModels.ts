import { z } from "zod";

const txt = (max: number) => z.string().trim().max(max).nullish();

/** POST /delivery/orders: lo que manda el integrador (o un encargado a mano). Más de 100 productos → TOO_LARGE (servicio). */
export const DeliveryOrderModel = z
  .object({
    platform: z.string().trim().toLowerCase().min(2).max(20),
    code: z.string().trim().min(1).max(30),
    externalId: txt(80),
    customer: z.object({ name: z.string().trim().min(1).max(80), phone: txt(20) }).strict(),
    address: txt(200),
    paymentNote: txt(80),
    note: txt(300),
    lines: z
      .array(
        z
          .object({
            plu: z.number().int().positive().nullish(),
            name: z.string().trim().min(1).max(120),
            quantity: z.number().positive().max(9999),
            unitPrice: z.number().min(0).max(100000),
            note: txt(200),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type DeliveryOrderInput = z.infer<typeof DeliveryOrderModel>;

/** POST /delivery/orders/{id}/advance: la versión que vio el equipo y, al asignar, quién lo lleva. */
export const DeliveryAdvanceModel = z
  .object({
    version: z.number().int(),
    riderId: z.string().uuid().nullish(),
    riderName: z.string().trim().max(60).nullish(),
  })
  .strict();

/** POST /delivery/orders/{id}/cancel: versión, motivo y la autorización del encargado (sistema.autorizar). */
export const DeliveryCancelModel = z
  .object({
    version: z.number().int(),
    note: z.string().trim().max(300).nullish(),
    authorization: z.string().nullish(),
  })
  .strict();
