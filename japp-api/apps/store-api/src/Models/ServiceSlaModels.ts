import { z } from "zod";

const minutes = z.number().int().min(1).max(600).nullish();
/** PUT /service/sla: la configuración entera (turnos y reglas) con la versión que se leyó. */
export const PutSlaModel = z
  .object({
    version: z.number().int().min(1),
    shifts: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().trim().min(1).max(40),
            start: z.string(),
            end: z.string(),
          })
          .strict(),
      )
      .max(8),
    rules: z
      .array(
        z
          .object({
            id: z.string().uuid().nullish(),
            areaId: z.string().uuid().nullish(),
            tableId: z.string().uuid().nullish(),
            shiftId: z.string().uuid().nullish(),
            firstOrder: minutes,
            unsent: minutes,
            idle: minutes,
            prebillPay: minutes,
            total: minutes,
            warnPercent: z.number().int().min(50).max(99).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type PutSlaInput = z.infer<typeof PutSlaModel>;
