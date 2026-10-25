import { z } from "zod";

/** PUT /config/pantalla-cliente: la configuración entera y, si viene, la lista en su orden con su horario. */
export const PutDisplayModel = z
  .object({
    version: z.number().int().positive(),
    config: z.record(z.unknown()),
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            days: z.array(z.number().int()).max(7).optional(),
            from: z.string().nullish(),
            to: z.string().nullish(),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();
export type PutDisplay = z.infer<typeof PutDisplayModel>;
