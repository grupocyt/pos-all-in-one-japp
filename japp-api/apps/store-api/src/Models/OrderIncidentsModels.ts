import { z } from "zod";

/** POST /order-incidents: la incidencia tal como la vio el equipo. El id lo genera el equipo (repetir no duplica). */
export const CreateOrderIncidentModel = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid().nullish(),
    accountId: z.string().uuid().nullish(),
    tableName: z.string().trim().min(1).max(20),
    kind: z.enum(["offline", "mismatch", "rejected"]),
    detail: z
      .record(z.unknown())
      .default({})
      .refine((d) => JSON.stringify(d).length <= 64_000, "El detalle no puede pasar de 64 KB"),
    occurredAt: z.string().datetime({ offset: true }).nullish(),
  })
  .strict();
export type CreateOrderIncidentInput = z.infer<typeof CreateOrderIncidentModel>;

/** POST /order-incidents/{id}/resolve: qué se decidió (reintentar, quedarse con lo del servidor o ya cuadra). */
export const ResolveOrderIncidentModel = z
  .object({
    status: z.enum(["retried", "discarded", "resolved"]),
    note: z.string().trim().max(200).nullish(),
    authorizedBy: z.string().trim().max(80).nullish(),
  })
  .strict();
export type ResolveOrderIncidentInput = z.infer<typeof ResolveOrderIncidentModel>;

/** GET /order-incidents?status=open|all&orderId */
export const OrderIncidentsFilterModel = z.object({
  status: z.enum(["open", "all"]).default("open"),
  orderId: z.string().uuid().optional(),
});
export const IncidentIdModel = z.string().uuid();
