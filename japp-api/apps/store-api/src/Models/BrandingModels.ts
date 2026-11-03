import { z } from "zod";

/** PUT /config/sistema: todo el registro de una vez, con version (0 si la tienda aún tiene los originales). */
export const BrandingModel = z
  .object({
    name: z.string().max(200),
    subtitle: z.string().max(200).nullish(),
    loginGroup: z.string().max(200).nullish(),
    logo: z.string().nullish(),
    noImage: z.string().nullish(),
    palette: z
      .array(
        z
          .object({
            hex: z.string().max(20),
            name: z.string().max(60).nullish(),
            default: z.boolean().nullish(),
          })
          .strict(),
      )
      .max(50),
    colors: z.record(z.string().max(30), z.string().max(20).nullable()).nullish(),
    version: z.number().int().min(0),
    authorization: z.string().nullish(),
  })
  .strict();
export type BrandingInput = z.infer<typeof BrandingModel>;
