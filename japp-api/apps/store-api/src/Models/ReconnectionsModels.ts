import { z } from "zod";

const Modifier = z.object({ questionId: z.string().uuid().nullish(), plu: z.number().int(), quantity: z.number().int().positive().optional() }).strict();

/** POST /orders/{orderId}/reconnections: lo que el equipo ticó sin conexión, tal como lo marcó. clientId lo pone el equipo (repetir no duplica). */
export const CreateReconnectionsModel = z
  .object({
    accountId: z.string().uuid().nullish(),
    offlineReason: z.string().trim().max(80).nullish(),
    items: z
      .array(
        z
          .object({
            clientId: z.string().trim().min(1).max(80),
            plu: z.number().int(),
            name: z.string().trim().min(1).max(120),
            quantity: z.number().int().positive().max(999),
            unitPrice: z.number().min(0).max(99999).default(0),
            comment: z.string().trim().max(200).nullish(),
            modifiers: z.array(Modifier).max(40).default([]),
            markedAt: z.string().datetime({ offset: true }).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

/** POST /reconnections/{id}/accept */
export const AcceptReconnectionModel = z.object({ authorization: z.string().nullish() }).strict();
/** POST /reconnections/{id}/discard: el motivo es obligatorio */
export const DiscardReconnectionModel = z
  .object({ reason: z.string().trim().min(3).max(200), authorization: z.string().nullish() })
  .strict();
/** GET /reconnections?status=pending|all&orderId */
export const ReconnectionsFilterModel = z.object({
  status: z.enum(["pending", "all"]).default("pending"),
  orderId: z.string().uuid().optional(),
});
export const ReconnectionIdModel = z.string().uuid();
